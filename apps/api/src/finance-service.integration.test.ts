import { rm } from "node:fs/promises";
import { resolve } from "node:path";
import { createPlaidConnector } from "@personal-os/connectors";
import {
  attentionItems,
  auditEvents,
  createDatabaseClient,
  type DatabaseClient,
  domainProfileApprovals,
  domainProfiles,
  financeAccounts,
  financeAlerts,
  financeCategories,
  financeClassificationDecisions,
  financeIncomeStreams,
  financeProviderItems,
  financeRecurringObligations,
  financeReviewCases,
  financeSetupBackfillState,
  financeTransactions,
  migrateDatabase,
  users,
  workspaceMaintenanceRuns,
} from "@personal-os/database";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { and, eq, inArray } from "drizzle-orm";
import { createFinanceProviderItemService } from "./finance-provider-item-service.js";
import { createFinanceService, financeCsvImportErrorMessage } from "./finance-service.js";
import { migrationsWithout } from "./test-migrations.js";
import type { Principal } from "./types.js";

const now = new Date("2026-07-19T12:00:00.000Z");
const key = Buffer.alloc(32, 3).toString("base64");

function financePrincipal(userId: string): Principal {
  return {
    actorId: userId,
    actorType: "user",
    scopes: new Set(["finances:read", "finances:write"]),
    userId,
  };
}

function financeAgentPrincipal(userId: string): Principal {
  return {
    actorId: crypto.randomUUID(),
    actorType: "agent",
    scopes: new Set(["finances:read", "finances:write"]),
    userId,
  };
}

async function waitForLockWaiters(pool: DatabaseClient["pool"], expected: number) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const result = await pool.query<{ count: string }>(`
      SELECT count(*)::text AS count
      FROM pg_stat_activity
      WHERE datname = current_database()
        AND wait_event_type = 'Lock'
        AND (
          query LIKE '%finance_%'
          OR query LIKE '%workspace_maintenance_runs%'
          OR query LIKE '%pg_advisory_xact_lock%'
        )
        AND query NOT LIKE '%pg_stat_activity%'
    `);
    if (Number(result.rows[0]?.count ?? 0) >= expected) return;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 20));
  }
  throw new Error(`Expected at least ${expected} database lock waiter(s).`);
}

function plaidFetch(): typeof globalThis.fetch {
  let exchangeCall = 0;
  let syncCall = 0;
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const requestUrl =
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const path = new URL(requestUrl).pathname;
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    if (path === "/link/token/create") {
      expect(body.link_customization_name).toBe("default");
      return Response.json({ link_token: "link-token" });
    }
    if (path === "/item/public_token/exchange") {
      expect(body.public_token).toBe("public-token");
      exchangeCall += 1;
      return Response.json(
        exchangeCall === 1
          ? { access_token: "access-token", item_id: "item-1" }
          : { access_token: "replacement-access-token", item_id: "item-2" },
      );
    }
    if (path === "/accounts/get") {
      return Response.json({
        accounts: [
          {
            account_id: "plaid-account-1",
            balances: { current: 91.25, iso_currency_code: "USD" },
            name: "Checking",
            official_name: null,
          },
          {
            account_id: "plaid-account-2",
            balances: { current: null, iso_currency_code: "USD" },
            name: "Savings",
            official_name: "High Yield Savings",
          },
        ],
      });
    }
    if (path === "/transactions/sync") {
      syncCall += 1;
      expect(body.access_token).toBe("access-token");
      expect(body.account_id).toBeUndefined();
      return Response.json(
        syncCall === 1
          ? {
              added: [
                {
                  account_id: "plaid-account-1",
                  amount: 20,
                  date: "2026-07-19",
                  iso_currency_code: "USD",
                  merchant_name: "Acme Bookstore",
                  name: "ACME BOOKSTORE",
                  pending: true,
                  personal_finance_category: {
                    confidence_level: "HIGH",
                    detailed: "FOOD_AND_DRINK_GROCERIES",
                    primary: "FOOD_AND_DRINK",
                  },
                  transaction_id: "pending-txn-1",
                },
                {
                  account_id: "plaid-account-1",
                  amount: -50,
                  date: "2026-07-18",
                  merchant_name: null,
                  name: "Payroll",
                  personal_finance_category: null,
                  transaction_id: "txn-2",
                },
              ],
              has_more: true,
              modified: [],
              next_cursor: "cursor-1",
              removed: [],
            }
          : syncCall === 2
            ? {
                added: [],
                has_more: false,
                modified: [
                  {
                    account_id: "plaid-account-1",
                    amount: 22,
                    date: "2026-07-19",
                    iso_currency_code: "USD",
                    merchant_name: "Trader Joe's",
                    name: "TRADER JOE'S",
                    pending: true,
                    personal_finance_category: {
                      confidence_level: "VERY_HIGH",
                      detailed: "FOOD_AND_DRINK_GROCERIES",
                      primary: "FOOD_AND_DRINK",
                    },
                    transaction_id: "pending-txn-1",
                  },
                ],
                next_cursor: "cursor-2",
                removed: [{ transaction_id: "txn-2" }],
              }
            : syncCall === 3
              ? {
                  added: [
                    {
                      account_id: "plaid-account-1",
                      amount: -40,
                      date: "2026-07-20",
                      merchant_name: "Incoming transfer",
                      name: "INCOMING TRANSFER",
                      personal_finance_category: {
                        confidence_level: "VERY_HIGH",
                        detailed: "TRANSFER_IN_ACCOUNT_TRANSFER",
                        primary: "TRANSFER_IN",
                      },
                      transaction_id: "txn-transfer-in",
                    },
                    {
                      account_id: "plaid-account-1",
                      amount: 35,
                      date: "2026-07-20",
                      merchant_name: "Outgoing transfer",
                      name: "OUTGOING TRANSFER",
                      personal_finance_category: {
                        confidence_level: "VERY_HIGH",
                        detailed: "TRANSFER_OUT_ACCOUNT_TRANSFER",
                        primary: "TRANSFER_OUT",
                      },
                      transaction_id: "txn-transfer-out",
                    },
                    {
                      account_id: "plaid-account-1",
                      amount: 60,
                      date: "2026-07-20",
                      iso_currency_code: "USD",
                      merchant_name: "Transfer to SoFi Vault",
                      name: "TRANSFER TO SOFI VAULT",
                      personal_finance_category: null,
                      transaction_id: "txn-late-transfer",
                    },
                  ],
                  has_more: true,
                  modified: [],
                  next_cursor: "cursor-2-removed",
                  removed: [{ transaction_id: "pending-txn-1" }],
                }
              : syncCall === 4
                ? {
                    added: [
                      {
                        account_id: "plaid-account-1",
                        amount: 22,
                        date: "2026-07-19",
                        merchant_name: "Trader Joe's",
                        name: "TRADER JOE'S",
                        pending: false,
                        pending_transaction_id: "pending-txn-1",
                        personal_finance_category: {
                          confidence_level: "VERY_HIGH",
                          detailed: "FOOD_AND_DRINK_GROCERIES",
                          primary: "FOOD_AND_DRINK",
                        },
                        transaction_id: "txn-1",
                      },
                    ],
                    has_more: false,
                    modified: [],
                    next_cursor: "cursor-3",
                    removed: [],
                  }
                : {
                    added: [
                      {
                        account_id: "plaid-account-2",
                        amount: -60,
                        date: "2026-07-21",
                        merchant_name: "Payment thank you",
                        name: "PAYMENT THANK YOU",
                        personal_finance_category: {
                          confidence_level: "VERY_HIGH",
                          detailed: "GENERAL_MERCHANDISE_OTHER_GENERAL_MERCHANDISE",
                          primary: "GENERAL_MERCHANDISE",
                        },
                        transaction_id: "txn-late-counterpart",
                      },
                    ],
                    has_more: false,
                    modified: [
                      {
                        account_id: "plaid-account-1",
                        amount: -30,
                        date: "2026-07-21",
                        merchant_name: "Trader Joe's",
                        name: "TRADER JOE'S",
                        pending: false,
                        personal_finance_category: {
                          confidence_level: "LOW",
                          detailed: "GENERAL_MERCHANDISE_OTHER_GENERAL_MERCHANDISE",
                          primary: "GENERAL_MERCHANDISE",
                        },
                        transaction_id: "txn-1",
                      },
                      {
                        account_id: "plaid-account-1",
                        amount: -40,
                        date: "2026-07-21",
                        merchant_name: "Incoming transfer renamed",
                        name: "INCOMING TRANSFER RENAMED",
                        pending: false,
                        personal_finance_category: {
                          confidence_level: "VERY_HIGH",
                          detailed: "TRANSFER_IN_ACCOUNT_TRANSFER",
                          primary: "TRANSFER_IN",
                        },
                        transaction_id: "txn-transfer-in",
                      },
                      {
                        account_id: "plaid-account-1",
                        amount: 35,
                        date: "2026-07-21",
                        merchant_name: "Outgoing transfer renamed",
                        name: "OUTGOING TRANSFER RENAMED",
                        pending: false,
                        personal_finance_category: {
                          confidence_level: "VERY_HIGH",
                          detailed: "TRANSFER_OUT_ACCOUNT_TRANSFER",
                          primary: "TRANSFER_OUT",
                        },
                        transaction_id: "txn-transfer-out",
                      },
                    ],
                    next_cursor: "cursor-4",
                    removed: [],
                  },
      );
    }
    return Response.json({ error_message: "Unexpected Plaid path" }, { status: 400 });
  });
}

describe.sequential("finance service", () => {
  let container: StartedPostgreSqlContainer;
  let database: DatabaseClient;
  let userId: string;

  it("keeps import errors useful even for non-Error throws", () => {
    expect(financeCsvImportErrorMessage(new Error("Malformed export"))).toBe("Malformed export");
    expect(financeCsvImportErrorMessage("malformed export")).toBe("The CSV could not be imported.");
  });

  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:17.5-alpine")
      .withDatabase("personal_os")
      .withUsername("personal_os")
      .withPassword("personal_os")
      .start();
    database = createDatabaseClient(container.getConnectionUri());
    const migrationsFolder = resolve(process.cwd(), "packages/database/migrations");
    const legacyMigrations = await migrationsWithout(migrationsFolder, "ilo-finance-legacy-", [
      "0041_domain_profile_approvals",
      "0042_finance_provider_direction",
      "0043_finance_setup_backfill_state",
      "0044_durable_mail_rule_work",
      "0045_mail_calendar_commitment_intake",
      "0046_mail_calendar_account_hint",
      "0047_icloud_uidvalidity_identity",
      "0048_connector_sync_generation",
      "0049_attention_item_versions",
      "0050_connector_sync_health",
      "0051_connector_authorization_attempts",
      "0052_connector_notifications",
      "0053_oauth_states_expiry_index",
      "0054_agent_access_work_item_snapshots",
      "0055_finance_sync_health",
      "0056_workspace_maintenance_runs",
      "0057_finance_currency_evidence",
      "0058_finance_provider_items",
    ]);
    await migrateDatabase(database.db, legacyMigrations);
    await expect(
      database.pool.query<{ relation: string | null }>(
        "SELECT to_regclass('public.finance_setup_backfill_state')::text AS relation",
      ),
    ).resolves.toMatchObject({ rows: [{ relation: null }] });
    const [upgradeUser] = await database.db
      .insert(users)
      .values({
        displayName: "Finance Upgrade",
        email: "finance-upgrade@example.com",
        passwordHash: "unused",
        planningTimezone: "UTC",
      })
      .returning();
    if (!upgradeUser) throw new Error("Finance upgrade fixture user was not created.");
    const legacyAttentionId = crypto.randomUUID();
    await database.pool.query(
      `INSERT INTO attention_items (
        id, user_id, domain, kind, importance, status, title, summary
      ) VALUES ($1, $2, 'finances', 'important', 'normal', 'open', $3, $4)`,
      [
        legacyAttentionId,
        upgradeUser.id,
        "Legacy Finance attention",
        "Existing attention must receive version one.",
      ],
    );
    const [upgradeAccount] = (
      await database.pool.query<{ id: string; name: string }>(
        `INSERT INTO finance_accounts (user_id, institution, name, provider, status)
         VALUES ($1, 'Legacy Bank', 'Legacy checking', 'manual', 'manual')
         RETURNING id, name`,
        [upgradeUser.id],
      )
    ).rows;
    if (!upgradeAccount) throw new Error("Finance upgrade fixture account was not created.");
    await database.db.insert(domainProfiles).values({
      categories: [],
      domain: "finances",
      instructions: ["Legacy active guidance without approval provenance."],
      objective: "Legacy objective",
      preferences: {},
      sourceContexts: [
        {
          notes: null,
          purpose: "Legacy spending",
          sourceId: upgradeAccount.id,
          sourceLabel: upgradeAccount.name,
        },
      ],
      status: "active",
      summary: "Legacy active Finance profile",
      userId: upgradeUser.id,
    });
    const [secondUpgradeUser] = await database.db
      .insert(users)
      .values({
        displayName: "Second Finance Upgrade",
        email: "finance-upgrade-2@example.com",
        passwordHash: "unused",
        planningTimezone: "UTC",
      })
      .returning();
    if (!secondUpgradeUser) throw new Error("Second Finance upgrade fixture was not created.");
    const [secondUpgradeAccount] = (
      await database.pool.query<{ id: string; name: string }>(
        `INSERT INTO finance_accounts (user_id, institution, name, provider, status)
         VALUES ($1, 'Second Legacy Bank', 'Second legacy checking', 'manual', 'manual')
         RETURNING id, name`,
        [secondUpgradeUser.id],
      )
    ).rows;
    if (!secondUpgradeAccount) throw new Error("Second Finance upgrade account was not created.");
    await database.pool.query(
      `INSERT INTO finance_accounts (
         user_id, institution, name, provider, status, provider_account_id, last_synced_at
       ) VALUES
         ($1, 'Fresh Legacy Plaid', 'Fresh connected account', 'plaid', 'connected', 'fresh-legacy', CURRENT_TIMESTAMP - INTERVAL '1 hour'),
         ($1, 'Stale Legacy Plaid', 'Stale connected account', 'plaid', 'connected', 'stale-legacy', CURRENT_TIMESTAMP - INTERVAL '25 hours')`,
      [upgradeUser.id],
    );
    const [secondUpgradeProfile] = await database.db
      .insert(domainProfiles)
      .values({
        categories: [],
        domain: "finances",
        instructions: ["Second legacy active guidance."],
        objective: "Second legacy objective",
        preferences: {},
        sourceContexts: [
          {
            notes: null,
            purpose: "Second legacy spending",
            sourceId: secondUpgradeAccount.id,
            sourceLabel: secondUpgradeAccount.name,
          },
        ],
        status: "active",
        summary: "Second legacy active Finance profile",
        userId: secondUpgradeUser.id,
      })
      .returning();
    if (!secondUpgradeProfile) {
      throw new Error("Second Finance upgrade profile was not created.");
    }
    const [legacyPostedTransaction] = (
      await database.pool.query<{ id: string }>(
        `INSERT INTO finance_transactions (
          user_id, account_id, provider_transaction_id, merchant, amount_cents,
          direction, transaction_date, category, category_source,
          category_decided_at, needs_review, pending
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        RETURNING id`,
        [
          upgradeUser.id,
          upgradeAccount.id,
          "legacy-provider-transaction",
          "Legacy provider purchase",
          4200,
          "expense",
          "2026-07-01",
          "Shopping",
          "user",
          new Date("2026-07-01T12:00:00.000Z"),
          false,
          false,
        ],
      )
    ).rows;
    if (!legacyPostedTransaction) {
      throw new Error("Legacy posted transaction fixture was not created.");
    }
    const [legacyManualTransaction] = (
      await database.pool.query<{ id: string }>(
        `INSERT INTO finance_transactions (
          user_id, account_id, merchant, amount_cents, direction,
          transaction_date, category, category_source, category_decided_at,
          needs_review, pending
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        RETURNING id`,
        [
          upgradeUser.id,
          upgradeAccount.id,
          "Legacy manual purchase",
          1800,
          "expense",
          "2026-07-02",
          "Dining",
          "user",
          new Date("2026-07-02T12:00:00.000Z"),
          false,
          false,
        ],
      )
    ).rows;
    if (!legacyManualTransaction) {
      throw new Error("Legacy manual transaction fixture was not created.");
    }
    await migrateDatabase(database.db, migrationsFolder);
    await expect(
      database.pool.query<{
        name: string;
        next_sync_at: Date | null;
        sync_state: string;
      }>(
        `SELECT name, next_sync_at, sync_state
         FROM finance_accounts
         WHERE user_id = $1
         ORDER BY name`,
        [upgradeUser.id],
      ),
    ).resolves.toMatchObject({
      rows: [
        {
          name: "Fresh connected account",
          next_sync_at: null,
          sync_state: "stale",
        },
        { name: "Legacy checking", next_sync_at: null, sync_state: "stale" },
        {
          name: "Stale connected account",
          next_sync_at: null,
          sync_state: "stale",
        },
      ],
    });
    const initializationLogs = vi.fn();
    const upgradeService = createFinanceService({
      db: database.db,
      log: initializationLogs,
      now: () => now,
    });
    const interruptedInitialization = await database.pool.connect();
    let firstInitializationPass!: Awaited<ReturnType<typeof upgradeService.initializeSyncHealth>>;
    try {
      await interruptedInitialization.query("BEGIN");
      await interruptedInitialization.query(
        "SELECT id FROM finance_accounts WHERE id = $1 FOR UPDATE",
        [upgradeAccount.id],
      );
      firstInitializationPass = await upgradeService.initializeSyncHealth(2);
    } finally {
      await interruptedInitialization.query("ROLLBACK");
      interruptedInitialization.release();
    }
    expect(firstInitializationPass).toMatchObject({
      complete: false,
      initialized: 1,
    });
    await expect(
      database.pool.query<{ initialized: string }>(
        `SELECT count(*)::text AS initialized
         FROM finance_accounts
         WHERE (provider = 'manual' AND sync_state = 'current')
            OR (provider = 'plaid' AND next_sync_at IS NOT NULL)`,
      ),
    ).resolves.toMatchObject({ rows: [{ initialized: "1" }] });
    const restartedSyncHealthService = createFinanceService({
      db: database.db,
      log: initializationLogs,
      now: () => now,
    });
    const initializationPasses = [firstInitializationPass];
    for (let pass = 0; pass < 5; pass += 1) {
      const result = await restartedSyncHealthService.initializeSyncHealth(1);
      initializationPasses.push(result);
      if (result.complete) break;
    }
    expect(initializationPasses.at(-1)).toMatchObject({ complete: true });
    expect(
      initializationPasses.reduce(
        (total, pass) => ({
          initialized: total.initialized + pass.initialized,
          manual: total.manual + pass.manual,
          plaidCurrent: total.plaidCurrent + pass.plaidCurrent,
          plaidDue: total.plaidDue + pass.plaidDue,
        }),
        { initialized: 0, manual: 0, plaidCurrent: 0, plaidDue: 0 },
      ),
    ).toEqual({ initialized: 2, manual: 2, plaidCurrent: 0, plaidDue: 0 });
    await expect(restartedSyncHealthService.initializeSyncHealth(1)).resolves.toEqual({
      complete: true,
      initialized: 0,
      manual: 0,
      plaidCurrent: 0,
      plaidDue: 0,
    });
    await expect(restartedSyncHealthService.syncDuePlaidAccounts()).resolves.toMatchObject({
      attempted: 0,
      failed: 0,
    });
    await database.pool.query(
      `UPDATE finance_accounts
       SET next_sync_at = NOW() + INTERVAL '30 days'
       WHERE user_id = $1 AND provider = 'plaid'`,
      [upgradeUser.id],
    );
    expect(initializationLogs.mock.calls.map(([entry]) => entry)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: "finance_sync_health_initialized",
          initializedAccountCount: expect.any(Number),
        }),
      ]),
    );
    await expect(
      database.pool.query<{ relation: string | null }>(
        "SELECT to_regclass('public.finance_setup_backfill_state')::text AS relation",
      ),
    ).resolves.toMatchObject({ rows: [{ relation: "finance_setup_backfill_state" }] });
    await expect(
      database.db
        .select({ version: attentionItems.version })
        .from(attentionItems)
        .where(eq(attentionItems.id, legacyAttentionId)),
    ).resolves.toEqual([{ version: 1 }]);
    await expect(
      database.db.select().from(domainProfiles).where(eq(domainProfiles.domain, "finances")),
    ).resolves.toEqual([
      expect.objectContaining({ status: "active", version: 1 }),
      expect.objectContaining({ status: "active", version: 1 }),
    ]);
    await database.db.insert(domainProfileApprovals).values({
      approvedAt: new Date("2026-07-18T12:00:00.000Z"),
      approvedByUserId: secondUpgradeUser.id,
      domain: "finances",
      profile: {
        categories: secondUpgradeProfile.categories,
        createdAt: secondUpgradeProfile.createdAt.toISOString(),
        domain: secondUpgradeProfile.domain,
        id: secondUpgradeProfile.id,
        instructions: secondUpgradeProfile.instructions,
        objective: secondUpgradeProfile.objective,
        preferences: secondUpgradeProfile.preferences,
        sourceContexts: secondUpgradeProfile.sourceContexts,
        status: secondUpgradeProfile.status,
        summary: secondUpgradeProfile.summary,
        updatedAt: secondUpgradeProfile.updatedAt.toISOString(),
        version: secondUpgradeProfile.version,
      },
      profileId: secondUpgradeProfile.id,
      profileVersion: secondUpgradeProfile.version,
      userId: secondUpgradeUser.id,
    });
    await database.db
      .update(domainProfiles)
      .set({
        summary: "A newer active revision without signed approval.",
        updatedAt: new Date("2026-07-18T13:00:00.000Z"),
        version: secondUpgradeProfile.version + 1,
      })
      .where(eq(domainProfiles.id, secondUpgradeProfile.id));
    await expect(
      database.db
        .select()
        .from(domainProfileApprovals)
        .where(eq(domainProfileApprovals.userId, upgradeUser.id)),
    ).resolves.toHaveLength(0);
    await expect(
      database.db
        .select()
        .from(financeCategories)
        .where(eq(financeCategories.userId, upgradeUser.id)),
    ).resolves.toHaveLength(0);
    await expect(
      database.db
        .select({ providerDirection: financeTransactions.providerDirection })
        .from(financeTransactions)
        .where(eq(financeTransactions.id, legacyPostedTransaction.id)),
    ).resolves.toEqual([{ providerDirection: null }]);
    await expect(
      database.db
        .select({ providerDirection: financeTransactions.providerDirection })
        .from(financeTransactions)
        .where(eq(financeTransactions.id, legacyManualTransaction.id)),
    ).resolves.toEqual([{ providerDirection: null }]);
    const syntheticCategories = await upgradeService.listCategories(upgradeUser.id);
    expect(syntheticCategories).toHaveLength(20);
    expect(
      syntheticCategories.every((category) =>
        /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/.test(category.id),
      ),
    ).toBe(true);
    await expect(upgradeService.listCategories(upgradeUser.id)).resolves.toEqual(
      syntheticCategories,
    );
    const [syntheticProposalCandidate] = await database.db
      .insert(financeTransactions)
      .values({
        accountId: upgradeAccount.id,
        amount: 1_200,
        direction: "expense",
        merchant: "Trader Joe's",
        needsReview: true,
        transactionDate: "2026-07-03",
        userId: upgradeUser.id,
      })
      .returning();
    if (!syntheticProposalCandidate) {
      throw new Error("Synthetic category proposal fixture was not created.");
    }
    const syntheticProposal = (
      await upgradeService.proposeCategorizations(upgradeUser.id, {
        limit: 50,
        review: "needs_review",
        sortBy: "date",
        sortDirection: "desc",
      })
    ).items.find((proposal) => proposal.transaction.id === syntheticProposalCandidate.id);
    expect(syntheticProposal?.suggestedCategory).toEqual(
      syntheticCategories.find((category) => category.slug === "groceries"),
    );
    await expect(
      database.db
        .select()
        .from(financeCategories)
        .where(eq(financeCategories.userId, upgradeUser.id)),
    ).resolves.toHaveLength(0);
    await expect(upgradeService.getGuidedSetupContext(upgradeUser.id)).resolves.toMatchObject({
      guidance: {
        approvedProfile: null,
        draftProposal: { status: "draft", version: 1 },
      },
    });
    await database.db
      .insert(financeSetupBackfillState)
      .values({ key: "finance_setup_integrity_v1" })
      .onConflictDoNothing();
    const backfillLock = await database.pool.connect();
    try {
      await backfillLock.query("BEGIN");
      await backfillLock.query(
        "SELECT key FROM finance_setup_backfill_state WHERE key = $1 FOR UPDATE",
        ["finance_setup_integrity_v1"],
      );
      await expect(upgradeService.backfillSetupIntegrity(1)).resolves.toMatchObject({
        categoriesInserted: 0,
        claimed: false,
        processed: 0,
        profilesDemoted: 0,
      });
    } finally {
      await backfillLock.query("ROLLBACK");
      backfillLock.release();
    }
    const firstPass = await upgradeService.backfillSetupIntegrity(1);
    expect(firstPass).toMatchObject({
      categoriesInserted: 20,
      claimed: true,
      processed: 2,
      profileRowsScanned: 1,
      profilesDemoted: 1,
      userRowsScanned: 1,
    });
    await expect(
      database.db.select().from(domainProfiles).where(eq(domainProfiles.status, "active")),
    ).resolves.toHaveLength(1);
    const restartedUpgradeService = createFinanceService({ db: database.db, now: () => now });
    const passes = [firstPass];
    for (let pass = 0; pass < 5; pass += 1) {
      const result = await restartedUpgradeService.backfillSetupIntegrity(1);
      passes.push(result);
      if (result.profilesComplete && result.categoriesComplete) break;
    }
    expect(passes.at(-1)).toMatchObject({
      categoriesComplete: true,
      profilesComplete: true,
    });
    expect(passes.reduce((sum, result) => sum + result.profilesDemoted, 0)).toBe(2);
    expect(passes.reduce((sum, result) => sum + result.categoriesInserted, 0)).toBe(40);
    await expect(restartedUpgradeService.backfillSetupIntegrity(1)).resolves.toEqual({
      categoriesComplete: true,
      categoriesInserted: 0,
      claimed: true,
      processed: 0,
      profileRowsScanned: 0,
      profilesComplete: true,
      profilesDemoted: 0,
      userRowsScanned: 0,
    });
    const repairedProfiles = await database.db
      .select()
      .from(domainProfiles)
      .where(eq(domainProfiles.domain, "finances"));
    expect(repairedProfiles).toHaveLength(2);
    expect(
      repairedProfiles.find((profile) => profile.id === secondUpgradeProfile.id),
    ).toMatchObject({
      status: "draft",
      version: 3,
    });
    expect(
      repairedProfiles.find((profile) => profile.id !== secondUpgradeProfile.id),
    ).toMatchObject({
      status: "draft",
      version: 2,
    });
    await expect(
      database.db
        .select()
        .from(financeCategories)
        .where(inArray(financeCategories.userId, [upgradeUser.id, secondUpgradeUser.id])),
    ).resolves.toHaveLength(40);
    await rm(legacyMigrations, { force: true, recursive: true });
    const [user] = await database.db
      .insert(users)
      .values({
        displayName: "Finance",
        email: "finance@example.com",
        passwordHash: "unused",
        planningTimezone: "UTC",
      })
      .returning();
    if (!user) throw new Error("Fixture user was not created.");
    userId = user.id;
  }, 120_000);

  afterAll(async () => {
    await database.close();
    await container.stop();
  });

  it("derives Finance attention provenance, deduplicates open items, and audits atomically", async () => {
    const service = createFinanceService({ db: database.db, now: () => now });
    const [attentionOwner] = await database.db
      .insert(users)
      .values({
        displayName: "Finance Attention",
        email: "finance-attention@example.com",
        passwordHash: "unused",
        planningTimezone: "UTC",
      })
      .returning();
    if (!attentionOwner) throw new Error("Finance attention user was not created.");
    const context = {
      principal: financeAgentPrincipal(attentionOwner.id),
      requestId: "finance-attention",
    };
    const [account] = await database.db
      .insert(financeAccounts)
      .values({
        institution: "Attention Bank",
        name: "Attention checking",
        provider: "manual",
        status: "manual",
        userId: attentionOwner.id,
      })
      .returning();
    if (!account) throw new Error("Finance attention account was not created.");
    const [financeTransaction] = await database.db
      .insert(financeTransactions)
      .values({
        accountId: account.id,
        amount: 4_200,
        direction: "expense",
        merchant: "Important merchant",
        needsReview: true,
        transactionDate: "2026-07-19",
        userId: attentionOwner.id,
      })
      .returning();
    if (!financeTransaction) throw new Error("Finance attention transaction was not created.");
    const input = {
      expiresAt: null,
      importance: "high" as const,
      kind: "important" as const,
      occursAt: null,
      summary: "Review the current transaction evidence.",
      title: "Finance transaction needs review",
    };
    const [first, refreshed] = await Promise.all([
      service.upsertAttentionItem(financeTransaction.id, input, context),
      service.upsertAttentionItem(financeTransaction.id, input, context),
    ]);
    expect(first.id).toBe(refreshed.id);
    expect([first.version, refreshed.version].sort()).toEqual([1, 2]);
    expect(refreshed.source).toEqual({
      accountId: account.id,
      provider: "local",
      remoteId: financeTransaction.id,
      revision: financeTransaction.updatedAt.toISOString(),
      sourceType: "finance_transaction",
    });
    await expect(
      database.db
        .select()
        .from(attentionItems)
        .where(eq(attentionItems.relatedEntityId, financeTransaction.id)),
    ).resolves.toHaveLength(1);

    const proposal = (
      await service.proposeCategorizations(attentionOwner.id, {
        limit: 50,
        review: "needs_review",
        sortBy: "date",
        sortDirection: "desc",
      })
    ).items.find((item) => item.transaction.id === financeTransaction.id);
    expect(proposal?.source).toEqual(refreshed.source);

    let markSnapshotRead: (() => void) | undefined;
    const snapshotRead = new Promise<void>((resolve) => {
      markSnapshotRead = resolve;
    });
    let releaseSnapshot: (() => void) | undefined;
    const snapshotRelease = new Promise<void>((resolve) => {
      releaseSnapshot = resolve;
    });
    const snapshotService = createFinanceService({
      db: database.db,
      now: () => now,
      onProposalSnapshotRead: async () => {
        markSnapshotRead?.();
        await snapshotRelease;
      },
    });
    const deferredProposal = snapshotService.proposeCategorizations(attentionOwner.id, {
      limit: 50,
      review: "needs_review",
      sortBy: "date",
      sortDirection: "desc",
    });
    await snapshotRead;
    const concurrentUpdatedAt = new Date("2026-07-29T18:00:00.000Z");
    await database.db
      .update(financeTransactions)
      .set({ updatedAt: concurrentUpdatedAt })
      .where(eq(financeTransactions.id, financeTransaction.id));
    releaseSnapshot?.();
    const deferredItem = (await deferredProposal).items.find(
      (item) => item.transaction.id === financeTransaction.id,
    );
    expect(deferredItem?.source.revision).toBe(deferredItem?.transaction.updatedAt);
    expect(deferredItem?.source.revision).not.toBe(concurrentUpdatedAt.toISOString());

    const [plaidAccount] = await database.db
      .insert(financeAccounts)
      .values({
        institution: "Attention Plaid Bank",
        name: "Attention Plaid checking",
        provider: "plaid",
        status: "connected",
        userId: attentionOwner.id,
      })
      .returning();
    if (!plaidAccount) throw new Error("Finance Plaid attention account was not created.");
    const [plaidTransaction] = await database.db
      .insert(financeTransactions)
      .values({
        accountId: plaidAccount.id,
        amount: 5_100,
        direction: "expense",
        merchant: "Plaid merchant",
        needsReview: true,
        transactionDate: "2026-07-20",
        userId: attentionOwner.id,
      })
      .returning();
    if (!plaidTransaction) throw new Error("Finance Plaid attention transaction was not created.");
    const plaidAttention = await service.upsertAttentionItem(plaidTransaction.id, input, {
      ...context,
      requestId: "finance-plaid-attention",
    });
    expect(plaidAttention).toMatchObject({
      source: {
        accountId: plaidAccount.id,
        provider: "plaid",
        remoteId: null,
        revision: plaidTransaction.updatedAt.toISOString(),
        sourceType: "finance_transaction",
      },
    });
    await service.deleteAccount(plaidAccount.id, {
      principal: financePrincipal(attentionOwner.id),
      requestId: "delete-plaid-attention-account",
    });

    const [paypalAccount] = await database.db
      .insert(financeAccounts)
      .values({
        institution: "PayPal",
        name: "PayPal import",
        provider: "paypal",
        status: "manual",
        userId: attentionOwner.id,
      })
      .returning();
    if (!paypalAccount) throw new Error("Finance PayPal attention account was not created.");
    const [paypalTransaction] = await database.db
      .insert(financeTransactions)
      .values({
        accountId: paypalAccount.id,
        amount: 2_300,
        direction: "expense",
        merchant: "Imported merchant",
        needsReview: true,
        providerTransactionId: "paypal-fingerprint",
        transactionDate: "2026-07-21",
        userId: attentionOwner.id,
      })
      .returning();
    if (!paypalTransaction)
      throw new Error("Finance PayPal attention transaction was not created.");
    const paypalAttention = await service.upsertAttentionItem(paypalTransaction.id, input, {
      ...context,
      requestId: "finance-paypal-attention",
    });
    expect(paypalAttention).toMatchObject({
      source: {
        accountId: paypalAccount.id,
        provider: "paypal",
        remoteId: "paypal-fingerprint",
        revision: paypalTransaction.updatedAt.toISOString(),
        sourceType: "finance_transaction",
      },
    });
    await service.deleteAccount(paypalAccount.id, {
      principal: financePrincipal(attentionOwner.id),
      requestId: "delete-paypal-attention-account",
    });
    const [detachedPayPalAttention] = await database.db
      .select()
      .from(attentionItems)
      .where(eq(attentionItems.id, paypalAttention.id))
      .limit(1);
    expect(detachedPayPalAttention).toMatchObject({
      relatedEntityId: null,
      relatedEntityType: null,
      source: null,
      status: "resolved",
      version: 2,
    });

    const [otherUser] = await database.db
      .insert(users)
      .values({
        displayName: "Other Finance",
        email: "other-finance-attention@example.com",
        passwordHash: "unused",
        planningTimezone: "UTC",
      })
      .returning();
    if (!otherUser) throw new Error("Other Finance user was not created.");
    await expect(
      service.upsertAttentionItem(financeTransaction.id, input, {
        principal: financeAgentPrincipal(otherUser.id),
        requestId: "forged-finance-attention",
      }),
    ).rejects.toMatchObject({ code: "not_found" });

    try {
      await database.pool.query(`
        CREATE OR REPLACE FUNCTION fail_finance_attention_audit_for_test() RETURNS trigger AS $$
        BEGIN
          IF NEW.request_id = 'finance-attention-audit-failure' THEN
            RAISE EXCEPTION 'forced Finance attention audit failure';
          END IF;
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
        CREATE TRIGGER fail_finance_attention_audit_for_test
        BEFORE INSERT ON audit_events
        FOR EACH ROW EXECUTE FUNCTION fail_finance_attention_audit_for_test();
      `);
      let auditFailure: unknown;
      try {
        await service.upsertAttentionItem(
          financeTransaction.id,
          { ...input, kind: "follow_up", title: "Must roll back" },
          { ...context, requestId: "finance-attention-audit-failure" },
        );
      } catch (error) {
        auditFailure = error;
      }
      expect(auditFailure).toBeInstanceOf(Error);
      expect((auditFailure as Error & { cause?: Error }).cause?.message).toContain(
        "forced Finance attention audit failure",
      );
    } finally {
      await database.pool.query(`
        DROP TRIGGER IF EXISTS fail_finance_attention_audit_for_test ON audit_events;
        DROP FUNCTION IF EXISTS fail_finance_attention_audit_for_test();
      `);
    }
    await expect(
      database.db
        .select()
        .from(attentionItems)
        .where(
          and(
            eq(attentionItems.relatedEntityId, financeTransaction.id),
            eq(attentionItems.kind, "follow_up"),
          ),
        ),
    ).resolves.toEqual([]);
    const attentionAudits = await database.db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.requestId, "finance-attention"));
    expect(attentionAudits).toHaveLength(2);
    expect(attentionAudits).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          after: expect.objectContaining({
            policy: "approved_rule",
            source: refreshed.source,
          }),
        }),
      ]),
    );
    const attentionAuditPayloads = JSON.stringify(
      attentionAudits.map(({ after, before }) => ({ after, before })),
    );
    expect(attentionAuditPayloads).not.toContain(input.title);
    expect(attentionAuditPayloads).not.toContain(financeTransaction.merchant);
    expect(attentionAuditPayloads).not.toMatch(/(?:^|[^0-9A-Za-z-])4200(?:[^0-9A-Za-z-]|$)/);
  });

  it("serializes Finance account deletion with attention upserts and detaches every material link", async () => {
    const service = createFinanceService({ db: database.db, now: () => now });
    const [owner] = await database.db
      .insert(users)
      .values({
        displayName: "Finance Delete",
        email: "finance-delete-attention@example.com",
        passwordHash: "unused",
        planningTimezone: "UTC",
      })
      .returning();
    if (!owner) throw new Error("Finance delete user was not created.");
    const [account] = await database.db
      .insert(financeAccounts)
      .values({
        institution: "Delete Bank",
        name: "Delete checking",
        provider: "manual",
        status: "manual",
        userId: owner.id,
      })
      .returning();
    if (!account) throw new Error("Finance delete account was not created.");
    const [financeTransaction] = await database.db
      .insert(financeTransactions)
      .values({
        accountId: account.id,
        amount: 1_500,
        direction: "expense",
        merchant: "Delete merchant",
        transactionDate: "2026-07-21",
        userId: owner.id,
      })
      .returning();
    if (!financeTransaction) throw new Error("Finance delete transaction was not created.");
    await database.db.insert(financeTransactions).values(
      Array.from({ length: 1_000 }, (_, index) => ({
        accountId: account.id,
        amount: index + 1,
        direction: "expense" as const,
        merchant: `Delete filler ${index}`,
        transactionDate: "2026-07-20",
        userId: owner.id,
      })),
    );
    const input = {
      expiresAt: null,
      importance: "high" as const,
      kind: "important" as const,
      occursAt: null,
      summary: "Review before deleting.",
      title: "Delete-safe attention",
    };
    await service.upsertAttentionItem(financeTransaction.id, input, {
      principal: financeAgentPrincipal(owner.id),
      requestId: "finance-delete-attention-create",
    });
    const [deletion, concurrentUpsert] = await Promise.allSettled([
      service.deleteAccount(account.id, {
        principal: financePrincipal(owner.id),
        requestId: "finance-delete-account",
      }),
      service.upsertAttentionItem(financeTransaction.id, input, {
        principal: financeAgentPrincipal(owner.id),
        requestId: "finance-delete-attention-race",
      }),
    ]);
    expect(deletion.status).toBe("fulfilled");
    if (concurrentUpsert.status === "rejected") {
      expect(concurrentUpsert.reason).toMatchObject({ code: "not_found" });
    }
    const linked = await database.db
      .select()
      .from(attentionItems)
      .where(eq(attentionItems.userId, owner.id));
    expect(linked).toEqual([
      expect.objectContaining({
        relatedEntityId: null,
        relatedEntityType: null,
        source: null,
        status: "resolved",
      }),
    ]);
  });

  it("deletes a credential-bearing Provider Item when its last linked account is deleted", async () => {
    const [owner] = await database.db
      .insert(users)
      .values({
        displayName: "Provider Item deletion",
        email: `provider-item-delete-${crypto.randomUUID()}@example.com`,
        passwordHash: "unused",
        planningTimezone: "UTC",
      })
      .returning();
    if (!owner) throw new Error("Provider Item deletion user was not created.");
    const service = createFinanceService({
      db: database.db,
      encryptionKey: key,
      now: () => now,
      plaid: createPlaidConnector({
        clientId: "client",
        environment: "sandbox",
        fetch: plaidFetch(),
        secret: "secret",
      }),
    });
    const context = {
      principal: financePrincipal(owner.id),
      requestId: "delete-provider-item-accounts",
    };
    const connected = await service.exchangePlaidToken(
      { institution: "Deletion Bank", publicToken: "public-token" },
      context,
    );
    expect(connected).toHaveLength(2);
    const [itemBefore] = await database.db
      .select({
        encryptedCredentials: financeProviderItems.encryptedCredentials,
        id: financeProviderItems.id,
      })
      .from(financeProviderItems)
      .where(eq(financeProviderItems.userId, owner.id));
    expect(itemBefore).toMatchObject({ encryptedCredentials: expect.any(Object) });
    if (!itemBefore || !connected[0] || !connected[1]) {
      throw new Error("Provider Item deletion fixture was incomplete.");
    }

    await service.deleteAccount(connected[0].id, context);
    await expect(
      database.db
        .select({ id: financeProviderItems.id })
        .from(financeProviderItems)
        .where(eq(financeProviderItems.id, itemBefore.id)),
    ).resolves.toEqual([{ id: itemBefore.id }]);

    await service.deleteAccount(connected[1].id, context);
    await expect(
      database.db
        .select({
          encryptedCredentials: financeProviderItems.encryptedCredentials,
          id: financeProviderItems.id,
        })
        .from(financeProviderItems)
        .where(eq(financeProviderItems.id, itemBefore.id)),
    ).resolves.toEqual([]);
  });

  it("rejects account deletion when an owned Item has a cross-owner account pointer", async () => {
    const [owner, foreignOwner] = await database.db
      .insert(users)
      .values([
        {
          displayName: "Delete topology owner",
          email: `delete-topology-owner-${crypto.randomUUID()}@example.com`,
          passwordHash: "unused",
          planningTimezone: "UTC",
        },
        {
          displayName: "Delete topology foreign owner",
          email: `delete-topology-foreign-${crypto.randomUUID()}@example.com`,
          passwordHash: "unused",
          planningTimezone: "UTC",
        },
      ])
      .returning();
    if (!owner || !foreignOwner) throw new Error("Delete topology users were not created.");
    const context = {
      principal: financePrincipal(owner.id),
      requestId: "delete-cross-owner-pointer",
    };
    const providerItems = createFinanceProviderItemService({
      db: database.db,
      encryptionKey: key,
      now: () => now,
    });
    const [target] = await providerItems.upsertConnection({
      accessToken: "delete-owned-token",
      accounts: [
        {
          accountId: "delete-owned-account",
          balanceCurrent: 10,
          currencyCode: "USD",
          name: "Delete owned account",
          officialName: null,
        },
      ],
      context,
      institution: "Delete Owned Bank",
      itemId: "delete-owned-item",
    });
    const [ownedItem] = await database.db
      .select()
      .from(financeProviderItems)
      .where(eq(financeProviderItems.userId, owner.id));
    if (!target || !ownedItem) throw new Error("Delete topology Item was not created.");
    const [foreignPointer] = await database.db
      .insert(financeAccounts)
      .values({
        institution: "Foreign Pointer Bank",
        name: "Foreign pointer account",
        provider: "plaid",
        providerAccountId: "delete-foreign-pointer",
        providerItemId: "delete-owned-item",
        providerItemRecordId: ownedItem.id,
        status: "connected",
        userId: foreignOwner.id,
      })
      .returning();
    if (!foreignPointer) throw new Error("Foreign delete pointer was not created.");
    const itemBefore = (
      await database.db
        .select()
        .from(financeProviderItems)
        .where(eq(financeProviderItems.id, ownedItem.id))
    )[0];
    const auditsBefore = await database.db.$count(auditEvents);

    await expect(
      createFinanceService({ db: database.db, now: () => now }).deleteAccount(target.id, context),
    ).rejects.toMatchObject({ code: "conflict" });

    expect(
      await database.db
        .select({ id: financeAccounts.id })
        .from(financeAccounts)
        .where(inArray(financeAccounts.id, [target.id, foreignPointer.id])),
    ).toHaveLength(2);
    expect(
      (
        await database.db
          .select()
          .from(financeProviderItems)
          .where(eq(financeProviderItems.id, ownedItem.id))
      )[0],
    ).toEqual(itemBefore);
    expect(await database.db.$count(auditEvents)).toBe(auditsBefore);
    await database.db.delete(users).where(inArray(users.id, [owner.id, foreignOwner.id]));
  });

  it("rejects account deletion when an owned Item has a linked non-Plaid account", async () => {
    const [owner] = await database.db
      .insert(users)
      .values({
        displayName: "Delete provider-integrity owner",
        email: `delete-provider-integrity-${crypto.randomUUID()}@example.com`,
        passwordHash: "unused",
        planningTimezone: "UTC",
      })
      .returning();
    if (!owner) throw new Error("Delete provider-integrity owner was not created.");
    const context = {
      principal: financePrincipal(owner.id),
      requestId: "delete-cross-provider-pointer",
    };
    const providerItems = createFinanceProviderItemService({
      db: database.db,
      encryptionKey: key,
      now: () => now,
    });
    const [target] = await providerItems.upsertConnection({
      accessToken: "delete-provider-token",
      accounts: [
        {
          accountId: "delete-provider-account",
          balanceCurrent: 10,
          currencyCode: "USD",
          name: "Delete provider account",
          officialName: null,
        },
      ],
      context,
      institution: "Delete Provider Bank",
      itemId: "delete-provider-item",
    });
    const [ownedItem] = await database.db
      .select()
      .from(financeProviderItems)
      .where(eq(financeProviderItems.userId, owner.id));
    if (!target || !ownedItem) throw new Error("Delete provider Item was not created.");
    const [manualPointer] = await database.db
      .insert(financeAccounts)
      .values({
        institution: "Manual Pointer",
        name: "Manual delete pointer",
        provider: "manual",
        providerItemRecordId: ownedItem.id,
        status: "manual",
        userId: owner.id,
      })
      .returning();
    if (!manualPointer) throw new Error("Manual delete pointer was not created.");
    const auditsBefore = await database.db.$count(auditEvents);

    await expect(
      createFinanceService({ db: database.db, now: () => now }).deleteAccount(target.id, context),
    ).rejects.toMatchObject({ code: "conflict" });

    expect(
      await database.db
        .select({ id: financeAccounts.id })
        .from(financeAccounts)
        .where(inArray(financeAccounts.id, [target.id, manualPointer.id])),
    ).toHaveLength(2);
    expect(await database.db.$count(auditEvents)).toBe(auditsBefore);
    await database.db.delete(users).where(eq(users.id, owner.id));
  });

  it("serializes a relink with account deletion without orphaning credential Items", async () => {
    const [owner] = await database.db
      .insert(users)
      .values({
        displayName: "Provider Item relink delete",
        email: `provider-item-relink-delete-${crypto.randomUUID()}@example.com`,
        passwordHash: "unused",
        planningTimezone: "UTC",
      })
      .returning();
    if (!owner) throw new Error("Relink/delete user was not created.");
    const context = {
      principal: financePrincipal(owner.id),
      requestId: "relink-delete-race",
    };
    const providerItems = createFinanceProviderItemService({
      db: database.db,
      encryptionKey: key,
      now: () => now,
    });
    const remote = (accountId: string) => ({
      accountId,
      balanceCurrent: 10,
      currencyCode: "USD",
      name: accountId,
      officialName: null,
    });
    const [moving] = await providerItems.upsertConnection({
      accessToken: "source-token",
      accounts: [remote("relink-delete-moving")],
      context,
      institution: "Source Bank",
      itemId: "relink-delete-source",
    });
    await providerItems.upsertConnection({
      accessToken: "destination-token",
      accounts: [remote("relink-delete-anchor")],
      context,
      institution: "Destination Bank",
      itemId: "relink-delete-destination",
    });
    if (!moving) throw new Error("Relink/delete account was not created.");

    const blocker = await database.pool.connect();
    let relink: ReturnType<typeof providerItems.upsertConnection> | undefined;
    let deletion: ReturnType<ReturnType<typeof createFinanceService>["deleteAccount"]> | undefined;
    try {
      await blocker.query("BEGIN");
      await blocker.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
        `finance-provider-topology:${owner.id}`,
      ]);
      relink = providerItems.upsertConnection({
        accessToken: "destination-relink-token",
        accounts: [remote("relink-delete-moving")],
        context: { ...context, requestId: "relink-delete-move" },
        institution: "Destination Bank",
        itemId: "relink-delete-destination",
      });
      void relink.catch(() => undefined);
      await waitForLockWaiters(database.pool, 1);
      deletion = createFinanceService({ db: database.db, now: () => now }).deleteAccount(
        moving.id,
        { ...context, requestId: "relink-delete-delete" },
      );
      void deletion.catch(() => undefined);
      await waitForLockWaiters(database.pool, 2);
      await blocker.query("COMMIT");

      await expect(relink).resolves.toHaveLength(1);
      await expect(deletion).resolves.toBeUndefined();
    } finally {
      await blocker.query("ROLLBACK");
      blocker.release();
      await Promise.allSettled([relink, deletion].filter((value) => value !== undefined));
    }

    expect(
      await database.db
        .select({ providerAccountId: financeAccounts.providerAccountId })
        .from(financeAccounts)
        .where(eq(financeAccounts.userId, owner.id)),
    ).toEqual([{ providerAccountId: "relink-delete-anchor" }]);
    expect(
      await database.db
        .select({ providerItemId: financeProviderItems.providerItemId })
        .from(financeProviderItems)
        .where(eq(financeProviderItems.userId, owner.id)),
    ).toEqual([{ providerItemId: "relink-delete-destination" }]);
    const orphanItems = await database.pool.query<{ id: string }>(
      `SELECT item.id
       FROM finance_provider_items AS item
       LEFT JOIN finance_accounts AS account ON account.provider_item_record_id = item.id
       WHERE item.user_id = $1 AND account.id IS NULL`,
      [owner.id],
    );
    expect(orphanItems.rows).toEqual([]);
    await database.db.delete(users).where(eq(users.id, owner.id));
  });

  it("manages manual finances, review decisions, budgets, and safe unavailable Plaid state", async () => {
    const service = createFinanceService({ db: database.db, now: () => now });
    const context = { principal: financePrincipal(userId), requestId: "manual-finance" };
    expect(service.plaidAvailable()).toBe(false);
    await expect(service.createPlaidLinkToken(userId)).rejects.toThrow("Plaid is not configured");
    const account = await service.createAccount(
      { balance: 1500, institution: "Cash", name: "Wallet", provider: "manual" },
      context,
    );
    const categorized = await service.createTransaction(
      {
        accountId: account.id,
        amount: 12.5,
        category: null,
        categoryConfidence: null,
        date: "2026-07-19",
        direction: "expense",
        merchant: "Trader Joe's",
        notes: null,
      },
      context,
    );
    const review = await service.createTransaction(
      {
        accountId: account.id,
        amount: 6,
        category: null,
        categoryConfidence: null,
        date: "2026-07-19",
        direction: "expense",
        merchant: "Mystery Shop",
        notes: null,
      },
      context,
    );
    expect(categorized).toMatchObject({
      category: "Groceries",
      categoryConfidence: 0.9,
      needsReview: false,
    });
    expect(review.needsReview).toBe(true);
    const shopping = (await service.listCategories(userId)).find(
      (item) => item.slug === "shopping",
    );
    if (!shopping) throw new Error("Shopping category was not seeded.");
    const [pendingCandidate] = await database.db
      .insert(financeTransactions)
      .values({
        accountId: account.id,
        amount: 800,
        category: null,
        direction: "expense",
        merchant: "Pending Card Hold",
        needsReview: true,
        pending: true,
        transactionDate: "2026-07-19",
        userId,
      })
      .returning();
    if (!pendingCandidate) throw new Error("Pending categorization fixture was not created.");
    await expect(
      service.applyCategorizations(
        {
          decisions: [
            {
              categoryId: shopping.id,
              confidence: 1,
              expectedTransactionUpdatedAt: pendingCandidate.updatedAt.toISOString(),
              learnMerchant: "never",
              rationale: "Organize the provisional card hold without learning from it.",
              transactionId: pendingCandidate.id,
            },
          ],
        },
        context,
      ),
    ).resolves.toEqual([
      expect.objectContaining({
        applied: true,
        transaction: expect.objectContaining({ category: "Shopping", pending: true }),
      }),
    ]);
    await expect(
      database.db
        .select()
        .from(financeClassificationDecisions)
        .where(eq(financeClassificationDecisions.transactionId, pendingCandidate.id)),
    ).resolves.toHaveLength(0);
    const agentContext = {
      principal: financeAgentPrincipal(userId),
      requestId: "agent-finance",
    };
    await expect(
      service.applyCategorizations(
        {
          decisions: [
            {
              categoryId: shopping.id,
              confidence: 1,
              expectedTransactionUpdatedAt: review.updatedAt,
              learnMerchant: "always",
              rationale: "The agent should not create a permanent rule.",
              transactionId: review.id,
            },
          ],
        },
        agentContext,
      ),
    ).rejects.toThrow("Permanent merchant rules require review");
    await expect(
      service.updateTransaction(
        review.id,
        { category: "Shopping", learnMerchant: false },
        agentContext,
      ),
    ).rejects.toThrow("transaction edits require an interactive user session");
    await expect(
      service.updateTransaction(review.id, { notes: "Agent overwrite" }, agentContext),
    ).rejects.toThrow("transaction edits require an interactive user session");
    const stale = await service.createTransaction(
      {
        accountId: account.id,
        amount: 7,
        category: null,
        categoryConfidence: null,
        date: "2026-07-19",
        direction: "expense",
        merchant: "Revision Race",
        notes: null,
      },
      context,
    );
    await database.db
      .update(financeTransactions)
      .set({
        notes: "Changed after preview",
        updatedAt: new Date("2026-07-19T12:01:00.000Z"),
      })
      .where(eq(financeTransactions.id, stale.id));
    await expect(
      service.applyCategorizations(
        {
          decisions: [
            {
              categoryId: shopping.id,
              confidence: 1,
              expectedTransactionUpdatedAt: stale.updatedAt,
              learnMerchant: "never",
              rationale: "This decision was prepared from a stale preview.",
              transactionId: stale.id,
            },
          ],
        },
        context,
      ),
    ).resolves.toEqual([
      expect.objectContaining({
        applied: false,
        error: expect.objectContaining({ code: "conflict" }),
        status: "failed",
        transaction: null,
      }),
    ]);
    const [staleAfter] = await database.db
      .select()
      .from(financeTransactions)
      .where(eq(financeTransactions.id, stale.id));
    expect(staleAfter).toMatchObject({ category: null, notes: "Changed after preview" });
    const [readOnlyCandidate] = await database.db
      .insert(financeTransactions)
      .values({
        accountId: account.id,
        amount: 900,
        category: null,
        direction: "expense",
        merchant: "SQ *READ ONLY 8821",
        needsReview: true,
        transactionDate: "2026-07-19",
        userId,
      })
      .returning();
    if (!readOnlyCandidate) throw new Error("Read-only proposal fixture was not created.");
    const readOnlyProposals = await service.proposeCategorizations(userId, {
      limit: 50,
      review: "needs_review",
    });
    expect(
      readOnlyProposals.items.find((item) => item.transaction.id === readOnlyCandidate.id),
    ).toMatchObject({
      transaction: {
        merchant: "Sq Read Only",
        rawMerchant: "SQ *READ ONLY 8821",
      },
    });
    const [readOnlyCandidateAfter] = await database.db
      .select()
      .from(financeTransactions)
      .where(eq(financeTransactions.id, readOnlyCandidate.id));
    expect(readOnlyCandidateAfter).toMatchObject({
      categoryId: null,
      merchantId: null,
      updatedAt: readOnlyCandidate.updatedAt,
    });
    await database.db
      .delete(financeTransactions)
      .where(eq(financeTransactions.id, readOnlyCandidate.id));
    await service.createTransaction(
      {
        accountId: account.id,
        amount: 1,
        category: "Shopping",
        categoryConfidence: null,
        date: "2026-07-19",
        direction: "expense",
        merchant: "Single Evidence",
        notes: null,
      },
      context,
    );
    const lowConfidenceCandidate = await service.createTransaction(
      {
        accountId: account.id,
        amount: 2,
        category: null,
        categoryConfidence: null,
        date: "2026-07-19",
        direction: "expense",
        merchant: "Single Evidence",
        notes: null,
      },
      context,
    );
    await expect(
      service.proposeCategorizations(userId, { limit: 50, review: "needs_review" }),
    ).resolves.toMatchObject({
      items: expect.arrayContaining([
        expect.objectContaining({
          confidence: 0.95,
          threshold: 0.9725,
          transaction: expect.objectContaining({ id: lowConfidenceCandidate.id }),
        }),
      ]),
    });
    const lowConfidenceInput = {
      decisions: [
        {
          categoryId: shopping.id,
          confidence: 0.95,
          expectedTransactionUpdatedAt: lowConfidenceCandidate.updatedAt,
          learnMerchant: "suggest" as const,
          rationale: "One confirmation remains below the adaptive threshold.",
          transactionId: lowConfidenceCandidate.id,
        },
      ],
    };
    await expect(service.applyCategorizations(lowConfidenceInput, agentContext)).resolves.toEqual([
      expect.objectContaining({
        applied: false,
        replayed: false,
        status: "review_required",
        threshold: 0.9725,
      }),
    ]);
    const lowConfidenceAudits = await database.db
      .select({ after: auditEvents.after, before: auditEvents.before })
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.action, "finance.categorization_deferred"),
          eq(auditEvents.entityId, lowConfidenceCandidate.id),
        ),
      );
    expect(lowConfidenceAudits).toHaveLength(1);
    expect(lowConfidenceAudits[0]).toEqual({
      after: {
        categoryId: shopping.id,
        confidence: 0.95,
        reviewId: expect.any(String),
        status: "review_required",
        threshold: 0.9725,
      },
      before: {
        categoryId: null,
        needsReview: true,
        updatedAt: lowConfidenceCandidate.updatedAt,
      },
    });
    const lowConfidenceReview = (await service.listReviewQueue(userId)).find(
      (item) => item.transaction.id === lowConfidenceCandidate.id,
    );
    if (!lowConfidenceReview) throw new Error("Low-confidence review was not created.");
    const [reviewBeforeRetry] = await database.db
      .select({ updatedAt: financeReviewCases.updatedAt })
      .from(financeReviewCases)
      .where(eq(financeReviewCases.id, lowConfidenceReview.id));
    if (!reviewBeforeRetry) throw new Error("Low-confidence review row was not found.");
    await expect(service.applyCategorizations(lowConfidenceInput, agentContext)).resolves.toEqual([
      expect.objectContaining({
        applied: false,
        replayed: true,
        status: "review_required",
        threshold: 0.9725,
      }),
    ]);
    const replayReviews = await database.db
      .select()
      .from(financeReviewCases)
      .where(eq(financeReviewCases.transactionId, lowConfidenceCandidate.id));
    const replayDecisions = await database.db
      .select()
      .from(financeClassificationDecisions)
      .where(
        and(
          eq(financeClassificationDecisions.transactionId, lowConfidenceCandidate.id),
          eq(financeClassificationDecisions.outcome, "deferred"),
        ),
      );
    const replayAudits = await database.db
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.action, "finance.categorization_deferred"),
          eq(auditEvents.entityId, lowConfidenceCandidate.id),
        ),
      );
    expect(replayReviews).toHaveLength(1);
    expect(replayReviews[0]?.updatedAt.toISOString()).toBe(
      reviewBeforeRetry.updatedAt.toISOString(),
    );
    expect(replayDecisions).toHaveLength(1);
    expect(replayAudits).toHaveLength(1);
    await expect(
      service.resolveReview(
        lowConfidenceReview.id,
        {
          action: "confirm_transfer",
          expectedTransactionUpdatedAt: lowConfidenceReview.transaction.updatedAt,
          learnMerchant: "never",
          rationale: "A non-transfer review cannot become a transfer.",
        },
        context,
      ),
    ).rejects.toThrow("Only a possible-transfer review can be confirmed as a transfer");
    await service.resolveReview(
      lowConfidenceReview.id,
      {
        action: "recategorize",
        categoryId: shopping.id,
        expectedTransactionUpdatedAt: lowConfidenceReview.transaction.updatedAt,
        learnMerchant: "never",
        rationale: "The user accepted the individual category.",
      },
      context,
    );
    const policyRaceEvidence = await service.createTransaction(
      {
        accountId: account.id,
        amount: 2,
        category: "Shopping",
        categoryConfidence: null,
        date: "2026-07-19",
        direction: "expense",
        merchant: "Policy Race",
        notes: null,
      },
      context,
    );
    const policyRaceCandidate = await service.createTransaction(
      {
        accountId: account.id,
        amount: 3,
        category: null,
        categoryConfidence: null,
        date: "2026-07-19",
        direction: "expense",
        merchant: "Policy Race",
        notes: null,
      },
      context,
    );
    const policyRaceProposal = (
      await service.proposeCategorizations(userId, { limit: 50, review: "needs_review" })
    ).items.find((item) => item.transaction.id === policyRaceCandidate.id);
    if (!policyRaceProposal || !policyRaceCandidate.merchantId) {
      throw new Error("The policy-race proposal fixture was not created.");
    }
    let policyLockAcquired = () => {};
    const policyLocked = new Promise<void>((resolve) => {
      policyLockAcquired = resolve;
    });
    let releasePolicyLock = () => {};
    const policyLockRelease = new Promise<void>((resolve) => {
      releasePolicyLock = resolve;
    });
    const concurrentPolicyWriter = database.db.transaction(async (tx) => {
      await tx
        .select({ id: financeCategories.id })
        .from(financeCategories)
        .where(eq(financeCategories.userId, userId))
        .orderBy(financeCategories.id)
        .for("update");
      policyLockAcquired();
      await policyLockRelease;
      await tx.insert(financeClassificationDecisions).values({
        categoryId: shopping.id,
        categoryName: shopping.name,
        confidence: 10_000,
        merchantId: policyRaceCandidate.merchantId,
        outcome: "confirmed",
        rationale: "Concurrent user confirmation.",
        source: "user",
        transactionId: policyRaceEvidence.id,
        userId,
      });
    });
    await policyLocked;
    const concurrentApply = service.applyCategorizations(
      {
        decisions: [
          {
            categoryId: shopping.id,
            confidence: policyRaceProposal.confidence,
            expectedTransactionUpdatedAt: policyRaceProposal.transaction.updatedAt,
            learnMerchant: "never",
            rationale: "Apply only if the proposal evidence is still current.",
            transactionId: policyRaceCandidate.id,
          },
        ],
      },
      agentContext,
    );
    await new Promise((resolve) => setTimeout(resolve, 25));
    releasePolicyLock();
    await concurrentPolicyWriter;
    await expect(concurrentApply).resolves.toEqual([
      expect.objectContaining({
        applied: false,
        error: expect.objectContaining({ code: "conflict" }),
        status: "failed",
      }),
    ]);
    for (const amount of [3, 4]) {
      await service.createTransaction(
        {
          accountId: account.id,
          amount,
          category: "Shopping",
          categoryConfidence: null,
          date: "2026-07-19",
          direction: "expense",
          merchant: "Everyday Supplies",
          notes: null,
        },
        context,
      );
    }
    const evidenceCandidate = await service.createTransaction(
      {
        accountId: account.id,
        amount: 5,
        category: null,
        categoryConfidence: null,
        date: "2026-07-19",
        direction: "expense",
        merchant: "Everyday Supplies",
        notes: null,
      },
      context,
    );
    await expect(
      service.proposeCategorizations(userId, { limit: 50, review: "needs_review" }),
    ).resolves.toMatchObject({
      items: expect.arrayContaining([
        expect.objectContaining({
          meetsPolicyThreshold: true,
          policy: "preview",
          confidence: 0.965,
          threshold: 0.96,
          transaction: expect.objectContaining({ id: evidenceCandidate.id }),
        }),
      ]),
    });
    await expect(
      service.applyCategorizations(
        {
          decisions: [
            {
              categoryId: shopping.id,
              confidence: 1,
              expectedTransactionUpdatedAt: review.updatedAt,
              learnMerchant: "suggest",
              rationale: "An agent cannot substitute its own confidence and category.",
              transactionId: review.id,
            },
          ],
        },
        agentContext,
      ),
    ).resolves.toEqual([
      expect.objectContaining({
        applied: false,
        error: expect.objectContaining({ code: "conflict" }),
        status: "failed",
      }),
    ]);
    await expect(
      service.applyCategorizations(
        {
          decisions: [
            {
              categoryId: shopping.id,
              confidence: 0.965,
              expectedTransactionUpdatedAt: now.toISOString(),
              learnMerchant: "never",
              rationale: "This missing transaction should fail independently.",
              transactionId: "00000000-0000-4000-8000-000000000000",
            },
            {
              categoryId: shopping.id,
              confidence: 0.965,
              expectedTransactionUpdatedAt: evidenceCandidate.updatedAt,
              learnMerchant: "suggest",
              rationale: "The user accepted the current server proposal.",
              transactionId: evidenceCandidate.id,
            },
          ],
        },
        agentContext,
      ),
    ).resolves.toEqual([
      expect.objectContaining({
        applied: false,
        error: expect.objectContaining({ code: "not_found" }),
        status: "failed",
      }),
      expect.objectContaining({ applied: true, status: "applied" }),
    ]);
    const agentReviewCandidate = await service.createTransaction(
      {
        accountId: account.id,
        amount: 6,
        category: null,
        categoryConfidence: null,
        date: "2026-07-19",
        direction: "expense",
        merchant: "Everyday Supplies",
        notes: null,
      },
      context,
    );
    const [agentReview] = await database.db
      .insert(financeReviewCases)
      .values({
        rationale: "Review the current evidence.",
        reason: "low_confidence",
        status: "open",
        suggestedCategoryId: shopping.id,
        transactionId: agentReviewCandidate.id,
        userId,
      })
      .returning();
    const agentReviewProposal = (
      await service.proposeCategorizations(userId, { limit: 50, review: "needs_review" })
    ).items.find((item) => item.transaction.id === agentReviewCandidate.id);
    if (!agentReviewProposal || !agentReview) {
      throw new Error("The agent review proposal fixture was not created.");
    }
    await expect(
      service.resolveReview(
        agentReview.id,
        {
          action: "recategorize",
          categoryId: agentReviewProposal.suggestedCategory?.id,
          confidence: agentReviewProposal.confidence,
          expectedTransactionUpdatedAt: agentReviewProposal.transaction.updatedAt,
          learnMerchant: "never",
          rationale: "The user accepted the current reviewed proposal.",
        },
        agentContext,
      ),
    ).resolves.toMatchObject({ applied: true });
    const staleAgentReviewCandidate = await service.createTransaction(
      {
        accountId: account.id,
        amount: 7,
        category: null,
        categoryConfidence: null,
        date: "2026-07-19",
        direction: "expense",
        merchant: "Everyday Supplies",
        notes: null,
      },
      context,
    );
    const [staleAgentReview] = await database.db
      .insert(financeReviewCases)
      .values({
        rationale: "Review the current evidence.",
        reason: "low_confidence",
        status: "open",
        suggestedCategoryId: shopping.id,
        transactionId: staleAgentReviewCandidate.id,
        userId,
      })
      .returning();
    const staleAgentReviewProposal = (
      await service.proposeCategorizations(userId, { limit: 50, review: "needs_review" })
    ).items.find((item) => item.transaction.id === staleAgentReviewCandidate.id);
    if (!staleAgentReviewProposal || !staleAgentReview) {
      throw new Error("The stale agent review fixture was not created.");
    }
    await database.db
      .update(financeTransactions)
      .set({
        notes: "Changed after the review was displayed.",
        updatedAt: new Date("2026-07-19T12:02:00.000Z"),
      })
      .where(eq(financeTransactions.id, staleAgentReviewCandidate.id));
    await expect(
      service.resolveReview(
        staleAgentReview.id,
        {
          action: "recategorize",
          categoryId: staleAgentReviewProposal.suggestedCategory?.id,
          confidence: staleAgentReviewProposal.confidence,
          expectedTransactionUpdatedAt: staleAgentReviewProposal.transaction.updatedAt,
          learnMerchant: "never",
          rationale: "This accepted review is stale.",
        },
        agentContext,
      ),
    ).rejects.toThrow("changed after the proposal");
    await service.resolveReview(
      staleAgentReview.id,
      {
        action: "recategorize",
        categoryId: shopping.id,
        expectedTransactionUpdatedAt: "2026-07-19T12:02:00.000Z",
        learnMerchant: "never",
        rationale: "The user resolved the stale review in Finance.",
      },
      context,
    );
    await database.db
      .delete(financeTransactions)
      .where(
        inArray(financeTransactions.id, [
          agentReviewCandidate.id,
          policyRaceCandidate.id,
          policyRaceEvidence.id,
          staleAgentReviewCandidate.id,
        ]),
      );
    const transferCandidate = await service.createTransaction(
      {
        accountId: account.id,
        amount: 25,
        category: null,
        categoryConfidence: null,
        date: "2026-07-19",
        direction: "transfer",
        merchant: "Account movement",
        notes: null,
      },
      context,
    );
    await service.reconcileTransfers(userId);
    const transferReview = (await service.listReviewQueue(userId)).find(
      (item) => item.transaction.id === transferCandidate.id,
    );
    if (!transferReview) throw new Error("Transfer candidate was not queued for review.");
    const categorizationWorkflow = (
      await service.getGuidedSetupContext(userId)
    ).suggestedWorkflows.find((workflow) => workflow.key === "categorization_review");
    expect(categorizationWorkflow).toMatchObject({
      available: false,
      unavailableReason: expect.stringContaining("ambiguous transfers"),
    });
    const guidedSetupSnapshot = await service.getGuidedSetupContext(userId);
    expect(guidedSetupSnapshot.ledgerHealth.unresolvedReviews).toBe(
      guidedSetupSnapshot.reviewSummary.count,
    );
    await expect(
      service.resolveReview(
        transferReview.id,
        {
          action: "confirm_transfer",
          expectedTransactionUpdatedAt: transferReview.transaction.updatedAt,
          learnMerchant: "never",
          rationale: "An agent may not confirm this transfer.",
        },
        agentContext,
      ),
    ).rejects.toThrow("ambiguous transfer requires an interactive user session");
    await expect(
      service.resolveReview(
        transferReview.id,
        {
          action: "approve",
          expectedTransactionUpdatedAt: transferReview.transaction.updatedAt,
          learnMerchant: "never",
          rationale: "A generic approval must not resolve an ambiguous transfer.",
        },
        context,
      ),
    ).rejects.toThrow("Confirm or recategorize an ambiguous transfer explicitly");
    await expect(
      service.resolveReview(
        transferReview.id,
        { action: "defer", learnMerchant: "never", rationale: "Review this in Finance." },
        context,
      ),
    ).resolves.toEqual({ deferred: true });
    await expect(
      service.resolveReview(
        transferReview.id,
        { action: "defer", learnMerchant: "never", rationale: "Retry after a lost response." },
        context,
      ),
    ).resolves.toEqual({ deferred: true });
    const deferAudits = await database.db
      .select({ id: auditEvents.id })
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.action, "finance.review_deferred"),
          eq(auditEvents.entityId, transferReview.id),
        ),
      );
    expect(deferAudits).toHaveLength(1);
    const concurrentTransferDecisions = await Promise.allSettled([
      service.resolveReview(
        transferReview.id,
        {
          action: "confirm_transfer",
          expectedTransactionUpdatedAt: transferReview.transaction.updatedAt,
          learnMerchant: "never",
          rationale: "The user confirmed this is movement between owned accounts.",
        },
        context,
      ),
      service.resolveReview(
        transferReview.id,
        {
          action: "confirm_transfer",
          expectedTransactionUpdatedAt: transferReview.transaction.updatedAt,
          learnMerchant: "never",
          rationale: "A concurrent duplicate decision must not overwrite the first.",
        },
        context,
      ),
    ]);
    expect(
      concurrentTransferDecisions.filter((decision) => decision.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      concurrentTransferDecisions.filter((decision) => decision.status === "rejected"),
    ).toHaveLength(1);
    expect(
      concurrentTransferDecisions.find((decision) => decision.status === "fulfilled"),
    ).toMatchObject({
      status: "fulfilled",
      value: {
        applied: true,
        transaction: expect.objectContaining({
          category: "Transfers",
          direction: "transfer",
          needsReview: false,
          reconciliationStatus: "confirmed",
        }),
      },
    });
    await service.reconcileTransfers(userId);
    expect(
      (await service.listReviewQueue(userId)).some(
        (item) => item.transaction.id === transferCandidate.id,
      ),
    ).toBe(false);
    const recategorizedTransfer = await service.createTransaction(
      {
        accountId: account.id,
        amount: 18,
        category: null,
        categoryConfidence: null,
        date: "2026-07-19",
        direction: "transfer",
        merchant: "Misclassified purchase",
        notes: null,
      },
      context,
    );
    await service.reconcileTransfers(userId);
    const recategorizedTransferReview = (await service.listReviewQueue(userId)).find(
      (item) => item.transaction.id === recategorizedTransfer.id,
    );
    if (!recategorizedTransferReview) {
      throw new Error("The second transfer candidate was not queued for review.");
    }
    await expect(
      service.resolveReview(
        recategorizedTransferReview.id,
        {
          action: "recategorize",
          categoryId: shopping.id,
          expectedTransactionUpdatedAt: recategorizedTransferReview.transaction.updatedAt,
          learnMerchant: "never",
          nonTransferDirection: "expense",
          rationale: "The user confirmed this was a purchase, not a transfer.",
        },
        context,
      ),
    ).resolves.toMatchObject({
      applied: true,
      transaction: expect.objectContaining({
        category: "Shopping",
        direction: "expense",
        needsReview: false,
        reconciliationStatus: "not_applicable",
      }),
    });
    await service.reconcileTransfers(userId);
    expect(
      (await service.listReviewQueue(userId)).some(
        (item) => item.transaction.id === recategorizedTransfer.id,
      ),
    ).toBe(false);
    await service.updateTransaction(
      review.id,
      { category: "Shopping", learnMerchant: true },
      context,
    );
    await expect(
      service.createTransaction(
        {
          accountId: account.id,
          amount: 8,
          category: null,
          categoryConfidence: null,
          date: "2026-07-19",
          direction: "expense",
          merchant: "Mystery Shop #4821",
          notes: null,
        },
        context,
      ),
    ).resolves.toMatchObject({
      category: "Shopping",
      categoryConfidence: 1,
      needsReview: false,
    });
    await expect(
      service.updateTransaction(review.id, { category: null }, context),
    ).resolves.toMatchObject({
      category: null,
      categoryConfidence: null,
      needsReview: true,
    });
    await expect(
      service.createTransaction(
        {
          accountId: account.id,
          amount: 8,
          category: null,
          categoryConfidence: null,
          date: "2026-07-19",
          direction: "expense",
          merchant: "Mystery Shop #9137",
          notes: null,
        },
        context,
      ),
    ).resolves.toMatchObject({ category: null, needsReview: true });
    await expect(
      service.updateTransaction(review.id, { category: "Personal", learnMerchant: false }, context),
    ).resolves.toMatchObject({ category: "Personal", needsReview: false });
    await expect(
      service.updateTransaction(review.id, { notes: "Needs a receipt" }, context),
    ).resolves.toMatchObject({
      notes: "Needs a receipt",
    });
    await expect(
      service.createTransaction(
        {
          accountId: account.id,
          amount: 5,
          category: "Gifts",
          categoryConfidence: null,
          date: "2026-07-19",
          direction: "expense",
          merchant: "Gift shop",
          notes: null,
        },
        context,
      ),
    ).resolves.toMatchObject({ category: "Gifts", categoryConfidence: 1, needsReview: false });
    await expect(
      service.createTransaction(
        {
          accountId: account.id,
          amount: 4,
          category: "Shopping",
          categoryConfidence: 0.5,
          date: "2026-07-19",
          direction: "expense",
          merchant: "Unknown shop",
          notes: null,
        },
        context,
      ),
    ).resolves.toMatchObject({ category: "Shopping", categoryConfidence: 0.5, needsReview: true });
    const imported = await service.createAccount(
      { balance: null, institution: "PayPal", name: "PayPal export", provider: "paypal" },
      context,
    );
    expect(imported).toMatchObject({ balance: null, status: "needs_reauth" });
    await expect(
      service.importCsv(
        {
          accountId: imported.id,
          csv: "Date,Name,Amount,Transaction ID\n07/19/2026,Trader Joe's,14.25,paypal-1",
          provider: "paypal",
        },
        context,
      ),
    ).resolves.toEqual({ imported: 1, skipped: 0 });
    await expect(
      service.importCsv(
        {
          accountId: imported.id,
          csv: "Date,Name,Amount,Transaction ID\n07/19/2026,Trader Joe's,14.25,paypal-1",
          provider: "paypal",
        },
        context,
      ),
    ).resolves.toEqual({ imported: 0, skipped: 1 });
    await expect(
      service.importCsv(
        {
          accountId: imported.id,
          csv: "Date,Name,Amount\n2026-07-19,Ignored,2",
          provider: "venmo",
        },
        context,
      ),
    ).rejects.toThrow("Choose a venmo account");
    await expect(
      service.importCsv(
        {
          accountId: imported.id,
          csv: "Date,Amount\nnot-a-date,10",
          provider: "paypal",
        },
        context,
      ),
    ).rejects.toThrow("Invalid transaction date");
    await expect(
      service.updateTransaction("00000000-0000-4000-8000-000000000000", { notes: "Nope" }, context),
    ).rejects.toThrow("transaction was not found");
    await service.createBudget({ category: "Groceries", limit: 400, month: "2026-07" }, context);
    const overview = await service.listOverview(userId);
    expect(overview).toMatchObject({ reviewCount: 3, spendingThisMonth: 97.75 });
    expect(overview.budgets).toHaveLength(1);
    await expect(service.listOverview(userId, "2026-06")).resolves.toMatchObject({
      budgets: [],
      spendingThisMonth: 0,
      transactions: [],
    });
    await database.db.insert(domainProfiles).values({
      categories: [],
      domain: "finances",
      instructions: [],
      objective: "Keep account meanings durable.",
      preferences: {},
      sourceContexts: [
        {
          notes: null,
          purpose: "Daily spending",
          sourceId: account.id,
          sourceLabel: account.name,
        },
      ],
      status: "active",
      summary: "The wallet is in scope.",
      userId,
    });
    await expect(service.deleteAccount(account.id, context)).rejects.toThrow(
      "Remove this account from active approved Finance guidance",
    );
    await database.db
      .delete(domainProfiles)
      .where(and(eq(domainProfiles.userId, userId), eq(domainProfiles.domain, "finances")));
    await service.deleteAccount(account.id, context);
    expect((await service.listOverview(userId)).accounts).not.toContainEqual(
      expect.objectContaining({ id: account.id }),
    );
    await expect(service.deleteAccount(account.id, context)).rejects.toThrow(
      "financial account was not found",
    );
  });

  it("uses the planning-timezone month for Finance guided setup", async () => {
    const timezoneUserId = crypto.randomUUID();
    await database.db.insert(users).values({
      id: timezoneUserId,
      displayName: "Timezone Finance",
      email: `timezone-finance-${timezoneUserId}@example.com`,
      passwordHash: "unused",
      planningTimezone: "America/Los_Angeles",
    });
    const service = createFinanceService({
      db: database.db,
      now: () => new Date("2026-08-01T00:30:00.000Z"),
    });
    await expect(service.getGuidedSetupContext(timezoneUserId)).resolves.toMatchObject({
      asOf: "2026-08-01T00:30:00.000Z",
      budgetSummary: { month: "2026-07" },
      ledgerHealth: { asOf: "2026-08-01T00:30:00.000Z", unresolvedReviews: 0 },
      reviewSummary: { count: 0 },
    });
  });

  it("rolls back default categories when manual account onboarding fails", async () => {
    const atomicUserId = crypto.randomUUID();
    await database.db.insert(users).values({
      id: atomicUserId,
      displayName: "Atomic Finance",
      email: `atomic-finance-${atomicUserId}@example.com`,
      passwordHash: "unused",
      planningTimezone: "UTC",
    });
    const service = createFinanceService({ db: database.db, now: () => now });
    await expect(
      service.createAccount(
        { balance: 10, institution: "Atomic Bank", name: "Checking", provider: "manual" },
        {
          principal: financePrincipal(atomicUserId),
          requestId: null as unknown as string,
        },
      ),
    ).rejects.toThrow();
    await expect(
      database.db
        .select()
        .from(financeCategories)
        .where(eq(financeCategories.userId, atomicUserId)),
    ).resolves.toHaveLength(0);
    await expect(
      database.db.select().from(financeAccounts).where(eq(financeAccounts.userId, atomicUserId)),
    ).resolves.toHaveLength(0);
  });

  it("commits Plaid categories, Item, accounts, and audits atomically", async () => {
    const atomicUserId = crypto.randomUUID();
    await database.db.insert(users).values({
      id: atomicUserId,
      displayName: "Atomic Plaid Finance",
      email: `atomic-plaid-finance-${atomicUserId}@example.com`,
      passwordHash: "unused",
      planningTimezone: "UTC",
    });
    const plaid = createPlaidConnector({
      clientId: "client",
      environment: "sandbox",
      fetch: async (input) => {
        switch (new URL(String(input)).pathname) {
          case "/item/public_token/exchange":
            return Response.json({ access_token: "atomic-token", item_id: "atomic-item" });
          case "/accounts/get":
            return Response.json({
              accounts: [
                {
                  account_id: "atomic-account",
                  balances: { current: 42, iso_currency_code: "USD" },
                  name: "Atomic checking",
                  official_name: null,
                },
              ],
            });
          default:
            return Response.json({}, { status: 404 });
        }
      },
      secret: "secret",
    });
    const service = createFinanceService({
      db: database.db,
      encryptionKey: key,
      now: () => now,
      plaid,
    });
    const context = {
      principal: financePrincipal(atomicUserId),
      requestId: "atomic-plaid-connect",
    };
    await database.pool.query(`
      CREATE FUNCTION fail_atomic_provider_item() RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'forced Provider Item persistence failure';
      END;
      $$ LANGUAGE plpgsql;
      CREATE TRIGGER fail_atomic_provider_item
      BEFORE INSERT ON finance_provider_items
      FOR EACH ROW EXECUTE FUNCTION fail_atomic_provider_item();
    `);
    try {
      await expect(
        service.exchangePlaidToken(
          { institution: "Atomic Bank", publicToken: "atomic-public-token" },
          context,
        ),
      ).rejects.toThrow();
    } finally {
      await database.pool.query(`
        DROP TRIGGER fail_atomic_provider_item ON finance_provider_items;
        DROP FUNCTION fail_atomic_provider_item();
      `);
    }
    await expect(
      database.db
        .select()
        .from(financeCategories)
        .where(eq(financeCategories.userId, atomicUserId)),
    ).resolves.toHaveLength(0);
    await expect(
      database.db.select().from(financeAccounts).where(eq(financeAccounts.userId, atomicUserId)),
    ).resolves.toHaveLength(0);

    await expect(
      service.exchangePlaidToken(
        { institution: "Atomic Bank", publicToken: "atomic-public-token" },
        context,
      ),
    ).resolves.toHaveLength(1);
    await expect(
      database.db
        .select()
        .from(financeCategories)
        .where(eq(financeCategories.userId, atomicUserId)),
    ).resolves.toHaveLength(20);
    await expect(
      database.db
        .select()
        .from(financeProviderItems)
        .where(eq(financeProviderItems.userId, atomicUserId)),
    ).resolves.toHaveLength(1);
    await expect(
      database.db.select().from(financeAccounts).where(eq(financeAccounts.userId, atomicUserId)),
    ).resolves.toHaveLength(1);
    await expect(
      database.db.select().from(auditEvents).where(eq(auditEvents.userId, atomicUserId)),
    ).resolves.toHaveLength(1);
    await database.db.delete(users).where(eq(users.id, atomicUserId));
  });

  it("completes a partial default taxonomy under concurrent reconciliation", async () => {
    const partialUserId = crypto.randomUUID();
    await database.db.insert(users).values({
      id: partialUserId,
      displayName: "Partial taxonomy",
      email: `partial-taxonomy-${partialUserId}@example.com`,
      passwordHash: "unused",
      planningTimezone: "UTC",
    });
    await database.db.insert(financeAccounts).values({
      institution: "Partial Bank",
      name: "Partial checking",
      provider: "manual",
      status: "manual",
      userId: partialUserId,
    });
    await database.db.insert(financeCategories).values({
      group: "Spending",
      isSystem: true,
      name: "Groceries",
      slug: "groceries",
      userId: partialUserId,
    });
    const service = createFinanceService({ db: database.db, now: () => now });

    await expect(
      Promise.all([
        service.reconcileTransfers(partialUserId),
        service.reconcileTransfers(partialUserId),
      ]),
    ).resolves.toEqual([
      { paired: 0, transfers: 0 },
      { paired: 0, transfers: 0 },
    ]);
    const categories = await database.db
      .select()
      .from(financeCategories)
      .where(eq(financeCategories.userId, partialUserId));
    expect(categories).toHaveLength(21);
    expect(new Set(categories.map((category) => category.slug)).size).toBe(21);
  });

  it("records merchant merge intent without exposing the supplied rationale", async () => {
    const service = createFinanceService({ db: database.db, now: () => now });
    const context = { principal: financePrincipal(userId), requestId: "merchant-merge-audit" };
    const account = await service.createAccount(
      {
        balance: 100,
        institution: "Merge audit",
        name: "Merge audit wallet",
        provider: "manual",
      },
      context,
    );
    const sourceTransaction = await service.createTransaction(
      {
        accountId: account.id,
        amount: 5,
        category: null,
        categoryConfidence: null,
        date: "2026-07-19",
        direction: "expense",
        merchant: "Merge Audit Source",
        notes: null,
      },
      context,
    );
    await service.updateTransaction(
      sourceTransaction.id,
      { category: "Shopping", learnMerchant: false },
      context,
    );
    await service.createTransaction(
      {
        accountId: account.id,
        amount: 7,
        category: null,
        categoryConfidence: null,
        date: "2026-07-19",
        direction: "expense",
        merchant: "Merge Audit Target",
        notes: null,
      },
      context,
    );
    const merchants = await service.listMerchants(userId, 200);
    const source = merchants.find((item) => item.displayName === "Merge Audit Source");
    const target = merchants.find((item) => item.displayName === "Merge Audit Target");
    if (!source || !target) throw new Error("Merchant merge fixtures were not created.");

    const rationale = "The private receipt confirms these are the same merchant.";
    await service.mergeMerchants(
      {
        rationale,
        sourceMerchantId: source.id,
        targetMerchantId: target.id,
      },
      context,
    );

    const [event] = await database.db
      .select({ after: auditEvents.after, before: auditEvents.before })
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.action, "finance.merchants_merged"),
          eq(auditEvents.entityId, target.id),
        ),
      );
    expect(event).toEqual({
      after: {
        rationaleProvided: true,
        sourceMerchantId: source.id,
        targetMerchantId: target.id,
      },
      before: {
        id: source.id,
        isUserConfirmed: false,
      },
    });
    expect(JSON.stringify(event)).not.toContain(rationale);
    const sourceDecisions = await database.db
      .select()
      .from(financeClassificationDecisions)
      .where(eq(financeClassificationDecisions.transactionId, sourceTransaction.id));
    expect(sourceDecisions).toHaveLength(1);
    expect(sourceDecisions[0]?.merchantId).toBe(target.id);
  });

  it("keeps tied merchant evidence non-actionable until one category has more confirmations", async () => {
    const service = createFinanceService({ db: database.db, now: () => now });
    const context = { principal: financePrincipal(userId), requestId: "merchant-evidence-tie" };
    const account = await service.createAccount(
      { balance: 100, institution: "Tie Bank", name: "Tie wallet", provider: "manual" },
      context,
    );
    const confirm = async (category: string) => {
      const transaction = await service.createTransaction(
        {
          accountId: account.id,
          amount: 5,
          category: null,
          categoryConfidence: null,
          date: "2026-07-19",
          direction: "expense",
          merchant: "Evidence Tie Merchant",
          notes: null,
        },
        context,
      );
      await service.updateTransaction(transaction.id, { category, learnMerchant: false }, context);
    };
    await confirm("Shopping");
    await confirm("Dining");
    const tiedCandidate = await service.createTransaction(
      {
        accountId: account.id,
        amount: 7,
        category: null,
        categoryConfidence: null,
        date: "2026-07-20",
        direction: "expense",
        merchant: "Evidence Tie Merchant",
        notes: null,
      },
      context,
    );
    const tiedProposal = (
      await service.proposeCategorizations(userId, {
        limit: 50,
        review: "needs_review",
      })
    ).items.find((proposal) => proposal.transaction.id === tiedCandidate.id);
    expect(tiedProposal).toMatchObject({
      confidence: 0,
      meetsPolicyThreshold: false,
      suggestedCategory: null,
    });

    await confirm("Shopping");
    const winningCandidate = await service.createTransaction(
      {
        accountId: account.id,
        amount: 9,
        category: null,
        categoryConfidence: null,
        date: "2026-07-21",
        direction: "expense",
        merchant: "Evidence Tie Merchant",
        notes: null,
      },
      context,
    );
    const winningProposal = (
      await service.proposeCategorizations(userId, {
        limit: 50,
        review: "needs_review",
      })
    ).items.find((proposal) => proposal.transaction.id === winningCandidate.id);
    expect(winningProposal).toMatchObject({
      meetsPolicyThreshold: true,
      suggestedCategory: expect.objectContaining({ name: "Shopping" }),
    });
  });

  it("questions unpaired vault moves, matches card payments, and preserves rent spending", async () => {
    let reconciliationNow = now;
    const service = createFinanceService({ db: database.db, now: () => reconciliationNow });
    const context = { principal: financePrincipal(userId), requestId: "transfer-reconciliation" };
    const cash = await service.createAccount(
      { balance: 2000, institution: "SoFi", kind: "cash", name: "Checking", provider: "manual" },
      context,
    );
    const card = await service.createAccount(
      { balance: -500, institution: "Card", kind: "debt", name: "Credit card", provider: "manual" },
      context,
    );
    const vault = await service.createTransaction(
      {
        accountId: cash.id,
        amount: 500,
        category: "RENT_AND_UTILITIES",
        categoryConfidence: null,
        date: "2026-07-18",
        direction: "expense",
        merchant: "To Rent Vault",
        notes: null,
      },
      context,
    );
    const rent = await service.createTransaction(
      {
        accountId: cash.id,
        amount: 1500,
        category: null,
        categoryConfidence: null,
        date: "2026-07-18",
        direction: "expense",
        merchant: "Lee Tackman",
        notes: null,
      },
      context,
    );
    const payment = await service.createTransaction(
      {
        accountId: cash.id,
        amount: 200,
        category: "LOAN_PAYMENTS",
        categoryConfidence: null,
        date: "2026-07-18",
        direction: "expense",
        merchant: "AMEX EPAYMENT",
        notes: null,
      },
      context,
    );
    const cardPayment = await service.createTransaction(
      {
        accountId: card.id,
        amount: 200,
        category: "LOAN_PAYMENTS",
        categoryConfidence: null,
        date: "2026-07-19",
        direction: "income",
        merchant: "AUTOPAY PAYMENT - THANK YOU",
        notes: null,
      },
      context,
    );
    await database.db
      .update(financeTransactions)
      .set({ categoryDecidedAt: null, categorySource: "provider" })
      .where(inArray(financeTransactions.id, [vault.id, payment.id, cardPayment.id]));
    await database.db
      .update(financeTransactions)
      .set({ currencyCode: "USD" })
      .where(inArray(financeTransactions.id, [payment.id, cardPayment.id]));

    await expect(service.reconcileTransfers(userId)).resolves.toEqual({ paired: 1, transfers: 2 });
    const transactions = await service.listTransactions(userId, { limit: 200, review: "all" });
    expect(transactions.items.find((item) => item.id === vault.id)).toMatchObject({
      direction: "expense",
      needsReview: true,
      reconciliationStatus: "candidate",
    });
    expect(transactions.items.find((item) => item.id === payment.id)).toMatchObject({
      category: "Transfers",
      direction: "transfer",
    });
    expect(transactions.items.find((item) => item.id === cardPayment.id)).toMatchObject({
      category: "Transfers",
      direction: "transfer",
    });
    const categorizedRent = transactions.items.find((item) => item.id === rent.id);
    expect(categorizedRent).toMatchObject({
      category: "RENT_AND_UTILITIES",
      direction: "expense",
    });
    reconciliationNow = new Date(now.getTime() + 60_000);
    await expect(service.reconcileTransfers(userId)).resolves.toEqual({ paired: 0, transfers: 0 });
    expect(
      (await service.listTransactions(userId, { limit: 200, review: "all" })).items.find(
        (item) => item.id === rent.id,
      )?.updatedAt,
    ).toBe(categorizedRent?.updatedAt);
    const secondPayment = await service.createTransaction(
      {
        accountId: cash.id,
        amount: 325,
        category: "LOAN_PAYMENTS",
        categoryConfidence: null,
        date: "2026-07-20",
        direction: "expense",
        merchant: "AMEX EPAYMENT",
        notes: null,
      },
      context,
    );
    const secondCardPayment = await service.createTransaction(
      {
        accountId: card.id,
        amount: 325,
        category: "LOAN_PAYMENTS",
        categoryConfidence: null,
        date: "2026-07-20",
        direction: "income",
        merchant: "AUTOPAY PAYMENT - THANK YOU",
        notes: null,
      },
      context,
    );
    await database.db
      .update(financeTransactions)
      .set({ categoryDecidedAt: null, categorySource: "provider" })
      .where(inArray(financeTransactions.id, [secondPayment.id, secondCardPayment.id]));
    await database.db
      .update(financeTransactions)
      .set({ currencyCode: "USD" })
      .where(inArray(financeTransactions.id, [secondPayment.id, secondCardPayment.id]));
    const concurrentReconciliations = await Promise.all([
      service.reconcileTransfers(userId),
      service.reconcileTransfers(userId),
    ]);
    expect(concurrentReconciliations.reduce((sum, result) => sum + result.paired, 0)).toBe(1);
    const concurrentlyMatched = await database.db
      .select({
        reconciliationStatus: financeTransactions.reconciliationStatus,
        transferGroupId: financeTransactions.transferGroupId,
      })
      .from(financeTransactions)
      .where(inArray(financeTransactions.id, [secondPayment.id, secondCardPayment.id]));
    expect(concurrentlyMatched).toHaveLength(2);
    expect(concurrentlyMatched[0]?.transferGroupId).toBeTruthy();
    expect(concurrentlyMatched[1]?.transferGroupId).toBe(concurrentlyMatched[0]?.transferGroupId);
    expect(concurrentlyMatched.every((item) => item.reconciliationStatus === "matched")).toBe(true);
    const currencyOut = await service.createTransaction(
      {
        accountId: cash.id,
        amount: 777,
        category: "LOAN_PAYMENTS",
        categoryConfidence: null,
        date: "2026-07-22",
        direction: "expense",
        merchant: "CARD PAYMENT",
        notes: null,
      },
      context,
    );
    const currencyIn = await service.createTransaction(
      {
        accountId: card.id,
        amount: 777,
        category: "LOAN_PAYMENTS",
        categoryConfidence: null,
        date: "2026-07-22",
        direction: "income",
        merchant: "CARD PAYMENT",
        notes: null,
      },
      context,
    );
    await database.db
      .update(financeTransactions)
      .set({ categoryDecidedAt: null, categorySource: "provider", currencyCode: "USD" })
      .where(eq(financeTransactions.id, currencyOut.id));
    await database.db
      .update(financeTransactions)
      .set({ categoryDecidedAt: null, categorySource: "provider", currencyCode: "EUR" })
      .where(eq(financeTransactions.id, currencyIn.id));
    await expect(service.reconcileTransfers(userId)).resolves.toEqual({ paired: 0, transfers: 0 });
    await expect(
      database.db
        .select({ reconciliationStatus: financeTransactions.reconciliationStatus })
        .from(financeTransactions)
        .where(inArray(financeTransactions.id, [currencyOut.id, currencyIn.id])),
    ).resolves.toEqual([
      { reconciliationStatus: "candidate" },
      { reconciliationStatus: "candidate" },
    ]);
    await Promise.all([
      service.reconcileTransfers(userId),
      service.updateTransaction(rent.id, { category: "Shopping", learnMerchant: false }, context),
    ]);
    expect(
      (await service.listTransactions(userId, { limit: 200, review: "all" })).items.find(
        (item) => item.id === rent.id,
      ),
    ).toMatchObject({
      category: "Shopping",
      categorySource: "user",
      direction: "expense",
    });
    const unrelatedTransactionLock = await database.pool.connect();
    let reconciliation: ReturnType<typeof service.reconcileTransfers> | undefined;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      await unrelatedTransactionLock.query("BEGIN");
      await unrelatedTransactionLock.query(
        "SELECT id FROM finance_transactions WHERE id = $1 FOR UPDATE",
        [rent.id],
      );
      reconciliation = service.reconcileTransfers(userId);
      await expect(
        Promise.race([
          reconciliation,
          new Promise((_, reject) => {
            timeout = setTimeout(
              () => reject(new Error("Reconciliation waited on an explicit unrelated decision.")),
              1_000,
            );
          }),
        ]),
      ).resolves.toEqual(expect.objectContaining({ paired: 0 }));
    } finally {
      if (timeout) clearTimeout(timeout);
      await unrelatedTransactionLock.query("ROLLBACK");
      unrelatedTransactionLock.release();
      if (reconciliation) await Promise.allSettled([reconciliation]);
    }
  });

  it("uses posted net spending, preserves refunds, and exposes complete ledger health and export data", async () => {
    const [integrityUser] = await database.db
      .insert(users)
      .values({
        displayName: "Integrity",
        email: "integrity@example.com",
        passwordHash: "unused",
        planningTimezone: "UTC",
      })
      .returning();
    if (!integrityUser) throw new Error("Integrity user was not created.");
    const integrityId = integrityUser.id;
    const service = createFinanceService({ db: database.db, now: () => now });
    const context = { principal: financePrincipal(integrityId), requestId: "ledger-integrity" };
    const account = await service.createAccount(
      { balance: 1000, institution: "Test bank", name: "Checking", provider: "manual" },
      context,
    );
    await service.createTransaction(
      {
        accountId: account.id,
        amount: 100,
        category: "Shopping",
        categoryConfidence: null,
        date: "2026-07-10",
        direction: "expense",
        merchant: "Store",
        notes: null,
      },
      context,
    );
    await service.createTransaction(
      {
        accountId: account.id,
        amount: 20,
        category: "Shopping",
        categoryConfidence: null,
        date: "2026-07-11",
        direction: "income",
        merchant: "Store refund",
        notes: null,
      },
      context,
    );
    await service.createTransaction(
      {
        accountId: account.id,
        amount: 1,
        category: null,
        categoryConfidence: null,
        date: "2026-07-12",
        direction: "transfer",
        merchant: "12345",
        notes: null,
      },
      context,
    );
    await service.createBudget({ category: "Shopping", limit: 90, month: "2026-07" }, context);

    await expect(service.getBudgetStatus(integrityId, "2026-07")).resolves.toEqual([
      expect.objectContaining({ remaining: 10, spent: 80 }),
    ]);
    await expect(service.listOverview(integrityId, "2026-07")).resolves.toMatchObject({
      pendingSpendThisMonth: 0,
      refundCreditsThisMonth: 20,
      spendingThisMonth: 80,
    });
    await expect(service.getLedgerHealth(integrityId)).resolves.toMatchObject({
      balanceOnlyAccounts: 0,
      pendingTransactions: 0,
    });
    await expect(service.exportData(integrityId)).resolves.toMatchObject({
      accounts: [expect.objectContaining({ id: account.id })],
      transactions: expect.arrayContaining([
        expect.objectContaining({ merchant: "12345" }),
        expect.objectContaining({ merchant: "Store" }),
        expect.objectContaining({ merchant: "Store Refund" }),
      ]),
    });
  });

  it("builds an individual cash-flow profile, conservative paycheck stream, and high-confidence subscription", async () => {
    const userId = crypto.randomUUID();
    await database.db.insert(users).values({
      id: userId,
      displayName: "Cash flow",
      email: `cash-${userId}@example.com`,
      passwordHash: "hash",
      planningTimezone: "UTC",
    });
    const context = { principal: financePrincipal(userId), requestId: "cashflow" };
    const service = createFinanceService({ db: database.db, now: () => now });
    const account = await service.createAccount(
      { balance: 5_000, institution: "Bank", kind: "cash", name: "Checking", provider: "manual" },
      context,
    );
    await service.updateProfile(
      {
        effectiveDate: "2026-07-01",
        employer: "Acme",
        employmentType: "full_time",
        expectedNetPay: 2_500,
        grossAnnualIncome: 130_000,
        nextPayday: "2026-07-31",
        payAccountId: account.id,
        payFrequency: "biweekly",
        role: "Engineer",
      },
      context,
    );
    for (const date of ["2026-06-05", "2026-06-19", "2026-07-03", "2026-07-17"]) {
      await service.createTransaction(
        {
          accountId: account.id,
          amount: 2_500,
          category: "INCOME",
          categoryConfidence: 1,
          date,
          direction: "income",
          merchant: "Acme Payroll",
          notes: null,
        },
        context,
      );
    }
    for (const date of ["2026-04-15", "2026-05-15", "2026-06-15", "2026-07-15"]) {
      await service.createTransaction(
        {
          accountId: account.id,
          amount: 15.49,
          category: "Subscriptions",
          categoryConfidence: 1,
          date,
          direction: "expense",
          merchant: "Netflix",
          notes: null,
        },
        context,
      );
    }
    await service.updateProfile(
      {
        effectiveDate: "2026-08-01",
        employer: "Future employer",
        employmentType: "full_time",
        expectedNetPay: 3_000,
        grossAnnualIncome: 156_000,
        nextPayday: "2026-08-14",
        payAccountId: account.id,
        payFrequency: "biweekly",
        role: "Staff Engineer",
      },
      context,
    );
    await expect(service.getProfile(userId)).resolves.toMatchObject({
      employer: "Acme",
      expectedNetPay: 2_500,
      grossAnnualIncome: 130_000,
      payFrequency: "biweekly",
    });
    await expect(service.listIncomeStreams(userId)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          displayName: "Acme Payroll",
          expectedAmount: 2_500,
          status: "active",
        }),
      ]),
    );
    await expect(service.listRecurringObligations(userId)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ displayName: "Netflix", kind: "subscription", status: "active" }),
      ]),
    );
    await expect(service.getForecast(userId)).resolves.toMatchObject({
      upcomingIncome: 2_500,
      upcomingObligations: 0,
    });
    await expect(service.getWealthSummary(userId)).resolves.toMatchObject({
      annualIncome: 130_000,
      incomeBasis: "stated",
      observedAnnualIncome: 10_000,
      statedAnnualIncome: 130_000,
    });
    await expect(service.exportData(userId)).resolves.toMatchObject({
      profile: expect.objectContaining({ employer: "Acme" }),
      incomeStreams: expect.arrayContaining([
        expect.objectContaining({ displayName: "Acme Payroll" }),
      ]),
      recurringObligations: expect.arrayContaining([
        expect.objectContaining({ displayName: "Netflix" }),
      ]),
    });
    await database.db.delete(financeIncomeStreams).where(eq(financeIncomeStreams.userId, userId));
    await database.db
      .delete(financeRecurringObligations)
      .where(eq(financeRecurringObligations.userId, userId));
    const runId = crypto.randomUUID();
    const claimId = crypto.randomUUID();
    await database.db.insert(workspaceMaintenanceRuns).values({
      domain: "finances",
      id: runId,
      leaseClaimId: claimId,
      leaseExpiresAt: new Date(Date.now() + 60_000),
      rulebookVersion: "rules:v1",
      scope: { type: "all_outstanding" },
      status: "running",
      userId,
    });
    let healthNow = now;
    const healthService = createFinanceService({ db: database.db, now: () => healthNow });
    const maintenanceContext = {
      maintenance: {
        idempotencyKey: "finances:rules:v1:health",
        policy: "approved_rule" as const,
        rulebookVersion: "rules:v1",
        runId,
      },
      maintenanceClaim: { claimId, runId },
      principal: financeAgentPrincipal(userId),
      requestId: `maintenance:${runId}:health`,
    };
    await healthService.refreshCashflowForUser(
      userId,
      { type: "all_outstanding" },
      maintenanceContext,
      async () => {},
    );
    const firstHealthRows = await database.pool.query(
      `SELECT id, updated_at FROM finance_income_streams WHERE user_id = $1
       UNION ALL
       SELECT id, updated_at FROM finance_recurring_obligations WHERE user_id = $1
       ORDER BY id`,
      [userId],
    );
    const firstHealthAudits = await database.db
      .select({ action: auditEvents.action, after: auditEvents.after })
      .from(auditEvents)
      .where(eq(auditEvents.requestId, maintenanceContext.requestId));
    expect(firstHealthAudits.map((item) => item.action).sort()).toEqual([
      "finance.income_stream_refreshed",
      "finance.recurring_refreshed",
    ]);
    for (const audit of firstHealthAudits) {
      expect(audit.after).toMatchObject({
        maintenance: maintenanceContext.maintenance,
        source: { revision: expect.any(String), sourceType: "finance_transaction" },
      });
    }
    healthNow = new Date("2026-07-19T12:01:00.000Z");
    await healthService.refreshCashflowForUser(
      userId,
      { type: "all_outstanding" },
      maintenanceContext,
      async () => {},
    );
    await expect(
      database.pool.query(
        `SELECT id, updated_at FROM finance_income_streams WHERE user_id = $1
         UNION ALL
         SELECT id, updated_at FROM finance_recurring_obligations WHERE user_id = $1
         ORDER BY id`,
        [userId],
      ),
    ).resolves.toMatchObject({ rows: firstHealthRows.rows });
    await expect(
      database.db
        .select({ id: auditEvents.id })
        .from(auditEvents)
        .where(eq(auditEvents.requestId, maintenanceContext.requestId)),
    ).resolves.toHaveLength(2);
    healthNow = new Date("2026-09-01T12:00:00.000Z");
    await healthService.refreshCashflowForUser(
      userId,
      { type: "all_outstanding" },
      maintenanceContext,
      async () => {},
    );
    const healthActionsAfterAlerts = await database.db
      .select({ action: auditEvents.action })
      .from(auditEvents)
      .where(eq(auditEvents.requestId, maintenanceContext.requestId));
    expect(healthActionsAfterAlerts.map((item) => item.action).sort()).toEqual([
      "finance.alert_queued",
      "finance.alert_queued",
      "finance.income_stream_refreshed",
      "finance.recurring_refreshed",
    ]);
    healthNow = new Date("2026-09-01T12:01:00.000Z");
    await healthService.refreshCashflowForUser(
      userId,
      { type: "all_outstanding" },
      maintenanceContext,
      async () => {},
    );
    await expect(
      database.db
        .select({ id: auditEvents.id })
        .from(auditEvents)
        .where(eq(auditEvents.requestId, maintenanceContext.requestId)),
    ).resolves.toHaveLength(4);
    await database.db.insert(financeTransactions).values([
      ...["2026-07-31", "2026-08-14", "2026-08-28"].map((transactionDate) => ({
        accountId: account.id,
        amount: 250_000,
        category: "INCOME",
        direction: "income" as const,
        merchant: "Acme Payroll",
        needsReview: false,
        pending: false,
        reconciliationStatus: "not_applicable" as const,
        transactionDate,
        userId,
      })),
      {
        accountId: account.id,
        amount: 1_549,
        category: "Subscriptions",
        direction: "expense",
        merchant: "Netflix",
        needsReview: false,
        pending: false,
        reconciliationStatus: "not_applicable",
        transactionDate: "2026-08-15",
        userId,
      },
    ]);
    healthNow = new Date("2026-09-02T12:00:00.000Z");
    await healthService.refreshCashflowForUser(
      userId,
      { type: "all_outstanding" },
      maintenanceContext,
      async () => {},
    );
    const healthActionsAfterRecovery = await database.db
      .select({ action: auditEvents.action })
      .from(auditEvents)
      .where(eq(auditEvents.requestId, maintenanceContext.requestId));
    expect(healthActionsAfterRecovery.map((item) => item.action).sort()).toEqual([
      "finance.alert_queued",
      "finance.alert_queued",
      "finance.alert_resolved",
      "finance.alert_resolved",
      "finance.income_stream_refreshed",
      "finance.income_stream_refreshed",
      "finance.recurring_refreshed",
      "finance.recurring_refreshed",
    ]);
    healthNow = new Date("2026-09-02T12:01:00.000Z");
    await healthService.refreshCashflowForUser(
      userId,
      { type: "all_outstanding" },
      maintenanceContext,
      async () => {},
    );
    await expect(
      database.db
        .select({ id: auditEvents.id })
        .from(auditEvents)
        .where(eq(auditEvents.requestId, maintenanceContext.requestId)),
    ).resolves.toHaveLength(8);
    const [incomeStream] = await service.listIncomeStreams(userId);
    const [recurring] = await service.listRecurringObligations(userId);
    if (!incomeStream || !recurring) throw new Error("Cash-flow patterns were not inferred.");
    await expect(
      service.updateIncomeStream(incomeStream.id, { status: "paused" }, context),
    ).resolves.toMatchObject({ source: "user", status: "paused" });
    await expect(
      service.updateIncomeStream(incomeStream.id, { status: "active" }, context),
    ).resolves.toMatchObject({ status: "active" });
    await expect(
      service.updateRecurringObligation(recurring.id, { status: "paused" }, context),
    ).resolves.toMatchObject({ source: "user", status: "paused" });
    await expect(
      service.updateRecurringObligation(recurring.id, { status: "active" }, context),
    ).resolves.toMatchObject({ status: "active" });
    await expect(service.refreshCashflowInsights(userId)).resolves.toEqual({ refreshed: true });
    await database.db.insert(financeAlerts).values({
      body: "A paycheck was different from its expected amount.",
      evidence: {},
      severity: "warning",
      title: "Expected income changed",
      type: "income_changed",
      userId,
    });
    const [alert] = await service.listAlerts(userId);
    if (!alert) throw new Error("Fixture alert was not created.");
    await expect(
      service.resolveAlert(
        alert.id,
        { action: "resolve", rationale: "Pay change confirmed." },
        context,
      ),
    ).resolves.toMatchObject({ status: "resolved" });
    await expect(service.backfillCashflowInsights()).resolves.toMatchObject({
      processed: expect.any(Number),
    });
  });

  it("audits manual cashflow alert creation and resolution from stable configured-record evidence", async () => {
    const userId = crypto.randomUUID();
    await database.db.insert(users).values({
      id: userId,
      displayName: "Configured cashflow evidence",
      email: `configured-cashflow-${userId}@example.com`,
      passwordHash: "unused",
      planningTimezone: "UTC",
    });
    const service = createFinanceService({ db: database.db, now: () => now });
    const account = await service.createAccount(
      { balance: 0, institution: "Manual", kind: "cash", name: "Checking", provider: "manual" },
      { principal: financePrincipal(userId), requestId: "configured-cashflow-account" },
    );
    const [stream] = await database.db
      .insert(financeIncomeStreams)
      .values({
        accountId: account.id,
        amountTolerance: 10_000,
        cadence: "monthly",
        confidence: 10_000,
        displayName: "Configured paycheck",
        expectedAmount: 250_000,
        nextExpectedDate: "2026-07-01",
        payer: "Configured employer",
        source: "user",
        status: "active",
        userId,
      })
      .returning();
    const [obligation] = await database.db
      .insert(financeRecurringObligations)
      .values({
        accountId: account.id,
        amountTolerance: 500,
        cadence: "monthly",
        confidence: 10_000,
        displayName: "Configured bill",
        expectedAmount: 12_000,
        kind: "bill",
        merchant: "Configured utility",
        nextExpectedDate: "2026-07-01",
        source: "user",
        status: "active",
        userId,
      })
      .returning();
    if (!stream || !obligation) throw new Error("Configured cashflow fixtures were not created.");
    const runId = crypto.randomUUID();
    const claimId = crypto.randomUUID();
    await database.db.insert(workspaceMaintenanceRuns).values({
      domain: "finances",
      id: runId,
      leaseClaimId: claimId,
      leaseExpiresAt: new Date(Date.now() + 60_000),
      rulebookVersion: "rules:v1",
      scope: { type: "all_outstanding" },
      status: "running",
      userId,
    });
    const maintenanceContext = {
      maintenance: {
        idempotencyKey: "finances:rules:v1:health",
        policy: "approved_rule" as const,
        rulebookVersion: "rules:v1",
        runId,
      },
      maintenanceClaim: { claimId, runId },
      principal: financeAgentPrincipal(userId),
      requestId: `maintenance:${runId}:health`,
    };

    await service.refreshCashflowForUser(userId, { type: "all_outstanding" }, maintenanceContext);
    await expect(
      database.db
        .select({ action: auditEvents.action, after: auditEvents.after })
        .from(auditEvents)
        .where(eq(auditEvents.requestId, maintenanceContext.requestId)),
    ).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "finance.alert_queued",
          after: expect.objectContaining({
            source: expect.objectContaining({
              provider: "local",
              remoteId: stream.id,
              sourceType: "finance_income_stream",
            }),
          }),
        }),
        expect.objectContaining({
          action: "finance.alert_queued",
          after: expect.objectContaining({
            source: expect.objectContaining({
              provider: "local",
              remoteId: obligation.id,
              sourceType: "finance_recurring_obligation",
            }),
          }),
        }),
      ]),
    );
    await service.refreshCashflowForUser(userId, { type: "all_outstanding" }, maintenanceContext);
    await expect(
      database.db
        .select({ id: auditEvents.id })
        .from(auditEvents)
        .where(eq(auditEvents.requestId, maintenanceContext.requestId)),
    ).resolves.toHaveLength(2);

    await database.db
      .update(financeIncomeStreams)
      .set({ nextExpectedDate: "2026-08-01", updatedAt: new Date(now.getTime() + 1_000) })
      .where(eq(financeIncomeStreams.id, stream.id));
    await database.db
      .update(financeRecurringObligations)
      .set({ nextExpectedDate: "2026-08-01", updatedAt: new Date(now.getTime() + 1_000) })
      .where(eq(financeRecurringObligations.id, obligation.id));
    await service.refreshCashflowForUser(userId, { type: "all_outstanding" }, maintenanceContext);
    const resolvedAudits = await database.db
      .select({ action: auditEvents.action, after: auditEvents.after })
      .from(auditEvents)
      .where(eq(auditEvents.requestId, maintenanceContext.requestId));
    expect(resolvedAudits.filter((item) => item.action === "finance.alert_resolved")).toEqual([
      expect.objectContaining({
        after: expect.objectContaining({
          source: expect.objectContaining({ sourceType: "finance_income_stream" }),
        }),
      }),
      expect.objectContaining({
        after: expect.objectContaining({
          source: expect.objectContaining({ sourceType: "finance_recurring_obligation" }),
        }),
      }),
    ]);
    await service.refreshCashflowForUser(userId, { type: "all_outstanding" }, maintenanceContext);
    await expect(
      database.db
        .select({ id: auditEvents.id })
        .from(auditEvents)
        .where(eq(auditEvents.requestId, maintenanceContext.requestId)),
    ).resolves.toHaveLength(4);
  });

  it("calculates budget pace across complete display periods with neutral blank cells", async () => {
    const userId = crypto.randomUUID();
    await database.db.insert(users).values({
      id: userId,
      displayName: "Budget pace",
      email: `pace-${userId}@example.com`,
      passwordHash: "hash",
      planningTimezone: "UTC",
    });
    const context = { principal: financePrincipal(userId), requestId: "budget-pace" };
    const service = createFinanceService({ db: database.db, now: () => now });
    const account = await service.createAccount(
      { balance: 5_000, institution: "Bank", kind: "cash", name: "Checking", provider: "manual" },
      context,
    );
    await service.createBudget({ category: "Dining", limit: 310, month: "2026-07" }, context);
    for (const [date, amount] of [
      ["2026-07-01", 100],
      ["2026-07-19", 150],
    ] as const) {
      await service.createTransaction(
        {
          accountId: account.id,
          amount,
          category: "Dining",
          categoryConfidence: 1,
          date,
          direction: "expense",
          merchant: `Dining ${date}`,
          notes: null,
        },
        context,
      );
    }
    const [weekPace, monthPace, yearPace] = await Promise.all([
      service.getBudgetPace(userId, "week"),
      service.getBudgetPace(userId, "month"),
      service.getBudgetPace(userId, "year"),
    ]);

    expect(weekPace).toMatchObject({
      asOf: "2026-07-19",
      cells: expect.arrayContaining([
        expect.objectContaining({
          date: "2026-07-19",
          planned: 190,
          spent: 250,
          status: "behind",
        }),
        expect.objectContaining({
          date: "2026-07-20",
          planned: 0,
          spent: 0,
          status: "blank",
        }),
      ]),
      period: "week",
    });
    expect(weekPace.cells).toHaveLength(7);
    expect(monthPace).toMatchObject({
      asOf: "2026-07-19",
      cells: expect.arrayContaining([
        expect.objectContaining({
          date: "2026-07-18",
          status: "blank",
        }),
        expect.objectContaining({
          date: "2026-07-20",
          planned: 0,
          spent: 0,
          status: "blank",
        }),
      ]),
      period: "month",
    });
    expect(monthPace.cells).toHaveLength(31);
    expect(yearPace).toMatchObject({
      period: "year",
    });
    expect(yearPace.cells).toHaveLength(365);
  });

  it("creates Plaid Link sessions, exchanges tokens, and synchronizes incremental changes", async () => {
    const [plaidOnlyUser] = await database.db
      .insert(users)
      .values({
        displayName: "Plaid Only",
        email: "plaid-only@example.com",
        passwordHash: "unused",
        planningTimezone: "UTC",
      })
      .returning();
    if (!plaidOnlyUser) throw new Error("Plaid-only fixture user was not created.");
    const fetch = plaidFetch();
    const service = createFinanceService({
      db: database.db,
      encryptionKey: key,
      now: () => now,
      plaid: createPlaidConnector({
        clientId: "client",
        environment: "sandbox",
        fetch,
        secret: "secret",
      }),
    });
    const context = {
      principal: financePrincipal(plaidOnlyUser.id),
      requestId: "plaid-finance",
    };
    expect(service.plaidAvailable()).toBe(true);
    await expect(service.createPlaidLinkToken(plaidOnlyUser.id)).resolves.toBe("link-token");
    const accounts = await service.exchangePlaidToken(
      { institution: "Plaid Bank", publicToken: "public-token" },
      context,
    );
    expect(accounts).toHaveLength(2);
    expect(accounts.every((account) => account.currencyCode === "USD")).toBe(true);
    await expect(service.listCategories(plaidOnlyUser.id)).resolves.not.toHaveLength(0);
    const plaidAccount = accounts[0];
    const debtAccount = accounts[1];
    if (!plaidAccount) throw new Error("Plaid checking account was not saved.");
    if (!debtAccount) throw new Error("Plaid debt account was not saved.");
    await database.db
      .update(financeAccounts)
      .set({ kind: "debt" })
      .where(eq(financeAccounts.id, debtAccount.id));
    await expect(service.syncPlaidAccount(plaidAccount.id, context)).resolves.toEqual({
      changed: 4,
    });
    await expect(service.syncDuePlaidAccounts()).resolves.toEqual({
      attempted: 0,
      failed: 0,
      recovered: 0,
      skipped: 0,
      succeeded: 0,
    });
    const [transaction] = await database.db
      .select()
      .from(financeTransactions)
      .where(
        and(
          eq(financeTransactions.providerTransactionId, "pending-txn-1"),
          eq(financeTransactions.userId, plaidOnlyUser.id),
        ),
      );
    expect(transaction).toMatchObject({
      amount: 2200,
      categoryConfidence: 9850,
      currencyCode: "USD",
      direction: "expense",
      needsReview: false,
      pending: true,
      pendingTransactionId: null,
      providerCategory: "FOOD_AND_DRINK",
      providerCategoryConfidence: "VERY_HIGH",
    });
    if (!transaction) throw new Error("The pending Plaid transaction was not found.");
    const categories = await service.listCategories(plaidOnlyUser.id);
    const shopping = categories.find((category) => category.name === "Shopping");
    if (!shopping) throw new Error("The Shopping category was not seeded.");
    await service.updateTransaction(
      transaction.id,
      { category: "Shopping", learnMerchant: false },
      context,
    );
    const [pendingDecision] = await database.db
      .select({
        category: financeTransactions.category,
        categoryDecidedAt: financeTransactions.categoryDecidedAt,
        categoryRationale: financeTransactions.categoryRationale,
        categorySource: financeTransactions.categorySource,
      })
      .from(financeTransactions)
      .where(eq(financeTransactions.id, transaction.id));
    await expect(service.syncPlaidAccount(plaidAccount.id, context)).resolves.toEqual({
      changed: 4,
    });
    const postedTransaction = (
      await service.listTransactions(plaidOnlyUser.id, {
        limit: 20,
        review: "all",
        sortBy: "date",
        sortDirection: "desc",
      })
    ).items.find((item) => item.id === transaction?.id);
    if (!postedTransaction) throw new Error("The posted Plaid transaction was not found.");
    expect(postedTransaction).toMatchObject({
      category: "Shopping",
      categorySource: "user",
      pending: false,
    });
    await expect(
      database.db
        .select({
          category: financeTransactions.category,
          categoryDecidedAt: financeTransactions.categoryDecidedAt,
          categoryRationale: financeTransactions.categoryRationale,
          categorySource: financeTransactions.categorySource,
        })
        .from(financeTransactions)
        .where(eq(financeTransactions.id, postedTransaction.id)),
    ).resolves.toEqual([pendingDecision]);
    const transferReviews = (await service.listReviewQueue(plaidOnlyUser.id)).filter(
      (review) => review.reason === "possible_transfer",
    );
    expect(transferReviews).toHaveLength(3);
    expect(transferReviews.map((review) => review.transaction)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          direction: "income",
          providerDirection: "income",
          reconciliationStatus: "candidate",
        }),
        expect.objectContaining({
          direction: "expense",
          providerDirection: "expense",
          reconciliationStatus: "candidate",
        }),
      ]),
    );
    expect(transferReviews.every((review) => review.transaction.direction !== "transfer")).toBe(
      true,
    );
    expect(
      transferReviews.find((review) =>
        review.transaction.rawMerchant?.toLowerCase().includes("sofi vault"),
      )?.transaction,
    ).toMatchObject({
      currencyCode: "USD",
      direction: "expense",
      providerDirection: "expense",
      reconciliationStatus: "candidate",
    });
    for (const review of transferReviews) {
      await service.resolveReview(
        review.id,
        {
          action: "recategorize",
          categoryId: shopping.id,
          expectedTransactionUpdatedAt: review.transaction.updatedAt,
          learnMerchant: "never",
          rationale: "The signed provider direction must survive transfer recategorization.",
        },
        context,
      );
    }
    // Simulate the first sync after the online provider-direction migration:
    // legacy rows have no stored provider baseline, so their explicit
    // non-transfer direction is the safe comparison baseline.
    await database.db
      .update(financeTransactions)
      .set({ providerDirection: null })
      .where(eq(financeTransactions.id, postedTransaction.id));
    await expect(service.syncPlaidAccount(plaidAccount.id, context)).resolves.toEqual({
      changed: 4,
    });
    const protectedRows = await database.db
      .select()
      .from(financeTransactions)
      .where(
        and(
          eq(financeTransactions.userId, plaidOnlyUser.id),
          inArray(financeTransactions.providerTransactionId, [
            "txn-1",
            "txn-late-counterpart",
            "txn-late-transfer",
            "txn-transfer-in",
            "txn-transfer-out",
          ]),
        ),
      );
    expect(protectedRows.find((row) => row.providerTransactionId === "txn-1")).toMatchObject({
      amount: 3000,
      category: "Shopping",
      categorySource: "user",
      direction: "income",
      needsReview: true,
      pending: false,
      providerDirection: "income",
      transactionDate: "2026-07-21",
    });
    expect(
      protectedRows.find((row) => row.providerTransactionId === "txn-transfer-in"),
    ).toMatchObject({
      category: "Shopping",
      categorySource: "user",
      direction: "income",
      needsReview: false,
      providerDirection: "income",
      reconciliationStatus: "not_applicable",
      transferGroupId: null,
    });
    expect(
      protectedRows.find((row) => row.providerTransactionId === "txn-transfer-out"),
    ).toMatchObject({
      category: "Shopping",
      categorySource: "user",
      direction: "expense",
      needsReview: false,
      providerDirection: "expense",
      reconciliationStatus: "not_applicable",
      transferGroupId: null,
    });
    expect(
      protectedRows.find((row) => row.providerTransactionId === "txn-late-transfer"),
    ).toMatchObject({
      category: "Shopping",
      categorySource: "user",
      direction: "expense",
      needsReview: false,
      reconciliationStatus: "not_applicable",
      transferGroupId: null,
    });
    expect(
      protectedRows.find((row) => row.providerTransactionId === "txn-late-counterpart"),
    ).toMatchObject({
      direction: "income",
      reconciliationStatus: "candidate",
      transferGroupId: null,
    });
    expect(await service.listReviewQueue(plaidOnlyUser.id)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          reason: "refund_or_reversal",
          transaction: expect.objectContaining({ id: postedTransaction.id }),
        }),
      ]),
    );
    expect(
      (await service.listReviewQueue(plaidOnlyUser.id)).some(
        (review) =>
          review.transaction.id ===
            protectedRows.find((row) => row.providerTransactionId === "txn-transfer-in")?.id ||
          review.transaction.id ===
            protectedRows.find((row) => row.providerTransactionId === "txn-transfer-out")?.id,
      ),
    ).toBe(false);
    const postedDecision = await database.db
      .select()
      .from(financeClassificationDecisions)
      .where(eq(financeClassificationDecisions.transactionId, postedTransaction.id));
    // A pending decision remains protected when the provider posts it, but it
    // does not become durable learning evidence without a posted user action.
    expect(postedDecision).toHaveLength(0);
    const maintenanceRunId = crypto.randomUUID();
    const maintenanceClaimId = crypto.randomUUID();
    await database.db.insert(workspaceMaintenanceRuns).values({
      domain: "finances",
      id: maintenanceRunId,
      leaseClaimId: maintenanceClaimId,
      leaseExpiresAt: new Date(Date.now() + 60_000),
      rulebookVersion: "rules:v1",
      scope: { type: "all_outstanding" },
      status: "running",
      userId: plaidOnlyUser.id,
    });
    const maintenanceContext = {
      maintenance: {
        idempotencyKey: "finances:rules:v1:concurrent-sync-reconcile",
        policy: "approved_rule" as const,
        rulebookVersion: "rules:v1",
        runId: maintenanceRunId,
      },
      maintenanceClaim: { claimId: maintenanceClaimId, runId: maintenanceRunId },
      principal: financeAgentPrincipal(plaidOnlyUser.id),
      requestId: `maintenance:${maintenanceRunId}:reconcile`,
    };
    const blocker = await database.pool.connect();
    let concurrentSync: ReturnType<typeof service.syncPlaidAccount> | undefined;
    let concurrentReconciliation: ReturnType<typeof service.reconcileTransfersForUser> | undefined;
    try {
      await blocker.query("BEGIN");
      await blocker.query("SELECT id FROM finance_transactions WHERE id = $1 FOR UPDATE", [
        postedTransaction.id,
      ]);
      concurrentSync = service.syncPlaidAccount(
        plaidAccount.id,
        maintenanceContext,
        async () => {},
      );
      await waitForLockWaiters(database.pool, 1);
      concurrentReconciliation = service.reconcileTransfersForUser(
        plaidOnlyUser.id,
        { type: "all_outstanding" },
        maintenanceContext,
        async () => {},
      );
      await waitForLockWaiters(database.pool, 2);
      await blocker.query("COMMIT");
      const [syncResult, reconciliationResult] = await Promise.all([
        concurrentSync,
        concurrentReconciliation,
      ]);
      expect(syncResult).toEqual({ changed: 4 });
      expect(reconciliationResult).toEqual({
        paired: expect.any(Number),
        transfers: expect.any(Number),
      });
      await expect(
        database.db
          .select({ claimId: workspaceMaintenanceRuns.leaseClaimId })
          .from(workspaceMaintenanceRuns)
          .where(eq(workspaceMaintenanceRuns.id, maintenanceRunId)),
      ).resolves.toEqual([{ claimId: maintenanceClaimId }]);
    } finally {
      await blocker.query("ROLLBACK");
      blocker.release();
      const pendingOperations: Promise<unknown>[] = [];
      if (concurrentSync) pendingOperations.push(concurrentSync);
      if (concurrentReconciliation) pendingOperations.push(concurrentReconciliation);
      await Promise.allSettled(pendingOperations);
    }
    const amountPage = await service.listTransactions(plaidOnlyUser.id, {
      limit: 1,
      review: "all",
      sortBy: "amount",
      sortDirection: "desc",
    });
    expect(amountPage.items).toHaveLength(1);
    expect(amountPage.nextCursor).toEqual(expect.any(String));
    const nextAmountPage = await service.listTransactions(plaidOnlyUser.id, {
      cursor: amountPage.nextCursor as string,
      limit: 1,
      review: "all",
      sortBy: "amount",
      sortDirection: "desc",
    });
    expect(nextAmountPage.items[0]?.id).not.toBe(amountPage.items[0]?.id);
    await expect(
      service.listTransactions(plaidOnlyUser.id, {
        cursor: amountPage.nextCursor as string,
        limit: 1,
        review: "all",
        sortBy: "date",
        sortDirection: "desc",
      }),
    ).rejects.toThrow("does not match this sort");
    const manual = await service.createAccount(
      { balance: null, institution: "Cash", name: "Emergency", provider: "manual" },
      context,
    );
    await expect(service.syncPlaidAccount(manual.id, context)).rejects.toThrow(
      "not a connected Plaid account",
    );
    const exchangeBlocker = await database.pool.connect();
    let reconnectSync: ReturnType<typeof service.syncPlaidAccount> | undefined;
    let reconnectExchange: ReturnType<typeof service.exchangePlaidToken> | undefined;
    try {
      await exchangeBlocker.query("BEGIN");
      await exchangeBlocker.query("SELECT id FROM finance_accounts WHERE id = $1 FOR UPDATE", [
        plaidAccount.id,
      ]);
      reconnectExchange = service.exchangePlaidToken(
        { institution: null, publicToken: "public-token" },
        context,
      );
      await waitForLockWaiters(database.pool, 1);
      reconnectSync = service.syncPlaidAccount(plaidAccount.id, context);
      void reconnectSync.catch(() => undefined);
      await waitForLockWaiters(database.pool, 2);
      await exchangeBlocker.query("COMMIT");
      await expect(reconnectExchange).resolves.toHaveLength(2);
      await expect(reconnectSync).rejects.toMatchObject({ code: "conflict" });
      const reconnectedAccounts = await database.db
        .select({
          providerItemId: financeAccounts.providerItemId,
          syncCursor: financeAccounts.syncCursor,
        })
        .from(financeAccounts)
        .where(inArray(financeAccounts.id, [plaidAccount.id, debtAccount.id]));
      expect(reconnectedAccounts).toHaveLength(2);
      expect(reconnectedAccounts.every((account) => account.syncCursor === null)).toBe(true);
      expect(new Set(reconnectedAccounts.map((account) => account.providerItemId)).size).toBe(1);
    } finally {
      await exchangeBlocker.query("ROLLBACK");
      exchangeBlocker.release();
      const pendingOperations: Promise<unknown>[] = [];
      if (reconnectSync) pendingOperations.push(reconnectSync);
      if (reconnectExchange) pendingOperations.push(reconnectExchange);
      await Promise.allSettled(pendingOperations);
    }
  });

  it("fences Plaid claims and durably settles classified failures and recovery", async () => {
    const [healthUser] = await database.db
      .insert(users)
      .values({
        displayName: "Plaid Health",
        email: "plaid-health@example.com",
        passwordHash: "unused",
        planningTimezone: "UTC",
      })
      .returning();
    if (!healthUser) throw new Error("Plaid health fixture user was not created.");

    type SyncMode = "authorization" | "configuration" | "deferred" | "rate" | "success";
    let mode: SyncMode = "deferred";
    let releaseDeferredSync: (() => void) | undefined;
    let observeDeferredSync: (() => void) | undefined;
    let deferredSyncCalls = 0;
    const deferredSyncStarted = new Promise<void>((resolvePromise) => {
      observeDeferredSync = resolvePromise;
    });
    const deferredSyncRelease = new Promise<void>((resolvePromise) => {
      releaseDeferredSync = resolvePromise;
    });
    let successfulCursor = 0;
    const fetch = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const requestUrl =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      const path = new URL(requestUrl).pathname;
      if (path === "/item/public_token/exchange") {
        return Response.json({ access_token: "health-token", item_id: "health-item" });
      }
      if (path === "/accounts/get") {
        return Response.json({
          accounts: [
            {
              account_id: "health-account",
              balances: { current: 250 },
              name: "Health checking",
              official_name: null,
            },
            {
              account_id: "health-sibling-account",
              balances: { current: 500 },
              name: "Health savings",
              official_name: null,
            },
          ],
        });
      }
      if (path === "/transactions/sync") {
        if (mode === "deferred") {
          deferredSyncCalls += 1;
          if (deferredSyncCalls === 1) {
            observeDeferredSync?.();
            await deferredSyncRelease;
          }
        }
        if (mode === "configuration") {
          return Response.json(
            {
              error_code: "INVALID_API_KEYS",
              error_message: "raw-configuration-canary",
            },
            { status: 400 },
          );
        }
        if (mode === "rate") {
          return Response.json(
            { error_code: "RATE_LIMIT_EXCEEDED", error_message: "raw-rate-canary" },
            { headers: { "retry-after": "120" }, status: 429 },
          );
        }
        if (mode === "authorization") {
          return Response.json(
            { error_code: "ITEM_LOGIN_REQUIRED", error_message: "raw-auth-canary" },
            { status: 400 },
          );
        }
        successfulCursor += 1;
        return Response.json({
          added: [],
          has_more: false,
          modified: [],
          next_cursor: `health-cursor-${successfulCursor}`,
          removed: [],
          transactions_update_status: "HISTORICAL_UPDATE_COMPLETE",
        });
      }
      return Response.json(
        { error_code: "UNEXPECTED", error_message: "unexpected" },
        { status: 400 },
      );
    });
    const logs = vi.fn();
    const plaid = createPlaidConnector({
      clientId: "client",
      environment: "sandbox",
      fetch,
      secret: "secret",
    });
    const workerOne = createFinanceService({
      db: database.db,
      encryptionKey: key,
      log: logs,
      now: () => now,
      plaid,
    });
    const slowClockWorker = createFinanceService({
      db: database.db,
      encryptionKey: key,
      log: logs,
      now: () => new Date(now.getTime() - 60 * 60_000),
      plaid,
    });
    const fastClockWorker = createFinanceService({
      db: database.db,
      encryptionKey: key,
      log: logs,
      now: () => new Date(now.getTime() + 60 * 60_000),
      plaid,
    });
    const settlementFastClockWorker = createFinanceService({
      db: database.db,
      encryptionKey: key,
      log: logs,
      now: () => new Date(Date.now() + 60 * 60_000),
      plaid,
    });
    const context = {
      principal: financePrincipal(healthUser.id),
      requestId: "plaid-health",
    };
    const connectedHealthAccounts = await workerOne.exchangePlaidToken(
      { institution: "Health Bank", publicToken: "health-public-token" },
      context,
    );
    const [healthSiblingAccount, healthAccount] = [...connectedHealthAccounts].sort((left, right) =>
      left.id.localeCompare(right.id),
    );
    if (!healthAccount) throw new Error("Plaid health account was not created.");
    if (!healthSiblingAccount) throw new Error("Plaid health sibling account was not created.");
    expect(healthAccount.synchronization).toEqual({
      failureCode: null,
      failureCount: 0,
      lastAttemptAt: null,
      lastSuccessAt: null,
      message: null,
      nextRetryAt: null,
      recovery: null,
      state: "stale",
    });

    await database.pool.query(
      `UPDATE finance_provider_items
       SET next_sync_at = $2
       WHERE id <> (SELECT provider_item_record_id FROM finance_accounts WHERE id = $1)
         AND next_sync_at <= $3`,
      [healthAccount.id, new Date(now.getTime() + 24 * 60 * 60_000), now],
    );
    const firstPass = slowClockWorker.syncPlaidAccount(healthAccount.id, context);
    await Promise.race([
      deferredSyncStarted,
      firstPass.then((result) => {
        throw new Error(
          `First Plaid health pass settled before provider call: ${JSON.stringify(result)}`,
        );
      }),
    ]);
    const activeLease = await database.pool.query<{ remaining_ms: number }>(
      `SELECT EXTRACT(EPOCH FROM (sync_claim_expires_at - NOW())) * 1000 AS remaining_ms
       FROM finance_provider_items
       WHERE id = (SELECT provider_item_record_id FROM finance_accounts WHERE id = $1)`,
      [healthSiblingAccount.id],
    );
    const remainingLeaseMs = Number(activeLease.rows[0]?.remaining_ms);
    expect(remainingLeaseMs).toBeGreaterThan(4 * 60_000);
    expect(remainingLeaseMs).toBeLessThanOrEqual(5 * 60_000);
    const overlappingPass = fastClockWorker.syncDuePlaidAccounts();
    const siblingSync = fastClockWorker.syncPlaidAccount(healthSiblingAccount.id, context);
    const siblingOutcome = await siblingSync.then(
      () => ({ code: "resolved" }),
      (error: unknown) => error,
    );
    await expect(overlappingPass).resolves.toEqual({
      attempted: 1,
      failed: 0,
      recovered: 0,
      skipped: 1,
      succeeded: 0,
    });
    releaseDeferredSync?.();
    expect(siblingOutcome).toMatchObject({ code: "conflict" });
    await expect(firstPass).resolves.toEqual({ changed: 0 });
    mode = "success";
    const siblingLeaseId = crypto.randomUUID();
    await database.pool.query(
      `UPDATE finance_accounts
       SET sync_state = 'stale', sync_claim_id = $2,
           sync_claim_expires_at = NOW() + INTERVAL '30 minutes', next_sync_at = NOW()
       WHERE id = $1`,
      [healthAccount.id, siblingLeaseId],
    );
    await expect(
      settlementFastClockWorker.syncPlaidAccount(healthAccount.id, context),
    ).resolves.toEqual({ changed: 0 });
    await expect(
      database.pool.query(`SELECT sync_claim_id, sync_state FROM finance_accounts WHERE id = $1`, [
        healthAccount.id,
      ]),
    ).resolves.toMatchObject({
      rows: [{ sync_claim_id: null, sync_state: "current" }],
    });
    await database.pool.query(
      `UPDATE finance_accounts
       SET sync_claim_id = NULL, sync_claim_expires_at = NULL,
           sync_state = 'current', next_sync_at = NOW() + INTERVAL '1 day'
       WHERE id = $1`,
      [healthAccount.id],
    );
    const expiredClaimId = crypto.randomUUID();
    await database.pool.query(
      `UPDATE finance_accounts
       SET sync_state = 'stale', sync_claim_id = $2,
           sync_claim_expires_at = NOW() - INTERVAL '1 second'
       WHERE id = $1`,
      [healthSiblingAccount.id, expiredClaimId],
    );
    await database.pool.query(`UPDATE finance_accounts SET next_sync_at = NOW() WHERE id = $1`, [
      healthAccount.id,
    ]);
    await expect(slowClockWorker.syncPlaidAccount(healthAccount.id, context)).resolves.toEqual({
      changed: 0,
    });

    const makeDue = async () =>
      database.pool.query(
        `UPDATE finance_provider_items
         SET next_sync_at = $2
         WHERE id = (SELECT provider_item_record_id FROM finance_accounts WHERE id = $1)`,
        [healthAccount.id, now],
      );
    const repairAndMakeDue = async () =>
      database.pool.query(
        `UPDATE finance_provider_items
         SET sync_state = 'stale', sync_error = NULL, sync_error_code = NULL,
             sync_error_category = NULL, sync_recovery = NULL, sync_failure_count = 0,
             next_sync_at = $2
         WHERE id = (SELECT provider_item_record_id FROM finance_accounts WHERE id = $1)`,
        [healthAccount.id, now],
      );
    const unconfiguredWorker = createFinanceService({
      db: database.db,
      encryptionKey: key,
      log: logs,
      now: () => now,
    });
    await makeDue();
    await expect(unconfiguredWorker.syncDuePlaidAccounts()).resolves.toMatchObject({ failed: 1 });
    await expect(
      database.pool.query(
        `SELECT sync_error_code, sync_error_category, sync_recovery
         FROM finance_accounts WHERE id = $1`,
        [healthAccount.id],
      ),
    ).resolves.toMatchObject({
      rows: [
        {
          sync_error_category: "configuration",
          sync_error_code: "plaid_configuration_missing",
          sync_recovery: "operator",
        },
      ],
    });

    const unencryptedWorker = createFinanceService({
      db: database.db,
      log: logs,
      now: () => now,
      plaid,
    });
    await repairAndMakeDue();
    await expect(unencryptedWorker.syncDuePlaidAccounts()).resolves.toMatchObject({ failed: 1 });
    await expect(
      database.pool.query(
        `SELECT sync_error_code, sync_error_category, sync_recovery
         FROM finance_accounts WHERE id = $1`,
        [healthAccount.id],
      ),
    ).resolves.toMatchObject({
      rows: [
        {
          sync_error_category: "configuration",
          sync_error_code: "finance_encryption_configuration_missing",
          sync_recovery: "operator",
        },
      ],
    });

    mode = "configuration";
    await repairAndMakeDue();
    await expect(workerOne.syncDuePlaidAccounts()).resolves.toMatchObject({ failed: 1 });
    await expect(
      database.pool.query(
        `SELECT status, sync_state, sync_error, sync_error_code, sync_error_category, sync_recovery
         FROM finance_accounts WHERE id = $1`,
        [healthAccount.id],
      ),
    ).resolves.toMatchObject({
      rows: [
        {
          status: "connected",
          sync_error: "Plaid is not configured correctly. ilo is resolving this.",
          sync_error_category: "configuration",
          sync_error_code: "plaid_configuration_invalid",
          sync_recovery: "operator",
          sync_state: "blocked",
        },
      ],
    });

    mode = "rate";
    await repairAndMakeDue();
    await expect(workerOne.syncDuePlaidAccounts()).resolves.toMatchObject({ failed: 1 });
    await expect(
      database.pool.query(
        `SELECT sync_state, sync_error_category, sync_recovery, next_sync_at
         FROM finance_accounts WHERE id = $1`,
        [healthAccount.id],
      ),
    ).resolves.toMatchObject({
      rows: [
        {
          next_sync_at: expect.any(Date),
          sync_error_category: "rate_limited",
          sync_recovery: "automatic",
          sync_state: "retrying",
        },
      ],
    });
    await database.db
      .update(financeAccounts)
      .set({
        nextSyncAt: null,
        syncError: null,
        syncErrorCategory: null,
        syncErrorCode: null,
        syncFailureCount: 0,
        syncRecovery: null,
        syncState: "current",
      })
      .where(eq(financeAccounts.id, healthAccount.id));
    expect(
      (await workerOne.listOverview(healthUser.id)).accounts.find(
        (financeAccount) => financeAccount.id === healthAccount.id,
      )?.synchronization,
    ).toMatchObject({
      nextRetryAt: expect.any(String),
      recovery: "automatic",
      state: "retrying",
    });
    await database.pool.query(
      `UPDATE finance_provider_items
       SET last_synced_at = $2
       WHERE id = (SELECT provider_item_record_id FROM finance_accounts WHERE id = $1)`,
      [healthAccount.id, new Date(now.getTime() - 48 * 60 * 60_000)],
    );
    await database.pool.query(
      `UPDATE finance_accounts
       SET last_synced_at = $2
       WHERE provider_item_record_id = (
         SELECT provider_item_record_id FROM finance_accounts WHERE id = $1
       )`,
      [healthAccount.id, now],
    );
    await expect(workerOne.getLedgerHealth(healthUser.id)).resolves.toMatchObject({
      staleAccounts: 2,
    });

    mode = "authorization";
    await makeDue();
    await expect(workerOne.syncDuePlaidAccounts()).resolves.toMatchObject({ failed: 1 });
    await expect(
      database.pool.query(
        `SELECT status, sync_state, sync_error_category, sync_recovery, next_sync_at
         FROM finance_accounts WHERE id = $1`,
        [healthAccount.id],
      ),
    ).resolves.toMatchObject({
      rows: [
        {
          next_sync_at: null,
          status: "needs_reauth",
          sync_error_category: "authorization",
          sync_recovery: "reconnect",
          sync_state: "blocked",
        },
      ],
    });
    expect(
      (await workerOne.listOverview(healthUser.id)).accounts.find(
        (financeAccount) => financeAccount.id === healthAccount.id,
      )?.synchronization,
    ).toMatchObject({
      nextRetryAt: null,
      recovery: "reconnect",
      state: "blocked",
    });

    mode = "success";
    await workerOne.exchangePlaidToken(
      { institution: "Health Bank", publicToken: "health-reconnect-token" },
      { ...context, requestId: "plaid-health-reconnect" },
    );
    await expect(workerOne.syncDuePlaidAccounts()).resolves.toEqual({
      attempted: 1,
      failed: 0,
      recovered: 0,
      skipped: 0,
      succeeded: 1,
    });
    await expect(
      database.pool.query(
        `SELECT sync_state, sync_claim_id, sync_claim_expires_at,
                sync_error, sync_error_code, sync_error_category, sync_recovery,
                sync_failure_count, last_synced_at
         FROM finance_accounts WHERE id = $1`,
        [healthAccount.id],
      ),
    ).resolves.toMatchObject({
      rows: [
        {
          last_synced_at: expect.any(Date),
          sync_claim_expires_at: null,
          sync_claim_id: null,
          sync_error: null,
          sync_error_category: null,
          sync_error_code: null,
          sync_failure_count: 0,
          sync_recovery: null,
          sync_state: "current",
        },
      ],
    });
    await expect(
      database.pool.query(
        `SELECT status FROM finance_accounts WHERE provider_item_id = (
           SELECT provider_item_id FROM finance_accounts WHERE id = $1
         )`,
        [healthAccount.id],
      ),
    ).resolves.toMatchObject({ rows: [{ status: "connected" }, { status: "connected" }] });
    await database.pool.query(
      `UPDATE finance_provider_items
       SET next_sync_at = $2
       WHERE id = (SELECT provider_item_record_id FROM finance_accounts WHERE id = $1)`,
      [healthAccount.id, new Date(now.getTime() + 24 * 60 * 60_000)],
    );
    await database.pool.query(
      `UPDATE finance_accounts
       SET provider_item_id = NULL, next_sync_at = $2
       WHERE id = $1`,
      [healthAccount.id, now],
    );
    await expect(workerOne.syncDuePlaidAccounts()).resolves.toEqual({
      attempted: 0,
      failed: 0,
      recovered: 0,
      skipped: 0,
      succeeded: 0,
    });
    expect(logs.mock.calls.map(([entry]) => entry)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ event: "connector_sync_completed", provider: "plaid" }),
        expect.objectContaining({ event: "connector_sync_failed", provider: "plaid" }),
        expect.objectContaining({ event: "connector_sync_freshness_observed", provider: "plaid" }),
      ]),
    );
    expect(JSON.stringify(logs.mock.calls)).not.toContain("raw-");
  }, 20_000);

  it("observes Provider Item freshness without reading account status shadows", async () => {
    const connectedAccounts = await database.db
      .select({ id: financeAccounts.id })
      .from(financeAccounts)
      .where(and(eq(financeAccounts.provider, "plaid"), eq(financeAccounts.status, "connected")));
    await database.db
      .update(financeAccounts)
      .set({ status: "needs_reauth" })
      .where(
        inArray(
          financeAccounts.id,
          connectedAccounts.map((account) => account.id),
        ),
      );
    await database.db.update(financeProviderItems).set({ nextSyncAt: null });
    const logs = vi.fn();
    try {
      const service = createFinanceService({ db: database.db, log: logs, now: () => now });
      await expect(service.syncDuePlaidAccounts()).resolves.toEqual({
        attempted: 0,
        failed: 0,
        recovered: 0,
        skipped: 0,
        succeeded: 0,
      });
      const freshness = logs.mock.calls
        .map(([entry]) => entry)
        .findLast((entry) => entry.event === "connector_sync_freshness_observed");
      expect(freshness).toMatchObject({
        eligibleAccountCount: expect.any(Number),
        freshnessAgeMs: expect.any(Number),
        provider: "plaid",
      });
    } finally {
      await database.db
        .update(financeAccounts)
        .set({ status: "connected" })
        .where(
          inArray(
            financeAccounts.id,
            connectedAccounts.map((account) => account.id),
          ),
        );
    }
  });

  it("resumes a removal window from its last atomically projected Item page", async () => {
    const [restartUser] = await database.db
      .insert(users)
      .values({
        displayName: "Plaid Restart",
        email: "plaid-restart@example.com",
        passwordHash: "unused",
        planningTimezone: "UTC",
      })
      .returning();
    if (!restartUser) throw new Error("Plaid restart fixture user was not created.");
    let failSecondPage = true;
    const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const requestUrl =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      const path = new URL(requestUrl).pathname;
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      if (path === "/item/public_token/exchange") {
        return Response.json({ access_token: "restart-token", item_id: "restart-item" });
      }
      if (path === "/accounts/get") {
        return Response.json({
          accounts: [
            {
              account_id: "restart-account",
              balances: { current: 100 },
              name: "Restart checking",
              official_name: null,
            },
          ],
        });
      }
      if (path === "/transactions/sync" && body.cursor === null) {
        return Response.json({
          added: [],
          has_more: true,
          modified: [],
          next_cursor: "restart-page-1",
          removed: [{ transaction_id: "stale-provider-transaction" }],
        });
      }
      if (path === "/transactions/sync" && body.cursor === "restart-page-1") {
        if (failSecondPage) {
          failSecondPage = false;
          return Response.json({ error_message: "Temporary page failure" }, { status: 503 });
        }
        return Response.json({
          added: [],
          has_more: false,
          modified: [],
          next_cursor: "restart-final",
          removed: [],
          transactions_update_status: "HISTORICAL_UPDATE_COMPLETE",
        });
      }
      return Response.json({ error_message: "Unexpected Plaid request" }, { status: 400 });
    });
    const service = createFinanceService({
      db: database.db,
      encryptionKey: key,
      now: () => now,
      plaid: createPlaidConnector({
        clientId: "client",
        environment: "sandbox",
        fetch,
        secret: "secret",
      }),
    });
    const context = {
      principal: financePrincipal(restartUser.id),
      requestId: "plaid-restart",
    };
    const [restartAccount] = await service.exchangePlaidToken(
      { institution: "Restart Bank", publicToken: "restart-public-token" },
      context,
    );
    if (!restartAccount) throw new Error("Plaid restart account was not created.");
    const [staleTransaction] = await database.db
      .insert(financeTransactions)
      .values({
        accountId: restartAccount.id,
        amount: 2500,
        category: "Shopping",
        direction: "expense",
        merchant: "Removed purchase",
        pending: false,
        providerDirection: "expense",
        providerTransactionId: "stale-provider-transaction",
        transactionDate: "2026-07-10",
        userId: restartUser.id,
      })
      .returning();
    if (!staleTransaction) throw new Error("Stale Plaid transaction was not created.");

    await expect(service.syncPlaidAccount(restartAccount.id, context)).rejects.toThrow(
      "Plaid is temporarily unavailable.",
    );
    await expect(
      database.db
        .select({ syncCursor: financeAccounts.syncCursor })
        .from(financeAccounts)
        .where(eq(financeAccounts.id, restartAccount.id)),
    ).resolves.toEqual([{ syncCursor: "restart-page-1" }]);
    await expect(
      database.db
        .select()
        .from(financeTransactions)
        .where(eq(financeTransactions.id, staleTransaction.id)),
    ).resolves.toHaveLength(0);

    await expect(service.syncPlaidAccount(restartAccount.id, context)).resolves.toEqual({
      changed: 0,
    });
    await expect(
      database.db
        .select({ syncCursor: financeAccounts.syncCursor })
        .from(financeAccounts)
        .where(eq(financeAccounts.id, restartAccount.id)),
    ).resolves.toEqual([{ syncCursor: "restart-final" }]);
    await expect(
      database.db
        .select()
        .from(financeTransactions)
        .where(eq(financeTransactions.id, staleTransaction.id)),
    ).resolves.toHaveLength(0);
  });

  it("surfaces Plaid API failures without persisting credentials", async () => {
    const service = createFinanceService({
      db: database.db,
      encryptionKey: key,
      now: () => now,
      plaid: createPlaidConnector({
        clientId: "client",
        environment: "sandbox",
        fetch: vi.fn(async () =>
          Response.json({ error_message: "Bad public token" }, { status: 400 }),
        ),
        secret: "secret",
      }),
    });
    await expect(service.createPlaidLinkToken(userId)).rejects.toThrow(
      "Plaid rejected the request.",
    );
    const fallbackService = createFinanceService({
      db: database.db,
      encryptionKey: key,
      now: () => now,
      plaid: createPlaidConnector({
        clientId: "client",
        environment: "sandbox",
        secret: "secret",
      }),
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({}, { status: 500 })),
    );
    await expect(fallbackService.createPlaidLinkToken(userId)).rejects.toThrow(
      "Plaid is temporarily unavailable.",
    );
    vi.unstubAllGlobals();
  });

  it("fences normalized ingestion when the maintenance claim expires during provider work", async () => {
    const [maintenanceUser] = await database.db
      .insert(users)
      .values({
        displayName: "Maintenance heartbeat",
        email: `finance-heartbeat-${crypto.randomUUID()}@example.com`,
        passwordHash: "unused",
        planningTimezone: "UTC",
      })
      .returning();
    if (!maintenanceUser) throw new Error("Maintenance heartbeat user was not created.");
    const runId = crypto.randomUUID();
    const claimId = crypto.randomUUID();
    const plaid = createPlaidConnector({
      clientId: "client",
      environment: "sandbox",
      fetch: async (input) => {
        switch (new URL(String(input)).pathname) {
          case "/item/public_token/exchange":
            return Response.json({ access_token: "access-token", item_id: "heartbeat-item" });
          case "/accounts/get":
            return Response.json({
              accounts: [
                {
                  account_id: "heartbeat-account",
                  balances: { current: 100 },
                  name: "Checking",
                  official_name: null,
                },
              ],
            });
          case "/transactions/sync":
            await database.db
              .update(workspaceMaintenanceRuns)
              .set({ leaseExpiresAt: new Date(0) })
              .where(eq(workspaceMaintenanceRuns.id, runId));
            return Response.json({
              added: [
                {
                  account_id: "heartbeat-account",
                  amount: 25,
                  date: "2026-07-19",
                  merchant_name: "Heartbeat canary",
                  name: "Heartbeat canary",
                  pending: false,
                  personal_finance_category: null,
                  transaction_id: "heartbeat-transaction",
                },
              ],
              has_more: false,
              modified: [],
              next_cursor: "heartbeat-cursor",
              removed: [],
            });
          default:
            return Response.json({}, { status: 404 });
        }
      },
      secret: "secret",
    });
    const service = createFinanceService({
      db: database.db,
      encryptionKey: key,
      now: () => now,
      plaid,
    });
    const context = {
      principal: financePrincipal(maintenanceUser.id),
      requestId: "maintenance-heartbeat",
    };
    const [account] = await service.exchangePlaidToken(
      { institution: "Heartbeat Bank", publicToken: "public-token" },
      context,
    );
    if (!account) throw new Error("Maintenance heartbeat account was not created.");
    await database.db.insert(workspaceMaintenanceRuns).values({
      domain: "finances",
      id: runId,
      leaseClaimId: claimId,
      leaseExpiresAt: new Date(Date.now() + 60_000),
      rulebookVersion: "rules:v1",
      scope: { type: "all_outstanding" },
      status: "running",
      userId: maintenanceUser.id,
    });
    const maintenanceContext = {
      maintenance: {
        idempotencyKey: "finances:rules:v1:synchronize",
        policy: "approved_rule" as const,
        rulebookVersion: "rules:v1",
        runId,
      },
      maintenanceClaim: { claimId, runId },
      principal: financeAgentPrincipal(maintenanceUser.id),
      requestId: `maintenance:${runId}:synchronize`,
    };
    const effectsBefore = await database.pool.query(
      `
      SELECT
        (SELECT count(*)::int FROM finance_merchants WHERE user_id = $1) AS merchants,
        (SELECT count(*)::int FROM finance_merchant_aliases WHERE user_id = $1) AS aliases,
        (SELECT count(*)::int FROM finance_categories WHERE user_id = $1) AS categories,
        (SELECT count(*)::int FROM audit_events
          WHERE user_id = $1 AND action <> 'finance.plaid_accounts_projected') AS audits
    `,
      [maintenanceUser.id],
    );

    await expect(
      service.syncDueAccountsForUser(
        maintenanceUser.id,
        { type: "all_outstanding" },
        maintenanceContext,
        async () => {},
      ),
    ).resolves.toMatchObject({ failed: 0, skipped: 1, succeeded: 0 });
    await expect(
      database.db
        .select({ id: financeTransactions.id })
        .from(financeTransactions)
        .where(eq(financeTransactions.userId, maintenanceUser.id)),
    ).resolves.toEqual([]);
    await expect(
      database.db
        .select({
          syncClaimId: financeAccounts.syncClaimId,
          syncCursor: financeAccounts.syncCursor,
          syncFailureCount: financeAccounts.syncFailureCount,
          syncState: financeAccounts.syncState,
        })
        .from(financeAccounts)
        .where(eq(financeAccounts.id, account.id)),
    ).resolves.toEqual([
      { syncClaimId: null, syncCursor: null, syncFailureCount: 0, syncState: "stale" },
    ]);
    await expect(
      database.pool.query(
        `
        SELECT
          (SELECT count(*)::int FROM finance_merchants WHERE user_id = $1) AS merchants,
          (SELECT count(*)::int FROM finance_merchant_aliases WHERE user_id = $1) AS aliases,
          (SELECT count(*)::int FROM finance_categories WHERE user_id = $1) AS categories,
          (SELECT count(*)::int FROM audit_events
            WHERE user_id = $1 AND action <> 'finance.plaid_accounts_projected') AS audits
      `,
        [maintenanceUser.id],
      ),
    ).resolves.toMatchObject({ rows: effectsBefore.rows });
  });

  it("keeps scoped maintenance synchronization and health mutations inside the requested evidence", async () => {
    const userId = crypto.randomUUID();
    await database.db.insert(users).values({
      id: userId,
      displayName: "Scoped provider maintenance",
      email: `scoped-provider-${userId}@example.com`,
      passwordHash: "unused",
      planningTimezone: "UTC",
    });
    let syncCall = 0;
    const observedSyncCursors: unknown[] = [];
    const plaid = createPlaidConnector({
      clientId: "client",
      environment: "sandbox",
      fetch: async (input, init) => {
        switch (new URL(String(input)).pathname) {
          case "/item/public_token/exchange":
            return Response.json({ access_token: "scope-access", item_id: "scope-item" });
          case "/accounts/get":
            return Response.json({
              accounts: [
                {
                  account_id: "scope-account-one",
                  balances: { current: 100, iso_currency_code: "USD" },
                  name: "Scope checking",
                  official_name: null,
                },
                {
                  account_id: "scope-account-two",
                  balances: { current: 200, iso_currency_code: "USD" },
                  name: "Unrelated savings",
                  official_name: null,
                },
              ],
            });
          case "/transactions/sync": {
            syncCall += 1;
            const body = JSON.parse(String(init?.body)) as { cursor?: unknown };
            observedSyncCursors.push(body.cursor ?? null);
            if (syncCall === 4) {
              return Response.json(
                { error_message: "Temporary provider failure" },
                { status: 500 },
              );
            }
            const targetPass = syncCall === 2;
            return Response.json({
              added:
                syncCall === 3
                  ? []
                  : targetPass
                    ? [
                        {
                          account_id: "scope-account-one",
                          amount: 10,
                          date: "2026-07-19",
                          iso_currency_code: "USD",
                          merchant_name: "Target account evidence",
                          name: "TARGET ACCOUNT EVIDENCE",
                          pending: false,
                          personal_finance_category: null,
                          transaction_id: "scope-target-one",
                        },
                        {
                          account_id: "scope-account-two",
                          amount: 20,
                          date: "2026-07-19",
                          iso_currency_code: "USD",
                          merchant_name: "Unrelated account evidence",
                          name: "UNRELATED ACCOUNT EVIDENCE",
                          pending: false,
                          personal_finance_category: null,
                          transaction_id: "scope-target-two",
                        },
                      ]
                    : [
                        {
                          account_id: "scope-account-one",
                          amount: 75,
                          date: "2026-07-01",
                          iso_currency_code: "USD",
                          merchant_name: "Outside window outgoing",
                          name: "OUTSIDE WINDOW OUTGOING",
                          pending: false,
                          personal_finance_category: {
                            confidence_level: "VERY_HIGH",
                            detailed: "TRANSFER_OUT_ACCOUNT_TRANSFER",
                            primary: "TRANSFER_OUT",
                          },
                          transaction_id: "scope-window-out",
                        },
                        {
                          account_id: "scope-account-two",
                          amount: -75,
                          date: "2026-07-01",
                          iso_currency_code: "USD",
                          merchant_name: "Outside window incoming",
                          name: "OUTSIDE WINDOW INCOMING",
                          pending: false,
                          personal_finance_category: {
                            confidence_level: "VERY_HIGH",
                            detailed: "TRANSFER_IN_ACCOUNT_TRANSFER",
                            primary: "TRANSFER_IN",
                          },
                          transaction_id: "scope-window-in",
                        },
                      ],
              has_more: false,
              modified: [],
              next_cursor:
                syncCall === 3
                  ? "scope-all-cursor"
                  : targetPass
                    ? "scope-target-cursor"
                    : "scope-window-cursor",
              removed: [],
            });
          }
          default:
            return Response.json({}, { status: 404 });
        }
      },
      secret: "secret",
    });
    const service = createFinanceService({
      db: database.db,
      encryptionKey: key,
      now: () => now,
      plaid,
    });
    const accounts = await service.exchangePlaidToken(
      { institution: "Scope Bank", publicToken: "scope-token" },
      { principal: financePrincipal(userId), requestId: "scope-connect" },
    );
    const targetAccount = accounts.find((account) => account.name === "Scope checking");
    const unrelatedAccount = accounts.find((account) => account.name === "Unrelated savings");
    if (!targetAccount || !unrelatedAccount)
      throw new Error("Scoped Plaid accounts were not saved.");
    const makeScopedItemDue = async () =>
      database.pool.query(
        `UPDATE finance_provider_items
         SET next_sync_at = $2, sync_state = 'stale', sync_error = NULL,
             sync_error_code = NULL, sync_error_category = NULL,
             sync_recovery = NULL, sync_failure_count = 0
         WHERE id = (SELECT provider_item_record_id FROM finance_accounts WHERE id = $1)`,
        [targetAccount.id, now],
      );
    const scopedManualAccount = await service.createAccount(
      { balance: 0, institution: "Cash", name: "Scoped manual wallet", provider: "manual" },
      { principal: financePrincipal(userId), requestId: "scope-manual" },
    );
    await database.db
      .update(financeAccounts)
      .set({ nextSyncAt: null, syncState: "stale" })
      .where(
        inArray(financeAccounts.id, [
          targetAccount.id,
          unrelatedAccount.id,
          scopedManualAccount.id,
        ]),
      );
    const windowScope = { type: "window", start: "2026-07-10", end: "2026-07-19" } as const;
    const windowRunId = crypto.randomUUID();
    const windowClaimId = crypto.randomUUID();
    await database.db.insert(workspaceMaintenanceRuns).values({
      domain: "finances",
      id: windowRunId,
      leaseClaimId: windowClaimId,
      leaseExpiresAt: new Date(Date.now() + 60_000),
      rulebookVersion: "rules:v1",
      scope: windowScope,
      status: "running",
      userId,
    });
    const windowContext = {
      maintenance: {
        idempotencyKey: "finances:rules:v1:synchronize",
        policy: "approved_rule" as const,
        rulebookVersion: "rules:v1",
        runId: windowRunId,
      },
      maintenanceClaim: { claimId: windowClaimId, runId: windowRunId },
      principal: financeAgentPrincipal(userId),
      requestId: `maintenance:${windowRunId}:synchronize`,
    };
    const unrelatedUserId = crypto.randomUUID();
    await database.db.insert(users).values({
      id: unrelatedUserId,
      displayName: "Unrelated sync health",
      email: `unrelated-sync-health-${unrelatedUserId}@example.com`,
      passwordHash: "unused",
      planningTimezone: "UTC",
    });
    const unrelatedUserAccount = await service.createAccount(
      { balance: 0, institution: "Other", name: "Other wallet", provider: "manual" },
      { principal: financePrincipal(unrelatedUserId), requestId: "unrelated-sync-health" },
    );
    await database.db
      .update(financeAccounts)
      .set({ nextSyncAt: null, syncState: "stale" })
      .where(eq(financeAccounts.id, unrelatedUserAccount.id));

    await expect(
      service.syncDueAccountsForUser(userId, windowScope, windowContext, async () => {}),
    ).resolves.toEqual({ attempted: 1, failed: 0, recovered: 0, skipped: 0, succeeded: 1 });
    expect(observedSyncCursors).toEqual([null]);
    await expect(
      database.db
        .select({
          action: auditEvents.action,
          after: auditEvents.after,
          entityId: auditEvents.entityId,
        })
        .from(auditEvents)
        .where(eq(auditEvents.action, "finance.sync_health_initialized"))
        .orderBy(auditEvents.entityId),
    ).resolves.toEqual([]);
    await expect(
      database.db
        .select({ syncState: financeAccounts.syncState })
        .from(financeAccounts)
        .where(eq(financeAccounts.id, scopedManualAccount.id)),
    ).resolves.toEqual([{ syncState: "stale" }]);
    await expect(
      database.db
        .select({
          direction: financeTransactions.direction,
          reconciliationStatus: financeTransactions.reconciliationStatus,
          transferGroupId: financeTransactions.transferGroupId,
        })
        .from(financeTransactions)
        .where(
          inArray(financeTransactions.providerTransactionId, [
            "scope-window-out",
            "scope-window-in",
          ]),
        )
        .orderBy(financeTransactions.providerTransactionId),
    ).resolves.toEqual([
      { direction: "income", reconciliationStatus: "candidate", transferGroupId: null },
      { direction: "expense", reconciliationStatus: "candidate", transferGroupId: null },
    ]);
    await expect(
      database.db
        .select({ id: auditEvents.id })
        .from(auditEvents)
        .where(
          and(
            eq(auditEvents.requestId, windowContext.requestId),
            eq(auditEvents.action, "finance.transfer_reconciled"),
          ),
        ),
    ).resolves.toEqual([]);
    await expect(
      database.db
        .select({ nextSyncAt: financeAccounts.nextSyncAt, syncState: financeAccounts.syncState })
        .from(financeAccounts)
        .where(eq(financeAccounts.id, unrelatedUserAccount.id)),
    ).resolves.toEqual([{ nextSyncAt: null, syncState: "stale" }]);

    await database.db
      .update(workspaceMaintenanceRuns)
      .set({ leaseClaimId: null, leaseExpiresAt: null, status: "completed" })
      .where(eq(workspaceMaintenanceRuns.id, windowRunId));
    await makeScopedItemDue();
    const targetScope = {
      type: "target",
      entityType: "finance_account",
      id: targetAccount.id,
    } as const;
    const targetRunId = crypto.randomUUID();
    const targetClaimId = crypto.randomUUID();
    await database.db.insert(workspaceMaintenanceRuns).values({
      domain: "finances",
      id: targetRunId,
      leaseClaimId: targetClaimId,
      leaseExpiresAt: new Date(Date.now() + 60_000),
      rulebookVersion: "rules:v1",
      scope: targetScope,
      status: "running",
      userId,
    });
    const targetContext = {
      ...windowContext,
      maintenance: { ...windowContext.maintenance, runId: targetRunId },
      maintenanceClaim: { claimId: targetClaimId, runId: targetRunId },
      requestId: `maintenance:${targetRunId}:synchronize`,
    };
    await expect(
      service.syncDueAccountsForUser(userId, targetScope, targetContext, async () => {}),
    ).resolves.toEqual({ attempted: 1, failed: 0, recovered: 0, skipped: 0, succeeded: 1 });
    await expect(
      database.db
        .select({
          accountId: financeTransactions.accountId,
          providerId: financeTransactions.providerTransactionId,
        })
        .from(financeTransactions)
        .where(
          inArray(financeTransactions.providerTransactionId, [
            "scope-target-one",
            "scope-target-two",
          ]),
        )
        .orderBy(financeTransactions.providerTransactionId),
    ).resolves.toEqual(
      [
        { accountId: targetAccount.id, providerId: "scope-target-one" },
        { accountId: unrelatedAccount.id, providerId: "scope-target-two" },
      ].toSorted((left, right) => left.providerId.localeCompare(right.providerId)),
    );
    expect(observedSyncCursors).toEqual([null, "scope-window-cursor"]);
    await expect(
      database.db
        .select({ entityId: auditEvents.entityId })
        .from(auditEvents)
        .where(
          and(
            eq(auditEvents.action, "finance.sync_health_initialized"),
            eq(auditEvents.requestId, targetContext.requestId),
          ),
        ),
    ).resolves.toEqual([]);
    await expect(
      database.db
        .select({ cursor: financeAccounts.syncCursor })
        .from(financeAccounts)
        .where(inArray(financeAccounts.id, [targetAccount.id, unrelatedAccount.id]))
        .orderBy(financeAccounts.id),
    ).resolves.toEqual([{ cursor: "scope-target-cursor" }, { cursor: "scope-target-cursor" }]);
    await expect(
      database.db
        .select({ nextSyncAt: financeAccounts.nextSyncAt, syncState: financeAccounts.syncState })
        .from(financeAccounts)
        .where(eq(financeAccounts.id, unrelatedAccount.id)),
    ).resolves.toEqual([{ nextSyncAt: expect.any(Date), syncState: "current" }]);

    await database.db
      .update(workspaceMaintenanceRuns)
      .set({ leaseClaimId: null, leaseExpiresAt: null, status: "completed" })
      .where(eq(workspaceMaintenanceRuns.id, targetRunId));
    const allRunId = crypto.randomUUID();
    const allClaimId = crypto.randomUUID();
    await database.db.insert(workspaceMaintenanceRuns).values({
      domain: "finances",
      id: allRunId,
      leaseClaimId: allClaimId,
      leaseExpiresAt: new Date(Date.now() + 60_000),
      rulebookVersion: "rules:v1",
      scope: { type: "all_outstanding" },
      status: "running",
      userId,
    });
    const allContext = {
      ...targetContext,
      maintenance: { ...targetContext.maintenance, runId: allRunId },
      maintenanceClaim: { claimId: allClaimId, runId: allRunId },
      requestId: `maintenance:${allRunId}:synchronize`,
    };
    await makeScopedItemDue();
    await expect(
      service.syncDueAccountsForUser(
        userId,
        { type: "all_outstanding" },
        allContext,
        async () => {},
      ),
    ).resolves.toEqual({ attempted: 1, failed: 0, recovered: 0, skipped: 0, succeeded: 1 });
    expect(observedSyncCursors).toEqual([null, "scope-window-cursor", "scope-target-cursor"]);
    await expect(
      database.db
        .select({ id: financeTransactions.id })
        .from(financeTransactions)
        .where(eq(financeTransactions.providerTransactionId, "scope-target-two")),
    ).resolves.toHaveLength(1);
    await expect(
      database.db
        .select({ cursor: financeAccounts.syncCursor })
        .from(financeAccounts)
        .where(inArray(financeAccounts.id, [targetAccount.id, unrelatedAccount.id]))
        .orderBy(financeAccounts.id),
    ).resolves.toEqual([{ cursor: "scope-all-cursor" }, { cursor: "scope-all-cursor" }]);
    await expect(
      database.db
        .select({ action: auditEvents.action, entityId: auditEvents.entityId })
        .from(auditEvents)
        .where(eq(auditEvents.action, "finance.sync_health_initialized")),
    ).resolves.toHaveLength(1);
    await expect(
      database.db
        .select({ after: auditEvents.after, entityId: auditEvents.entityId })
        .from(auditEvents)
        .where(
          and(
            eq(auditEvents.action, "finance.sync_health_initialized"),
            eq(auditEvents.requestId, allContext.requestId),
          ),
        )
        .orderBy(auditEvents.entityId),
    ).resolves.toEqual(
      [scopedManualAccount.id].map((accountId) => ({
        after: expect.objectContaining({
          maintenance: allContext.maintenance,
          source: expect.objectContaining({ accountId, sourceType: "finance_account" }),
        }),
        entityId: accountId,
      })),
    );
    await database.db
      .update(workspaceMaintenanceRuns)
      .set({ leaseClaimId: null, leaseExpiresAt: null, status: "completed" })
      .where(eq(workspaceMaintenanceRuns.id, allRunId));
    const replayRunId = crypto.randomUUID();
    const replayClaimId = crypto.randomUUID();
    await database.db.insert(workspaceMaintenanceRuns).values({
      domain: "finances",
      id: replayRunId,
      leaseClaimId: replayClaimId,
      leaseExpiresAt: new Date(Date.now() + 60_000),
      rulebookVersion: "rules:v1",
      scope: { type: "all_outstanding" },
      status: "running",
      userId,
    });
    const replayContext = {
      ...allContext,
      maintenance: { ...allContext.maintenance, runId: replayRunId },
      maintenanceClaim: { claimId: replayClaimId, runId: replayRunId },
      requestId: `maintenance:${replayRunId}:synchronize`,
    };
    await expect(
      service.syncDueAccountsForUser(
        userId,
        { type: "all_outstanding" },
        replayContext,
        async () => {},
      ),
    ).resolves.toEqual({ attempted: 0, failed: 0, recovered: 0, skipped: 0, succeeded: 0 });
    expect(observedSyncCursors).toHaveLength(3);
    await expect(
      database.db
        .select({ id: auditEvents.id })
        .from(auditEvents)
        .where(eq(auditEvents.action, "finance.sync_health_initialized")),
    ).resolves.toHaveLength(1);
    await database.db
      .update(workspaceMaintenanceRuns)
      .set({ leaseClaimId: null, leaseExpiresAt: null, status: "completed" })
      .where(eq(workspaceMaintenanceRuns.id, replayRunId));
    await makeScopedItemDue();
    const failureRunId = crypto.randomUUID();
    const failureClaimId = crypto.randomUUID();
    await database.db.insert(workspaceMaintenanceRuns).values({
      domain: "finances",
      id: failureRunId,
      leaseClaimId: failureClaimId,
      leaseExpiresAt: new Date(Date.now() + 60_000),
      rulebookVersion: "rules:v1",
      scope: targetScope,
      status: "running",
      userId,
    });
    const failureContext = {
      ...targetContext,
      maintenance: { ...targetContext.maintenance, runId: failureRunId },
      maintenanceClaim: { claimId: failureClaimId, runId: failureRunId },
      requestId: `maintenance:${failureRunId}:synchronize`,
    };
    await expect(
      service.syncDueAccountsForUser(userId, targetScope, failureContext, async () => {}),
    ).resolves.toEqual({ attempted: 1, failed: 1, recovered: 0, skipped: 0, succeeded: 0 });
    await expect(
      database.db
        .select({ id: financeAccounts.id, syncState: financeAccounts.syncState })
        .from(financeAccounts)
        .where(inArray(financeAccounts.id, [targetAccount.id, unrelatedAccount.id]))
        .orderBy(financeAccounts.id),
    ).resolves.toEqual(
      [
        { id: targetAccount.id, syncState: "retrying" },
        { id: unrelatedAccount.id, syncState: "retrying" },
      ].toSorted((left, right) => left.id.localeCompare(right.id)),
    );

    const [stream] = await database.db
      .insert(financeIncomeStreams)
      .values({
        accountId: unrelatedAccount.id,
        amountTolerance: 100,
        cadence: "monthly",
        confidence: 10_000,
        displayName: "Unrelated overdue income",
        expectedAmount: 10_000,
        nextExpectedDate: "2026-07-01",
        payer: "Unrelated payer",
        source: "user",
        status: "active",
        userId,
      })
      .returning();
    if (!stream) throw new Error("Scoped cashflow fixture was not saved.");
    await expect(
      service.refreshCashflowForUser(userId, targetScope, targetContext, async () => {}),
    ).resolves.toEqual({ refreshed: false });
    await expect(
      database.db
        .select({ id: financeAlerts.id })
        .from(financeAlerts)
        .where(eq(financeAlerts.incomeStreamId, stream.id)),
    ).resolves.toEqual([]);
  });

  it("uses the null Item cursor and one Item claim despite divergent account shadows", async () => {
    const userId = crypto.randomUUID();
    await database.db.insert(users).values({
      id: userId,
      displayName: "Canonical Plaid item cursor",
      email: `canonical-item-${userId}@example.com`,
      passwordHash: "unused",
      planningTimezone: "UTC",
    });
    const observedCursors: unknown[] = [];
    let releaseProvider!: () => void;
    const providerRelease = new Promise<void>((resolvePromise) => {
      releaseProvider = resolvePromise;
    });
    let providerStarted!: () => void;
    const providerStart = new Promise<void>((resolvePromise) => {
      providerStarted = resolvePromise;
    });
    const plaid = createPlaidConnector({
      clientId: "client",
      environment: "sandbox",
      fetch: async (input, init) => {
        const path = new URL(String(input)).pathname;
        if (path === "/item/public_token/exchange") {
          return Response.json({ access_token: "canonical-access", item_id: "canonical-item" });
        }
        if (path === "/accounts/get") {
          return Response.json({
            accounts: [
              {
                account_id: "canonical-account-one",
                balances: { current: 100, iso_currency_code: "USD" },
                name: "Canonical one",
                official_name: null,
              },
              {
                account_id: "canonical-account-two",
                balances: { current: 200, iso_currency_code: "USD" },
                name: "Canonical two",
                official_name: null,
              },
            ],
          });
        }
        if (path === "/transactions/sync") {
          const body = JSON.parse(String(init?.body)) as { cursor?: unknown };
          observedCursors.push(body.cursor ?? null);
          providerStarted();
          await providerRelease;
          return Response.json({
            added: [
              {
                account_id: "canonical-account-two",
                amount: 31,
                date: "2026-07-19",
                iso_currency_code: "USD",
                merchant_name: "Sibling item transaction",
                name: "SIBLING ITEM TRANSACTION",
                pending: false,
                personal_finance_category: null,
                transaction_id: "canonical-sibling-transaction",
              },
            ],
            has_more: false,
            modified: [],
            next_cursor: "canonical-final",
            removed: [],
          });
        }
        return Response.json({}, { status: 404 });
      },
      secret: "secret",
    });
    const firstRuntime = createFinanceService({
      db: database.db,
      encryptionKey: key,
      now: () => now,
      plaid,
    });
    const secondRuntime = createFinanceService({
      db: database.db,
      encryptionKey: key,
      now: () => now,
      plaid,
    });
    const connected = await firstRuntime.exchangePlaidToken(
      { institution: "Canonical Bank", publicToken: "canonical-token" },
      { principal: financePrincipal(userId), requestId: "canonical-connect" },
    );
    const ordered = [...connected].sort((left, right) => left.id.localeCompare(right.id));
    const target = ordered[0];
    const oldest = ordered[1];
    const providerSibling = connected.find((account) => account.name === "Canonical two");
    if (!target || !oldest || !providerSibling)
      throw new Error("Canonical Plaid siblings were not saved.");
    await database.db
      .update(financeAccounts)
      .set({
        lastSyncedAt: new Date("2026-07-19T11:00:00.000Z"),
        nextSyncAt: now,
        syncCursor: "newer-cursor",
        syncState: "stale",
      })
      .where(eq(financeAccounts.id, target.id));
    await database.db
      .update(financeAccounts)
      .set({
        lastSyncedAt: new Date("2026-07-18T11:00:00.000Z"),
        nextSyncAt: now,
        syncCursor: "oldest-cursor",
        syncState: "stale",
      })
      .where(eq(financeAccounts.id, oldest.id));
    const runId = crypto.randomUUID();
    const claimId = crypto.randomUUID();
    const scope = { type: "target", entityType: "finance_account", id: target.id } as const;
    await database.db.insert(workspaceMaintenanceRuns).values({
      domain: "finances",
      id: runId,
      leaseClaimId: claimId,
      leaseExpiresAt: new Date(Date.now() + 60_000),
      rulebookVersion: "rules:v1",
      scope,
      status: "running",
      userId,
    });
    const context = {
      maintenance: {
        idempotencyKey: "finances:rules:v1:synchronize",
        policy: "approved_rule" as const,
        rulebookVersion: "rules:v1",
        runId,
      },
      maintenanceClaim: { claimId, runId },
      principal: financeAgentPrincipal(userId),
      requestId: `maintenance:${runId}:synchronize`,
    };

    const first = firstRuntime.syncPlaidAccount(target.id, context, async () => {}, scope);
    await providerStart;
    await expect(
      secondRuntime.syncPlaidAccount(oldest.id, context, async () => {}, scope),
    ).rejects.toThrow("already synchronizing");
    releaseProvider();
    await expect(first).resolves.toEqual({ changed: 1 });

    expect(observedCursors).toEqual([null]);
    await expect(
      database.db
        .select({ cursor: financeAccounts.syncCursor })
        .from(financeAccounts)
        .where(inArray(financeAccounts.id, [target.id, oldest.id]))
        .orderBy(financeAccounts.id),
    ).resolves.toEqual([{ cursor: "canonical-final" }, { cursor: "canonical-final" }]);
    await expect(
      database.db
        .select({ accountId: financeTransactions.accountId })
        .from(financeTransactions)
        .where(eq(financeTransactions.providerTransactionId, "canonical-sibling-transaction")),
    ).resolves.toEqual([{ accountId: providerSibling.id }]);
  });

  it("fences reconciliation mutations when another runtime takes the maintenance run", async () => {
    const [maintenanceUser] = await database.db
      .insert(users)
      .values({
        displayName: "Maintenance reconciliation fence",
        email: `finance-reconcile-fence-${crypto.randomUUID()}@example.com`,
        passwordHash: "unused",
        planningTimezone: "UTC",
      })
      .returning();
    if (!maintenanceUser) throw new Error("Maintenance reconciliation user was not created.");
    const service = createFinanceService({ db: database.db, now: () => now });
    const userContext = {
      principal: financePrincipal(maintenanceUser.id),
      requestId: "maintenance-reconciliation-fixture",
    };
    const cash = await service.createAccount(
      { balance: 0, institution: "Bank", kind: "cash", name: "Checking", provider: "manual" },
      userContext,
    );
    const card = await service.createAccount(
      { balance: 0, institution: "Card", kind: "debt", name: "Card", provider: "manual" },
      userContext,
    );
    const outgoing = await service.createTransaction(
      {
        accountId: cash.id,
        amount: 200,
        category: "LOAN_PAYMENTS",
        categoryConfidence: null,
        date: "2026-07-18",
        direction: "expense",
        merchant: "Card payment",
        notes: null,
      },
      userContext,
    );
    const incoming = await service.createTransaction(
      {
        accountId: card.id,
        amount: 200,
        category: "LOAN_PAYMENTS",
        categoryConfidence: null,
        date: "2026-07-19",
        direction: "income",
        merchant: "Payment thank you",
        notes: null,
      },
      userContext,
    );
    await database.db
      .update(financeTransactions)
      .set({ categoryDecidedAt: null, categorySource: "provider", currencyCode: "USD" })
      .where(inArray(financeTransactions.id, [outgoing.id, incoming.id]));
    const runId = crypto.randomUUID();
    const claimId = crypto.randomUUID();
    await database.db.insert(workspaceMaintenanceRuns).values({
      domain: "finances",
      id: runId,
      leaseClaimId: claimId,
      leaseExpiresAt: new Date(Date.now() + 60_000),
      rulebookVersion: "rules:v1",
      scope: { type: "all_outstanding" },
      status: "running",
      userId: maintenanceUser.id,
    });
    const agentContext = {
      maintenance: {
        idempotencyKey: "finances:rules:v1:reconcile",
        policy: "approved_rule" as const,
        rulebookVersion: "rules:v1",
        runId,
      },
      maintenanceClaim: { claimId, runId },
      principal: financeAgentPrincipal(maintenanceUser.id),
      requestId: `maintenance:${runId}:reconcile`,
    };
    const auditsBefore = await database.db
      .select({ id: auditEvents.id })
      .from(auditEvents)
      .where(eq(auditEvents.requestId, agentContext.requestId));

    await expect(
      service.reconcileTransfersForUser(
        maintenanceUser.id,
        { type: "all_outstanding" },
        agentContext,
        async () => {
          await database.db
            .update(workspaceMaintenanceRuns)
            .set({ leaseExpiresAt: new Date(0) })
            .where(eq(workspaceMaintenanceRuns.id, runId));
        },
      ),
    ).rejects.toMatchObject({ code: "conflict" });
    await expect(
      database.db
        .select({ reconciliationStatus: financeTransactions.reconciliationStatus })
        .from(financeTransactions)
        .where(inArray(financeTransactions.id, [outgoing.id, incoming.id]))
        .orderBy(financeTransactions.id),
    ).resolves.toEqual([
      { reconciliationStatus: "not_applicable" },
      { reconciliationStatus: "not_applicable" },
    ]);
    await expect(
      database.db
        .select({ id: auditEvents.id })
        .from(auditEvents)
        .where(eq(auditEvents.requestId, agentContext.requestId)),
    ).resolves.toEqual(auditsBefore);
  });

  it("fences question mutations when a second runtime takes the maintenance run mid-step", async () => {
    const [maintenanceUser] = await database.db
      .insert(users)
      .values({
        displayName: "Maintenance question fence",
        email: `finance-question-fence-${crypto.randomUUID()}@example.com`,
        passwordHash: "unused",
        planningTimezone: "UTC",
      })
      .returning();
    if (!maintenanceUser) throw new Error("Maintenance question user was not created.");
    const service = createFinanceService({ db: database.db, now: () => now });
    const userContext = {
      principal: financePrincipal(maintenanceUser.id),
      requestId: "maintenance-question-fixture",
    };
    const account = await service.createAccount(
      { balance: 0, institution: "Bank", kind: "cash", name: "Checking", provider: "manual" },
      userContext,
    );
    for (let index = 0; index < 2; index += 1) {
      await service.createTransaction(
        {
          accountId: account.id,
          amount: 42,
          category: null,
          categoryConfidence: null,
          date: "2026-07-18",
          direction: "expense",
          merchant: "Same purchase",
          notes: null,
        },
        { ...userContext, requestId: `${userContext.requestId}:${index}` },
      );
    }
    const runId = crypto.randomUUID();
    const claimId = crypto.randomUUID();
    await database.db.insert(workspaceMaintenanceRuns).values({
      domain: "finances",
      id: runId,
      leaseClaimId: claimId,
      leaseExpiresAt: new Date(Date.now() + 60_000),
      rulebookVersion: "rules:v1",
      scope: { type: "all_outstanding" },
      status: "running",
      userId: maintenanceUser.id,
    });
    const requestId = `maintenance:${runId}:questions`;
    const agentContext = {
      maintenance: {
        idempotencyKey: "finances:rules:v1:questions",
        policy: "approved_rule" as const,
        rulebookVersion: "rules:v1",
        runId,
      },
      maintenanceClaim: { claimId, runId },
      principal: financeAgentPrincipal(maintenanceUser.id),
      requestId,
    };
    let progressCalls = 0;

    await expect(
      service.refreshMaintenanceQuestionsForUser(
        maintenanceUser.id,
        { type: "all_outstanding" },
        agentContext,
        async () => {
          progressCalls += 1;
          if (progressCalls === 2) {
            await database.db
              .update(workspaceMaintenanceRuns)
              .set({ leaseExpiresAt: new Date(0) })
              .where(eq(workspaceMaintenanceRuns.id, runId));
          }
        },
      ),
    ).rejects.toMatchObject({ code: "conflict" });
    await expect(
      database.db
        .select({ id: financeReviewCases.id })
        .from(financeReviewCases)
        .where(eq(financeReviewCases.userId, maintenanceUser.id)),
    ).resolves.toEqual([]);
    await expect(
      database.db
        .select({ id: auditEvents.id })
        .from(auditEvents)
        .where(eq(auditEvents.requestId, requestId)),
    ).resolves.toEqual([]);
  });

  it("repairs legacy heuristic transfers in bounded resumable claim-fenced slices", async () => {
    const userId = crypto.randomUUID();
    await database.db.insert(users).values({
      id: userId,
      displayName: "Legacy transfer repair",
      email: `legacy-transfer-${userId}@example.com`,
      passwordHash: "unused",
      planningTimezone: "UTC",
    });
    const service = createFinanceService({ db: database.db, now: () => now });
    const userContext = { principal: financePrincipal(userId), requestId: "legacy-transfer-setup" };
    const account = await service.createAccount(
      { balance: null, institution: "SoFi", name: "Checking", provider: "manual" },
      userContext,
    );
    await database.db
      .update(financeAccounts)
      .set({ provider: "plaid", providerAccountId: "legacy-account" })
      .where(eq(financeAccounts.id, account.id));
    await database.db.insert(financeTransactions).values([
      ...Array.from({ length: 205 }, (_, index) => ({
        accountId: account.id,
        amount: 10_000 + index,
        category: "Transfers",
        categorySource: "provider" as const,
        direction: index === 2 ? ("expense" as const) : ("transfer" as const),
        merchant: index === 1 ? "From Checking Vault" : `SoFi Vault Transfer ${index}`,
        needsReview: false,
        pending: false,
        providerCategory:
          index === 0 || index === 1 ? null : index % 2 === 0 ? "TRANSFER_OUT" : "TRANSFER_IN",
        providerCategoryDetailed: index === 0 ? "TRANSFER_IN" : null,
        providerDirection: index % 2 === 0 ? ("expense" as const) : ("income" as const),
        providerTransactionId: `legacy-transfer-${index}`,
        reconciliationStatus: "confirmed" as const,
        transactionDate: "2026-07-01",
        userId,
      })),
      {
        accountId: account.id,
        amount: 20_000,
        category: "Transfers",
        categoryDecidedAt: now,
        categorySource: "user" as const,
        direction: "transfer" as const,
        merchant: "SoFi Vault Human Confirmed",
        needsReview: false,
        pending: false,
        providerCategory: "TRANSFER_OUT",
        providerDirection: "expense" as const,
        providerTransactionId: "legacy-human-confirmed",
        reconciliationStatus: "confirmed" as const,
        transactionDate: "2026-07-01",
        userId,
      },
      {
        accountId: account.id,
        amount: 30_000,
        category: "Transfers",
        categorySource: "rule" as const,
        direction: "transfer" as const,
        merchant: "SoFi Vault Invariant Matched",
        needsReview: false,
        pending: false,
        providerCategory: "TRANSFER_OUT",
        providerDirection: "expense" as const,
        providerTransactionId: "legacy-invariant-matched",
        reconciliationStatus: "matched" as const,
        transactionDate: "2026-07-01",
        transferGroupId: crypto.randomUUID(),
        userId,
      },
      {
        accountId: account.id,
        amount: 40_000,
        category: "Transfers",
        categorySource: "provider" as const,
        direction: "transfer" as const,
        merchant: "SoFi Vault Pending",
        needsReview: false,
        pending: true,
        providerCategory: "TRANSFER_OUT",
        providerDirection: "expense" as const,
        providerTransactionId: "legacy-pending",
        reconciliationStatus: "confirmed" as const,
        transactionDate: "2026-07-01",
        userId,
      },
    ]);
    const runId = crypto.randomUUID();
    const claimId = crypto.randomUUID();
    await database.db.insert(workspaceMaintenanceRuns).values({
      domain: "finances",
      id: runId,
      leaseClaimId: claimId,
      leaseExpiresAt: new Date(Date.now() + 60_000),
      rulebookVersion: "rules:v1",
      scope: { type: "all_outstanding" },
      status: "running",
      userId,
    });
    const maintenanceContext = {
      maintenance: {
        idempotencyKey: "finances:rules:v1:reconcile:legacy-transfer-repair",
        policy: "approved_rule" as const,
        rulebookVersion: "rules:v1",
        runId,
      },
      maintenanceClaim: { claimId, runId },
      principal: financeAgentPrincipal(userId),
      requestId: `maintenance:${runId}:reconcile`,
    };

    const first = await service.repairHeuristicTransfersForUser(
      userId,
      { type: "all_outstanding" },
      undefined,
      maintenanceContext,
      async () => {},
    );
    expect(first).toMatchObject({ complete: false, inspected: 100 });
    expect(first.repaired).toBeGreaterThan(0);
    const replay = await service.repairHeuristicTransfersForUser(
      userId,
      { type: "all_outstanding" },
      undefined,
      maintenanceContext,
      async () => {},
    );
    expect(replay).toMatchObject({ complete: false, inspected: 100, repaired: 100 });
    expect(replay.nextCursor).not.toBe(first.nextCursor);
    let cursor = replay.nextCursor;
    let repaired = first.repaired + replay.repaired;
    let slices = 2;
    while (cursor) {
      const page = await service.repairHeuristicTransfersForUser(
        userId,
        { type: "all_outstanding" },
        cursor,
        maintenanceContext,
        async () => {},
      );
      repaired += page.repaired;
      slices += 1;
      cursor = page.nextCursor;
    }
    expect({ repaired, slices }).toEqual({ repaired: 206, slices: 3 });
    const rows = await database.db
      .select()
      .from(financeTransactions)
      .where(eq(financeTransactions.userId, userId));
    expect(rows.filter((row) => row.providerTransactionId?.startsWith("legacy-transfer-"))).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          direction: expect.stringMatching(/expense|income/),
          needsReview: true,
          reconciliationStatus: "candidate",
          transferGroupId: null,
        }),
      ]),
    );
    expect(
      rows.find((row) => row.providerTransactionId === "legacy-human-confirmed"),
    ).toMatchObject({
      direction: "transfer",
      needsReview: false,
      reconciliationStatus: "confirmed",
    });
    expect(
      rows.find((row) => row.providerTransactionId === "legacy-invariant-matched"),
    ).toMatchObject({ direction: "transfer", needsReview: false, reconciliationStatus: "matched" });
    const pendingRepair = rows.find((row) => row.providerTransactionId === "legacy-pending");
    expect(pendingRepair).toMatchObject({
      direction: "expense",
      needsReview: true,
      pending: true,
      reconciliationStatus: "candidate",
    });
    if (!pendingRepair) throw new Error("The pending repair fixture was not found.");
    await expect(
      database.db
        .select({ id: financeReviewCases.id })
        .from(financeReviewCases)
        .where(eq(financeReviewCases.transactionId, pendingRepair.id)),
    ).resolves.toEqual([]);
    await expect(service.listOverview(userId, "2026-07")).resolves.toMatchObject({
      spendingThisMonth: 10_405.06,
    });
    const repairAudits = await database.db
      .select({ action: auditEvents.action, after: auditEvents.after })
      .from(auditEvents)
      .where(eq(auditEvents.requestId, maintenanceContext.requestId));
    expect(
      repairAudits.filter((row) => row.action === "finance.transfer_heuristic_repaired"),
    ).toHaveLength(206);
    expect(repairAudits.filter((row) => row.action === "finance.review_queued")).toHaveLength(205);
    expect(repairAudits[0]?.after).toMatchObject({
      maintenance: maintenanceContext.maintenance,
      source: { provider: "plaid", sourceType: "finance_transaction" },
    });
    await expect(
      service.summarizeMaintenanceEffectsForRun(userId, maintenanceContext.maintenance.runId),
    ).resolves.toMatchObject({ heuristicTransfersRepaired: 206, questions: 205 });
    await database.db
      .update(financeTransactions)
      .set({ pending: false, updatedAt: new Date(now.getTime() + 1_000) })
      .where(eq(financeTransactions.id, pendingRepair.id));
    await expect(
      service.reconcileTransfersForUser(
        userId,
        { type: "target", entityType: "finance_transaction", id: pendingRepair.id },
        maintenanceContext,
      ),
    ).resolves.toEqual({ paired: 0, transfers: 0 });
    await expect(
      database.db
        .select({ reason: financeReviewCases.reason })
        .from(financeReviewCases)
        .where(eq(financeReviewCases.transactionId, pendingRepair.id)),
    ).resolves.toEqual([{ reason: "possible_transfer" }]);
    await expect(
      service.repairHeuristicTransfersForUser(
        userId,
        { type: "all_outstanding" },
        undefined,
        maintenanceContext,
        async () => {},
      ),
    ).resolves.toEqual({ complete: true, inspected: 0, nextCursor: null, repaired: 0 });
    const repairedTransaction = rows.find(
      (row) => row.providerTransactionId === "legacy-transfer-0",
    );
    if (!repairedTransaction) throw new Error("The repaired transfer fixture was not found.");
    const [repairedReview] = await database.db
      .select({ id: financeReviewCases.id })
      .from(financeReviewCases)
      .where(eq(financeReviewCases.transactionId, repairedTransaction.id));
    if (!repairedReview) throw new Error("The repaired transfer review fixture was not found.");
    for (const scope of [
      { end: "2026-07-31", start: "2026-07-01", type: "window" as const },
      { entityType: "finance_account" as const, id: account.id, type: "target" as const },
      {
        entityType: "finance_transaction" as const,
        id: repairedTransaction.id,
        type: "target" as const,
      },
      {
        entityType: "finance_review_case" as const,
        id: repairedReview.id,
        type: "target" as const,
      },
    ]) {
      await expect(
        service.repairHeuristicTransfersForUser(
          userId,
          scope,
          undefined,
          maintenanceContext,
          async () => {},
        ),
      ).resolves.toEqual({ complete: true, inspected: 0, nextCursor: null, repaired: 0 });
    }
    const manualOnlyUserId = crypto.randomUUID();
    await database.db.insert(users).values({
      id: manualOnlyUserId,
      displayName: "Manual repair noop",
      email: `manual-repair-${manualOnlyUserId}@example.com`,
      passwordHash: "unused",
      planningTimezone: "UTC",
    });
    await service.createAccount(
      { balance: null, institution: "Cash", name: "Wallet", provider: "manual" },
      { principal: financePrincipal(manualOnlyUserId), requestId: "manual-repair-setup" },
    );
    const manualRunId = crypto.randomUUID();
    const manualClaimId = crypto.randomUUID();
    await database.db.insert(workspaceMaintenanceRuns).values({
      domain: "finances",
      id: manualRunId,
      leaseClaimId: manualClaimId,
      leaseExpiresAt: new Date(Date.now() + 60_000),
      rulebookVersion: "rules:v1",
      scope: { type: "all_outstanding" },
      status: "running",
      userId: manualOnlyUserId,
    });
    await expect(
      service.repairHeuristicTransfersForUser(
        manualOnlyUserId,
        { type: "all_outstanding" },
        undefined,
        {
          ...maintenanceContext,
          maintenance: { ...maintenanceContext.maintenance, runId: manualRunId },
          maintenanceClaim: { claimId: manualClaimId, runId: manualRunId },
          principal: financeAgentPrincipal(manualOnlyUserId),
          requestId: `maintenance:${manualRunId}:reconcile`,
        },
        async () => {},
      ),
    ).resolves.toEqual({ complete: true, inspected: 0, nextCursor: null, repaired: 0 });
  });

  it("counts only newly created maintenance questions when an existing review is refreshed", async () => {
    const userId = crypto.randomUUID();
    await database.db.insert(users).values({
      id: userId,
      displayName: "Existing question refresh",
      email: `existing-question-${userId}@example.com`,
      passwordHash: "unused",
      planningTimezone: "UTC",
    });
    const service = createFinanceService({ db: database.db, now: () => now });
    const userContext = {
      principal: financePrincipal(userId),
      requestId: "existing-question-fixture",
    };
    const account = await service.createAccount(
      { balance: 0, institution: "Cash", kind: "cash", name: "Wallet", provider: "manual" },
      userContext,
    );
    const item = await service.createTransaction(
      {
        accountId: account.id,
        amount: 17,
        category: null,
        categoryConfidence: null,
        date: "2026-07-19",
        direction: "expense",
        merchant: "Unfamiliar purchase",
        notes: null,
      },
      userContext,
    );
    await database.db.insert(financeReviewCases).values({
      rationale: "An older review rationale.",
      reason: "one_time",
      status: "open",
      transactionId: item.id,
      userId,
    });
    const runId = crypto.randomUUID();
    const claimId = crypto.randomUUID();
    await database.db.insert(workspaceMaintenanceRuns).values({
      domain: "finances",
      id: runId,
      leaseClaimId: claimId,
      leaseExpiresAt: new Date(Date.now() + 60_000),
      rulebookVersion: "rules:v1",
      scope: { type: "target", entityType: "finance_transaction", id: item.id },
      status: "running",
      userId,
    });
    const maintenanceContext = {
      maintenance: {
        idempotencyKey: "finances:rules:v1:questions",
        policy: "approved_rule" as const,
        rulebookVersion: "rules:v1",
        runId,
      },
      maintenanceClaim: { claimId, runId },
      principal: financeAgentPrincipal(userId),
      requestId: `maintenance:${runId}:questions`,
    };

    await expect(
      service.refreshMaintenanceQuestionsForUser(
        userId,
        { type: "target", entityType: "finance_transaction", id: item.id },
        maintenanceContext,
      ),
    ).resolves.toEqual({ created: 0, total: 1 });
    await expect(
      database.db
        .select({ before: auditEvents.before })
        .from(auditEvents)
        .where(
          and(
            eq(auditEvents.requestId, maintenanceContext.requestId),
            eq(auditEvents.action, "finance.review_queued"),
          ),
        ),
    ).resolves.toEqual([{ before: expect.objectContaining({ id: expect.any(String) }) }]);
    await expect(service.summarizeMaintenanceEffectsForRun(userId, runId)).resolves.toMatchObject({
      questions: 0,
    });
  });

  it("bounds maintenance proposals and keeps ambiguous transfer matches as questions", async () => {
    const [maintenanceUser] = await database.db
      .insert(users)
      .values({
        displayName: "Maintenance operations",
        email: `finance-operations-${crypto.randomUUID()}@example.com`,
        passwordHash: "unused",
        planningTimezone: "UTC",
      })
      .returning();
    if (!maintenanceUser) throw new Error("Maintenance operations user was not created.");
    let maintenanceNow = now;
    const service = createFinanceService({ db: database.db, now: () => maintenanceNow });
    const context = {
      principal: financePrincipal(maintenanceUser.id),
      requestId: "maintenance-operations",
    };
    const agentContext = {
      maintenance: {
        idempotencyKey: "finances:rules:v1:maintenance-test",
        policy: "approved_rule" as const,
        rulebookVersion: "rules:v1",
        runId: "11111111-1111-4111-8111-111111111111",
      },
      principal: financeAgentPrincipal(maintenanceUser.id),
      requestId: "maintenance:11111111-1111-4111-8111-111111111111:maintenance-test",
    };
    const cash = await service.createAccount(
      { balance: 1_000, institution: "Bank", kind: "cash", name: "Checking", provider: "manual" },
      context,
    );
    const debtOne = await service.createAccount(
      { balance: -200, institution: "Card", kind: "debt", name: "Card one", provider: "manual" },
      context,
    );
    const debtTwo = await service.createAccount(
      { balance: -100, institution: "Card", kind: "debt", name: "Card two", provider: "manual" },
      context,
    );
    const foreignAccount = await service.createAccount(
      { balance: 10, institution: "Elsewhere", name: "Foreign", provider: "manual" },
      { principal: financePrincipal(userId), requestId: "maintenance-foreign-account" },
    );
    for (const id of [crypto.randomUUID(), foreignAccount.id]) {
      await expect(
        service.reconcileTransfersForUser(maintenanceUser.id, {
          type: "target",
          entityType: "finance_account",
          id,
        }),
      ).rejects.toMatchObject({ code: "not_found" });
      await expect(
        service.refreshMaintenanceQuestionsForUser(maintenanceUser.id, {
          type: "target",
          entityType: "finance_account",
          id,
        }),
      ).rejects.toMatchObject({ code: "not_found" });
    }
    const pending = await service.createTransaction(
      {
        accountId: cash.id,
        amount: 10,
        category: null,
        categoryConfidence: null,
        date: "2026-07-19",
        direction: "expense",
        merchant: "Whole Foods",
        notes: null,
      },
      context,
    );
    const rentRuleCandidate = await service.createTransaction(
      {
        accountId: cash.id,
        amount: 1_500,
        category: null,
        categoryConfidence: null,
        date: "2026-07-19",
        direction: "expense",
        merchant: "Lee Tackman",
        notes: null,
      },
      context,
    );
    await database.db
      .update(financeTransactions)
      .set({
        category: null,
        categoryConfidence: null,
        categoryDecidedAt: null,
        categoryId: null,
        categorySource: null,
        needsReview: true,
      })
      .where(eq(financeTransactions.id, rentRuleCandidate.id));
    await database.db
      .update(financeTransactions)
      .set({
        category: null,
        categoryConfidence: null,
        categoryId: null,
        categorySource: null,
        needsReview: true,
        pending: true,
      })
      .where(eq(financeTransactions.id, pending.id));

    const page = await service.proposeOutstandingCategorizations(maintenanceUser.id, {
      type: "window",
      start: "2026-07-19",
      end: "2026-07-19",
    });
    expect(page.items.length).toBeLessThanOrEqual(50);
    expect(page.items.every((item) => item.transaction.date === "2026-07-19")).toBe(true);
    const pendingProposal = page.items.find((item) => item.transaction.id === pending.id);
    if (!pendingProposal?.suggestedCategory) {
      throw new Error("Pending categorization proposal was not prepared.");
    }
    const pendingDecision = {
      categoryId: pendingProposal.suggestedCategory.id,
      confidence: pendingProposal.confidence,
      expectedTransactionUpdatedAt: pendingProposal.transaction.updatedAt,
      learnMerchant: "never" as const,
      rationale: pendingProposal.rationale,
      transactionId: pending.id,
    };
    await expect(
      service.applyApprovedRules(
        { decisions: [] },
        { principal: financePrincipal(maintenanceUser.id), requestId: "maintenance-rule-human" },
      ),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      service.applyApprovedRules(
        { decisions: [{ ...pendingDecision, learnMerchant: "always" }] },
        agentContext,
      ),
    ).rejects.toMatchObject({ code: "invalid_request" });
    await expect(
      service.applyApprovedRules({ decisions: [pendingDecision] }, agentContext),
    ).rejects.toMatchObject({ code: "invalid_request" });
    await expect(
      service.applyApprovedOneOffs(
        {
          decisions: [
            {
              categoryId: pendingProposal.suggestedCategory.id,
              confidence: pendingProposal.confidence,
              expectedTransactionUpdatedAt: pendingProposal.transaction.updatedAt,
              learnMerchant: "never",
              rationale: pendingProposal.rationale,
              transactionId: pending.id,
            },
          ],
        },
        agentContext,
      ),
    ).rejects.toMatchObject({ code: "invalid_request" });

    const outgoing = await service.createTransaction(
      {
        accountId: cash.id,
        amount: 125,
        category: "LOAN_PAYMENTS",
        categoryConfidence: null,
        date: "2026-07-18",
        direction: "expense",
        merchant: "CARD PAYMENT",
        notes: null,
      },
      context,
    );
    const incomingOne = await service.createTransaction(
      {
        accountId: debtOne.id,
        amount: 125,
        category: "LOAN_PAYMENTS",
        categoryConfidence: null,
        date: "2026-07-19",
        direction: "income",
        merchant: "CARD PAYMENT",
        notes: null,
      },
      context,
    );
    const incomingTwo = await service.createTransaction(
      {
        accountId: debtTwo.id,
        amount: 125,
        category: "LOAN_PAYMENTS",
        categoryConfidence: null,
        date: "2026-07-20",
        direction: "income",
        merchant: "CARD PAYMENT",
        notes: null,
      },
      context,
    );
    await database.db
      .update(financeTransactions)
      .set({ categoryDecidedAt: null, categorySource: "provider", currencyCode: "USD" })
      .where(inArray(financeTransactions.id, [outgoing.id, incomingOne.id, incomingTwo.id]));

    await expect(
      service.reconcileTransfersForUser(
        maintenanceUser.id,
        { type: "all_outstanding" },
        agentContext,
      ),
    ).resolves.toEqual({ paired: 0, transfers: 0 });
    const ambiguous = await database.db
      .select({
        id: financeReviewCases.id,
        reason: financeReviewCases.reason,
        transactionId: financeReviewCases.transactionId,
        updatedAt: financeReviewCases.updatedAt,
      })
      .from(financeReviewCases)
      .where(
        and(
          eq(financeReviewCases.userId, maintenanceUser.id),
          eq(financeReviewCases.status, "open"),
        ),
      );
    expect(ambiguous.some((review) => review.reason === "possible_transfer")).toBe(true);
    const ambiguousTransactions = await database.db
      .select({ id: financeTransactions.id, updatedAt: financeTransactions.updatedAt })
      .from(financeTransactions)
      .where(inArray(financeTransactions.id, [outgoing.id, incomingOne.id, incomingTwo.id]))
      .orderBy(financeTransactions.id);
    const transferReview = ambiguous.find(
      (review) => review.reason === "possible_transfer" && review.transactionId === outgoing.id,
    );
    if (!transferReview) throw new Error("The outgoing transfer question was not created.");
    const targetTransactionPage = await service.proposeOutstandingCategorizations(
      maintenanceUser.id,
      { type: "target", entityType: "finance_transaction", id: outgoing.id },
    );
    expect(targetTransactionPage.items).toHaveLength(1);
    await expect(
      service.proposeOutstandingCategorizations(maintenanceUser.id, {
        type: "target",
        entityType: "finance_review_case",
        id: transferReview.id,
      }),
    ).resolves.toMatchObject({ items: [{ transaction: { id: outgoing.id } }] });
    await expect(
      service.proposeOutstandingCategorizations(maintenanceUser.id, {
        type: "target",
        entityType: "finance_account",
        id: cash.id,
      }),
    ).resolves.toMatchObject({ items: expect.any(Array) });
    await expect(
      service.proposeOutstandingCategorizations(maintenanceUser.id, {
        type: "target",
        entityType: "finance_account",
        id: crypto.randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "not_found" });
    await expect(
      service.proposeOutstandingCategorizations(maintenanceUser.id, {
        type: "target",
        entityType: "finance_budget",
        id: crypto.randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "invalid_request" });
    await expect(
      service.applyApprovedOneOffs(
        { decisions: [] },
        { principal: financePrincipal(maintenanceUser.id), requestId: "maintenance-human" },
      ),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      service.applyApprovedOneOffs(
        {
          decisions: [
            {
              categoryId:
                targetTransactionPage.items[0]?.suggestedCategory?.id ?? crypto.randomUUID(),
              confidence: targetTransactionPage.items[0]?.confidence ?? 1,
              expectedTransactionUpdatedAt:
                targetTransactionPage.items[0]?.transaction.updatedAt ?? outgoing.updatedAt,
              learnMerchant: "always",
              rationale: "Maintenance must not create a durable rule.",
              transactionId: outgoing.id,
            },
          ],
        },
        agentContext,
      ),
    ).rejects.toMatchObject({ code: "invalid_request" });
    const targetProposal = targetTransactionPage.items[0];
    if (!targetProposal?.suggestedCategory) {
      throw new Error("The protected transfer proposal was not prepared.");
    }
    const protectedTransferDecision = {
      categoryId: targetProposal.suggestedCategory.id,
      confidence: targetProposal.confidence,
      expectedTransactionUpdatedAt: targetProposal.transaction.updatedAt,
      learnMerchant: "never" as const,
      rationale: targetProposal.rationale,
      transactionId: outgoing.id,
    };
    await expect(
      service.applyApprovedRules({ decisions: [protectedTransferDecision] }, agentContext),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      service.applyApprovedOneOffs(
        {
          decisions: [
            {
              categoryId: targetProposal.suggestedCategory.id,
              confidence: targetProposal.confidence,
              expectedTransactionUpdatedAt: targetProposal.transaction.updatedAt,
              learnMerchant: "never",
              rationale: targetProposal.rationale,
              transactionId: outgoing.id,
            },
          ],
        },
        agentContext,
      ),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      service.refreshMaintenanceQuestionsForUser(maintenanceUser.id, {
        type: "target",
        entityType: "finance_review_case",
        id: transferReview.id,
      }),
    ).resolves.toMatchObject({ created: 0, total: 1 });
    maintenanceNow = new Date(now.getTime() + 60_000);
    const auditCountBeforeReplay = (
      await database.db
        .select({ id: auditEvents.id })
        .from(auditEvents)
        .where(eq(auditEvents.requestId, agentContext.requestId))
    ).length;
    await service.reconcileTransfersForUser(
      maintenanceUser.id,
      { type: "all_outstanding" },
      agentContext,
    );
    await expect(
      database.db
        .select({
          id: financeReviewCases.id,
          reason: financeReviewCases.reason,
          transactionId: financeReviewCases.transactionId,
          updatedAt: financeReviewCases.updatedAt,
        })
        .from(financeReviewCases)
        .where(
          and(
            eq(financeReviewCases.userId, maintenanceUser.id),
            eq(financeReviewCases.status, "open"),
          ),
        )
        .orderBy(financeReviewCases.id),
    ).resolves.toEqual(ambiguous.toSorted((left, right) => left.id.localeCompare(right.id)));
    await expect(
      database.db
        .select({ id: financeTransactions.id, updatedAt: financeTransactions.updatedAt })
        .from(financeTransactions)
        .where(inArray(financeTransactions.id, [outgoing.id, incomingOne.id, incomingTwo.id]))
        .orderBy(financeTransactions.id),
    ).resolves.toEqual(ambiguousTransactions);
    await expect(
      database.db
        .select({ id: auditEvents.id })
        .from(auditEvents)
        .where(eq(auditEvents.requestId, agentContext.requestId)),
    ).resolves.toHaveLength(auditCountBeforeReplay);

    await database.db.delete(financeTransactions).where(eq(financeTransactions.id, incomingTwo.id));
    await expect(
      service.reconcileTransfersForUser(
        maintenanceUser.id,
        { type: "all_outstanding" },
        agentContext,
      ),
    ).resolves.toEqual({ paired: 1, transfers: 2 });
    const matched = await database.db
      .select({ transferGroupId: financeTransactions.transferGroupId })
      .from(financeTransactions)
      .where(inArray(financeTransactions.id, [outgoing.id, incomingOne.id]));
    expect(matched[0]?.transferGroupId).toBeTruthy();
    expect(matched[1]?.transferGroupId).toBe(matched[0]?.transferGroupId);
    await expect(
      service.applyApprovedRules({ decisions: [protectedTransferDecision] }, agentContext),
    ).resolves.toEqual([
      expect.objectContaining({ applied: false, status: "failed", transactionId: outgoing.id }),
    ]);
    await expect(
      service.proposeOutstandingCategorizations(maintenanceUser.id, {
        type: "target",
        entityType: "finance_transaction",
        id: outgoing.id,
      }),
    ).resolves.toEqual({ items: [], nextCursor: null });
    await expect(
      service.proposeOutstandingCategorizations(maintenanceUser.id, {
        type: "target",
        entityType: "finance_review_case",
        id: transferReview.id,
      }),
    ).resolves.toEqual({ items: [], nextCursor: null });
    await expect(
      service.proposeOutstandingCategorizations(maintenanceUser.id, {
        type: "target",
        entityType: "finance_review_case",
        id: crypto.randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "not_found" });
    await expect(
      service.reconcileTransfersForUser(maintenanceUser.id, {
        type: "target",
        entityType: "finance_budget",
        id: crypto.randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "invalid_request" });
    await expect(
      service.refreshMaintenanceQuestionsForUser(maintenanceUser.id, {
        type: "target",
        entityType: "finance_budget",
        id: crypto.randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "invalid_request" });
    await expect(
      database.db
        .select({ entityId: auditEvents.entityId })
        .from(auditEvents)
        .where(eq(auditEvents.action, "finance.transfer_reconciled")),
    ).resolves.toEqual(
      expect.arrayContaining([{ entityId: outgoing.id }, { entityId: incomingOne.id }]),
    );
    await expect(
      database.db
        .select({ id: financeReviewCases.id })
        .from(financeReviewCases)
        .where(
          and(
            inArray(financeReviewCases.transactionId, [outgoing.id, incomingOne.id]),
            eq(financeReviewCases.status, "open"),
          ),
        ),
    ).resolves.toEqual([]);

    const duplicateOne = await service.createTransaction(
      {
        accountId: cash.id,
        amount: 42,
        category: null,
        categoryConfidence: null,
        date: "2026-07-21",
        direction: "expense",
        merchant: "Unclear duplicate merchant",
        notes: null,
      },
      context,
    );
    const duplicateTwo = await service.createTransaction(
      {
        accountId: cash.id,
        amount: 42,
        category: null,
        categoryConfidence: null,
        date: "2026-07-21",
        direction: "expense",
        merchant: "Unclear duplicate merchant",
        notes: null,
      },
      context,
    );
    const firstQuestionRefresh = await service.refreshMaintenanceQuestionsForUser(
      maintenanceUser.id,
      { type: "window", start: "2026-07-21", end: "2026-07-21" },
      agentContext,
    );
    expect(firstQuestionRefresh.created).toBe(1);
    const duplicateReviews = await database.db
      .select({ id: financeReviewCases.id, reason: financeReviewCases.reason })
      .from(financeReviewCases)
      .where(
        and(
          inArray(financeReviewCases.transactionId, [duplicateOne.id, duplicateTwo.id]),
          eq(financeReviewCases.status, "open"),
        ),
      );
    expect(duplicateReviews).toEqual([expect.objectContaining({ reason: "possible_duplicate" })]);
    maintenanceNow = new Date(now.getTime() + 120_000);
    await expect(
      service.refreshMaintenanceQuestionsForUser(
        maintenanceUser.id,
        {
          type: "window",
          start: "2026-07-21",
          end: "2026-07-21",
        },
        agentContext,
      ),
    ).resolves.toMatchObject({ created: 0, total: 1 });
    await expect(
      database.db
        .select({ id: financeReviewCases.id, reason: financeReviewCases.reason })
        .from(financeReviewCases)
        .where(
          and(
            inArray(financeReviewCases.transactionId, [duplicateOne.id, duplicateTwo.id]),
            eq(financeReviewCases.status, "open"),
          ),
        ),
    ).resolves.toEqual(duplicateReviews);
    await expect(
      service.refreshMaintenanceQuestionsForUser(
        maintenanceUser.id,
        { type: "target", entityType: "finance_account", id: cash.id },
        agentContext,
      ),
    ).resolves.toMatchObject({ total: expect.any(Number) });
    await expect(
      service.refreshMaintenanceQuestionsForUser(
        maintenanceUser.id,
        { type: "target", entityType: "finance_transaction", id: duplicateOne.id },
        agentContext,
      ),
    ).resolves.toMatchObject({ total: expect.any(Number) });
    const attributedAudits = await database.db
      .select({
        action: auditEvents.action,
        after: auditEvents.after,
        entityId: auditEvents.entityId,
      })
      .from(auditEvents)
      .where(eq(auditEvents.requestId, agentContext.requestId));
    expect(attributedAudits.map((audit) => audit.action)).toEqual(
      expect.arrayContaining([
        "finance.rent_rule_applied",
        "finance.review_queued",
        "finance.transfer_candidate_queued",
        "finance.transfer_reconciled",
      ]),
    );
    for (const audit of attributedAudits) {
      expect(audit.after).toMatchObject({
        maintenance: agentContext.maintenance,
        source: { revision: expect.any(String), sourceType: "finance_transaction" },
      });
    }
    const attributedQuestionCount = new Set(
      attributedAudits
        .filter((audit) => audit.action === "finance.review_queued")
        .map((audit) => audit.entityId),
    ).size;
    expect(attributedQuestionCount).toBeGreaterThanOrEqual(4);
    await expect(
      service.summarizeMaintenanceEffectsForRun(maintenanceUser.id, agentContext.maintenance.runId),
    ).resolves.toEqual({
      categorizations: 1,
      duplicateActions: 0,
      heuristicTransfersRepaired: 0,
      questionStepCreations: 0,
      questions: attributedQuestionCount,
      transfers: 2,
    });
    for (const action of [
      "finance.rent_rule_applied",
      "finance.review_queued",
      "finance.transfer_candidate_queued",
    ]) {
      const original = attributedAudits.find((audit) => audit.action === action);
      if (!original) throw new Error(`Missing ${action} audit fixture.`);
      const [fullAudit] = await database.db
        .select()
        .from(auditEvents)
        .where(
          and(eq(auditEvents.requestId, agentContext.requestId), eq(auditEvents.action, action)),
        )
        .limit(1);
      if (!fullAudit) throw new Error(`Missing ${action} audit row.`);
      await database.db.insert(auditEvents).values({
        action: fullAudit.action,
        actorId: fullAudit.actorId,
        actorType: fullAudit.actorType,
        after: fullAudit.after,
        before: fullAudit.before,
        entityId: fullAudit.entityId,
        entityType: fullAudit.entityType,
        requestId: fullAudit.requestId,
        userId: fullAudit.userId,
      });
    }
    await expect(
      service.summarizeMaintenanceEffectsForRun(maintenanceUser.id, agentContext.maintenance.runId),
    ).resolves.toEqual({
      categorizations: 1,
      duplicateActions: 3,
      heuristicTransfersRepaired: 0,
      questionStepCreations: 0,
      questions: attributedQuestionCount,
      transfers: 2,
    });
  });
});
