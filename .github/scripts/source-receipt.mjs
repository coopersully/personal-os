import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { classifyGitChanges, expectedJobs } from "./ci-scope.mjs";

export const MAX_RECEIPT_BYTES = 16384;
export const MAX_ARCHIVE_BYTES = 65536;
export const sha256 = (value) => createHash("sha256").update(value).digest("hex");
export const digestPattern = /^[a-f0-9]{64}$/u;
export const shaPattern = /^[a-f0-9]{40}$/u;

export function selectedJobNames(scope) {
  const ids = expectedJobs(scope);
  if (!ids) throw new Error("Invalid canonical source scope");
  const names = {
    changes: ["Classify changes"],
    infrastructure: ["Terraform"],
    repository: ["Repository contracts"],
    "lint-and-format": ["Lint and format"],
    quality: ["Node quality"],
    browser: ["desktop-chromium", "mobile-chromium"].flatMap((project) =>
      [1, 2, 3, 4].map((shard) => `Browser acceptance (${project}, ${shard}/4)`),
    ),
    desktop: ["Desktop (macos-14)", "Desktop (windows-latest)"],
  };
  return [...ids.flatMap((id) => names[id]), "Source verification"];
}

export function createReceipt(event, env, scope, read = readFileSync) {
  const pr = event.pull_request;
  const runId = Number(env.GITHUB_RUN_ID);
  const runAttempt = Number(env.GITHUB_RUN_ATTEMPT);
  if (
    env.GITHUB_EVENT_NAME !== "pull_request" ||
    !pr ||
    event.repository?.full_name !== env.GITHUB_REPOSITORY ||
    !Number.isSafeInteger(event.repository.id) ||
    !Number.isSafeInteger(pr.number) ||
    ![runId, runAttempt].every((id) => Number.isSafeInteger(id) && id > 0) ||
    ![pr.head?.sha, pr.base?.sha, env.GITHUB_SHA, env.GITHUB_WORKFLOW_SHA].every((sha) =>
      shaPattern.test(sha ?? ""),
    ) ||
    env.GITHUB_WORKFLOW_REF !==
      `${env.GITHUB_REPOSITORY}/.github/workflows/ci.yml@refs/pull/${pr.number}/merge` ||
    !expectedJobs(scope)
  )
    throw new Error("Invalid source event identity");
  return {
    schemaVersion: 1,
    repository: env.GITHUB_REPOSITORY,
    repositoryId: event.repository.id,
    number: pr.number,
    headSha: pr.head.sha,
    baseSha: pr.base.sha,
    baseRef: pr.base.ref,
    event: "pull_request",
    runId,
    runAttempt,
    mergeSha: env.GITHUB_SHA,
    workflowSha: env.GITHUB_WORKFLOW_SHA,
    workflowRef: env.GITHUB_WORKFLOW_REF,
    workflowSha256: sha256(read(".github/workflows/ci.yml")),
    classifierSha256: sha256(read(".github/scripts/ci-scope.mjs")),
    forceFull: pr.labels?.some((label) => label.name === "ci:full") === true,
    scope,
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"));
  const scope = classifyGitChanges(event.pull_request?.base?.sha, event.pull_request?.head?.sha, {
    forceFull: event.pull_request?.labels?.some((label) => label.name === "ci:full"),
  });
  const receipt = JSON.stringify(createReceipt(event, process.env, scope));
  if (Buffer.byteLength(receipt) > MAX_RECEIPT_BYTES) throw new Error("Source receipt too large");
  writeFileSync(process.argv[2], receipt, { mode: 0o600 });
}
