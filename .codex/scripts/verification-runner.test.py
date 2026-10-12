import importlib.util
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path

SCRIPT = Path(__file__).with_name('verification-runner.py')
spec = importlib.util.spec_from_file_location('runner', SCRIPT)
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)


class RunnerTest(unittest.TestCase):
    def test_busy_slot_never_starts_work_and_exit_releases_it(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            marker = root / 'ready'
            code = f"import importlib.util; from pathlib import Path; s=importlib.util.spec_from_file_location('runner',{str(SCRIPT)!r}); m=importlib.util.module_from_spec(s); s.loader.exec_module(m); m.run([{sys.executable!r},'-c',\"from pathlib import Path; import time; Path({str(marker)!r}).touch(); time.sleep(30)\"],Path({directory!r}))"
            process = subprocess.Popen([sys.executable, '-c', code])
            try:
                deadline = time.monotonic() + 10
                while not marker.exists() and time.monotonic() < deadline:
                    time.sleep(.02)
                self.assertTrue(marker.exists())
                self.assertEqual(runner.run([sys.executable, '-c', 'raise Exception("must not start")'], root), 75)
            finally:
                process.terminate()
                process.wait(timeout=10)
            self.assertEqual(runner.run([sys.executable, '-c', 'pass'], root), 0)

    def test_candidate_drift_and_dirty_start_cannot_pass(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.assertEqual(runner.run([sys.executable, '-c', 'pass'], root, lambda: ('a', ' M code')), 78)
            states = iter([('a', ''), ('b', '')])
            self.assertEqual(runner.run([sys.executable, '-c', 'pass'], root, lambda: next(states)), 78)

    def test_failure_is_preserved(self):
        with tempfile.TemporaryDirectory() as directory:
            self.assertEqual(runner.run([sys.executable, '-c', 'raise SystemExit(9)'], Path(directory)), 9)


if __name__ == '__main__':
    unittest.main()
