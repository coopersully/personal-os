import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "@playwright/test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as registry from "../../web/src/components/icons";

// The web registry remains the only module importing reicon. Native uses generated template images.
const names = [
  "Plus",
  "Trash",
  "Check",
  "House",
  "Star",
  "Users",
  "Sun",
  "Mail",
  "ListChecks",
  "Calendar",
  "Bank",
  "Clock",
  "CircleCheck",
  "CircleAlert",
  "ChevronRight",
  "Receipt",
  "Archive",
  "User",
  "LinkOff",
  "ListTodo",
  "Pin",
  "History",
  "Inbox",
  "Grid",
  "Wallet",
  "Settings",
  "Target",
];
const directory = resolve(import.meta.dirname, "../assets/navigation");
await mkdir(directory, { recursive: true });
const browser = await chromium.launch();
try {
  for (const scale of [1, 2, 3]) {
    const page = await browser.newPage({
      viewport: { width: 24, height: 24 },
      deviceScaleFactor: scale,
    });
    for (const name of names) {
      for (const weight of ["Outline", "Filled"]) {
        // biome-ignore lint/performance/noDynamicNamespaceImportAccess: build-time asset generation, never bundled into the client.
        const svg = renderToStaticMarkup(createElement(registry[`${name}Icon`], { weight }));
        await page.setContent(
          `<style>html,body{margin:0;background:transparent}svg{display:block}</style>${svg}`,
        );
        await writeFile(
          resolve(
            directory,
            `${name}${weight === "Filled" ? "Filled" : ""}${scale === 1 ? "" : `@${scale}x`}.png`,
          ),
          await page.screenshot({ omitBackground: true }),
        );
      }
    }
    await page.close();
  }
} finally {
  await browser.close();
}
