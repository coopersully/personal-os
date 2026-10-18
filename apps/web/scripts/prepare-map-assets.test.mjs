import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { test } from "node:test";

const require = createRequire(import.meta.url);
test("publishes the pinned same-origin worker and its shared module without transformation", async () => {
  execFileSync(process.execPath, [new URL("./prepare-map-assets.mjs", import.meta.url).pathname]);
  const root = dirname(require.resolve("maplibre-gl/package.json"));
  for (const file of ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"])
    assert.deepEqual(
      await readFile(new URL(`../public/maplibre/6.14.0/${file}`, import.meta.url)),
      await readFile(resolve(root, "dist", file)),
    );
});
