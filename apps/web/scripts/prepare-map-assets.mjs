import { copyFile, mkdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";

const require = createRequire(import.meta.url);
const root = dirname(require.resolve("maplibre-gl/package.json"));
const metadata = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
if (metadata.version !== "6.14.0")
  throw new Error("Review the MapLibre worker contract before upgrading.");
const target = new URL("../public/maplibre/6.14.0/", import.meta.url);
await mkdir(target, { recursive: true });
for (const name of ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"])
  await copyFile(resolve(root, "dist", name), new URL(name, target));
