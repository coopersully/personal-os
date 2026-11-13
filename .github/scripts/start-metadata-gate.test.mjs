import assert from "node:assert/strict";
import test from "node:test";
import {
  dispatchArguments,
  notices,
  predatesDispatch,
  readOnlyToken,
  startGate,
} from "./start-metadata-gate.mjs";

const env = {
  GH_REPO: "owner/repo",
  HEAD_REF: "claude/coo-1-example",
  PR_NUMBER: "42",
  PR_HEAD_SHA: "a".repeat(40),
  PR_BASE_SHA: "b".repeat(40),
  PR_BASE_REF: "main",
};
const missingTrigger =
  "could not create workflow dispatch event: HTTP 422: Workflow does not have 'workflow_dispatch' trigger";
const failing = (stderr, count) => () => {
  count.calls++;
  throw Object.assign(new Error("failed"), { stderr });
};

test("the gate is started on the candidate branch with the commits source CI tested", () => {
  assert.deepEqual(dispatchArguments(env), [
    "workflow",
    "run",
    "pr-metadata.yml",
    "--repo",
    "owner/repo",
    "--ref",
    "claude/coo-1-example",
    "-f",
    "pr_number=42",
    "-f",
    `head_sha=${"a".repeat(40)}`,
    "-f",
    `base_sha=${"b".repeat(40)}`,
    "-f",
    "base_ref=main",
  ]);
  // Git permits this punctuation; a legal branch must not lose its gate.
  for (const ref of ["dependabot/npm_and_yarn/@scope/pkg-1.0.0", "fix+more#1=x", "ünïcode"])
    assert.equal(dispatchArguments({ ...env, HEAD_REF: ref })[6], ref);
});

test("option-like, ref-expression or malformed identity runs no command", () => {
  for (const invalid of [
    { HEAD_REF: "--repo=other/repo" },
    { HEAD_REF: "a..b" },
    { HEAD_REF: "a b" },
    { HEAD_REF: "a\nb" },
    { HEAD_REF: "a:b" },
    { HEAD_REF: "a~1" },
    { HEAD_REF: "a^" },
    { HEAD_REF: "" },
    { HEAD_REF: undefined },
    { PR_NUMBER: "0" },
    { PR_NUMBER: "42; rm" },
    { PR_HEAD_SHA: "HEAD" },
    { PR_BASE_SHA: "main" },
    { PR_BASE_REF: "" },
    { PR_BASE_REF: "-x" },
    { GH_REPO: "owner" },
  ]) {
    const count = { calls: 0 };
    assert.throws(() => dispatchArguments({ ...env, ...invalid }), /Missing candidate identity/);
    assert.equal(
      startGate({ ...env, ...invalid }, () => count.calls++),
      "invalid",
    );
    assert.equal(count.calls, 0);
  }
});

test("a transient failure is retried once and a second failure is reported, not thrown", () => {
  let calls = 0;
  let pauses = 0;
  const flaky = () => {
    if (++calls === 1) throw Object.assign(new Error("failed"), { stderr: "HTTP 502" });
  };
  assert.equal(
    startGate(env, flaky, () => pauses++),
    "started",
  );
  assert.deepEqual([calls, pauses], [2, 1]);
  const count = { calls: 0 };
  // A rate-limit 403 is not a read-only token.
  for (const stderr of [Buffer.from("HTTP 500: secret detail"), "HTTP 403: secondary rate limit"]) {
    count.calls = 0;
    assert.equal(startGate(env, failing(stderr, count)), "failed");
    assert.equal(count.calls, 2);
  }
});

test("a branch without the trigger or a read-only token is recognised on the first response", () => {
  const count = { calls: 0 };
  assert.equal(startGate(env, failing(Buffer.from(missingTrigger), count)), "predates");
  assert.equal(
    startGate(env, failing("HTTP 403: Resource not accessible by integration", count)),
    "read-only",
  );
  assert.equal(count.calls, 2);
  assert.equal(predatesDispatch("HTTP 422: No ref found for: gone"), false);
  assert.equal(predatesDispatch("HTTP 404: workflow_dispatch"), false);
  assert.equal(readOnlyToken("HTTP 404: Resource not accessible by integration"), false);
});

test("every outcome has a notice, and none repeats provider output", () => {
  assert.deepEqual(Object.keys(notices).sort(), [
    "failed",
    "invalid",
    "predates",
    "read-only",
    "started",
  ]);
  for (const outcome of ["failed", "invalid"]) assert.match(notices[outcome], /^::error /);
  for (const outcome of ["predates", "read-only"]) assert.match(notices[outcome], /^::warning /);
});
