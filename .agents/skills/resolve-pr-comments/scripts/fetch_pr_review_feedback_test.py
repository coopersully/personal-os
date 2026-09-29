import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent))

import fetch_pr_review_feedback as feedback


class FakeGraphQLClient:
    def __init__(self):
        self.calls = []

    def graphql(self, query, variables):
        self.calls.append((query, dict(variables)))
        if "reviewThreads(first: 100" in query:
            return self.review_threads()
        if "node(id: $threadId)" in query:
            return self.thread_comments(variables)
        if "comments(first: 100" in query:
            return self.pr_comments(variables)
        if "reviews(first: 100" in query:
            return self.reviews()
        raise AssertionError(f"unexpected query: {query}")

    def pr_comments(self, variables):
        page_two = variables.get("after") == "comment-page-2"
        return {
            "data": {
                "repository": {
                    "pullRequest": {
                        "url": "https://github.com/coopersully/personal-os/pull/123",
                        "comments": {
                            "pageInfo": {
                                "hasNextPage": not page_two,
                                "endCursor": None if page_two else "comment-page-2",
                            },
                            "nodes": [
                                {
                                    "id": "IC_2" if page_two else "IC_1",
                                    "author": {"login": "reviewer-b" if page_two else "reviewer-a"},
                                    "authorAssociation": "MEMBER",
                                    "body": "Second page." if page_two else "Update the docs.",
                                    "createdAt": "2026-07-27T10:00:00Z",
                                    "url": "https://github.com/coopersully/personal-os/pull/123#issuecomment-1",
                                }
                            ],
                        },
                    }
                }
            }
        }

    def reviews(self):
        return {
            "data": {
                "repository": {
                    "pullRequest": {
                        "url": "https://github.com/coopersully/personal-os/pull/123",
                        "reviews": {
                            "pageInfo": {"hasNextPage": False, "endCursor": None},
                            "nodes": [
                                {
                                    "id": "PRR_1",
                                    "state": "CHANGES_REQUESTED",
                                    "author": {"login": "reviewer-c"},
                                    "authorAssociation": "MEMBER",
                                    "body": "Address the edge cases.",
                                    "createdAt": "2026-07-27T10:01:00Z",
                                    "submittedAt": "2026-07-27T10:02:00Z",
                                    "url": "https://github.com/coopersully/personal-os/pull/123#pullrequestreview-1",
                                },
                                {
                                    "id": "PRR_2",
                                    "state": "APPROVED",
                                    "author": {"login": "reviewer-d"},
                                    "authorAssociation": "MEMBER",
                                    "body": "",
                                    "createdAt": "2026-07-27T10:03:00Z",
                                    "submittedAt": "2026-07-27T10:04:00Z",
                                    "url": "https://github.com/coopersully/personal-os/pull/123#pullrequestreview-2",
                                },
                            ],
                        },
                    }
                }
            }
        }

    def review_threads(self):
        return {
            "data": {
                "repository": {
                    "pullRequest": {
                        "url": "https://github.com/coopersully/personal-os/pull/123",
                        "reviewThreads": {
                            "pageInfo": {"hasNextPage": False, "endCursor": None},
                            "nodes": [
                                {
                                    "id": "PRRT_1",
                                    "isResolved": False,
                                    "isOutdated": False,
                                    "path": "apps/api/example.ts",
                                    "line": 42,
                                    "comments": {
                                        "pageInfo": {
                                            "hasNextPage": True,
                                            "endCursor": "thread-page-2",
                                        },
                                        "nodes": [
                                            {
                                                "id": "PRRC_1",
                                                "author": {"login": "reviewer-e"},
                                                "authorAssociation": "MEMBER",
                                                "body": "Guard undefined.",
                                                "createdAt": "2026-07-27T10:05:00Z",
                                                "url": "https://github.com/coopersully/personal-os/pull/123#discussion_r1",
                                            }
                                        ],
                                    },
                                },
                                {
                                    "id": "PRRT_2",
                                    "isResolved": True,
                                    "isOutdated": False,
                                    "path": "apps/api/resolved.ts",
                                    "line": 7,
                                    "comments": {
                                        "pageInfo": {
                                            "hasNextPage": False,
                                            "endCursor": None,
                                        },
                                        "nodes": [
                                            {
                                                "id": "PRRC_3",
                                                "author": {"login": "reviewer-f"},
                                                "authorAssociation": "MEMBER",
                                                "body": "Already done.",
                                                "createdAt": "2026-07-27T10:06:00Z",
                                                "url": "https://github.com/coopersully/personal-os/pull/123#discussion_r3",
                                            }
                                        ],
                                    },
                                },
                            ],
                        },
                    }
                }
            }
        }

    def thread_comments(self, variables):
        self.assert_thread_variables(variables)
        return {
            "data": {
                "node": {
                    "comments": {
                        "pageInfo": {"hasNextPage": False, "endCursor": None},
                        "nodes": [
                            {
                                "id": "PRRC_2",
                                "author": {"login": "author"},
                                "authorAssociation": "MEMBER",
                                "body": "Fixed.",
                                "createdAt": "2026-07-27T10:07:00Z",
                                "url": "https://github.com/coopersully/personal-os/pull/123#discussion_r2",
                            }
                        ],
                    }
                }
            }
        }

    def assert_thread_variables(self, variables):
        if variables != {"threadId": "PRRT_1", "after": "thread-page-2"}:
            raise AssertionError(f"unexpected variables: {variables}")


class FeedbackTest(unittest.TestCase):
    def test_fetches_and_paginates_every_surface(self):
        client = FakeGraphQLClient()
        result = feedback.fetch_review_feedback(
            client, "coopersully", "personal-os", 123
        )

        self.assertEqual(result["counts"]["prComments"], 2)
        self.assertEqual(result["counts"]["reviewSummaries"], 1)
        self.assertEqual(result["counts"]["unresolvedReviewThreads"], 1)
        self.assertEqual(result["counts"]["items"], 4)
        self.assertEqual(
            [item["kind"] for item in result["items"]],
            ["review_thread", "pr_comment", "pr_comment", "review_summary"],
        )
        self.assertEqual(len(result["items"][0]["comments"]), 2)
        self.assertTrue(
            any(call[1].get("after") == "comment-page-2" for call in client.calls)
        )

    def test_include_resolved_keeps_resolved_threads(self):
        result = feedback.fetch_review_feedback(
            FakeGraphQLClient(),
            "coopersully",
            "personal-os",
            123,
            include_resolved=True,
        )
        thread_ids = [
            item["threadId"]
            for item in result["items"]
            if item["kind"] == "review_thread"
        ]
        self.assertEqual(thread_ids, ["PRRT_1", "PRRT_2"])

    def test_rejects_null_pull_request(self):
        with self.assertRaisesRegex(feedback.ScriptError, "pull request is missing"):
            feedback.pull_request(
                {"data": {"repository": {"pullRequest": None}}}
            )

    def test_graphql_errors_are_reported(self):
        completed = subprocess.CompletedProcess(
            ["gh"],
            0,
            stdout=json.dumps({"errors": [{"message": "No PR"}]}),
            stderr="",
        )
        with (
            mock.patch("subprocess.run", return_value=completed),
            self.assertRaisesRegex(feedback.ScriptError, "No PR"),
        ):
            feedback.GhGraphQLClient().graphql("query { viewer { login } }", {})

    def test_output_parent_is_created(self):
        payload = {"counts": {"items": 0}}
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / "nested" / "feedback.json"
            args = mock.Mock(
                owner="coopersully",
                repo="personal-os",
                pr=123,
                include_resolved=False,
                pretty=True,
                output=str(target),
            )
            with (
                mock.patch.object(feedback, "parse_args", return_value=args),
                mock.patch.object(feedback, "fetch_review_feedback", return_value=payload),
            ):
                feedback.main([])
            self.assertEqual(json.loads(target.read_text()), payload)


if __name__ == "__main__":
    unittest.main()
