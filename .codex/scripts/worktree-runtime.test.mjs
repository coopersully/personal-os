import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  buildRuntimeOverlay,
  deriveRuntimeIdentity,
  findOrphanProjects,
  projectsFromDockerInspect,
  reconcileOrphans,
  selectRuntimePort,
  worktreeRootsFromPorcelain,
  writeRuntimeOverlay,
} from "./worktree-runtime.mjs";

test("a worktree gets a stable Compose identity without a shared registry", () => {
  const first = deriveRuntimeIdentity({
    commonDir: "/repo/.git",
    root: "/repo/.worktrees/calendar",
  });
  const again = deriveRuntimeIdentity({
    commonDir: "/repo/.git",
    root: "/repo/.worktrees/calendar",
  });
  const other = deriveRuntimeIdentity({
    commonDir: "/repo/.git",
    root: "/repo/.worktrees/mail",
  });

  assert.deepEqual(first, again);
  assert.match(first.runtimeId, /^[a-f0-9]{12}$/);
  assert.equal(first.composeProject, `ilo-${first.runtimeId}`);
  assert.notEqual(first.composeProject, other.composeProject);
  assert.equal(first.repositoryId, other.repositoryId);
});

test("the generated environment uses one public loopback origin", () => {
  const overlay = buildRuntimeOverlay({
    composeProject: "ilo-123456789abc",
    port: 49152,
    repositoryId: "0123456789abcdef",
    root: "/repo/.worktrees/calendar",
    runtimeId: "123456789abc",
  });

  assert.match(overlay, /^COMPOSE_PROJECT_NAME=ilo-123456789abc$/m);
  assert.match(overlay, /^LOCAL_WEB_PORT=49152$/m);
  assert.match(overlay, /^APP_BASE_URL=http:\/\/127\.0\.0\.1:49152$/m);
  assert.match(overlay, /^API_BASE_URL=http:\/\/127\.0\.0\.1:49152$/m);
  assert.match(overlay, /^MCP_RESOURCE_URL=http:\/\/127\.0\.0\.1:49152\/mcp$/m);
  assert.match(
    overlay,
    /^GOOGLE_REDIRECT_URI=http:\/\/127\.0\.0\.1:49152\/v1\/connectors\/google\/callback$/m,
  );
  assert.doesNotMatch(overlay, /DATABASE_URL|APP_ENCRYPTION_KEY|MCP_INTERNAL_SECRET/);
});

test("runtime configuration is atomically written with private permissions", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ilo-compose-runtime-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const runtime = {
    composeProject: "ilo-123456789abc",
    port: 49152,
    repositoryId: "0123456789abcdef",
    root,
    runtimeId: "123456789abc",
  };

  await writeRuntimeOverlay(root, runtime);

  const file = path.join(root, ".env.codex.local");
  assert.equal((await stat(file)).mode & 0o777, 0o600);
  assert.equal(await readFile(file, "utf8"), buildRuntimeOverlay(runtime));
});

test("orphan detection trusts Git worktrees and repository ownership labels", () => {
  const projects = [
    { project: "ilo-live", repositoryId: "repo-a", root: "/repo/live" },
    { project: "ilo-orphan", repositoryId: "repo-a", root: "/repo/deleted" },
    { project: "someone-else", repositoryId: "repo-b", root: "/other/deleted" },
  ];

  assert.deepEqual(findOrphanProjects(projects, new Set(["/repo/live"]), "repo-a"), [projects[1]]);
});

test("a stopped Compose project keeps its assigned port", async () => {
  let allocated = false;
  const port = await selectRuntimePort({
    allocatePort: async () => {
      allocated = true;
      return 50000;
    },
    canBind: async () => false,
    projectExists: true,
    storedPort: 49152,
  });

  assert.equal(port, 49152);
  assert.equal(allocated, false);
});

test("a missing project replaces a stale occupied port", async () => {
  const port = await selectRuntimePort({
    allocatePort: async () => 50000,
    canBind: async () => false,
    projectExists: false,
    storedPort: 49152,
  });

  assert.equal(port, 50000);
});

test("Docker labels are the runtime registry", () => {
  const inspect = [
    {
      Config: {
        Labels: {
          "app.ilo.runtime.repository": "repo-a",
          "app.ilo.runtime.root": "/repo/a",
          "com.docker.compose.project": "ilo-a",
        },
      },
    },
    {
      Config: {
        Labels: {
          "app.ilo.runtime.repository": "repo-a",
          "app.ilo.runtime.root": "/repo/a",
          "com.docker.compose.project": "ilo-a",
        },
      },
    },
  ];

  assert.deepEqual(projectsFromDockerInspect(inspect), [
    { project: "ilo-a", repositoryId: "repo-a", root: "/repo/a" },
  ]);
});

test("the development Compose project isolates the full stack without Docker socket access", async () => {
  const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
  const compose = await readFile(path.join(root, ".codex/runtime/compose.yaml"), "utf8");
  const dockerfile = await readFile(path.join(root, ".codex/runtime/Dockerfile.dev"), "utf8");
  const dockerignore = await readFile(path.join(root, ".dockerignore"), "utf8");
  const vite = await readFile(path.join(root, "apps/web/vite.config.ts"), "utf8");

  assert.match(compose, /^ {2}api:$/m);
  assert.match(compose, /^ {2}mcp:$/m);
  assert.match(compose, /^ {2}web:$/m);
  assert.match(compose, /127\.0\.0\.1:\$\{LOCAL_WEB_PORT:\?\}:5173/);
  assert.match(
    compose,
    /DATABASE_URL: postgres:\/\/personal_os:personal_os@postgres:5432\/personal_os/,
  );
  assert.match(compose, /VITE_PROXY_API_TARGET: http:\/\/api:8787/);
  assert.match(compose, /VITE_PROXY_MCP_TARGET: http:\/\/mcp:8788/);
  assert.match(compose, /develop:[^\n]*\n\s+watch:/);
  assert.match(compose, /app\.ilo\.runtime\.root: \$\{ILO_RUNTIME_ROOT:\?\}/);
  assert.doesNotMatch(compose, /docker\.sock|LOCAL_POSTGRES_PORT|LOCAL_API_PORT|LOCAL_MCP_PORT/);
  assert.match(dockerfile, /FROM dependencies AS development/);
  assert.doesNotMatch(dockerfile, /pnpm.*--parallel/);
  assert.match(dockerignore, /^\.env\.codex\.local$/m);
  assert.match(vite, /"\/health": \{/);
  assert.match(vite, /"\/mcp": \{\s*changeOrigin: false,/);
});

test("orphan pruning rechecks ownership and removes only confirmed repository projects", async () => {
  const removed = [];
  const project = { project: "ilo-orphan", repositoryId: "repo-a", root: "/repo/gone" };
  const orphans = await reconcileOrphans({
    listProjects: async () => [
      project,
      { project: "other", repositoryId: "repo-b", root: "/other/gone" },
    ],
    listWorktreeRoots: async () => new Set(["/repo/live"]),
    prune: true,
    removeProject: async (candidate) => removed.push(candidate),
    repositoryId: "repo-a",
  });

  assert.deepEqual(orphans, [project]);
  assert.deepEqual(removed, [project]);
});

test("explicitly prunable Git worktrees no longer retain Compose projects", () => {
  const output = [
    "worktree /repo/live\0HEAD abc\0branch refs/heads/main\0",
    "worktree /repo/gone\0HEAD def\0detached\0prunable gitdir file points to non-existent location\0",
    "",
  ].join("\0");

  assert.deepEqual(worktreeRootsFromPorcelain(output), new Set(["/repo/live"]));
});
