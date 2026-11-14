import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  candidateIdentity,
  deferredDraft,
  draftRemedy,
  gateDecision,
  readRuns,
  sourceDecision,
} from "./wait-source-ci.mjs";

const proseScope = {
  prose_only: true,
  full: false,
  repo: true,
  terraform: false,
  node: false,
  database: false,
  browser: false,
  desktop: false,
  containers: false,
  dependencies: false,
  changed_packages: [],
};
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
  assert.match(source, /types: \[opened, ready_for_review, reopened, synchronize\]/);
  assert.match(source, /name: Source verification/);
  // An edit re-validates the Work map in its own workflow and never reruns source tests.
  assert.match(metadata, /^on:\n {2}pull_request:\n {4}types: \[edited\]\n\npermissions:/m);
  assert.match(metadata, /group: pr-metadata-/);
  assert.match(metadata, /name: CI required/);
  // Branch protection ignores job checks from dispatched runs and accepts a skipped
  // required job, so neither workflow may dispatch the gate or let it skip.
  for (const workflow of [source, metadata])
    assert.doesNotMatch(workflow, /workflow_dispatch|workflow_run|gh workflow run/);
  assert.doesNotMatch(metadata, /^\s+if:/m);
  assert.match(metadata, /permissions:\n {2}contents: read\n {2}actions: read\n/);
  // The source run reports the same context from its last job, which always runs.
  const gate = source.split("\n  gate:\n")[1];
  assert.ok(gate);
  assert.match(gate, /^ {4}name: CI required$/m);
  assert.match(gate, /^ {4}needs: \[changes, required\]$/m);
  assert.match(gate, /^ {4}if: \$\{\{ always\(\) && github.event_name == 'pull_request' \}\}$/m);
  assert.equal((gate.match(/^\s+if:/gm) ?? []).length, 1, "No step may skip inside the gate.");
  assert.match(gate, /SOURCE_RESULT: \$\{\{ needs.required.result \}\}/);
  assert.match(gate, /SOURCE_LANE: \$\{\{ needs.changes.outputs.lane \}\}/);
  assert.match(gate, /run: node \.github\/scripts\/wait-source-ci\.mjs --gate\n/);
  assert.doesNotMatch(gate, /continue-on-error|permissions:/);
  assert.equal((source.match(/name: CI required/g) ?? []).length, 1);
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

const head = "a".repeat(40);
const base = "b".repeat(40);
const identity = { GH_REPO: "owner/repo", PR_NUMBER: "42", PR_HEAD_SHA: head, PR_BASE_SHA: base };

test("the in-run gate accepts only a full-lane run whose aggregate succeeded", () => {
  assert.equal(gateDecision({ SOURCE_RESULT: "success", SOURCE_LANE: "full" }), undefined);
  assert.equal(gateDecision({ SOURCE_RESULT: "success", SOURCE_LANE: "fast" }), draftRemedy);
  assert.equal(gateDecision({ SOURCE_RESULT: "skipped", SOURCE_LANE: "fast" }), draftRemedy);
  for (const result of ["failure", "cancelled", "skipped", "", undefined, "SUCCESS"])
    assert.match(gateDecision({ SOURCE_RESULT: result, SOURCE_LANE: "full" }), /did not succeed/);
  // A classification that failed before choosing a lane can never be accepted.
  for (const lane of ["", undefined, "FULL", "other"])
    assert.ok(gateDecision({ SOURCE_RESULT: "success", SOURCE_LANE: lane }));
});

test("every gate event must name both commits and a valid PR", () => {
  const event = { ...identity, GITHUB_EVENT_NAME: "pull_request", PR_BASE_REF: "main" };
  assert.deepEqual(candidateIdentity(event), {
    repository: "owner/repo",
    number: 42,
    expected: { headSha: head, baseSha: base, baseRef: "main", retargeted: false },
  });
  assert.equal(candidateIdentity({ ...event, PR_RETARGETED: "true" }).expected.retargeted, true);
  for (const invalid of [
    { PR_BASE_SHA: "" },
    { PR_BASE_SHA: "main" },
    { PR_HEAD_SHA: "" },
    { PR_NUMBER: "0" },
    { PR_NUMBER: "1.5" },
    { GH_REPO: "" },
  ])
    assert.throws(() => candidateIdentity({ ...event, ...invalid }), /Missing candidate identity/);
});

test("only a fast-lane draft stops waiting, with the remedy", () => {
  const full = () => ({ ...proseScope, prose_only: false, repo: false, full: true });
  const prose = () => proseScope;
  const draft = { ...identity, PR_DRAFT: "true", PR_FULL: "false" };
  assert.equal(deferredDraft(draft, full), true);
  // Prose-only drafts defer nothing, so their source run reports normally.
  assert.equal(deferredDraft(draft, prose), false);
  assert.equal(deferredDraft({ ...draft, PR_FULL: "true" }, full), false);
  for (const value of ["false", "", undefined, "TRUE"])
    assert.equal(deferredDraft({ ...draft, PR_DRAFT: value }, full), false);
  assert.match(draftRemedy, /ready for review/);
  assert.match(draftRemedy, /ci:full/);
});
