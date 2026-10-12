import unittest
from unittest.mock import patch
from types import SimpleNamespace

from collect_evidence import CollectionError, GitHub, collect


class FakeGitHub:
    def __init__(self, changed=False):
        self.views = 0
        self.changed = changed

    def call(self, *args):
        if args[0] == "pr":
            self.views += 1
            return {"headRefOid": "b" if self.changed and self.views > 1 else "a", "baseRefName": "main"}
        if args[1].endswith("/protection"):
            raise CollectionError("unavailable")
        if args[1].endswith("/branches/main"):
            return {"commit": {"sha": "base"}}
        return {}

    def pages(self, endpoint, field=None):
        if "/check-runs" in endpoint:
            return [{"id": 1, "name": "CI", "head_sha": "a", "status": "completed",
                     "conclusion": "success", "app": {"id": 42}, "output": {"text": "private"}}]
        return []


class CollectorTest(unittest.TestCase):
    def test_deadline_and_provider_error_are_bounded_and_sanitized(self):
        client = GitHub()
        client.deadline = 0
        with self.assertRaises(CollectionError):
            client.call("api", "user")
        client = GitHub()
        with patch("collect_evidence.subprocess.run", return_value=SimpleNamespace(
                returncode=1, stdout="private-token", stderr="private-error")) as run:
            with self.assertRaisesRegex(CollectionError, "^github_request_failed$"):
                client.call("api", "user")
            self.assertLessEqual(run.call_args.kwargs["timeout"], 30)

    def test_partial_pagination_does_not_become_a_complete_source(self):
        client = FakeGitHub()
        def pages(*args, **kwargs):
            raise CollectionError("pagination_failed")
        client.pages = pages
        result = collect(client, "owner/repo", 1)
        self.assertNotIn("checks", result["sources"])
        self.assertIn("checks", [gap["source"] for gap in result["gaps"]])

    def test_missing_authority_remains_gap_and_body_is_not_saved(self):
        result = collect(FakeGitHub(), "owner/repo", 1)
        self.assertTrue(result["stable"])
        self.assertEqual(result["gaps"][0]["source"], "protection")
        self.assertEqual(result["sources"]["checks"][0]["appId"], 42)
        self.assertNotIn("private", str(result))
        self.assertNotIn("rulesVerified", str(result))

    def test_same_head_runs_preserve_distinct_pr_and_base_associations(self):
        client = FakeGitHub()
        original = client.pages
        def pages(endpoint, field=None):
            if "/actions/runs?" in endpoint:
                return [{"id": i, "head_sha": "a", "event": "pull_request",
                         "pull_requests": [{"number": number, "base": {"sha": base, "ref": "main", "private": "omit"},
                                            "head": {"sha": "a", "ref": "feature"}}]}
                        for i, number, base in [(1, 1, "base"), (2, 2, "base"), (3, 1, "other-base")]]
            return original(endpoint, field)
        client.pages = pages
        rows = collect(client, "owner/repo", 1)["sources"]["runs"]
        self.assertEqual([(r["pull_requests"][0]["number"], r["pull_requests"][0]["base"]["sha"]) for r in rows],
                         [(1, "base"), (2, "base"), (1, "other-base")])
        self.assertTrue(all(r["pull_requests"][0]["head"]["sha"] == "a" for r in rows))
        self.assertNotIn("private", str(rows))

    def test_head_change_invalidates_collection(self):
        result = collect(FakeGitHub(changed=True), "owner/repo", 1)
        self.assertFalse(result["stable"])

    def test_pagination_collects_all_pages_and_bounds_endless_provider(self):
        client = GitHub()
        calls = []
        def call(*args):
            calls.append(args)
            return [1] * (100 if len(calls) == 1 else 1)
        client.call = call
        self.assertEqual(len(client.pages("endpoint")), 101)
        client.call = lambda *args: [1] * 100
        with self.assertRaises(CollectionError):
            client.pages("endpoint")


if __name__ == "__main__":
    unittest.main()
