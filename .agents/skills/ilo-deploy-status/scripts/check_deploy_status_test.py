import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from check_deploy_status import verdict

HEALTHY = {"app": {"ok": True}, "api": {"ok": True}, "mcp": {"ok": True}}


class DeployStatusTest(unittest.TestCase):
    def test_live(self):
        self.assertEqual(verdict("abc", {"state": "success", "sha": "abc"}, [], HEALTHY), "live")

    def test_not_live(self):
        self.assertEqual(verdict("abc", {"state": "success", "sha": "old"}, [], HEALTHY), "not_live")

    def test_unhealthy_overrides_workflow(self):
        endpoints = {**HEALTHY, "api": {"ok": False}}
        self.assertEqual(verdict("abc", {"state": "success", "sha": "abc"}, [], endpoints), "unhealthy")

    def test_in_progress(self):
        runs = [{"status": "in_progress"}]
        self.assertEqual(verdict("abc", {}, runs, HEALTHY), "in_progress")


if __name__ == "__main__":
    unittest.main()
