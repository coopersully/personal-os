import { resolve } from "node:path";
import type { PlaidConnector } from "@personal-os/connectors";
import {
  auditEvents,
  createDatabaseClient,
  type DatabaseClient,
  financeAccountConnections,
  financeAccounts,
  financeProviderItems,
  financeTransactions,
  migrateDatabase,
  users,
} from "@personal-os/database";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { eq } from "drizzle-orm";
import { createFinanceProviderItemService } from "../finance-provider-item-service.js";
import { createFinanceProviderItemSyncService } from "../finance-provider-item-sync-service.js";
import type { Principal } from "../types.js";
import { createFinanceAccountService } from "./account-service.js";
import { loadFinanceAuthorization } from "./context.js";

describe.sequential("Finance account disconnection", () => {
  let container: StartedPostgreSqlContainer;
  let database: DatabaseClient;
  const now = () => new Date("2026-09-14T12:00:00Z");
  const encryptionKey = Buffer.alloc(32, 1).toString("base64");

  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:17.5-alpine").start();
    database = createDatabaseClient(container.getConnectionUri());
    await migrateDatabase(database.db, resolve(process.cwd(), "packages/database/migrations"));
  }, 120_000);

  afterAll(async () => {
    await database?.close();
    await container?.stop();
  });

  async function fixture(count = 1) {
    const [user] = await database.db
      .insert(users)
      .values({
        displayName: "Source lifecycle",
        email: `${crypto.randomUUID()}@example.com`,
        passwordHash: "unused",
      })
      .returning();
    if (!user) throw new Error("Missing user");
    const principal: Principal = {
      actorId: user.id,
      actorType: "user",
      scopes: new Set(["finances:write"]),
      userId: user.id,
    };
    const context = await loadFinanceAuthorization({
      db: database.db,
      principal,
      requestId: "disconnect",
    });
    const provider = createFinanceProviderItemService({ db: database.db, encryptionKey, now });
    const input = {
      accessToken: "synthetic-token",
      accounts: Array.from({ length: count }, (_, index) => ({
        accountId: `remote-${user.id}-${index}`,
        balanceAvailable: 100,
        balanceCurrent: 100,
        currencyCode: "USD",
        mask: "1234",
        name: `Account ${index}`,
        officialName: null,
        type: "depository" as const,
        subtype: "checking",
      })),
      context: { principal, requestId: "connect" },
      institution: "Fixture Bank",
      itemId: `item-${user.id}`,
    };
    const accounts = await provider.upsertConnection(input);
    const target = accounts[0];
    if (!target) throw new Error("Missing account");
    const service = createFinanceAccountService({ db: database.db, now });
    return { accounts, context, input, principal, provider, service, target };
  }

  it("stops local provider access, erases the last Item credential and reuses ledger identity on reconnect", async () => {
    const { context, input, principal, provider, service, target } = await fixture();
    const [transaction] = await database.db
      .insert(financeTransactions)
      .values({
        accountId: target.id,
        amount: 100,
        direction: "expense",
        merchant: "History",
        transactionDate: "2026-09-13",
        userId: context.userId,
      })
      .returning();
    const result = await service.disconnect(target.id, "disconnect", context);
    expect(result.data).toMatchObject({
      status: "needs_reauth",
      synchronization: { state: "blocked", recovery: "reconnect", nextRetryAt: null },
    });
    expect(await service.disconnect(target.id, "disconnect", context)).toEqual(result);
    const [row] = await database.db
      .select()
      .from(financeAccounts)
      .where(eq(financeAccounts.id, target.id));
    expect(row).toMatchObject({
      providerItemRecordId: null,
      encryptedCredentials: null,
      providerAccountId: input.accounts[0]?.accountId,
      nextSyncAt: null,
    });
    expect(
      await database.db
        .select()
        .from(financeProviderItems)
        .where(eq(financeProviderItems.userId, context.userId)),
    ).toEqual([]);
    const sync = createFinanceProviderItemSyncService({
      db: database.db,
      now,
      prepareTransaction: vi.fn(),
      resolveProjectionLookups: vi.fn(),
      resolveScopeAccountId: vi.fn(),
    });
    await expect(
      sync.syncAccount(target.id, { principal, requestId: "after-disconnect" }),
    ).rejects.toMatchObject({ code: "invalid_request" });
    await expect(provider.upsertConnection(input)).resolves.toMatchObject([{ id: target.id }]);
    expect(
      await database.db
        .select()
        .from(financeTransactions)
        .where(eq(financeTransactions.accountId, target.id)),
    ).toMatchObject([{ id: transaction?.id }]);
    const audits = await database.db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.entityId, target.id));
    expect(audits.filter((event) => event.action === "finance.account_disconnected")).toHaveLength(
      1,
    );
  });

  it("keeps sibling accounts connected when one account disconnects", async () => {
    const { accounts, context, input, principal, service, target } = await fixture(2);
    const [connection] = await database.db
      .insert(financeAccountConnections)
      .values({
        accountIds: accounts.map((account) => account.id),
        provider: "plaid",
        status: "connected",
        userId: context.userId,
      })
      .returning();
    if (!connection) throw new Error("Missing connection");
    await service.disconnect(target.id, "disconnect-sibling", context);
    const rows = await database.db
      .select()
      .from(financeAccounts)
      .where(eq(financeAccounts.userId, context.userId));
    expect(rows.find((row) => row.id === target.id)?.providerItemRecordId).toBeNull();
    expect(rows.find((row) => row.id === accounts[1]?.id)).toMatchObject({
      status: "connected",
      providerItemRecordId: expect.any(String),
      encryptedCredentials: expect.any(Object),
    });
    expect(
      await database.db
        .select()
        .from(financeProviderItems)
        .where(eq(financeProviderItems.userId, context.userId)),
    ).toHaveLength(1);
    await expect(service.getConnection(context.userId, connection.id)).resolves.toMatchObject({
      data: { accountIds: [accounts[1]?.id], status: "connected" },
    });
    const plaid: PlaidConnector = {
      validateCredentials: vi.fn(),
      createLinkToken: vi.fn(),
      exchangePublicToken: vi.fn(),
      getItem: vi.fn(),
      getAccounts: async () =>
        input.accounts.map((account) => ({ ...account, balanceCurrent: 200 })),
      syncTransactions: async () => ({
        added: [],
        modified: [],
        removed: [],
        nextCursor: "after-disconnect",
        hasMore: false,
        transactionsUpdateStatus: "HISTORICAL_UPDATE_COMPLETE",
      }),
    };
    const sync = createFinanceProviderItemSyncService({
      db: database.db,
      now,
      encryptionKey,
      plaid,
      prepareTransaction: vi.fn(),
      resolveProjectionLookups: vi.fn(),
      resolveScopeAccountId: vi.fn(),
    });
    await expect(
      sync.syncAccount(accounts[1]?.id ?? "", { principal, requestId: "sibling-sync" }),
    ).resolves.toEqual({ changed: 0 });
    const afterSync = await service.list(context.userId, { includeExcluded: true });
    expect(afterSync.accounts.find((account) => account.id === target.id)).toMatchObject({
      balance: 100,
      synchronization: { state: "blocked" },
    });
    expect(afterSync.accounts.find((account) => account.id === accounts[1]?.id)).toMatchObject({
      balance: 200,
      synchronization: { state: "current" },
    });
  });

  it("refuses disconnection during a provider claim without partially clearing credentials", async () => {
    const { context, service, target } = await fixture();
    await database.db
      .update(financeProviderItems)
      .set({
        syncClaimId: crypto.randomUUID(),
        syncClaimOwner: "fixture",
        syncClaimGeneration: 1,
        syncClaimStartedAt: new Date(),
        syncClaimExpiresAt: new Date(Date.now() + 60_000),
      })
      .where(eq(financeProviderItems.userId, context.userId));
    await expect(service.disconnect(target.id, "active-claim", context)).rejects.toMatchObject({
      code: "conflict",
    });
    expect(
      await database.db.select().from(financeAccounts).where(eq(financeAccounts.id, target.id)),
    ).toMatchObject([{ status: "connected", encryptedCredentials: expect.any(Object) }]);
  });

  it("rejects another tenant's target without altering its Item", async () => {
    const owner = await fixture();
    const other = await fixture();
    await expect(
      owner.service.disconnect(owner.target.id, "foreign-target", other.context),
    ).rejects.toMatchObject({ code: "not_found" });
    expect(
      await database.db
        .select()
        .from(financeProviderItems)
        .where(eq(financeProviderItems.userId, owner.context.userId)),
    ).toHaveLength(1);
  });

  it("rejects cross-tenant Item pointers and siblings without deleting credentials", async () => {
    const owner = await fixture();
    const other = await fixture();
    const [item] = await database.db
      .select()
      .from(financeProviderItems)
      .where(eq(financeProviderItems.userId, owner.context.userId));
    if (!item) throw new Error("Missing item");
    await database.db
      .update(financeAccounts)
      .set({ providerItemRecordId: item.id })
      .where(eq(financeAccounts.id, other.target.id));
    await expect(
      owner.service.disconnect(owner.target.id, "foreign-sibling", owner.context),
    ).rejects.toMatchObject({ code: "conflict" });
    await expect(
      other.service.disconnect(other.target.id, "foreign-pointer", other.context),
    ).rejects.toMatchObject({ code: "conflict" });
    expect(
      await database.db
        .select()
        .from(financeProviderItems)
        .where(eq(financeProviderItems.id, item.id)),
    ).toHaveLength(1);
  });

  it("fences an active legacy account claim and safely clears an expired claim", async () => {
    const { context, service, target } = await fixture();
    await database.db
      .update(financeAccounts)
      .set({
        providerItemRecordId: null,
        syncClaimId: crypto.randomUUID(),
        syncClaimExpiresAt: new Date(Date.now() + 60_000),
      })
      .where(eq(financeAccounts.id, target.id));
    await expect(service.disconnect(target.id, "legacy-active", context)).rejects.toMatchObject({
      code: "conflict",
    });
    await database.db
      .update(financeAccounts)
      .set({ syncClaimExpiresAt: new Date(0) })
      .where(eq(financeAccounts.id, target.id));
    await expect(service.disconnect(target.id, "legacy-expired", context)).resolves.toMatchObject({
      data: { synchronization: { state: "blocked" } },
    });
    expect(
      await database.db.select().from(financeAccounts).where(eq(financeAccounts.id, target.id)),
    ).toMatchObject([{ syncClaimId: null, syncClaimExpiresAt: null, encryptedCredentials: null }]);
  });
});
