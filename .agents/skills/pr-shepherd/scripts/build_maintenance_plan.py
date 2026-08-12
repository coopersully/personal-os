import argparse
import json
import re
import sys
from datetime import UTC, datetime
from pathlib import Path

FAILED = {"FAILURE", "ERROR", "CANCELLED", "TIMED_OUT", "ACTION_REQUIRED", "STALE"}
PENDING = {"QUEUED", "IN_PROGRESS", "PENDING", "WAITING"}
ISSUE_LINK = re.compile(
    r"\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?|refs?)\s+#\d+\b", re.IGNORECASE
)


def check_state(check):
    return (check.get("conclusion") or check.get("state") or check.get("status") or "").upper()


def actionable_feedback(feedback):
    for item in feedback.get("items", []):
        if item.get("isLikelyNoise"):
            continue
        if item.get("kind") == "review_thread" and not item.get("isResolved"):
            return True
        if item.get("kind") == "review_summary" and item.get("reviewState") == "CHANGES_REQUESTED":
            return True
        if item.get("kind") == "pr_comment" and (item.get("body") or "").strip():
            return True
    return False


def plan(state, feedback):
    evidence = []
    if state.get("state") != "OPEN":
        action = "CANCEL"
        evidence.append(f"PR state is {state.get('state')}")
    elif state.get("worktree", {}).get("dirty"):
        action = "ESCALATE"
        evidence.append("working tree contains local changes")
    elif actionable_feedback(feedback):
        action = "ADDRESS_FEEDBACK"
        evidence.append("actionable review feedback remains")
    else:
        checks = state.get("statusCheckRollup") or []
        failed = [item for item in checks if check_state(item) in FAILED]
        pending = [item for item in checks if check_state(item) in PENDING]
        if failed:
            action = "FIX_CI"
            evidence.append(f"{len(failed)} check(s) failed")
        elif state.get("mergeable") == "CONFLICTING" or state.get("mergeStateStatus") == "DIRTY":
            action = "CATCHUP"
            evidence.append("PR has merge conflicts")
        elif pending:
            action = "WAIT"
            evidence.append(f"{len(pending)} check(s) pending")
        elif state.get("missingBodySections"):
            action = "UPDATE_METADATA"
            evidence.append("PR body is missing rubric sections")
        elif not ISSUE_LINK.search(state.get("body") or "") and len(state.get("changedPaths", [])) > 3:
            action = "AUDIT_TRACKER"
            evidence.append("non-trivial PR has no explicit issue relationship")
        elif state.get("reviewDecision") == "APPROVED":
            action = "NOOP"
            evidence.append("approved head has no known maintenance action")
        else:
            action = "LOCAL_REVIEW"
            evidence.append("run author-side readiness review")
    return {
        "generatedAt": datetime.now(UTC).isoformat(),
        "pullRequest": {"number": state.get("number"), "url": state.get("url"), "head": state.get("headRefOid")},
        "nextAction": {"kind": action, "evidence": evidence},
    }


def main(argv):
    parser = argparse.ArgumentParser()
    parser.add_argument("--state", required=True)
    parser.add_argument("--feedback", required=True)
    parser.add_argument("--output")
    parser.add_argument("--pretty", action="store_true")
    args = parser.parse_args(argv)
    payload = plan(
        json.loads(Path(args.state).read_text(encoding="utf-8")),
        json.loads(Path(args.feedback).read_text(encoding="utf-8")),
    )
    text = json.dumps(payload, indent=2 if args.pretty else None)
    if args.output:
        path = Path(args.output)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(f"{text}\n", encoding="utf-8")
    else:
        print(text)


if __name__ == "__main__":
    main(sys.argv[1:])
