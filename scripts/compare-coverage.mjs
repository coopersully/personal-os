// Compare two Istanbul coverage-final.json reports of the same source tree.
//
// Upstream folds raw V8 results together one test file at a time, and that fold is
// slightly order-sensitive: a single run uses test completion order, the sharded
// merge a fixed order. A report may therefore differ by an isolated branch range.
// Anything larger means the two paths no longer measure the same thing.
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const tolerance = { files: 5, counters: 10 };
const kinds = [
  ["statements", "s"],
  ["functions", "f"],
  ["branches", "b"],
];

function totals(report) {
  const result = Object.fromEntries(kinds.map(([name]) => [name, { total: 0, covered: 0 }]));
  for (const file of Object.values(report))
    for (const [name, key] of kinds)
      for (const hits of Object.values(file[key] ?? {}))
        for (const count of [hits].flat()) {
          result[name].total++;
          if (count > 0) result[name].covered++;
        }
  return result;
}

export function compare(single, merged) {
  const files = new Set([...Object.keys(single), ...Object.keys(merged)]);
  const missing = [...files].filter((file) => !single[file] || !merged[file]);
  const differing = [...files].filter(
    (file) =>
      single[file] && merged[file] && JSON.stringify(single[file]) !== JSON.stringify(merged[file]),
  );
  const [a, b] = [totals(single), totals(merged)];
  const drift = Object.fromEntries(
    kinds.map(([name]) => [
      name,
      { total: b[name].total - a[name].total, covered: b[name].covered - a[name].covered },
    ]),
  );
  const counters = Math.max(
    ...Object.values(drift).flatMap((value) => [Math.abs(value.total), Math.abs(value.covered)]),
  );
  return {
    files: files.size,
    missing,
    differing,
    single: a,
    merged: b,
    drift,
    equivalent:
      missing.length === 0 && differing.length <= tolerance.files && counters <= tolerance.counters,
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const [single, merged] = process.argv
    .slice(2, 4)
    .map((path) => JSON.parse(readFileSync(path, "utf8")));
  const result = compare(single, merged);
  const percent = ({ covered, total }) => `${((covered / total) * 100).toFixed(4)}%`;
  console.log("## Coverage equivalence\n");
  console.log("| Metric | Single run | Sharded merge | Counter drift (total / covered) |");
  console.log("| --- | ---: | ---: | ---: |");
  for (const [name] of kinds)
    console.log(
      `| ${name} | ${percent(result.single[name])} | ${percent(result.merged[name])} | ${result.drift[name].total} / ${result.drift[name].covered} |`,
    );
  console.log(
    `\n${result.files} files; ${result.differing.length} differ; ${result.missing.length} present in only one report.`,
  );
  for (const file of [...result.missing, ...result.differing].slice(0, 20))
    console.log(`- ${file}`);
  if (!result.equivalent) {
    console.log("\nThe reports differ by more than merge-order noise.");
    process.exitCode = 1;
  }
}
