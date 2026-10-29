import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { readRuns, sourceDecision } from "./wait-source-ci.mjs";

const run = {
  pull_requests: [{ number: 42, base: { sha: "base" } }],
  id: 1,
  run_attempt: 1,
  head_sha: "candidate",
  event: "pull_request",
  status: "completed",
  conclusion: "success",
};
test("metadata cannot substitute for missing, pending, failed, or foreign source verification", () => {
  assert.equal(sourceDecision([], "candidate", "base", 42), "wait");
  assert.equal(sourceDecision([run], "candidate", "base", 42), "success");
  assert.equal(sourceDecision([run], "other", "base", 42), "wait");
  assert.equal(sourceDecision([{ ...run, event: "push" }], "candidate", "base", 42), "wait");
  assert.equal(
    sourceDecision([run, { ...run, id: 2, status: "in_progress" }], "candidate", "base", 42),
    "wait",
  );
  assert.equal(
    sourceDecision(
      [run, { ...run, run_attempt: 2, conclusion: "failure" }],
      "candidate",
      "base",
      42,
    ),
    "failure",
  );
  assert.equal(
    sourceDecision([{ ...run, conclusion: "cancelled" }], "candidate", "base", 42),
    "failure",
  );
});
test("different integration base cannot reuse source evidence", () => {
  assert.equal(sourceDecision([run], "candidate", "new-base", 42), "failure");
});
test("metadata changes cannot cancel source CI, and protected gate requires both", () => {
  const source = readFileSync(new URL("../workflows/ci.yml", import.meta.url), "utf8");
  const metadata = readFileSync(new URL("../workflows/pr-metadata.yml", import.meta.url), "utf8");
  assert.match(source, /types: \[opened, reopened, synchronize\]/);
  assert.doesNotMatch(source, /name: CI required/);
  assert.match(source, /name: Source verification/);
  assert.match(metadata, /types: \[edited, opened, ready_for_review, reopened, synchronize\]/);
  assert.match(metadata, /group: pr-metadata-/);
  assert.match(metadata, /name: CI required/);
  assert.match(
    readFileSync(new URL("./source-observation.mjs", import.meta.url), "utf8"),
    /check-pr-body.sh/,
  );
  assert.match(metadata, /wait-source-ci.mjs/);
});

test("another PR sharing the head cannot replace this PR's source evidence", () => {
  for (const conclusion of ["success", "failure", "cancelled"]) {
    const foreign = {
      ...run,
      id: 2,
      conclusion,
      pull_requests: [{ number: 99, base: { sha: "base" } }],
    };
    assert.equal(sourceDecision([foreign], "candidate", "base", 42), "wait");
    assert.equal(sourceDecision([run, foreign], "candidate", "base", 42), "success");
  }
  const changedBase = { ...run, id: 2, pull_requests: [{ number: 42, base: { sha: "new-base" } }] };
  assert.equal(sourceDecision([run, changedBase], "candidate", "base", 42), "failure");
});

test("provider reads recover once without restarting source verification", async () => {
  let reads = 0;
  const pauses = [];
  assert.deepEqual(
    await readRuns(
      () => {
        if (++reads === 1) throw new Error("temporary transport failure");
        return JSON.stringify({ workflow_runs: [run] });
      },
      async (ms) => {
        pauses.push(ms);
      },
    ),
    [run],
  );
  assert.equal(reads, 2);
  assert.deepEqual(pauses, [30000]);
  reads = 0;
  await assert.rejects(
    readRuns(
      () => {
        reads++;
        return "not JSON";
      },
      async () => {},
    ),
    /failed twice/,
  );
  assert.equal(reads, 2);
  await assert.rejects(
    readRuns(
      () => "{}",
      async () => {},
    ),
    /failed twice/,
  );
});
