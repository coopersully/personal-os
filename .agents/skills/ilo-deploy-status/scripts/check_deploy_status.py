import argparse
import json
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path

ENDPOINTS = {
    "app": "https://app.ilo.coopersully.me",
    "api": "https://api.ilo.coopersully.me/health/ready",
    "mcp": "https://mcp.ilo.coopersully.me/health/live",
}


def command_json(args):
    result = subprocess.run(args, text=True, capture_output=True, check=False, timeout=30)
    if result.returncode:
        return {"error": result.stderr.strip() or result.stdout.strip()}
    try:
        return json.loads(result.stdout)
    except json.JSONDecodeError as error:
        return {"error": str(error)}


def endpoint(url):
    request = urllib.request.Request(url, headers={"User-Agent": "ilo-deploy-status"})
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            return {"url": url, "ok": 200 <= response.status < 400, "status": response.status}
    except (urllib.error.URLError, TimeoutError, OSError) as error:
        return {"url": url, "ok": False, "error": str(error)}


def verdict(main_sha, production_status, deploy_runs, endpoints):
    if any(not value.get("ok") for value in endpoints.values()):
        return "unhealthy"
    latest = deploy_runs[0] if isinstance(deploy_runs, list) and deploy_runs else {}
    if latest.get("status") in {"queued", "in_progress", "pending", "waiting"}:
        return "in_progress"
    if latest.get("headSha") == main_sha and latest.get("conclusion") == "failure":
        return "deploy_failed"
    state = production_status.get("state")
    deployed_sha = production_status.get("sha")
    if state in {"failure", "error"}:
        return "deploy_failed"
    if state == "success" and deployed_sha == main_sha:
        return "live"
    if state == "success" and deployed_sha:
        return "not_live"
    return "unknown"


def production_commit_status(repo, sha):
    payload = command_json(["gh", "api", f"repos/{repo}/commits/{sha}/status"])
    statuses = payload.get("statuses", []) if isinstance(payload, dict) else []
    match = next((item for item in statuses if item.get("context") == "production/ilo"), {})
    return {
        "sha": sha if match else None,
        "state": match.get("state"),
        "url": match.get("target_url"),
        "description": match.get("description"),
    }


def collect(repo):
    repository = command_json(["gh", "repo", "view", repo, "--json", "nameWithOwner,defaultBranchRef"])
    full_name = repository.get("nameWithOwner", repo)
    branch = (repository.get("defaultBranchRef") or {}).get("name", "main")
    commit = command_json(["gh", "api", f"repos/{full_name}/commits/{branch}"])
    sha = commit.get("sha")
    runs_fields = "databaseId,status,conclusion,headSha,url,createdAt,updatedAt,event,displayTitle"
    deploy_runs = command_json(
        ["gh", "run", "list", "--repo", full_name, "--workflow", "deploy.yml", "--limit", "10", "--json", runs_fields]
    )
    health_runs = command_json(
        ["gh", "run", "list", "--repo", full_name, "--workflow", "production-health.yml", "--limit", "5", "--json", runs_fields]
    )
    incidents = command_json(
        [
            "gh",
            "issue",
            "list",
            "--repo",
            full_name,
            "--state",
            "open",
            "--search",
            '"Production deployment is failing" in:title OR "Production health check is failing" in:title',
            "--json",
            "number,title,url,updatedAt",
        ]
    )
    endpoint_state = {name: endpoint(url) for name, url in ENDPOINTS.items()}
    status = production_commit_status(full_name, sha) if sha else {}
    successful_run = next(
        (
            run
            for run in deploy_runs
            if run.get("conclusion") == "success" and run.get("headSha")
        ),
        None,
    ) if isinstance(deploy_runs, list) else None
    if not status.get("state") and successful_run:
        status = {
            "state": "success",
            "sha": successful_run["headSha"],
            "url": successful_run.get("url"),
            "description": "Latest successful deploy workflow",
        }
    return {
        "repository": full_name,
        "defaultBranch": branch,
        "mainSha": sha,
        "productionStatus": status,
        "deployRuns": deploy_runs,
        "healthRuns": health_runs,
        "incidents": incidents,
        "endpoints": endpoint_state,
        "verdict": verdict(sha, status, deploy_runs, endpoint_state),
    }


def main(argv):
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
