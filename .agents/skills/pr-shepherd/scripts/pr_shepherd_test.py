import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from build_maintenance_plan import plan
from collect_pr_state import protected_path


def state(**overrides):
    value = {
        "state": "OPEN",
        "number": 1,
        "body": "## Overview\n## Why this change\n## What changed\n## Documentation\n## Verification\nCloses #1",
        "worktree": {"dirty": False},
        "statusCheckRollup": [],
        "changedPaths": ["apps/api/src/app.ts"],
        "missingBodySections": [],
        "mergeable": "MERGEABLE",
        "mergeStateStatus": "CLEAN",
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

    def test_audits_unlinked_nontrivial_pr(self):
        result = plan(
            state(body="## Overview\n## Why this change\n## What changed\n## Documentation\n## Verification", changedPaths=["a", "b", "c", "d"]),
            {"items": []},
        )
        self.assertEqual(result["nextAction"]["kind"], "AUDIT_TRACKER")

    def test_protected_paths(self):
        self.assertTrue(protected_path(".github/workflows/ci.yml"))
        self.assertTrue(protected_path("infra/compute.tf"))
        self.assertFalse(protected_path("apps/web/src/app.tsx"))


if __name__ == "__main__":
    unittest.main()
