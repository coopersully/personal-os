/** Generate native artwork from the semantic reicon registry with the existing Chromium renderer. */
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  ArrowDownIcon,
  CheckIcon,
  ClockIcon,
  ExternalLinkIcon,
  LayersIcon,
  LinkOffIcon,
  LockIcon,
  MonitorIcon,
  SettingsIcon,
  UnlockIcon,
} from "@/components/icons";

const out = new URL("../../desktop/src-tauri/card-icons/", import.meta.url);
mkdirSync(out, { recursive: true });
const icons = {
  lock: LockIcon,
  unlock: UnlockIcon,
  complete: CheckIcon,
  open: ExternalLinkIcon,
  snooze: ClockIcon,
  separate: LinkOffIcon,
  gather: LayersIcon,
  edge: MonitorIcon,
  reset: ArrowDownIcon,
  settings: SettingsIcon,
};
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 32, height: 32 } });
  for (const [name, Icon] of Object.entries(icons)) {
    const svg = renderToStaticMarkup(createElement(Icon));
    await page.setContent(
      `<style>body{margin:0}svg{width:32px;height:32px;color:#000}</style>${svg}`,
    );
    await page.locator("svg").screenshot({
      path: fileURLToPath(new URL(`${name}.png`, out)),
      omitBackground: true,
    });
  }
} finally {
  await browser.close();
}
