import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from evaluate_readiness import evaluate

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
            "expectedRequiredChecks": ["CI required", "PR Work map"],
            "expectedRequiredCheckApps": {"CI required": 15368, "PR Work map": 15368},
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
        "codeRabbit": {
            "headSha": HEAD,
            "status": "SUCCESS",
            "actionableFindings": 0,
            "coverageVerified": True,
        },
        "feedback": {
            "headSha": HEAD,
            "collectionComplete": True,
            "unresolvedActionable": 0,
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
            "normalMergeAllowed": True,
            "adminMergeAllowed": True,
            "adminBypassOnly": False,
            "autoMergeAllowed": True,
            "squashAllowed": True,
        },
    }
    for key, override in overrides.items():
        if isinstance(override, dict) and isinstance(value.get(key), dict):
            value[key] = {**value[key], **override}
        else:
            value[key] = override
    return value


class EvaluateReadinessTest(unittest.TestCase):
    def test_prefers_normal_squash_merge_when_every_gate_is_current(self):
        result = evaluate(ready_state())
        self.assertEqual(result["decision"], "MERGE")
        self.assertEqual(result["mergeMode"], "normal")

    def test_uses_admin_only_when_normal_merge_is_unavailable(self):
        result = evaluate(
            ready_state(
                pr={"mergeStateStatus": "BLOCKED"},
                merge={"normalMergeAllowed": False, "adminBypassOnly": True},
            )
        )
        self.assertEqual(result["decision"], "MERGE")
        self.assertEqual(result["mergeMode"], "admin")

    def test_never_uses_admin_without_proving_the_only_block_is_bypassable(self):
        result = evaluate(ready_state(merge={"normalMergeAllowed": False}))
        self.assertEqual(result["decision"], "AUTO_MERGE")
        self.assertEqual(result["mergeMode"], "auto")

    def test_never_treats_github_blocked_as_normal_merge_ready(self):
        result = evaluate(ready_state(pr={"mergeStateStatus": "BLOCKED"}))
        self.assertEqual(result["decision"], "BLOCK")

    def test_uses_auto_merge_without_normal_or_admin_authority(self):
        result = evaluate(
            ready_state(
                merge={
                    "normalMergeAllowed": False,
                    "adminMergeAllowed": False,
                    "autoMergeAllowed": True,
                }
            )
        )
        self.assertEqual(result["decision"], "AUTO_MERGE")
        self.assertEqual(result["mergeMode"], "auto")

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

    def test_waits_for_pending_ci_or_coderabbit(self):
        pending_ci = ready_state()
        pending_ci["ci"]["checks"][0]["status"] = "IN_PROGRESS"
        pending_ci["ci"]["checks"][0]["conclusion"] = ""
        pending_rabbit = ready_state(codeRabbit={"status": "PENDING"})
        self.assertEqual(evaluate(pending_ci)["decision"], "WAIT")
        self.assertEqual(evaluate(pending_rabbit)["decision"], "WAIT")

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
            state["ci"]["expectedRequiredCheckApps"]["CI required"] = app_id
            state["ci"]["checks"][0]["appId"] = app_id
            with self.subTest(app_id=app_id):
                self.assertEqual(evaluate(state)["decision"], "BLOCK")

    def test_blocks_when_collection_or_capability_provenance_is_unverified(self):
        cases = (
            ready_state(feedback={"collectionComplete": False}),
            ready_state(codeRabbit={"coverageVerified": False}),
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

    def test_remediates_coderabbit_findings_feedback_or_self_review_findings(self):
        cases = (
            ready_state(codeRabbit={"actionableFindings": 1}),
            ready_state(feedback={"unresolvedActionable": 1}),
            ready_state(feedback={"requiredApprovalsSatisfied": False}),
            ready_state(feedback={"approvalsCurrent": False}),
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
            "codeRabbit",
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
