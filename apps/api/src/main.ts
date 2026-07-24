import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { createDatabaseClient, migrateDatabase } from "@personal-os/database";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";

const config = loadConfig(process.env);
const database = createDatabaseClient(config.databaseUrl);
const currentDirectory = dirname(fileURLToPath(import.meta.url));
const migrationsFolder =
  process.env.MIGRATIONS_DIR ?? resolve(currentDirectory, "../../../packages/database/migrations");

await migrateDatabase(database.db, migrationsFolder);

const app = createApp({
  config,
  db: database.db,
  log: (entry) => process.stdout.write(`${JSON.stringify(entry)}\n`),
});
const server = serve({ fetch: app.fetch, port: config.port });
const scheduler = setInterval(() => {
  void app.dispatchDueAutomations().catch((error: unknown) => {
    process.stderr.write(`[personal-os] scheduled automation dispatch failed: ${String(error)}\n`);
  });
  void dispatchFinanceSync();
  void dispatchFinanceBackfill();
}, 60_000);
void app.dispatchDueAutomations().catch((error: unknown) => {
  process.stderr.write(`[personal-os] scheduled automation dispatch failed: ${String(error)}\n`);
});
void dispatchFinanceSync();
void dispatchFinanceBackfill();
void dispatchFinanceLedgerIntegrity();
void dispatchFinanceCashflowInsights();

async function dispatchFinanceSync(): Promise<void> {
  try {
    const result = await app.syncDueFinances();
    if (result.failed)
      process.stderr.write(
        `[personal-os] scheduled finance sync failed for ${result.failed} accounts: ${result.reasons.join("; ")}\n`,
      );
  } catch (error) {
    process.stderr.write(`[personal-os] scheduled finance sync failed: ${String(error)}\n`);
  }
}

async function dispatchFinanceBackfill(): Promise<void> {
  try {
    await app.backfillFinanceLearning();
  } catch (error) {
    process.stderr.write(`[personal-os] finance learning backfill failed: ${String(error)}\n`);
  }
}

async function dispatchFinanceLedgerIntegrity(): Promise<void> {
  try {
    const result = await app.backfillFinanceLedgerIntegrity();
    if (result.paired || result.confirmedMovements)
      process.stdout.write(
        `[personal-os] reconciled finance ledger for ${result.processed} users: ${result.paired} matched pairs, ${result.confirmedMovements} confirmed movement records.\n`,
      );
  } catch (error) {
    process.stderr.write(
      `[personal-os] finance ledger integrity backfill failed: ${String(error)}\n`,
    );
  }
}

async function dispatchFinanceCashflowInsights(): Promise<void> {
  try {
    const result = await app.backfillFinanceCashflowInsights();
    if (result.processed)
      process.stdout.write(
        `[personal-os] refreshed finance cash-flow patterns for ${result.processed} users.\n`,
      );
  } catch (error) {
    process.stderr.write(`[personal-os] finance cash-flow backfill failed: ${String(error)}\n`);
  }
}

async function shutdown(): Promise<void> {
  clearInterval(scheduler);
  server.close();
  await database.close();
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
