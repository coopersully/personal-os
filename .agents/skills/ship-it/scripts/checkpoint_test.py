import tempfile
import subprocess
import sys
import time
import unittest
from pathlib import Path

from checkpoint import operate, locked


class CheckpointTest(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)

    def call(self, operation, payload=None, owner="task-a", key="repo/pull/1"):
        return operate(self.root, key, owner, operation, payload or {})

    def test_concurrent_writer_waits_then_preserves_existing_owner(self):
        script_dir = str(Path(__file__).resolve().parent)
        code = "from pathlib import Path; from checkpoint import operate; import sys; print('ready', flush=True); operate(Path(sys.argv[1]), 'repo/pull/1', 'task-b', 'claim', {})"
        self.call("claim")
        with locked(self.root):
            child = subprocess.Popen([sys.executable, "-c", code, str(self.root)], cwd=script_dir,
                                     stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            try:
                self.assertEqual(child.stdout.readline().strip(), "ready")
                time.sleep(.1)
                self.assertIsNone(child.poll())
            except BaseException:
                child.kill()
                child.communicate(timeout=5)
                raise
        _, errors = child.communicate(timeout=5)
        self.assertNotEqual(child.returncode, 0)
        self.assertIn("Another owner holds this claim", errors)
        self.assertEqual(self.call("read")["owner"], "task-a")

    def test_registry_wait_has_a_deadline(self):
        script_dir = str(Path(__file__).resolve().parent)
        code = "from pathlib import Path; from checkpoint import locked, RegistryBusyError; import sys\ntry:\n with locked(Path(sys.argv[1]), timeout=.05): pass\nexcept RegistryBusyError:\n sys.exit(75)"
        with locked(self.root):
            result = subprocess.run([sys.executable, "-c", code, str(self.root)], cwd=script_dir,
                                    capture_output=True, text=True, timeout=5)
        self.assertEqual(result.returncode, 75)
        self.assertEqual(result.stderr, "")

    def test_owner_survives_restart_and_cannot_be_stolen(self):
        self.call("claim")
        self.assertEqual(self.call("read")["owner"], "task-a")
        with self.assertRaises(ValueError):
            self.call("claim", owner="task-b")
        with self.assertRaises(ValueError):
            self.call("transfer", {"nextOwner": "task-b", "stoppedEvidence": "claimed-stopped"}, owner="task-b")

    def test_uncertain_merge_must_be_reconciled_before_any_retry(self):
        operation = {"id": "merge-1", "action": "merge", "headSha": "a", "baseSha": "b"}
        self.call("begin", operation)
        with self.assertRaises(ValueError):
            self.call("begin", operation)
        with self.assertRaises(ValueError):
            self.call("release")
        with self.assertRaises(ValueError):
            self.call("finish", {"id": "wrong", "evidence": "ref"})
        self.call("finish", {"id": "merge-1", "evidence": "github-merged-commit"})
        state = self.call("save", {"phase": "reconcile"})
        self.assertIsNone(state["pending"])
        self.assertEqual(state["lastOperation"]["action"], "merge")

    def test_transfer_preserves_pending_operation(self):
        self.call("begin", {"id": "push-1", "action": "push", "headSha": "a", "baseSha": "b"})
        record = self.call("transfer", {"nextOwner": "task-b", "stoppedEvidence": "host-task-stopped"})
        self.assertEqual(record["pending"]["id"], "push-1")
        self.assertEqual(record["owner"], "task-b")
        with self.assertRaises(ValueError):
            self.call("save", {"phase": "merge"})
        self.call("finish", {"id": "push-1", "evidence": "observed-remote"}, owner="task-b")

    def test_release_retains_checkpoint_and_base_claim_serializes_prs(self):
        self.call("save", {"phase": "wait", "nextTrigger": "CI completion"})
        self.call("release")
        self.assertEqual(self.call("claim", owner="task-b")["phase"], "wait")
        self.call("claim", key="repo#merge:main")
        with self.assertRaises(ValueError):
            self.call("claim", owner="other-pr", key="repo#merge:main")

    def test_wait_checkpoint_cannot_erase_pending_write(self):
        self.call("begin", {"id": "one", "action": "push", "headSha": "a", "baseSha": "b"})
        with self.assertRaises(ValueError):
            self.call("save", {"pending": None})
        with self.assertRaises(ValueError):
            self.call("save", {"phase": "complete"})


if __name__ == "__main__":
    unittest.main()
