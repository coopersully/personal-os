"""Synthetic inventory tests: no host probes, processes, containers or package setup."""
import copy
import importlib.util
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location(
    "admission", Path(__file__).with_name("verification-admission.py")
)
admission = importlib.util.module_from_spec(spec)
spec.loader.exec_module(admission)


def process(pid, ppid, argv, present=True):
    return {"pid": pid, "ppid": ppid, "argv": argv, "present": present}


class AdmissionClassificationTest(unittest.TestCase):
    def test_verify_pr_and_jest_chain_excludes_absent_queried_pids(self):
        rows = [
            process(20, 1, ["pnpm", "verify:pr"]),
            process(21, 20, ["node", "/tools/pnpm.cjs", "run", "verify:pr"]),
            process(22, 21, ["node", "/project/scripts/verify-pr.mjs"]),
            process(23, 22, ["node", "/project/node_modules/jest/bin/jest.js", "--maxWorkers=2"]),
            process(24, 23, ["node", "/project/node_modules/jest-worker/build/workers/processChild.js"]),
            process(30, 1, ["node", "/tools/sendgrid.mjs"], present=False),
            process(31, 1, ["node", "/tools/rea.mjs"], present=False),
        ]
        before = copy.deepcopy(rows)
        classified = admission.material_verifier_processes(rows)
        self.assertEqual([row["pid"] for row in classified], [20, 21, 22, 23, 24])
        self.assertEqual(classified[-1]["reason"], "ancestor")
        self.assertEqual(rows, before)

    def test_reads_and_inline_keyword_text_are_not_verifier_identity(self):
        rows = [
            process(1, 0, ["rg", "jest", "verification-admission.py"]),
            process(2, 0, ["node", "-e", "console.log('pnpm verify:pr jest')"]),
            process(3, 0, ["python3", "inspect-jest-receipt.py"]),
            process(4, 0, ["node", "/tool/server.mjs", "--notes=verify:pr"]),
            process(5, 0, ["node", "/dev/node_modules/jest-worker/build/workers/processChild.js"]),
            process(6, 0, ["node", "--eval=console.log(1)", "/project/node_modules/jest/bin/jest.js"]),
            process(7, 0, ["node", "-p'jest'", "/project/node_modules/jest/bin/jest.js"]),
        ]
        self.assertEqual(admission.material_verifier_processes(rows), [])

    def test_real_exec_and_filtered_launchers_are_material(self):
        rows = [
            process(1, 0, ["pnpm", "--filter", "@personal-os/web", "run", "verify:pr"]),
            process(2, 0, ["node", "--max-old-space-size=2048", "/tools/pnpm.mjs", "exec", "jest"]),
            process(3, 0, ["node", "/project/node_modules/vitest/vitest.mjs", "run"]),
            process(4, 0, ["pnpm", "verify"]),
        ]
        self.assertEqual([row["pid"] for row in admission.material_verifier_processes(rows)], [1, 2, 3, 4])

    def test_ancestry_is_snapshot_bound_and_cycles_terminate(self):
        rows = [
            process(5, 6, ["node", "/project/worker.mjs"]),
            process(6, 5, ["node", "/project/reader.mjs"]),
            process(7, 99, ["node", "/project/worker.mjs"]),
            process(99, 0, ["pnpm", "verify:pr"], present=False),
        ]
        self.assertEqual(admission.material_verifier_processes(rows), [])

    def test_node_option_values_and_unknown_options_are_not_script_identity(self):
        rows = [
            process(10, 0, ["node", "--title", "jest", "/tool/server.mjs"]),
            process(11, 10, ["node", "/tool/worker.mjs"]),
            process(12, 0, ["node", "--unknown-option", "jest", "/tool/server.mjs"]),
            process(13, 0, ["node", "--unknown-option=on", "/project/node_modules/jest/bin/jest.js"]),
        ]
        self.assertEqual(admission.material_verifier_processes(rows), [])

    def test_supported_node_value_options_preserve_actual_verifier_identity(self):
        rows = [
            process(10, 0, ["node", "--title", "worker", "/project/node_modules/jest/bin/jest.js"]),
            process(11, 0, ["node", "--title=worker", "/project/scripts/verify-pr.mjs"]),
            process(12, 0, ["node", "--require", "/project/preload.cjs", "/project/scripts/verify-pr.mjs"]),
        ]
        self.assertEqual([row["pid"] for row in admission.material_verifier_processes(rows)], [10, 11, 12])

    def test_malformed_live_identity_does_not_silently_pass(self):
        with self.assertRaises(ValueError):
            admission.material_verifier_processes([process(1, 0, "node jest")])
        with self.assertRaises(ValueError):
            admission.material_verifier_processes([process(1, 0, ["pnpm", "verify"])] * 2)

    def test_full_container_baseline_keeps_six_exited_and_one_created(self):
        rows = [{"id": "baseline", "state": "running", "labels": {"owner": "other"}}]
        rows += [{"id": str(n), "state": "exited"} for n in range(6)]
        rows += [{"id": "created", "state": "created"}]
        before = copy.deepcopy(rows)
        classified = admission.container_inventory(rows)
        self.assertEqual(classified["active"], ["baseline"])
        self.assertEqual(classified["inactive"], [str(n) for n in range(6)] + ["created"])
        self.assertEqual(classified["baseline"], before)
        self.assertEqual(rows, before)

    def test_paused_restarting_and_unknown_states_keep_their_boundaries(self):
        rows = [
            {"id": "paused", "state": "paused"},
            {"id": "restarting", "state": "restarting"},
            {"id": "missing", "Status": "Exited (0)"},
            {"id": "removing", "state": "removing"},
        ]
        classified = admission.container_inventory(rows)
        self.assertEqual(classified["active"], ["paused", "restarting"])
        self.assertEqual(classified["unknown"], ["missing", "removing"])


if __name__ == "__main__":
    unittest.main()
