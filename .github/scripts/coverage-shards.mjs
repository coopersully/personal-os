import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Fail before Vitest merges: it accepts an incomplete set of blob reports.
export function validateCoverageShards(files, count) {
  if (!Number.isSafeInteger(count) || count < 2) throw new Error("Invalid shard count.");
  const expected = Array.from({ length: count }, (_, index) => `blob-${index + 1}-${count}.json`);
  if (files.length !== count || expected.some((name) => !files.includes(name))) {
    throw new Error(`Expected exactly ${expected.join(", ")}; received ${files.join(", ")}.`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [directory, count, ...extra] = process.argv.slice(2);
  if (!directory || !count || extra.length)
    throw new Error("Usage: coverage-shards.mjs <directory> <count>");
  validateCoverageShards(readdirSync(directory), Number(count));
}
