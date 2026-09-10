import argparse
import json
import subprocess
import sys
from pathlib import Path

PR_COMMENTS_QUERY = """
query($owner: String!, $repo: String!, $pr: Int!, $after: String) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $pr) {
      url
      comments(first: 100, after: $after) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id
          author { login }
          authorAssociation
          body
          createdAt
          url
        }
      }
    }
  }
}
"""


REVIEWS_QUERY = """
query($owner: String!, $repo: String!, $pr: Int!, $after: String) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $pr) {
      url
      reviews(first: 100, after: $after) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id
          state
          author { login }
          authorAssociation
          body
          createdAt
          submittedAt
          url
        }
      }
    }
  }
}
"""


REVIEW_THREADS_QUERY = """
query($owner: String!, $repo: String!, $pr: Int!, $after: String) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $pr) {
      url
      reviewThreads(first: 100, after: $after) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id
          isResolved
          isOutdated
          path
          line
          comments(first: 100) {
            pageInfo { hasNextPage endCursor }
            nodes {
              id
              author { login }
              authorAssociation
              body
              createdAt
              url
            }
          }
        }
      }
    }
  }
}
"""


THREAD_COMMENTS_QUERY = """
query($threadId: ID!, $after: String) {
  node(id: $threadId) {
    ... on PullRequestReviewThread {
      comments(first: 100, after: $after) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id
          author { login }
          authorAssociation
          body
          createdAt
          url
        }
      }
    }
  }
}
"""


GH_TIMEOUT_SECONDS = 30


class ScriptError(Exception):
    pass


def graphql_error_message(errors):
    messages = []
    for error in errors:
        if isinstance(error, dict):
            messages.append(error.get("message") or "unknown GraphQL error")
        else:
            messages.append(str(error))
    return "; ".join(messages)


def reject_graphql_errors(payload):
    if not isinstance(payload, dict):
        raise ScriptError("gh api graphql returned non-object JSON")
    errors = payload.get("errors") or []
    if errors:
        raise ScriptError(
            f"gh api graphql returned errors: {graphql_error_message(errors)}"
        )
    return payload


def run_process(args, command_label):
    try:
        return subprocess.run(
            args,
            text=True,
            capture_output=True,
            check=False,
            timeout=GH_TIMEOUT_SECONDS,
        )
    except subprocess.TimeoutExpired as error:
        raise ScriptError(
            f"{command_label} timed out after {GH_TIMEOUT_SECONDS}s"
        ) from error
    except OSError as error:
        raise ScriptError(f"failed to execute {command_label}: {error}") from error


class GhGraphQLClient:
    def graphql(self, query, variables):
        args = ["gh", "api", "graphql", "-f", f"query={query}"]
        for key, value in variables.items():
            if value is None:
                continue
            flag = "-F" if isinstance(value, int) else "-f"
            args.extend([flag, f"{key}={value}"])

        result = run_process(args, "gh api graphql")
        if result.returncode != 0:
            detail = result.stderr.strip() or result.stdout.strip()
            raise ScriptError(f"gh api graphql failed: {detail}")

        try:
            payload = json.loads(result.stdout)
        except json.JSONDecodeError as error:
            raise ScriptError(
                f"gh api graphql returned invalid JSON: {error}"
            ) from error
        return reject_graphql_errors(payload)


def run_gh_json(args):
    command_label = f"gh {' '.join(args)}"
    result = run_process(["gh", *args], command_label)
    if result.returncode != 0:
        detail = result.stderr.strip() or result.stdout.strip()
        raise ScriptError(f"{command_label} failed: {detail}")

    try:
        return json.loads(result.stdout)
    except json.JSONDecodeError as error:
        raise ScriptError(f"{command_label} returned invalid JSON: {error}") from error


def resolve_context(args):
    pr_number = args.pr
    owner = args.owner
    repo = args.repo

    if pr_number is None:
        pr_view = run_gh_json(["pr", "view", "--json", "number,url,headRefName"])
        pr_number = int(pr_view["number"])

    if owner is None or repo is None:
        repo_view = run_gh_json(["repo", "view", "--json", "owner,name"])
        owner = owner or repo_view["owner"]["login"]
        repo = repo or repo_view["name"]

    return owner, repo, pr_number


def pull_request(response):
    try:
        pr = response["data"]["repository"]["pullRequest"]
    except (KeyError, TypeError) as error:
        raise ScriptError(
            f"unexpected GraphQL response shape: missing {error}"
        ) from error
    if not isinstance(pr, dict):
        raise ScriptError("unexpected GraphQL response shape: pull request is missing")
    return pr


def page_nodes(client, query, variables, connection_name):
    nodes = []
    cursor = None
    pr_url = None

    while True:
        response = client.graphql(query, {**variables, "after": cursor})
        pr = pull_request(response)
        pr_url = pr_url or pr.get("url")
        try:
            connection = pr[connection_name]
            nodes.extend(connection["nodes"])
            page_info = connection["pageInfo"]
        except (KeyError, TypeError) as error:
            raise ScriptError(
                f"unexpected GraphQL response shape: missing {error}"
            ) from error

        if not page_info["hasNextPage"]:
            return nodes, pr_url
        cursor = page_info["endCursor"]


def fetch_thread_comments(client, thread_id, cursor):
    comments = []

    while cursor is not None:
        response = client.graphql(
            THREAD_COMMENTS_QUERY, {"threadId": thread_id, "after": cursor}
        )
        try:
            node = response["data"]["node"]
            connection = node["comments"]
        except (KeyError, TypeError) as error:
            raise ScriptError(
                f"unexpected GraphQL thread response shape: missing {error}"
            ) from error
        comments.extend(connection["nodes"])

        page_info = connection["pageInfo"]
        if not page_info["hasNextPage"]:
            break
        cursor = page_info["endCursor"]

    return comments


def fetch_review_threads(client, variables):
    threads, pr_url = page_nodes(
        client, REVIEW_THREADS_QUERY, variables, "reviewThreads"
    )
    for thread in threads:
        connection = thread["comments"]
        if connection["pageInfo"]["hasNextPage"]:
            connection["nodes"].extend(
                fetch_thread_comments(
                    client, thread["id"], connection["pageInfo"]["endCursor"]
                )
            )
            connection["pageInfo"] = {"hasNextPage": False, "endCursor": None}
    return threads, pr_url


def author_login(node):
    return (node.get("author") or {}).get("login")


def normalize_comment(comment):
    return {
        "id": comment["id"],
        "author": author_login(comment),
        "authorAssociation": comment.get("authorAssociation"),
        "body": comment.get("body") or "",
        "createdAt": comment.get("createdAt"),
        "url": comment.get("url"),
    }


def likely_noise_reason(item):
    body = (item.get("body") or "").strip().lower()
    author = (item.get("author") or "").lower()
    if not body:
        return "empty"
    if author in {"github-actions", "github-actions[bot]"} and (
        "do not edit" in body or "generated status" in body
    ):
        return "generated_status_comment"
    return None


def with_noise_fields(item):
    reason = likely_noise_reason(item)
    item["isLikelyNoise"] = reason is not None
    if reason is not None:
        item["noiseReason"] = reason
    return item


def normalize_review_thread(thread):
    comments = [normalize_comment(comment) for comment in thread["comments"]["nodes"]]
    latest_comment = comments[-1] if comments else {}
    return with_noise_fields(
        {
            "kind": "review_thread",
            "id": thread["id"],
            "threadId": thread["id"],
            "canResolve": True,
            "isResolved": thread["isResolved"],
            "isOutdated": thread["isOutdated"],
            "path": thread.get("path"),
            "line": thread.get("line"),
            "author": latest_comment.get("author"),
            "body": latest_comment.get("body", ""),
            "createdAt": latest_comment.get("createdAt"),
            "url": latest_comment.get("url"),
            "comments": comments,
        }
    )


def normalize_pr_comment(comment):
    return with_noise_fields(
        {
            "kind": "pr_comment",
            "id": comment["id"],
            "commentId": comment["id"],
            "canResolve": False,
            "author": author_login(comment),
            "authorAssociation": comment.get("authorAssociation"),
            "body": comment.get("body") or "",
            "createdAt": comment.get("createdAt"),
            "url": comment.get("url"),
        }
    )


def normalize_review_summary(review):
    return with_noise_fields(
        {
            "kind": "review_summary",
            "id": review["id"],
            "reviewId": review["id"],
            "canResolve": False,
            "reviewState": review.get("state"),
            "author": author_login(review),
            "authorAssociation": review.get("authorAssociation"),
            "body": review.get("body") or "",
            "createdAt": review.get("createdAt"),
            "submittedAt": review.get("submittedAt"),
            "url": review.get("url"),
        }
    )


def fetch_review_feedback(client, owner, repo, pr_number, include_resolved=False):
    variables = {"owner": owner, "repo": repo, "pr": pr_number}
    pr_comments, pr_url = page_nodes(
        client, PR_COMMENTS_QUERY, variables, "comments"
    )
    reviews, reviews_pr_url = page_nodes(client, REVIEWS_QUERY, variables, "reviews")
    review_threads, threads_pr_url = fetch_review_threads(client, variables)

    unresolved_threads = [thread for thread in review_threads if not thread["isResolved"]]
    resolved_threads = [thread for thread in review_threads if thread["isResolved"]]
    nonempty_reviews = [review for review in reviews if (review.get("body") or "").strip()]

    items = []
    for thread in review_threads:
        if include_resolved or not thread["isResolved"]:
            items.append(normalize_review_thread(thread))
    items.extend(normalize_pr_comment(comment) for comment in pr_comments)
    items.extend(normalize_review_summary(review) for review in nonempty_reviews)

    return {
        "repository": {"owner": owner, "name": repo},
        "pullRequest": {
            "number": pr_number,
            "url": pr_url
            or reviews_pr_url
            or threads_pr_url
            or f"https://github.com/{owner}/{repo}/pull/{pr_number}",
        },
        "counts": {
            "reviewThreads": len(review_threads),
            "unresolvedReviewThreads": len(unresolved_threads),
            "resolvedReviewThreads": len(resolved_threads),
            "prComments": len(pr_comments),
            "reviewSummaries": len(nonempty_reviews),
            "likelyNoise": len([item for item in items if item["isLikelyNoise"]]),
            "items": len(items),
        },
        "items": items,
    }


def parse_args(argv):
    parser = argparse.ArgumentParser(
        description="Fetch normalized PR review feedback with pagination."
    )
    parser.add_argument("--owner", help="GitHub owner. Defaults to gh repo view.")
    parser.add_argument("--repo", help="GitHub repository. Defaults to gh repo view.")
    parser.add_argument(
        "--pr",
        type=int,
        help="Pull request number. Defaults to gh pr view for the current branch.",
    )
    parser.add_argument(
        "--include-resolved",
        action="store_true",
        help="Include resolved inline review threads.",
    )
    parser.add_argument("--pretty", action="store_true", help="Pretty-print JSON.")
    parser.add_argument("--output", help="Write JSON to this path instead of stdout.")
    return parser.parse_args(argv)


def main(argv):
    args = parse_args(argv)
    owner, repo, pr_number = resolve_context(args)
    result = fetch_review_feedback(
        GhGraphQLClient(), owner, repo, pr_number, args.include_resolved
    )
    output = json.dumps(result, indent=2 if args.pretty else None)

    if args.output:
        output_path = Path(args.output)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(f"{output}\n", encoding="utf-8")
    else:
        print(output)


if __name__ == "__main__":
    try:
        main(sys.argv[1:])
    except ScriptError as error:
        print(f"error: {error}", file=sys.stderr)
        sys.exit(1)
