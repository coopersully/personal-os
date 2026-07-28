import { type ChildProcess, spawn } from "node:child_process";
import { resolve } from "node:path";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { loadQaFixtures } from "../apps/api/src/qa-fixtures.js";
import { createDatabaseClient } from "../packages/database/src/index.js";

const root = resolve(import.meta.dirname, "..");
const apiUrl = "http://127.0.0.1:8797";
const webUrl = "http://127.0.0.1:5174";
let api: ChildProcess | undefined;
let web: ChildProcess | undefined;
let postgres: StartedPostgreSqlContainer | undefined;
let stopping = false;

function start(command: string, args: string[], environment: NodeJS.ProcessEnv): ChildProcess {
  const child = spawn(command, args, {
    cwd: root,
    env: { ...process.env, ...environment },
    stdio: "inherit",
  });
  child.once("exit", (code, signal) => {
    if (!stopping) {
      process.stderr.write(
        `${command} ${args.join(" ")} exited before the test server stopped (${code ?? signal}).\n`,
      );
      void cleanup(1);
    }
  });
  return child;
}

async function waitFor(url: string, timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // The process is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for ${url}.`);
}

async function cleanup(exitCode = 0): Promise<void> {
  if (stopping) return;
  stopping = true;
  web?.kill("SIGTERM");
  api?.kill("SIGTERM");
  await postgres?.stop();
  process.exit(exitCode);
}

process.once("SIGINT", () => void cleanup());
process.once("SIGTERM", () => void cleanup());

try {
  postgres = await new PostgreSqlContainer("postgres:17.5-alpine")
    .withDatabase("personal_os")
    .withPassword("personal_os")
    .withUsername("personal_os")
    .start();
  api = start("pnpm", ["--filter", "@personal-os/api", "exec", "tsx", "src/main.ts"], {
    ALLOWED_ORIGINS: webUrl,
    API_BASE_URL: apiUrl,
    APP_BASE_URL: webUrl,
    APP_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString("base64"),
    DATABASE_URL: postgres.getConnectionUri(),
    GOOGLE_REDIRECT_URI: `${apiUrl}/v1/connectors/google/callback`,
    X_REDIRECT_URI: `${apiUrl}/v1/x-bookmarks/callback`,
    MIGRATIONS_DIR: resolve(root, "packages/database/migrations"),
    NODE_ENV: "test",
    PORT: "8797",
    REGISTRATION_MODE: "open",
  });
  await waitFor(`${apiUrl}/health/ready`);
  const fixtureDatabase = createDatabaseClient(postgres.getConnectionUri());
  try {
    await loadQaFixtures(fixtureDatabase.db);
  } finally {
    await fixtureDatabase.close();
  }
  web = start(
    "pnpm",
    [
      "--filter",
      "@personal-os/web",
      "exec",
      "vite",
      "--host",
      "127.0.0.1",
      "--port",
      "5174",
      "--strictPort",
    ],
    { VITE_API_BASE_URL: "/", VITE_PROXY_API_TARGET: apiUrl },
  );
  await waitFor(webUrl);
  await new Promise(() => undefined);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  await cleanup(1);
}
