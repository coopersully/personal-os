// Produce the coverage reports and enforce the thresholds for a sharded test run.
// See coverage-shard-provider.mjs for why this is equivalent to a single run.
import { relative } from "node:path";
import { createVitest } from "vitest/node";
import { readManifests, validateManifests } from "./coverage-shard-provider.mjs";

process.env.NOHMI_COVERAGE_MODE = "merge";
if (!process.env.NOHMI_COVERAGE_SHARD_DIR) {
  console.error("NOHMI_COVERAGE_SHARD_DIR is required");
  process.exit(1);
}

// Optional path filters, for proving equivalence on part of the suite.
const filters = process.argv.slice(2);
const vitest = await createVitest("test", { watch: false, coverage: { enabled: true } });
try {
  // A missing or extra test file means the shards did not run the suite a single run would.
  const { count, testFiles } = validateManifests(
    await readManifests(process.env.NOHMI_COVERAGE_SHARD_DIR),
  );
  const expected = new Set(
    (await vitest.globTestSpecifications(filters)).map((specification) => specification.moduleId),
  );
  const missing = [...expected].filter((file) => !testFiles.has(file));
  const extra = [...testFiles].filter((file) => !expected.has(file));
  if (missing.length || extra.length) {
    const list = (files) => files.map((file) => relative(vitest.config.root, file)).join(", ");
    throw new Error(
      `Coverage shards do not match the test suite. Missing: ${list(missing) || "none"}. Unexpected: ${list(extra) || "none"}.`,
    );
  }
  if (typeof vitest.initCoverageProvider !== "function")
    throw new Error("This Vitest version no longer exposes the coverage provider lifecycle");
  await vitest.initCoverageProvider();
  const provider = vitest.coverageProvider;
  if (provider?.constructor?.name !== "ShardMergeProvider")
    throw new Error("The shard merge coverage provider was not loaded");
  await provider.clean(vitest.config.coverage.clean);
  const coverage = await provider.generateCoverage({ allTestsRun: true });
  await provider.reportCoverage(coverage, { allTestsRun: true });
  console.log(`Merged coverage from ${count} shards covering ${testFiles.size} test files.`);
} catch (error) {
  console.error(error instanceof Error ? error.message : "Coverage merge failed");
  process.exitCode = 1;
} finally {
  await vitest.close();
}
