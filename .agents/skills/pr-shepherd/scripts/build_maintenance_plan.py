import argparse
import json
import re
import sys
from datetime import UTC, datetime
from pathlib import Path

FAILED = {"FAILURE", "ERROR", "CANCELLED", "TIMED_OUT", "ACTION_REQUIRED", "STALE"}
PENDING = {"QUEUED", "IN_PROGRESS", "PENDING", "WAITING"}
NOHMI_PROJECT_LINK = re.compile(
    r"^- Project: \[Nohmi\]\(https://linear\.app/coopersully/project/nohmi-6799e74a853f\) — \S.+$",
    re.MULTILINE,
)
LINEAR_TASK_LINK = re.compile(
    r"^- Task: \[(COO-[1-9][0-9]*)\]"
    r"\(https://linear\.app/coopersully/issue/(COO-[1-9][0-9]*)(?:/[^)]*)?\) — \S.+$",
    re.MULTILINE,
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


def work_map_section(body):
    lines = body.splitlines()
    try:
        start = lines.index("## Work map") + 1
    except ValueError:
        return ""
    end = next((index for index in range(start, len(lines)) if lines[index].startswith("## ")), len(lines))
    return "\n".join(lines[start:end])


def linear_work_map_issue_keys(body):
    work_map = work_map_section(body)
    project_lines = [line for line in work_map.splitlines() if line.startswith("- Project:")]
    task_lines = [line for line in work_map.splitlines() if line.startswith("- Task:")]
    if len(project_lines) != 1 or not NOHMI_PROJECT_LINK.fullmatch(project_lines[0]) or not task_lines:
        return None

    issue_keys = set()
    for line in task_lines:
        match = LINEAR_TASK_LINK.fullmatch(line)
        if not match or match.group(1) != match.group(2):
            return None
        issue_keys.add(match.group(1))
    return issue_keys


def linear_coverage_complete(state, issue_keys):
    coverage = state.get("linearCoverage") or {}
    return (
        coverage.get("verified") is True
        and coverage.get("project") == "Nohmi"
        and set(coverage.get("directIssueKeys") or []) == issue_keys
        and coverage.get("structuredBacklinksComplete") is True
        and coverage.get("statusesCompatible") is True
    )


def plan(state, feedback):
    evidence = []
    if state.get("state") != "OPEN":
        action = "CANCEL"
        evidence.append(f"PR state is {state.get('state')}")
    elif state.get("worktree", {}).get("dirty"):
        action = "ESCALATE"
        evidence.append("working tree contains local changes")
    elif (issue_keys := linear_work_map_issue_keys(state.get("body") or "")) is None:
        action = "AUDIT_TRACKER"
        evidence.append("PR lacks a complete Nohmi Linear Work map")
    elif not linear_coverage_complete(state, issue_keys):
        action = "AUDIT_TRACKER"
        evidence.append("PR Work map is not reconciled with live Nohmi Linear coverage")
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
