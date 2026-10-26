import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isDocumentation } from "../.github/scripts/ci-scope.mjs";
import { planVerification } from "./verification-plan.mjs";

// Recommendations only. These records are not authenticated merge/production evidence.
const definitions = [
  ["understand", [], ["requirements", "policy"]],
  ["track", ["understand"], ["requirements", "metadata"], "track"],
  ["plan", ["understand", "track"], ["requirements", "base", "policy", "ownership"]],
  [
    "implement",
    ["understand", "track", "plan"],
    ["source", "requirements", "ownership"],
    "implement",
  ],
  ["verify-focused", ["implement"], ["source", "base", "verifier", "requirements"]],
  ["review", ["verify-focused"], ["source", "base", "policy", "requirements", "verifier"]],
  ["publish", ["track", "review"], ["source", "base", "metadata", "requirements"], "publish"],
  ["verify-final", ["publish"], ["source", "base", "verifier"]],
  [
    "deliver",
    ["verify-final", "review", "publish"],
    ["source", "base", "policy", "requirements", "metadata", "ownership"],
    "deliver",
  ],
];
const fields = ["source", "base", "verifier", "policy", "requirements", "metadata", "ownership"];
const nonempty = (v) => typeof v === "string" && v.trim().length > 0;

export function receiptKey(step, context) {
  const definition = definitions.find((d) => d[0] === step);
  if (!definition) throw new Error("Unknown step");
  if (!context || definition[2].some((k) => !nonempty(context[k])))
    throw new Error("Missing evidence context");
  return createHash("sha256")
    .update(JSON.stringify([1, step, definition[2].map((k) => [k, context[k]])]))
    .digest("hex");
}
function validReceipt(r, id, key) {
  return (
    r &&
    r.step === id &&
    r.key === key &&
    r.result === "pass" &&
    nonempty(r.owner) &&
    Array.isArray(r.evidence) &&
    r.evidence.length > 0 &&
    r.evidence.every(nonempty) &&
    Number.isFinite(r.elapsedMs) &&
    r.elapsedMs >= 0
  );
}
export function buildPlan(input) {
  if (input?.version !== 1 || !["plan", "review", "contribute", "deliver"].includes(input.mode))
    throw new Error("Unsupported plan version or mode");
  if (
    input.scopeComplete !== true ||
    !Array.isArray(input.paths) ||
    !input.paths.length ||
    input.paths.some(
      (p) =>
        !nonempty(p) ||
        p.startsWith("/") ||
        p.split("/").some((x) => !x || x === "..") ||
        /[\\\r\n\0]/u.test(p),
    )
  )
    throw new Error("Complete repository-relative change scope required");
  if (!input.context || fields.some((k) => !nonempty(input.context[k])))
    throw new Error("Complete evidence context required");
  if (typeof input.coordination !== "boolean" || !Array.isArray(input.receipts))
    throw new Error("Coordination flag and receipts required");
  const steps = [];
  for (const [id, dependencies, , grant] of definitions) {
    const key = receiptKey(id, input.context);
    const latest = input.receipts.findLast((r) => r?.step === id && r?.key === key);
    let status, reason;
    const excluded =
      (input.mode === "plan" && !["understand", "plan"].includes(id)) ||
      (input.mode === "review" &&
        ["track", "plan", "implement", "publish", "verify-final", "deliver"].includes(id)) ||
      (id === "deliver" && input.mode !== "deliver") ||
      (id === "plan" && !input.coordination && input.mode !== "plan");
    if (excluded) {
      status = "unnecessary";
      reason = "Outside requested mode or no coordinated planning required";
    } else if (validReceipt(latest, id, key)) {
      status = "done";
      reason = "Current matching receipt; inspect authentic evidence before relying on it";
    } else if (grant && input.authority?.[grant] !== true) {
      status = "blocked";
      reason = `Missing recorded ${grant} authority; prepare result before requesting missing scope`;
    } else if (
      dependencies.some(
        (d) => !["done", "unnecessary"].includes(steps.find((s) => s.id === d)?.status),
      )
    ) {
      status = "waiting";
      reason = "Prerequisite evidence is not complete";
    } else {
      status = "ready";
      reason = "Required evidence missing or stale; use owning workflow";
    }
    steps.push({
      id,
      status,
      reason,
      receiptKey: key,
      inputs: definitions.find((d) => d[0] === id)[2],
    });
  }
  return {
    version: 1,
    mode: input.mode,
    steps,
    next: steps.find((s) => s.status === "ready")?.id ?? null,
    mergeAuthorized: false,
    verification: {
      iteration: planVerification(input.paths),
      final: {
        commands: input.paths.every(isDocumentation) ? [] : [["pnpm", "verify"]],
        prerequisite:
          "Before choosing final commands, compute Git scope at frozen head/base. Prose-looking paths alone do not authorize omission; if Git proof fails, use full verification.",
        alternative:
          "Policy-complete hosted verification under delivery-verification.md, including only its Git-verified prose exception; selected stages cannot skip",
        additional:
          "Select behavior, platform, provider and production acceptance from requirements; paths alone cannot establish these",
      },
    },
    limitations: [
      "Advisory only: caller supplies scope, context and receipts; no provider authentication or effects",
      "Deliver always uses live ship-it gates; a delivery receipt is historical, never authority for another merge",
    ],
  };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 4 || process.argv[2] !== "--state")
      throw new Error("Use --state <JSON file>");
    console.log(
      JSON.stringify(buildPlan(JSON.parse(readFileSync(process.argv[3], "utf8"))), null, 2),
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
