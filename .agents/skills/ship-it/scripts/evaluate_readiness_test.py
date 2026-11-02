import sys
import copy
import json
import unittest
import tempfile
import subprocess
import shutil
from unittest.mock import patch
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from evaluate_readiness import evaluate, FULL_COVERAGE, FULL_SOURCE_JOBS
from acceptance_test import acceptance_record, detailed_state

HEAD = "a" * 40
BASE = "b" * 40


def ready_state(**overrides):
    value = {
        "pr": {
            "number": 42,
            "repository": "owner/repo",
            "repositoryId": 1,
            "baseRef": "main",
            "bodySha256": "d" * 64,
            "state": "OPEN",
            "isDraft": False,
            "headSha": HEAD,
            "pushedHeadSha": HEAD,
            "mergeSha": HEAD,
            "baseSha": BASE,
            "mergeable": "MERGEABLE",
            "mergeStateStatus": "CLEAN",
        },
        "worktree": {"clean": True},
        "base": {
            "headSha": BASE,
            "evidenceHeadSha": HEAD,
            "headContainsBase": True,
        },
        "verification": {
            "headSha": HEAD,
            "focused": "SUCCESS",
            "pnpmVerify": "SUCCESS",
        },
        "ci": {
            "headSha": HEAD,
            "rulesVerified": True,
            "inventoryComplete": True,
            "selectedChecksVerified": True,
            "expectedRequiredChecks": ["CI required", "PR Work map"],
            "expectedSelectedChecks": [],
            "expectedCheckApps": {"CI required": 15368, "PR Work map": 15368},
            "checks": [
                {
                    "name": "CI required",
                    "headSha": HEAD,
                    "appId": 15368,
                    "status": "COMPLETED",
                    "conclusion": "SUCCESS",
                },
                {
                    "name": "PR Work map",
                    "headSha": HEAD,
                    "appId": 15368,
                    "status": "COMPLETED",
                    "conclusion": "SUCCESS",
                },
                {
                    "name": "CodeQL",
                    "headSha": HEAD,
                    "appId": 57789,
                    "status": "COMPLETED",
                    "conclusion": "NEUTRAL",
                    "required": False,
                },
            ],
        },
        "feedback": {
            "headSha": HEAD,
            "collectionComplete": True,
            "unresolvedActionable": 0,
            "unresolvedThreads": 0,
            "requiredApprovalsSatisfied": True,
            "approvalsCurrent": True,
        },
        "selfReview": {
            "headSha": HEAD,
            "complete": True,
            "newVerifiedFindings": 0,
        },
        "linear": {
            "headSha": HEAD,
            "verified": True,
            "paginationComplete": True,
            "project": "Nohmi",
            "directIssueKeys": ["COO-40"],
            "workMapIssueKeys": ["COO-40"],
            "structuredBacklinksComplete": True,
            "statusesCompatible": True,
        },
        "metadata": {"headSha": HEAD, "consistent": True},
        "merge": {
            "capabilitiesVerified": True,
            "serverGatesVerified": True,
            "normalMergeAllowed": True,
            "adminMergeAllowed": True,
            "adminBypassOnly": False,
            "autoMergeAllowed": True,
            "squashAllowed": True,
        },
    }
    scope = {key: key == "full" for key in "prose_only full repo terraform node database browser desktop containers dependencies".split()}
    scope["changed_packages"] = []
    identity = dict(headSha=HEAD, baseSha=BASE, number=42, repository="owner/repo", repositoryId=1,
                    baseRef="main", mergeSha=HEAD, forceFull=False, runId=13, runAttempt=1,
                    event="pull_request")
    value["ci"]["sourceObservation"] = dict(identity, schemaVersion=1, stable=True, state="success",
        bodySha256="d" * 64, workflowId=12,
        receipt=dict(identity, schemaVersion=1, scope=scope, workflowSha=HEAD,
                     workflowRef="owner/repo/.github/workflows/ci.yml@refs/pull/42/merge",
                     workflowSha256="e" * 64, classifierSha256="f" * 64),
        artifact=dict(id=1, digest="sha256:" + "e" * 64),
        jobs=[dict(id=i + 1, name=name, conclusion="success") for i, name in enumerate(FULL_SOURCE_JOBS)])
    value["acceptance"] = acceptance_record()
    value["reviewedProductionPlan"] = acceptance_record()["productionPlan"]
    value["evidence"] = {name: [f"bundle.json#{name}"] for name in
                         ("base", "verification", "ci", "feedback",
                          "selfReview", "linear", "metadata", "merge")}
    for key, override in overrides.items():
        if isinstance(override, dict) and isinstance(value.get(key), dict):
            value[key] = {**value[key], **override}
        else:
            value[key] = override
    return value


class EvaluateReadinessTest(unittest.TestCase):
    def test_regenerated_synthetic_identity_requires_complete_provider_commit_evidence(self):
        state = ready_state()
        observation = state["ci"]["sourceObservation"]
        live = "c" * 40
        state["pr"]["mergeSha"] = observation["mergeSha"] = live
        def commit(sha):
            return dict(sha=sha, treeSha="e" * 40, parentShas=[BASE, HEAD],
                        url=f"https://api.github.com/repos/owner/repo/git/commits/{sha}")
        observation["mergeCommitEvidence"] = dict(provider="github-rest", repository="owner/repo",
            sourceCommit=commit(HEAD), liveCommit=commit(live))
        self.assertNotIn("source_observation_unverified", evaluate(state)["reasonCodes"])
        changes = [
            lambda o: o.pop("mergeCommitEvidence"),
            lambda o: o.update(mergeCommitEvidence=True),
            lambda o: o["mergeCommitEvidence"].update(repository="foreign/repo"),
            lambda o: o["mergeCommitEvidence"]["sourceCommit"].update(sha=live),
            lambda o: o["mergeCommitEvidence"]["liveCommit"].update(treeSha="f" * 40),
            lambda o: o["mergeCommitEvidence"]["liveCommit"].update(parentShas=[HEAD, BASE]),
            lambda o: o["mergeCommitEvidence"]["sourceCommit"].update(parentShas=[BASE, HEAD, HEAD]),
            lambda o: o["mergeCommitEvidence"]["liveCommit"].update(url="https://example.com/commit"),
            lambda o: o["receipt"].update(workflowSha=live),
            lambda o: o.update(mergeSha=HEAD),
        ]
        for change in changes:
            invalid = copy.deepcopy(state)
            change(invalid["ci"]["sourceObservation"])
            self.assertIn("source_observation_unverified", evaluate(invalid)["reasonCodes"])

    def test_missing_stale_pending_or_foreign_source_observation_blocks_green_checks(self):
        for change in (
            lambda c: c.pop("sourceObservation"),
            lambda c: c["sourceObservation"].update(state="pending"),
            lambda c: c["sourceObservation"].update(number=99),
            lambda c: c["sourceObservation"].update(bodySha256="c" * 64),
            lambda c: c["sourceObservation"]["receipt"].update(runAttempt=2),
            lambda c: c["sourceObservation"]["jobs"].pop(),
            lambda c: c["sourceObservation"]["jobs"][0].update(conclusion="neutral"),
        ):
            state = ready_state()
            change(state["ci"])
            self.assertIn("source_observation_unverified", evaluate(state)["reasonCodes"])

    def test_exact_frozen_detailed_plan_preserves_all_readiness_gates(self):
        detailed = detailed_state()
        state = ready_state()
        original_head = state['pr']['headSha']
        original_base = state['pr']['baseSha']
        # Bind every existing readiness receipt to the frozen candidate.
        serialized = json.dumps(state).replace(original_head, detailed['pr']['headSha']).replace(original_base, detailed['pr']['baseSha'])
        state = json.loads(serialized)
        state['acceptance'] = detailed['acceptance']
        state['reviewedProductionPlan'] = detailed['reviewedProductionPlan']
        before = copy.deepcopy(state)
        self.assertEqual(evaluate(state)['decision'], 'MERGE')
        self.assertEqual(state, before)
        state['acceptance']['reviewers'] = state['acceptance']['implementers']
        self.assertEqual(evaluate(state)['decision'], 'BLOCK')

    def test_missing_independent_acceptance_cannot_merge(self):
        state = ready_state()
        del state['acceptance']
        self.assertEqual(evaluate(state)['decision'], 'BLOCK')


    def test_hosted_equivalence_requires_every_gate_and_diagnosed_local_failure(self):
        state = ready_state(verification={"mode": "hosted", "pnpmVerify": "FAILURE",
            "equivalenceVerified": True, "localOnlyComplete": True,
            "equivalentChecks": copy.deepcopy(FULL_COVERAGE)})
        for name in FULL_SOURCE_JOBS:
            state["ci"]["expectedSelectedChecks"].append(name)
            state["ci"]["expectedCheckApps"][name] = 15368
            state["ci"]["checks"].append(dict(state["ci"]["checks"][0], name=name))
        self.assertEqual(evaluate(state)["decision"], "REMEDIATE")
        state["verification"]["pnpmVerify"] = "NOT_RUN"
        self.assertEqual(evaluate(state)["decision"], "MERGE")
        original = state["verification"]["equivalentChecks"]
        state["verification"]["equivalentChecks"] = {key: "CI required" for key in original}
        self.assertEqual(evaluate(state)["decision"], "REMEDIATE")
        state["verification"]["equivalentChecks"] = original
        state["verification"]["pnpmVerify"] = "FAILURE"
        state["verification"]["localFailures"] = [{"classification": "unknown"}]
        self.assertEqual(evaluate(state)["decision"], "REMEDIATE")
        state["verification"]["localFailures"] = [{"classification": "environment", "evidence": "isolated-log", "focusedReproduction": "SUCCESS"}]
        self.assertEqual(evaluate(state)["decision"], "MERGE")
        state["ci"]["checks"][-1]["conclusion"] = "FAILURE"
        self.assertEqual(evaluate(state)["decision"], "REMEDIATE")

    def test_hosted_matrix_requires_each_distinct_successful_member(self):
        coverage = copy.deepcopy(FULL_COVERAGE)
        state = ready_state(verification={"mode": "hosted", "pnpmVerify": "NOT_RUN",
            "equivalenceVerified": True, "localOnlyComplete": True, "equivalentChecks": coverage})
        for name in FULL_SOURCE_JOBS:
            state["ci"]["expectedSelectedChecks"].append(name)
            state["ci"]["expectedCheckApps"][name] = 15368
            state["ci"]["checks"].append(dict(state["ci"]["checks"][0], name=name))
        self.assertEqual(evaluate(state)["decision"], "MERGE")
        state["ci"]["checks"][-1]["conclusion"] = "FAILURE"
        self.assertEqual(evaluate(state)["decision"], "REMEDIATE")
        state["ci"]["checks"][-1]["conclusion"] = "SUCCESS"
        for invalid in [[], ["Browser desktop", "Lint"], ["Browser desktop", "Browser desktop"], [None]]:
            state["verification"]["equivalentChecks"]["browser"] = invalid
            self.assertEqual(evaluate(state)["decision"], "REMEDIATE")
        state["verification"]["equivalentChecks"]["browser"] = copy.deepcopy(FULL_COVERAGE["browser"])
        state["ci"]["checks"].pop()
        self.assertEqual(evaluate(state)["decision"], "REMEDIATE")

    def test_hosted_requires_current_macos_job_not_retired_runner(self):
        state = ready_state(verification={"mode": "hosted", "pnpmVerify": "NOT_RUN",
            "equivalenceVerified": True, "localOnlyComplete": True,
            "equivalentChecks": copy.deepcopy(FULL_COVERAGE)})
        for name in FULL_SOURCE_JOBS:
            state["ci"]["expectedSelectedChecks"].append(name)
            state["ci"]["expectedCheckApps"][name] = 15368
            state["ci"]["checks"].append(dict(state["ci"]["checks"][0], name=name))
        self.assertEqual(evaluate(state)["decision"], "MERGE")
        macos = next(check for check in state["ci"]["checks"]
                     if check["name"] == "Desktop (macos-15)")
        macos["name"] = "Desktop (macos-14)"
        self.assertNotEqual(evaluate(state)["decision"], "MERGE")

    def test_hosted_shards_require_all_browser_members_and_node_quality(self):
        coverage = {"repository": "Repository contracts", "lint": "Lint and format",
                    "types-tests-coverage-builds": "Node quality",
                    "browser": [f"Browser acceptance ({project}, {i}/4)"
                                for project in ("desktop-chromium", "mobile-chromium") for i in range(1, 5)]}
        state = ready_state(verification={"mode": "hosted", "pnpmVerify": "NOT_RUN",
            "equivalenceVerified": True, "localOnlyComplete": True, "equivalentChecks": coverage})
        names = FULL_SOURCE_JOBS
        for name in names:
            state["ci"]["expectedSelectedChecks"].append(name)
            state["ci"]["expectedCheckApps"][name] = 15368
            state["ci"]["checks"].append(dict(state["ci"]["checks"][0], name=name))
        self.assertEqual(evaluate(state)["decision"], "MERGE")
        for name in names:
            check = next(check for check in state["ci"]["checks"] if check["name"] == name)
            for conclusion in ("FAILURE", "CANCELLED", "SKIPPED"):
                check["conclusion"] = conclusion
                self.assertNotEqual(evaluate(state)["decision"], "MERGE", (name, conclusion))
            check["conclusion"] = "SUCCESS"
            state["ci"]["checks"].remove(check)
            self.assertNotEqual(evaluate(state)["decision"], "MERGE", name)
            state["ci"]["checks"].append(check)

    def test_full_hosted_inventory_cannot_omit_member_from_both_claims(self):
        for missing in FULL_SOURCE_JOBS:
            state = ready_state(verification={"mode": "hosted", "pnpmVerify": "NOT_RUN",
                "equivalenceVerified": True, "localOnlyComplete": True,
                "equivalentChecks": copy.deepcopy(FULL_COVERAGE)})
            for name in FULL_SOURCE_JOBS:
                if name == missing: continue
                state["ci"]["expectedSelectedChecks"].append(name)
                state["ci"]["expectedCheckApps"][name] = 15368
                state["ci"]["checks"].append(dict(state["ci"]["checks"][0], name=name))
            if missing in state["verification"]["equivalentChecks"]["browser"]:
                state["verification"]["equivalentChecks"]["browser"].remove(missing)
            self.assertIn("verification_incomplete", evaluate(state)["reasonCodes"], missing)

    def test_selected_job_must_exist_and_succeed_with_expected_provider(self):
        state = ready_state()
        state["ci"]["expectedSelectedChecks"] = ["Browser acceptance"]
        state["ci"]["expectedCheckApps"]["Browser acceptance"] = 15368
        self.assertEqual(evaluate(state)["decision"], "REMEDIATE")
        job = dict(state["ci"]["checks"][0], name="Browser acceptance", conclusion="SKIPPED")
        state["ci"]["checks"].append(job)
        self.assertEqual(evaluate(state)["decision"], "REMEDIATE")
        job["conclusion"] = "SUCCESS"
        self.assertEqual(evaluate(state)["decision"], "MERGE")
        job["appId"] = 1
        self.assertEqual(evaluate(state)["decision"], "BLOCK")

    def test_evidence_references_and_selected_scope_are_required(self):
        for state in (ready_state(evidence={"ci": []}),
                      ready_state(ci={"selectedChecksVerified": False})):
            self.assertEqual(evaluate(state)["decision"], "BLOCK")

    def test_unknown_ci_status_or_conclusion_never_merges(self):
        for field, value in (("status", "UNKNOWN"), ("conclusion", "UNKNOWN")):
            state = ready_state()
            state["ci"]["checks"][2][field] = value
            self.assertNotEqual(evaluate(state)["decision"], "MERGE")

    def test_prefers_normal_squash_merge_when_every_gate_is_current(self):
        result = evaluate(ready_state())
        self.assertEqual(result["decision"], "MERGE")
        self.assertEqual(result["mergeMode"], "normal")

    def test_never_uses_admin_or_deferred_auto_merge(self):
        for status in ("BLOCKED", "CLEAN"):
            state = ready_state(
                pr={"mergeStateStatus": status},
                merge={"normalMergeAllowed": False, "adminBypassOnly": True},
            )
            self.assertEqual(evaluate(state)["decision"], "BLOCK")

    def test_never_treats_github_blocked_as_normal_merge_ready(self):
        self.assertEqual(evaluate(ready_state(pr={"mergeStateStatus": "BLOCKED"}))["decision"], "BLOCK")

    def test_requires_server_enforced_gates(self):
        self.assertEqual(evaluate(ready_state(merge={"serverGatesVerified": False}))["decision"], "BLOCK")

    def test_optional_bot_status_never_replaces_independent_review(self):
        for status in ("PENDING", "MISSING", "SKIPPED", "NEUTRAL", "FAILURE", "UNRECOGNIZED"):
            state = ready_state(codeRabbit={"status": status, "coverageVerified": False})
            self.assertEqual(evaluate(state)["decision"], "MERGE")
            state["acceptance"]["reviewers"] = state["acceptance"]["implementers"]
            self.assertEqual(evaluate(state)["decision"], "BLOCK")

    def test_bot_check_required_by_github_still_blocks(self):
        state = ready_state()
        state["ci"]["expectedRequiredChecks"].append("CodeRabbit")
        state["ci"]["expectedCheckApps"]["CodeRabbit"] = 12345
        self.assertEqual(evaluate(state)["decision"], "REMEDIATE")
        state["ci"]["checks"].append({"name": "CodeRabbit", "appId": 12345,
            "headSha": HEAD, "status": "IN_PROGRESS", "conclusion": ""})
        self.assertEqual(evaluate(state)["decision"], "WAIT")
        state["ci"]["checks"][-1].update(status="COMPLETED", conclusion="FAILURE")
        self.assertEqual(evaluate(state)["decision"], "REMEDIATE")

    def test_every_thread_must_be_resolved(self):
        for count in (None, 1, -1, False):
            self.assertNotEqual(evaluate(ready_state(feedback={"unresolvedThreads": count}))["decision"], "MERGE")

    def test_missing_approval_waits(self):
        state = ready_state(feedback={"requiredApprovalsSatisfied": False})
        self.assertEqual(evaluate(state)["decision"], "WAIT")

    def test_latest_attempt_supersedes_failure_but_pending_still_waits(self):
        state = ready_state()
        old = state["ci"]["checks"][0]
        old.update(workflowId=12, runId=23, runAttempt=1, event="pull_request", conclusion="FAILURE")
        latest = dict(old, runAttempt=2, conclusion="SUCCESS")
        state["ci"]["checks"].append(latest)
        self.assertEqual(evaluate(state)["decision"], "MERGE")
        latest.update(status="IN_PROGRESS", conclusion="")
        self.assertEqual(evaluate(state)["decision"], "WAIT")
        latest.update(event="push", status="COMPLETED", conclusion="SUCCESS")
        self.assertNotEqual(evaluate(state)["decision"], "MERGE")

    def test_blocks_when_squash_or_every_merge_path_is_unavailable(self):
        for merge in (
            {"squashAllowed": False},
            {
                "normalMergeAllowed": False,
                "adminMergeAllowed": False,
                "autoMergeAllowed": False,
            },
        ):
            with self.subTest(merge=merge):
                self.assertEqual(
                    evaluate(ready_state(merge=merge))["decision"], "BLOCK"
                )

    def test_blocks_for_dirty_or_ambiguous_target_state(self):
        cases = (
            ready_state(worktree={"clean": False}),
            ready_state(pr={"state": "CLOSED"}),
            ready_state(pr={"headSha": ""}),
            ready_state(pr={"isDraft": None}),
            ready_state(pr={"isDraft": 0}),
            ready_state(pr={"mergeStateStatus": None}),
            ready_state(pr={"mergeStateStatus": "NOT_A_GITHUB_STATE"}),
        )
        for state in cases:
            with self.subTest(state=state):
                self.assertEqual(evaluate(state)["decision"], "BLOCK")

    def test_remediates_draft_unpushed_conflicting_or_stale_base(self):
        cases = (
            ready_state(pr={"isDraft": True}),
            ready_state(pr={"pushedHeadSha": "c" * 40}),
            ready_state(pr={"mergeable": "CONFLICTING"}),
            ready_state(pr={"mergeStateStatus": "BEHIND"}),
            ready_state(base={"headContainsBase": False}),
            ready_state(base={"headSha": "c" * 40}),
        )
        for state in cases:
            with self.subTest(state=state):
                self.assertEqual(evaluate(state)["decision"], "REMEDIATE")

    def test_waits_for_pending_ci(self):
        pending_ci = ready_state()
        pending_ci["ci"]["checks"][0]["status"] = "IN_PROGRESS"
        pending_ci["ci"]["checks"][0]["conclusion"] = ""
        self.assertEqual(evaluate(pending_ci)["decision"], "WAIT")

    def test_waits_when_a_completed_named_check_has_no_conclusion(self):
        state = ready_state()
        state["ci"]["checks"][2]["conclusion"] = ""
        self.assertEqual(evaluate(state)["decision"], "WAIT")

    def test_remediates_failed_or_missing_required_checks(self):
        failed = ready_state()
        failed["ci"]["checks"][0]["conclusion"] = "FAILURE"
        missing = ready_state()
        missing["ci"]["checks"] = missing["ci"]["checks"][1:]
        self.assertEqual(evaluate(failed)["decision"], "REMEDIATE")
        self.assertEqual(evaluate(missing)["decision"], "REMEDIATE")

    def test_blocks_when_live_rules_or_required_check_set_are_unverified(self):
        cases = (
            ready_state(ci={"rulesVerified": False}),
            ready_state(ci={"inventoryComplete": False}),
            ready_state(ci={"expectedRequiredChecks": []}),
        )
        for state in cases:
            with self.subTest(state=state):
                self.assertEqual(evaluate(state)["decision"], "BLOCK")

    def test_rejects_same_named_required_check_from_wrong_app_or_head(self):
        for field, value in (("appId", 999), ("headSha", "c" * 40)):
            state = ready_state()
            state["ci"]["checks"][0][field] = value
            with self.subTest(field=field):
                self.assertEqual(evaluate(state)["decision"], "BLOCK")

    def test_rejects_missing_or_non_numeric_required_check_provider_identity(self):
        for app_id in (None, True, 0, "15368"):
            state = ready_state()
            state["ci"]["expectedCheckApps"]["CI required"] = app_id
            state["ci"]["checks"][0]["appId"] = app_id
            with self.subTest(app_id=app_id):
                self.assertEqual(evaluate(state)["decision"], "BLOCK")

    def test_blocks_when_collection_or_capability_provenance_is_unverified(self):
        cases = (
            ready_state(feedback={"collectionComplete": False}),
            ready_state(merge={"capabilitiesVerified": False}),
        )
        for state in cases:
            with self.subTest(state=state):
                self.assertEqual(evaluate(state)["decision"], "BLOCK")

    def test_neutral_or_skipped_required_check_never_counts_as_green(self):
        for conclusion in ("NEUTRAL", "SKIPPED"):
            state = ready_state()
            state["ci"]["checks"][0]["conclusion"] = conclusion
            with self.subTest(conclusion=conclusion):
                self.assertEqual(evaluate(state)["decision"], "REMEDIATE")

    def test_remediates_feedback_or_self_review_findings(self):
        cases = (
            ready_state(feedback={"unresolvedActionable": 1}),
            ready_state(selfReview={"newVerifiedFindings": 1}),
            ready_state(selfReview={"complete": False}),
        )
        for state in cases:
            with self.subTest(state=state):
                self.assertEqual(evaluate(state)["decision"], "REMEDIATE")

    def test_fails_closed_for_wrong_or_unverified_linear_coverage(self):
        blocked = (
            ready_state(linear={"project": "Portfolio"}),
            ready_state(linear={"verified": False}),
            ready_state(linear={"paginationComplete": False}),
        )
        for state in blocked:
            with self.subTest(state=state):
                self.assertEqual(evaluate(state)["decision"], "BLOCK")

        remediable = (
            ready_state(linear={"structuredBacklinksComplete": False}),
            ready_state(linear={"statusesCompatible": False}),
            ready_state(linear={"workMapIssueKeys": ["COO-999"]}),
            ready_state(linear={"directIssueKeys": []}),
        )
        for state in remediable:
            with self.subTest(state=state):
                self.assertEqual(evaluate(state)["decision"], "REMEDIATE")

    def test_rejects_evidence_from_any_other_head(self):
        for section in (
            "base",
            "verification",
            "ci",
            "feedback",
            "selfReview",
            "linear",
            "metadata",
        ):
            state = ready_state()
            field = "evidenceHeadSha" if section == "base" else "headSha"
            state[section][field] = "c" * 40
            with self.subTest(section=section):
                result = evaluate(state)
                self.assertEqual(result["decision"], "REMEDIATE")
                self.assertIn("stale_evidence", result["reasonCodes"])


class ProseReadinessTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.git("init")
        self.git("config", "user.name", "Fixture")
        self.git("config", "user.email", "fixture@example.invalid")
        target = self.root / ".github/scripts/ci-scope.mjs"
        target.parent.mkdir(parents=True)
        shutil.copyfile(Path(__file__).resolve().parents[4] / ".github/scripts/ci-scope.mjs", target)
        doc = self.root / "docs/engineering/example.md"
        doc.parent.mkdir(parents=True)
        doc.write_text("Before\n")
        self.base = self.commit()
        doc.write_text("After\n")
        self.head = self.commit()
        self.state = ready_state()
        # Bind every existing acceptance/evidence identity to this real fixture.
        self.state = json.loads(json.dumps(self.state).replace(HEAD, self.head).replace(BASE, self.base))
        scope = json.loads(subprocess.check_output(["node", str(target), "--base", self.base,
                                                   "--head", self.head, "--json"], text=True))
        source = dict(headSha=self.head, baseSha=self.base, workflowId=12, runId=13,
                      runAttempt=1, event="pull_request")
        self.state["verification"] = dict(headSha=self.head, baseSha=self.base, focused="SUCCESS",
                                          mode="prose", scope=scope, sourceRun=source)
        for name in ["Classify changes", "Repository contracts", "Source verification"]:
            self.state["ci"]["expectedSelectedChecks"].append(name)
            self.state["ci"]["expectedCheckApps"][name] = 15368
            self.state["ci"]["checks"].append(dict(source, name=name, appId=15368,
                                                   status="COMPLETED", conclusion="SUCCESS"))
        self.location = patch("evaluate_readiness.__file__", str(self.root / ".agents/skills/ship-it/scripts/evaluate_readiness.py"))
        self.location.start()
        self.addCleanup(self.location.stop)

    def git(self, *args):
        return subprocess.check_output(["git", *args], cwd=self.root, stderr=subprocess.DEVNULL, text=True).strip()

    def commit(self):
        self.git("add", "-A")
        self.git("commit", "-m", "Fixture")
        return self.git("rev-parse", "HEAD")

    def test_real_git_prose_candidate_can_complete_readiness(self):
        self.assertEqual(evaluate(self.state)["decision"], "MERGE")

    def test_forged_scope_or_mismatched_source_identity_fails(self):
        for key, value in [("baseSha", HEAD), ("runId", 99), ("event", "push")]:
            with self.subTest(key=key):
                state = copy.deepcopy(self.state)
                state["verification"]["sourceRun"][key] = value
                self.assertIn("verification_incomplete", evaluate(state)["reasonCodes"])
        self.state["verification"]["scope"]["node"] = True
        self.assertIn("verification_incomplete", evaluate(self.state)["reasonCodes"])

    def test_absent_skipped_or_wrong_provider_selected_job_fails(self):
        for mutation in ["absent", "skipped", "provider"]:
            with self.subTest(mutation=mutation):
                state = copy.deepcopy(self.state)
                check = state["ci"]["checks"][-1]
                if mutation == "absent": state["ci"]["checks"].pop()
                elif mutation == "skipped": check["conclusion"] = "SKIPPED"
                else: check["appId"] = 1
                self.assertNotEqual(evaluate(state)["decision"], "MERGE")

    def test_dirty_classifier_is_not_candidate_bound_proof(self):
        script = self.root / ".github/scripts/ci-scope.mjs"
        script.write_text("console.log(" + json.dumps(json.dumps(self.state["verification"]["scope"])) + ")")
        self.assertIn("verification_incomplete", evaluate(self.state)["reasonCodes"])

    def test_stale_checkout_and_nonprose_candidate_fail_closed(self):
        (self.root / "runtime.ts").write_text("changed")
        self.commit()
        self.assertIn("verification_incomplete", evaluate(self.state)["reasonCodes"])
        # Rebind claimed identities while retaining the old prose receipt.
        head = self.git("rev-parse", "HEAD")
        state = json.loads(json.dumps(self.state).replace(self.head, head))
        self.assertIn("verification_incomplete", evaluate(state)["reasonCodes"])


if __name__ == "__main__":
    unittest.main()
