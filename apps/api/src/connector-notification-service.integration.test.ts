import { resolve } from "node:path";
import {
  calendarAccounts,
  connectorSyncTriggers,
  createDatabaseClient,
  migrateDatabase,
  users,
} from "@personal-os/database";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { eq } from "drizzle-orm";
import { createConnectorNotificationService } from "./connector-notification-service.js";

const timestamp = new Date("2026-08-06T12:00:00.000Z");

describe.sequential("connector notification service", () => {
  let container: StartedPostgreSqlContainer;
  let database: ReturnType<typeof createDatabaseClient>;
  let accountId: string;
  let service: ReturnType<typeof createConnectorNotificationService>;

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
        displayName: "Notification Test",
        email: "notification@example.com",
        passwordHash: "unused",
        planningTimezone: "UTC",
      })
      .returning();
    if (!user) throw new Error("Notification user was not created.");
    const [account] = await database.db
      .insert(calendarAccounts)
      .values({
        calendarEnabled: true,
        label: "Google",
        mailEnabled: true,
        provider: "google",
        providerAccountId: "notification-google",
        userId: user.id,
      })
      .returning();
    if (!account) throw new Error("Notification account was not created.");
    accountId = account.id;
    service = createConnectorNotificationService({ db: database.db, now: () => timestamp });
  }, 120_000);

  afterAll(async () => {
    await database.close();
    await container.stop();
  });

  beforeEach(async () => {
    await database.db.delete(connectorSyncTriggers);
  });

  it("coalesces bursts with bounded count and reason priority", async () => {
    await Promise.all([
      service.enqueue(accountId, "reconciliation"),
      service.enqueue(accountId, "initial"),
      service.enqueue(accountId, "notification"),
    ]);
    const [trigger] = await database.db
      .select()
      .from(connectorSyncTriggers)
      .where(eq(connectorSyncTriggers.accountId, accountId));
    expect(trigger).toMatchObject({
      accountId,
      notificationCount: 3,
      reason: "notification",
    });
  });

  it("claims once across concurrent dispatchers and recovers stale claims", async () => {
    await service.enqueue(accountId, "notification");
    const [first, second] = await Promise.all([
      service.claimDueTriggers(),
      service.claimDueTriggers(),
    ]);
    expect([...first, ...second]).toHaveLength(1);
    const claim = [...first, ...second][0];
    if (!claim) throw new Error("Notification trigger was not claimed.");
    await service.releaseTrigger(claim, timestamp);
    await expect(service.claimDueTriggers()).resolves.toHaveLength(1);
  });

  it("does not delete a newer notification when an older claim completes", async () => {
    await service.enqueue(accountId, "notification");
    const [claim] = await service.claimDueTriggers();
    if (!claim) throw new Error("Notification trigger was not claimed.");
    const newer = new Date(timestamp.getTime() + 1_000);
    await service.enqueue(accountId, "notification", newer);
    await service.completeTrigger(claim);
    const [remaining] = await database.db
      .select()
      .from(connectorSyncTriggers)
      .where(eq(connectorSyncTriggers.accountId, accountId));
    expect(remaining).toMatchObject({ claimId: null, lastTriggeredAt: newer });
  });

  it("deletes only the exact completed claim and cascades with the account", async () => {
    await service.enqueue(accountId, "initial");
    const [claim] = await service.claimDueTriggers();
    if (!claim) throw new Error("Notification trigger was not claimed.");
    await service.completeTrigger(claim);
    await expect(
      database.db
        .select()
        .from(connectorSyncTriggers)
        .where(eq(connectorSyncTriggers.accountId, accountId)),
    ).resolves.toEqual([]);
  });

  it("dispatches successful triggers and releases failed work for retry", async () => {
    const [existingAccount] = await database.db
      .select({ userId: calendarAccounts.userId })
      .from(calendarAccounts)
      .where(eq(calendarAccounts.id, accountId));
    if (!existingAccount) throw new Error("Notification account was not found.");
    const [retryAccount] = await database.db
      .insert(calendarAccounts)
      .values({
        calendarEnabled: true,
        label: "Retry Google",
        mailEnabled: true,
        provider: "google",
        providerAccountId: "notification-google-retry",
        userId: existingAccount.userId,
      })
      .returning();
    if (!retryAccount) throw new Error("Retry notification account was not created.");

    try {
      await service.enqueue(accountId, "notification");
      await service.enqueue(retryAccount.id, "notification");
      const syncAccount = vi.fn(async (_userId: string, candidateAccountId: string) => {
        if (candidateAccountId === retryAccount.id) throw new Error("temporary provider failure");
      });

      await expect(
        service.dispatchTriggeredSyncs(syncAccount, { concurrency: 99, limit: 999 }),
      ).resolves.toEqual({ attempted: 2, failed: 1, succeeded: 1 });
      expect(syncAccount).toHaveBeenCalledTimes(2);
      const remaining = await database.db.select().from(connectorSyncTriggers);
      expect(remaining).toEqual([
        expect.objectContaining({
          accountId: retryAccount.id,
          availableAt: new Date("2026-08-06T12:01:00.000Z"),
          claimId: null,
        }),
      ]);
    } finally {
      await database.db.delete(calendarAccounts).where(eq(calendarAccounts.id, retryAccount.id));
    }
  });

  it("drops reconnect triggers without calling the provider", async () => {
    const [existingAccount] = await database.db
      .select({ userId: calendarAccounts.userId })
      .from(calendarAccounts)
      .where(eq(calendarAccounts.id, accountId));
    if (!existingAccount) throw new Error("Notification account was not found.");
    const [reconnectAccount] = await database.db
      .insert(calendarAccounts)
      .values({
        calendarEnabled: true,
        label: "Reconnect Google",
        mailEnabled: true,
        provider: "google",
        providerAccountId: "notification-google-reconnect",
        syncError: "Reconnect this account to resume syncing.",
        syncErrorCategory: "authorization",
        syncErrorCode: "provider_authorization_required",
        syncFailureCount: 1,
        syncRecovery: "reconnect",
        syncStatus: "error",
        userId: existingAccount.userId,
      })
      .returning();
    if (!reconnectAccount) throw new Error("Reconnect notification account was not created.");

    try {
      await service.enqueue(reconnectAccount.id, "notification");
      const syncAccount = vi.fn();
      await expect(service.dispatchTriggeredSyncs(syncAccount)).resolves.toEqual({
        attempted: 1,
        failed: 0,
        succeeded: 0,
      });
      expect(syncAccount).not.toHaveBeenCalled();
      await expect(database.db.select().from(connectorSyncTriggers)).resolves.toEqual([]);
    } finally {
      await database.db
        .delete(calendarAccounts)
        .where(eq(calendarAccounts.id, reconnectAccount.id));
    }
  });

  it("returns an empty dispatch result when no triggers are due", async () => {
    await expect(service.dispatchTriggeredSyncs(vi.fn())).resolves.toEqual({
      attempted: 0,
      failed: 0,
      succeeded: 0,
    });
  });
});
