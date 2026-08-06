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
});
