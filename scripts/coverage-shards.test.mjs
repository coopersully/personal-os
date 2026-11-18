import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { compare, tolerance } from "./compare-coverage.mjs";
import { readManifests, schemaVersion, validateManifests } from "./coverage-shard-provider.mjs";

const entry = (number, testFile, transformMode = "ssr") => ({
  project: null,
  transformMode,
  file: `coverage-${number}.json`,
  testFiles: [testFile],
});
const manifest = (index, count, entries) => ({
  schemaVersion,
  shard: { index, count },
  vitest: "3.2.7",
  root: "/work/repo",
  entries,
});
const complete = () => [
  manifest(1, 3, [entry(0, "/work/repo/a.test.ts"), entry(1, "/work/repo/b.test.tsx", "web")]),
  manifest(2, 3, [entry(0, "/work/repo/c.test.ts")]),
  manifest(3, 3, [entry(0, "/work/repo/d.test.ts")]),
];

test("a complete set of shards reports its count and every test file once", () => {
  const { count, testFiles } = validateManifests(complete());
  assert.equal(count, 3);
  assert.deepEqual(
    [...testFiles].sort(),
    ["a", "b", "c", "d"].map((name) => `/work/repo/${name}.test.${name === "b" ? "tsx" : "ts"}`),
  );
});

test("a missing, repeated, foreign or mixed shard cannot be merged", () => {
  const cases = {
    "no shards": () => [],
    "missing shard": (set) => set.slice(0, 2),
    "repeated shard": (set) => [set[0], set[1], { ...set[1] }],
    "another shard count": (set) => [set[0], set[1], manifest(3, 4, set[2].entries)],
    "index beyond count": (set) => [set[0], set[1], manifest(4, 3, set[2].entries)],
    "another tool version": (set) => [set[0], set[1], { ...set[2], vitest: "4.0.0" }],
    "another checkout": (set) => [set[0], set[1], { ...set[2], root: "/elsewhere" }],
    "another schema": (set) => [set[0], set[1], { ...set[2], schemaVersion: 2 }],
    "test file in two shards": (set) => [
      set[0],
      set[1],
      manifest(3, 3, [entry(0, "/work/repo/a.test.ts")]),
    ],
    "path outside the shard": (set) => [
      set[0],
      set[1],
      manifest(3, 3, [{ ...entry(0, "/work/repo/d.test.ts"), file: "../coverage-0.json" }]),
    ],
    "unknown transform mode": (set) => [
      set[0],
      set[1],
      manifest(3, 3, [entry(0, "/work/repo/d.test.ts", "node")]),
    ],
    "entry without tests": (set) => [
      set[0],
      set[1],
      manifest(3, 3, [{ ...entry(0, "/work/repo/d.test.ts"), testFiles: [] }]),
    ],
  };
  for (const [name, change] of Object.entries(cases))
    assert.throws(() => validateManifests(change(complete())), Error, name);
});

test("manifests are read from each shard directory and remember where they came from", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "nohmi-shards-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const [index, value] of complete().entries()) {
    mkdirSync(join(root, `shard-${index + 1}`));
    writeFileSync(join(root, `shard-${index + 1}`, "manifest.json"), JSON.stringify(value));
  }
  mkdirSync(join(root, "unrelated"));
  const manifests = await readManifests(root);
  assert.deepEqual(
    manifests.map(({ directory }) => directory),
    [1, 2, 3].map((index) => join(root, `shard-${index}`)),
  );
  assert.equal(validateManifests(manifests).count, 3);
});

const file = (branches) => ({
  s: Object.fromEntries(Array.from({ length: 200 }, (_, index) => [index, index % 2])),
  f: { 0: 1 },
  b: Object.fromEntries(branches.map((hits, index) => [index, hits])),
});
const suite = (overrides = {}) => ({
  ...Object.fromEntries(
    Array.from({ length: 50 }, (_, index) => [
      `/f${index}.ts`,
      file(Array.from({ length: 100 }, (_, branch) => [branch % 10 ? 1 : 0])),
    ]),
  ),
  ...overrides,
});
const branches = (covered) =>
  file(Array.from({ length: 100 }, (_, branch) => [branch < covered ? 1 : 0]));

test("identical reports and a conservative merge are equivalent", () => {
  const single = suite();
  const same = compare(single, structuredClone(single));
  assert.deepEqual([same.differing, same.counters, same.equivalent], [[], 0, true]);
  // The merge dropped one spurious covered branch the single run's fold had left.
  const lower = compare(single, suite({ "/f1.ts": branches(89) }));
  assert.ok(lower.movement.branches < 0 && lower.movement.branches > -tolerance.lower);
  assert.equal(lower.equivalent, true);
});

test("a more lenient merge, a missing file or hidden offsetting movement is not equivalent", () => {
  const single = suite();
  // 5,000 branches: one extra covered branch is 0.02 points, above the lenient bound.
  const higher = compare(single, suite({ "/f1.ts": branches(91) }));
  assert.ok(higher.movement.branches > tolerance.higher);
  assert.equal(higher.equivalent, false);
  const far = compare(single, suite({ "/f1.ts": branches(80) }));
  assert.ok(far.movement.branches < -tolerance.lower);
  assert.equal(far.equivalent, false);
  const missing = suite();
  delete missing["/f0.ts"];
  assert.equal(compare(single, missing).equivalent, false);
  // A gain in one file must not cancel a loss in another.
  const offsetting = compare(single, suite({ "/f1.ts": branches(100), "/f2.ts": branches(80) }));
  assert.equal(offsetting.drift.branches.covered, 0);
  assert.equal(offsetting.movement.branches, 0);
  assert.equal(offsetting.counters, 20);
  assert.equal(offsetting.equivalent, true, "20 of 15,050 counters is inside the bound");
  const wide = compare(
    single,
    suite({ "/f1.ts": branches(100), "/f2.ts": branches(70), "/f3.ts": branches(100) }),
  );
  assert.equal(wide.movement.branches, 0);
  assert.ok(wide.counters > 15050 * tolerance.counters);
  assert.equal(wide.equivalent, false);
});
