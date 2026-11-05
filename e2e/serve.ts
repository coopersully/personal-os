import { type ChildProcess, execFile, spawn } from "node:child_process";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { createApiClient } from "@personal-os/api-client";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { loadQaFixtures, qaFixtureAccounts } from "../apps/api/src/qa-fixtures.js";
import { createDatabaseClient } from "../packages/database/src/index.js";
import { completeFinanceSetupViaApi } from "./finance-setup-fixtures.js";
import { prepareFinanceLegacyMigrationFixture } from "./finance-setup-legacy.js";

const root = resolve(import.meta.dirname, "..");
const apiPort = process.env.ILO_E2E_API_PORT ?? "8797";
const webPort = process.env.ILO_E2E_WEB_PORT ?? "5174";
const apiUrl = `http://127.0.0.1:${apiPort}`;
const webUrl = `http://127.0.0.1:${webPort}`;
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
  const historicalDatabase = createDatabaseClient(postgres.getConnectionUri());
  try {
    await prepareFinanceLegacyMigrationFixture(
      historicalDatabase,
      resolve(root, "packages/database/migrations"),
    );
  } finally {
    await historicalDatabase.close();
  }
  // Normal API startup now applies the actual published legacy migration and
  // every later journal entry to the canonical historical records above.
  api = start("pnpm", ["--filter", "@personal-os/api", "exec", "tsx", "src/main.ts"], {
    ALLOWED_ORIGINS: webUrl,
    API_BASE_URL: apiUrl,
    APP_BASE_URL: webUrl,
    APP_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString("base64"),
    // Browser cases use fresh sessions but share one loopback client address.
    // Rate-limit enforcement is covered independently by API tests.
    AUTH_RATE_LIMIT_MAX_REQUESTS: "1000",
    DATABASE_URL: postgres.getConnectionUri(),
    GOOGLE_REDIRECT_URI: `${apiUrl}/v1/connectors/google/callback`,
    X_REDIRECT_URI: `${apiUrl}/v1/x-bookmarks/callback`,
    MIGRATIONS_DIR: resolve(root, "packages/database/migrations"),
    NODE_ENV: "test",
    PORT: apiPort,
    REGISTRATION_MODE: "open",
  });
  await waitFor(`${apiUrl}/health/ready`);
  const fixtureDatabase = createDatabaseClient(postgres.getConnectionUri());
  try {
    await loadQaFixtures(fixtureDatabase.db);
  } finally {
    await fixtureDatabase.close();
  }
  // Post-migration records are not legacy access. Prepare populated browser
  // personas through canonical ownership/review/completion HTTP writers instead.
  // Empty and recovery personas retain their actual incomplete/recovery state.
  for (const key of ["demo-full", "qa-loaded"]) {
    const account = qaFixtureAccounts.find((candidate) => candidate.key === key);
    if (!account) throw new Error(`Missing browser fixture ${key}`);
    const human = createApiClient({ baseUrl: apiUrl });
    await human.login({ email: account.email, password: account.password });
    await completeFinanceSetupViaApi(human);
  }
  // Build once per server so layout regressions can use the shipped, optimized CSS.
  // The build also generates the public HTML needed by a clean browser checkout.
  await promisify(execFile)("pnpm", ["--filter", "@personal-os/web", "build"], {
    cwd: root,
  });
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
      webPort,
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
