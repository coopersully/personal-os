import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import {
  digestPattern,
  MAX_ARCHIVE_BYTES,
  selectedJobNames,
  sha256,
  shaPattern,
} from "./source-receipt.mjs";

const root = fileURLToPath(new URL("../..", import.meta.url));
const fail = (reason) => {
  throw new Error(reason);
};
export class ObservationChanged extends Error {}

export class SourceClient {
  constructor(repository, number, budget = 120000) {
    if (!/^[\w.-]+\/[\w.-]+$/u.test(repository) || !Number.isSafeInteger(number) || number < 1)
      fail("Invalid repository/PR identity");
    this.repository = repository;
    this.number = number;
    this.prefix = `repos/${repository}`;
    this.deadline = Date.now() + budget;
  }

  command(command, args, options = {}) {
    const remaining = this.deadline - Date.now();
    if (remaining <= 0) fail("Source observation deadline exceeded");
    try {
      return execFileSync(command, args, {
        cwd: root,
        timeout: Math.min(15000, remaining),
        maxBuffer: 2 * 1024 * 1024,
        stdio: ["pipe", "pipe", "pipe"],
        ...options,
      });
    } catch {
      fail("Source observation unavailable; inspect provider access and retry");
    }
  }

  api(endpoint) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return JSON.parse(this.command("gh", ["api", `${this.prefix}/${endpoint}`]));
      } catch {
        if (attempt === 1) fail("Source API read failed twice or returned malformed data");
      }
    }
  }

  pages(endpoint, field) {
    const rows = [];
    for (let page = 1; page <= 3; page++) {
      const value = this.api(
        `${endpoint}${endpoint.includes("?") ? "&" : "?"}per_page=100&page=${page}`,
      );
      const entries = value[field];
      if (!Array.isArray(entries)) fail("Incomplete source inventory");
      rows.push(...entries);
      if (entries.length < 100 && rows.length === value.total_count) return rows;
      if (entries.length < 100) fail("Source inventory changed during pagination");
    }
    fail("Source pagination limit exceeded");
  }

  pr() {
    return this.api(`pulls/${this.number}`);
  }

  runs(workflowId, head) {
    return this.pages(
      `actions/workflows/${workflowId}/runs?event=pull_request&head_sha=${head}`,
      "workflow_runs",
    );
  }

  validateBody(body) {
    try {
      this.command("bash", [".codex/scripts/check-pr-body.sh"], {
        env: { ...process.env, PR_BODY: body },
      });
    } catch {
      fail("Current live Work map could not be validated; inspect metadata and retry");
    }
  }

  digests(head) {
    return Object.fromEntries(
      [
        ["workflowSha256", ".github/workflows/ci.yml"],
        ["classifierSha256", ".github/scripts/ci-scope.mjs"],
      ].map(([name, path]) => [name, sha256(this.command("git", ["show", `${head}:${path}`]))]),
    );
  }

  scope(base, head, forceFull) {
    // Never execute anything downloaded from the source receipt.
    const committed = this.command("git", ["show", `${head}:.github/scripts/ci-scope.mjs`]);
    const current = readFileSync(new URL("./ci-scope.mjs", import.meta.url));
    if (!committed.equals(current)) fail("Checked-out classifier differs from candidate");
    return JSON.parse(
      this.command(
        "node",
        [".github/scripts/ci-scope.mjs", "--base", base, "--head", head, "--json"],
        { env: { ...process.env, CI_FULL: String(forceFull) } },
      ),
    );
  }

  receipt(artifact) {
    if (
      !Number.isSafeInteger(artifact.id) ||
      artifact.id < 1 ||
      artifact.expired ||
      !Number.isSafeInteger(artifact.size_in_bytes) ||
      artifact.size_in_bytes > MAX_ARCHIVE_BYTES ||
      !/^sha256:[a-f0-9]{64}$/u.test(artifact.digest ?? "")
    )
      fail("Source receipt artifact identity/size invalid");
    const raw = this.command("gh", ["api", `${this.prefix}/actions/artifacts/${artifact.id}/zip`], {
      maxBuffer: MAX_ARCHIVE_BYTES,
    });
    if (`sha256:${sha256(raw)}` !== artifact.digest) fail("Source artifact digest mismatch");
    return JSON.parse(
      this.command("python3", [".github/scripts/read-source-receipt.py"], {
        input: raw,
        maxBuffer: 128 * 1024,
      }),
    );
  }
}

function tuple(pr, repository, number) {
  if (
    pr.state !== "open" ||
    pr.number !== number ||
    pr.base?.repo?.full_name !== repository ||
    !Number.isSafeInteger(pr.base.repo.id) ||
    !shaPattern.test(pr.head?.sha ?? "") ||
    !shaPattern.test(pr.base.sha ?? "") ||
    typeof pr.base.ref !== "string" ||
    typeof pr.body !== "string" ||
    (pr.merge_commit_sha !== null &&
      (typeof pr.merge_commit_sha !== "string" || !shaPattern.test(pr.merge_commit_sha)))
  )
    fail("Live PR identity unavailable");
  return {
    repository,
    repositoryId: pr.base.repo.id,
    number,
    headSha: pr.head.sha,
    baseSha: pr.base.sha,
    baseRef: pr.base.ref,
    mergeSha: pr.merge_commit_sha,
    bodySha256: sha256(pr.body),
  };
}

export function latestRun(runs, identity, workflowId) {
  if (!Array.isArray(runs)) fail("Source inventory incomplete");
  // This endpoint is already constrained to the canonical workflow/head/event. Unknown
  // associations cannot be silently excluded in favor of an older green candidate.
  for (const run of runs) {
    if (
      run.head_sha !== identity.headSha ||
      run.event !== "pull_request" ||
      run.workflow_id !== workflowId ||
      run.repository?.full_name !== identity.repository ||
      run.repository?.id !== identity.repositoryId ||
      ![run.id, run.run_attempt].every((id) => Number.isSafeInteger(id) && id > 0) ||
      !Array.isArray(run.pull_requests) ||
      !run.pull_requests.length ||
      run.pull_requests.some((pr) => !Number.isSafeInteger(pr.number) || pr.number < 1)
    )
      fail("Canonical source inventory identity incomplete");
  }
  return runs
    .filter((run) => run.pull_requests.some((pr) => pr.number === identity.number))
    .sort((a, b) => b.id - a.id || b.run_attempt - a.run_attempt)[0];
}

const runState = (run) =>
  run && {
    id: run.id,
    workflowId: run.workflow_id,
    attempt: run.run_attempt,
    head: run.head_sha,
    event: run.event,
    status: run.status,
    conclusion: run.conclusion,
  };

export function validateReceipt(receipt, identity, run, workflow, digests, scope) {
  const expected = {
    schemaVersion: 1,
    repository: identity.repository,
    repositoryId: identity.repositoryId,
    number: identity.number,
    headSha: identity.headSha,
    baseSha: identity.baseSha,
    baseRef: identity.baseRef,
    event: "pull_request",
    runId: run.id,
    runAttempt: run.run_attempt,
    mergeSha: identity.mergeSha,
    workflowSha: identity.mergeSha,
    workflowRef: `${identity.repository}/.github/workflows/ci.yml@refs/pull/${identity.number}/merge`,
    ...digests,
    forceFull: receipt.forceFull,
    scope,
  };
  if (
    typeof receipt.forceFull !== "boolean" ||
    !shaPattern.test(receipt.mergeSha ?? "") ||
    !isDeepStrictEqual(receipt, expected) ||
    !Number.isSafeInteger(workflow.id) ||
    !Object.values(digests).every((digest) => digestPattern.test(digest))
  )
    fail("Source receipt does not bind the live candidate; catch up and push a genuine candidate");
}

function mergeCommitEvidence(client, sourceSha, identity) {
  if (sourceSha === identity.mergeSha) return undefined;
  const read = (sha) => {
    const url = `https://api.github.com/repos/${identity.repository}/git/commits/${sha}`;
    const value = client.api(`git/commits/${sha}`);
    if (
      value?.sha !== sha ||
      value.url !== url ||
      !shaPattern.test(value.tree?.sha ?? "") ||
      !Array.isArray(value.parents) ||
      !isDeepStrictEqual(
        value.parents.map((parent) => parent?.sha),
        [identity.baseSha, identity.headSha],
      )
    )
      fail("Synthetic merge commit identity/content unavailable");
    return {
      sha,
      treeSha: value.tree.sha,
      parentShas: value.parents.map((parent) => parent.sha),
      url,
    };
  };
  const sourceCommit = read(sourceSha);
  const liveCommit = read(identity.mergeSha);
  if (sourceCommit.treeSha !== liveCommit.treeSha)
    fail("Synthetic merge commit content changed; obtain current source verification");
  return { provider: "github-rest", repository: identity.repository, sourceCommit, liveCommit };
}

export function validateJobs(jobs, run, scope) {
  return selectedJobNames(scope).map((name) => {
    const matches = jobs.filter((job) => job.name === name);
    if (
      matches.length !== 1 ||
      !Number.isSafeInteger(matches[0].id) ||
      matches[0].id < 1 ||
      matches[0].run_id !== run.id ||
      matches[0].run_attempt !== run.run_attempt ||
      matches[0].head_sha !== run.head_sha ||
      matches[0].status !== "completed" ||
      matches[0].conclusion !== "success"
    )
      fail("Selected source job missing or not successful in current attempt");
    return { id: matches[0].id, name, conclusion: "success" };
  });
}

export function observeSource(client, expected = {}) {
  if (expected.retargeted)
    fail("Retargeted metadata event is stale; catch up and push a genuine candidate");
  const firstPr = client.pr();
  const identity = tuple(firstPr, client.repository, client.number);
  for (const field of ["headSha", "baseSha", "baseRef"]) {
    if (expected[field] && expected[field] !== identity[field])
      fail("PR integration context changed; catch up and push a genuine candidate");
  }
  client.validateBody(firstPr.body);
  const workflow = client.api("actions/workflows/ci.yml");
  if (
    !Number.isSafeInteger(workflow.id) ||
    workflow.path !== ".github/workflows/ci.yml" ||
    workflow.state !== "active"
  )
    fail("Canonical source workflow unavailable");
  const run = latestRun(client.runs(workflow.id, identity.headSha), identity, workflow.id);
  let result = { schemaVersion: 1, ...identity, state: "pending", stable: true };
  if (run) {
    // Association metadata is only a negative stale hint, never positive event provenance.
    if (
      run.pull_requests.some(
        (pr) =>
          pr.number === identity.number &&
          (pr.base?.sha !== identity.baseSha ||
            pr.base?.ref !== identity.baseRef ||
            pr.head?.sha !== identity.headSha),
      )
    )
      fail("Latest source integration context is stale; catch up and push a genuine candidate");
    result = {
      ...result,
      workflowId: workflow.id,
      runId: run.id,
      runAttempt: run.run_attempt,
      event: run.event,
    };
    if (run.status === "completed" && run.conclusion !== "success")
      fail("Latest source run failed/canceled; inspect that attempt");
    // GitHub may temporarily return null while calculating mergeability. Keep the
    // observation pending until a concrete merge identity can bind the receipt.
    if (run.status === "completed" && identity.mergeSha !== null) {
      const artifacts = client.pages(`actions/runs/${run.id}/artifacts`, "artifacts");
      const matching = artifacts.filter(
        (artifact) => artifact.name === `source-candidate-${run.id}-${run.run_attempt}`,
      );
      if (matching.length !== 1)
        fail("Current-attempt receipt missing; retry the full source run, then metadata");
      const artifact = matching[0];
      if (
        artifact.workflow_run?.id !== run.id ||
        artifact.workflow_run?.head_sha !== identity.headSha
      )
        fail("Artifact belongs to another source run");
      const receipt = client.receipt(artifact);
      if (typeof receipt?.forceFull !== "boolean") fail("Source event forceFull invalid");
      const scope = client.scope(identity.baseSha, identity.headSha, receipt.forceFull);
      // Keep the immutable source event identity; only separately verified Git objects may
      // establish that a regenerated live synthetic commit contains the same integration.
      validateReceipt(
        receipt,
        { ...identity, mergeSha: receipt.mergeSha },
        run,
        workflow,
        client.digests(identity.headSha),
        scope,
      );
      const integration = mergeCommitEvidence(client, receipt.mergeSha, identity);
      const jobs = validateJobs(
        client.pages(`actions/runs/${run.id}/attempts/${run.run_attempt}/jobs`, "jobs"),
        run,
        scope,
      );
      result = {
        ...result,
        state: "success",
        forceFull: receipt.forceFull,
        receipt,
        ...(integration ? { mergeCommitEvidence: integration } : {}),
        artifact: { id: artifact.id, digest: artifact.digest },
        jobs,
      };
    }
    const attempt = client.api(`actions/runs/${run.id}/attempts/${run.run_attempt}`);
    const latest = latestRun(client.runs(workflow.id, identity.headSha), identity, workflow.id);
    if (
      !isDeepStrictEqual(runState(run), runState(attempt)) ||
      !isDeepStrictEqual(runState(run), runState(latest))
    )
      throw new ObservationChanged("Source run changed during observation");
  }
  if (!isDeepStrictEqual(identity, tuple(client.pr(), client.repository, client.number)))
    throw new ObservationChanged("PR/body changed during source observation");
  return result;
}

export function stableObservation(client, expected) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return observeSource(client, expected);
    } catch (error) {
      if (!(error instanceof ObservationChanged) || attempt === 1) throw error;
    }
  }
}
