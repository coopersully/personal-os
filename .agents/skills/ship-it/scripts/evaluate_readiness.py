import argparse
import json
import sys
from pathlib import Path

PENDING = {"IN_PROGRESS", "PENDING", "QUEUED", "WAITING"}
FAILED = {"ACTION_REQUIRED", "CANCELLED", "ERROR", "FAILURE", "STALE", "TIMED_OUT"}
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


def evaluate(state):
    pr = state.get("pr") or {}
    head = pr.get("headSha")

    if not head or not pr.get("baseSha"):
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
        "codeRabbit": "headSha",
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
    if merge.get("squashAllowed") is not True:
        return result(
            "BLOCK",
            head,
            ["squash_unavailable"],
            ["Repository does not allow squash merge"],
        )

    feedback = state.get("feedback") or {}
    rabbit = state.get("codeRabbit") or {}
    if feedback.get("collectionComplete") is not True:
        return result(
            "BLOCK",
            head,
            ["feedback_collection_incomplete"],
            ["Complete review feedback collection is unverified"],
        )
    if rabbit.get("coverageVerified") is not True:
        return result(
            "BLOCK",
            head,
            ["coderabbit_coverage_unverified"],
            ["Current-diff CodeRabbit coverage is unverified"],
        )

    ci = state.get("ci") or {}
    checks = ci.get("checks") or []
    expected = ci.get("expectedRequiredChecks") or []
    expected_apps = ci.get("expectedRequiredCheckApps") or {}
    if (
        ci.get("rulesVerified") is not True
        or ci.get("inventoryComplete") is not True
        or not expected
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
    if (
        verification.get("focused") != "SUCCESS"
        or verification.get("pnpmVerify") != "SUCCESS"
    ):
        remediation_codes.append("verification_incomplete")
        remediation_reasons.append(
            "Focused verification and pnpm verify have not both passed"
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
        feedback.get("unresolvedActionable") != 0
        or feedback.get("requiredApprovalsSatisfied") is not True
        or feedback.get("approvalsCurrent") is not True
    ):
        remediation_codes.append("review_incomplete")
        remediation_reasons.append(
            "Actionable feedback or current-head approval requirements remain"
        )

    self_review = state.get("selfReview") or {}
    if (
        self_review.get("complete") is not True
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
        elif conclusion in FAILED or (name in expected and conclusion != "SUCCESS"):
            failed_checks.append(name)
    if failed_checks:
        remediation_codes.append("checks_failed")
        remediation_reasons.append(
            f"Checks are not successful: {', '.join(sorted(set(failed_checks)))}"
        )

    rabbit_status = str(rabbit.get("status") or "MISSING").upper()
    if rabbit.get("actionableFindings") != 0:
        remediation_codes.append("coderabbit_findings")
        remediation_reasons.append("CodeRabbit has actionable findings")
    if rabbit_status in FAILED:
        remediation_codes.append("coderabbit_failed")
        remediation_reasons.append("CodeRabbit did not complete successfully")
    elif rabbit_status == "MISSING":
        return result(
            "BLOCK", head, ["coderabbit_missing"], ["CodeRabbit evidence is missing"]
        )

    if remediation_codes:
        return result("REMEDIATE", head, remediation_codes, remediation_reasons)
    if pending_checks or rabbit_status in PENDING:
        reasons = []
        if pending_checks:
            reasons.append(f"Checks pending: {', '.join(sorted(set(pending_checks)))}")
        if rabbit_status in PENDING:
            reasons.append("CodeRabbit is pending")
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
    if (
        merge.get("adminMergeAllowed") is True
        and merge.get("adminBypassOnly") is True
        and pr.get("mergeStateStatus") == "BLOCKED"
    ):
        return result(
            "MERGE",
            head,
            ["ready_admin"],
            ["Every gate is satisfied; admin merge is available"],
            "admin",
        )
    if merge.get("autoMergeAllowed") is True:
        return result(
            "AUTO_MERGE",
            head,
            ["ready_auto_merge"],
            ["Every gate is satisfied; immediate merge authority is unavailable"],
            "auto",
        )
    return result(
        "BLOCK",
        head,
        ["merge_authority_unavailable"],
        ["No permitted merge path is available"],
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
