import { readdir, readFile } from "node:fs/promises";
import { relative, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..", "apps", "web", "src");
const sourceExtensions = new Set([".ts", ".tsx"]);
const excludedSuffixes = [".test.ts", ".test.tsx", ".spec.ts", ".spec.tsx"];
const forbiddenPatterns = [
  {
    name: "Tailwind palette color",
    pattern:
      /\b(?:bg|text|border|ring|fill|stroke)-(?:black|white|slate|gray|zinc|neutral|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)(?:-\d{1,3}|\/\d{1,3})?\b/g,
  },
  {
    name: "arbitrary color utility",
    pattern: /\b(?:bg|text|border|ring|fill|stroke)-\[[^\]]*(?:color|#|rgb|hsl|oklch)/g,
  },
  {
    name: "gradient utility",
    pattern: /\b(?:bg|from|via|to)-(?:linear|radial|conic|gradient)[\w/[\]-]*/g,
  },
  {
    name: "blurred or frosted treatment",
    pattern: /\bbackdrop-(?:blur|filter)[\w/[\]-]*/g,
  },
  {
    name: "decorative elevation shadow",
    pattern: /\b(?:shadow|drop-shadow)-(?:sm|md|lg|xl|2xl|inner|none)[\w/[\]-]*/g,
  },
  {
    name: "ring treatment",
    pattern: /\bring-(?:\[[^\]]+\]|[\w/.-]+)/g,
  },
];

const stylesheet = await readFile(resolve(root, "styles.css"), "utf8");
const stylesheetForDecorativeChecks = stylesheet
  .replace(
    /\/\* theme-contract-allow-start: functional-calendar-grid \*\/[\s\S]*?\/\* theme-contract-allow-end: functional-calendar-grid \*\//g,
    "",
  )
  // The approved Setup edge fade keeps floating controls legible over content.
  // Exempt only this selector and canvas-colored declaration, not other effects.
  .replace(
    /(\.setup-navigation__fade\s*\{\s*)background: linear-gradient\(to bottom, transparent, var\(--canvas\) 62%\);/g,
    "$1",
  );
const stylesheetPatterns = [
  { name: "gradient", pattern: /(?:linear|radial|conic)-gradient\(/g },
  { name: "decorative shadow", pattern: /(?:box|text)-shadow\s*:/g },
  { name: "frosted backdrop", pattern: /backdrop-filter\s*:/g },
];
const flatPrimitiveFiles = [
  "avatar.tsx",
  "badge.tsx",
  "button.tsx",
  "card.tsx",
  "checkbox.tsx",
  "context-menu.tsx",
  "dialog.tsx",
  "dropdown-menu.tsx",
  "empty.tsx",
  "input-group.tsx",
  "input-otp.tsx",
  "input.tsx",
  "item.tsx",
  "native-select.tsx",
  "popover.tsx",
  "radio-group.tsx",
  "sheet.tsx",
  "sidebar.tsx",
  "slider.tsx",
  "sonner.tsx",
  "switch.tsx",
  "tabs.tsx",
  "textarea.tsx",
  "toggle.tsx",
];

function withoutAllowedBoundaries(source) {
  return source
    .replace(/\b(?:focus-visible|aria-invalid|data-\[[^\]]+\]|forced-colors):[^\s"'`]+/g, "")
    .replaceAll("border-transparent", "");
}

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) return sourceFiles(path);
      if (!sourceExtensions.has(entry.name.slice(entry.name.lastIndexOf(".")))) return [];
      if (excludedSuffixes.some((suffix) => entry.name.endsWith(suffix))) return [];
      return [path];
    }),
  );
  return nested.flat();
}

const violations = [];
for (const path of await sourceFiles(root)) {
  const source = await readFile(path, "utf8");
  for (const { name, pattern } of forbiddenPatterns) {
    for (const match of source.matchAll(pattern)) {
      const line = source.slice(0, match.index).split("\n").length;
      violations.push(
        `${relative(resolve(import.meta.dirname, ".."), path)}:${line} ${name}: ${match[0]}`,
      );
    }
  }
}

for (const { name, pattern } of stylesheetPatterns) {
  for (const match of stylesheetForDecorativeChecks.matchAll(pattern)) {
    const line = stylesheetForDecorativeChecks.slice(0, match.index).split("\n").length;
    violations.push(`apps/web/src/styles.css:${line} ${name}: ${match[0]}`);
  }
}

for (const file of flatPrimitiveFiles) {
  const path = resolve(root, "components", "ui", file);
  const source = withoutAllowedBoundaries(await readFile(path, "utf8"));
  const visibleRestingBorder = source.match(
    /\b(?:border|border-[trblxy])-(?:border|input|sidebar-border)\b/,
  );
  if (visibleRestingBorder) {
    const line = source.slice(0, visibleRestingBorder.index).split("\n").length;
    violations.push(
      `${relative(resolve(import.meta.dirname, ".."), path)}:${line} visible resting border: ${visibleRestingBorder[0]}`,
    );
  }
}

if (violations.length > 0) {
  console.error(`Frontend theme contract violations:\n${violations.join("\n")}`);
  process.exit(1);
}
