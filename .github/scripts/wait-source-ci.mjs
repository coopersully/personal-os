import { pathToFileURL } from "node:url";
import { classifyGitChanges, sourceLane } from "./ci-scope.mjs";
import {
  ObservationChanged,
  observeMetadata,
  SourceClient,
  SourceSettling,
  stableObservation,
} from "./source-observation.mjs";

const shaPattern = /^[0-9a-f]{40}$/u;

export function candidateIdentity(env) {
  const number = Number(env.PR_NUMBER);
  if (
    !Number.isSafeInteger(number) ||
    number < 1 ||
    !env.GH_REPO ||
    !shaPattern.test(env.PR_HEAD_SHA ?? "") ||
    !shaPattern.test(env.PR_BASE_SHA ?? "")
  )
    throw new Error("Missing candidate identity");
  return {
    repository: env.GH_REPO,
    number,
    expected: {
      headSha: env.PR_HEAD_SHA,
      baseSha: env.PR_BASE_SHA,
      baseRef: env.PR_BASE_REF,
      retargeted: env.PR_RETARGETED === "true",
    },
  };
}

// The gate job at the end of a source run. It must fail, never skip, whenever the
// run did not verify the candidate: branch protection treats a skipped required
// job as passing. The aggregate's result comes from the same run and attempt.
export function gateDecision(env) {
  if (env.SOURCE_LANE === "fast") return draftRemedy;
  if (env.SOURCE_RESULT !== "success")
    return "Source verification did not succeed in this run; inspect its jobs";
  if (env.SOURCE_LANE !== "full") return "Source lane is unknown; the run cannot be accepted";
  return undefined;
}

// A draft's fast-lane run never reports Source verification, so waiting on it
// would hold a runner for a result that cannot arrive. Source CI makes the same
// lane decision from the same classifier, including its fail-closed full scope.
export function deferredDraft(env, classify = classifyGitChanges) {
  if (env.PR_DRAFT !== "true" || env.PR_FULL === "true") return false;
  return sourceLane(classify(env.PR_BASE_SHA, env.PR_HEAD_SHA), { draft: true }) === "fast";
}

export const settleBudget = 120000;
export const readySettle = 30000;
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
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
  if (process.argv.includes("--gate")) {
    const rejection = gateDecision(process.env);
    if (rejection) throw new Error(rejection);
    if (!expected.baseRef) throw new Error("Missing candidate identity");
    for (let attempt = 0; ; attempt++) {
      try {
        observeMetadata(new SourceClient(repository, number), expected);
        return;
      } catch (error) {
        if (!(error instanceof ObservationChanged) || attempt === 1) throw error;
      }
    }
  }
  // Collector snapshots use this same observer, without publishing a check or changing polling.
  if (process.argv.includes("--collect")) {
    process.stdout.write(
      `${JSON.stringify(stableObservation(new SourceClient(repository, number), expected))}\n`,
    );
    return;
  }
  const draft = deferredDraft(process.env);
  // Marking a draft ready starts a full source run from the same event. Give it time
  // to register so the draft's fast-lane run is not mistaken for the latest one.
  if (process.env.PR_EVENT_ACTION === "ready_for_review") await pause(readySettle);
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
      // A dispatched gate reads the run seconds after it completes. Give the job
      // inventory a bounded time to agree before treating the gap as a failure.
      if (!(error instanceof SourceSettling) || Date.now() - started >= settleBudget) {
        if (draft) console.error(draftRemedy);
        throw error;
      }
    }
    if (observation?.state === "success") return;
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
