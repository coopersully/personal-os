import tempfile
import unittest
from pathlib import Path

from checkpoint import operate


class CheckpointTest(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)

    def call(self, operation, payload=None, owner="task-a", key="repo/pull/1"):
        return operate(self.root, key, owner, operation, payload or {})

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
