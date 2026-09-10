import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent))

from build_maintenance_plan import plan
from collect_pr_state import collect, protected_path


def state(**overrides):
    value = {
        "state": "OPEN",
        "number": 1,
        "body": (
            "## Overview\n## Work map\n"
            "- Project: [Nohmi](https://linear.app/coopersully/project/nohmi-6799e74a853f) — work\n"
            "- Task: [COO-40](https://linear.app/coopersully/issue/COO-40/example) — work\n"
            "## Why this change\n## What changed\n## Documentation\n## Verification"
        ),
        "worktree": {"dirty": False},
        "statusCheckRollup": [],
        "changedPaths": ["apps/api/src/app.ts"],
        "missingBodySections": [],
        "mergeable": "MERGEABLE",
        "mergeStateStatus": "CLEAN",
        "linearCoverage": {
            "verified": True,
            "project": "Nohmi",
            "directIssueKeys": ["COO-40"],
            "structuredBacklinksComplete": True,
            "statusesCompatible": True,
        },
    }
    value.update(overrides)
    return value


class ShepherdTest(unittest.TestCase):
    def test_routes_feedback_before_ci(self):
        feedback = {"items": [{"kind": "review_thread", "isResolved": False}]}
        result = plan(state(statusCheckRollup=[{"conclusion": "FAILURE"}]), feedback)
        self.assertEqual(result["nextAction"]["kind"], "ADDRESS_FEEDBACK")

    def test_routes_failed_ci(self):
        result = plan(state(statusCheckRollup=[{"conclusion": "FAILURE"}]), {"items": []})
        self.assertEqual(result["nextAction"]["kind"], "FIX_CI")

    def test_waits_for_pending_checks(self):
        result = plan(state(statusCheckRollup=[{"status": "IN_PROGRESS"}]), {"items": []})
        self.assertEqual(result["nextAction"]["kind"], "WAIT")

    def test_audits_nontrivial_pr_without_linear_work_map(self):
        result = plan(
            state(
                body="## Overview\n## Why this change\n## What changed\n## Documentation\n## Verification\nCloses #1",
                changedPaths=["a", "b", "c", "d"],
            ),
            {"items": []},
        )
        self.assertEqual(result["nextAction"]["kind"], "AUDIT_TRACKER")

    def test_github_issue_reference_does_not_satisfy_linear_coverage(self):
        result = plan(state(body="Closes #1", changedPaths=["a", "b", "c", "d"]), {"items": []})
        self.assertEqual(result["nextAction"]["kind"], "AUDIT_TRACKER")

    def test_complete_linear_work_map_routes_to_review(self):
        result = plan(state(), {"items": []})
        self.assertEqual(result["nextAction"]["kind"], "LOCAL_REVIEW")

    def test_unverified_linear_coverage_routes_to_tracker_audit(self):
        result = plan(state(linearCoverage={"verified": False}), {"items": []})
        self.assertEqual(result["nextAction"]["kind"], "AUDIT_TRACKER")

    def test_invalid_tracker_coverage_precedes_nonterminal_actions(self):
        cases = {
            "feedback": (
                state(linearCoverage={"verified": False}),
                {"items": [{"kind": "review_thread", "isResolved": False}]},
            ),
            "failed CI": (
                state(
                    linearCoverage={"verified": False},
                    statusCheckRollup=[{"conclusion": "FAILURE"}],
                ),
                {"items": []},
            ),
            "conflict": (
                state(linearCoverage={"verified": False}, mergeable="CONFLICTING"),
                {"items": []},
            ),
            "pending CI": (
                state(
                    linearCoverage={"verified": False},
                    statusCheckRollup=[{"status": "IN_PROGRESS"}],
                ),
                {"items": []},
            ),
        }

        for name, (pr_state, feedback) in cases.items():
            with self.subTest(name=name):
                result = plan(pr_state, feedback)
                self.assertEqual(result["nextAction"]["kind"], "AUDIT_TRACKER")

    def test_wrong_linear_issue_routes_to_tracker_audit(self):
        result = plan(
            state(
                body=(
                    "## Overview\n## Work map\n"
                    "- Project: [Nohmi](https://linear.app/coopersully/project/nohmi-6799e74a853f) — work\n"
                    "- Task: [COO-999](https://linear.app/coopersully/issue/COO-999/example) — work\n"
                    "## Why this change\n## What changed\n## Documentation\n## Verification"
                )
            ),
            {"items": []},
        )
        self.assertEqual(result["nextAction"]["kind"], "AUDIT_TRACKER")

    def test_linear_rows_outside_work_map_do_not_count(self):
        result = plan(
            state(
                body=(
                    "## Overview\n## Work map\nNo mapped work\n## Why this change\n"
                    "- Project: [Nohmi](https://linear.app/coopersully/project/nohmi-6799e74a853f) — work\n"
                    "- Task: [COO-40](https://linear.app/coopersully/issue/COO-40/example) — work\n"
                    "## What changed\n## Documentation\n## Verification"
                )
            ),
            {"items": []},
        )
        self.assertEqual(result["nextAction"]["kind"], "AUDIT_TRACKER")

    def test_stale_backlink_or_status_routes_to_tracker_audit(self):
        for field in ("structuredBacklinksComplete", "statusesCompatible"):
            with self.subTest(field=field):
                coverage = dict(state()["linearCoverage"])
                coverage[field] = False
                result = plan(state(linearCoverage=coverage), {"items": []})
                self.assertEqual(result["nextAction"]["kind"], "AUDIT_TRACKER")

    def test_protected_paths(self):
        self.assertTrue(protected_path(".github/workflows/ci.yml"))
        self.assertTrue(protected_path("infra/compute.tf"))
        self.assertFalse(protected_path("apps/web/src/app.tsx"))

    @patch("collect_pr_state.run", return_value="")
    @patch("collect_pr_state.run_json")
    def test_collector_requires_work_map_section(self, run_json, _run):
        run_json.return_value = {
            "body": "## Overview\n## Why this change\n## What changed\n## Documentation\n## Verification",
            "files": [],
        }
        result = collect()
        self.assertIn("## Work map", result["missingBodySections"])
        self.assertEqual(result["linearCoverage"], {"verified": False})


if __name__ == "__main__":
    unittest.main()
