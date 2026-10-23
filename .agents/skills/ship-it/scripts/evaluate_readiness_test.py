import sys
import copy
import json
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from evaluate_readiness import evaluate
from acceptance_test import acceptance_record, detailed_state

HEAD = "a" * 40
BASE = "b" * 40


def ready_state(**overrides):
    value = {
        "pr": {
            "state": "OPEN",
            "isDraft": False,
            "headSha": HEAD,
            "pushedHeadSha": HEAD,
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
            "equivalentChecks": {key: key for key in ("repository", "lint", "types-tests-coverage-builds", "browser")}})
        for name in state["verification"]["equivalentChecks"].values():
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
        coverage = {"repository": "Repository", "lint": "Lint", "types-tests-coverage-builds": "Node",
                    "browser": ["Browser desktop", "Browser mobile"]}
        state = ready_state(verification={"mode": "hosted", "pnpmVerify": "NOT_RUN",
            "equivalenceVerified": True, "localOnlyComplete": True, "equivalentChecks": coverage})
        for name in ["Repository", "Lint", "Node", "Browser desktop", "Browser mobile"]:
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
        state["verification"]["equivalentChecks"]["browser"] = ["Browser desktop", "Browser mobile"]
        state["ci"]["checks"].pop()
        self.assertEqual(evaluate(state)["decision"], "REMEDIATE")

    def test_hosted_shards_require_all_browser_members_and_node_quality(self):
        coverage = {"repository": "Repository contracts", "lint": "Lint and format",
                    "types-tests-coverage-builds": "Node quality",
                    "browser": [f"Browser acceptance ({project}, {i}/4)"
                                for project in ("desktop-chromium", "mobile-chromium") for i in range(1, 5)]}
        state = ready_state(verification={"mode": "hosted", "pnpmVerify": "NOT_RUN",
            "equivalenceVerified": True, "localOnlyComplete": True, "equivalentChecks": coverage})
        names = [name for value in coverage.values() for name in (value if isinstance(value, list) else [value])]
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


if __name__ == "__main__":
    unittest.main()
