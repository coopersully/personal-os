import { readdir, readFile } from "node:fs/promises";
import { relative, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const roots = [
  "README.md",
  "CONTRIBUTING.md",
  "docs/design",
  "docs/product",
  "docs/deployment.md",
  "docs/mcp.md",
  "docs/releasing.md",
  "apps/api/src",
  "apps/mcp/src",
  "packages/connectors/src/icloud.ts",
  "packages/connectors/src/icloud.test.ts",
  "packages/api-client/src/client.test.ts",
  "apps/desktop/src-tauri/tauri.conf.json",
  "apps/desktop/src-tauri/Cargo.toml",
  "apps/desktop/src-tauri/src/lib.rs",
];
const sourceExtensions = new Set([".json", ".md", ".rs", ".toml", ".ts", ".tsx"]);

async function filesAt(path) {
  const entries = await readdir(path, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = resolve(path, entry.name);
      if (entry.isDirectory()) return filesAt(entryPath);
      return sourceExtensions.has(entry.name.slice(entry.name.lastIndexOf("."))) ? [entryPath] : [];
    }),
  );
  return nested.flat();
}

const files = (
  await Promise.all(
    roots.map(async (entry) => {
      const path = resolve(projectRoot, entry);
      const metadata = await readdir(resolve(path, ".."), { withFileTypes: true });
      const node = metadata.find((item) => item.name === path.split("/").at(-1));
      return node?.isDirectory() ? filesAt(path) : [path];
    }),
  )
).flat();

const protectedIdentifiers = [
  /x-ilo-client/g,
  /personal-os:\/\//g,
  /https:\/\/mcp\.ilo\.coopersully\.me\/mcp/g,
  /@[\w.-]*ilo\.coopersully\.me/g,
];
const violations = [];

for (const path of files) {
  let source = await readFile(path, "utf8");
  for (const pattern of protectedIdentifiers) source = source.replace(pattern, "<preserved>");
  for (const match of source.matchAll(/\bilo\b/gi)) {
    const line = source.slice(0, match.index).split("\n").length;
    violations.push(`${relative(projectRoot, path)}:${line} public brand must be nohmi`);
  }
}

if (violations.length > 0) {
  console.error(`Public brand contract violations:\n${violations.join("\n")}`);
  process.exit(1);
}
