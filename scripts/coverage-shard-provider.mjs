// Coverage for a test run split across machines.
//
// Vitest's own `--merge-reports` merges shards after each has been converted to
// Istanbul maps, which can credit an uncovered nested branch from another shard.
// A single run instead merges the raw V8 results of every test file per transform
// mode, then converts once. This provider keeps that order: a shard exports its raw
// results untouched, and the merge combines every shard's raw results in one pass
// and hands the result to the unmodified upstream `generateCoverage`. Conversion,
// untested files, reports and thresholds are the same code a single run executes.
import { copyFile, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import v8 from "@vitest/coverage-v8";

// The same library instance the provider itself merges with. It is a dependency of
// @vitest/coverage-v8, not of this repository, so resolve it from there.
async function loadMerge() {
  const require = createRequire(createRequire(import.meta.url).resolve("@vitest/coverage-v8"));
  const { mergeProcessCovs } = await import(require.resolve("@bcoe/v8-coverage"));
  if (typeof mergeProcessCovs !== "function") throw new Error("V8 coverage merge is unavailable");
  return mergeProcessCovs;
}

export const schemaVersion = 1;
export const transformModes = ["web", "ssr", "browser"];

function exportDirectory() {
  const directory = process.env.NOHMI_COVERAGE_SHARD_DIR;
  if (!directory) throw new Error("NOHMI_COVERAGE_SHARD_DIR is required for sharded coverage");
  return resolve(directory);
}

const positive = (value) => Number.isSafeInteger(value) && value > 0;

// Every shard of one count, exactly once, from one tool version, with disjoint tests.
export function validateManifests(manifests) {
  if (!Array.isArray(manifests) || manifests.length === 0)
    throw new Error("No coverage shard manifests found");
  const [first] = manifests;
  const seen = new Set();
  const tests = new Set();
  for (const manifest of manifests) {
    if (
      manifest?.schemaVersion !== schemaVersion ||
      !positive(manifest.shard?.index) ||
      !positive(manifest.shard?.count) ||
      manifest.shard.index > manifest.shard.count ||
      manifest.shard.count !== first.shard?.count ||
      typeof manifest.vitest !== "string" ||
      manifest.vitest !== first.vitest ||
      typeof manifest.root !== "string" ||
      manifest.root !== first.root ||
      !Array.isArray(manifest.entries) ||
      seen.has(manifest.shard.index)
    )
      throw new Error("Coverage shard manifests are malformed, mixed or duplicated");
    seen.add(manifest.shard.index);
    for (const entry of manifest.entries) {
      if (
        !(entry?.project === null || typeof entry?.project === "string") ||
        !transformModes.includes(entry.transformMode) ||
        typeof entry.file !== "string" ||
        entry.file !== basename(entry.file) ||
        !/^coverage-\d+\.json$/u.test(entry.file) ||
        !Array.isArray(entry.testFiles) ||
        entry.testFiles.length === 0 ||
        entry.testFiles.some((test) => typeof test !== "string" || test.length === 0)
      )
        throw new Error("Coverage shard manifest entry is malformed");
      for (const test of entry.testFiles) {
        const key = `${entry.project}\0${entry.transformMode}\0${test}`;
        if (tests.has(key)) throw new Error("A test file was reported by more than one shard");
        tests.add(key);
      }
    }
  }
  if (seen.size !== first.shard.count)
    throw new Error(`Expected ${first.shard.count} coverage shards, found ${seen.size}`);
  return {
    count: first.shard.count,
    testFiles: new Set([...tests].map((key) => key.split("\0")[2])),
  };
}

export async function readManifests(directory) {
  const manifests = [];
  for (const name of (await readdir(directory)).sort()) {
    const path = resolve(directory, name, "manifest.json");
    let text;
    try {
      text = await readFile(path, "utf8");
    } catch {
      continue;
    }
    manifests.push({ ...JSON.parse(text), directory: resolve(directory, name) });
  }
  return manifests;
}

async function createProvider() {
  const Base = (await v8.getProvider()).constructor;

  class ShardExportProvider extends Base {
    // Export raw per-test-file results and stop: no conversion, report or threshold.
    async generateCoverage() {
      const shard = this.ctx.config.shard;
      if (!shard) throw new Error("Shard coverage export requires --shard");
      await Promise.all(this.pendingPromises);
      this.pendingPromises = [];
      const directory = exportDirectory();
      await mkdir(directory, { recursive: true });
      const entries = [];
      for (const [project, modes] of this.coverageFiles.entries())
        for (const [transformMode, files] of Object.entries(modes))
          for (const [testFiles, path] of Object.entries(files)) {
            await copyFile(path, resolve(directory, basename(path)));
            entries.push({
              // The unnamed root project is keyed by a symbol upstream.
              project: typeof project === "string" ? project : null,
              transformMode,
              file: basename(path),
              testFiles: testFiles.split(",").map((file) => resolve(this.ctx.config.root, file)),
            });
          }
      await writeFile(
        resolve(directory, "manifest.json"),
        JSON.stringify({
          schemaVersion,
          shard: { index: shard.index, count: shard.count },
          vitest: this.ctx.version,
          root: this.ctx.config.root,
          entries,
        }),
      );
      return this.createCoverageMap();
    }

    async reportCoverage() {
      await this.cleanAfterRun();
    }
  }

  class ShardMergeProvider extends Base {
    // Replace only the input: every shard's raw results, grouped as a single run
    // groups them. Everything downstream is upstream's generateCoverage.
    async readCoverageFiles({ onFileRead, onFinished }) {
      const manifests = await readManifests(exportDirectory());
      validateManifests(manifests);
      const projects = new Map();
      for (const manifest of manifests) {
        if (manifest.vitest !== this.ctx.version || manifest.root !== this.ctx.config.root)
          throw new Error("Coverage shards were produced by another tool version or checkout");
        for (const entry of manifest.entries) {
          let modes = projects.get(entry.project);
          if (!modes) {
            modes = Object.fromEntries(transformModes.map((mode) => [mode, []]));
            projects.set(entry.project, modes);
          }
          modes[entry.transformMode].push({
            path: resolve(manifest.directory, entry.file),
            order: entry.testFiles.join(),
          });
        }
      }
      for (const [projectName, modes] of projects.entries()) {
        const project = this.ctx.getProjectByName(projectName ?? "");
        for (const transformMode of transformModes) {
          const urls = new Set();
          // Upstream folds results in one at a time, re-merging its own output. That
          // fold is order-sensitive: some orders leave a spurious covered range, and a
          // single run's order is whatever order its tests happened to finish in.
          // Merging every result in one pass has no order, so the same suite yields
          // the same report on any shard count. Sorting only fixes the read order.
          const ordered = modes[transformMode].sort((a, b) =>
            a.order < b.order ? -1 : a.order > b.order ? 1 : 0,
          );
          const coverages = [];
          const offsets = new Map();
          for (const { path } of ordered) {
            const coverage = JSON.parse(await readFile(path, "utf8"));
            for (const result of coverage.result) {
              urls.add(result.url);
              if (result.startOffset && !offsets.has(result.url))
                offsets.set(result.url, result.startOffset);
            }
            coverages.push(coverage);
          }
          if (coverages.length) {
            const merged = (await loadMerge())(coverages);
            // The merge can drop the wrapper offset, as upstream notes for its own fold.
            for (const result of merged.result)
              if (!result.startOffset) result.startOffset = offsets.get(result.url) || 0;
            onFileRead(merged);
          }
          await this.warmTransforms(project, transformMode, urls);
          await onFinished(project, transformMode);
        }
      }
    }

    // A single run converts with the transform each test actually executed, cached
    // per transform mode. No test ran here, so request the same transform the same way.
    async warmTransforms(project, transformMode, urls) {
      if (transformMode === "browser") return;
      for (const url of urls) {
        if (!url.startsWith("file://")) continue;
        const path = fileURLToPath(url);
        if (!this.testExclude.shouldInstrument(path)) continue;
        await project.vitenode.fetchResult(path, transformMode).catch(() => undefined);
      }
    }
  }

  const mode = process.env.NOHMI_COVERAGE_MODE;
  if (mode === "shard") return new ShardExportProvider();
  if (mode === "merge") return new ShardMergeProvider();
  throw new Error("NOHMI_COVERAGE_MODE must be shard or merge");
}

export default { ...v8, getProvider: createProvider };
