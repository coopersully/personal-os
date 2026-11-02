import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { Page } from "@playwright/test";

/** Exercise real components against the optimized stylesheet produced by serve.ts. */
export async function useProductionStyles(page: Page): Promise<void> {
  const assets = resolve(import.meta.dirname, "../apps/web/dist/assets");
  const assetFiles = await readdir(assets);
  const files = assetFiles.filter((file) => file.endsWith(".css")).sort();
  if (files.length === 0) throw new Error("Missing production CSS: start the E2E server first.");
  let css = (await Promise.all(files.map((file) => readFile(resolve(assets, file), "utf8")))).join(
    "\n",
  );
  // Vite dev does not serve dist/assets. Use the exact emitted font bytes so
  // the optimized stylesheet retains its shipped metrics in this regression.
  const fonts = await Promise.all(
    assetFiles
      .filter((file) => file.endsWith(".woff2") && css.includes(`/assets/${file}`))
      .map(async (file) => ({
        url: `/assets/${file}`,
        data: (await readFile(resolve(assets, file))).toString("base64"),
      })),
  );
  for (const font of fonts) css = css.replaceAll(font.url, `data:font/woff2;base64,${font.data}`);
  await page.evaluate(async (stylesheet) => {
    // Keep runtime focus/scroll-lock styles; replace only Vite's source styles.
    document
      .querySelectorAll(
        'style[data-vite-dev-id], style[data-production-styles], link[rel="stylesheet"]',
      )
      .forEach((element) => {
        element.remove();
      });
    const style = document.createElement("style");
    style.setAttribute("data-production-styles", "");
    style.textContent = stylesheet;
    document.head.append(style);
    const fonts = await document.fonts.load('16px "Geist Variable"');
    if (fonts.length === 0) throw new Error("Production Geist font did not load.");
    await document.fonts.ready;
  }, css);
}
