import argparse
import json
import re
import sys
import subprocess
from pathlib import Path

from acceptance import review_problems, sha

PENDING = {"IN_PROGRESS", "PENDING", "QUEUED", "WAITING"}
GITHUB_MERGE_STATES = {
    "BEHIND",
    "BLOCKED",
    "CLEAN",
    "DIRTY",
    "DRAFT",
    "HAS_HOOKS",
    "UNKNOWN",
    "UNSTABLE",
}


def result(decision, head_sha, reason_codes, reasons, merge_mode=None):
    return {
        "decision": decision,
        "mergeMode": merge_mode,
        "headSha": head_sha,
        "reasonCodes": sorted(set(reason_codes)),
        "reasons": reasons,
    }


def check_state(check):
    status = str(check.get("status") or "").upper()
    conclusion = str(check.get("conclusion") or "").upper()
    return status, conclusion


FULL_COVERAGE = {
    "repository": ["Repository contracts"],
    "lint": ["Lint and format"],
    "types-tests-coverage-builds": ["Node quality"],
    "browser": [f"Browser acceptance ({project}, {shard}/4)"
                for project in ("desktop-chromium", "mobile-chromium") for shard in range(1, 5)],
}
FULL_SOURCE_JOBS = ["Classify changes", "Terraform", "Source verification",
                    "Desktop (macos-15)", "Desktop (windows-latest)",
                    *(name for group in FULL_COVERAGE.values() for name in group)]


def equivalent_job_names(coverage):
    if not isinstance(coverage, dict) or set(coverage) != set(FULL_COVERAGE):
        return None
    for key, expected in FULL_COVERAGE.items():
        value = coverage[key]
        group = [value] if isinstance(value, str) else value
        if not isinstance(group, list) or len(group) != len(expected) or sorted(group, key=str) != sorted(expected):
            return None
    return list(FULL_SOURCE_JOBS)


def source_integration_matches(observation, receipt):
    source_sha, live_sha = receipt.get("mergeSha"), observation.get("mergeSha")
    if (not sha(source_sha) or not sha(live_sha)
            or receipt.get("workflowSha") != source_sha):
        return False
    if source_sha == live_sha:
        return "mergeCommitEvidence" not in observation
    evidence = observation.get("mergeCommitEvidence")
    if (not isinstance(evidence, dict)
            or set(evidence) != {"provider", "repository", "sourceCommit", "liveCommit"}
            or evidence.get("provider") != "github-rest"
            or evidence.get("repository") != observation.get("repository")):
        return False
    trees = []
    for key, expected in (("sourceCommit", source_sha), ("liveCommit", live_sha)):
        commit = evidence.get(key)
        if (not isinstance(commit, dict)
                or set(commit) != {"sha", "treeSha", "parentShas", "url"}
                or commit.get("sha") != expected or not sha(commit.get("treeSha"))
                or commit.get("parentShas") != [observation.get("baseSha"), observation.get("headSha")]
                or commit.get("url") != f"https://api.github.com/repos/{observation.get('repository')}/git/commits/{expected}"):
            return False
        trees.append(commit["treeSha"])
    return trees[0] == trees[1]


def source_observation_matches(observation, pr, verification):
    """Consume the bounded shared observer; green commit contexts alone cannot bind a PR attempt."""
    if not isinstance(observation, dict):
        return False
    receipt = observation.get("receipt") or {}
    artifact = observation.get("artifact") or {}
    if not isinstance(receipt, dict) or not isinstance(artifact, dict):
        return False
    scope = receipt.get("scope") or {}
    if not isinstance(scope, dict):
        return False
    bools = "prose_only full repo terraform node database browser desktop containers dependencies".split()
    if (set(scope) != set(bools + ["changed_packages"])
            or any(type(scope.get(key)) is not bool for key in bools)
            or scope.get("changed_packages") != []):
        return False
    full = scope["full"] and all(not scope[key] for key in bools if key != "full")
    prose = (scope["prose_only"] and scope["repo"]
             and all(not scope[key] for key in bools if key not in {"prose_only", "repo"}))
    if not (full or prose):
        return False
    expected = FULL_SOURCE_JOBS if full else ["Classify changes", "Repository contracts", "Source verification"]
    jobs = observation.get("jobs")
    if (not isinstance(jobs, list) or len(jobs) != len(expected)
            or sorted(j.get("name", "") for j in jobs if isinstance(j, dict)) != sorted(expected)
            or any(type(j.get("id")) is not int or j["id"] <= 0 or j.get("conclusion") != "success" for j in jobs)):
        return False
    if (observation.get("state") != "success" or observation.get("stable") is not True
            or observation.get("schemaVersion") != 1
            or type(artifact.get("id")) is not int or artifact["id"] <= 0
            or not re.fullmatch(r"sha256:[a-f0-9]{64}", str(artifact.get("digest")))
            or any(type(observation.get(key)) is not int or observation[key] <= 0
                   for key in ("workflowId", "runId", "runAttempt"))
            or observation.get("event") != "pull_request"
            or receipt.get("event") != "pull_request"):
        return False
    for field in ("headSha", "baseSha", "number", "bodySha256", "mergeSha", "repository", "repositoryId", "baseRef"):
        if observation.get(field) != pr.get(field) or pr.get(field) is None:
            return False
    if not re.fullmatch(r"[a-f0-9]{64}", str(pr.get("bodySha256"))):
        return False
    for field in ("headSha", "baseSha", "number", "repository", "repositoryId", "baseRef",
                  "runId", "runAttempt", "forceFull"):
        if receipt.get(field) != observation.get(field) or receipt.get(field) is None:
            return False
    if (type(receipt.get("forceFull")) is not bool
            or receipt.get("schemaVersion") != 1
            or type(receipt.get("number")) is not int or receipt["number"] < 1
            or type(receipt.get("repositoryId")) is not int or receipt["repositoryId"] < 1
            or not re.fullmatch(r"[\w.-]+/[\w.-]+", str(receipt.get("repository")))
            or not re.fullmatch(r"[a-f0-9]{40}", str(receipt.get("mergeSha")))
            or not source_integration_matches(observation, receipt)
            or receipt.get("workflowRef") != f"{receipt['repository']}/.github/workflows/ci.yml@refs/pull/{receipt['number']}/merge"):
        return False
    if any(not re.fullmatch(r"[a-f0-9]{64}", str(receipt.get(field)))
           for field in ("workflowSha256", "classifierSha256")):
        return False
    source = verification.get("sourceRun")
    return not source or all(source.get(key) == observation.get(key)
                             for key in ("headSha", "baseSha", "workflowId", "runId", "runAttempt", "event"))


def prose_verification(verification, pr, checks, expected):
    """Recompute from Git, not caller-supplied scope booleans or path lists."""
    source = verification.get("sourceRun") or {}
    names = ["Classify changes", "Repository contracts", "Source verification"]
    if (verification.get("baseSha") != pr["baseSha"]
        or source.get("headSha") != pr["headSha"] or source.get("baseSha") != pr["baseSha"]
        or source.get("event") != "pull_request"
        or any(type(source.get(k)) is not int or source[k] <= 0
               for k in ("workflowId", "runId", "runAttempt"))
        or not all(name in expected for name in names)):
        return False
    for name in names:
        matches = [c for c in checks if c.get("name") == name]
        if (len(matches) != 1 or check_state(matches[0]) != ("COMPLETED", "SUCCESS")
            or matches[0].get("appId") != 15368
            or any(matches[0].get(k) != source[k] for k in ("workflowId", "runId", "runAttempt", "event"))):
            return False
    root = Path(__file__).resolve().parents[4]
    try:
        current = subprocess.run(["git", "rev-parse", "HEAD"], cwd=root, check=True,
                                 capture_output=True, text=True, timeout=15).stdout.strip()
        if current != pr["headSha"]:
            return False
        classifier = root / ".github/scripts/ci-scope.mjs"
        committed = subprocess.run(["git", "show", f"{pr['headSha']}:.github/scripts/ci-scope.mjs"],
                                   cwd=root, check=True, capture_output=True, timeout=15).stdout
        if classifier.read_bytes() != committed:
            return False
        output = subprocess.run(["node", str(root / ".github/scripts/ci-scope.mjs"),
                                 "--base", pr["baseSha"], "--head", pr["headSha"], "--json"],
                                cwd=root, check=True, capture_output=True, text=True, timeout=30)
        scope = json.loads(output.stdout)
        return scope.get("prose_only") is True and verification.get("scope") == scope
    except (OSError, subprocess.SubprocessError, ValueError):
        return False


def current_attempts(checks):
    """Supersede only attempts of the same evidenced workflow run and trigger.

    Different runs remain ambiguous: timestamps or matching names alone do not
    prove that a new run exercises the same scope.
    """
    groups = {}
    for index, check in enumerate(checks):
        fields = ("workflowId", "runId", "runAttempt")
        proven = all(type(check.get(k)) is int and check[k] > 0 for k in fields)
        key = (check.get("name"), check.get("appId"), check.get("headSha"),
               check.get("workflowId"), check.get("runId"), check.get("event"))
        if not proven or not check.get("event"):
            key = ("unproven", index)
        groups.setdefault(key, []).append(check)
    selected = []
    for group in groups.values():
        latest = max(c.get("runAttempt", 0) for c in group)
        selected.extend(c for c in group if c.get("runAttempt", 0) == latest)
    return selected


def evaluate(state):
    pr = state.get("pr") or {}
    head = pr.get("headSha")

    if not all(isinstance(sha, str) and re.fullmatch(r"[0-9a-f]{40}", sha)
               for sha in (head, pr.get("baseSha"))):
        return result(
            "BLOCK", head, ["ambiguous_target"], ["PR head or base SHA is missing"]
        )
    if pr.get("state") == "MERGED":
        return result("TERMINAL", head, ["already_merged"], ["PR is already merged"])
    if pr.get("state") != "OPEN":
        return result(
            "BLOCK",
            head,
            ["pr_not_open"],
            [f"PR state is {pr.get('state') or 'unknown'}"],
        )
    if (
        type(pr.get("isDraft")) is not bool
        or pr.get("mergeStateStatus") not in GITHUB_MERGE_STATES
    ):
        return result(
            "BLOCK",
            head,
            ["pr_state_unverified"],
            ["Draft or merge-state evidence is missing"],
        )
    if state.get("worktree", {}).get("clean") is not True:
        return result("BLOCK", head, ["dirty_worktree"], ["Worktree is not clean"])

    head_bound = {
        "base": "evidenceHeadSha",
        "verification": "headSha",
        "ci": "headSha",
        "feedback": "headSha",
        "selfReview": "headSha",
        "linear": "headSha",
        "metadata": "headSha",
    }
    stale = [
        name
        for name, field in head_bound.items()
        if (state.get(name) or {}).get(field) != head
    ]
    if stale:
        return result(
            "REMEDIATE",
            head,
            ["stale_evidence"],
            [f"Evidence is missing or stale for: {', '.join(stale)}"],
        )

    evidence = state.get("evidence") or {}
    missing_sources = [name for name in (*head_bound, "merge")
                       if not isinstance(evidence.get(name), list)
                       or not evidence[name]
                       or not all(isinstance(ref, str) and ref.strip() for ref in evidence[name])]
    if missing_sources:
        return result("BLOCK", head, ["evidence_sources_missing"],
                      [f"Supporting evidence references are missing: {', '.join(missing_sources)}"])

    linear = state.get("linear") or {}
    if (
        linear.get("verified") is not True
        or linear.get("paginationComplete") is not True
        or linear.get("project") != "Nohmi"
    ):
        return result(
            "BLOCK",
            head,
            ["linear_identity_unverified"],
            [
                "Live Linear evidence does not resolve exactly one complete Nohmi Project scope"
            ],
        )

    merge = state.get("merge") or {}
    if merge.get("capabilitiesVerified") is not True:
        return result(
            "BLOCK",
            head,
            ["merge_capabilities_unverified"],
            ["Live repository merge capabilities are unverified"],
        )
    if merge.get("serverGatesVerified") is not True:
        return result("BLOCK", head, ["server_gates_unverified"],
                      ["Server enforcement of current checks and resolved conversations is unverified"])
    if merge.get("squashAllowed") is not True:
        return result(
            "BLOCK",
            head,
            ["squash_unavailable"],
            ["Repository does not allow squash merge"],
        )

    feedback = state.get("feedback") or {}
    if feedback.get("collectionComplete") is not True:
        return result(
            "BLOCK",
            head,
            ["feedback_collection_incomplete"],
            ["Complete review feedback collection is unverified"],
        )
    ci = state.get("ci") or {}
    checks = ci.get("checks") or []
    required = ci.get("expectedRequiredChecks") or []
    selected = ci.get("expectedSelectedChecks")
    if not isinstance(selected, list) or not all(isinstance(name, str) and name for name in selected):
        return result("BLOCK", head, ["selected_check_policy_unverified"],
                      ["The selected workflow job inventory is missing or invalid"])
    expected = list(dict.fromkeys([*required, *selected]))
    expected_apps = ci.get("expectedCheckApps") or {}
    if (
        ci.get("rulesVerified") is not True
        or ci.get("inventoryComplete") is not True
        or ci.get("selectedChecksVerified") is not True
        or not required
        or set(expected_apps) != set(expected)
        or any(
            type(app_id) is not int or app_id <= 0 for app_id in expected_apps.values()
        )
    ):
        return result(
            "BLOCK",
            head,
            ["required_check_policy_unverified"],
            [
                "Live branch rules, check inventory, or required-check providers are unverified"
            ],
        )
    for check in checks:
        if check.get("name") and check.get("headSha") != head:
            return result(
                "BLOCK",
                head,
                ["check_provenance_unverified"],
                [f"Check is not bound to the current head: {check.get('name')}"],
            )
        name = check.get("name")
        if name in expected and check.get("appId") != expected_apps[name]:
            return result(
                "BLOCK",
                head,
                ["check_provenance_unverified"],
                [f"Required check has the wrong provider: {name}"],
            )

    checks = current_attempts(checks)

    remediation_codes = []
    remediation_reasons = []
    if pr.get("isDraft") is True:
        remediation_codes.append("draft_pr")
        remediation_reasons.append("PR is still a draft")
    if pr.get("pushedHeadSha") != head:
        remediation_codes.append("unpushed_head")
        remediation_reasons.append("Local and pushed head SHAs do not match")
    if pr.get("mergeable") == "CONFLICTING" or pr.get("mergeStateStatus") == "DIRTY":
        remediation_codes.append("merge_conflict")
        remediation_reasons.append("PR has merge conflicts")

    base = state.get("base") or {}
    if (
        pr.get("mergeStateStatus") == "BEHIND"
        or base.get("headSha") != pr.get("baseSha")
        or base.get("headContainsBase") is not True
    ):
        remediation_codes.append("stale_base")
        remediation_reasons.append(
            "Head is not proven current with the fetched PR base"
        )

    verification = state.get("verification") or {}
    if not source_observation_matches((state.get("ci") or {}).get("sourceObservation"), pr, verification):
        remediation_codes.append("source_observation_unverified")
        remediation_reasons.append("Current live PR/body and exact successful source-attempt receipt/jobs are unverified")
    full_verified = verification.get("pnpmVerify") == "SUCCESS"
    if verification.get("mode") == "hosted":
        names = equivalent_job_names(verification.get("equivalentChecks"))
        full_verified = (
            verification.get("equivalenceVerified") is True
            and names is not None
            and all(name in expected for name in names)
            and all(any(c.get("name") == name and check_state(c) == ("COMPLETED", "SUCCESS")
                        for c in checks) for name in names)
            and verification.get("localOnlyComplete") is True
        )
    if verification.get("mode") == "prose":
        full_verified = prose_verification(verification, pr, checks, expected)
    failures = verification.get("localFailures", [])
    failures_resolved = isinstance(failures, list) and all(
        isinstance(f, dict) and f.get("classification") in {"fixed", "environment"}
        and f.get("evidence") and f.get("focusedReproduction") == "SUCCESS"
        for f in failures
    )
    if verification.get("pnpmVerify") == "FAILURE" and not failures:
        failures_resolved = False
    if verification.get("focused") != "SUCCESS" or not full_verified or not failures_resolved:
        remediation_codes.append("verification_incomplete")
        remediation_reasons.append(
            "Candidate needs policy-complete verification (full or Git-verified prose) and diagnosed failures"
        )

    metadata = state.get("metadata") or {}
    if metadata.get("consistent") is not True:
        remediation_codes.append("metadata_drift")
        remediation_reasons.append(
            "PR metadata, diff, docs, and tracked work do not agree"
        )

    direct_keys = set(linear.get("directIssueKeys") or [])
    work_map_keys = set(linear.get("workMapIssueKeys") or [])
    if (
        not direct_keys
        or direct_keys != work_map_keys
        or linear.get("structuredBacklinksComplete") is not True
        or linear.get("statusesCompatible") is not True
    ):
        remediation_codes.append("linear_coverage_incomplete")
        remediation_reasons.append(
            "Nohmi Work map, backlinks, direct issues, or statuses need reconciliation"
        )

    if (
        type(feedback.get("unresolvedActionable")) is not int
        or feedback.get("unresolvedActionable") != 0
        or type(feedback.get("unresolvedThreads")) is not int
        or feedback.get("unresolvedThreads") != 0
    ):
        remediation_codes.append("review_incomplete")
        remediation_reasons.append(
            "Actionable feedback or unresolved threads remain"
        )

    self_review = state.get("selfReview") or {}
    if (
        self_review.get("complete") is not True
        or type(self_review.get("newVerifiedFindings")) is not int
        or self_review.get("newVerifiedFindings") != 0
    ):
        remediation_codes.append("self_review_incomplete")
        remediation_reasons.append(
            "Independent current-head review is incomplete or has verified findings"
        )

    by_name = {}
    for check in checks:
        by_name.setdefault(check.get("name"), []).append(check)
    missing = [name for name in expected if len(by_name.get(name, [])) != 1]
    if missing:
        remediation_codes.append("required_checks_missing")
        remediation_reasons.append(
            f"Required checks are missing or duplicated: {', '.join(missing)}"
        )

    pending_checks = []
    failed_checks = []
    for check in checks:
        name = check.get("name")
        if not name:
            continue
        status, conclusion = check_state(check)
        if status in PENDING or not conclusion:
            pending_checks.append(name)
        elif (status != "COMPLETED" or conclusion not in {"SUCCESS", "NEUTRAL", "SKIPPED"}
              or (name in expected and conclusion != "SUCCESS")
              or (conclusion != "SUCCESS" and check.get("required") is not False)):
            failed_checks.append(name)
    if failed_checks:
        remediation_codes.append("checks_failed")
        remediation_reasons.append(
            f"Checks are not successful: {', '.join(sorted(set(failed_checks)))}"
        )

    if remediation_codes:
        return result("REMEDIATE", head, remediation_codes, remediation_reasons)
    approval_pending = (feedback.get("requiredApprovalsSatisfied") is not True
                        or feedback.get("approvalsCurrent") is not True)
    if pending_checks or approval_pending:
        reasons = []
        if approval_pending:
            reasons.append("Waiting for eligible current approval; never manufacture approval")
        if pending_checks:
            reasons.append(f"Checks pending: {', '.join(sorted(set(pending_checks)))}")
        return result("WAIT", head, ["external_checks_pending"], reasons)
    if pr.get("mergeable") not in {"MERGEABLE", "UNKNOWN"}:
        return result(
            "REMEDIATE",
            head,
            ["mergeability_unproven"],
            ["GitHub mergeability is not proven"],
        )
    if pr.get("mergeable") == "UNKNOWN":
        return result(
            "WAIT",
            head,
            ["mergeability_pending"],
            ["GitHub is still calculating mergeability"],
        )

    acceptance_errors = review_problems(state)
    if acceptance_errors:
        return result("BLOCK", head, ["acceptance_incomplete"], acceptance_errors)

    if merge.get("normalMergeAllowed") is True:
        if pr.get("mergeStateStatus") != "CLEAN":
            return result(
                "BLOCK",
                head,
                ["merge_state_contradiction"],
                [
                    "Normal merge was reported available while GitHub still reports a blocked state"
                ],
            )
        return result(
            "MERGE", head, ["ready"], ["Every current-head gate is satisfied"], "normal"
        )
    return result(
        "BLOCK",
        head,
        ["merge_authority_unavailable"],
        ["Normal protected merge is unavailable; admin and deferred auto-merge are prohibited"],
    )


def main(argv):
    parser = argparse.ArgumentParser(
        description="Evaluate a sanitized ship-it readiness snapshot"
    )
    parser.add_argument("--state", required=True)
    parser.add_argument("--output")
    parser.add_argument("--pretty", action="store_true")
    args = parser.parse_args(argv)
    payload = evaluate(json.loads(Path(args.state).read_text(encoding="utf-8")))
    serialized = json.dumps(payload, indent=2 if args.pretty else None, sort_keys=True)
    if args.output:
        path = Path(args.output)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(f"{serialized}\n", encoding="utf-8")
    else:
        print(serialized)


if __name__ == "__main__":
    main(sys.argv[1:])
