import { readdir, readFile } from "node:fs/promises";
import { relative, resolve } from "node:path";

// reicon-react is the only icon pack ilo may use, and every glyph is reached through the registry
// in apps/web/src/components/icons.ts. See docs/design/system.md for the contract this enforces.
const repositoryRoot = resolve(import.meta.dirname, "..");
const scannedRoots = ["apps", "packages", "e2e"];
const registryPath = resolve(repositoryRoot, "apps", "web", "src", "components", "icons.ts");
const brandMarksPath = resolve(
  repositoryRoot,
  "apps",
  "web",
  "src",
  "components",
  "brand-marks.tsx",
);
const sourceExtensions = new Set([".ts", ".tsx"]);
const testSuffixes = [".test.ts", ".test.tsx", ".spec.ts", ".spec.tsx"];
const forbiddenPacks = [
  "lucide-react",
  "@phosphor-icons/react",
  "@tabler/icons-react",
  "react-icons",
  "@radix-ui/react-icons",
  "@heroicons/react",
];

function importPattern(packages) {
  const alternatives = packages
    .map((packageName) => packageName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|");
  return new RegExp(
    `(?:\\bfrom\\s*|\\bimport\\s*(?:\\(\\s*)?)["'](?:${alternatives})(?:/[^"']*)?["']`,
    "g",
  );
}

const rules = [
  {
    name: "forbidden icon pack",
    detail: "import icons from @/components/icons instead",
    pattern: importPattern(forbiddenPacks),
    appliesTo: () => true,
  },
  {
    name: "direct reicon-react import",
    detail: "only apps/web/src/components/icons.ts may import reicon-react",
    pattern: importPattern(["reicon-react"]),
    appliesTo: (path) => path !== registryPath,
  },
  {
    // Third-party brand marks are trademarks, not interface glyphs: their artwork is fixed by the
    // owner and some may not be recolored, so no icon pack can supply them. They live in one
    // reviewed module that records each mark's provenance, rather than as scattered exemptions.
    name: "inline svg markup",
    detail: "add an interface glyph to the icon registry, or a third-party mark to brand-marks.tsx",
    pattern: /<svg[\s>/]/g,
    appliesTo: (path) =>
      path !== registryPath &&
      path !== brandMarksPath &&
      !testSuffixes.some((suffix) => path.endsWith(suffix)),
  },
  {
    name: "brand artwork outside the brand-mark registry",
    detail: "import BrandMark from @/components/brand-marks instead",
    pattern: importPattern(["simple-icons"]),
    appliesTo: (path) => path !== brandMarksPath,
  },
];

async function sourceFiles(directory) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return [];
  }
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const path = resolve(directory, entry.name);
      if (entry.name === "node_modules" || entry.name === "dist") return [];
      if (entry.isDirectory()) return sourceFiles(path);
      if (!sourceExtensions.has(entry.name.slice(entry.name.lastIndexOf(".")))) return [];
      return [path];
    }),
  );
  return nested.flat();
}

const violations = [];
const paths = (
  await Promise.all(scannedRoots.map((root) => sourceFiles(resolve(repositoryRoot, root))))
).flat();

for (const path of paths) {
  const source = await readFile(path, "utf8");
  for (const { name, detail, pattern, appliesTo } of rules) {
    if (!appliesTo(path)) continue;
    for (const match of source.matchAll(pattern)) {
      const line = source.slice(0, match.index).split("\n").length;
      violations.push(`${relative(repositoryRoot, path)}:${line} ${name}: ${detail}`);
    }
  }
}

if (violations.length > 0) {
  console.error(`Icon contract violations:\n${violations.join("\n")}`);
  process.exit(1);
}
