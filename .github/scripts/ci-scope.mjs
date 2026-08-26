import { appendFileSync, readdirSync, readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const scopeKeys = [
  "full",
  "repo",
  "terraform",
  "node",
  "database",
  "browser",
  "desktop",
  "containers",
  "dependencies",
];

function emptyScope() {
  return Object.fromEntries([...scopeKeys.map((key) => [key, false]), ["changed_packages", []]]);
}

function fullScope(overrides = {}) {
  return { ...emptyScope(), full: true, ...overrides };
}

function workspacePackages() {
  const packages = [];
  for (const root of ["apps", "packages"]) {
    const rootPath = resolve(repositoryRoot, root);
    for (const entry of readdirSync(rootPath, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const relativeDirectory = `${root}/${entry.name}`;
      const manifest = JSON.parse(
        readFileSync(resolve(repositoryRoot, relativeDirectory, "package.json"), "utf8"),
      );
      packages.push({
        dependencies: new Set(
          Object.keys({
            ...manifest.dependencies,
            ...manifest.devDependencies,
            ...manifest.optionalDependencies,
            ...manifest.peerDependencies,
          }).filter((name) => name.startsWith("@personal-os/")),
        ),
        directory: relativeDirectory,
        name: manifest.name,
      });
    }
  }
  return packages;
}

function expandDependents(changedNames, packages) {
  const expanded = new Set(changedNames);
  let changed = true;
  while (changed) {
    changed = false;
    for (const workspacePackage of packages) {
      if (expanded.has(workspacePackage.name)) continue;
      if ([...workspacePackage.dependencies].some((dependency) => expanded.has(dependency))) {
        expanded.add(workspacePackage.name);
        changed = true;
      }
    }
  }
  return expanded;
}

function safePath(path) {
  if (typeof path !== "string" || path.length === 0 || isAbsolute(path)) return false;
  const parts = path.split("/");
  return !parts.includes("..") && !parts.includes("") && !path.includes("\\");
}

function isDocumentation(path) {
  return path === "README.md" || path === "AGENTS.md" || path.startsWith("docs/");
}

export function classifyChanges(paths, options = {}) {
  if (options.diffError || !Array.isArray(paths) || paths.length === 0) return fullScope();
  if (paths.some((path) => !safePath(path))) return fullScope();

  const result = emptyScope();
  let packages;
  try {
    packages = workspacePackages();
  } catch {
    return fullScope();
  }
  const directlyChangedPackages = new Set();

  for (const path of paths) {
    if (isDocumentation(path)) continue;

    if (path === "pnpm-lock.yaml" || path === "pnpm-workspace.yaml" || path === "package.json") {
      result.full = true;
      result.dependencies = true;
      continue;
    }

    if (path.endsWith("/package.json")) {
      result.full = true;
      result.dependencies = true;
      continue;
    }

    if (path.startsWith(".github/")) {
      result.full = true;
      continue;
    }

    if (path.startsWith("infra/")) {
      result.terraform = true;
      continue;
    }

    if (path === "Dockerfile" || path === "compose.yaml" || path === "compose.yml") {
      result.containers = true;
      continue;
    }

    if (path.startsWith("e2e/")) {
      result.node = true;
      result.browser = true;
      continue;
    }

    if (path.startsWith(".codex/") || path.startsWith("scripts/")) {
      result.repo = true;
      continue;
    }

    const workspacePackage = packages.find(
      ({ directory }) => path === directory || path.startsWith(`${directory}/`),
    );
    if (workspacePackage) {
      directlyChangedPackages.add(workspacePackage.name);
      continue;
    }

    if (
      path === "biome.json" ||
      path === "playwright.config.ts" ||
      path === "vitest.config.ts" ||
      path.startsWith("tsconfig")
    ) {
      result.full = true;
      continue;
    }

    result.full = true;
  }

  if (directlyChangedPackages.size > 0) {
    const expanded = expandDependents(directlyChangedPackages, packages);
    result.changed_packages = [...expanded].sort();
    result.node = [...expanded].some((name) => name !== "@personal-os/desktop");
    result.database = directlyChangedPackages.has("@personal-os/database");
    result.browser = expanded.has("@personal-os/api") || expanded.has("@personal-os/web");
    result.desktop =
      directlyChangedPackages.has("@personal-os/desktop") || expanded.has("@personal-os/web");
    result.containers = ["@personal-os/api", "@personal-os/mcp", "@personal-os/web"].some((name) =>
      expanded.has(name),
    );
  }

  return result;
}

function githubOutputs(scope) {
  return [
    ...scopeKeys.map((key) => `${key}=${scope[key]}`),
    `changed_packages=${JSON.stringify(scope.changed_packages)}`,
    `scope_json=${JSON.stringify(scope)}`,
  ].join("\n");
}

function parseArguments(args) {
  const options = { json: false };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--json") {
      options.json = true;
      continue;
    }
    if (argument === "--files" || argument === "--github-output") {
      const value = args[index + 1];
      if (!value) throw new Error(`${argument} requires a path.`);
      options[argument === "--files" ? "files" : "githubOutput"] = value;
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${argument}`);
  }
  if (!options.files) throw new Error("--files is required.");
  return options;
}

function runCli() {
  let options;
  let scope;
  try {
    options = parseArguments(process.argv.slice(2));
    const paths = readFileSync(options.files, "utf8").split(/\r?\n/u).filter(Boolean);
    scope = classifyChanges(paths);
  } catch (error) {
    scope = fullScope();
    process.stderr.write(`CI scope classifier failed closed: ${error.message}\n`);
  }

  if (options?.githubOutput) {
    appendFileSync(options.githubOutput, `${githubOutputs(scope)}\n`);
  }
  if (options?.json || !options?.githubOutput) {
    process.stdout.write(`${JSON.stringify(scope)}\n`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runCli();
}
