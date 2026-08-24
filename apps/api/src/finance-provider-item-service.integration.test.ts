import { resolve } from "node:path";
import type { PlaidAccountSnapshot } from "@personal-os/connectors";
import {
  auditEvents,
  createDatabaseClient,
  type DatabaseClient,
  financeAccounts,
  financeCategories,
  financeProviderItems,
  migrateDatabase,
  users,
} from "@personal-os/database";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { asc, eq, inArray } from "drizzle-orm";
import { createFinanceProviderItemService } from "./finance-provider-item-service.js";
import { decryptJson, encryptJson } from "./security.js";
import type { Principal } from "./types.js";

const encryptionKey = Buffer.alloc(32, 7).toString("base64");
const now = new Date("2026-08-16T12:00:00.000Z");

async function attemptOldItemClaimCommit(
  pool: DatabaseClient["pool"],
  itemId: string,
  claimId: string,
  generation: number,
) {
  return pool.query<{ id: string }>(
    `UPDATE finance_provider_items
     SET sync_cursor = 'cursor-from-revoked-claim',
         sync_state = 'current',
         sync_claim_id = NULL,
         sync_claim_owner = NULL,
         sync_claim_generation = NULL,
         sync_claim_started_at = NULL,
         sync_claim_expires_at = NULL,
         next_sync_at = NULL,
         sync_error = NULL,
         sync_error_code = NULL,
         sync_error_category = NULL,
         sync_recovery = NULL,
         sync_failure_count = 0
     WHERE id = $1 AND sync_claim_id = $2 AND sync_claim_generation = $3
     RETURNING id`,
    [itemId, claimId, generation],
  );
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
          query LIKE '%finance_provider_items%'
          OR query LIKE '%finance_accounts%'
          OR query LIKE '%pg_advisory_xact_lock%'
        )
        AND query NOT LIKE '%pg_stat_activity%'
    `);
    if (Number(result.rows[0]?.count ?? 0) >= expected) return;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 20));
  }
  throw new Error(`Expected at least ${expected} Provider Item lock waiter(s).`);
}

function principal(userId: string): Principal {
  return {
    actorId: userId,
    actorType: "user",
    scopes: new Set(["finances:read", "finances:write"]),
    userId,
  };
}

function remoteAccount(accountId: string, balanceCurrent = 12.34): PlaidAccountSnapshot {
  return {
    accountId,
    balanceCurrent,
    currencyCode: "USD",
    name: `Account ${accountId}`,
    officialName: null,
  };
}

describe.sequential("Finance Provider Item service", () => {
  let container: StartedPostgreSqlContainer;
  let database: DatabaseClient;
  let userId: string;

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
        displayName: "Provider Item Test",
        email: "provider-item@example.com",
        passwordHash: "unused",
        planningTimezone: "UTC",
      })
      .returning({ id: users.id });
    if (!user) throw new Error("Provider Item fixture user was not created.");
    userId = user.id;
  }, 120_000);

  afterAll(async () => {
    await database.close();
    await container.stop();
  });

  beforeEach(async () => {
    await database.db.delete(auditEvents);
    await database.db.delete(financeAccounts);
    await database.db.delete(financeProviderItems);
    await database.db.delete(financeCategories);
  });

  function service() {
    return createFinanceProviderItemService({
      db: database.db,
      encryptionKey,
      now: () => now,
    });
  }

  async function insertLegacyGroup(
    groupingKey: string,
    cursors: Array<string | null>,
    accessTokens: string[] = cursors.map(() => `token-${groupingKey}`),
    indexOffset = 0,
  ) {
    return database.db
      .insert(financeAccounts)
      .values(
        cursors.map((syncCursor, index) => ({
          encryptedCredentials: encryptJson(
            { accessToken: accessTokens[index] ?? accessTokens[0] },
            encryptionKey,
          ),
          institution: "Legacy Bank",
          name: `${groupingKey}-${index + indexOffset}`,
          provider: "plaid" as const,
          providerAccountId: `${groupingKey}-account-${index + indexOffset}`,
          providerItemId: groupingKey,
          status: "connected" as const,
          syncCursor,
          userId,
        })),
      )
      .returning();
  }

  it("persists one authoritative real Plaid Item and replay-updates its linked account shadows", async () => {
    const providerItems = service();
    const context = { principal: principal(userId), requestId: "connect-1" };

    const created = await providerItems.upsertConnection({
      accessToken: "access-token-1",
      accounts: [remoteAccount("remote-1"), remoteAccount("remote-2", 56.78)],
      context,
      institution: "Plaid Bank",
      itemId: "item-1",
    });

    expect(created.map((account) => account.id)).toHaveLength(2);
    const [item] = await database.db.select().from(financeProviderItems);
    if (!item) throw new Error("The authoritative Provider Item was not saved.");
    expect(item).toMatchObject({
      legacyGroupingKey: null,
      nextSyncAt: now,
      provider: "plaid",
      providerItemId: "item-1",
      syncCursor: null,
      syncState: "stale",
      userId,
    });
    expect(decryptJson<{ accessToken: string }>(item.encryptedCredentials, encryptionKey)).toEqual({
      accessToken: "access-token-1",
    });
    const firstProjection = await database.db
      .select()
      .from(financeAccounts)
      .orderBy(asc(financeAccounts.providerAccountId));
    expect(firstProjection).toEqual([
      expect.objectContaining({
        currencyCode: "USD",
        nextSyncAt: now,
        providerAccountId: "remote-1",
        providerItemId: "item-1",
        providerItemRecordId: item.id,
        syncCursor: null,
        syncState: "stale",
      }),
      expect.objectContaining({
        balance: 5678,
        currencyCode: "USD",
        nextSyncAt: now,
        providerAccountId: "remote-2",
        providerItemId: "item-1",
        providerItemRecordId: item.id,
        syncCursor: null,
        syncState: "stale",
      }),
    ]);
    for (const account of firstProjection) {
      if (!account.encryptedCredentials)
        throw new Error("The account compatibility credential was not saved.");
      expect(
        decryptJson<{ accessToken: string }>(account.encryptedCredentials, encryptionKey),
      ).toEqual({ accessToken: "access-token-1" });
    }

    const replayed = await providerItems.upsertConnection({
      accessToken: "access-token-2",
      accounts: [remoteAccount("remote-1", 99), remoteAccount("remote-3", 1)],
      context: { ...context, requestId: "connect-2" },
      institution: "Plaid Bank",
      itemId: "item-1",
    });

    expect(replayed).toHaveLength(2);
    expect(await database.db.select().from(financeProviderItems)).toHaveLength(1);
    const projections = await database.db
      .select()
      .from(financeAccounts)
      .orderBy(asc(financeAccounts.providerAccountId));
    expect(projections).toHaveLength(3);
    expect(projections.find((account) => account.providerAccountId === "remote-1")).toMatchObject({
      balance: 9900,
      providerItemRecordId: item.id,
    });
    const [auditCount] = await database.db
      .select({ count: database.db.$count(auditEvents) })
      .from(auditEvents);
    expect(auditCount?.count).toBe(4);
  });

  it("rejects an empty account snapshot before any credential Item or connection effects persist", async () => {
    await expect(
      service().upsertConnection({
        accessToken: "empty-snapshot-token",
        accounts: [],
        context: { principal: principal(userId), requestId: "empty-account-snapshot" },
        institution: "Empty Bank",
        itemId: "empty-account-item",
        prepareTransaction: async (tx) => {
          await tx.insert(financeCategories).values({
            group: "expense",
            name: "Must not persist",
            slug: "must-not-persist",
            userId,
          });
        },
      }),
    ).rejects.toMatchObject({ code: "service_unavailable" });

    expect(await database.db.$count(financeProviderItems)).toBe(0);
    expect(await database.db.$count(financeAccounts)).toBe(0);
    expect(await database.db.$count(auditEvents)).toBe(0);
    expect(await database.db.$count(financeCategories)).toBe(0);
  });

  it("rejects missing credential encryption and non-positive or fractional backfill bounds", async () => {
    const unconfigured = createFinanceProviderItemService({
      db: database.db,
      now: () => now,
    });
    await expect(
      unconfigured.upsertConnection({
        accessToken: "must-not-persist",
        accounts: [remoteAccount("unconfigured-account")],
        context: { principal: principal(userId), requestId: "unconfigured-connection" },
        institution: "Unconfigured Bank",
        itemId: "unconfigured-item",
      }),
    ).rejects.toMatchObject({ code: "service_unavailable" });
    await expect(service().backfillLegacyItems(0)).rejects.toMatchObject({
      code: "invalid_request",
    });
    await expect(service().backfillLegacyItems(1.5)).rejects.toMatchObject({
      code: "invalid_request",
    });
    expect(await database.db.$count(financeProviderItems)).toBe(0);
    expect(await database.db.$count(financeAccounts)).toBe(0);
    expect(await database.db.$count(auditEvents)).toBe(0);
  });

  it("refuses to relink an account into a destination Item with an active claim", async () => {
    const providerItems = service();
    const context = { principal: principal(userId), requestId: "active-destination" };
    const [sourceAccount] = await providerItems.upsertConnection({
      accessToken: "source-token",
      accounts: [remoteAccount("moving-account")],
      context,
      institution: "Source Bank",
      itemId: "source-item",
    });
    await providerItems.upsertConnection({
      accessToken: "destination-token",
      accounts: [remoteAccount("destination-anchor")],
      context,
      institution: "Destination Bank",
      itemId: "destination-item",
    });
    const [sourceItem] = await database.db
      .select()
      .from(financeProviderItems)
      .where(eq(financeProviderItems.providerItemId, "source-item"));
    const [destinationItem] = await database.db
      .select()
      .from(financeProviderItems)
      .where(eq(financeProviderItems.providerItemId, "destination-item"));
    if (!sourceAccount || !sourceItem || !destinationItem) {
      throw new Error("Relink fixtures were not created.");
    }
    const claimId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    await database.db
      .update(financeProviderItems)
      .set({
        syncClaimExpiresAt: new Date("2099-08-17T12:00:00.000Z"),
        syncClaimGeneration: 3,
        syncClaimId: claimId,
        syncClaimOwner: "destination-runtime",
        syncClaimStartedAt: now,
      })
      .where(eq(financeProviderItems.id, destinationItem.id));

    await expect(
      providerItems.upsertConnection({
        accessToken: "relink-token",
        accounts: [remoteAccount("moving-account")],
        context: { ...context, requestId: "active-destination-relink" },
        institution: "Destination Bank",
        itemId: "destination-item",
      }),
    ).rejects.toMatchObject({ code: "conflict" });

    expect(
      (
        await database.db
          .select({ itemId: financeAccounts.providerItemRecordId })
          .from(financeAccounts)
          .where(eq(financeAccounts.id, sourceAccount.id))
      )[0]?.itemId,
    ).toBe(sourceItem.id);
    expect(
      (
        await database.db
          .select({ claimId: financeProviderItems.syncClaimId })
          .from(financeProviderItems)
          .where(eq(financeProviderItems.id, destinationItem.id))
      )[0]?.claimId,
    ).toBe(claimId);
  });

  it("rejects a relink whose source pointer targets another user's Provider Item", async () => {
    const [otherUser] = await database.db
      .insert(users)
      .values({
        displayName: "Foreign Provider Item Owner",
        email: `foreign-provider-item-${crypto.randomUUID()}@example.com`,
        passwordHash: "unused",
        planningTimezone: "UTC",
      })
      .returning();
    if (!otherUser) throw new Error("Foreign Provider Item owner was not created.");
    const providerItems = service();
    await providerItems.upsertConnection({
      accessToken: "foreign-token",
      accounts: [remoteAccount("foreign-anchor")],
      context: { principal: principal(otherUser.id), requestId: "foreign-connect" },
      institution: "Foreign Bank",
      itemId: "foreign-item",
    });
    await providerItems.upsertConnection({
      accessToken: "owned-destination-token",
      accounts: [remoteAccount("owned-destination-anchor")],
      context: { principal: principal(userId), requestId: "owned-destination-connect" },
      institution: "Owned Bank",
      itemId: "owned-destination-item",
    });
    const [foreignItem] = await database.db
      .select()
      .from(financeProviderItems)
      .where(eq(financeProviderItems.userId, otherUser.id));
    if (!foreignItem) throw new Error("Foreign Provider Item was not created.");
    const foreignClaimId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    await database.db
      .update(financeProviderItems)
      .set({
        syncClaimExpiresAt: new Date("2099-08-17T12:00:00.000Z"),
        syncClaimGeneration: 5,
        syncClaimId: foreignClaimId,
        syncClaimOwner: "foreign-runtime",
        syncClaimStartedAt: now,
      })
      .where(eq(financeProviderItems.id, foreignItem.id));
    const [malformedAccount] = await database.db
      .insert(financeAccounts)
      .values({
        institution: "Malformed Bank",
        name: "Cross-owner pointer",
        provider: "plaid",
        providerAccountId: "cross-owner-moving",
        providerItemId: "foreign-item",
        providerItemRecordId: foreignItem.id,
        status: "connected",
        userId,
      })
      .returning();
    if (!malformedAccount) throw new Error("Cross-owner account pointer was not created.");
    const foreignBefore = (
      await database.db
        .select()
        .from(financeProviderItems)
        .where(eq(financeProviderItems.id, foreignItem.id))
    )[0];
    const auditsBefore = await database.db.$count(auditEvents);

    await expect(
      providerItems.upsertConnection({
        accessToken: "must-not-relink-token",
        accounts: [remoteAccount("cross-owner-moving")],
        context: { principal: principal(userId), requestId: "cross-owner-relink" },
        institution: "Owned Bank",
        itemId: "owned-destination-item",
      }),
    ).rejects.toMatchObject({ code: "conflict" });

    expect(
      (
        await database.db
          .select({ itemId: financeAccounts.providerItemRecordId })
          .from(financeAccounts)
          .where(eq(financeAccounts.id, malformedAccount.id))
      )[0]?.itemId,
    ).toBe(foreignItem.id);
    expect(
      (
        await database.db
          .select()
          .from(financeProviderItems)
          .where(eq(financeProviderItems.id, foreignItem.id))
      )[0],
    ).toEqual(foreignBefore);
    expect(await database.db.$count(auditEvents)).toBe(auditsBefore);
  });

  it("rejects a relink when the destination Item has a linked non-Plaid account", async () => {
    const providerItems = service();
    const context = { principal: principal(userId), requestId: "cross-provider-relink" };
    const [moving] = await providerItems.upsertConnection({
      accessToken: "cross-provider-source-token",
      accounts: [remoteAccount("cross-provider-moving")],
      context,
      institution: "Source Bank",
      itemId: "cross-provider-source",
    });
    await providerItems.upsertConnection({
      accessToken: "cross-provider-destination-token",
      accounts: [remoteAccount("cross-provider-destination-anchor")],
      context,
      institution: "Destination Bank",
      itemId: "cross-provider-destination",
    });
    const [sourceItem] = await database.db
      .select()
      .from(financeProviderItems)
      .where(eq(financeProviderItems.providerItemId, "cross-provider-source"));
    const [destinationItem] = await database.db
      .select()
      .from(financeProviderItems)
      .where(eq(financeProviderItems.providerItemId, "cross-provider-destination"));
    if (!moving || !sourceItem || !destinationItem) {
      throw new Error("Cross-provider relink fixtures were not created.");
    }
    const [manualPointer] = await database.db
      .insert(financeAccounts)
      .values({
        institution: "Manual Pointer",
        name: "Manual destination pointer",
        provider: "manual",
        providerItemRecordId: destinationItem.id,
        status: "manual",
        userId,
      })
      .returning();
    if (!manualPointer) throw new Error("Manual destination pointer was not created.");
    const auditsBefore = await database.db.$count(auditEvents);

    await expect(
      providerItems.upsertConnection({
        accessToken: "must-not-move-token",
        accounts: [remoteAccount("cross-provider-moving")],
        context: { ...context, requestId: "cross-provider-relink-attempt" },
        institution: "Destination Bank",
        itemId: "cross-provider-destination",
      }),
    ).rejects.toMatchObject({ code: "conflict" });

    expect(
      (
        await database.db
          .select({ itemId: financeAccounts.providerItemRecordId })
          .from(financeAccounts)
          .where(eq(financeAccounts.id, moving.id))
      )[0]?.itemId,
    ).toBe(sourceItem.id);
    expect(
      (
        await database.db
          .select({ itemId: financeAccounts.providerItemRecordId })
          .from(financeAccounts)
          .where(eq(financeAccounts.id, manualPointer.id))
      )[0]?.itemId,
    ).toBe(destinationItem.id);
    expect(await database.db.$count(auditEvents)).toBe(auditsBefore);
  });

  it.each([
    {
      category: "temporary" as const,
      code: "plaid_transport_failure",
      recovery: "automatic" as const,
      state: "retrying" as const,
    },
    {
      category: "configuration" as const,
      code: "plaid_configuration_invalid",
      recovery: "operator" as const,
      state: "blocked" as const,
    },
  ])("relinks from a $state source without leaving an invalid failure tuple", async (failure) => {
    const providerItems = service();
    const context = { principal: principal(userId), requestId: `relink-${failure.state}` };
    const [moving] = await providerItems.upsertConnection({
      accessToken: "source-token",
      accounts: [
        remoteAccount(`moving-${failure.state}`),
        remoteAccount(`anchor-${failure.state}`),
      ],
      context,
      institution: "Source Bank",
      itemId: `source-${failure.state}`,
    });
    await providerItems.upsertConnection({
      accessToken: "destination-token",
      accounts: [remoteAccount(`destination-${failure.state}`)],
      context,
      institution: "Destination Bank",
      itemId: `destination-${failure.state}`,
    });
    const [sourceItem] = await database.db
      .select()
      .from(financeProviderItems)
      .where(eq(financeProviderItems.providerItemId, `source-${failure.state}`));
    if (!moving || !sourceItem) throw new Error("Failure-state relink fixture was not created.");
    await database.db
      .update(financeProviderItems)
      .set({
        nextSyncAt: now,
        syncError: "Safe failure",
        syncErrorCategory: failure.category,
        syncErrorCode: failure.code,
        syncFailureCount: 2,
        syncRecovery: failure.recovery,
        syncState: failure.state,
      })
      .where(eq(financeProviderItems.id, sourceItem.id));

    await expect(
      providerItems.upsertConnection({
        accessToken: "relinked-token",
        accounts: [remoteAccount(`moving-${failure.state}`)],
        context: { ...context, requestId: `relink-${failure.state}-commit` },
        institution: "Destination Bank",
        itemId: `destination-${failure.state}`,
      }),
    ).resolves.toHaveLength(1);

    await expect(
      database.db
        .select({
          nextSyncAt: financeProviderItems.nextSyncAt,
          syncError: financeProviderItems.syncError,
          syncErrorCategory: financeProviderItems.syncErrorCategory,
          syncErrorCode: financeProviderItems.syncErrorCode,
          syncFailureCount: financeProviderItems.syncFailureCount,
          syncRecovery: financeProviderItems.syncRecovery,
          syncState: financeProviderItems.syncState,
        })
        .from(financeProviderItems)
        .where(eq(financeProviderItems.id, sourceItem.id)),
    ).resolves.toEqual([
      {
        nextSyncAt: now,
        syncError: null,
        syncErrorCategory: null,
        syncErrorCode: null,
        syncFailureCount: 0,
        syncRecovery: null,
        syncState: "stale",
      },
    ]);
  });

  it("preserves equal legacy cursors and accepts independently encrypted equal credentials", async () => {
    const accounts = await insertLegacyGroup("legacy-equal", ["cursor-1", "cursor-1"]);

    await expect(service().backfillLegacyItems()).resolves.toEqual({
      blocked: 0,
      complete: true,
      created: 1,
      linked: 2,
      replayDue: 0,
    });

    const [item] = await database.db.select().from(financeProviderItems);
    if (!item) throw new Error("The legacy Provider Item was not saved.");
    expect(item).toMatchObject({
      legacyGroupingKey: "legacy-equal",
      nextSyncAt: now,
      providerItemId: null,
      syncCursor: "cursor-1",
      syncState: "stale",
    });
    expect(new Set(accounts.map((account) => account.encryptedCredentials?.ciphertext)).size).toBe(
      2,
    );
    expect(
      (await database.db.select().from(financeAccounts)).every(
        (account) => account.providerItemRecordId === item.id,
      ),
    ).toBe(true);
  });

  it("makes missing and divergent legacy cursors immediately due for a null-cursor replay", async () => {
    await insertLegacyGroup("legacy-missing", ["cursor-1", null]);
    await insertLegacyGroup("legacy-divergent", ["cursor-1", "cursor-2"]);

    await expect(service().backfillLegacyItems()).resolves.toEqual({
      blocked: 0,
      complete: true,
      created: 2,
      linked: 4,
      replayDue: 2,
    });

    const items = await database.db
      .select()
      .from(financeProviderItems)
      .orderBy(asc(financeProviderItems.legacyGroupingKey));
    expect(items).toEqual([
      expect.objectContaining({
        legacyGroupingKey: "legacy-divergent",
        nextSyncAt: now,
        syncCursor: null,
      }),
      expect.objectContaining({
        legacyGroupingKey: "legacy-missing",
        nextSyncAt: now,
        syncCursor: null,
      }),
    ]);
  });

  it("leaves an actively claimed legacy group unlinked until the old runtime lease clears", async () => {
    const [legacyAccount] = await insertLegacyGroup("legacy-active-claim", ["legacy-cursor"]);
    if (!legacyAccount) throw new Error("The actively claimed legacy account was not created.");
    const legacyClaimId = "12121212-1212-4212-8212-121212121212";
    const legacyClaimExpiry = new Date("2099-08-17T12:00:00.000Z");
    await database.db
      .update(financeAccounts)
      .set({ syncClaimExpiresAt: legacyClaimExpiry, syncClaimId: legacyClaimId })
      .where(eq(financeAccounts.id, legacyAccount.id));

    await expect(service().backfillLegacyItems()).resolves.toEqual({
      blocked: 0,
      complete: false,
      created: 0,
      linked: 0,
      replayDue: 0,
    });
    await expect(database.db.$count(financeProviderItems)).resolves.toBe(0);
    await expect(database.db.$count(auditEvents)).resolves.toBe(0);
    await expect(
      database.db
        .select({
          claimExpiresAt: financeAccounts.syncClaimExpiresAt,
          claimId: financeAccounts.syncClaimId,
          itemId: financeAccounts.providerItemRecordId,
        })
        .from(financeAccounts)
        .where(eq(financeAccounts.id, legacyAccount.id)),
    ).resolves.toEqual([
      { claimExpiresAt: legacyClaimExpiry, claimId: legacyClaimId, itemId: null },
    ]);

    await database.db
      .update(financeAccounts)
      .set({ syncClaimExpiresAt: new Date("2000-01-01T00:00:00.000Z") })
      .where(eq(financeAccounts.id, legacyAccount.id));
    await expect(service().backfillLegacyItems()).resolves.toEqual({
      blocked: 0,
      complete: true,
      created: 1,
      linked: 1,
      replayDue: 0,
    });
    await expect(
      database.db
        .select({
          claimExpiresAt: financeAccounts.syncClaimExpiresAt,
          claimId: financeAccounts.syncClaimId,
          itemId: financeAccounts.providerItemRecordId,
        })
        .from(financeAccounts)
        .where(eq(financeAccounts.id, legacyAccount.id)),
    ).resolves.toEqual([{ claimExpiresAt: null, claimId: null, itemId: expect.any(String) }]);
  });

  it("reconciles a late sibling against the existing Item cursor before linking", async () => {
    await insertLegacyGroup("legacy-late-cursor", ["cursor-original"]);
    await service().backfillLegacyItems();
    const [existingItem] = await database.db.select().from(financeProviderItems);
    if (!existingItem) throw new Error("The initial legacy Item was not created.");
    const claimId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const claimGeneration = 7;
    await database.db
      .update(financeProviderItems)
      .set({
        nextSyncAt: new Date("2026-08-17T12:00:00.000Z"),
        syncClaimExpiresAt: new Date("2099-08-17T12:00:00.000Z"),
        syncClaimGeneration: claimGeneration,
        syncClaimId: claimId,
        syncClaimOwner: "runtime-before-replay",
        syncClaimStartedAt: new Date("2026-08-16T11:59:00.000Z"),
        syncCursor: "cursor-advanced",
        syncState: "current",
      })
      .where(eq(financeProviderItems.id, existingItem.id));
    const [lateSibling] = await insertLegacyGroup("legacy-late-cursor", [null], undefined, 1);
    if (!lateSibling) throw new Error("The late cursor sibling was not created.");

    await expect(service().backfillLegacyItems()).resolves.toEqual({
      blocked: 0,
      complete: true,
      created: 0,
      linked: 1,
      replayDue: 1,
    });

    const [reconciledItem] = await database.db
      .select()
      .from(financeProviderItems)
      .where(eq(financeProviderItems.id, existingItem.id));
    expect(reconciledItem).toMatchObject({
      nextSyncAt: now,
      syncClaimExpiresAt: null,
      syncClaimGeneration: null,
      syncClaimId: null,
      syncClaimOwner: null,
      syncClaimStartedAt: null,
      syncCursor: null,
      syncState: "stale",
    });
    expect(
      (await attemptOldItemClaimCommit(database.pool, existingItem.id, claimId, claimGeneration))
        .rowCount,
    ).toBe(0);
    expect(
      (
        await database.db
          .select({ syncCursor: financeProviderItems.syncCursor })
          .from(financeProviderItems)
          .where(eq(financeProviderItems.id, existingItem.id))
      )[0]?.syncCursor,
    ).toBeNull();
    expect(
      (
        await database.db
          .select({ providerItemRecordId: financeAccounts.providerItemRecordId })
          .from(financeAccounts)
          .where(eq(financeAccounts.id, lateSibling.id))
      )[0]?.providerItemRecordId,
    ).toBe(existingItem.id);
  });

  it("blocks an existing Item and leaves a late mismatched-credential sibling unlinked", async () => {
    await insertLegacyGroup("legacy-late-credential", ["cursor-original"], ["token-original"]);
    await service().backfillLegacyItems();
    const [existingItem] = await database.db.select().from(financeProviderItems);
    if (!existingItem) throw new Error("The initial credential Item was not created.");
    const claimId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const claimGeneration = 11;
    await database.db
      .update(financeProviderItems)
      .set({
        syncClaimExpiresAt: new Date("2026-08-17T12:00:00.000Z"),
        syncClaimGeneration: claimGeneration,
        syncClaimId: claimId,
        syncClaimOwner: "runtime-before-block",
        syncClaimStartedAt: new Date("2026-08-16T11:59:00.000Z"),
      })
      .where(eq(financeProviderItems.id, existingItem.id));
    const [lateSibling] = await insertLegacyGroup(
      "legacy-late-credential",
      ["cursor-original"],
      ["token-conflict"],
      1,
    );
    if (!lateSibling) throw new Error("The late credential sibling was not created.");

    await expect(service().backfillLegacyItems()).resolves.toEqual({
      blocked: 1,
      complete: true,
      created: 0,
      linked: 0,
      replayDue: 0,
    });

    expect(
      (
        await database.db
          .select()
          .from(financeProviderItems)
          .where(eq(financeProviderItems.id, existingItem.id))
      )[0],
    ).toMatchObject({
      nextSyncAt: null,
      syncClaimExpiresAt: null,
      syncClaimGeneration: null,
      syncClaimId: null,
      syncClaimOwner: null,
      syncClaimStartedAt: null,
      syncErrorCode: "finance_provider_item_legacy_credential_mismatch",
      syncState: "blocked",
    });
    expect(
      (await attemptOldItemClaimCommit(database.pool, existingItem.id, claimId, claimGeneration))
        .rowCount,
    ).toBe(0);
    expect(
      (
        await database.db
          .select({ syncCursor: financeProviderItems.syncCursor })
          .from(financeProviderItems)
          .where(eq(financeProviderItems.id, existingItem.id))
      )[0]?.syncCursor,
    ).toBeNull();
    expect(
      (
        await database.db
          .select({ providerItemRecordId: financeAccounts.providerItemRecordId })
          .from(financeAccounts)
          .where(eq(financeAccounts.id, lateSibling.id))
      )[0]?.providerItemRecordId,
    ).toBeNull();
    const auditCount = await database.db.$count(auditEvents);
    await expect(service().backfillLegacyItems()).resolves.toEqual({
      blocked: 0,
      complete: true,
      created: 0,
      linked: 0,
      replayDue: 0,
    });
    expect(await database.db.$count(auditEvents)).toBe(auditCount);
    expect(
      (
        await database.db
          .select({ syncFailureCount: financeProviderItems.syncFailureCount })
          .from(financeProviderItems)
          .where(eq(financeProviderItems.id, existingItem.id))
      )[0]?.syncFailureCount,
    ).toBe(1);
  });

  it("does not let a terminal blocked group starve the next healthy group", async () => {
    await insertLegacyGroup("a-terminal-blocked", ["cursor-original"], ["token-original"]);
    await service().backfillLegacyItems(1);
    await insertLegacyGroup("a-terminal-blocked", ["cursor-original"], ["token-conflict"], 1);
    await expect(service().backfillLegacyItems(1)).resolves.toMatchObject({
      blocked: 1,
      created: 0,
      linked: 0,
      replayDue: 0,
    });
    await insertLegacyGroup("b-healthy", ["cursor-healthy"]);
    const auditsBeforeHealthyPass = await database.db.$count(auditEvents);
    const [blockedItemBeforeHealthyPass] = await database.db
      .select()
      .from(financeProviderItems)
      .where(eq(financeProviderItems.legacyGroupingKey, "a-terminal-blocked"));
    if (!blockedItemBeforeHealthyPass) throw new Error("The terminal blocked Item was not saved.");

    await expect(service().backfillLegacyItems(1)).resolves.toEqual({
      blocked: 0,
      complete: true,
      created: 1,
      linked: 1,
      replayDue: 0,
    });
    expect(
      (
        await database.db
          .select({ providerItemRecordId: financeAccounts.providerItemRecordId })
          .from(financeAccounts)
          .where(eq(financeAccounts.providerAccountId, "b-healthy-account-0"))
      )[0]?.providerItemRecordId,
    ).not.toBeNull();
    expect(await database.db.$count(auditEvents)).toBe(auditsBeforeHealthyPass + 1);

    await expect(service().backfillLegacyItems(1)).resolves.toEqual({
      blocked: 0,
      complete: true,
      created: 0,
      linked: 0,
      replayDue: 0,
    });
    expect(await database.db.$count(auditEvents)).toBe(auditsBeforeHealthyPass + 1);
    expect(
      (
        await database.db
          .select({ syncFailureCount: financeProviderItems.syncFailureCount })
          .from(financeProviderItems)
          .where(eq(financeProviderItems.id, blockedItemBeforeHealthyPass.id))
      )[0]?.syncFailureCount,
    ).toBe(blockedItemBeforeHealthyPass.syncFailureCount);
  });

  it("skips a legacy group changed after selection and converges on the next pass", async () => {
    await insertLegacyGroup("legacy-phantom", ["cursor-original"], undefined, 1);
    await service().backfillLegacyItems();
    const [existingItem] = await database.db.select().from(financeProviderItems);
    if (!existingItem) throw new Error("The initial phantom-test Item was not created.");
    await insertLegacyGroup("legacy-phantom", ["cursor-original"]);
    const itemLock = await database.pool.connect();
    let backfill: ReturnType<ReturnType<typeof service>["backfillLegacyItems"]> | undefined;
    try {
      await itemLock.query("BEGIN");
      await itemLock.query("SELECT id FROM finance_provider_items WHERE id = $1 FOR UPDATE", [
        existingItem.id,
      ]);
      backfill = service().backfillLegacyItems();
      void backfill.catch(() => undefined);
      await expect(backfill).resolves.toEqual({
        blocked: 0,
        complete: false,
        created: 0,
        linked: 0,
        replayDue: 0,
      });
      const [phantom] = await insertLegacyGroup(
        "legacy-phantom",
        ["cursor-original"],
        undefined,
        2,
      );
      if (!phantom) throw new Error("The phantom legacy sibling was not created.");
      await itemLock.query("COMMIT");
      expect(
        (
          await database.db
            .select({ providerItemRecordId: financeAccounts.providerItemRecordId })
            .from(financeAccounts)
            .where(eq(financeAccounts.id, phantom.id))
        )[0]?.providerItemRecordId,
      ).toBeNull();
      await expect(service().backfillLegacyItems()).resolves.toMatchObject({
        complete: true,
        linked: 2,
      });
    } finally {
      await itemLock.query("ROLLBACK");
      itemLock.release();
      if (backfill) await Promise.allSettled([backfill]);
    }
  });

  it("locks an existing Item before its late legacy account group", async () => {
    await insertLegacyGroup("legacy-item-first", ["cursor-original"], undefined, 1);
    await service().backfillLegacyItems();
    const [existingItem] = await database.db.select().from(financeProviderItems);
    if (!existingItem) throw new Error("Item-first legacy Item was not created.");
    const [lateSibling] = await insertLegacyGroup(
      "legacy-item-first",
      ["cursor-original"],
      undefined,
      2,
    );
    if (!lateSibling) throw new Error("Item-first late sibling was not created.");
    const itemBlocker = await database.pool.connect();
    const accountProbe = await database.pool.connect();
    let backfill: ReturnType<ReturnType<typeof service>["backfillLegacyItems"]> | undefined;
    try {
      await itemBlocker.query("BEGIN");
      await itemBlocker.query("SELECT id FROM finance_provider_items WHERE id = $1 FOR UPDATE", [
        existingItem.id,
      ]);
      backfill = service().backfillLegacyItems();
      void backfill.catch(() => undefined);
      await expect(backfill).resolves.toMatchObject({ complete: false, linked: 0 });

      await accountProbe.query("BEGIN");
      await accountProbe.query("SET LOCAL lock_timeout = '200ms'");
      await expect(
        accountProbe.query("SELECT id FROM finance_accounts WHERE id = $1 FOR UPDATE", [
          lateSibling.id,
        ]),
      ).resolves.toMatchObject({ rowCount: 1 });
      await accountProbe.query("ROLLBACK");
      await itemBlocker.query("COMMIT");
      await expect(service().backfillLegacyItems()).resolves.toMatchObject({ linked: 1 });
    } finally {
      await accountProbe.query("ROLLBACK");
      accountProbe.release();
      await itemBlocker.query("ROLLBACK");
      itemBlocker.release();
      if (backfill) await Promise.allSettled([backfill]);
    }
  });

  it("serializes a legacy backfill behind a crossed relink without deadlock or orphaning", async () => {
    const linked = await insertLegacyGroup("legacy-relink-cross", ["cursor-1", "cursor-1"]);
    await service().backfillLegacyItems();
    const [sourceItem] = await database.db
      .select()
      .from(financeProviderItems)
      .where(eq(financeProviderItems.legacyGroupingKey, "legacy-relink-cross"));
    const moving = linked[0];
    if (!sourceItem || !moving?.providerAccountId) {
      throw new Error("Backfill/relink source fixture was not created.");
    }
    const [lateSibling] = await insertLegacyGroup(
      "legacy-relink-cross",
      ["cursor-1"],
      undefined,
      2,
    );
    if (!lateSibling) throw new Error("Backfill/relink late sibling was not created.");
    await service().upsertConnection({
      accessToken: "cross-destination-token",
      accounts: [remoteAccount("cross-destination-anchor")],
      context: { principal: principal(userId), requestId: "cross-destination-connect" },
      institution: "Cross Destination",
      itemId: "cross-destination-item",
    });
    const [destinationItem] = await database.db
      .select()
      .from(financeProviderItems)
      .where(eq(financeProviderItems.providerItemId, "cross-destination-item"));
    if (!destinationItem) throw new Error("Backfill/relink destination Item was not created.");

    const accountBlocker = await database.pool.connect();
    let relink: ReturnType<ReturnType<typeof service>["upsertConnection"]> | undefined;
    let backfill: ReturnType<ReturnType<typeof service>["backfillLegacyItems"]> | undefined;
    try {
      await accountBlocker.query("BEGIN");
      await accountBlocker.query("SELECT id FROM finance_accounts WHERE id = $1 FOR UPDATE", [
        moving.id,
      ]);
      relink = service().upsertConnection({
        accessToken: "cross-relink-token",
        accounts: [remoteAccount(moving.providerAccountId)],
        context: { principal: principal(userId), requestId: "cross-relink" },
        institution: "Cross Destination",
        itemId: "cross-destination-item",
      });
      void relink.catch(() => undefined);
      await waitForLockWaiters(database.pool, 1);
      backfill = service().backfillLegacyItems();
      void backfill.catch(() => undefined);
      await expect(backfill).resolves.toMatchObject({ complete: false, linked: 0 });
      await accountBlocker.query("COMMIT");

      await expect(relink).resolves.toHaveLength(1);
      await expect(service().backfillLegacyItems()).resolves.toMatchObject({ linked: 1 });
    } finally {
      await accountBlocker.query("ROLLBACK");
      accountBlocker.release();
      await Promise.allSettled([relink, backfill].filter((value) => value !== undefined));
    }

    expect(
      (
        await database.db
          .select({ itemId: financeAccounts.providerItemRecordId })
          .from(financeAccounts)
          .where(eq(financeAccounts.id, moving.id))
      )[0]?.itemId,
    ).toBe(destinationItem.id);
    expect(
      (
        await database.db
          .select({ itemId: financeAccounts.providerItemRecordId })
          .from(financeAccounts)
          .where(eq(financeAccounts.id, lateSibling.id))
      )[0]?.itemId,
    ).toBe(sourceItem.id);
    const orphanItems = await database.pool.query<{ id: string }>(
      `SELECT item.id
       FROM finance_provider_items AS item
       LEFT JOIN finance_accounts AS account ON account.provider_item_record_id = item.id
       WHERE item.user_id = $1 AND account.id IS NULL`,
      [userId],
    );
    expect(orphanItems.rows).toEqual([]);
  });

  it("blocks conflicting or undecryptable credential groups with only safe Ilo-authored reasons", async () => {
    await insertLegacyGroup("legacy-mismatch", [null, null], ["token-a", "token-b"]);
    const [corrupt] = await insertLegacyGroup("legacy-corrupt", [null]);
    if (!corrupt) throw new Error("The corrupt legacy fixture was not created.");
    await database.db
      .update(financeAccounts)
      .set({
        encryptedCredentials: {
          ciphertext: "raw-provider-canary",
          iv: "invalid",
          tag: "invalid",
          version: 1,
        },
      })
      .where(eq(financeAccounts.id, corrupt.id));
    const [otherUser] = await database.db
      .insert(users)
      .values({
        displayName: "Other Provider Item Owner",
        email: `provider-item-${crypto.randomUUID()}@example.com`,
        passwordHash: "unused",
        planningTimezone: "UTC",
      })
      .returning({ id: users.id });
    if (!otherUser) throw new Error("Other Provider Item owner was not created.");
    await database.db.insert(financeAccounts).values([
      {
        encryptedCredentials: encryptJson({ accessToken: "shared-token" }, encryptionKey),
        institution: "Legacy Bank",
        name: "Owned side",
        provider: "plaid",
        providerAccountId: "ownership-owned",
        providerItemId: "legacy-ownership",
        status: "connected",
        userId,
      },
      {
        encryptedCredentials: encryptJson({ accessToken: "shared-token" }, encryptionKey),
        institution: "Legacy Bank",
        name: "Other owner side",
        provider: "plaid",
        providerAccountId: "ownership-other",
        providerItemId: "legacy-ownership",
        status: "connected",
        userId: otherUser.id,
      },
      {
        encryptedCredentials: encryptJson({ accessToken: "provider-token" }, encryptionKey),
        institution: "Legacy Bank",
        name: "Plaid side",
        provider: "plaid",
        providerAccountId: "provider-plaid",
        providerItemId: "legacy-provider",
        status: "connected",
        userId,
      },
      {
        encryptedCredentials: encryptJson({ accessToken: "provider-token" }, encryptionKey),
        institution: "Manual",
        name: "Wrong provider side",
        provider: "manual",
        providerAccountId: "provider-manual",
        providerItemId: "legacy-provider",
        status: "manual",
        userId,
      },
    ]);

    await expect(service().backfillLegacyItems()).resolves.toEqual({
      blocked: 5,
      complete: true,
      created: 5,
      linked: 6,
      replayDue: 0,
    });

    const items = await database.db.select().from(financeProviderItems);
    expect(items).toHaveLength(5);
    expect(items.every((item) => item.syncState === "blocked")).toBe(true);
    expect(items.map((item) => item.syncErrorCode).sort()).toEqual([
      "finance_provider_item_legacy_credential_invalid",
      "finance_provider_item_legacy_credential_mismatch",
      "finance_provider_item_legacy_ownership_mismatch",
      "finance_provider_item_legacy_ownership_mismatch",
      "finance_provider_item_legacy_provider_mismatch",
    ]);
    expect(JSON.stringify(items)).not.toContain("raw-provider-canary");
  });

  it("blocks every malformed decrypted legacy credential shape without exposing its value", async () => {
    const malformedCredentials: unknown[] = [
      null,
      "raw-string-canary",
      {},
      { accessToken: 7 },
      {
        accessToken: "",
      },
    ];
    await database.db.insert(financeAccounts).values(
      malformedCredentials.map((credential, index) => ({
        encryptedCredentials: encryptJson(credential, encryptionKey),
        institution: "Malformed Legacy Bank",
        name: `Malformed credential ${index}`,
        provider: "plaid" as const,
        providerAccountId: `malformed-credential-account-${index}`,
        providerItemId: `malformed-credential-item-${index}`,
        status: "connected" as const,
        userId,
      })),
    );

    await expect(service().backfillLegacyItems()).resolves.toEqual({
      blocked: 5,
      complete: true,
      created: 5,
      linked: 5,
      replayDue: 0,
    });
    const items = await database.db.select().from(financeProviderItems);
    expect(items).toHaveLength(5);
    expect(
      items.every(
        (item) =>
          item.syncErrorCode === "finance_provider_item_legacy_credential_invalid" &&
          item.syncRecovery === "operator" &&
          item.nextSyncAt === null,
      ),
    ).toBe(true);
    expect(JSON.stringify(items)).not.toContain("raw-string-canary");
  });

  it("blocks late siblings when an existing Item credential is empty or undecryptable", async () => {
    await insertLegacyGroup("existing-empty-credential", ["cursor-empty"]);
    await insertLegacyGroup("existing-corrupt-credential", ["cursor-corrupt"]);
    await service().backfillLegacyItems();
    const items = await database.db
      .select()
      .from(financeProviderItems)
      .orderBy(financeProviderItems.legacyGroupingKey);
    const emptyItem = items.find((item) => item.legacyGroupingKey === "existing-empty-credential");
    const corruptItem = items.find(
      (item) => item.legacyGroupingKey === "existing-corrupt-credential",
    );
    if (!emptyItem || !corruptItem) throw new Error("Existing credential Items were not created.");
    await database.db
      .update(financeProviderItems)
      .set({ encryptedCredentials: encryptJson({ accessToken: "" }, encryptionKey) })
      .where(eq(financeProviderItems.id, emptyItem.id));
    await database.db
      .update(financeProviderItems)
      .set({
        encryptedCredentials: {
          ciphertext: "existing-item-raw-canary",
          iv: "invalid",
          tag: "invalid",
          version: 1,
        },
      })
      .where(eq(financeProviderItems.id, corruptItem.id));
    const [emptySibling] = await insertLegacyGroup(
      "existing-empty-credential",
      ["cursor-empty"],
      ["token-existing-empty-credential"],
      1,
    );
    const [corruptSibling] = await insertLegacyGroup(
      "existing-corrupt-credential",
      ["cursor-corrupt"],
      ["token-existing-corrupt-credential"],
      1,
    );
    if (!emptySibling || !corruptSibling)
      throw new Error("Late credential siblings were not saved.");

    await expect(service().backfillLegacyItems()).resolves.toEqual({
      blocked: 2,
      complete: true,
      created: 0,
      linked: 0,
      replayDue: 0,
    });
    await expect(
      database.db
        .select({ itemId: financeAccounts.providerItemRecordId })
        .from(financeAccounts)
        .where(inArray(financeAccounts.id, [emptySibling.id, corruptSibling.id])),
    ).resolves.toEqual([{ itemId: null }, { itemId: null }]);
    const blockedItems = await database.db
      .select({ code: financeProviderItems.syncErrorCode, state: financeProviderItems.syncState })
      .from(financeProviderItems);
    expect(blockedItems).toEqual([
      { code: "finance_provider_item_legacy_credential_invalid", state: "blocked" },
      { code: "finance_provider_item_legacy_credential_invalid", state: "blocked" },
    ]);
    expect(JSON.stringify(blockedItems)).not.toContain("existing-item-raw-canary");
  });

  it("scans past more than limit plus one locked groups and converges without duplicate audits", async () => {
    const lockedGroups = await Promise.all(
      ["a-locked", "b-locked", "c-locked"].map(async (groupingKey) => {
        const [account] = await insertLegacyGroup(groupingKey, [null]);
        if (!account) throw new Error(`The ${groupingKey} fixture was not created.`);
        return account;
      }),
    );
    await insertLegacyGroup("z-ready", [null]);
    const lockClient = await database.pool.connect();
    try {
      await lockClient.query("BEGIN");
      await lockClient.query(
        "SELECT id FROM finance_accounts WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE",
        [lockedGroups.map((account) => account.id)],
      );

      await expect(service().backfillLegacyItems(1)).resolves.toEqual({
        blocked: 0,
        complete: false,
        created: 1,
        linked: 1,
        replayDue: 1,
      });
      expect((await database.db.select().from(financeProviderItems))[0]?.legacyGroupingKey).toBe(
        "z-ready",
      );
    } finally {
      await lockClient.query("ROLLBACK");
      lockClient.release();
    }

    for (const complete of [false, false, true]) {
      await expect(service().backfillLegacyItems(1)).resolves.toEqual({
        blocked: 0,
        complete,
        created: 1,
        linked: 1,
        replayDue: 1,
      });
    }
    const auditsAfterConvergence = await database.db.$count(auditEvents);
    expect(auditsAfterConvergence).toBe(4);
    await expect(service().backfillLegacyItems(1)).resolves.toEqual({
      blocked: 0,
      complete: true,
      created: 0,
      linked: 0,
      replayDue: 0,
    });
    expect(await database.db.$count(auditEvents)).toBe(auditsAfterConvergence);
  });

  it("scans beyond a busy default-limit prefix and preserves all mutation capacity for ready work", async () => {
    const busyUserId = "00000000-0000-4000-8000-000000000001";
    const readyUserId = "ffffffff-ffff-4fff-bfff-ffffffffffff";
    await database.db.insert(users).values([
      {
        displayName: "Backfill busy prefix",
        email: "backfill-busy-prefix@example.com",
        id: busyUserId,
        passwordHash: "unused",
        planningTimezone: "UTC",
      },
      {
        displayName: "Backfill ready suffix",
        email: "backfill-ready-suffix@example.com",
        id: readyUserId,
        passwordHash: "unused",
        planningTimezone: "UTC",
      },
    ]);
    await database.db.insert(financeAccounts).values([
      ...Array.from({ length: 101 }, (_, index) => ({
        encryptedCredentials: encryptJson({ accessToken: `busy-token-${index}` }, encryptionKey),
        institution: "Busy Prefix Bank",
        name: `Busy ${String(index).padStart(3, "0")}`,
        provider: "plaid" as const,
        providerAccountId: `busy-account-${index}`,
        providerItemId: `busy-${String(index).padStart(3, "0")}`,
        status: "connected" as const,
        userId: busyUserId,
      })),
      {
        encryptedCredentials: encryptJson({ accessToken: "ready-token" }, encryptionKey),
        institution: "Ready Suffix Bank",
        name: "Ready suffix",
        provider: "plaid" as const,
        providerAccountId: "ready-suffix-account",
        providerItemId: "ready-suffix",
        status: "connected" as const,
        userId: readyUserId,
      },
    ]);
    const busyTopology = await database.pool.connect();
    try {
      await busyTopology.query("SELECT pg_advisory_lock(hashtextextended($1, 0))", [
        `finance-provider-topology:${busyUserId}`,
      ]);
      await expect(service().backfillLegacyItems()).resolves.toEqual({
        blocked: 0,
        complete: false,
        created: 1,
        linked: 1,
        replayDue: 1,
      });
      await expect(
        database.db.select({ userId: financeProviderItems.userId }).from(financeProviderItems),
      ).resolves.toEqual([{ userId: readyUserId }]);
    } finally {
      await busyTopology.query("SELECT pg_advisory_unlock(hashtextextended($1, 0))", [
        `finance-provider-topology:${busyUserId}`,
      ]);
      busyTopology.release();
    }

    await expect(service().backfillLegacyItems()).resolves.toEqual({
      blocked: 0,
      complete: false,
      created: 100,
      linked: 100,
      replayDue: 100,
    });
    await expect(service().backfillLegacyItems()).resolves.toEqual({
      blocked: 0,
      complete: true,
      created: 1,
      linked: 1,
      replayDue: 1,
    });
    const auditsAfterConvergence = await database.db.$count(auditEvents);
    expect(auditsAfterConvergence).toBe(102);
    await expect(service().backfillLegacyItems()).resolves.toEqual({
      blocked: 0,
      complete: true,
      created: 0,
      linked: 0,
      replayDue: 0,
    });
    expect(await database.db.$count(auditEvents)).toBe(auditsAfterConvergence);
  });

  it("processes at most 100 stable groups per pass and completed replay has no duplicate effects", async () => {
    await database.db.insert(financeAccounts).values(
      Array.from({ length: 101 }, (_, index) => ({
        encryptedCredentials: encryptJson({ accessToken: `token-${index}` }, encryptionKey),
        institution: "Legacy Bank",
        name: `Legacy ${String(index).padStart(3, "0")}`,
        provider: "plaid" as const,
        providerAccountId: `remote-${index}`,
        providerItemId: `legacy-${String(index).padStart(3, "0")}`,
        status: "connected" as const,
        userId,
      })),
    );

    expect(await service().backfillLegacyItems()).toEqual({
      blocked: 0,
      complete: false,
      created: 100,
      linked: 100,
      replayDue: 100,
    });
    expect(await service().backfillLegacyItems()).toEqual({
      blocked: 0,
      complete: true,
      created: 1,
      linked: 1,
      replayDue: 1,
    });
    const auditsBeforeReplay = await database.db.$count(auditEvents);
    expect(await service().backfillLegacyItems()).toEqual({
      blocked: 0,
      complete: true,
      created: 0,
      linked: 0,
      replayDue: 0,
    });
    expect(await database.db.$count(auditEvents)).toBe(auditsBeforeReplay);
    expect(await database.db.$count(financeProviderItems)).toBe(101);
  });

  it("resolves only an owned linked Item for an account", async () => {
    const [account] = await service().upsertConnection({
      accessToken: "owned-token",
      accounts: [remoteAccount("owned-account")],
      context: { principal: principal(userId), requestId: "owned-connect" },
      institution: "Plaid",
      itemId: "owned-item",
    });
    if (!account) throw new Error("The owned account was not saved.");
    expect(await service().resolveItemForAccount(userId, account.id)).toMatchObject({
      providerItemId: "owned-item",
      userId,
    });
    await expect(service().resolveItemForAccount(crypto.randomUUID(), account.id)).rejects.toThrow(
      "Finance account does not have an owned Provider Item.",
    );
  });
});
