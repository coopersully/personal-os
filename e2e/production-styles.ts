import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { Page } from "@playwright/test";

/** Exercise real components against the optimized stylesheet produced by serve.ts. */
export async function useProductionStyles(page: Page): Promise<void> {
  const assets = resolve(import.meta.dirname, "../apps/web/dist/assets");
  const files = (await readdir(assets)).filter((file) => file.endsWith(".css")).sort();
  if (files.length === 0) throw new Error("Missing production CSS: start the E2E server first.");
  const css = (
    await Promise.all(files.map((file) => readFile(resolve(assets, file), "utf8")))
  ).join("\n");
  await page.evaluate((stylesheet) => {
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
  }, css);
}
