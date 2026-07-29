import { cp, mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import {
  auditEvents,
  createDatabaseClient,
  type DatabaseClient,
  domainProfileApprovals,
  domainProfiles,
  financeAccounts,
  financeAlerts,
  financeCategories,
  financeClassificationDecisions,
  financeReviewCases,
  financeTransactions,
  migrateDatabase,
  users,
} from "@personal-os/database";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { and, eq, inArray } from "drizzle-orm";
import { createFinanceService, financeCsvImportErrorMessage } from "./finance-service.js";
import type { Principal } from "./types.js";

const now = new Date("2026-07-19T12:00:00.000Z");
const key = Buffer.alloc(32, 3).toString("base64");

async function migrationsWithout(
  migrationsFolder: string,
  prefix: string,
  excludedTags: string[],
): Promise<string> {
  const folder = await mkdtemp(`${tmpdir()}/${prefix}`);
  await cp(migrationsFolder, folder, { recursive: true });
  for (const tag of excludedTags) await unlink(`${folder}/${tag}.sql`);
  const journalPath = `${folder}/meta/_journal.json`;
  const journal = JSON.parse(await readFile(journalPath, "utf8")) as {
    entries: Array<{ tag: string }>;
  };
  journal.entries = journal.entries.filter((entry) => !excludedTags.includes(entry.tag));
  await writeFile(journalPath, `${JSON.stringify(journal, null, 2)}\n`);
  return folder;
}

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
        AND query NOT LIKE '%pg_stat_activity%'
    `);
    if (Number(result.rows[0]?.count ?? 0) >= expected) return;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 20));
  }
  throw new Error(`Expected at least ${expected} database lock waiter(s).`);
}

function plaidFetch(): typeof globalThis.fetch {
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
      return Response.json({ access_token: "access-token", item_id: "item-1" });
    }
    if (path === "/accounts/get") {
      return Response.json({
        accounts: [
          {
            account_id: "plaid-account-1",
            balances: { current: 91.25 },
            name: "Checking",
            official_name: null,
          },
          {
            account_id: "plaid-account-2",
            balances: { current: null },
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
                  merchant_name: "Acme Bookstore",
                  name: "ACME BOOKSTORE",
                  personal_finance_category: {
                    confidence_level: "HIGH",
                    detailed: "FOOD_AND_DRINK_GROCERIES",
                    primary: "FOOD_AND_DRINK",
                  },
                  transaction_id: "txn-1",
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
                    merchant_name: "Trader Joe's",
                    name: "TRADER JOE'S",
                    pending: true,
                    pending_transaction_id: "pending-txn-1",
                    personal_finance_category: {
                      confidence_level: "VERY_HIGH",
                      detailed: "FOOD_AND_DRINK_GROCERIES",
                      primary: "FOOD_AND_DRINK",
                    },
                    transaction_id: "txn-1",
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
                      merchant_name: "Credit card payment",
                      name: "CREDIT CARD PAYMENT",
                      personal_finance_category: {
                        confidence_level: "VERY_HIGH",
                        detailed: "TRANSFER_OUT_ACCOUNT_TRANSFER",
                        primary: "TRANSFER_OUT",
                      },
                      transaction_id: "txn-late-transfer",
                    },
                  ],
                  has_more: false,
                  modified: [
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
      "0043_finance_default_category_backfill",
    ]);
    await migrateDatabase(database.db, legacyMigrations);
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
    const [upgradeAccount] = await database.db
      .insert(financeAccounts)
      .values({
        institution: "Legacy Bank",
        name: "Legacy checking",
        provider: "manual",
        status: "manual",
        userId: upgradeUser.id,
      })
      .returning();
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
    const approvalMigrations = await migrationsWithout(migrationsFolder, "ilo-finance-approval-", [
      "0043_finance_default_category_backfill",
    ]);
    await migrateDatabase(database.db, approvalMigrations);
    const [migratedProfile] = await database.db
      .select()
      .from(domainProfiles)
      .where(eq(domainProfiles.userId, upgradeUser.id));
    expect(migratedProfile).toMatchObject({ status: "draft", version: 2 });
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
    ).resolves.toEqual([{ providerDirection: "expense" }]);
    await expect(
      database.db
        .select({ providerDirection: financeTransactions.providerDirection })
        .from(financeTransactions)
        .where(eq(financeTransactions.id, legacyManualTransaction.id)),
    ).resolves.toEqual([{ providerDirection: null }]);
    await migrateDatabase(database.db, migrationsFolder);
    await expect(
      database.db
        .select()
        .from(financeCategories)
        .where(eq(financeCategories.userId, upgradeUser.id)),
    ).resolves.toHaveLength(20);
    await Promise.all([
      rm(legacyMigrations, { force: true, recursive: true }),
      rm(approvalMigrations, { force: true, recursive: true }),
    ]);
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
  }, 20_000);

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

  it("excludes vault moves and matched card payments while preserving rent spending", async () => {
    const service = createFinanceService({ db: database.db, now: () => now });
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

    await expect(service.reconcileTransfers(userId)).resolves.toEqual({ paired: 1, transfers: 3 });
    const transactions = await service.listTransactions(userId, { limit: 200, review: "all" });
    expect(transactions.items.find((item) => item.id === vault.id)).toMatchObject({
      category: "Transfers",
      direction: "transfer",
    });
    expect(transactions.items.find((item) => item.id === payment.id)).toMatchObject({
      category: "Transfers",
      direction: "transfer",
    });
    expect(transactions.items.find((item) => item.id === cardPayment.id)).toMatchObject({
      category: "Transfers",
      direction: "transfer",
    });
    expect(transactions.items.find((item) => item.id === rent.id)).toMatchObject({
      category: "RENT_AND_UTILITIES",
      direction: "expense",
    });
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
      now: () => now,
      plaid: {
        clientId: "client",
        encryptionKey: key,
        environment: "sandbox",
        fetch,
        secret: "secret",
      },
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
      failed: 0,
      reasons: [],
      synced: 0,
    });
    const [transaction] = await database.db
      .select()
      .from(financeTransactions)
      .where(
        and(
          eq(financeTransactions.providerTransactionId, "txn-1"),
          eq(financeTransactions.userId, plaidOnlyUser.id),
        ),
      );
    expect(transaction).toMatchObject({
      amount: 2200,
      categoryConfidence: 9850,
      direction: "expense",
      needsReview: false,
      pending: true,
      pendingTransactionId: "pending-txn-1",
      providerCategory: "FOOD_AND_DRINK",
      providerCategoryConfidence: "VERY_HIGH",
    });
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
    await service.updateTransaction(
      postedTransaction.id,
      { category: "Shopping", learnMerchant: false },
      context,
    );
    const categories = await service.listCategories(plaidOnlyUser.id);
    const shopping = categories.find((category) => category.name === "Shopping");
    if (!shopping) throw new Error("The Shopping category was not seeded.");
    const transferReviews = (await service.listReviewQueue(plaidOnlyUser.id)).filter(
      (review) => review.reason === "possible_transfer",
    );
    expect(transferReviews).toHaveLength(3);
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
      reconciliationStatus: "not_applicable",
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
    expect(postedDecision).toHaveLength(1);
    expect(postedDecision[0]).toMatchObject({
      categoryName: "Shopping",
      outcome: "corrected",
      source: "user",
    });
    const blocker = await database.pool.connect();
    let concurrentSync: ReturnType<typeof service.syncPlaidAccount> | undefined;
    let concurrentReconciliation: ReturnType<typeof service.reconcileTransfers> | undefined;
    try {
      await blocker.query("BEGIN");
      await blocker.query("SELECT id FROM finance_transactions WHERE id = $1 FOR UPDATE", [
        postedTransaction.id,
      ]);
      concurrentSync = service.syncPlaidAccount(plaidAccount.id, context);
      await waitForLockWaiters(database.pool, 1);
      concurrentReconciliation = service.reconcileTransfers(plaidOnlyUser.id);
      await waitForLockWaiters(database.pool, 2);
      await blocker.query("COMMIT");
      const [syncResult] = await Promise.all([concurrentSync, concurrentReconciliation]);
      expect(syncResult).toEqual({ changed: 4 });
    } finally {
      await blocker.query("ROLLBACK");
      blocker.release();
      const pendingOperations: Promise<unknown>[] = [];
      if (concurrentSync) pendingOperations.push(concurrentSync);
      if (concurrentReconciliation) pendingOperations.push(concurrentReconciliation);
      await Promise.allSettled(pendingOperations);
    }
    const amountPage = await service.listTransactions(userId, {
      limit: 1,
      review: "all",
      sortBy: "amount",
      sortDirection: "desc",
    });
    expect(amountPage.items).toHaveLength(1);
    expect(amountPage.nextCursor).toEqual(expect.any(String));
    const nextAmountPage = await service.listTransactions(userId, {
      cursor: amountPage.nextCursor as string,
      limit: 1,
      review: "all",
      sortBy: "amount",
      sortDirection: "desc",
    });
    expect(nextAmountPage.items[0]?.id).not.toBe(amountPage.items[0]?.id);
    await expect(
      service.listTransactions(userId, {
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
    const secondExchange = await service.exchangePlaidToken(
      { institution: null, publicToken: "public-token" },
      context,
    );
    expect(secondExchange).toHaveLength(2);
  });

  it("surfaces Plaid API failures without persisting credentials", async () => {
    const service = createFinanceService({
      db: database.db,
      now: () => now,
      plaid: {
        clientId: "client",
        encryptionKey: key,
        environment: "sandbox",
        fetch: vi.fn(async () =>
          Response.json({ error_message: "Bad public token" }, { status: 400 }),
        ),
        secret: "secret",
      },
    });
    await expect(service.createPlaidLinkToken(userId)).rejects.toThrow("Plaid: Bad public token");
    const fallbackService = createFinanceService({
      db: database.db,
      now: () => now,
      plaid: {
        clientId: "client",
        encryptionKey: key,
        environment: "sandbox",
        secret: "secret",
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({}, { status: 500 })),
    );
    await expect(fallbackService.createPlaidLinkToken(userId)).rejects.toThrow(
      "Plaid could not complete that request",
    );
    vi.unstubAllGlobals();
  });
});
