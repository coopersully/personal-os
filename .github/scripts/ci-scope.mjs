import { execFileSync } from "node:child_process";
import { appendFileSync, readdirSync, readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const scopeKeys = [
  "prose_only",
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
  return (
    !parts.includes("..") &&
    !parts.includes("") &&
    !path.includes("\\") &&
    [...path].every((char) => char.charCodeAt(0) >= 32 && char.charCodeAt(0) !== 127) &&
    !parts.includes(".")
  );
}

// Narrow allowlist: repository prose only. Published skills (apps/web/public),
// generated tool dictionaries, fixtures, scripts and other extensions are inputs.
export function isDocumentation(path) {
  return (
    ["README.md", "AGENTS.md", "CONTRIBUTING.md"].includes(path) ||
    (/^docs\/(?:engineering|architecture|design|product)\/.*\.md$/u.test(path) &&
      path !== "docs/engineering/workspace-agent-tools.md") ||
    /^\.agents\/skills\/[^/]+\/(?:SKILL\.md|references\/[^/]+\.md)$/u.test(path)
  );
}

// A path list is iteration advice, never proof of prose-only final acceptance.
// Use both Git modes and the entire diff; --no-renames exposes every old path.
export function classifyGitChanges(base, head, options = {}) {
  if (![base, head].every((sha) => typeof sha === "string" && /^[a-f0-9]{40}$/u.test(sha)))
    return fullScope();
  try {
    const git = (...args) =>
      execFileSync("git", args, {
        cwd: options.root ?? repositoryRoot,
        encoding: "utf8",
        maxBuffer: 16 * 1024 * 1024,
        stdio: ["ignore", "pipe", "pipe"],
      });
    git("merge-base", "--is-ancestor", base, head);
    const raw = git("diff", "--raw", "--no-abbrev", "--no-renames", "-z", base, head, "--");
    const parts = raw.split("\0");
    if (parts.pop() !== "" || !parts.length || parts.length % 2) return fullScope();
    for (let i = 0; i < parts.length; i += 2) {
      const match = parts[i].match(/^:(\d{6}) (\d{6}) [a-f0-9]{40} [a-f0-9]{40} ([AM])$/u);
      if (
        match?.[2] !== "100644" ||
        match[1] !== (match[3] === "A" ? "000000" : "100644") ||
        !safePath(parts[i + 1]) ||
        !isDocumentation(parts[i + 1])
      )
        return fullScope();
    }
    return options.forceFull ? fullScope() : { ...emptyScope(), prose_only: true, repo: true };
  } catch {
    return fullScope();
  }
}

export function classifyChanges(paths, options = {}) {
  if (options.forceFull === true) return fullScope();
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
    if (isDocumentation(path)) {
      result.repo = true;
      continue;
    }

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
      result.node = true;
      result.containers = true;
      continue;
    }

    if (path.startsWith("e2e/")) {
      result.node = true;
      result.browser = true;
      continue;
    }

    if (path.startsWith(".codex/")) {
      result.repo = true;
      continue;
    }

    if (path.startsWith("scripts/")) {
      result.repo = true;
      result.node = true;
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

export const jobIds = [
  "changes",
  "infrastructure",
  "repository",
  "lint-and-format",
  "quality",
  "browser",
  "desktop",
];

export function expectedJobs(scope) {
  if (
    !scope ||
    typeof scope !== "object" ||
    Array.isArray(scope) ||
    Object.keys(scope).sort().join() !== [...scopeKeys, "changed_packages"].sort().join() ||
    scopeKeys.some((key) => typeof scope[key] !== "boolean") ||
    !Array.isArray(scope.changed_packages) ||
    scope.changed_packages.some(
      (name) => typeof name !== "string" || !name.startsWith("@personal-os/"),
    )
  )
    return null;
  if (
    scope.prose_only &&
    (scope.full ||
      !scope.repo ||
      scope.changed_packages.length ||
      scopeKeys.some((key) => !["prose_only", "repo"].includes(key) && scope[key]))
  )
    return null;
  // Final CI accepts only the Git classifier's two canonical states. The
  // package/path planner's partial scopes are not final acceptance evidence.
  if (scope.changed_packages.length) return null;
  if (scope.full && scopeKeys.every((key) => key === "full" || scope[key] === false))
    return [...jobIds];
  if (scope.prose_only) return ["changes", "repository"];
  return null;
}

export function requiredGate(results, scope) {
  const selected = expectedJobs(scope);
  if (
    !selected ||
    !results ||
    typeof results !== "object" ||
    Array.isArray(results) ||
    Object.keys(results).sort().join() !== [...jobIds].sort().join()
  )
    return false;
  return jobIds.every((job) =>
    selected.includes(job)
      ? results[job] === "success"
      : ["success", "skipped"].includes(results[job]),
  );
}

function githubOutputs(scope) {
  return [
    ...scopeKeys.map((key) => `${key}=${scope[key]}`),
    `required_jobs=${JSON.stringify(expectedJobs(scope))}`,
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
    if (["--files", "--github-output", "--base", "--head"].includes(argument)) {
      const value = args[index + 1];
      if (value === undefined) throw new Error(`${argument} requires a value.`);
      options[argument === "--github-output" ? "githubOutput" : argument.slice(2)] = value;
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${argument}`);
  }
  if (!(options.base !== undefined && options.head !== undefined) && !options.files)
    throw new Error("--base and --head, or --files, are required.");
  return options;
}

function runCli() {
  let options;
  let scope;
  try {
    options = parseArguments(process.argv.slice(2));
    scope =
      options.base !== undefined && options.head !== undefined
        ? classifyGitChanges(options.base, options.head, {
            forceFull: process.env.CI_FULL === "true",
          })
        : classifyChanges(readFileSync(options.files, "utf8").split(/\r?\n/u).filter(Boolean), {
            forceFull: process.env.CI_FULL === "true",
          });
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
