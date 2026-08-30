import { resolve } from "node:path";
import { loadQaFixtures, qaFixtureAccounts } from "../apps/api/src/qa-fixtures.js";
import { createDatabaseClient, migrateDatabase } from "../packages/database/src/index.js";

function printAccounts(): void {
  process.stdout.write("ilo QA fixture logins\n\n");
  for (const account of qaFixtureAccounts) {
    process.stdout.write(`${account.key}\n`);
    process.stdout.write(`  Email:    ${account.email}\n`);
    process.stdout.write(`  Password: ${account.password}\n`);
    process.stdout.write(`  State:    ${account.description}\n\n`);
  }
}

function requireSafeDatabase(databaseUrl: string): void {
  const url = new URL(databaseUrl);
  const local = ["127.0.0.1", "localhost", "::1"].includes(url.hostname);
  if (!local && process.env.QA_FIXTURES_ALLOW_REMOTE !== "true") {
    throw new Error(
      "Refusing to load QA fixtures into a remote database. Set QA_FIXTURES_ALLOW_REMOTE=true only for an intentional disposable QA environment.",
    );
  }
}

async function load(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required to load QA fixtures.");
  requireSafeDatabase(databaseUrl);
  const database = createDatabaseClient(databaseUrl);
  try {
    await migrateDatabase(
      database.db,
      process.env.MIGRATIONS_DIR ?? resolve(process.cwd(), "packages/database/migrations"),
    );
    const result = await loadQaFixtures(database.db);
    process.stdout.write(`Loaded ${result.accountCount} QA fixture accounts.\n\n`);
    printAccounts();
  } finally {
    await database.close();
  }
}

const command = process.argv[2] ?? "list";
if (command === "list") {
  printAccounts();
} else if (command === "load") {
  await load();
} else {
  throw new Error(`Unknown QA fixture command: ${command}. Use "list" or "load".`);
}
