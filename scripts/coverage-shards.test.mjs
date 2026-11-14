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
  s: { 0: 1, 1: 0 },
  f: { 0: 1 },
  b: Object.fromEntries(branches.map((hits, index) => [index, hits])),
});

test("identical reports and isolated merge-order noise are equivalent", () => {
  const single = { "/a.ts": file([[1, 0]]), "/b.ts": file([[2]]) };
  assert.deepEqual(compare(single, structuredClone(single)).differing, []);
  const noisy = { ...structuredClone(single), "/b.ts": file([[2], [5]]) };
  const result = compare(single, noisy);
  assert.equal(result.equivalent, true);
  assert.deepEqual(result.differing, ["/b.ts"]);
  assert.deepEqual(result.drift.branches, { total: 1, covered: 1 });
});

test("a missing file, widespread differences or large drift are not equivalent", () => {
  const single = Object.fromEntries(
    Array.from({ length: 20 }, (_, index) => [`/f${index}.ts`, file([[1, 0]])]),
  );
  const missing = structuredClone(single);
  delete missing["/f0.ts"];
  assert.equal(compare(single, missing).equivalent, false);
  const widespread = structuredClone(single);
  for (let index = 0; index <= tolerance.files; index++)
    widespread[`/f${index}.ts`] = file([[1, 1]]);
  assert.equal(compare(single, widespread).equivalent, false);
  // The inflation an Istanbul-level merge produced: many uncovered branches credited.
  const inflated = structuredClone(single);
  inflated["/f1.ts"] = file(Array.from({ length: tolerance.counters + 2 }, () => [1, 1]));
  assert.equal(compare(single, inflated).equivalent, false);
});
