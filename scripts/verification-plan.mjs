import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { classifyChanges } from "../.github/scripts/ci-scope.mjs";

// Planning only: never runs a compiler, installs dependencies or grants acceptance.
export function planVerification(paths) {
  const broad = {
    commands: [["pnpm", "typecheck"]],
    finalAcceptance: false,
    notes: [
      "Unknown/global scope: inspect affected behavior and select focused tests; retain full final verification.",
    ],
  };
  if (
    !Array.isArray(paths) ||
    !paths.length ||
    paths.some(
      (p) =>
        typeof p !== "string" ||
        !p ||
        p.startsWith("/") ||
        p.split("/").some((part) => !part || part === "..") ||
        /[\\\r\n\0]/u.test(p),
    )
  )
    return broad;
  const scriptDirs = new Set();
  const remaining = [];
  for (const path of paths) {
    if (/^\.agents\/skills\/[^/]+\/.*\.md$/u.test(path)) continue;
    const match = path.match(/^(\.agents\/skills\/[^/]+\/scripts)\/[^/]+\.py$/u);
    if (match) scriptDirs.add(match[1]);
    else remaining.push(path);
  }
  const commands = [...scriptDirs]
    .sort()
    .map((dir) => ["python3", "-m", "unittest", "discover", "-s", dir, "-p", "*_test.py"]);
  if (remaining.length) {
    const scope = classifyChanges(remaining);
    if (scope.full) return { ...broad, commands: [...commands, ...broad.commands] };
    if (scope.changed_packages.length)
      commands.push([
        "pnpm",
        ...scope.changed_packages.flatMap((name) => ["--filter", name]),
        "--if-present",
        "typecheck",
      ]);
    else if (scope.node) commands.push(["pnpm", "typecheck"]);
    if (scope.changed_packages.length && scope.node) {
      for (const project of ["integration/tsconfig.json", "e2e/tsconfig.json"]) {
        commands.push(["pnpm", "exec", "tsc", "--noEmit", "-p", project]);
      }
    }
  }
  return {
    commands,
    finalAcceptance: false,
    notes: [
      "Iteration plan only. Inspect changed behavior and choose its focused tests, lint/contract checks and platform checks.",
      "Documentation needs link/content review; Python discovery with zero tests is not verification.",
      "Reuse valid receipts. This plan never replaces complete final verification or live merge gates.",
    ],
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 4 || process.argv[2] !== "--files")
      throw new Error("Use --files <JSON array file>");
    console.log(
      JSON.stringify(planVerification(JSON.parse(readFileSync(process.argv[3], "utf8"))), null, 2),
    );
  } catch (error) {
    console.error(error.message);
    console.log(JSON.stringify(planVerification(null)));
    process.exitCode = 1;
  }
}
