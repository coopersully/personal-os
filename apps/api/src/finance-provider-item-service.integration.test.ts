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
          name: `${groupingKey}-${index}`,
          provider: "plaid" as const,
          providerAccountId: `${groupingKey}-account-${index}`,
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
