// Run from repository root: pnpm exec tsx --tsconfig apps/web/tsconfig.json apps/mobile/scripts/generate-provider-marks.mjs
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { chromium } from "@playwright/test";
import { BrandMark, hasBrandMark } from "../../web/src/components/brand-marks";

// Render with the canonical web component’s React instance, not Expo’s separate React version.
const webRequire = createRequire(resolve(import.meta.dirname, "../../web/package.json"));
const { createElement } = webRequire("react");
const { renderToStaticMarkup } = webRequire("react-dom/server");

// Artwork/provenance stay canonical in web BrandMark. Native bundles its rendered pixels,
// never copies SVG paths or imports a trademark source independently.
const providers = ["google", "apple", "icloud", "x"];
const directory = resolve(import.meta.dirname, "../assets/providers");
await mkdir(directory, { recursive: true });
const browser = await chromium.launch();
try {
  for (const scale of [1, 2, 3]) {
    const page = await browser.newPage({
      viewport: { width: 24, height: 24 },
      deviceScaleFactor: scale,
    });
    for (const provider of providers) {
      if (!hasBrandMark(provider)) throw new Error(`No canonical artwork for ${provider}.`);
      const markup = renderToStaticMarkup(
        createElement(BrandMark, { brand: provider, decorative: true }),
      );
      // Google owns its full-color fills; CSS color must never replace or tint them.
      const tones =
        provider === "google" ? { color: "#202024" } : { light: "#202024", dark: "#fafafa" };
      for (const [tone, color] of Object.entries(tones)) {
        await page.setContent(
          `<style>html,body{margin:0;background:transparent;color:${color}}svg{display:block;width:24px;height:24px}</style>${markup}`,
        );
        await writeFile(
          resolve(directory, `${provider}-${tone}${scale === 1 ? "" : `@${scale}x`}.png`),
          await page.screenshot({ omitBackground: true }),
        );
      }
    }
    await page.close();
  }
} finally {
  await browser.close();
}
