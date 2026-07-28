import { resolve } from "node:path";
import {
  auditEvents,
  createDatabaseClient,
  type DatabaseClient,
  domainProfiles,
  financeAlerts,
  financeTransactions,
  migrateDatabase,
  users,
} from "@personal-os/database";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { and, eq } from "drizzle-orm";
import { createFinanceService, financeCsvImportErrorMessage } from "./finance-service.js";
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
          : {
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
    await migrateDatabase(database.db, resolve(process.cwd(), "packages/database/migrations"));
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
    ).rejects.toThrow("Direct category edits");
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
        merchant: "Read Only Proposal",
        needsReview: true,
        transactionDate: "2026-07-19",
        userId,
      })
      .returning();
    if (!readOnlyCandidate) throw new Error("Read-only proposal fixture was not created.");
    await service.proposeCategorizations(userId, { limit: 50, review: "needs_review" });
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
    await expect(
      service.applyCategorizations(
        {
          decisions: [
            {
              categoryId: shopping.id,
              confidence: 0.95,
              expectedTransactionUpdatedAt: lowConfidenceCandidate.updatedAt,
              learnMerchant: "suggest",
              rationale: "One confirmation remains below the adaptive threshold.",
              transactionId: lowConfidenceCandidate.id,
            },
          ],
        },
        agentContext,
      ),
    ).resolves.toEqual([
      expect.objectContaining({ applied: false, status: "review_required", threshold: 0.9725 }),
    ]);
    const lowConfidenceAudits = await database.db
      .select({ id: auditEvents.id })
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.action, "finance.categorization_deferred"),
          eq(auditEvents.entityId, lowConfidenceCandidate.id),
        ),
      );
    expect(lowConfidenceAudits).toHaveLength(1);
    const lowConfidenceReview = (await service.listReviewQueue(userId)).find(
      (item) => item.transaction.id === lowConfidenceCandidate.id,
    );
    if (!lowConfidenceReview) throw new Error("Low-confidence review was not created.");
    await service.resolveReview(
      lowConfidenceReview.id,
      {
        action: "recategorize",
        categoryId: shopping.id,
        learnMerchant: "never",
        rationale: "The user accepted the individual category.",
      },
      context,
    );
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
    await expect(
      service.resolveReview(
        transferReview.id,
        {
          action: "not_purchase",
          learnMerchant: "never",
          rationale: "An agent may not confirm this transfer.",
        },
        agentContext,
      ),
    ).rejects.toThrow("ambiguous transfer requires an interactive user session");
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
    await expect(
      service.resolveReview(
        transferReview.id,
        {
          action: "not_purchase",
          learnMerchant: "never",
          rationale: "The user confirmed this is movement between owned accounts.",
        },
        context,
      ),
    ).resolves.toMatchObject({
      applied: true,
      transaction: expect.objectContaining({
        category: "Transfers",
        direction: "transfer",
        needsReview: false,
      }),
    });
    expect(
      (await service.listReviewQueue(userId)).some(
        (item) => item.transaction.id === transferCandidate.id,
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
    expect(overview).toMatchObject({ reviewCount: 3, spendingThisMonth: 79.75 });
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
      "Remove this account from the Finance agent profile",
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
    const context = { principal: financePrincipal(userId), requestId: "plaid-finance" };
    expect(service.plaidAvailable()).toBe(true);
    await expect(service.createPlaidLinkToken(userId)).resolves.toBe("link-token");
    const accounts = await service.exchangePlaidToken(
      { institution: "Plaid Bank", publicToken: "public-token" },
      context,
    );
    expect(accounts).toHaveLength(2);
    const plaidAccount = accounts[0];
    if (!plaidAccount) throw new Error("Plaid checking account was not saved.");
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
      .where(eq(financeTransactions.providerTransactionId, "txn-1"));
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
