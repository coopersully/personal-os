import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { sourceDecision } from "./wait-source-ci.mjs";

const run = {
  pull_requests: [{ base: { sha: "base" } }],
  id: 1,
  run_attempt: 1,
  head_sha: "candidate",
  event: "pull_request",
  status: "completed",
  conclusion: "success",
};
test("metadata cannot substitute for missing, pending, failed, or foreign source verification", () => {
  assert.equal(sourceDecision([], "candidate", "base"), "wait");
  assert.equal(sourceDecision([run], "candidate", "base"), "success");
  assert.equal(sourceDecision([run], "other", "base"), "wait");
  assert.equal(sourceDecision([{ ...run, event: "push" }], "candidate", "base"), "wait");
  assert.equal(
    sourceDecision([run, { ...run, id: 2, status: "in_progress" }], "candidate", "base"),
    "wait",
  );
  assert.equal(
    sourceDecision([run, { ...run, run_attempt: 2, conclusion: "failure" }], "candidate", "base"),
    "failure",
  );
  assert.equal(
    sourceDecision([{ ...run, conclusion: "cancelled" }], "candidate", "base"),
    "failure",
  );
});
test("different integration base cannot reuse source evidence", () => {
  assert.equal(sourceDecision([run], "candidate", "new-base"), "failure");
});
test("metadata changes cannot cancel source CI, and protected gate requires both", () => {
  const source = readFileSync(new URL("../workflows/ci.yml", import.meta.url), "utf8");
  const metadata = readFileSync(new URL("../workflows/pr-metadata.yml", import.meta.url), "utf8");
  assert.match(source, /types: \[opened, ready_for_review, reopened, synchronize\]/);
  assert.doesNotMatch(source, /name: CI required/);
  assert.match(source, /name: Source verification/);
  assert.match(metadata, /types: \[edited, opened, ready_for_review, reopened, synchronize\]/);
  assert.match(metadata, /group: pr-metadata-/);
  assert.match(metadata, /name: CI required/);
  assert.match(metadata, /check-pr-body.sh/);
  assert.match(metadata, /wait-source-ci.mjs/);
});
