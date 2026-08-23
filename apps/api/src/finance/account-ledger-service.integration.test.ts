import { resolve } from "node:path";
import {
  createDatabaseClient,
  type DatabaseClient,
  financeAccountConnections,
  financeAccounts,
  financeCategories,
  financeTransactions,
  migrateDatabase,
  users,
} from "@personal-os/database";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import type { Principal } from "../types.js";
import { createFinanceAccountService } from "./account-service.js";
import { loadFinanceAuthorization } from "./context.js";
import { createFinanceLedgerService } from "./ledger-service.js";

describe.sequential("canonical Finance account and ledger mutations", () => {
  let container: StartedPostgreSqlContainer;
  let database: DatabaseClient;
  let userId: string;
  let context: Awaited<ReturnType<typeof loadFinanceAuthorization>>;

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
      .values({ displayName: "Ledger", email: "ledger@example.com", passwordHash: "unused" })
      .returning();
    if (!user) throw new Error("Fixture user was not created.");
    userId = user.id;
    const principal: Principal = {
      actorId: "finance-agent",
      actorType: "agent",
      scopes: new Set(["finances:write"]),
      userId,
    };
    context = await loadFinanceAuthorization({ db: database.db, principal, requestId: "ledger" });
  }, 120_000);

  afterAll(async () => {
    await database.close();
    await container.stop();
  });

  it("updates and disconnects an account without deleting its ledger", async () => {
    const now = () => new Date("2026-08-23T20:00:00Z");
    const service = createFinanceAccountService({ db: database.db, now });
    const [account] = await database.db
      .insert(financeAccounts)
      .values({
        encryptedCredentials: { ciphertext: "secret", iv: "iv", tag: "tag", version: 1 },
        institution: "Provider Bank",
        lastSyncedAt: new Date("2026-08-23T19:00:00Z"),
        name: "Checking",
        provider: "plaid",
        providerAccountId: "provider-account",
        providerItemId: "provider-item",
        status: "connected",
        userId,
      })
      .returning();
    if (!account) throw new Error("Account fixture missing.");
    const [transaction] = await database.db
      .insert(financeTransactions)
      .values({
        accountId: account.id,
        amount: 1200,
        direction: "expense",
        merchant: "Historical",
        transactionDate: "2026-08-20",
        userId,
      })
      .returning();
    const [connection] = await database.db
      .insert(financeAccountConnections)
      .values({
        accountIds: [account.id],
        externalHandoffExpiresAt: new Date("2026-08-24T20:00:00Z"),
        externalHandoffUrl: "https://provider.example/connect",
        lastError: { code: "expired", message: "Authorization expired.", retryable: true },
        provider: "plaid",
        status: "connected",
        userId,
      })
      .returning();
    if (!transaction || !connection) throw new Error("Connection fixtures missing.");

    await expect(service.getConnection(userId, connection.id)).resolves.toMatchObject({
      data: {
        accountIds: [account.id],
        externalHandoff: { url: "https://provider.example/connect" },
        lastError: { code: "expired", retryable: true },
        status: "connected",
      },
    });
    const [plainConnection] = await database.db
      .insert(financeAccountConnections)
      .values({ accountIds: [], provider: "plaid", status: "pending", userId })
      .returning();
    if (!plainConnection) throw new Error("Plain connection fixture missing.");
    await expect(service.getConnection(userId, plainConnection.id)).resolves.toMatchObject({
      data: { externalHandoff: null, lastError: null },
    });
    const malformedConnections = await database.db
      .insert(financeAccountConnections)
      .values([
        { accountIds: [], lastError: { code: 1 }, provider: "plaid", status: "failed", userId },
        {
          accountIds: [],
          lastError: { code: "bad", message: 2 },
          provider: "plaid",
          status: "failed",
          userId,
        },
        {
          accountIds: [],
          lastError: { code: "bad", message: "Bad", retryable: "yes" },
          provider: "plaid",
          status: "failed",
          userId,
        },
        {
          accountIds: [],
          externalHandoffUrl: "https://provider.example/retry",
          provider: "plaid",
          status: "pending",
          userId,
        },
      ])
      .returning();
    for (const malformed of malformedConnections) {
      await expect(service.getConnection(userId, malformed.id)).resolves.toMatchObject({
        data: { lastError: null },
      });
    }
    await expect(
      service.update(
        account.id,
        { balance: 2500, idempotencyKey: "account-update", name: "Primary checking" },
        context,
      ),
    ).resolves.toMatchObject({ data: { balance: 2500, name: "Primary checking" } });
    await expect(
      service.update(
        account.id,
        { balance: null, idempotencyKey: "account-clear-balance" },
        context,
      ),
    ).resolves.toMatchObject({ data: { balance: null } });
    await expect(
      service.update(
        "00000000-0000-4000-8000-000000000000",
        { idempotencyKey: "account-missing", name: "Missing" },
        context,
      ),
    ).rejects.toThrow("not found");
    await expect(
      service.disconnect(account.id, "account-disconnect", context),
    ).resolves.toMatchObject({
      communication: { headline: expect.stringContaining("history was preserved") },
    });
    const [preserved] = await database.db.select().from(financeTransactions);
    const [disconnected] = await database.db.select().from(financeAccounts);
    expect(preserved?.id).toBe(transaction.id);
    expect(disconnected).toMatchObject({ encryptedCredentials: null, providerItemId: null });
  });

  it("classifies, links, splits, reads, and safely removes ledger activity", async () => {
    const now = () => new Date("2026-08-24T20:00:00Z");
    const service = createFinanceLedgerService({ db: database.db, now });
    const [account] = await database.db
      .insert(financeAccounts)
      .values({ institution: "Manual", name: "Cash", provider: "manual", userId })
      .returning();
    const categories = await database.db
      .insert(financeCategories)
      .values([
        { group: "Living", name: "Dining", slug: "ledger-dining", userId },
        { group: "Living", name: "Groceries", slug: "ledger-groceries", userId },
      ])
      .returning();
    if (!account || !categories[0] || !categories[1]) throw new Error("Ledger fixtures missing.");
    const rows = await database.db
      .insert(financeTransactions)
      .values([
        {
          accountId: account.id,
          amount: 1500,
          direction: "expense",
          merchant: "Lunch",
          transactionDate: "2026-08-21",
          userId,
        },
        {
          accountId: account.id,
          amount: 2000,
          direction: "expense",
          merchant: "Transfer out",
          transactionDate: "2026-08-21",
          userId,
        },
        {
          accountId: account.id,
          amount: 2000,
          direction: "income",
          merchant: "Transfer in",
          transactionDate: "2026-08-21",
          userId,
        },
        {
          accountId: account.id,
          amount: 3000,
          direction: "expense",
          merchant: "Mixed shop",
          transactionDate: "2026-08-22",
          userId,
        },
        {
          accountId: account.id,
          amount: 500,
          direction: "expense",
          merchant: "Mistake",
          transactionDate: "2026-08-22",
          userId,
        },
      ])
      .returning();
    const [lunch, transferOut, transferIn, mixed, mistake] = rows;
    if (!lunch || !transferOut || !transferIn || !mixed || !mistake)
      throw new Error("Transaction fixtures missing.");
    const userContext = await loadFinanceAuthorization({
      db: database.db,
      principal: {
        actorId: userId,
        actorType: "user",
        scopes: new Set(["finances:write"]),
        userId,
      },
      requestId: "ledger-user",
    });

    await expect(service.getTransaction(userId, lunch.id)).resolves.toMatchObject({
      data: { merchant: "Lunch" },
    });
    await expect(
      service.getTransaction(userId, "00000000-0000-4000-8000-000000000000"),
    ).rejects.toThrow("not found");
    await expect(
      service.classifyTransactions(
        [
          {
            categoryId: categories[0].id,
            confidence: 0.95,
            meaning: "A meal",
            rationale: "Restaurant purchase",
            transactionId: lunch.id,
          },
        ],
        "classify",
        context,
      ),
    ).resolves.toMatchObject({
      data: [expect.objectContaining({ category: "Dining", needsReview: false })],
    });
    await expect(
      service.classifyTransactions(
        [
          {
            categoryId: categories[1].id,
            confidence: 0.4,
            meaning: "Maybe groceries",
            rationale: "User correction with remaining uncertainty.",
            transactionId: lunch.id,
          },
        ],
        "classify-user-correction",
        userContext,
      ),
    ).resolves.toMatchObject({
      data: [expect.objectContaining({ category: "Groceries", needsReview: true })],
    });
    await expect(
      service.classifyTransactions(
        [
          {
            categoryId: "00000000-0000-4000-8000-000000000000",
            confidence: 1,
            meaning: "Missing",
            rationale: "Missing category fixture.",
            transactionId: mistake.id,
          },
        ],
        "classify-missing-category",
        context,
      ),
    ).rejects.toThrow("category was not found");
    await expect(
      service.linkTransactions(
        {
          idempotencyKey: "link",
          rationale: "Same movement between owned accounts",
          relationship: "transfer",
          transactionIds: [transferOut.id, transferIn.id],
        },
        context,
      ),
    ).resolves.toMatchObject({ communication: { headline: expect.stringContaining("transfer") } });
    await expect(
      service.linkTransactions(
        {
          idempotencyKey: "link-again",
          rationale: "Reconfirmed same transfer.",
          relationship: "transfer",
          transactionIds: [transferOut.id, transferIn.id],
        },
        context,
      ),
    ).resolves.toMatchObject({ data: { relationship: "transfer" } });
    await expect(
      service.linkTransactions(
        {
          idempotencyKey: "link-one",
          rationale: "Invalid self-link.",
          relationship: "duplicate",
          transactionIds: [lunch.id, lunch.id],
        },
        context,
      ),
    ).rejects.toThrow("different transactions");
    await expect(
      service.splitTransaction(
        {
          expectedVersion: 1,
          idempotencyKey: "split",
          parts: [
            { amount: 10, categoryId: categories[0].id, meaning: "Prepared food", notes: null },
            { amount: 20, categoryId: categories[1].id, meaning: "Groceries", notes: null },
          ],
          transactionId: mixed.id,
        },
        context,
      ),
    ).resolves.toMatchObject({
      data: [expect.objectContaining({ amount: 10 }), expect.objectContaining({ amount: 20 })],
    });
    await expect(
      service.splitTransaction(
        {
          expectedVersion: 1,
          idempotencyKey: "split-unbalanced",
          parts: [
            { amount: 1, categoryId: categories[0].id, meaning: "One", notes: null },
            { amount: 1, categoryId: categories[1].id, meaning: "Two", notes: null },
          ],
          transactionId: mistake.id,
        },
        context,
      ),
    ).rejects.toThrow("exactly equal");
    const [userSplit] = await database.db
      .insert(financeTransactions)
      .values({
        accountId: account.id,
        amount: 400,
        direction: "expense",
        merchant: "User split",
        transactionDate: "2026-08-24",
        userId,
      })
      .returning();
    if (!userSplit) throw new Error("User split fixture missing.");
    await expect(
      service.splitTransaction(
        {
          expectedVersion: 1,
          idempotencyKey: "split-user",
          parts: [
            { amount: 2, categoryId: categories[0].id, meaning: "One", notes: null },
            { amount: 2, categoryId: categories[1].id, meaning: "Two", notes: null },
          ],
          transactionId: userSplit.id,
        },
        userContext,
      ),
    ).resolves.toMatchObject({ data: [expect.any(Object), expect.any(Object)] });
    await expect(
      service.splitTransaction(
        {
          expectedVersion: 1,
          idempotencyKey: "split-stale",
          parts: [
            { amount: 10, categoryId: categories[0].id, meaning: "One", notes: null },
            { amount: 20, categoryId: categories[1].id, meaning: "Two", notes: null },
          ],
          transactionId: mixed.id,
        },
        context,
      ),
    ).rejects.toThrow("expectedVersion 2");
    await expect(service.removeTransaction(mistake.id, "remove", context)).resolves.toMatchObject({
      data: { removed: true },
    });
    const providerTransaction = await database.db.query.financeTransactions.findFirst({
      where: (table, { eq }) => eq(table.merchant, "Historical"),
    });
    if (!providerTransaction) throw new Error("Provider transaction fixture missing.");
    await expect(
      service.removeTransaction(providerTransaction.id, "remove-provider", context),
    ).rejects.toThrow("Provider transactions must be linked");
    const accounts = createFinanceAccountService({ db: database.db, now });
    await expect(
      accounts.disconnect(account.id, "disconnect-manual", context),
    ).resolves.toMatchObject({
      data: { status: "manual" },
    });
  });
});
