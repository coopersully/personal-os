import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { createDatabaseClient, migrateDatabase } from "@personal-os/database";
import { createApp, type PersonalOsApp } from "./app.js";
import { loadConfig } from "./config.js";
import {
  closeNodeHttpServer,
  createRuntimeLifecycle,
  shutdownApiRuntime,
} from "./runtime-lifecycle.js";

const config = loadConfig(process.env);
const database = createDatabaseClient(config.databaseUrl);
const runtimeLifecycle = createRuntimeLifecycle();
const currentDirectory = dirname(fileURLToPath(import.meta.url));
const migrationsFolder =
  process.env.MIGRATIONS_DIR ?? resolve(currentDirectory, "../../../packages/database/migrations");

await migrateDatabase(database.db, migrationsFolder);

const app = createApp({
  config,
  db: database.db,
  log: (entry) => process.stdout.write(`${JSON.stringify(entry)}\n`),
  runtimeLifecycle,
});
const server = serve({ fetch: app.fetch, port: config.port });
const scheduler = setInterval(() => {
  runtimeLifecycle.startBackgroundTask("scheduled-connector-sync", async () => {
    await app.syncDueConnectors().catch(() => {
      process.stderr.write("[personal-os] scheduled connector sync failed\n");
      throw new Error("Scheduled connector sync failed.");
    });
  });
  runtimeLifecycle.startBackgroundTask("scheduled-mail-rule-dispatch", async () => {
    await app.dispatchDueMailRuleWork().catch((error: unknown) => {
      process.stderr.write(`[personal-os] scheduled Mail rule dispatch failed: ${String(error)}\n`);
      throw error;
    });
  });
  runtimeLifecycle.startBackgroundTask("scheduled-mail-maintenance", dispatchMailMaintenance);
  runtimeLifecycle.startBackgroundTask("scheduled-finance-sync", dispatchFinanceSync);
  runtimeLifecycle.startBackgroundTask("scheduled-finance-maintenance", dispatchFinanceMaintenance);
  runtimeLifecycle.startBackgroundTask("scheduled-finance-backfill", dispatchFinanceBackfill);
  runtimeLifecycle.startBackgroundTask(
    "scheduled-finance-setup-integrity",
    dispatchFinanceSetupIntegrity,
  );
}, 60_000);
runtimeLifecycle.startBackgroundTask("startup-connector-sync", async () => {
  await app.syncDueConnectors().catch(() => {
    process.stderr.write("[personal-os] startup connector sync failed\n");
    throw new Error("Startup connector sync failed.");
  });
});
runtimeLifecycle.startBackgroundTask("icloud-mail-idle-supervisor", () =>
  app.superviseICloudMail(),
);
runtimeLifecycle.startBackgroundTask("startup-mail-rule-dispatch", async () => {
  await app.dispatchDueMailRuleWork().catch((error: unknown) => {
    process.stderr.write(`[personal-os] scheduled Mail rule dispatch failed: ${String(error)}\n`);
    throw error;
  });
});
runtimeLifecycle.startBackgroundTask("startup-mail-maintenance", dispatchMailMaintenance);
runtimeLifecycle.startBackgroundTask("startup-finance-sync", dispatchFinanceSync);
runtimeLifecycle.startBackgroundTask("startup-finance-maintenance", dispatchFinanceMaintenance);
runtimeLifecycle.startBackgroundTask("startup-finance-backfill", dispatchFinanceBackfill);
runtimeLifecycle.startBackgroundTask(
  "startup-finance-setup-integrity",
  dispatchFinanceSetupIntegrity,
);
runtimeLifecycle.startBackgroundTask(
  "startup-finance-ledger-integrity",
  dispatchFinanceLedgerIntegrity,
);
runtimeLifecycle.startBackgroundTask(
  "startup-finance-cashflow-insights",
  dispatchFinanceCashflowInsights,
);

async function dispatchFinanceSync(): Promise<void> {
  let backfill: Awaited<ReturnType<PersonalOsApp["backfillFinanceProviderItems"]>>;
  try {
    backfill = await app.backfillFinanceProviderItems();
  } catch {
    process.stderr.write("[personal-os] Finance Provider Item backfill failed\n");
    throw new Error("Finance Provider Item backfill failed.");
  }
  if (backfill.created || backfill.linked || backfill.blocked || !backfill.complete) {
    process.stdout.write(
      `[personal-os] Finance Provider Item backfill: ${backfill.created} Items created, ${backfill.linked} accounts linked, ${backfill.blocked} blocked, ${backfill.replayDue} due for replay, complete=${backfill.complete}.\n`,
    );
  }
  await app.syncDueFinances();
}

async function dispatchFinanceMaintenance(): Promise<void> {
  await app.dispatchDueFinanceMaintenance();
}

async function dispatchMailMaintenance(): Promise<void> {
  await app.dispatchDueMailMaintenance();
}

async function dispatchFinanceBackfill(): Promise<void> {
  try {
    await app.backfillFinanceLearning();
  } catch (error) {
    process.stderr.write(`[personal-os] finance learning backfill failed: ${String(error)}\n`);
    throw error;
  }
}

async function dispatchFinanceSetupIntegrity(): Promise<void> {
  try {
    const result = await app.backfillFinanceSetupIntegrity();
    if (result.profilesDemoted || result.categoriesInserted)
      process.stdout.write(
        `[personal-os] repaired Finance setup after scanning ${result.processed} records: ${result.profilesDemoted} unapproved profiles demoted, ${result.categoriesInserted} default categories inserted.\n`,
      );
  } catch (error) {
    process.stderr.write(
      `[personal-os] Finance setup integrity backfill failed: ${String(error)}\n`,
    );
    throw error;
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
    throw error;
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
    throw error;
  }
}

let shutdownStarted = false;

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (shutdownStarted) return;
  shutdownStarted = true;
  const active = runtimeLifecycle.inFlight();
  process.stdout.write(
    `[personal-os] ${signal} received; draining ${active.requests} requests and ${active.background} background tasks (${active.backgroundLabels.join(", ") || "none"}).\n`,
  );
  try {
    await shutdownApiRuntime({
      closeDatabase: database.close,
      closeHttpServer: () => closeNodeHttpServer(server),
      lifecycle: runtimeLifecycle,
      stopScheduling: () => clearInterval(scheduler),
      timeoutMs: config.apiShutdownTimeoutMs,
    });
    process.stdout.write("[personal-os] API drain completed successfully.\n");
  } catch (error) {
    process.stderr.write(`[personal-os] API drain failed: ${String(error)}\n`);
    process.exit(1);
  }
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
