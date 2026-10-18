"""Private, host-local ownership and write-ahead checkpoints; never executes GitHub writes."""

import argparse
import fcntl
import hashlib
import json
import os
import subprocess
import tempfile
import time
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

from acceptance import evaluate_delivery


def registry_root():
    common = subprocess.check_output(
        ["git", "rev-parse", "--path-format=absolute", "--git-common-dir"],
        text=True, timeout=10,
    ).strip()
    return Path(common) / "ship-it"


def atomic_write(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(dir=path.parent, prefix=".checkpoint-")
    try:
        with os.fdopen(fd, "w") as stream:
            json.dump(value, stream, indent=2, sort_keys=True)
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
        directory = os.open(path.parent, os.O_RDONLY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


class RegistryBusyError(TimeoutError):
    pass


@contextmanager
def locked(root, timeout=5):
    root.mkdir(parents=True, exist_ok=True)
    with (root / "registry.lock").open("a") as stream:
        deadline = time.monotonic() + timeout
        while True:
            try:
                fcntl.flock(stream, fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except BlockingIOError:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise RegistryBusyError("Checkpoint registry is busy; retry after the current writer exits") from None
                time.sleep(min(.05, remaining))
        yield


def transition(record, owner, operation, payload):
    if not owner.strip():
        raise ValueError("A stable task/host owner identity is required")
    if record and record["owner"] != owner:
        raise ValueError("Another owner holds this claim; only that owner may transfer it")
    record = dict(record or {"owner": owner, "phase": "collect", "pending": None})
    if operation == "begin":
        if record.get("pending"):
            raise ValueError("Reconcile the pending operation before issuing another write")
        for field in ("id", "action", "headSha", "baseSha"):
            if not payload.get(field):
                raise ValueError(f"Pending operation requires {field}")
        record["pending"] = payload
    elif operation == "finish":
        pending = record.get("pending")
        if not pending or payload.get("id") != pending["id"] or not payload.get("evidence"):
            raise ValueError("Finish requires the pending ID and reconciled evidence")
        record["lastOperation"] = {**pending, "result": payload}
        record["pending"] = None
    elif operation == "save":
        allowed = {"phase", "headSha", "baseSha", "evidence", "nextTrigger", "retryAt",
                   "failureFingerprint", "failedAttempts", "schedulerId", "authorization",
                   "worktree", "worker", "acceptanceRevision", "policyVersion", "delivery"}
        if set(payload) - allowed:
            raise ValueError("Unsupported checkpoint field")
        prospective = {**record, **payload}
        if prospective.get("phase") == "complete" and record.get("pending"):
            raise ValueError("Pending operations must be reconciled before completion")
        if prospective.get("phase") == "complete":
            delivery = prospective.get("delivery")
            if evaluate_delivery(delivery)["decision"] not in {"SHIPPED", "COMPLETE_NO_DEPLOY"}:
                raise ValueError("Verified production acceptance and reconciliation are required")
            for field in ("headSha", "baseSha"):
                expected = prospective.get(field)
                if expected and delivery["pr"].get(field) != expected:
                    raise ValueError("Delivery receipt does not match the owned candidate")
        record.update(payload)
    elif operation != "claim":
        raise ValueError("Unsupported transition")
    record["updatedAt"] = datetime.now(timezone.utc).isoformat()
    return record


def operate(root, key, owner, operation, payload):
    """A key is a canonical PR URL, or repo URL + '#merge:' + base name."""
    path = root / (hashlib.sha256(key.encode()).hexdigest() + ".json")
    with locked(root):
        record = json.loads(path.read_text()) if path.exists() else None
        if operation == "read":
            return record
        if operation == "transfer":
            if not record or record["owner"] != owner:
                raise ValueError("Only the current owner may transfer this claim")
            next_owner = payload.get("nextOwner")
            if (not isinstance(next_owner, str) or not next_owner.strip()
                    or next_owner == owner or not payload.get("stoppedEvidence")):
                raise ValueError("Transfer requires a different next owner and evidence execution stopped")
            record.update(owner=next_owner, transferFrom=owner, transferEvidence=payload["stoppedEvidence"])
            owner = next_owner
            operation = "claim"
        if operation == "release":
            if not record or record["owner"] != owner or record.get("pending"):
                raise ValueError("Only the owner may release a reconciled claim")
            # Preserve the checkpoint after releasing ownership.
            record["owner"] = None
            atomic_write(path, record)
            return record
        if record and record.get("owner") is None:
            record["owner"] = owner
        record = transition(record, owner, operation, payload)
        record["key"] = key
        atomic_write(path, record)
        return record


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("operation", choices=["claim", "read", "save", "begin", "finish", "release", "transfer"])
    parser.add_argument("--key", required=True)
    parser.add_argument("--owner", required=True)
    parser.add_argument("--payload", type=Path, help="Sanitized JSON file; never include credentials or logs")
    args = parser.parse_args()
    payload = json.loads(args.payload.read_text()) if args.payload else {}
    try:
        value = operate(registry_root(), args.key, args.owner, args.operation, payload)
    except RegistryBusyError as error:
        parser.exit(75, f"{error}\n")
    except ValueError as error:
        parser.exit(2, f"{error}\n")
    print(json.dumps(value, indent=2))


if __name__ == "__main__":
    main()
