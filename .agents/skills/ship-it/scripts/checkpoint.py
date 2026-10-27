"""Private, host-local ownership and write-ahead checkpoints; never executes GitHub writes."""

import argparse
import base64
import copy
import fcntl
import hashlib
import json
import os
import re
import stat
import subprocess
import tempfile
import time
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

from acceptance import POLICY, evaluate_delivery, production_criterion_ids, sha, strings


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
                   "worktree", "worker", "acceptanceRevision", "policyVersion", "delivery", "reviewedProductionPlan"}
        if set(payload) - allowed:
            raise ValueError("Unsupported checkpoint field")
        if (record.get("productionPlanFrozen") and "reviewedProductionPlan" in payload
                and payload["reviewedProductionPlan"] != record.get("reviewedProductionPlan")):
            raise ValueError("The frozen reviewed production plan cannot be replaced")
        prospective = {**record, **payload}
        if prospective.get("phase") == "final_check":
            if not isinstance(prospective.get("reviewedProductionPlan"), dict) or not prospective["reviewedProductionPlan"]:
                raise ValueError("Final collection requires the independently reviewed production plan")
            prospective["productionPlanFrozen"] = True
        if prospective.get("phase") == "complete" and record.get("pending"):
            raise ValueError("Pending operations must be reconciled before completion")
        if prospective.get("phase") == "complete":
            delivery = prospective.get("delivery")
            if (not prospective.get("productionPlanFrozen") or not isinstance(delivery, dict)
                    or delivery.get("reviewedProductionPlan") != record.get("reviewedProductionPlan")):
                raise ValueError("Completion must use the retained pre-merge production plan")
            if evaluate_delivery(delivery)["decision"] not in {"SHIPPED", "COMPLETE_NO_DEPLOY"}:
                raise ValueError("Verified production acceptance and reconciliation are required")
            for field in ("headSha", "baseSha"):
                expected = prospective.get(field)
                if expected and delivery["pr"].get(field) != expected:
                    raise ValueError("Delivery receipt does not match the owned candidate")
        record.update(prospective)
    elif operation != "claim":
        raise ValueError("Unsupported transition")
    record["updatedAt"] = datetime.now(timezone.utc).isoformat()
    return record


def canonical_digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def historical_plan_references(plan, candidate):
    """Select accepted local freeze references without altering either reviewed schema."""
    ids = production_criterion_ids(plan, candidate) if isinstance(plan, dict) else None
    if (ids is None or (plan["required"] and not ids)
            or (not plan["required"] and (ids or not isinstance(plan.get("reason"), str)
                                          or not plan["reason"].strip()))):
        raise ValueError("Recovery predecessor reviewed plan schema is invalid")
    detailed = bool(plan["criteria"]) and isinstance(plan["criteria"][0], dict)
    references = plan["premerge_evidence"] if detailed else plan["evidence"]
    if len(references) > 32 or len(set(references)) != len(references):
        raise ValueError("Recovery predecessor references exceed bounds or contain duplicates")
    return list(references)


def review_instant(value):
    try:
        instant = datetime.fromisoformat(value) if isinstance(value, str) else None
        if instant is None or instant.tzinfo is None or instant.utcoffset() is None:
            raise ValueError()
        return instant
    except (TypeError, ValueError, OverflowError):
        raise ValueError("Recovery provenance requires a timezone-aware ISO review time") from None


def recovery_evidence_bindings(request, references, recovered_at=None, legacy_history=False):
    """Validate asserted provenance, never authenticate the referenced human/reviewer facts."""
    expected = request.get("expectedEvidenceFiles")
    if not isinstance(expected, dict) or set(expected) != set(references):
        raise ValueError("Recovery needs the complete predecessor file bindings")
    typed = not legacy_history and "evidenceProvenanceVersion" in request
    if typed and (type(request["evidenceProvenanceVersion"]) is not int
                  or request["evidenceProvenanceVersion"] != 1
                  or type(request.get("policyVersion")) is not int or request["policyVersion"] < 8):
        raise ValueError("Recovery provenance version is unsupported")
    if not typed:
        if any(not isinstance(v, str) or not re.fullmatch(r"[a-f0-9]{64}", v) for v in expected.values()):
            raise ValueError("Recovery needs independently accepted historical freeze hashes")
        return expected, {}
    recovered = review_instant(recovered_at)
    if (not strings(request.get("implementers")) or not strings(request.get("reviewers"))
            or set(request["implementers"]) & set(request["reviewers"])):
        raise ValueError("Typed recovery requires independent successor review")
    common = {"sha256", "classification", "historicalProofAvailable", "bindingEvidence"}
    hashes = {}
    for reference, row in expected.items():
        if (not isinstance(row, dict) or not isinstance(row.get("sha256"), str)
                or not re.fullmatch(r"[a-f0-9]{64}", row["sha256"])
                or not strings(row.get("bindingEvidence"))):
            raise ValueError("Recovery file provenance is incomplete")
        classification = row.get("classification")
        if classification == "historical_hash_attested":
            if (set(row) != common | {"historicalReviewEvidence"}
                    or row.get("historicalProofAvailable") is not True
                    or not strings(row.get("historicalReviewEvidence"))):
                raise ValueError("Historical provenance requires original independent hash evidence")
        elif classification == "fresh_exact_bytes_historical_hash_unavailable":
            review = row.get("currentReview")
            if (set(row) != common | {"continuityEvidence", "currentReview"}
                    or row.get("historicalProofAvailable") is not False
                    or not strings(row.get("continuityEvidence")) or not isinstance(review, dict)
                    or set(review) != {"acceptedAt", "evidence", "implementers", "reviewers"}
                    or not all(strings(review.get(k)) for k in ("evidence", "implementers", "reviewers"))):
                raise ValueError("Fresh provenance requires exact-byte review and truthful historical unavailability")
            if (any(len(review[k]) != len(set(review[k])) for k in ("implementers", "reviewers"))
                    or set(review["reviewers"]) & (set(review["implementers"]) | set(request["implementers"]))
                    or review_instant(review["acceptedAt"]) > recovered):
                raise ValueError("Fresh provenance review identity or acceptance time is invalid")
        else:
            raise ValueError("Recovery file provenance classification is unsupported")
        hashes[reference] = row["sha256"]
    return hashes, expected


def validate_recovery_history(history):
    if not isinstance(history, list):
        raise ValueError("Recovery history is malformed")
    for index, entry in enumerate(history):
        if not isinstance(entry, dict):
            raise ValueError("Recovery history entry is malformed")
        prior = entry.get("priorHistory")
        predecessor = entry.get("predecessor")
        if (not isinstance(prior, dict) or type(prior.get("present")) is not bool
                or type(prior.get("count")) is not int or prior["count"] != index
                or prior.get("digest") != canonical_digest(history[:index])
                or (index > 0 and not prior["present"])
                or not isinstance(predecessor, dict) or "recoveryHistory" in predecessor):
            raise ValueError("Recovery history predecessor binding is invalid")
        restored = {**predecessor}
        if prior["present"]:
            restored["recoveryHistory"] = history[:index]
        if entry.get("predecessorDigest") != canonical_digest(restored):
            raise ValueError("Recovery history predecessor digest is invalid")
        request, retained = entry.get("request"), entry.get("retainedEvidence")
        original_plan = predecessor.get("reviewedProductionPlan")
        references = historical_plan_references(original_plan, predecessor)
        if (not isinstance(request, dict) or request.get("expectedCheckpointDigest") != entry["predecessorDigest"]
                or request.get("expectedPlanDigest") != canonical_digest(original_plan)
                or any(request.get("expected" + k[0].upper() + k[1:]) != predecessor.get(k)
                       for k in ("headSha", "baseSha"))
                or not isinstance(retained, list) or len(retained) > 32):
            raise ValueError("Recovery history retention binding is invalid")
        successor = {k: request.get(k) for k in ("headSha", "baseSha", "policyVersion", "acceptanceRevision")}
        successor["planDigest"] = canonical_digest(request.get("reviewedProductionPlan"))
        if entry.get("successor") != successor:
            raise ValueError("Recovery history successor binding is invalid")
        # Older writers permitted arbitrary extras. Preserve their meaning and exact bytes.
        new_policy = type(request.get("policyVersion")) is int and request["policyVersion"] >= 8
        expected, provenance = recovery_evidence_bindings(
            request, references, entry.get("recoveredAt"), legacy_history=not new_policy)
        actual, remaining = {}, 256 * 1024
        for item in retained:
            try:
                if not isinstance(item["bytes"], str) or len(item["bytes"]) > 4 * ((remaining + 2) // 3):
                    raise ValueError("Recovery history retained bytes exceed their bound")
                raw = base64.b64decode(item["bytes"], validate=True)
                path, digest = item["path"], item["sha256"]
                if new_policy and ((provenance and canonical_digest(item.get("provenance"))
                                    != canonical_digest(provenance.get(path)))
                                   or (not provenance and "provenance" in item)):
                    raise ValueError("Recovery history provenance is inconsistent")
                if (item.get("encoding") != "base64" or not isinstance(path, str) or path in actual
                        or len(raw) > remaining or hashlib.sha256(raw).hexdigest() != digest):
                    raise ValueError("Recovery history retained bytes are invalid")
            except (KeyError, TypeError, ValueError):
                raise ValueError("Recovery history retained bytes are invalid") from None
            remaining -= len(raw)
            actual[path] = digest
        if actual != expected or set(actual) != set(references):
            raise ValueError("Recovery history retained evidence is incomplete")


def recover_plan(root, key, record, owner, payload):
    """Cooperative premerge recovery; the owner authenticates all supplied provenance."""
    if not isinstance(payload, dict):
        raise ValueError("Recovery payload must be an object")
    if not isinstance(record, dict) or not owner.strip() or record.get("owner") != owner or record.get("key") != key:
        raise ValueError("Recovery requires the existing active PR owner")
    if not re.fullmatch(r"https://[^/?#]+/[^/?#]+/[^/?#]+/pull/[1-9][0-9]*", key):
        raise ValueError("Recovery requires a canonical PR URL")
    if (record.get("phase") != "repair" or "pending" not in record or record["pending"] is not None
            or record.get("productionPlanFrozen") is not True
            or any(record.get(k) for k in ("delivery", "mergeReceipt", "production"))
            or (record.get("lastOperation") and (not isinstance(record["lastOperation"], dict)
                                                 or record["lastOperation"].get("action") == "merge"))):
        raise ValueError("Recovery requires a frozen premerge repair with no pending or merge evidence")
    repo = key.rsplit("/pull/", 1)[0]
    for candidate in root.glob("*.json"):
        claim = json.loads(candidate.read_text())
        if not isinstance(claim, dict):
            raise ValueError("Checkpoint registry contains a malformed claim")
        if (str(claim.get("key", "")).startswith(repo + "#merge:")
                and (claim.get("owner") is not None or claim.get("pending"))):
            raise ValueError("Release the reconciled base-merge claim before recovery")
    plan = record.get("reviewedProductionPlan")
    if (payload.get("expectedCheckpointDigest") != canonical_digest(record)
            or payload.get("expectedPlanDigest") != canonical_digest(plan)
            or any(not sha(record.get(k)) or payload.get("expected" + k[0].upper() + k[1:]) != record[k]
                   for k in ("headSha", "baseSha"))):
        raise ValueError("Recovery predecessor changed; re-read the checkpoint and accepted freeze")
    validate_recovery_history(record.get("recoveryHistory", []))
    head, base = payload.get("headSha"), payload.get("baseSha")
    live = payload.get("livePr") or {}
    if (not isinstance(live, dict) or not sha(head) or not sha(base) or live.get("url") != key
            or type(live.get("number")) is not int or live["number"] != int(key.rsplit("/", 1)[1])
            or live.get("state") != "OPEN" or live.get("merged") is not False
            or live.get("headSha") != head or live.get("baseSha") != base
            or not strings(live.get("evidence"))):
        raise ValueError("Recovery requires observed OPEN, unmerged successor PR evidence")
    successor = payload.get("reviewedProductionPlan")
    ids = production_criterion_ids(successor, {"headSha": head, "baseSha": base}) if isinstance(successor, dict) else None
    try:
        policy_version = int((Path(__file__).resolve().parents[1] / "VERSION").read_text().strip())
    except (OSError, ValueError):
        raise ValueError("Current delivery policy version is unavailable") from None
    if (ids is None or successor.get("owner") != owner
            or (successor["required"] and not ids)
            or (not successor["required"] and (ids or not isinstance(successor.get("reason"), str)
                                               or not successor["reason"].strip()))
            or any(type(payload.get(k)) is not int or payload[k] <= 0
                   for k in ("policyVersion", "acceptanceRevision"))
            or payload["policyVersion"] != policy_version
            or payload["acceptanceRevision"] != POLICY["revision"]):
        raise ValueError("Recovery successor candidate, policy or reviewed plan is invalid")
    if (not isinstance(payload.get("reason"), str) or not payload["reason"].strip()
            or not all(strings(payload.get(k)) for k in
                       ("authorityEvidence", "reviewEvidence", "predecessorEvidenceBinding", "implementers", "reviewers"))
            or set(payload["implementers"]) & set(payload["reviewers"])):
        raise ValueError("Recovery needs authority, independent review and prior freeze provenance")
    same_candidate = head == record["headSha"] and base == record["baseSha"]
    if same_candidate and (successor == plan or not strings(payload.get("applicabilityCorrectionEvidence"))):
        raise ValueError("Recovery needs a changed candidate or concrete reviewed applicability correction")
    references = historical_plan_references(plan, record)
    recovered_at = datetime.now(timezone.utc).isoformat()
    expected, provenance = recovery_evidence_bindings(payload, references, recovered_at)
    retained, remaining = [], 256 * 1024
    for reference in references:
        try:
            descriptor = os.open(reference, os.O_RDONLY | os.O_NONBLOCK)
            try:
                if not stat.S_ISREG(os.fstat(descriptor).st_mode):
                    raise ValueError("Retained predecessor evidence must be a regular file")
                with os.fdopen(descriptor, "rb", closefd=False) as stream:
                    raw = stream.read(remaining + 1)
            finally:
                os.close(descriptor)
        except OSError:
            raise ValueError("Retained predecessor evidence is unavailable") from None
        if len(raw) > remaining or hashlib.sha256(raw).hexdigest() != expected[reference]:
            raise ValueError("Retained predecessor evidence exceeds its bound or differs from the accepted hash")
        remaining -= len(raw)
        retained.append({"path": reference, "sha256": expected[reference], "encoding": "base64",
                         "bytes": base64.b64encode(raw).decode("ascii")})
        if provenance:
            retained[-1]["provenance"] = copy.deepcopy(provenance[reference])
    predecessor = copy.deepcopy(record)
    history = predecessor.pop("recoveryHistory", [])
    entry = {"predecessor": predecessor, "predecessorDigest": canonical_digest(record),
             "priorHistory": {"present": "recoveryHistory" in record, "count": len(history),
                              "digest": canonical_digest(history)},
             "retainedEvidence": retained, "request": copy.deepcopy(payload),
             "successor": {"headSha": head, "baseSha": base, "planDigest": canonical_digest(successor),
                           "policyVersion": payload["policyVersion"], "acceptanceRevision": payload["acceptanceRevision"]}}
    if provenance:
        entry["recoveredAt"] = recovered_at
    recovered = {k: copy.deepcopy(record[k]) for k in
                 ("owner", "key", "authorization", "worktree", "worker", "transferFrom", "transferEvidence") if k in record}
    recovered.update(phase="review", pending=None, headSha=head, baseSha=base,
                     policyVersion=payload["policyVersion"], acceptanceRevision=payload["acceptanceRevision"],
                     reviewedProductionPlan=copy.deepcopy(successor), productionPlanFrozen=True,
                     recoveryHistory=[*history, entry],
                     evidence=[*payload["authorityEvidence"], *payload["reviewEvidence"], *live["evidence"]],
                     nextTrigger="Fresh successor review, verification and final collection; no prior readiness carries forward",
                     updatedAt=datetime.now(timezone.utc).isoformat())
    return recovered


def operate(root, key, owner, operation, payload):
    """A key is a canonical PR URL, or repo URL + '#merge:' + base name."""
    path = root / (hashlib.sha256(key.encode()).hexdigest() + ".json")
    with locked(root):
        record = json.loads(path.read_text()) if path.exists() else None
        if operation == "read":
            return record
        if operation == "recover-plan":
            record = recover_plan(root, key, record, owner, payload)
            atomic_write(path, record)
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
    parser.add_argument("operation", choices=["claim", "read", "save", "begin", "finish", "release", "transfer", "recover-plan"])
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
