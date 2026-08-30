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

if (violations.length > 0) {
  console.error(`Frontend theme contract violations:\n${violations.join("\n")}`);
  process.exit(1);
}
