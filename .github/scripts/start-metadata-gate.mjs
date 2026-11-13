import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const shaPattern = /^[a-f0-9]{40}$/u;

// Values reach `gh` as separate argv entries, never through a shell. The branch
// name is still attacker-influenced text: Git allows most punctuation, so reject
// only what could be read as an option, a ref expression or a control sequence.
const refName = (value) =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= 255 &&
  !value.startsWith("-") &&
  !value.includes("..") &&
  !/[\s\p{Cc}~^:?*[\\]/u.test(value);

export function dispatchArguments(env) {
  const number = Number(env.PR_NUMBER);
  if (
    !/^[\w.-]+\/[\w.-]+$/u.test(env.GH_REPO ?? "") ||
    !Number.isSafeInteger(number) ||
    number < 1 ||
    !refName(env.HEAD_REF) ||
    !shaPattern.test(env.PR_HEAD_SHA ?? "") ||
    !shaPattern.test(env.PR_BASE_SHA ?? "") ||
    !refName(env.PR_BASE_REF)
  )
    throw new Error("Missing candidate identity");
  return [
    "workflow",
    "run",
    "pr-metadata.yml",
    "--repo",
    env.GH_REPO,
    "--ref",
    env.HEAD_REF,
    "-f",
    `pr_number=${number}`,
    "-f",
    `head_sha=${env.PR_HEAD_SHA}`,
    "-f",
    `base_sha=${env.PR_BASE_SHA}`,
    "-f",
    `base_ref=${env.PR_BASE_REF}`,
  ];
}

// A branch that has not merged the base yet still carries the metadata workflow
// without a dispatch trigger. Branch protection already requires it to catch up.
export function predatesDispatch(stderr) {
  return /HTTP 422/u.test(stderr) && /workflow_dispatch/u.test(stderr);
}

// A Dependabot-triggered run can be held to a read-only token. A rate-limit 403
// is a different failure and is retried like any other.
export function readOnlyToken(stderr) {
  return /HTTP 403/u.test(stderr) && /Resource not accessible by integration/u.test(stderr);
}

// Starting the gate supplies no evidence, so failing to start it must not turn a
// verified source run red: that would force a complete rerun. Every outcome other
// than "started" leaves `CI required` absent, which blocks the merge until the
// gate is started by hand or by a description edit.
export function startGate(env, run = execFileSync, pause = () => {}) {
  let args;
  try {
    args = dispatchArguments(env);
  } catch {
    return "invalid";
  }
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      run("gh", args, { stdio: ["ignore", "pipe", "pipe"], timeout: 30000 });
      return "started";
    } catch (error) {
      const stderr = String(error?.stderr ?? "");
      if (predatesDispatch(stderr)) return "predates";
      if (readOnlyToken(stderr)) return "read-only";
      if (attempt === 0) pause();
    }
  }
  return "failed";
}

const recovery =
  "Run the PR metadata workflow on this branch with the pull request number, or edit the pull request description, to report CI required.";
export const notices = {
  started: "Metadata gate started for this candidate.",
  predates:
    "::warning title=Metadata gate not started::This branch predates the dispatched metadata gate. Catch up with the base branch and push; CI required is reported after that run.",
  "read-only": `::warning title=Metadata gate not started::This run's token cannot start workflows. ${recovery}`,
  invalid: `::error title=Metadata gate not started::The candidate identity could not be passed safely. ${recovery}`,
  failed: `::error title=Metadata gate not started::GitHub did not accept the request after one retry. ${recovery}`,
};

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  // Never print provider bodies or token-bearing command diagnostics.
  console.log(
    notices[
      startGate(process.env, execFileSync, () =>
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10000),
      )
    ],
  );
}
