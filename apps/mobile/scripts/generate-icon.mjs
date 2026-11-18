// Render the existing canonical mark with an opaque background for Apple's app icon contract.
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "@playwright/test";

const root = resolve(import.meta.dirname, "../../..");
const svg = await readFile(resolve(root, "apps/web/public/icon.svg"), "utf8");
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1024, height: 1024 } });
  await page.setContent(
    `<style>html,body{margin:0;background:#18181b}svg{display:block;width:1024px;height:1024px}</style>${svg}`,
  );
  await writeFile(
    resolve(root, "apps/mobile/assets/icon.png"),
    await page.screenshot({ omitBackground: false }),
  );
} finally {
  await browser.close();
}
