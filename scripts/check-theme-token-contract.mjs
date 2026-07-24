import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const stylesheet = await readFile(resolve(projectRoot, "apps/web/src/styles.css"), "utf8");

function blockRangeFor(selector) {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`^${escapedSelector}\\s*\\{`, "m").exec(stylesheet);
  if (!match || match.index === undefined)
    throw new Error(`Could not find ${selector} theme block.`);
  const openingBrace = stylesheet.indexOf("{", match.index);
  let depth = 0;

  for (let index = openingBrace; index < stylesheet.length; index += 1) {
    if (stylesheet[index] === "{") depth += 1;
    if (stylesheet[index] === "}") depth -= 1;
    if (depth === 0) return [openingBrace, index + 1];
  }

  throw new Error(`Could not read ${selector} theme block.`);
}

function blockFor(selector) {
  const [openingBrace, end] = blockRangeFor(selector);
  return stylesheet.slice(openingBrace + 1, end - 1);
}

function tokensFor(selector, parentTokens = {}) {
  const tokens = { ...parentTokens };
  for (const match of blockFor(selector).matchAll(/^(\s*--[\w-]+):\s*([^;]+);/gm)) {
    tokens[match[1].trim()] = match[2].trim();
  }
  return tokens;
}

function resolveColor(tokens, token, trail = []) {
  if (trail.includes(token))
    throw new Error(`Circular theme token: ${[...trail, token].join(" → ")}`);
  const value = tokens[token];
  if (!value) throw new Error(`Missing theme token ${token}.`);
  if (/^#[\da-f]{6}$/i.test(value)) return value;
  const reference = value.match(/^var\((--[\w-]+)\)$/)?.[1];
  if (reference) return resolveColor(tokens, reference, [...trail, token]);
  throw new Error(`${token} must resolve to a hex color; received ${value}.`);
}

function relativeLuminance(hex) {
  const channels = hex
    .slice(1)
    .match(/.{2}/g)
    .map((channel) => Number.parseInt(channel, 16) / 255)
    .map((channel) => (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4));
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrast(first, second) {
  const [lighter, darker] = [relativeLuminance(first), relativeLuminance(second)].sort(
    (left, right) => right - left,
  );
  return (lighter + 0.05) / (darker + 0.05);
}

const light = tokensFor(":root");
const dark = tokensFor(".dark", light);
const violations = [];

const pairs = [
  {
    background: "--canvas",
    foreground: "--content-primary",
    maxDelta: 2,
    min: 12,
    name: "primary content",
  },
  {
    background: "--surface",
    foreground: "--content-secondary",
    maxDelta: 1,
    min: 4.5,
    name: "supporting content",
  },
  {
    background: "--sidebar",
    foreground: "--sidebar-foreground",
    maxDelta: 1,
    min: 4.5,
    name: "sidebar content",
  },
  {
    background: "--primary",
    foreground: "--primary-foreground",
    maxDelta: 1,
    min: 4.5,
    name: "primary action",
  },
  {
    background: "--status-danger-surface",
    foreground: "--status-danger-foreground",
    maxDelta: 1,
    min: 4.5,
    name: "danger status",
  },
  {
    background: "--status-info-surface",
    foreground: "--status-info-foreground",
    maxDelta: 1,
    min: 4.5,
    name: "info status",
  },
  {
    background: "--status-success-surface",
    foreground: "--status-success-foreground",
    maxDelta: 1,
    min: 4.5,
    name: "success status",
  },
  {
    background: "--status-warning-surface",
    foreground: "--status-warning-foreground",
    maxDelta: 1,
    min: 4.5,
    name: "warning status",
  },
  {
    background: "--calendar-event-surface",
    foreground: "--calendar-event-foreground",
    maxDelta: 1,
    min: 4.5,
    name: "calendar event",
  },
  {
    background: "--calendar-event-surface",
    foreground: "--calendar-event-muted",
    maxDelta: 1,
    min: 4.5,
    name: "calendar metadata",
  },
];

for (const { background, foreground, maxDelta, min, name } of pairs) {
  const lightRatio = contrast(resolveColor(light, foreground), resolveColor(light, background));
  const darkRatio = contrast(resolveColor(dark, foreground), resolveColor(dark, background));
  if (lightRatio < min || darkRatio < min) {
    violations.push(
      `${name} needs ${min}:1 contrast (light ${lightRatio.toFixed(2)}:1, dark ${darkRatio.toFixed(2)}:1).`,
    );
  }
  if (Math.abs(lightRatio - darkRatio) > maxDelta) {
    violations.push(
      `${name} themes differ by more than ${maxDelta}:1 (light ${lightRatio.toFixed(2)}:1, dark ${darkRatio.toFixed(2)}:1).`,
    );
  }
}

for (const theme of [light, dark]) {
  const ladder = ["--canvas", "--surface", "--surface-raised"].map((token) =>
    relativeLuminance(resolveColor(theme, token)),
  );
  if (!(ladder[0] < ladder[1] && ladder[1] < ladder[2])) {
    violations.push(
      "Material ladder must become lighter from canvas → surface → raised in each theme.",
    );
  }
}

const tokenBlockRanges = [blockRangeFor(":root"), blockRangeFor(".dark")];

// This stylesheet loads after Tailwind's utility layer. A generic inherited
// button colour would therefore override semantic `text-*-foreground`
// utilities and can erase text on primary controls in either theme.
const globalButtonRule = /(?:^|\n)button\s*\{([^}]*)\}/m.exec(stylesheet);
if (globalButtonRule?.[1] && /\bcolor\s*:\s*inherit\b/.test(globalButtonRule[1])) {
  violations.push(
    "Global `button { color: inherit; }` overrides semantic button foreground tokens. Remove it or scope it to a non-interactive component.",
  );
}

for (const match of stylesheet.matchAll(/#[\da-f]{3,8}\b|rgba\(/gi)) {
  const index = match.index ?? -1;
  if (!tokenBlockRanges.some(([start, end]) => index >= start && index < end)) {
    const line = stylesheet.slice(0, index).split("\n").length;
    violations.push(`styles.css:${line} uses ${match[0]} outside the semantic token blocks.`);
  }
}

if (violations.length > 0) {
  console.error(`Theme token contract violations:\n${violations.join("\n")}`);
  process.exit(1);
}
