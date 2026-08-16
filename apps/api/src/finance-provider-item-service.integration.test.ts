import { resolve } from "node:path";
import type { PlaidAccountSnapshot } from "@personal-os/connectors";
import {
  auditEvents,
  createDatabaseClient,
  type DatabaseClient,
  financeAccounts,
  financeProviderItems,
  migrateDatabase,
  users,
} from "@personal-os/database";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { asc, eq } from "drizzle-orm";
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
        AND query LIKE '%finance_provider_items%'
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
        syncClaimExpiresAt: new Date("2026-08-17T12:00:00.000Z"),
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
        syncClaimExpiresAt: new Date("2026-08-17T12:00:00.000Z"),
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

  it("links only the exact legacy account IDs present in its locked snapshot", async () => {
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
      await waitForLockWaiters(database.pool, 1);
      const [phantom] = await insertLegacyGroup(
        "legacy-phantom",
        ["cursor-original"],
        undefined,
        2,
      );
      if (!phantom) throw new Error("The phantom legacy sibling was not created.");
      await itemLock.query("COMMIT");
      await expect(backfill).resolves.toEqual({
        blocked: 0,
        complete: false,
        created: 0,
        linked: 1,
        replayDue: 0,
      });
      expect(
        (
          await database.db
            .select({ providerItemRecordId: financeAccounts.providerItemRecordId })
            .from(financeAccounts)
            .where(eq(financeAccounts.id, phantom.id))
        )[0]?.providerItemRecordId,
      ).toBeNull();
    } finally {
      await itemLock.query("ROLLBACK");
      itemLock.release();
      if (backfill) await Promise.allSettled([backfill]);
    }
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

  it("skips a locked stable group, progresses the next group, and converges on a later pass", async () => {
    const locked = await insertLegacyGroup("a-locked", [null, null]);
    if (!locked[1]) throw new Error("The locked sibling fixture was not created.");
    await insertLegacyGroup("b-ready", [null]);
    const lockClient = await database.pool.connect();
    try {
      await lockClient.query("BEGIN");
      await lockClient.query("SELECT id FROM finance_accounts WHERE id = $1 FOR UPDATE", [
        locked[1].id,
      ]);

      await expect(service().backfillLegacyItems(1)).resolves.toEqual({
        blocked: 0,
        complete: false,
        created: 1,
        linked: 1,
        replayDue: 1,
      });
      expect((await database.db.select().from(financeProviderItems))[0]?.legacyGroupingKey).toBe(
        "b-ready",
      );
    } finally {
      await lockClient.query("ROLLBACK");
      lockClient.release();
    }

    await expect(service().backfillLegacyItems(1)).resolves.toEqual({
      blocked: 0,
      complete: true,
      created: 1,
      linked: 2,
      replayDue: 1,
    });
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
