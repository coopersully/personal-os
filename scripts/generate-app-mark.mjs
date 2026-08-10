// Regenerates every raster form of the ilo application mark from the authored SVG masters in
// apps/web/public. Run after changing icon.svg or icon-maskable.svg:
//
//   node scripts/generate-app-mark.mjs
//
// Rasterizing through Playwright's Chromium keeps the pipeline dependency-free (Playwright is
// already a devDependency) and renders the mark with the same engine that serves it. The desktop
// set (.icns, .ico, Windows Square*Logo, Android, iOS) is derived from a 1024px master by the
// Tauri CLI. That master is written to a temporary directory so it never ships in the web bundle.
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { chromium } from "@playwright/test";

const repositoryRoot = resolve(import.meta.dirname, "..");
const publicDirectory = resolve(repositoryRoot, "apps", "web", "public");
const staging = await mkdtemp(resolve(tmpdir(), "ilo-app-mark-"));

const targets = [
  { source: "icon.svg", directory: publicDirectory, output: "favicon-32.png", size: 32 },
  { source: "icon.svg", directory: publicDirectory, output: "apple-touch-icon.png", size: 180 },
  { source: "icon.svg", directory: publicDirectory, output: "icon-192.png", size: 192 },
  { source: "icon.svg", directory: publicDirectory, output: "icon-512.png", size: 512 },
  {
    source: "icon-maskable.svg",
    directory: publicDirectory,
    output: "icon-512-maskable.png",
    size: 512,
  },
  { source: "icon.svg", directory: staging, output: "icon-1024.png", size: 1024 },
];

const browser = await chromium.launch();
try {
  for (const { source, directory, output, size } of targets) {
    const markup = await readFile(resolve(publicDirectory, source), "utf8");
    const page = await browser.newPage({
      viewport: { width: size, height: size },
      deviceScaleFactor: 1,
    });
    await page.setContent(
      `<!doctype html><style>html,body{margin:0;padding:0}svg{display:block;width:${size}px;height:${size}px}</style>${markup}`,
    );
    await writeFile(
      resolve(directory, output),
      await page.screenshot({ omitBackground: true, type: "png" }),
    );
    await page.close();
    console.log(`${output.padEnd(24)} ${size}x${size}`);
  }
} finally {
  await browser.close();
}

console.log("\nRegenerating the desktop icon set from the 1024px master...");
execFileSync("pnpm", ["exec", "tauri", "icon", resolve(staging, "icon-1024.png")], {
  cwd: resolve(repositoryRoot, "apps", "desktop"),
  stdio: "inherit",
});
