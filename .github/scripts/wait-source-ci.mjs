import { pathToFileURL } from "node:url";
import { SourceClient, stableObservation } from "./source-observation.mjs";

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
  const {
    GH_REPO: repository,
    PR_HEAD_SHA: head,
    PR_BASE_SHA: base,
    PR_NUMBER: numberText,
  } = process.env;
  const number = Number(numberText);
  if (
    !Number.isSafeInteger(number) ||
    number < 1 ||
    !repository ||
    !/^[0-9a-f]{40}$/.test(head ?? "") ||
    !/^[0-9a-f]{40}$/.test(base ?? "")
  )
    throw new Error("Missing candidate identity");
  const expected = {
    headSha: head,
    baseSha: base,
    baseRef: process.env.PR_BASE_REF,
    retargeted: process.env.PR_RETARGETED === "true",
  };
  // Collector snapshots use this same observer, without publishing a check or changing polling.
  if (process.argv.includes("--collect")) {
    process.stdout.write(
      `${JSON.stringify(stableObservation(new SourceClient(repository, number), expected))}\n`,
    );
    return;
  }
  const deadline = Date.now() + 55 * 60 * 1000;
  while (Date.now() < deadline) {
    const observation = stableObservation(
      new SourceClient(repository, number, Math.min(120000, deadline - Date.now())),
      expected,
    );
    if (observation.state === "success") return;
    await new Promise((resolve) =>
      setTimeout(resolve, Math.min(30000, Math.max(0, deadline - Date.now()))),
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
