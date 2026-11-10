import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "@playwright/test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as registry from "../../web/src/components/icons";

// The web registry remains the only module importing reicon. Native uses generated template images.
const names = [
  "FileText",
  "Download",
  "Reply",
  "Forward",
  "CircleArrowUp",
  "Tags",
  "Layers",
  "CircleHelp",
  "GroceryCart",
  "Dining",
  "Transport",
  "Travel",
  "Health",
  "Merchant",
  "Dollar",
  "Education",
  "Gift",
  "Entertainment",
  "Sparkles",

  "Info",
  "Plus",
  "Edit",
  "X",
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
    for (const name of names.filter(
      (name) => !process.env.ICON_NAMES || process.env.ICON_NAMES.split(",").includes(name),
    )) {
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
    for (const name of ["Trash", "Archive", "X", "Pin", "Settings", "CircleCheck", "History"]) {
      // Native menu images preserve original pixels, so ship explicit semantic color variants.
      for (const [tone, color] of Object.entries({
        Light: "#202024",
        Dark: "#fafafa",
        DestructiveLight: "#ba2944",
        DestructiveDark: "#ff8190",
      })) {
        // biome-ignore lint/performance/noDynamicNamespaceImportAccess: build-time registry asset generation.
        const svg = renderToStaticMarkup(createElement(registry[`${name}Icon`], { color }));
        await page.setContent(
          `<style>html,body{margin:0;background:transparent;color:${color}}svg{display:block;color:${color}}</style>${svg}`,
        );
        await writeFile(
          resolve(directory, `${name}Menu${tone}${scale === 1 ? "" : `@${scale}x`}.png`),
          await page.screenshot({ omitBackground: true }),
        );
      }
    }
    await page.close();
  }
} finally {
  await browser.close();
}
