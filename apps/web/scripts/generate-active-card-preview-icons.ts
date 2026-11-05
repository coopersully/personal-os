import { readFileSync, writeFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  ArrowDownIcon,
  CheckIcon,
  ClockIcon,
  ExternalLinkIcon,
  EyeOffIcon,
  LayersIcon,
  LinkOffIcon,
  LockIcon,
  MonitorIcon,
  RefreshIcon,
  SettingsIcon,
  UnlockIcon,
} from "@/components/icons";

// Generate lightweight assets from the app registry; no runtime React bundle.
const image = (icon: typeof LockIcon) => {
  const svg = renderToStaticMarkup(createElement(icon));
  return `<img alt="" width="14" height="14" src="data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}">`;
};
const icons = [UnlockIcon, LockIcon].map(image);
const menu = Object.fromEntries(
  Object.entries({
    complete: CheckIcon,
    retry: RefreshIcon,
    open: ExternalLinkIcon,
    snooze: ClockIcon,
    inactive: EyeOffIcon,
    separate: LinkOffIcon,
    unlock: UnlockIcon,
    gather: LayersIcon,
    dock: MonitorIcon,
    resize: ArrowDownIcon,
    settings: SettingsIcon,
  }).map(([key, icon]) => [key, image(icon)]),
);
const path = new URL("../active-cards-playground.html", import.meta.url);
const html = readFileSync(path, "utf8")
  .replace(
    /const joinIcons = .*?;\/\/ generated icons/,
    `const joinIcons = ${JSON.stringify(icons)};// generated icons`,
  )
  .replace(
    /const menuIcons = .*?;\/\/ generated menu icons/,
    `const menuIcons = ${JSON.stringify(menu)};// generated menu icons`,
  );
writeFileSync(path, html);
