import argparse
import json
import subprocess
import sys
from pathlib import Path


class CollectionError(Exception):
    pass


def run(args):
    result = subprocess.run(args, text=True, capture_output=True, check=False, timeout=30)
    if result.returncode:
        raise CollectionError(result.stderr.strip() or result.stdout.strip())
    return result.stdout


def run_json(args):
    try:
        return json.loads(run(args))
    except json.JSONDecodeError as error:
        raise CollectionError(f"invalid JSON from {' '.join(args)}: {error}") from error


def protected_path(path):
    return (
        path.startswith((".github/", ".agents/", ".codex/", "infra/"))
        or path in {"package.json", "pnpm-lock.yaml", "AGENTS.md", "SECURITY.md"}
        or "migration" in path.lower()
    )


def collect(pr=None):
    fields = (
        "number,url,title,body,state,isDraft,baseRefName,headRefName,headRefOid,"
        "mergeable,mergeStateStatus,reviewDecision,statusCheckRollup,"
        "closingIssuesReferences,files,labels,commits"
    )
    command = ["gh", "pr", "view"]
    if pr:
        command.append(str(pr))
    command.extend(["--json", fields])
    data = run_json(command)
    paths = [item["path"] for item in data.get("files", [])]
    status = run(["git", "status", "--porcelain"]).splitlines()
    required_sections = [
        "## Overview",
        "## Why this change",
        "## What changed",
        "## Documentation",
        "## Verification",
    ]
    data["worktree"] = {"dirty": bool(status), "entries": status}
    data["changedPaths"] = paths
    data["protectedPaths"] = [path for path in paths if protected_path(path)]
    data["missingBodySections"] = [
        section for section in required_sections if section not in (data.get("body") or "")
    ]
    return data


def main(argv):
    parser = argparse.ArgumentParser()
    parser.add_argument("--pr")
    parser.add_argument("--output")
    parser.add_argument("--pretty", action="store_true")
    args = parser.parse_args(argv)
    payload = collect(args.pr)
    text = json.dumps(payload, indent=2 if args.pretty else None)
    if args.output:
        path = Path(args.output)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(f"{text}\n", encoding="utf-8")
    else:
        print(text)


if __name__ == "__main__":
    try:
        main(sys.argv[1:])
    except (CollectionError, subprocess.TimeoutExpired, OSError) as error:
        print(f"error: {error}", file=sys.stderr)
        sys.exit(1)
