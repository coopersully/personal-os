import { rm } from "node:fs/promises";
import { resolve } from "node:path";
import { ConnectorError, type PlaidConnector } from "@personal-os/connectors";
import {
  auditEvents,
  createDatabaseClient,
  type DatabaseClient,
  financeAccounts,
  financeProviderItems,
  financeTransactions,
  migrateDatabase,
  users,
} from "@personal-os/database";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { and, eq, inArray } from "drizzle-orm";
import { createFinanceProviderItemSyncService } from "./finance-provider-item-sync-service.js";
import { encryptJson } from "./security.js";
import type { Principal } from "./types.js";

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

  function service(provider: PlaidConnector) {
    return createFinanceProviderItemSyncService({
      db: database.db,
      encryptionKey: key,
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
          cursor: financeProviderItems.syncCursor,
          error: financeProviderItems.syncError,
          nextSyncAt: financeProviderItems.nextSyncAt,
          state: financeProviderItems.syncState,
        })
        .from(financeProviderItems)
        .where(eq(financeProviderItems.id, item.id)),
    ).resolves.toEqual([{ cursor: null, error: null, nextSyncAt: now, state: "stale" }]);

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
});
