import { readFile, writeFile } from "node:fs/promises";
import { discoverToolDictionary } from "../integration/workspace-agent/tool-dictionary.js";

const [resultsPath, tracePath, outputPath] = process.argv.slice(2);
if (!resultsPath || !tracePath || !outputPath)
  throw Error(
    "Usage: tsx scripts/workspace-agent-evidence.ts <vitest-json> <trace-jsonl> <output.md>",
  );
type Suite = { name: string; assertionResults: Array<{ fullName: string; status: string }> };
type Trace = { file: string; test: string; tool: string; isError: boolean };
const results = JSON.parse(await readFile(resultsPath, "utf8")) as {
  testResults: Suite[];
  numPassedTests: number;
  numFailedTests: number;
  numPendingTests: number;
};
const traces = (await readFile(tracePath, "utf8"))
  .trim()
  .split("\n")
  .filter(Boolean)
  .map((line) => JSON.parse(line) as Trace);
const passing = new Set(
  results.testResults.flatMap((suite) =>
    suite.assertionResults
      .filter((test) => test.status === "passed")
      .map((test) => suite.name + "\0" + test.fullName),
  ),
);
const valid = traces.filter((trace) =>
  passing.has(trace.file + "\0" + trace.test.replaceAll(" > ", " ")),
);
const domains = new Set([
  "calendar",
  "tasks",
  "reminders",
  "mail",
  "finances",
  "texting",
  "assistant",
]);
const dictionary = (await discoverToolDictionary()).filter(
  ({ definition }) => domains.has(definition.domain) && !definition.compatibility,
);
let exercised = 0;
const lines = [
  "# Workspace MCP execution evidence",
  "",
  "Generated from actual Vitest results joined to MCP calls made inside passing real API/PostgreSQL fixture tests. A call in a failing test is not passing evidence. This reports tool-level execution, not exhaustive input-variant coverage or real-provider verification.",
  "",
  `Tests: ${results.numPassedTests} passed; ${results.numFailedTests} failed.`,
  "",
  "| Tool | Successful calls in passing workflows | Expected error calls in passing workflows | Evidence suites |",
  "| --- | ---: | ---: | --- |",
];
for (const { tool } of dictionary) {
  const calls = valid.filter((trace) => trace.tool === tool.name);
  const ok = calls.filter((trace) => !trace.isError).length;
  if (ok) exercised++;
  const suites = [...new Set(calls.map((trace) => trace.file.split("/").at(-1)))];
  lines.push(
    `| \`${tool.name}\` | ${ok} | ${calls.length - ok} | ${suites.join(", ") || "**Not executed by this MCP suite**"} |`,
  );
}
lines.splice(
  6,
  0,
  `Successful execution observed for ${exercised} of ${dictionary.length} normal-discovery tools in the audited domains. Unexecuted rows remain explicit verification gaps; adapter registration or service-only tests are not counted here.`,
  "",
);
const workspaceRows = [
  ["Mail", ["mail"], "Controlled provider only"],
  ["Tasks and Reminders", ["tasks", "reminders"], "Local operations; no external provider claim"],
  ["Calendar", ["calendar"], "Local calendar execution; provider suites are separate"],
  ["Finances", ["finances"], "Controlled bank provider only"],
  ["Shared and Texting", ["assistant", "texting"], "Controlled SMS provider only"],
] as const;
lines.push(
  "",
  "## Workspace execution totals",
  "",
  "| Workspace | Exposed tools | Executed successfully | Provider verification |",
  "| --- | ---: | ---: | --- |",
);
for (const [name, workspaceDomains, provider] of workspaceRows) {
  const entries = dictionary.filter(({ definition }) =>
    (workspaceDomains as readonly string[]).includes(definition.domain),
  );
  const count = entries.filter(({ tool }) =>
    valid.some((trace) => trace.tool === tool.name && !trace.isError),
  ).length;
  lines.push(`| ${name} | ${entries.length} | ${count} | ${provider} |`);
}
await writeFile(outputPath, lines.join("\n") + "\n");
console.log(
  `${exercised}/${dictionary.length} tools executed successfully inside passing fixture tests.`,
);

if (results.numFailedTests || results.numPendingTests || exercised !== dictionary.length) {
  throw new Error(
    "Workspace MCP execution gate failed: inspect failed, skipped or unexecuted cases in the report.",
  );
}
