import assert from "node:assert/strict";
import test from "node:test";
import {
  dispatchArguments,
  predatesDispatch,
  readOnlyToken,
  startGate,
} from "./start-metadata-gate.mjs";

const env = {
  GH_REPO: "owner/repo",
  HEAD_REF: "claude/coo-1-example",
  PR_NUMBER: "42",
  PR_BASE_SHA: "b".repeat(40),
  PR_BASE_REF: "main",
};
const missingTrigger =
  "could not create workflow dispatch event: HTTP 422: Workflow does not have 'workflow_dispatch' trigger";

test("the gate is started on the candidate branch with its tested base", () => {
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
    `base_sha=${"b".repeat(40)}`,
    "-f",
    "base_ref=main",
  ]);
});

test("option-like, traversal or malformed identity is rejected before any command", () => {
  for (const invalid of [
    { HEAD_REF: "--repo=other/repo" },
    { HEAD_REF: "a..b" },
    { HEAD_REF: "a b" },
    { HEAD_REF: "a;b" },
    { HEAD_REF: "" },
    { HEAD_REF: undefined },
    { PR_NUMBER: "0" },
    { PR_NUMBER: "42; rm" },
    { PR_BASE_SHA: "main" },
    { PR_BASE_REF: "" },
    { PR_BASE_REF: "$(id)" },
    { GH_REPO: "owner" },
  ]) {
    let calls = 0;
    assert.throws(
      () => startGate({ ...env, ...invalid }, () => calls++),
      /Missing candidate identity/,
    );
    assert.equal(calls, 0);
  }
});

test("a transient failure is retried once and a second failure is not masked", () => {
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
  calls = 0;
  assert.throws(
    () =>
      startGate(env, () => {
        calls++;
        throw Object.assign(new Error("failed"), {
          stderr: Buffer.from("HTTP 500: secret detail"),
        });
      }),
    (error) => error.message === "Metadata gate could not be started",
  );
  assert.equal(calls, 2);
});

test("only a branch without the dispatch trigger is reported as needing catch-up", () => {
  let calls = 0;
  const outcome = startGate(env, () => {
    calls++;
    throw Object.assign(new Error("failed"), { stderr: Buffer.from(missingTrigger) });
  });
  assert.deepEqual([outcome, calls], ["predates", 1]);
  assert.equal(predatesDispatch(missingTrigger), true);
  assert.equal(predatesDispatch("HTTP 422: No ref found for: gone"), false);
  assert.equal(predatesDispatch("HTTP 404: workflow_dispatch"), false);
  assert.equal(predatesDispatch(""), false);
});

test("a read-only token leaves the gate absent instead of failing source verification", () => {
  let calls = 0;
  const outcome = startGate(env, () => {
    calls++;
    throw Object.assign(new Error("failed"), {
      stderr: "HTTP 403: Resource not accessible by integration",
    });
  });
  assert.deepEqual([outcome, calls], ["read-only", 1]);
  assert.equal(readOnlyToken("HTTP 404: Not Found"), false);
});
