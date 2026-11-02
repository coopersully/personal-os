"""Read-only GitHub evidence bundle. Missing sources remain explicit gaps, never readiness."""

import argparse
import json
import os
import hashlib
import subprocess
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import quote

from checkpoint import atomic_write


class CollectionError(Exception):
    pass


class GitHub:
    def __init__(self):
        self.deadline = time.monotonic() + 180

    def call(self, *args):
        remaining = self.deadline - time.monotonic()
        if remaining <= 0:
            raise CollectionError("collection_deadline")
        try:
            value = subprocess.run(["gh", *args], capture_output=True, text=True,
                                   timeout=min(30, remaining), check=False)
            if value.returncode:
                # Provider stderr may contain private payloads. Keep diagnostics out of the bundle.
                raise CollectionError("github_request_failed")
            return json.loads(value.stdout)
        except (subprocess.TimeoutExpired, OSError, json.JSONDecodeError) as error:
            raise CollectionError(type(error).__name__) from error

    def observe_source(self, repository, number, head, base, base_ref):
        remaining = self.deadline - time.monotonic()
        if remaining <= 0:
            raise CollectionError("collection_deadline")
        script = Path(__file__).resolve().parents[4] / ".github/scripts/wait-source-ci.mjs"
        try:
            value = subprocess.run(["node", str(script), "--collect"], capture_output=True,
                                   text=True, timeout=min(120, remaining), check=False,
                                   env={**os.environ, "GH_REPO": repository, "PR_NUMBER": str(number),
                                        "PR_HEAD_SHA": head, "PR_BASE_SHA": base, "PR_BASE_REF": base_ref})
            if value.returncode:
                raise CollectionError("source_observation_failed")
            return json.loads(value.stdout)
        except (subprocess.TimeoutExpired, OSError, json.JSONDecodeError) as error:
            raise CollectionError("source_observation_unavailable") from error

    def pages(self, endpoint, field=None):
        items = []
        for page in range(1, 101):
            separator = "&" if "?" in endpoint else "?"
            value = self.call("api", f"{endpoint}{separator}per_page=100&page={page}")
            rows = value[field] if field else value
            if not isinstance(rows, list):
                raise CollectionError("invalid_page")
            items.extend(rows)
            if len(rows) < 100:
                return items
        raise CollectionError("pagination_limit")


def pick(value, names):
    return {name: value.get(name) for name in names.split()}


def collect(client, repository, number):
    prefix = f"repos/{repository}"
    fields = "number,url,state,isDraft,headRefOid,baseRefName,mergeable,mergeStateStatus,reviewDecision,body"
    def pr():
        value = client.call("pr", "view", str(number), "--repo", repository, "--json", fields)
        body = value.pop("body", "") or ""
        value["bodySha256"] = hashlib.sha256(body.encode()).hexdigest()
        return value

    first = pr()
    head = first["headRefOid"]
    branch = quote(first["baseRefName"], safe="")
    base_endpoint = f"{prefix}/branches/{branch}"
    base = client.call("api", base_endpoint)["commit"]["sha"]
    bundle = {"schemaVersion": 1, "repository": repository, "pr": first,
              "headSha": head, "baseSha": base, "sources": {}, "gaps": []}

    def source(name, read):
        try:
            bundle["sources"][name] = read()
        except (CollectionError, KeyError, TypeError) as error:
            bundle["gaps"].append({"source": name, "reason": type(error).__name__})

    source("actor", lambda: pick(client.call("api", "user"), "id login"))
    source("repository", lambda: pick(client.call("api", prefix), "id full_name html_url permissions allow_squash_merge"))
    source("protection", lambda: client.call("api", f"{base_endpoint}/protection"))
    source("rules", lambda: client.pages(f"{prefix}/rules/branches/{branch}"))

    def checks():
        rows = client.pages(f"{prefix}/commits/{head}/check-runs?filter=all", "check_runs")
        return [{**pick(row, "id name head_sha status conclusion details_url started_at completed_at"),
                 "appId": (row.get("app") or {}).get("id"),
                 "suiteId": (row.get("check_suite") or {}).get("id")} for row in rows]

    source("checks", checks)
    source("statuses", lambda: [pick(row, "id context state target_url created_at updated_at")
                                for row in client.pages(f"{prefix}/commits/{head}/statuses")])
    def runs():
        rows = client.pages(f"{prefix}/actions/runs?head_sha={head}", "workflow_runs")
        return [{**pick(row, "id workflow_id run_attempt event head_sha status conclusion html_url check_suite_id"),
                 "pull_requests": [{"number": pr.get("number"),
                                    "base": pick(pr.get("base") or {}, "sha ref"),
                                    "head": pick(pr.get("head") or {}, "sha ref")}
                                   for pr in (row.get("pull_requests") or [])]}
                for row in rows]
    source("runs", runs)
    source("sourceObservation", lambda: client.observe_source(
        repository, number, head, base, first["baseRefName"]))
    source("reviews", lambda: [{**pick(row, "id state commit_id submitted_at html_url"),
                                "author": pick(row.get("user") or {}, "id login type")}
                               for row in client.pages(f"{prefix}/pulls/{number}/reviews")])
    # These inventories intentionally omit comment bodies; inspect source URLs with the feedback workflow.
    source("comments", lambda: [pick(row, "id html_url updated_at")
                                for row in client.pages(f"{prefix}/issues/{number}/comments")])
    last = pr()
    last_base = client.call("api", base_endpoint)["commit"]["sha"]
    bundle["stable"] = first == last and base == last_base
    if not bundle["stable"]:
        bundle["gaps"].append({"source": "candidate", "reason": "changed_during_collection"})
    bundle["collectedAt"] = datetime.now(timezone.utc).isoformat()
    return bundle


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", required=True, help="Exact owner/repository")
    parser.add_argument("--pr", required=True, type=int)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    if args.pr < 1 or len(args.repo.split("/")) != 2:
        parser.error("An exact repository and positive PR number are required")
    bundle = collect(GitHub(), args.repo, args.pr)
    atomic_write(args.output, bundle)
    print(json.dumps({"output": str(args.output), "stable": bundle["stable"], "gaps": bundle["gaps"]}))


if __name__ == "__main__":
    main()
