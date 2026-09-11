import argparse
import json
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path

ENDPOINTS = {
    "app": "https://nohmi.coopersully.me",
    "api": "https://nohmi-api.coopersully.me/health/ready",
    "mcp": "https://nohmi-mcp.coopersully.me/health/live",
}
CONTROLLER_STATUS_COMMAND = [
    "sudo",
    "-n",
    "-H",
    "-u",
    "nohmi-production",
    "node",
    "/Users/nohmi-production/controller/deploy/mac-mini/continuous-cli.mjs",
    "status",
    "/Users/nohmi-production/nohmi-production/config.json",
]
ACTIVE_CONTROLLER_PHASES = {"building", "quiescing", "resuming-previous", "switching"}


def command_json(args):
    """Run a bounded command and decode its JSON without raising collection failures."""
    try:
        result = subprocess.run(args, text=True, capture_output=True, check=False, timeout=30)
    except (subprocess.TimeoutExpired, OSError) as error:
        return {"collectionError": str(error)}
    if result.returncode:
        return {"collectionError": result.stderr.strip() or result.stdout.strip()}
    try:
        return json.loads(result.stdout)
    except json.JSONDecodeError as error:
        return {"collectionError": str(error)}


def endpoint(url):
    """Return a bounded public-health observation for one endpoint."""
    request = urllib.request.Request(url, headers={"User-Agent": "personal-os-deploy-status"})
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            return {"url": url, "ok": 200 <= response.status < 400, "status": response.status}
    except (urllib.error.URLError, TimeoutError, OSError) as error:
        return {"url": url, "ok": False, "error": str(error)}


def exact_main_run(main_sha, ci_runs):
    """Select only the CI push run whose head exactly matches current main."""
    if not isinstance(ci_runs, list):
        return {}
    return next((run for run in ci_runs if run.get("headSha") == main_sha), {})


def verdict(main_sha, ci_runs, controller_status, endpoints):
    """Classify health and release provenance without inferring a private revision."""
    if any(not value.get("ok") for value in endpoints.values()):
        return "unhealthy"
    if not controller_status.get("collectionError"):
        if controller_status.get("locked"):
            return "controller_locked"
        if controller_status.get("maintenance"):
            return "maintenance"
        controller_phase = controller_status.get("phase")
        if controller_phase == "blocked":
            return "controller_blocked"
        if controller_phase in ACTIVE_CONTROLLER_PHASES:
            return "controller_blocked"
    main_run = exact_main_run(main_sha, ci_runs)
    if main_run.get("status") in {"queued", "in_progress", "pending", "waiting"}:
        return "in_progress"
    if main_run.get("conclusion") in {
        "action_required",
        "cancelled",
        "failure",
        "stale",
        "timed_out",
    }:
        return "ci_failed"
    if controller_status.get("collectionError"):
        return "healthy_revision_unknown"
    if controller_status.get("error"):
        return "controller_retrying"
    deployed_sha = controller_status.get("deployed")
    if deployed_sha == main_sha and main_run.get("conclusion") == "success":
        return "live"
    if deployed_sha and main_run.get("conclusion") == "success":
        return "not_live"
    return "unknown"


def collect(repo):
    """Collect current GitHub, controller, and public endpoint evidence."""
    repository = command_json(["gh", "repo", "view", repo, "--json", "nameWithOwner,defaultBranchRef"])
    full_name = repository.get("nameWithOwner", repo)
    branch = (repository.get("defaultBranchRef") or {}).get("name", "main")
    commit = command_json(["gh", "api", f"repos/{full_name}/commits/{branch}"])
    sha = commit.get("sha")
    runs_fields = "databaseId,status,conclusion,headSha,url,createdAt,updatedAt,event,displayTitle"
    ci_runs = command_json(
        [
            "gh",
            "run",
            "list",
            "--repo",
            full_name,
            "--workflow",
            "ci.yml",
            "--branch",
            branch,
            "--event",
            "push",
            "--limit",
            "20",
            "--json",
            runs_fields,
        ]
    )
    endpoint_state = {name: endpoint(url) for name, url in ENDPOINTS.items()}
    controller_status = command_json(CONTROLLER_STATUS_COMMAND)
    return {
        "repository": full_name,
        "defaultBranch": branch,
        "mainSha": sha,
        "mainCi": exact_main_run(sha, ci_runs),
        "ciRuns": ci_runs,
        "controllerStatus": controller_status,
        "endpoints": endpoint_state,
        "verdict": verdict(sha, ci_runs, controller_status, endpoint_state),
    }


def main(argv):
    """Render a deployment-status snapshot to stdout or an explicit output path."""
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo", default="coopersully/personal-os")
    parser.add_argument("--output")
    parser.add_argument("--pretty", action="store_true")
    args = parser.parse_args(argv)
    payload = collect(args.repo)
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
    except (subprocess.TimeoutExpired, OSError) as error:
        print(f"error: {error}", file=sys.stderr)
        sys.exit(1)
