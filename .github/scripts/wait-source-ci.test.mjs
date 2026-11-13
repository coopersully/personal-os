import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  candidateIdentity,
  deferredDraft,
  draftRemedy,
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
  assert.doesNotMatch(source, /name: CI required/);
  assert.match(source, /name: Source verification/);
  // Source CI starts the gate when it has a result; an edit re-validates the Work map.
  assert.match(metadata, /pull_request:\n {4}types: \[edited\]\n {2}workflow_dispatch:/);
  assert.match(source, /run: node \.github\/scripts\/start-metadata-gate\.mjs/);
  assert.match(metadata, /group: pr-metadata-/);
  assert.match(metadata, /name: CI required/);
  // A skipped required job passes branch protection: the gate has no job or step condition.
  assert.doesNotMatch(metadata, /^\s+if:/m);
  assert.match(
    metadata,
    /PR_HEAD_SHA: \$\{\{ github.event.pull_request.head.sha \|\| github.sha \}\}/,
  );
  assert.match(metadata, /permissions:\n {2}contents: read\n {2}actions: read\n/);
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

test("a dispatched gate reports only on the commit it was started for", () => {
  const dispatched = { ...identity, GITHUB_EVENT_NAME: "workflow_dispatch", GITHUB_SHA: head };
  assert.deepEqual(candidateIdentity(dispatched).expected, {
    headSha: head,
    baseSha: base,
    baseRef: undefined,
    retargeted: false,
  });
  // A hand-started gate may omit the base; the observation still binds the live one.
  assert.equal(candidateIdentity({ ...dispatched, PR_BASE_SHA: "" }).expected.baseSha, undefined);
  // Source CI names the head it verified; a branch that moved since must not report.
  assert.equal(
    candidateIdentity({ ...dispatched, PR_DISPATCHED_HEAD_SHA: head }).expected.headSha,
    head,
  );
  assert.throws(
    () => candidateIdentity({ ...dispatched, PR_DISPATCHED_HEAD_SHA: base }),
    /Branch moved after its source run/,
  );
  for (const foreign of [base, "", undefined])
    assert.throws(
      () => candidateIdentity({ ...dispatched, GITHUB_SHA: foreign }),
      /not bound to its own commit/,
    );
});

test("pull request events must still name both commits and a valid PR", () => {
  const event = { ...identity, GITHUB_EVENT_NAME: "pull_request", GITHUB_SHA: "c".repeat(40) };
  assert.equal(candidateIdentity(event).number, 42);
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
  assert.throws(
    () =>
      candidateIdentity({ ...identity, GITHUB_EVENT_NAME: "workflow_dispatch", PR_HEAD_SHA: "" }),
    /Missing candidate identity/,
  );
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
