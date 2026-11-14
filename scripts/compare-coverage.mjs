// Compare two Istanbul coverage-final.json reports of the same source tree.
//
// A single run folds raw V8 results together one test file at a time, in the order
// its tests happened to finish, and that fold can leave a spurious covered range.
// The sharded merge combines them in one pass. The two reports are therefore not
// byte-identical on a large suite, and two single runs are not identical either.
//
// What must hold is that the merge never makes the gate meaningfully easier to
// pass, that both reports cover the same files, and that the movement stays small.
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

// Percentage points a metric may move in each direction, and the share of all
// counters that may change classification across the files that differ.
export const tolerance = { higher: 0.01, lower: 0.05, counters: 0.002 };
const kinds = [
  ["statements", "s"],
  ["functions", "f"],
  ["branches", "b"],
];

function count(file) {
  const result = Object.fromEntries(kinds.map(([name]) => [name, { total: 0, covered: 0 }]));
  for (const [name, key] of kinds)
    for (const hits of Object.values(file?.[key] ?? {}))
      for (const hit of [hits].flat()) {
        result[name].total++;
        if (hit > 0) result[name].covered++;
      }
  return result;
}

function totals(report) {
  const result = Object.fromEntries(kinds.map(([name]) => [name, { total: 0, covered: 0 }]));
  for (const file of Object.values(report)) {
    const counted = count(file);
    for (const [name] of kinds) {
      result[name].total += counted[name].total;
      result[name].covered += counted[name].covered;
    }
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
  // Sum each file's own movement, so a gain in one file cannot hide a loss in another.
  let counters = 0;
  for (const file of differing) {
    const [x, y] = [count(single[file]), count(merged[file])];
    for (const [name] of kinds)
      counters +=
        Math.abs(y[name].total - x[name].total) + Math.abs(y[name].covered - x[name].covered);
  }
  const percent = ({ covered, total }) => (total ? (covered / total) * 100 : 100);
  const movement = Object.fromEntries(
    kinds.map(([name]) => [name, percent(b[name]) - percent(a[name])]),
  );
  const all = kinds.reduce((sum, [name]) => sum + a[name].total, 0);
  return {
    files: files.size,
    missing,
    differing,
    single: a,
    merged: b,
    drift,
    movement,
    counters,
    equivalent:
      missing.length === 0 &&
      Object.values(movement).every(
        (points) => points <= tolerance.higher && points >= -tolerance.lower,
      ) &&
      counters <= all * tolerance.counters,
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
    `\n${result.files} files; ${result.differing.length} differ; ${result.missing.length} present in only one report; ${result.counters} counters moved across the differing files.`,
  );
  for (const file of [...result.missing, ...result.differing].slice(0, 20))
    console.log(`- ${file}`);
  if (!result.equivalent) {
    console.log(
      "\nThe sharded merge is more lenient than a single run, covers different files, or moved too many counters.",
    );
    process.exitCode = 1;
  }
}
