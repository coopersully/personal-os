import { rm } from "node:fs/promises";
import { resolve } from "node:path";
import { ConnectorError, type PlaidConnector } from "@personal-os/connectors";
import {
  auditEvents,
  createDatabaseClient,
  type DatabaseClient,
  financeAccounts,
  financeCategories,
  financeMerchants,
  financeProviderItems,
  financeTransactions,
  migrateDatabase,
  users,
} from "@personal-os/database";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { and, eq, inArray } from "drizzle-orm";
import { createFinanceProviderItemService } from "./finance-provider-item-service.js";
import { createFinanceProviderItemSyncService } from "./finance-provider-item-sync-service.js";
import { encryptJson } from "./security.js";
import type { Principal, RequestLog } from "./types.js";

const now = new Date("2026-08-16T12:00:00.000Z");
const key = Buffer.alloc(32, 13).toString("base64");

function principal(userId: string): Principal {
  return {
    actorId: userId,
    actorType: "user",
    scopes: new Set(["finances:read", "finances:write"]),
    userId,
  };
}

function emptyPage(cursor: string, hasMore = false) {
  return {
    added: [],
    hasMore,
    modified: [],
    nextCursor: cursor,
    removed: [],
    transactionsUpdateStatus: "HISTORICAL_UPDATE_COMPLETE" as const,
  };
}

function remoteAccount(accountId: string, balanceCurrent = 12.34) {
  return {
    accountId,
    balanceCurrent,
    currencyCode: "USD",
    name: `Account ${accountId}`,
    officialName: null,
  };
}

async function waitForAdvisoryWaiter(pool: DatabaseClient["pool"]) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const result = await pool.query<{ count: string }>(`
      SELECT count(*)::text AS count
      FROM pg_stat_activity
      WHERE datname = current_database()
        AND wait_event_type = 'Lock'
        AND query LIKE '%pg_advisory_xact_lock%'
        AND query NOT LIKE '%pg_stat_activity%'
    `);
    if (Number(result.rows[0]?.count ?? 0) > 0) return;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 20));
  }
  throw new Error("Expected a Provider Item lookup advisory-lock waiter.");
}

function plaid(overrides: Partial<PlaidConnector> = {}): PlaidConnector {
  return {
    createLinkToken: async () => "unused",
    exchangePublicToken: async () => ({ accessToken: "access-token", itemId: "item-remote" }),
    getAccounts: async () => [],
    getItem: async () => ({ itemId: "item-remote" }),
    syncTransactions: async () => emptyPage("cursor-final"),
    validateCredentials: async () => undefined,
    ...overrides,
  };
}

describe.sequential("Finance Provider Item synchronization", () => {
  let container: StartedPostgreSqlContainer;
  let database: DatabaseClient;

  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:17.5-alpine")
      .withDatabase("personal_os")
      .withUsername("personal_os")
      .withPassword("personal_os")
      .start();
    database = createDatabaseClient(container.getConnectionUri());
    await migrateDatabase(database.db, resolve(process.cwd(), "packages/database/migrations"));
  }, 120_000);

  afterAll(async () => {
    await database?.pool.end();
    await container?.stop();
    await rm(resolve(process.cwd(), ".drizzle"), { force: true, recursive: true });
  });

  async function fixture(
    input: {
      accountCount?: number;
      cursor?: string | null;
      itemId?: string | null;
      nextSyncAt?: Date | null;
    } = {},
  ) {
    const userId = crypto.randomUUID();
    await database.db.insert(users).values({
      displayName: `Item sync ${userId}`,
      email: `item-sync-${userId}@example.com`,
      id: userId,
      passwordHash: "unused",
      planningTimezone: "UTC",
    });
    const [item] = await database.db
      .insert(financeProviderItems)
      .values({
        encryptedCredentials: encryptJson({ accessToken: `token-${userId}` }, key),
        legacyGroupingKey: input.itemId === null ? `legacy-${userId}` : null,
        nextSyncAt: input.nextSyncAt === undefined ? now : input.nextSyncAt,
        provider: "plaid",
        providerItemId: input.itemId === undefined ? `remote-${userId}` : input.itemId,
        syncCursor: input.cursor ?? null,
        syncState: "stale",
        userId,
      })
      .returning();
    if (!item) throw new Error("Provider Item fixture was not created.");
    const accounts = [];
    for (let index = 0; index < (input.accountCount ?? 2); index += 1) {
      const [account] = await database.db
        .insert(financeAccounts)
        .values({
          encryptedCredentials: encryptJson({ accessToken: `legacy-${index}` }, key),
          institution: "Item Bank",
          name: `Account ${index}`,
          nextSyncAt: new Date(index === 0 ? now.getTime() - 86_400_000 : now.getTime()),
          provider: "plaid",
          providerAccountId: `provider-${userId}-${index}`,
          providerItemId: `legacy-shadow-${userId}`,
          providerItemRecordId: item.id,
          status: "connected",
          syncCursor: index === 0 ? "legacy-newer" : "legacy-older",
          syncState: "stale",
          userId,
        })
        .returning();
      if (!account) throw new Error("Finance account fixture was not created.");
      accounts.push(account);
    }
    return { accounts, item, userId };
  }

  function service(provider: PlaidConnector, log?: (entry: RequestLog) => void) {
    return createFinanceProviderItemSyncService({
      db: database.db,
      encryptionKey: key,
      ...(log ? { log } : {}),
      now: () => now,
      plaid: provider,
      prepareTransaction: async (remote) => ({
        category: remote.personalFinanceCategory?.primary ?? null,
        categoryConfidence: null,
        categorySource: remote.personalFinanceCategory ? ("provider" as const) : null,
        isTransfer: false,
        merchant: remote.merchantName ?? remote.name,
        needsReview: true,
        remote,
      }),
      resolveProjectionLookups: async () => ({ categoryId: null, merchantId: null }),
      resolveScopeAccountId: async (_userId, scope) =>
        scope.type === "target" && scope.entityType === "finance_account" ? scope.id : undefined,
    });
  }

  it("commits legacy identity before paging and ignores divergent account cursor shadows", async () => {
    const { accounts, item, userId } = await fixture({ itemId: null });
    const observed: Array<{ cursor: string | null; identity: string | null }> = [];
    const provider = plaid({
      getItem: async () => ({ itemId: `resolved-${userId}` }),
      syncTransactions: async ({ cursor }) => {
        const [current] = await database.db
          .select({ providerItemId: financeProviderItems.providerItemId })
          .from(financeProviderItems)
          .where(eq(financeProviderItems.id, item.id));
        observed.push({ cursor, identity: current?.providerItemId ?? null });
        return emptyPage("cursor-resolved");
      },
    });
    const target = accounts[0];
    if (!target) throw new Error("Target account was not created.");

    await expect(
      service(provider).syncAccount(target.id, {
        principal: principal(userId),
        requestId: "legacy-identity",
      }),
    ).resolves.toEqual({ changed: 0 });
    expect(observed).toEqual([{ cursor: null, identity: `resolved-${userId}` }]);
    await expect(
      database.db
        .select({ cursor: financeProviderItems.syncCursor })
        .from(financeProviderItems)
        .where(eq(financeProviderItems.id, item.id)),
    ).resolves.toEqual([{ cursor: "cursor-resolved" }]);
  });

  it("blocks a legacy Item when its resolved remote identity already belongs to another aggregate", async () => {
    const { accounts, item, userId } = await fixture({ itemId: null });
    const resolvedItemId = `resolved-conflict-${userId}`;
    await database.db.insert(financeProviderItems).values({
      encryptedCredentials: encryptJson({ accessToken: "other-token" }, key),
      nextSyncAt: null,
      provider: "plaid",
      providerItemId: resolvedItemId,
      syncState: "stale",
      userId,
    });
    const syncTransactions = vi.fn(async () => emptyPage("must-not-run"));
    const target = accounts[0];
    if (!target) throw new Error("Conflict target account was not created.");

    await expect(
      service(
        plaid({
          getItem: async () => ({ itemId: resolvedItemId }),
          syncTransactions,
        }),
      ).syncAccount(target.id, {
        principal: principal(userId),
        requestId: "legacy-identity-conflict",
      }),
    ).rejects.toMatchObject({ code: "service_unavailable" });
    expect(syncTransactions).not.toHaveBeenCalled();
    await expect(
      database.db
        .select({ code: financeProviderItems.syncErrorCode, state: financeProviderItems.syncState })
        .from(financeProviderItems)
        .where(eq(financeProviderItems.id, item.id)),
    ).resolves.toEqual([{ code: "finance_provider_item_identity_conflict", state: "blocked" }]);
  });

  it("atomically checkpoints every page and resumes exactly there after process loss", async () => {
    const { accounts, item, userId } = await fixture();
    const cursors: Array<string | null> = [];
    let calls = 0;
    const firstProvider = plaid({
      syncTransactions: async ({ cursor }) => {
        cursors.push(cursor);
        calls += 1;
        if (calls === 1) {
          return {
            ...emptyPage("page-one", true),
            added: [
              {
                accountId: accounts[0]?.providerAccountId ?? "missing",
                amount: 12,
                currencyCode: "USD",
                date: "2026-08-15",
                merchantName: "Page one",
                name: "PAGE ONE",
                pending: false,
                pendingTransactionId: null,
                personalFinanceCategory: null,
                transactionId: `page-one-${userId}`,
              },
            ],
          };
        }
        throw new ConnectorError({
          category: "temporary",
          code: "plaid_temporary_failure",
          disposition: "retry",
          message: "temporary",
        });
      },
    });
    const target = accounts[0];
    if (!target) throw new Error("Target account was not created.");
    await expect(
      service(firstProvider).syncAccount(target.id, {
        principal: principal(userId),
        requestId: "process-loss",
      }),
    ).rejects.toMatchObject({ code: "service_unavailable" });
    await expect(
      database.db
        .select({ cursor: financeProviderItems.syncCursor })
        .from(financeProviderItems)
        .where(eq(financeProviderItems.id, item.id)),
    ).resolves.toEqual([{ cursor: "page-one" }]);
    await expect(
      database.db
        .select({ id: financeTransactions.id })
        .from(financeTransactions)
        .where(eq(financeTransactions.providerTransactionId, `page-one-${userId}`)),
    ).resolves.toHaveLength(1);

    await expect(
      service(
        plaid({
          syncTransactions: async ({ cursor }) => {
            cursors.push(cursor);
            return emptyPage("page-two");
          },
        }),
      ).syncAccount(target.id, {
        principal: principal(userId),
        requestId: "process-resume",
      }),
    ).resolves.toEqual({ changed: 0 });
    expect(cursors).toEqual([null, "page-one", "page-one"]);
  });

  it("fences a source Item when its account is relinked during a provider page", async () => {
    const { accounts, item: sourceItem, userId } = await fixture({ accountCount: 1 });
    const target = accounts[0];
    if (!target?.providerAccountId) throw new Error("Relink target account was not created.");
    const context = { principal: principal(userId), requestId: "relink-during-page" };
    const providerItems = createFinanceProviderItemService({
      db: database.db,
      encryptionKey: key,
      now: () => now,
    });
    await providerItems.upsertConnection({
      accessToken: "destination-token",
      accounts: [
        {
          accountId: `destination-anchor-${userId}`,
          balanceCurrent: 1,
          currencyCode: "USD",
          name: "Destination anchor",
          officialName: null,
        },
      ],
      context,
      institution: "Destination Bank",
      itemId: `destination-item-${userId}`,
    });
    const [destinationItem] = await database.db
      .select()
      .from(financeProviderItems)
      .where(eq(financeProviderItems.providerItemId, `destination-item-${userId}`));
    if (!destinationItem) throw new Error("Destination Item was not created.");

    let releasePage!: () => void;
    let signalPageStarted!: () => void;
    const pageStarted = new Promise<void>((resolvePromise) => {
      signalPageStarted = resolvePromise;
    });
    const pageRelease = new Promise<void>((resolvePromise) => {
      releasePage = resolvePromise;
    });
    const resolveProjectionLookups = vi.fn(async () => ({ categoryId: null, merchantId: null }));
    const syncService = createFinanceProviderItemSyncService({
      db: database.db,
      encryptionKey: key,
      now: () => now,
      plaid: plaid({
        syncTransactions: async () => {
          signalPageStarted();
          await pageRelease;
          return {
            ...emptyPage(`moved-page-${userId}`),
            added: [
              {
                accountId: target.providerAccountId ?? "missing",
                amount: 42,
                currencyCode: "USD",
                date: "2026-08-16",
                merchantName: "Moved merchant",
                name: "MOVED MERCHANT",
                pending: false,
                pendingTransactionId: null,
                personalFinanceCategory: {
                  confidenceLevel: "VERY_HIGH",
                  detailed: "FOOD_AND_DRINK_RESTAURANTS",
                  primary: "FOOD_AND_DRINK",
                },
                transactionId: `moved-transaction-${userId}`,
              },
            ],
          };
        },
      }),
      prepareTransaction: async (remote) => ({
        category: remote.personalFinanceCategory?.primary ?? null,
        categoryConfidence: null,
        categorySource: "provider",
        isTransfer: false,
        merchant: remote.merchantName ?? remote.name,
        needsReview: false,
        remote,
      }),
      resolveProjectionLookups,
      resolveScopeAccountId: async () => undefined,
    });

    const oldSync = syncService.syncAccount(target.id, context);
    void oldSync.catch(() => undefined);
    await pageStarted;
    await expect(
      providerItems.upsertConnection({
        accessToken: "destination-token-relinked",
        accounts: [remoteAccount(target.providerAccountId)],
        context: { ...context, requestId: "relink-commit" },
        institution: "Destination Bank",
        itemId: `destination-item-${userId}`,
      }),
    ).resolves.toHaveLength(1);
    releasePage();
    await expect(oldSync).rejects.toMatchObject({ code: "conflict" });

    expect(resolveProjectionLookups).not.toHaveBeenCalled();
    expect(
      await database.db
        .select({ id: financeTransactions.id })
        .from(financeTransactions)
        .where(eq(financeTransactions.providerTransactionId, `moved-transaction-${userId}`)),
    ).toEqual([]);
    expect(
      await database.db
        .select({ id: auditEvents.id })
        .from(auditEvents)
        .where(
          and(
            eq(auditEvents.action, "finance.plaid_page_projected"),
            eq(auditEvents.entityId, sourceItem.id),
          ),
        ),
    ).toEqual([]);
    expect(
      await database.db
        .select({ itemId: financeAccounts.providerItemRecordId })
        .from(financeAccounts)
        .where(eq(financeAccounts.id, target.id)),
    ).toEqual([{ itemId: destinationItem.id }]);
    expect(
      await database.db
        .select({ id: financeProviderItems.id })
        .from(financeProviderItems)
        .where(eq(financeProviderItems.id, sourceItem.id)),
    ).toEqual([]);
  });

  it("durably carries a pending removal across process loss before successful settlement", async () => {
    const { accounts, item, userId } = await fixture();
    const target = accounts[0];
    if (!target) throw new Error("Pending-removal target account was not created.");
    const pendingProviderId = `pending-removed-${userId}`;
    await database.db.insert(financeTransactions).values({
      accountId: target.id,
      amount: 1_500,
      direction: "expense",
      merchant: "Pending removal",
      pending: true,
      providerTransactionId: pendingProviderId,
      transactionDate: "2026-08-15",
      userId,
    });
    let calls = 0;
    await expect(
      service(
        plaid({
          syncTransactions: async ({ cursor }) => {
            calls += 1;
            if (calls === 1) {
              expect(cursor).toBeNull();
              return {
                ...emptyPage("pending-removal-page", true),
                removed: [{ transactionId: pendingProviderId }],
              };
            }
            expect(cursor).toBe("pending-removal-page");
            await database.db
              .update(financeProviderItems)
              .set({
                syncClaimExpiresAt: null,
                syncClaimGeneration: null,
                syncClaimId: null,
                syncClaimOwner: null,
                syncClaimStartedAt: null,
              })
              .where(eq(financeProviderItems.id, item.id));
            throw new Error("simulated process loss after deferred removal");
          },
        }),
      ).syncAccount(target.id, {
        principal: principal(userId),
        requestId: "pending-removal-loss",
      }),
    ).rejects.toMatchObject({ code: "conflict" });
    await expect(
      database.db
        .select({ cursor: financeProviderItems.syncCursor })
        .from(financeProviderItems)
        .where(eq(financeProviderItems.id, item.id)),
    ).resolves.toEqual([{ cursor: "pending-removal-page" }]);

    await expect(
      service(
        plaid({
          syncTransactions: async ({ cursor }) => {
            expect(cursor).toBe("pending-removal-page");
            return emptyPage("pending-removal-finished");
          },
        }),
      ).syncAccount(target.id, {
        principal: principal(userId),
        requestId: "pending-removal-resume",
      }),
    ).resolves.toEqual({ changed: 1 });
    await expect(
      database.db
        .select({ id: financeTransactions.id })
        .from(financeTransactions)
        .where(eq(financeTransactions.providerTransactionId, pendingProviderId)),
    ).resolves.toEqual([]);
    await expect(
      database.db
        .select({ state: financeProviderItems.syncState })
        .from(financeProviderItems)
        .where(eq(financeProviderItems.id, item.id)),
    ).resolves.toEqual([{ state: "current" }]);
  });

  it("rejects a provider-added pending self-reference before it can be mistaken for a tombstone", async () => {
    const { accounts, item, userId } = await fixture();
    const target = accounts[0];
    if (!target) throw new Error("Self-referential pending target was not created.");
    const providerTransactionId = `self-referential-${userId}`;

    await expect(
      service(
        plaid({
          syncTransactions: async () => ({
            ...emptyPage("must-not-commit"),
            added: [
              {
                accountId: target.providerAccountId ?? "missing",
                amount: 15,
                currencyCode: "USD",
                date: "2026-08-16",
                merchantName: "Malformed pending",
                name: "MALFORMED PENDING",
                pending: true,
                pendingTransactionId: providerTransactionId,
                personalFinanceCategory: null,
                transactionId: providerTransactionId,
              },
            ],
          }),
        }),
      ).syncAccount(target.id, {
        principal: principal(userId),
        requestId: "self-referential-pending",
      }),
    ).rejects.toMatchObject({ code: "service_unavailable" });
    await expect(
      database.db
        .select({ id: financeTransactions.id })
        .from(financeTransactions)
        .where(eq(financeTransactions.providerTransactionId, providerTransactionId)),
    ).resolves.toEqual([]);
    await expect(
      database.db
        .select({ cursor: financeProviderItems.syncCursor })
        .from(financeProviderItems)
        .where(eq(financeProviderItems.id, item.id)),
    ).resolves.toEqual([{ cursor: null }]);
    await expect(
      database.db
        .select({ id: auditEvents.id })
        .from(auditEvents)
        .where(
          and(
            eq(auditEvents.entityId, item.id),
            eq(auditEvents.action, "finance.plaid_page_projected"),
          ),
        ),
    ).resolves.toEqual([]);
  });

  it("clears an invalid Item cursor for one controlled replay", async () => {
    const { accounts, item, userId } = await fixture({ cursor: "opaque-cursor" });
    const target = accounts[0];
    if (!target) throw new Error("Target account was not created.");
    await expect(
      service(
        plaid({
          syncTransactions: async () => {
            throw new ConnectorError({
              category: "rejected",
              code: "plaid_invalid_cursor",
              disposition: "operator",
              message: "raw provider cursor canary",
            });
          },
        }),
      ).syncAccount(target.id, {
        principal: principal(userId),
        requestId: "invalid-cursor",
      }),
    ).rejects.toMatchObject({ code: "service_unavailable" });
    await expect(
      database.db
        .select({
          code: financeProviderItems.syncErrorCode,
          cursor: financeProviderItems.syncCursor,
          error: financeProviderItems.syncError,
          nextSyncAt: financeProviderItems.nextSyncAt,
          recovery: financeProviderItems.syncRecovery,
          state: financeProviderItems.syncState,
        })
        .from(financeProviderItems)
        .where(eq(financeProviderItems.id, item.id)),
    ).resolves.toEqual([
      {
        code: "plaid_invalid_cursor_replay_in_progress",
        cursor: null,
        error: "Plaid transaction history is being replayed from a safe checkpoint.",
        nextSyncAt: now,
        recovery: "automatic",
        state: "retrying",
      },
    ]);

    await expect(
      service(
        plaid({
          syncTransactions: async () => {
            throw new ConnectorError({
              category: "rejected",
              code: "plaid_invalid_cursor",
              disposition: "retry",
              message: "raw provider cursor canary",
            });
          },
        }),
      ).syncAccount(target.id, {
        principal: principal(userId),
        requestId: "invalid-cursor-replay",
      }),
    ).rejects.toMatchObject({ code: "service_unavailable" });
    await expect(
      database.db
        .select({
          code: financeProviderItems.syncErrorCode,
          recovery: financeProviderItems.syncRecovery,
          state: financeProviderItems.syncState,
        })
        .from(financeProviderItems)
        .where(eq(financeProviderItems.id, item.id)),
    ).resolves.toEqual([
      { code: "plaid_invalid_cursor_replay_failed", recovery: "operator", state: "blocked" },
    ]);
  });

  it("keeps invalid-cursor replay state across page checkpoints and terminates a repeated failure", async () => {
    const { accounts, item, userId } = await fixture({ cursor: "invalid-before-replay" });
    const target = accounts[0];
    if (!target) throw new Error("Invalid-cursor target account was not created.");
    const invalidCursor = () =>
      new ConnectorError({
        category: "rejected",
        code: "plaid_invalid_cursor",
        disposition: "retry",
        message: "safe invalid cursor",
      });
    await expect(
      service(
        plaid({
          syncTransactions: async () => {
            throw invalidCursor();
          },
        }),
      ).syncAccount(target.id, {
        principal: principal(userId),
        requestId: "invalid-cursor-start-replay",
      }),
    ).rejects.toMatchObject({ code: "service_unavailable" });

    let calls = 0;
    await expect(
      service(
        plaid({
          syncTransactions: async ({ cursor }) => {
            calls += 1;
            if (calls === 1) {
              expect(cursor).toBeNull();
              return emptyPage("replay-page-one", true);
            }
            expect(cursor).toBe("replay-page-one");
            throw invalidCursor();
          },
        }),
      ).syncAccount(target.id, {
        principal: principal(userId),
        requestId: "invalid-cursor-repeat-after-page",
      }),
    ).rejects.toMatchObject({ code: "service_unavailable" });
    await expect(
      database.db
        .select({
          code: financeProviderItems.syncErrorCode,
          cursor: financeProviderItems.syncCursor,
          nextSyncAt: financeProviderItems.nextSyncAt,
          recovery: financeProviderItems.syncRecovery,
          state: financeProviderItems.syncState,
        })
        .from(financeProviderItems)
        .where(eq(financeProviderItems.id, item.id)),
    ).resolves.toEqual([
      {
        code: "plaid_invalid_cursor_replay_failed",
        cursor: "replay-page-one",
        nextSyncAt: null,
        recovery: "operator",
        state: "blocked",
      },
    ]);
    await database.db
      .update(financeProviderItems)
      .set({ nextSyncAt: now })
      .where(eq(financeProviderItems.id, item.id));
    const getAccounts = vi.fn(async () => []);
    const syncTransactions = vi.fn(async () => emptyPage("must-not-restart"));
    const blockedService = service(plaid({ getAccounts, syncTransactions }));
    await expect(
      blockedService.syncDueItemsForUser(userId, { type: "all_outstanding" }),
    ).resolves.toEqual({
      attempted: 0,
      failed: 0,
      recovered: 0,
      skipped: 0,
      succeeded: 0,
    });
    await expect(
      blockedService.syncAccount(target.id, {
        principal: principal(userId),
        requestId: "invalid-cursor-terminal-direct-attempt",
      }),
    ).rejects.toMatchObject({ code: "service_unavailable" });
    expect(getAccounts).not.toHaveBeenCalled();
    expect(syncTransactions).not.toHaveBeenCalled();
  });

  it("uses one Item claim across sibling runtimes and fences page and final writes after claim loss", async () => {
    const { accounts, item, userId } = await fixture();
    let releaseProvider!: () => void;
    const providerRelease = new Promise<void>((resolvePromise) => {
      releaseProvider = resolvePromise;
    });
    let providerStarted!: () => void;
    const providerStart = new Promise<void>((resolvePromise) => {
      providerStarted = resolvePromise;
    });
    let streams = 0;
    const deferred = plaid({
      syncTransactions: async () => {
        streams += 1;
        providerStarted();
        await providerRelease;
        return emptyPage("winner");
      },
    });
    const firstAccount = accounts[0];
    const secondAccount = accounts[1];
    if (!firstAccount || !secondAccount) throw new Error("Sibling accounts were not created.");
    const first = service(deferred).syncAccount(firstAccount.id, {
      principal: principal(userId),
      requestId: "runtime-one",
    });
    await providerStart;
    await expect(
      service(deferred).syncAccount(secondAccount.id, {
        principal: principal(userId),
        requestId: "runtime-two",
      }),
    ).rejects.toMatchObject({ code: "conflict" });
    releaseProvider();
    await expect(first).resolves.toEqual({ changed: 0 });
    expect(streams).toBe(1);

    const effectsBefore = await database.pool.query(
      `SELECT
        (SELECT count(*)::int FROM finance_merchants WHERE user_id = $1) AS merchants,
        (SELECT count(*)::int FROM finance_categories WHERE user_id = $1) AS categories,
        (SELECT count(*)::int FROM finance_transactions WHERE user_id = $1) AS transactions,
        (SELECT count(*)::int FROM audit_events WHERE user_id = $1) AS audits`,
      [userId],
    );
    await database.db
      .update(financeProviderItems)
      .set({ nextSyncAt: now, syncState: "stale" })
      .where(eq(financeProviderItems.id, item.id));
    const claimLosing = plaid({
      syncTransactions: async () => {
        await database.db
          .update(financeProviderItems)
          .set({
            syncClaimExpiresAt: null,
            syncClaimGeneration: null,
            syncClaimId: null,
            syncClaimOwner: null,
            syncClaimStartedAt: null,
          })
          .where(eq(financeProviderItems.id, item.id));
        return {
          ...emptyPage("lost-page"),
          added: [
            {
              accountId: firstAccount.providerAccountId ?? "missing",
              amount: 99,
              currencyCode: "USD",
              date: "2026-08-16",
              merchantName: "Must not persist",
              name: "MUST NOT PERSIST",
              pending: false,
              pendingTransactionId: null,
              personalFinanceCategory: null,
              transactionId: `claim-loss-${userId}`,
            },
          ],
        };
      },
    });
    await expect(
      service(claimLosing).syncAccount(firstAccount.id, {
        principal: principal(userId),
        requestId: "claim-loss-page",
      }),
    ).rejects.toMatchObject({ code: "conflict" });
    await expect(
      database.pool.query(
        `SELECT
          (SELECT count(*)::int FROM finance_merchants WHERE user_id = $1) AS merchants,
          (SELECT count(*)::int FROM finance_categories WHERE user_id = $1) AS categories,
          (SELECT count(*)::int FROM finance_transactions WHERE user_id = $1) AS transactions,
          (SELECT count(*)::int FROM audit_events WHERE user_id = $1) AS audits`,
        [userId],
      ),
    ).resolves.toMatchObject({ rows: effectsBefore.rows });

    const finalAuditsBefore = await database.db
      .select({ id: auditEvents.id })
      .from(auditEvents)
      .where(and(eq(auditEvents.userId, userId), eq(auditEvents.action, "finance.plaid_synced")));
    let progressCalls = 0;
    await expect(
      service(plaid({ syncTransactions: async () => emptyPage("settlement-page") })).syncAccount(
        firstAccount.id,
        { principal: principal(userId), requestId: "claim-loss-settlement" },
        async () => {
          progressCalls += 1;
          if (progressCalls === 6) {
            await database.db
              .update(financeProviderItems)
              .set({
                syncClaimExpiresAt: null,
                syncClaimGeneration: null,
                syncClaimId: null,
                syncClaimOwner: null,
                syncClaimStartedAt: null,
              })
              .where(eq(financeProviderItems.id, item.id));
          }
        },
      ),
    ).rejects.toMatchObject({ code: "conflict" });
    const [afterSettlementLoss] = await database.db
      .select()
      .from(financeProviderItems)
      .where(eq(financeProviderItems.id, item.id));
    expect(afterSettlementLoss).toMatchObject({ lastSyncedAt: now, syncState: "stale" });
    await expect(
      database.db
        .select({ id: auditEvents.id })
        .from(auditEvents)
        .where(and(eq(auditEvents.userId, userId), eq(auditEvents.action, "finance.plaid_synced"))),
    ).resolves.toHaveLength(finalAuditsBefore.length);
  });

  it("serializes reversed first-time merchant and category lookup creation across two Items", async () => {
    const first = await fixture({ accountCount: 1 });
    const firstAccount = first.accounts[0];
    if (!firstAccount) throw new Error("First crossed-lookup account was not created.");
    const [secondItem] = await database.db
      .insert(financeProviderItems)
      .values({
        encryptedCredentials: encryptJson({ accessToken: `second-token-${first.userId}` }, key),
        nextSyncAt: now,
        provider: "plaid",
        providerItemId: `second-item-${first.userId}`,
        syncState: "stale",
        userId: first.userId,
      })
      .returning();
    if (!secondItem) throw new Error("Second crossed-lookup Item was not created.");
    const [secondAccount] = await database.db
      .insert(financeAccounts)
      .values({
        institution: "Item Bank",
        name: "Second crossed lookup",
        provider: "plaid",
        providerAccountId: `second-account-${first.userId}`,
        providerItemId: secondItem.providerItemId,
        providerItemRecordId: secondItem.id,
        status: "connected",
        syncState: "stale",
        userId: first.userId,
      })
      .returning();
    if (!secondAccount) throw new Error("Second crossed-lookup account was not created.");
    await database.db.insert(financeCategories).values([
      {
        group: "Other",
        name: "CROSSED_A",
        slug: `crossed-a-${first.userId}`,
        userId: first.userId,
      },
      {
        group: "Other",
        name: "CROSSED_B",
        slug: `crossed-b-${first.userId}`,
        userId: first.userId,
      },
    ]);
    const remote = (accountId: string, merchant: string, category: "CROSSED_A" | "CROSSED_B") => ({
      accountId,
      amount: 10,
      currencyCode: "USD",
      date: "2026-08-16",
      merchantName: merchant,
      name: merchant.toUpperCase(),
      pending: false,
      pendingTransactionId: null,
      personalFinanceCategory: {
        confidenceLevel: "HIGH" as const,
        detailed: `${category}_DETAIL`,
        primary: category,
      },
      transactionId: `${merchant.toLowerCase()}-${first.userId}`,
    });
    const provider = plaid({
      syncTransactions: async ({ accessToken }) =>
        accessToken === `token-${first.userId}`
          ? {
              ...emptyPage("crossed-first-finished"),
              added: [
                remote(firstAccount.providerAccountId ?? "missing", "Alpha merchant", "CROSSED_B"),
                remote(firstAccount.providerAccountId ?? "missing", "Zulu merchant", "CROSSED_A"),
              ],
            }
          : {
              ...emptyPage("crossed-second-finished"),
              added: [
                remote(secondAccount.providerAccountId ?? "missing", "Beta merchant", "CROSSED_A"),
                remote(
                  secondAccount.providerAccountId ?? "missing",
                  "Yankee merchant",
                  "CROSSED_B",
                ),
              ],
            },
    });
    let firstLookupCount = 0;
    let releaseFirstLookups!: () => void;
    const firstLookups = new Promise<void>((resolvePromise) => {
      releaseFirstLookups = resolvePromise;
    });
    const crossedService = () =>
      createFinanceProviderItemSyncService({
        db: database.db,
        encryptionKey: key,
        now: () => now,
        plaid: provider,
        prepareTransaction: async (providerTransaction) => ({
          category: providerTransaction.personalFinanceCategory?.primary ?? null,
          categoryConfidence: 9_000,
          categorySource: "provider",
          isTransfer: false,
          merchant: providerTransaction.merchantName ?? providerTransaction.name,
          needsReview: false,
          remote: providerTransaction,
        }),
        resolveProjectionLookups: async (executor, userId, prepared) => {
          const [merchant] = await executor
            .insert(financeMerchants)
            .values({
              displayName: prepared.merchant,
              normalizedName: prepared.merchant.toLowerCase(),
              userId,
            })
            .returning();
          const [category] = await executor
            .update(financeCategories)
            .set({ updatedAt: now })
            .where(
              and(
                eq(financeCategories.userId, userId),
                eq(financeCategories.name, prepared.category ?? "missing"),
              ),
            )
            .returning();
          if (prepared.merchant === "Alpha merchant" || prepared.merchant === "Beta merchant") {
            firstLookupCount += 1;
            if (firstLookupCount === 2) releaseFirstLookups();
            await Promise.race([firstLookups, waitForAdvisoryWaiter(database.pool)]);
          }
          return { categoryId: category?.id ?? null, merchantId: merchant?.id ?? null };
        },
        resolveScopeAccountId: async () => undefined,
      });

    await expect(
      Promise.all([
        crossedService().syncAccount(firstAccount.id, {
          principal: principal(first.userId),
          requestId: "crossed-lookups-first",
        }),
        crossedService().syncAccount(secondAccount.id, {
          principal: principal(first.userId),
          requestId: "crossed-lookups-second",
        }),
      ]),
    ).resolves.toEqual([{ changed: 2 }, { changed: 2 }]);
    await expect(
      database.db
        .select({ name: financeMerchants.displayName })
        .from(financeMerchants)
        .where(eq(financeMerchants.userId, first.userId)),
    ).resolves.toHaveLength(4);
    await expect(
      database.db
        .select({ category: financeTransactions.category, merchant: financeTransactions.merchant })
        .from(financeTransactions)
        .where(eq(financeTransactions.userId, first.userId))
        .orderBy(financeTransactions.merchant),
    ).resolves.toEqual([
      { category: "CROSSED_B", merchant: "Alpha merchant" },
      { category: "CROSSED_A", merchant: "Beta merchant" },
      { category: "CROSSED_B", merchant: "Yankee merchant" },
      { category: "CROSSED_A", merchant: "Zulu merchant" },
    ]);
  });

  it("projects the complete Item for a target and stores shared retry and reconnect state on the Item", async () => {
    const { accounts, item, userId } = await fixture();
    const target = accounts[0];
    const sibling = accounts[1];
    if (!target || !sibling) throw new Error("Scoped sibling accounts were not created.");
    const scoped = service(
      plaid({
        getAccounts: async () => [
          {
            accountId: sibling.providerAccountId ?? "missing",
            balanceCurrent: 321.45,
            currencyCode: "USD",
            name: "Sibling refreshed",
            officialName: "Sibling refreshed official",
          },
        ],
        syncTransactions: async () => ({
          ...emptyPage("scoped-cursor"),
          added: [
            {
              accountId: sibling.providerAccountId ?? "missing",
              amount: 25,
              currencyCode: "USD",
              date: "2026-08-01",
              merchantName: "Sibling raw evidence",
              name: "SIBLING RAW EVIDENCE",
              pending: false,
              pendingTransactionId: null,
              personalFinanceCategory: null,
              transactionId: `scoped-sibling-${userId}`,
            },
          ],
        }),
      }),
    );
    await expect(
      scoped.syncAccount(
        target.id,
        { principal: principal(userId), requestId: "scoped-item" },
        undefined,
        { type: "target", entityType: "finance_account", id: target.id },
      ),
    ).resolves.toEqual({ changed: 1 });
    await expect(
      database.db
        .select({ accountId: financeTransactions.accountId })
        .from(financeTransactions)
        .where(eq(financeTransactions.providerTransactionId, `scoped-sibling-${userId}`)),
    ).resolves.toEqual([{ accountId: sibling.id }]);
    await expect(
      database.db
        .select({ balance: financeAccounts.balance, name: financeAccounts.name })
        .from(financeAccounts)
        .where(eq(financeAccounts.id, sibling.id)),
    ).resolves.toEqual([{ balance: 32_145, name: "Sibling refreshed official" }]);

    await database.db
      .update(financeProviderItems)
      .set({ nextSyncAt: now, syncState: "stale" })
      .where(eq(financeProviderItems.id, item.id));
    await expect(
      service(
        plaid({
          syncTransactions: async () => {
            throw new ConnectorError({
              category: "authorization",
              code: "plaid_authorization_failed",
              disposition: "reconnect",
              message: "raw login canary",
            });
          },
        }),
      ).syncAccount(target.id, {
        principal: principal(userId),
        requestId: "shared-reconnect",
      }),
    ).rejects.toMatchObject({ code: "service_unavailable" });
    await expect(
      database.db
        .select({
          failureCount: financeProviderItems.syncFailureCount,
          lastSuccessAt: financeProviderItems.lastSyncedAt,
          recovery: financeProviderItems.syncRecovery,
          state: financeProviderItems.syncState,
        })
        .from(financeProviderItems)
        .where(eq(financeProviderItems.id, item.id)),
    ).resolves.toEqual([
      { failureCount: 1, lastSuccessAt: now, recovery: "reconnect", state: "blocked" },
    ]);
  });

  it("ignores provider transactions for an account that is no longer linked to the Item", async () => {
    const { accounts, item, userId } = await fixture();
    const target = accounts[0];
    const deletedSibling = accounts[1];
    if (!target || !deletedSibling) throw new Error("Unlinked account fixture was not created.");
    const deletedProviderAccountId = deletedSibling.providerAccountId ?? "missing";
    await database.db.delete(financeAccounts).where(eq(financeAccounts.id, deletedSibling.id));
    const unlinkedTransactionId = `unlinked-${userId}`;
    const unlinked = createFinanceProviderItemSyncService({
      db: database.db,
      encryptionKey: key,
      now: () => now,
      plaid: plaid({
        syncTransactions: async () => ({
          ...emptyPage("unlinked-finished"),
          added: [
            {
              accountId: deletedProviderAccountId,
              amount: 10,
              currencyCode: "USD",
              date: "2026-08-16",
              merchantName: "Deleted sibling merchant",
              name: "DELETED SIBLING MERCHANT",
              pending: false,
              pendingTransactionId: null,
              personalFinanceCategory: {
                confidenceLevel: "HIGH",
                detailed: "UNLINKED_CATEGORY_DETAIL",
                primary: "UNLINKED_CATEGORY",
              },
              transactionId: unlinkedTransactionId,
            },
          ],
          removed: [{ transactionId: `unlinked-removed-${userId}` }],
        }),
      }),
      prepareTransaction: async (remote) => ({
        category: remote.personalFinanceCategory?.primary ?? null,
        categoryConfidence: 9_000,
        categorySource: "provider",
        isTransfer: false,
        merchant: remote.merchantName ?? remote.name,
        needsReview: false,
        remote,
      }),
      resolveProjectionLookups: async (executor, lookupUserId, prepared) => {
        const [merchant] = await executor
          .insert(financeMerchants)
          .values({
            displayName: prepared.merchant,
            normalizedName: prepared.merchant.toLowerCase(),
            userId: lookupUserId,
          })
          .returning();
        const [category] = await executor
          .insert(financeCategories)
          .values({
            group: "Other",
            name: prepared.category ?? "Unlinked Category",
            slug: "unlinked-category",
            userId: lookupUserId,
          })
          .returning();
        return { categoryId: category?.id ?? null, merchantId: merchant?.id ?? null };
      },
      resolveScopeAccountId: async () => undefined,
    });

    await expect(
      unlinked.syncAccount(target.id, {
        principal: principal(userId),
        requestId: "unlinked-provider-account",
      }),
    ).resolves.toEqual({ changed: 0 });
    await expect(
      database.db
        .select({ name: financeMerchants.displayName })
        .from(financeMerchants)
        .where(eq(financeMerchants.userId, userId)),
    ).resolves.toEqual([]);
    await expect(
      database.db
        .select({ name: financeCategories.name })
        .from(financeCategories)
        .where(eq(financeCategories.userId, userId)),
    ).resolves.toEqual([]);
    await expect(
      database.db
        .select({ id: financeTransactions.id })
        .from(financeTransactions)
        .where(eq(financeTransactions.providerTransactionId, unlinkedTransactionId)),
    ).resolves.toEqual([]);
    const [pageAudit] = await database.db
      .select({ after: auditEvents.after })
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.entityId, item.id),
          eq(auditEvents.action, "finance.plaid_page_projected"),
        ),
      );
    expect(pageAudit?.after).toMatchObject({ added: 0, changed: 0, modified: 0, removed: 0 });
  });

  it("selects at most 25 due Items with at most three provider workers", async () => {
    await database.db.update(financeProviderItems).set({ nextSyncAt: null });
    const itemIds: string[] = [];
    for (let index = 0; index < 26; index += 1) {
      const created = await fixture({ accountCount: 1 });
      itemIds.push(created.item.id);
    }
    let active = 0;
    let maximumActive = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolvePromise) => {
      release = resolvePromise;
    });
    let started = 0;
    let firstWave!: () => void;
    const firstThree = new Promise<void>((resolvePromise) => {
      firstWave = resolvePromise;
    });
    const provider = plaid({
      syncTransactions: async () => {
        active += 1;
        started += 1;
        maximumActive = Math.max(maximumActive, active);
        if (started === 3) firstWave();
        await gate;
        active -= 1;
        return emptyPage(`bounded-${started}`);
      },
    });
    const pending = service(provider).syncDueItems();
    await firstThree;
    expect(maximumActive).toBe(3);
    release();
    await expect(pending).resolves.toMatchObject({ attempted: 25, succeeded: 25 });
    const remaining = await database.db
      .select({ id: financeProviderItems.id })
      .from(financeProviderItems)
      .where(
        and(inArray(financeProviderItems.id, itemIds), eq(financeProviderItems.syncState, "stale")),
      );
    expect(remaining).toHaveLength(1);
  });

  it("selects a linked due Item ahead of 25 earlier orphan Items and excludes orphans from freshness", async () => {
    await database.db.delete(financeAccounts);
    await database.db.delete(financeProviderItems);
    for (let index = 0; index < 25; index += 1) {
      const userId = crypto.randomUUID();
      await database.db.insert(users).values({
        displayName: `Orphan ${index}`,
        email: `orphan-${userId}@example.com`,
        id: userId,
        passwordHash: "unused",
        planningTimezone: "UTC",
      });
      await database.db.insert(financeProviderItems).values({
        encryptedCredentials: encryptJson({ accessToken: `orphan-token-${index}` }, key),
        nextSyncAt: new Date(now.getTime() - 60_000),
        provider: "plaid",
        providerItemId: `orphan-item-${userId}`,
        syncState: "stale",
        userId,
      });
    }
    const valid = await fixture({ accountCount: 1, nextSyncAt: now });
    const logs = vi.fn();
    await expect(service(plaid(), logs).syncDueItems()).resolves.toEqual({
      attempted: 1,
      failed: 0,
      recovered: 0,
      skipped: 0,
      succeeded: 1,
    });
    expect(logs.mock.calls.map(([entry]) => entry)).toContainEqual(
      expect.objectContaining({
        eligibleAccountCount: 1,
        event: "connector_sync_freshness_observed",
      }),
    );
    await expect(
      database.db
        .select({ state: financeProviderItems.syncState })
        .from(financeProviderItems)
        .where(eq(financeProviderItems.id, valid.item.id)),
    ).resolves.toEqual([{ state: "current" }]);
  });
});
