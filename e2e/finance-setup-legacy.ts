import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { type DatabaseClient, migrateDatabase } from "@personal-os/database";
import { createAuthService } from "../apps/api/src/auth-service.js";
import { migrationsWithout } from "../apps/api/src/test-migrations.js";

const legacyMigrationTag = "0118_finance_preferences_legacy_access";
const projects = ["desktop-chromium", "mobile-chromium"] as const;

/** Test-only named credentials; the disposable server recreates its database each run. */
export const financeLegacyBrowserAccounts = projects.map((project) => ({
  project,
  legacy: { email: `qa+finance-legacy-${project}@nohmi.test`, password: "Testing12345!" },
  generalSetupOnly: {
    email: `qa+finance-general-only-${project}@nohmi.test`,
    password: "Testing12345!",
  },
}));

/** Run only on the new E2E container, BEFORE the API applies the complete published journal.
 * Historical eligibility is created by canonical records; this never writes an access grant.
 */
export async function prepareFinanceLegacyMigrationFixture(
  database: DatabaseClient,
  migrationsFolder: string,
) {
  const host = database.pool.options.connectionString
    ? new URL(database.pool.options.connectionString).hostname
    : database.pool.options.host;
  if (!["127.0.0.1", "localhost", "::1", "[::1]"].includes(host ?? ""))
    throw new Error("Legacy browser fixtures require the disposable loopback database");
  const journal = JSON.parse(
    await readFile(join(migrationsFolder, "meta/_journal.json"), "utf8"),
  ) as {
    entries: Array<{ idx: number; tag: string }>;
  };
  const target = journal.entries.find((entry) => entry.tag === legacyMigrationTag);
  if (!target) throw new Error(`Missing published legacy migration ${legacyMigrationTag}`);
  // Journal indices, not numeric filename prefixes, establish publication order.
  // Exclude every later entry and preserve each retained entry's original index.
  const excluded = journal.entries
    .filter((entry) => entry.idx >= target.idx)
    .map((entry) => entry.tag);
  const prefix = await migrationsWithout(
    migrationsFolder,
    "nohmi-browser-before-legacy-",
    excluded,
  );
  try {
    await migrateDatabase(database.db, prefix);
    const now = () => new Date();
    const auth = createAuthService({
      db: database.db,
      now,
      sessionTtlDays: 30,
      registrationMode: "open",
    });
    for (const persona of financeLegacyBrowserAccounts) {
      for (const [kind, account] of Object.entries({
        legacy: persona.legacy,
        generalSetupOnly: persona.generalSetupOnly,
      })) {
        const registered = await auth.register(
          {
            displayName: `Disposable ${kind} browser owner`,
            ...account,
            planningTimezone: "America/New_York",
          },
          { ipAddress: "127.0.0.1", userAgent: "pre-migration-browser-fixture" },
        );
        await auth.updateAccountSetup(registered.user.id, {
          action: "preferences",
          selectedWorkspaces: ["tasks"],
        });
        await auth.updateAccountSetup(registered.user.id, { action: "complete" });
        if (kind === "legacy") {
          // Pin the historical row shape: today's ORM/writer can reference columns
          // introduced after this journal prefix. The real migration, rather than
          // the fixture, must derive the legacy access grant from this account.
          await database.pool.query(
            `insert into finance_accounts
              (user_id, provider, institution, name, kind, kind_source,
               ownership_type, ownership_share_bps, balance_cents, status, sync_state)
             values ($1, 'manual', 'Historical fixture bank', 'Legacy checking',
                     'cash', 'user', 'individual', 10000, 70000, 'manual', 'current')`,
            [registered.user.id],
          );
        }
      }
    }
  } finally {
    await rm(prefix, { recursive: true, force: true });
  }
}
