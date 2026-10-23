import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { validateCoverageShards } from "./coverage-shards.mjs";

// Exercise the installed Vitest/blob/coverage integration, including the root
// coverage inventory and thresholds. Separate from dependency-free repo checks.
test("merged shards enforce root thresholds and include untested source", () => {
  const root = process.cwd();
  mkdirSync(resolve(root, ".context"), { recursive: true });
  const fixture = mkdtempSync(resolve(root, ".context/coverage-shards-"));
  const run = (...args) => {
    const result = spawnSync(
      process.execPath,
      [resolve(root, "node_modules/vitest/vitest.mjs"), "run", ...args],
      {
        cwd: fixture,
        encoding: "utf8",
        timeout: 60_000,
        env: { ...process.env, CI: "true" },
      },
    );
    assert.ifError(result.error);
    return result;
  };
  const config = (parent) => `import base from ${JSON.stringify(resolve(root, parent))};
export default { ...base, root: ${JSON.stringify(fixture)}, test: { ...base.test,
  include: ['*.test.ts'], setupFiles: [], maxWorkers: 1,
  coverage: { ...base.test.coverage, include: ['*.ts'], exclude: ['*.test.ts'], reporter: ['json-summary'] }
}};`;
  try {
    writeFileSync(resolve(fixture, "aggregate.config.mts"), config("vitest.config.ts"));
    writeFileSync(resolve(fixture, "shard.config.mts"), config("vitest.shard.config.ts"));
    for (const name of ["a", "b"]) {
      writeFileSync(resolve(fixture, `${name}.ts`), `export const value = () => '${name}';\n`);
      writeFileSync(
        resolve(fixture, `${name}.test.ts`),
        `import { expect, test } from 'vitest';\nimport { value } from './${name}';\ntest('${name}', () => expect(value()).toBe('${name}'));\n`,
      );
    }
    for (const index of [1, 2]) {
      const result = run(
        "--config",
        "shard.config.mts",
        "--coverage",
        `--shard=${index}/2`,
        "--reporter=blob",
      );
      assert.equal(result.status, 0, result.stdout + result.stderr);
    }
    validateCoverageShards(["blob-1-2.json", "blob-2-2.json"], 2);
    const merge = () =>
      run("--config", "aggregate.config.mts", "--coverage", "--merge-reports=.vitest-reports");
    const complete = merge();
    assert.equal(complete.status, 0, complete.stdout + complete.stderr);
    const summary = JSON.parse(
      readFileSync(resolve(fixture, "coverage/coverage-summary.json"), "utf8"),
    );
    assert.equal(summary.total.lines.pct, 100);
    rmSync(resolve(fixture, ".vitest-reports/blob-2-2.json"));
    const partial = merge();
    assert.notEqual(partial.status, 0, "An incomplete merged report must fail root thresholds.");
    assert.match(partial.stderr + partial.stdout, /threshold/);
    // A new untested source file must be included by each shard, not lost by merging.
    writeFileSync(resolve(fixture, "untested.ts"), "export const untested = () => 42;\n");
    for (const index of [1, 2]) {
      const result = run(
        "--config",
        "shard.config.mts",
        "--coverage",
        `--shard=${index}/2`,
        "--reporter=blob",
      );
      assert.equal(result.status, 0, result.stdout + result.stderr);
    }
    const uncovered = merge();
    assert.notEqual(uncovered.status, 0, "Untested source must fail the aggregate coverage floor.");
    const uncoveredSummary = JSON.parse(
      readFileSync(resolve(fixture, "coverage/coverage-summary.json"), "utf8"),
    );
    assert.equal(uncoveredSummary[resolve(fixture, "untested.ts")].lines.pct, 0);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});
