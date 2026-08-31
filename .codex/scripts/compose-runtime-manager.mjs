#!/usr/bin/env node
import { execFile as execFileCallback, spawn } from "node:child_process";
import { access, readFile, rm } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import {
  deriveRuntimeIdentity,
  projectsFromDockerInspect,
  reconcileOrphans,
  selectRuntimePort,
  worktreeRootsFromPorcelain,
  writeRuntimeOverlay,
} from "./worktree-runtime.mjs";

const execFile = promisify(execFileCallback);

async function command(file, args, options = {}) {
  return execFile(file, args, { encoding: "utf8", maxBuffer: 10 * 1024 * 1024, ...options });
}

async function execAttached(file, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { stdio: "inherit", ...options });
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve(code ?? (signal ? 1 : 0)));
  });
}

async function allocatePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once("error", reject);
    server.listen({ host: "127.0.0.1", port: 0 }, () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : null;
      server.close((error) =>
        error || !port ? reject(error ?? new Error("No port")) : resolve(port),
      );
    });
  });
}

async function canBind(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.once("error", () => resolve(false));
    server.listen({ host: "127.0.0.1", port }, () => server.close(() => resolve(true)));
  });
}

async function getContext(rootArgument) {
  const rootResult = await command("git", ["-C", rootArgument, "rev-parse", "--show-toplevel"]);
  const root = path.resolve(rootResult.stdout.trim());
  const commonResult = await command("git", [
    "-C",
    root,
    "rev-parse",
    "--path-format=absolute",
    "--git-common-dir",
  ]);
  return {
    ...deriveRuntimeIdentity({ commonDir: commonResult.stdout.trim(), root }),
    composeFile: path.join(root, ".codex/runtime/compose.yaml"),
    envFile: path.join(root, ".env"),
    overlayFile: path.join(root, ".env.codex.local"),
  };
}

async function getStoredPort(overlayFile) {
  try {
    const content = await readFile(overlayFile, "utf8");
    const match = content.match(/^LOCAL_WEB_PORT=(\d+)$/m);
    return match ? Number.parseInt(match[1], 10) : null;
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function projectExists(project) {
  const result = await command("docker", [
    "ps",
    "-a",
    "--filter",
    `label=com.docker.compose.project=${project}`,
    "--format",
    "{{.ID}}",
  ]);
  return result.stdout.trim().length > 0;
}

async function listProjects(context) {
  const result = await command("docker", [
    "ps",
    "-a",
    "--filter",
    `label=app.ilo.runtime.repository=${context.repositoryId}`,
    "--format",
    "{{.ID}}",
  ]);
  const ids = result.stdout.trim().split(/\s+/).filter(Boolean);
  if (ids.length === 0) return [];
  const inspected = await command("docker", ["inspect", ...ids]);
  return projectsFromDockerInspect(JSON.parse(inspected.stdout));
}

async function listWorktreeRoots(context) {
  const result = await command("git", [
    "-C",
    context.root,
    "worktree",
    "list",
    "--porcelain",
    "-z",
  ]);
  return worktreeRootsFromPorcelain(result.stdout);
}

async function removeLabeledResources(type, project, repositoryId) {
  const noun = type === "container" ? "ps" : type;
  const args = type === "container" ? ["ps", "-a", "-q"] : [noun, "ls", "-q"];
  const result = await command("docker", [
    ...args,
    "--filter",
    `label=com.docker.compose.project=${project}`,
    "--filter",
    `label=app.ilo.runtime.repository=${repositoryId}`,
  ]);
  const ids = result.stdout.trim().split(/\s+/).filter(Boolean);
  if (ids.length === 0) return;
  if (type === "container") await command("docker", ["rm", "-f", ...ids]);
  else await command("docker", [noun, "rm", ...ids]);
}

async function removeProject(project) {
  await removeLabeledResources("container", project.project, project.repositoryId);
  await removeLabeledResources("network", project.project, project.repositoryId);
  await removeLabeledResources("volume", project.project, project.repositoryId);
}

async function reconcile(context, { prune = false } = {}) {
  return reconcileOrphans({
    listProjects: () => listProjects(context),
    listWorktreeRoots: () => listWorktreeRoots(context),
    prune,
    removeProject,
    repositoryId: context.repositoryId,
  });
}

function composeArgs(context) {
  return [
    "compose",
    "--env-file",
    context.envFile,
    "--env-file",
    context.overlayFile,
    "-f",
    context.composeFile,
    "-p",
    context.composeProject,
  ];
}

function rootArgument(args) {
  const index = args.indexOf("--root");
  return index >= 0 && args[index + 1] ? args[index + 1] : process.cwd();
}

export async function runManager(args, overrides = {}) {
  const deps = {
    allocatePort,
    canBind,
    exec: command,
    execAttached,
    getContext,
    getStoredPort,
    projectExists,
    reconcile,
    removeOverlay: (file) => rm(file, { force: true }),
    stderr: (line) => process.stderr.write(`${line}\n`),
    stdout: (line) => process.stdout.write(`${line}\n`),
    writeRuntimeOverlay,
    ...overrides,
  };
  const action = args[0];
  const context = await deps.getContext(rootArgument(args));
  const exists = await deps.projectExists(context.composeProject);

  if (action === "status" && !exists) {
    deps.stdout(`Runtime: ${context.composeProject}\nState: not created`);
    return 0;
  }

  if (action === "purge") {
    if (!args.includes("--acknowledge-data-loss")) {
      deps.stderr("Refusing to delete the worktree database without --acknowledge-data-loss.");
      return 2;
    }
    if (exists) {
      await deps.exec("docker", [
        ...composeArgs(context),
        "down",
        "--volumes",
        "--remove-orphans",
        "--timeout=15",
      ]);
    }
    await deps.removeOverlay(context.overlayFile);
    deps.stdout(`Deleted ${context.composeProject} containers, network, and volumes.`);
    return 0;
  }

  if (action === "start") {
    await deps.reconcile(context, { prune: true });
    const storedPort = await deps.getStoredPort(context.overlayFile);
    const port = await selectRuntimePort({
      allocatePort: deps.allocatePort,
      canBind: deps.canBind,
      projectExists: exists,
      storedPort,
    });
    await deps.writeRuntimeOverlay(context.root, { ...context, port });
    deps.stdout(`App, API, and MCP: http://127.0.0.1:${port}`);
    return deps.execAttached("docker", [
      ...composeArgs(context),
      "up",
      "--build",
      "--watch",
      "--remove-orphans",
    ]);
  }

  if (action === "fixtures") {
    const storedPort = await deps.getStoredPort(context.overlayFile);
    const port = await selectRuntimePort({
      allocatePort: deps.allocatePort,
      canBind: deps.canBind,
      projectExists: exists,
      storedPort,
    });
    await deps.writeRuntimeOverlay(context.root, { ...context, port });
    await deps.exec("docker", [...composeArgs(context), "up", "-d", "--build", "--wait"]);
    await deps.exec("docker", [
      ...composeArgs(context),
      "exec",
      "-T",
      "-e",
      "MIGRATIONS_DIR=/workspace/packages/database/migrations",
      "api",
      "pnpm",
      "exec",
      "tsx",
      "scripts/qa-fixtures.ts",
      "load",
    ]);
    deps.stdout(`Loaded QA fixtures into ${context.composeProject}.`);
    return 0;
  }

  if (action === "gc") {
    const prune = args.includes("--prune");
    const orphans = await deps.reconcile(context, { prune });
    if (orphans.length === 0) deps.stdout("No orphaned worktree projects found.");
    else {
      for (const orphan of orphans) {
        deps.stdout(`${prune ? "Removed" : "Would remove"}: ${orphan.project} (${orphan.root})`);
      }
    }
    return 0;
  }

  if (action === "stop") {
    if (exists) await deps.exec("docker", [...composeArgs(context), "stop", "--timeout=15"]);
    return 0;
  }

  if (action === "status") {
    const result = await deps.exec("docker", [...composeArgs(context), "ps"]);
    deps.stdout(result.stdout.trimEnd());
    return 0;
  }

  if (action === "logs") {
    return deps.execAttached("docker", [...composeArgs(context), "logs", "--tail=160", "--follow"]);
  }

  if (action === "config") {
    const storedPort = await deps.getStoredPort(context.overlayFile);
    deps.stdout(
      storedPort
        ? `Compose: ${context.composeProject}\nURL: http://127.0.0.1:${storedPort}`
        : `Compose: ${context.composeProject}\nURL: not assigned until first start`,
    );
    return 0;
  }

  deps.stderr(`Unknown runtime action: ${action ?? ""}`);
  return 2;
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  try {
    await access(process.cwd());
    process.exitCode = await runManager(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(
      `[ilo] error: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}
