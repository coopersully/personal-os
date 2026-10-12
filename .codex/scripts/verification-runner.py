"""Admit one expensive verifier per host/user; contention exits 75 without starting work."""
import argparse
import fcntl
import json
import os
import signal
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path


def candidate():
    head = subprocess.check_output(["git", "rev-parse", "HEAD"], text=True).strip()
    status = subprocess.check_output(["git", "status", "--porcelain"], text=True)
    return head, status


def run(command, root, inspect=None):
    root.mkdir(parents=True, exist_ok=True, mode=0o700)
    with (root / "verification.lock").open("a+") as claim:
        try:
            fcntl.flock(claim, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            print("Verification is queued: another local verifier owns the host slot. Retry after it exits.", file=sys.stderr)
            return 75
        claim.seek(0)
        claim.truncate()
        json.dump({"pid": os.getpid(), "cwd": os.getcwd(), "startedAt": datetime.now(timezone.utc).isoformat()}, claim)
        claim.flush()
        os.fsync(claim.fileno())
        before = inspect() if inspect else None
        if before and before[1]:
            print("Freeze and commit the candidate before full verification.", file=sys.stderr)
            return 78
        # The child retains the lock if this coordinator is killed unexpectedly.
        child = subprocess.Popen(command, start_new_session=True, pass_fds=(claim.fileno(),))
        def forward(signum, frame):
            try:
                os.killpg(child.pid, signum)
            except ProcessLookupError:
                pass
        previous = {sig: signal.signal(sig, forward) for sig in (signal.SIGINT, signal.SIGTERM)}
        try:
            result = child.wait()
            if inspect and inspect() != before:
                print("Candidate changed during verification; this run is not acceptance evidence.", file=sys.stderr)
                return 78
            return result
        finally:
            for sig, handler in previous.items():
                signal.signal(sig, handler)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", nargs=argparse.REMAINDER)
    args = parser.parse_args()
    command = args.command[1:] if args.command[:1] == ["--"] else args.command
    if not command:
        parser.error("A verifier command is required")
    root = Path.home() / ".cache" / "nohmi" / "verification"
    sys.exit(run(command, root, candidate))


if __name__ == "__main__":
    main()
