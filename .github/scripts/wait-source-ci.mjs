import { pathToFileURL } from "node:url";
import { classifyGitChanges, sourceLane } from "./ci-scope.mjs";
import { SourceClient, stableObservation } from "./source-observation.mjs";

const shaPattern = /^[0-9a-f]{40}$/u;

// Source CI starts a dispatched gate with the base it tested. A person starting
// one by hand may omit it: the observation still binds the live base to the run.
// Every other event must name both commits.
export function candidateIdentity(env) {
  const number = Number(env.PR_NUMBER);
  const dispatched = env.GITHUB_EVENT_NAME === "workflow_dispatch";
  const base = env.PR_BASE_SHA ?? "";
  if (
    !Number.isSafeInteger(number) ||
    number < 1 ||
    !env.GH_REPO ||
    !shaPattern.test(env.PR_HEAD_SHA ?? "") ||
    !(shaPattern.test(base) || (dispatched && base === ""))
  )
    throw new Error("Missing candidate identity");
  // The check lands on the commit this run was started for; never report on another.
  if (dispatched && env.GITHUB_SHA !== env.PR_HEAD_SHA)
    throw new Error("Dispatched metadata gate is not bound to its own commit");
  return {
    repository: env.GH_REPO,
    number,
    expected: {
      headSha: env.PR_HEAD_SHA,
      baseSha: base || undefined,
      baseRef: env.PR_BASE_REF || undefined,
      retargeted: env.PR_RETARGETED === "true",
    },
  };
}

// A draft's fast-lane run never reports Source verification, so waiting on it
// would hold a runner for a result that cannot arrive. Source CI makes the same
// lane decision from the same classifier, including its fail-closed full scope.
export function deferredDraft(env, classify = classifyGitChanges) {
  if (env.PR_DRAFT !== "true" || env.PR_FULL === "true") return false;
  return sourceLane(classify(env.PR_BASE_SHA, env.PR_HEAD_SHA), { draft: true }) === "fast";
}

export const draftRemedy =
  "Draft candidates run the fast lane only. Mark the pull request ready for review, or add the ci:full label and push, to obtain source verification.";

export function sourceDecision(runs, head, base, number) {
  const applicable = runs
    .filter(
      (run) =>
        run.head_sha === head &&
        run.event === "pull_request" &&
        run.pull_requests?.some((pr) => pr.number === number),
    )
    .sort((a, b) => b.id - a.id || b.run_attempt - a.run_attempt);
  const latest = applicable[0];
  if (!latest) return "wait";
  if (!latest.pull_requests?.some((pr) => pr.number === number && pr.base?.sha === base))
    return "failure";
  if (latest.status !== "completed") return "wait";
  return latest.conclusion === "success" ? "success" : "failure";
}

export async function readRuns(
  read,
  pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = JSON.parse(read());
      if (!Array.isArray(response.workflow_runs)) throw new Error("Missing workflow runs");
      return response.workflow_runs;
    } catch {
      if (attempt === 1)
        throw new Error(
          "Source CI observation failed twice; inspect GitHub access before retrying",
        );
      console.warn("Source CI observation unavailable; retrying once in 30 seconds");
      await pause(30000);
    }
  }
}

async function main() {
  const { repository, number, expected } = candidateIdentity(process.env);
  // Collector snapshots use this same observer, without publishing a check or changing polling.
  if (process.argv.includes("--collect")) {
    process.stdout.write(
      `${JSON.stringify(stableObservation(new SourceClient(repository, number), expected))}\n`,
    );
    return;
  }
  const draft = deferredDraft(process.env);
  const started = Date.now();
  const deadline = started + 55 * 60 * 1000;
  while (Date.now() < deadline) {
    let observation;
    try {
      observation = stableObservation(
        new SourceClient(repository, number, Math.min(120000, deadline - Date.now())),
        expected,
      );
    } catch (error) {
      if (draft) console.error(draftRemedy);
      throw error;
    }
    if (observation.state === "success") return;
    if (draft) throw new Error(draftRemedy);
    // A dispatched gate starts seconds before its source run is marked complete.
    const interval = Date.now() - started < 120000 ? 10000 : 30000;
    await new Promise((resolve) =>
      setTimeout(resolve, Math.min(interval, Math.max(0, deadline - Date.now()))),
    );
  }
  throw new Error("Source CI did not finish within the metadata gate deadline");
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    await main();
  } catch (error) {
    // Never print provider bodies, PR text, signed artifact URLs or token-bearing command diagnostics.
    console.error(error instanceof Error ? error.message : "Source observation failed");
    process.exitCode = 1;
  }
}
