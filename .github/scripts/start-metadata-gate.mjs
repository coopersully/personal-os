import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const shaPattern = /^[a-f0-9]{40}$/u;

// Values reach `gh` as separate argv entries, never through a shell. The branch
// name is still attacker-influenced text, so reject anything that could be read
// as an option or a ref expression.
export function dispatchArguments(env) {
  const number = Number(env.PR_NUMBER);
  if (
    !/^[\w.-]+\/[\w.-]+$/u.test(env.GH_REPO ?? "") ||
    !Number.isSafeInteger(number) ||
    number < 1 ||
    typeof env.HEAD_REF !== "string" ||
    !/^[\w./-]+$/u.test(env.HEAD_REF) ||
    env.HEAD_REF.startsWith("-") ||
    env.HEAD_REF.includes("..") ||
    !shaPattern.test(env.PR_BASE_SHA ?? "") ||
    typeof env.PR_BASE_REF !== "string" ||
    !/^[\w./-]+$/u.test(env.PR_BASE_REF)
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

// A Dependabot-triggered run can be held to a read-only token. The gate is then
// simply absent, which blocks the merge until a maintainer starts it.
export function readOnlyToken(stderr) {
  return /HTTP 403/u.test(stderr);
}

export function startGate(env, run = execFileSync, pause = () => {}) {
  const args = dispatchArguments(env);
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      run("gh", args, { stdio: ["ignore", "pipe", "pipe"], timeout: 30000 });
      return "started";
    } catch (error) {
      const stderr = String(error?.stderr ?? "");
      if (predatesDispatch(stderr)) return "predates";
      if (readOnlyToken(stderr)) return "read-only";
      if (attempt === 1) throw new Error("Metadata gate could not be started");
      pause();
    }
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    const outcome = startGate(process.env, execFileSync, () =>
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10000),
    );
    if (outcome === "predates")
      console.log(
        "::warning title=Metadata gate not started::This branch predates the dispatched metadata gate. Catch up with the base branch and push; CI required is reported after that run.",
      );
    else if (outcome === "read-only")
      console.log(
        "::warning title=Metadata gate not started::This run's token cannot start workflows. A maintainer can run the PR metadata workflow on this branch, or edit the pull request description, to report CI required.",
      );
    else console.log("Metadata gate started for this candidate.");
  } catch (error) {
    // Never print provider bodies or token-bearing command diagnostics.
    console.error(
      error instanceof Error ? error.message : "Metadata gate could not be started",
      "- rerun this job, or edit the pull request description to start the gate.",
    );
    process.exitCode = 1;
  }
}
