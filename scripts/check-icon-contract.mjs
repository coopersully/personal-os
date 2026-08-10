import { readdir, readFile } from "node:fs/promises";
import { relative, resolve } from "node:path";

// reicon-react is the only icon pack ilo may use, and every glyph is reached through the registry
// in apps/web/src/components/icons.ts. See docs/design/system.md for the contract this enforces.
const repositoryRoot = resolve(import.meta.dirname, "..");
const scannedRoots = ["apps", "packages", "e2e"];
const registryPath = resolve(repositoryRoot, "apps", "web", "src", "components", "icons.ts");
const sourceExtensions = new Set([".ts", ".tsx"]);
const testSuffixes = [".test.ts", ".test.tsx", ".spec.ts", ".spec.tsx"];
// Third-party brand marks (provider logos) are not interface glyphs: they must reproduce the
// owner's exact artwork and colors, so no icon pack can supply them. Annotate each one with
// `icon-contract-allow: <reason>` on or above the element so the exception stays reviewable.
const allowMarker = /icon-contract-allow:/;
const forbiddenPacks = [
  "lucide-react",
  "@phosphor-icons/react",
  "@tabler/icons-react",
  "react-icons",
  "@radix-ui/react-icons",
  "@heroicons/react",
];

const rules = [
  {
    name: "forbidden icon pack",
    detail: "import icons from @/components/icons instead",
    pattern: new RegExp(
      `\\bfrom\\s*["'](?:${forbiddenPacks.map((pack) => pack.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})(?:/[^"']*)?["']`,
      "g",
    ),
    appliesTo: () => true,
  },
  {
    name: "direct reicon-react import",
    detail: "only apps/web/src/components/icons.ts may import reicon-react",
    pattern: /\bfrom\s*["']reicon-react(?:\/[^"']*)?["']/g,
    appliesTo: (path) => path !== registryPath,
  },
  {
    name: "inline svg glyph",
    detail:
      "add the glyph to the icon registry, or mark a third-party brand mark with icon-contract-allow",
    pattern: /<svg[\s>/]/g,
    appliesTo: (path) =>
      path !== registryPath && !testSuffixes.some((suffix) => path.endsWith(suffix)),
    allowedBy: (source, index) =>
      allowMarker.test(source.slice(0, index).split("\n").slice(-4).join("\n")),
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
  for (const { name, detail, pattern, appliesTo, allowedBy } of rules) {
    if (!appliesTo(path)) continue;
    for (const match of source.matchAll(pattern)) {
      if (allowedBy?.(source, match.index)) continue;
      const line = source.slice(0, match.index).split("\n").length;
      violations.push(`${relative(repositoryRoot, path)}:${line} ${name}: ${detail}`);
    }
  }
}

if (violations.length > 0) {
  console.error(`Icon contract violations:\n${violations.join("\n")}`);
  process.exit(1);
}
