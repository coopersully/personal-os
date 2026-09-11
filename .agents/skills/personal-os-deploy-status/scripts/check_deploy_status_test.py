import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from check_deploy_status import verdict

HEALTHY = {"app": {"ok": True}, "api": {"ok": True}, "mcp": {"ok": True}}


class DeployStatusTest(unittest.TestCase):
    def test_live(self):
        runs = [{"headSha": "abc", "status": "completed", "conclusion": "success"}]
        self.assertEqual(verdict("abc", runs, {"deployed": "abc", "phase": "idle"}, HEALTHY), "live")

    def test_not_live(self):
        runs = [{"headSha": "abc", "status": "completed", "conclusion": "success"}]
        self.assertEqual(verdict("abc", runs, {"deployed": "old", "phase": "idle"}, HEALTHY), "not_live")

    def test_unhealthy_overrides_other_evidence(self):
        endpoints = {**HEALTHY, "api": {"ok": False}}
        runs = [{"headSha": "abc", "status": "completed", "conclusion": "success"}]
        self.assertEqual(verdict("abc", runs, {"deployed": "abc"}, endpoints), "unhealthy")

    def test_in_progress(self):
        runs = [{"headSha": "abc", "status": "in_progress"}]
        self.assertEqual(verdict("abc", runs, {"deployed": "old"}, HEALTHY), "in_progress")

    def test_controller_switch_is_in_progress(self):
        runs = [{"headSha": "abc", "status": "completed", "conclusion": "success"}]
        controller = {"deployed": "old", "candidate": "abc", "phase": "switching"}
        self.assertEqual(verdict("abc", runs, controller, HEALTHY), "in_progress")

    def test_ci_failed(self):
        runs = [{"headSha": "abc", "status": "completed", "conclusion": "failure"}]
        self.assertEqual(verdict("abc", runs, {"deployed": "old"}, HEALTHY), "ci_failed")

    def test_controller_blocked(self):
        runs = [{"headSha": "abc", "status": "completed", "conclusion": "success"}]
        controller = {"phase": "blocked", "error": "switch-failed"}
        self.assertEqual(verdict("abc", runs, controller, HEALTHY), "controller_blocked")

    def test_recoverable_controller_error_is_retrying(self):
        runs = [{"headSha": "abc", "status": "completed", "conclusion": "success"}]
        controller = {"deployed": "old", "phase": "idle", "error": "prepare-failed"}
        self.assertEqual(verdict("abc", runs, controller, HEALTHY), "controller_retrying")

    def test_maintenance(self):
        runs = [{"headSha": "abc", "status": "completed", "conclusion": "success"}]
        self.assertEqual(verdict("abc", runs, {"maintenance": True}, HEALTHY), "maintenance")

    def test_healthy_revision_unknown_off_host(self):
        runs = [{"headSha": "abc", "status": "completed", "conclusion": "success"}]
        self.assertEqual(
            verdict("abc", runs, {"collectionError": "not available"}, HEALTHY),
            "healthy_revision_unknown",
        )


if __name__ == "__main__":
    unittest.main()
