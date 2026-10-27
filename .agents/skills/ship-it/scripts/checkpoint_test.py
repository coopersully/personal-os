import tempfile
import base64
import copy
import hashlib
import json
import os
import subprocess
import sys
import time
import unittest
from unittest.mock import patch
from pathlib import Path

from checkpoint import operate, locked


class CheckpointTest(unittest.TestCase):
    policy_version = int((Path(__file__).resolve().parents[1] / "VERSION").read_text().strip())
    recovery_key = "https://github.com/owner/repo/pull/1"

    @staticmethod
    def digest(value):
        return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":")).encode()).hexdigest()

    def recovery_fixture(self):
        evidence = self.root / "accepted-plan.txt"
        evidence.write_bytes(b"independently accepted original plan\n")
        plan = {"required": False, "owner": "task-a", "criteria": [],
                "reason": "nonruntime distribution", "evidence": [str(evidence)]}
        self.call("save", {"phase": "final_check", "headSha": "a" * 40, "baseSha": "b" * 40,
                           "policyVersion": 6, "acceptanceRevision": 4,
                           "reviewedProductionPlan": plan}, key=self.recovery_key)
        record = self.call("save", {"phase": "repair"}, key=self.recovery_key)
        payload = {"expectedCheckpointDigest": self.digest(record), "expectedPlanDigest": self.digest(plan),
                   "expectedHeadSha": record["headSha"], "expectedBaseSha": record["baseSha"],
                   "headSha": "c" * 40, "baseSha": "b" * 40, "policyVersion": self.policy_version, "acceptanceRevision": 4,
                   "reviewedProductionPlan": {**plan, "reason": "reviewed corrective distribution"},
                   "livePr": {"url": self.recovery_key, "number": 1, "state": "OPEN", "merged": False,
                              "headSha": "c" * 40, "baseSha": "b" * 40, "evidence": ["live-pr.json"]},
                   "reason": "new verified correction", "authorityEvidence": ["lead-release.json"],
                   "reviewEvidence": ["independent-plan-review.json"], "implementers": ["worker"],
                   "reviewers": ["reviewer"], "predecessorEvidenceBinding": ["original-freeze-review.json"],
                   "expectedEvidenceFiles": {str(evidence): hashlib.sha256(evidence.read_bytes()).hexdigest()}}
        return record, payload, evidence

    def reject_recovery_unchanged(self, payload, **kwargs):
        snapshot = {p.name: p.read_bytes() for p in self.root.iterdir() if p.is_file() and p.name != "registry.lock"}
        with self.assertRaises(ValueError):
            self.call("recover-plan", payload, key=self.recovery_key, **kwargs)
        self.assertEqual(snapshot, {p.name: p.read_bytes() for p in self.root.iterdir()
                                    if p.is_file() and p.name != "registry.lock"})

    def detailed_recovery_fixture(self):
        old, payload, evidence = self.recovery_fixture()
        plan = {"required": True, "owner": "Finance parent; task-a",
                "candidateHead": old["headSha"], "candidateBase": old["baseSha"],
                "premerge_evidence": [str(evidence)],
                "criteria": [{"id": f"FA-P{index:02d}", "action": "observe actual delivery",
                              "result": "pending_post_merge",
                              "evidence": str(self.root / "future" / f"FA-P{index:02d}.json")}
                             for index in range(1, 9)]}
        old["reviewedProductionPlan"] = plan
        path = self.root / (hashlib.sha256(self.recovery_key.encode()).hexdigest() + ".json")
        path.write_text(json.dumps(old))  # Only this test's private fixture registry.
        payload.update(expectedCheckpointDigest=self.digest(old), expectedPlanDigest=self.digest(plan),
                       reviewedProductionPlan={**copy.deepcopy(plan), "owner": "task-a",
                                               "candidateHead": payload["headSha"]})
        return old, payload, evidence

    def test_detailed_recovery_retains_premerge_bytes_not_future_outputs(self):
        old, payload, evidence = self.detailed_recovery_fixture()
        original = copy.deepcopy(old)
        request = copy.deepcopy(payload)
        result = self.call("recover-plan", payload, key=self.recovery_key)
        entry = result["recoveryHistory"][0]
        self.assertEqual(entry["predecessor"], original)
        self.assertEqual(entry["predecessor"]["policyVersion"], 6)
        self.assertEqual(result["policyVersion"], self.policy_version)
        self.assertEqual(entry["predecessorDigest"], self.digest(original))
        self.assertEqual(entry["request"], request)
        self.assertEqual(payload, request)
        self.assertEqual(old, original)
        self.assertEqual(entry["retainedEvidence"], [{"path": str(evidence),
                         "sha256": request["expectedEvidenceFiles"][str(evidence)],
                         "encoding": "base64", "bytes": base64.b64encode(evidence.read_bytes()).decode()}])
        self.assertEqual(result["reviewedProductionPlan"], request["reviewedProductionPlan"])
        self.assertEqual(len(result["reviewedProductionPlan"]["criteria"]), 8)
        self.assertTrue(all(not Path(row["evidence"]).exists()
                            for row in result["reviewedProductionPlan"]["criteria"]))
        self.assertTrue(result["productionPlanFrozen"])
        self.assertEqual(result["phase"], "review")
        self.assertIsNone(result["pending"])
        self.assertNotIn("production", result)
        self.assertNotIn("delivery", result)

    def test_detailed_predecessor_history_replays_without_original_files(self):
        _, payload, evidence = self.detailed_recovery_fixture()
        self.call("recover-plan", payload, key=self.recovery_key)
        previous = self.call("save", {"phase": "repair"}, key=self.recovery_key)
        replacement = self.root / "accepted-successor.txt"
        evidence.rename(replacement)  # Prior history must use retained bytes, not re-open old paths.
        successor = copy.deepcopy(previous["reviewedProductionPlan"])
        successor.update(candidateHead="d" * 40, premerge_evidence=[str(replacement)])
        payload.update(expectedCheckpointDigest=self.digest(previous), expectedHeadSha=previous["headSha"],
                       expectedPlanDigest=self.digest(previous["reviewedProductionPlan"]),
                       headSha="d" * 40, reviewedProductionPlan=successor,
                       expectedEvidenceFiles={str(evidence): hashlib.sha256(replacement.read_bytes()).hexdigest()})
        payload["livePr"]["headSha"] = "d" * 40
        # The current predecessor still requires its accepted source file for this recovery.
        self.reject_recovery_unchanged(payload)
        evidence.write_bytes(replacement.read_bytes())
        result = self.call("recover-plan", payload, key=self.recovery_key)
        self.assertEqual(result["recoveryHistory"][:-1], previous["recoveryHistory"])
        entry = result["recoveryHistory"][-1]
        self.assertEqual(self.digest({**entry["predecessor"], "recoveryHistory": previous["recoveryHistory"]}),
                         entry["predecessorDigest"])
        # A third recovery validates both detailed historical entries with no historical file reads.
        current = self.call("save", {"phase": "repair"}, key=self.recovery_key)
        evidence.unlink()
        payload.update(expectedCheckpointDigest=self.digest(current), expectedHeadSha=current["headSha"],
                       expectedPlanDigest=self.digest(current["reviewedProductionPlan"]),
                       headSha="e" * 40, expectedEvidenceFiles={str(replacement): hashlib.sha256(replacement.read_bytes()).hexdigest()})
        payload["reviewedProductionPlan"] = {**successor, "candidateHead": "e" * 40}
        payload["livePr"]["headSha"] = "e" * 40
        result = self.call("recover-plan", payload, key=self.recovery_key)
        self.assertEqual(result["recoveryHistory"][:-1], current["recoveryHistory"])

    def test_detailed_dual_field_plan_preserves_metadata_without_extra_retention(self):
        old, payload, _ = self.detailed_recovery_fixture()
        old["reviewedProductionPlan"]["evidence"] = [str(self.root / "not-a-freeze-reference.json")]
        path = self.root / (hashlib.sha256(self.recovery_key.encode()).hexdigest() + ".json")
        path.write_text(json.dumps(old))
        payload.update(expectedCheckpointDigest=self.digest(old),
                       expectedPlanDigest=self.digest(old["reviewedProductionPlan"]))
        result = self.call("recover-plan", payload, key=self.recovery_key)
        entry = result["recoveryHistory"][0]
        self.assertEqual(entry["predecessor"], old)
        self.assertEqual({row["path"] for row in entry["retainedEvidence"]},
                         set(old["reviewedProductionPlan"]["premerge_evidence"]))
        # Dual-field history must use the same authoritative field on replay.
        previous = self.call("save", {"phase": "repair"}, key=self.recovery_key)
        payload.update(expectedCheckpointDigest=self.digest(previous), expectedHeadSha=previous["headSha"],
                       expectedPlanDigest=self.digest(previous["reviewedProductionPlan"]), headSha="d" * 40)
        payload["livePr"]["headSha"] = "d" * 40
        payload["reviewedProductionPlan"]["candidateHead"] = "d" * 40
        result = self.call("recover-plan", payload, key=self.recovery_key)
        self.assertEqual(result["recoveryHistory"][:-1], previous["recoveryHistory"])

    def test_legacy_recovery_preserves_extra_premerge_metadata(self):
        old, payload, evidence = self.recovery_fixture()
        old["reviewedProductionPlan"]["premerge_evidence"] = [str(self.root / "not-a-legacy-freeze.json")]
        path = self.root / (hashlib.sha256(self.recovery_key.encode()).hexdigest() + ".json")
        path.write_text(json.dumps(old))
        payload.update(expectedCheckpointDigest=self.digest(old),
                       expectedPlanDigest=self.digest(old["reviewedProductionPlan"]))
        result = self.call("recover-plan", payload, key=self.recovery_key)
        entry = result["recoveryHistory"][0]
        self.assertEqual(entry["predecessor"], old)
        self.assertEqual(entry["predecessor"]["policyVersion"], 6)
        self.assertEqual([row["path"] for row in entry["retainedEvidence"]], [str(evidence)])

    def test_detailed_invalid_predecessor_schemas_reject_without_writes(self):
        old, payload, evidence = self.detailed_recovery_fixture()
        plan = old["reviewedProductionPlan"]
        invalid = [None, {}, {**plan, "premerge_evidence": []},
                   {k: v for k, v in plan.items() if k != "premerge_evidence"},
                   {**plan, "premerge_evidence": [str(evidence)] * 2},
                   {**plan, "premerge_evidence": [str(self.root / str(i)) for i in range(33)]},
                   {**plan, "premerge_evidence": [42]}, {**plan, "candidateHead": "f" * 40},
                   {**plan, "candidateBase": "f" * 40}, {**plan, "required": False},
                   {**plan, "criteria": [plan["criteria"][0], "mixed"]},
                   {**plan, "criteria": [{**plan["criteria"][0], "result": "SUCCESS"}]},
                   {**plan, "criteria": [plan["criteria"][0]] * 2}]
        path = self.root / (hashlib.sha256(self.recovery_key.encode()).hexdigest() + ".json")
        for value in invalid:
            with self.subTest(plan=value):
                changed = {**old, "reviewedProductionPlan": value}
                path.write_text(json.dumps(changed))
                self.reject_recovery_unchanged({**payload, "expectedCheckpointDigest": self.digest(changed),
                                               "expectedPlanDigest": self.digest(value)})

    def test_detailed_exact_successor_owner_and_complete_hash_map_remain_required(self):
        _, payload, evidence = self.detailed_recovery_fixture()
        for field, value in [("owner", "Finance parent; task-a"), ("owner", "other")]:
            invalid = copy.deepcopy(payload)
            invalid["reviewedProductionPlan"][field] = value
            self.reject_recovery_unchanged(invalid)
        self.reject_recovery_unchanged(payload, owner="other")
        for expected in [{}, {str(evidence): "0" * 64},
                         {**payload["expectedEvidenceFiles"], "extra.json": "f" * 64}]:
            self.reject_recovery_unchanged({**payload, "expectedEvidenceFiles": expected})
        self.call("recover-plan", payload, key=self.recovery_key)

    def test_detailed_recovery_atomic_replace_failure_keeps_registry_and_evidence(self):
        _, payload, _ = self.detailed_recovery_fixture()
        before = {p.name: p.read_bytes() for p in self.root.iterdir() if p.is_file() and p.name != "registry.lock"}
        with patch("checkpoint.os.replace", side_effect=OSError("fixture replacement failure")):
            with self.assertRaises(OSError):
                self.call("recover-plan", payload, key=self.recovery_key)
        self.assertEqual(before, {p.name: p.read_bytes() for p in self.root.iterdir()
                                  if p.is_file() and p.name != "registry.lock"})

    def test_reviewed_recovery_preserves_exact_predecessor_and_freezes_successor(self):
        old, payload, evidence = self.recovery_fixture()
        result = self.call("recover-plan", payload, key=self.recovery_key)
        entry = result["recoveryHistory"][0]
        self.assertEqual(entry["predecessor"], old)
        self.assertEqual(entry["predecessorDigest"], self.digest(old))
        self.assertEqual(base64.b64decode(entry["retainedEvidence"][0]["bytes"]), evidence.read_bytes())
        self.assertEqual(result["headSha"], "c" * 40)
        self.assertEqual(result["reviewedProductionPlan"], payload["reviewedProductionPlan"])
        self.assertEqual(result["phase"], "review")
        self.assertTrue(result["productionPlanFrozen"])
        self.assertIsNone(result["pending"])
        self.assertNotIn("delivery", result)
        self.assertEqual(result["evidence"], ["lead-release.json", "independent-plan-review.json", "live-pr.json"])
        with self.assertRaises(ValueError):
            self.call("save", {"reviewedProductionPlan": old["reviewedProductionPlan"]}, key=self.recovery_key)
        with self.assertRaises(ValueError):
            self.call("save", {"recoveryHistory": []}, key=self.recovery_key)

    def test_same_candidate_applicability_recovery_retains_reconstructable_history(self):
        _, payload, _ = self.recovery_fixture()
        self.call("recover-plan", payload, key=self.recovery_key)
        previous = self.call("save", {"phase": "repair"}, key=self.recovery_key)
        payload.update(expectedCheckpointDigest=self.digest(previous), expectedHeadSha=previous["headSha"],
                       expectedPlanDigest=self.digest(previous["reviewedProductionPlan"]),
                       applicabilityCorrectionEvidence=["reviewed-applicability-correction.json"])
        payload["reviewedProductionPlan"]["reason"] = "corrected applicability"
        result = self.call("recover-plan", payload, key=self.recovery_key)
        entry = result["recoveryHistory"][-1]
        self.assertNotIn("recoveryHistory", entry["predecessor"])
        prior = result["recoveryHistory"][:-1]
        self.assertEqual(prior, previous["recoveryHistory"])
        self.assertEqual(entry["priorHistory"], {"present": True, "count": 1, "digest": self.digest(prior)})
        self.assertEqual(self.digest({**entry["predecessor"], "recoveryHistory": prior}), entry["predecessorDigest"])

    def test_recovery_rejects_stale_invalid_and_unreviewed_payloads_atomically(self):
        _, payload, _ = self.recovery_fixture()
        mutations = [
            ("expectedCheckpointDigest", "0" * 64), ("expectedPlanDigest", "0" * 64),
            ("expectedHeadSha", "d" * 40), ("expectedBaseSha", "d" * 40),
            ("headSha", "bad"), ("baseSha", "bad"), ("policyVersion", True), ("acceptanceRevision", 0),
            ("policyVersion", 5), ("acceptanceRevision", 3),
            ("livePr", {**payload["livePr"], "state": "MERGED"}),
            ("livePr", {**payload["livePr"], "merged": True}),
            ("livePr", {**payload["livePr"], "url": "https://github.com/foreign/repo/pull/1"}),
            ("livePr", {**payload["livePr"], "headSha": "d" * 40}),
            ("livePr", {**payload["livePr"], "number": 2}), ("livePr", ["malformed"]),
            ("authorityEvidence", []), ("reviewEvidence", []), ("predecessorEvidenceBinding", []),
            ("implementers", []), ("reviewers", ["worker"]), ("reason", " "),
            ("reviewedProductionPlan", {}), ("reviewedProductionPlan", {**payload["reviewedProductionPlan"], "owner": "other"}),
            ("reviewedProductionPlan", {**payload["reviewedProductionPlan"], "required": True}),
            ("reviewedProductionPlan", {"required": True, "owner": "task-a", "candidateHead": "d" * 40,
                                       "candidateBase": "b" * 40, "premerge_evidence": ["review.json"],
                                       "criteria": [{"id": "health", "action": "observe", "result": "planned"}]}),
            ("expectedEvidenceFiles", {}),
        ]
        for field, value in mutations:
            with self.subTest(field=field, value=value):
                invalid = copy.deepcopy(payload)
                invalid[field] = value
                self.reject_recovery_unchanged(invalid)
        self.reject_recovery_unchanged(payload, owner="foreign-owner")

    def test_recovery_requires_active_claim_and_no_base_merge_claim(self):
        _, payload, _ = self.recovery_fixture()
        self.call("claim", key="https://github.com/owner/repo#merge:main", owner="another-pr")
        self.reject_recovery_unchanged(payload)
        self.call("release", key="https://github.com/owner/repo#merge:main", owner="another-pr")
        self.call("release", key=self.recovery_key)
        self.reject_recovery_unchanged(payload)
        path = self.root / (hashlib.sha256(self.recovery_key.encode()).hexdigest() + ".json")
        path.unlink()
        self.reject_recovery_unchanged(payload)

    def test_recovery_rejects_pending_terminal_and_merge_evidence(self):
        old, payload, _ = self.recovery_fixture()
        changes = [("phase", p) for p in ["final_check", "merge", "deploy", "observe", "reconcile", "complete", "canceled"]]
        changes += [("pending", value) for value in [{"id": "merge-1"}, {}, [], False, 0, ""]]
        changes += [("lastOperation", {"action": "merge"}),
                    ("delivery", {"pr": {"state": "MERGED"}}), ("mergeReceipt", {"mergeSha": "e" * 40})]
        path = self.root / (hashlib.sha256(self.recovery_key.encode()).hexdigest() + ".json")
        for field, value in changes:
            with self.subTest(field=field, value=value):
                changed = {**old, field: value}
                path.write_text(json.dumps(changed))
                self.reject_recovery_unchanged({**payload, "expectedCheckpointDigest": self.digest(changed)})
        changed = {k: v for k, v in old.items() if k != "pending"}
        path.write_text(json.dumps(changed))
        self.reject_recovery_unchanged({**payload, "expectedCheckpointDigest": self.digest(changed)})

    def test_recovery_rejects_corrupt_prior_history_even_with_fresh_checkpoint_digest(self):
        _, payload, _ = self.recovery_fixture()
        self.call("recover-plan", payload, key=self.recovery_key)
        old = self.call("save", {"phase": "repair"}, key=self.recovery_key)
        payload.update(expectedHeadSha=old["headSha"], expectedPlanDigest=self.digest(old["reviewedProductionPlan"]),
                       headSha="d" * 40)
        payload["livePr"]["headSha"] = "d" * 40
        path = self.root / (hashlib.sha256(self.recovery_key.encode()).hexdigest() + ".json")
        for mutation in ["count", "history-digest", "predecessor", "predecessor-digest", "bytes"]:
            with self.subTest(mutation=mutation):
                changed = copy.deepcopy(old)
                entry = changed["recoveryHistory"][0]
                if mutation == "count": entry["priorHistory"]["count"] = 1
                elif mutation == "history-digest": entry["priorHistory"]["digest"] = "0" * 64
                elif mutation == "predecessor": entry["predecessor"]["headSha"] = "e" * 40
                elif mutation == "predecessor-digest": entry["predecessorDigest"] = "0" * 64
                else: entry["retainedEvidence"][0]["bytes"] = base64.b64encode(b"corrupted").decode()
                path.write_text(json.dumps(changed))
                self.reject_recovery_unchanged({**payload, "expectedCheckpointDigest": self.digest(changed)})

    @unittest.skipUnless(hasattr(os, "mkfifo"), "POSIX special-file guard")
    def test_recovery_rejects_fifo_without_blocking_registry(self):
        _, payload, evidence = self.recovery_fixture()
        evidence.unlink()
        os.mkfifo(evidence)
        code = "from checkpoint import operate; from pathlib import Path; import json,sys\ntry:\n operate(Path(sys.argv[1]), sys.argv[2], 'task-a', 'recover-plan', json.load(sys.stdin))\nexcept ValueError as error:\n print(error, file=sys.stderr); sys.exit(2)"
        before = self.call("read", key=self.recovery_key)
        result = subprocess.run([sys.executable, "-c", code, str(self.root), self.recovery_key],
                                cwd=Path(__file__).resolve().parent, input=json.dumps(payload),
                                capture_output=True, text=True, timeout=2)
        self.assertEqual(result.returncode, 2)
        self.assertIn("regular file", result.stderr)
        self.assertEqual(before, self.call("read", key=self.recovery_key))

    def test_recovery_allows_symlink_only_to_matching_regular_bytes(self):
        _, payload, evidence = self.recovery_fixture()
        target = evidence.with_suffix(".target")
        evidence.rename(target)
        evidence.symlink_to(target)
        result = self.call("recover-plan", payload, key=self.recovery_key)
        self.assertEqual(base64.b64decode(result["recoveryHistory"][0]["retainedEvidence"][0]["bytes"]),
                         target.read_bytes())

    def test_recovery_rejects_noop_or_unreviewed_same_candidate(self):
        old, payload, _ = self.recovery_fixture()
        payload.update(headSha=old["headSha"], reviewedProductionPlan=old["reviewedProductionPlan"],
                       applicabilityCorrectionEvidence=["not-enough-for-noop.json"])
        payload["livePr"]["headSha"] = old["headSha"]
        self.reject_recovery_unchanged(payload)
        payload["reviewedProductionPlan"] = {**old["reviewedProductionPlan"], "reason": "changed"}
        payload.pop("applicabilityCorrectionEvidence")
        self.reject_recovery_unchanged(payload)

    def test_recovery_rejects_tampered_missing_and_oversized_frozen_files(self):
        _, payload, evidence = self.recovery_fixture()
        evidence.write_bytes(b"changed after freeze")
        self.reject_recovery_unchanged(payload)
        evidence.unlink()
        self.reject_recovery_unchanged(payload)
        evidence.write_bytes(b"x" * (256 * 1024 + 1))
        payload["expectedEvidenceFiles"][str(evidence)] = hashlib.sha256(evidence.read_bytes()).hexdigest()
        self.reject_recovery_unchanged(payload)

    def test_recovery_rejects_tampered_checkpoint_not_only_the_plan(self):
        old, payload, _ = self.recovery_fixture()
        path = self.root / (hashlib.sha256(self.recovery_key.encode()).hexdigest() + ".json")
        path.write_text(json.dumps({**old, "worker": "unexpected-worker"}))
        self.reject_recovery_unchanged(payload)

    def test_completion_requires_production_acceptance(self):
        self.call("claim")
        with self.assertRaises(ValueError):
            self.call("save", {"phase": "complete"})
        from acceptance_test import delivery_state
        state = delivery_state()
        self.call("save", {"phase": "final_check", "reviewedProductionPlan": state["reviewedProductionPlan"]})
        self.call("save", {"phase": "complete", "delivery": state})
        self.assertEqual(self.call("read")["phase"], "complete")


    def test_partial_updates_cannot_invalidate_completed_receipt(self):
        from acceptance_test import delivery_state
        state = delivery_state()
        self.call("save", {"phase": "final_check", "reviewedProductionPlan": state["reviewedProductionPlan"]})
        self.call("save", {"phase": "complete", "delivery": state})
        with self.assertRaises(ValueError):
            self.call("save", {"headSha": "d" * 40})
        state['production']['health'] = 'FAILURE'
        with self.assertRaises(ValueError):
            self.call("save", {"delivery": state})
        self.assertEqual(self.call("read")["delivery"]["production"]["health"], "SUCCESS")
        self.call("save", {"phase": "observe", "delivery": state})
        self.assertEqual(self.call("read")["phase"], "observe")

    def test_frozen_production_plan_cannot_be_replaced_for_completion(self):
        from acceptance_test import delivery_state
        state = delivery_state()
        self.call("save", {"phase": "final_check", "reviewedProductionPlan": state["reviewedProductionPlan"]})
        alternative = {'required': False, 'owner': 'owner', 'criteria': [],
                       'reason': 'Changed after review', 'evidence': ['changed.json']}
        state['acceptance']['productionPlan'] = alternative
        state['reviewedProductionPlan'] = alternative
        with self.assertRaises(ValueError):
            self.call("save", {"phase": "complete", "delivery": state})
        with self.assertRaises(ValueError):
            self.call("save", {"phase": "review", "reviewedProductionPlan": alternative})

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
