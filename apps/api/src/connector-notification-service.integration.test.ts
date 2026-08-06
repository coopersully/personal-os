import { resolve } from "node:path";
import type { GoogleConnector, GoogleCredentials, ICloudConnector } from "@personal-os/connectors";
import { ConnectorError } from "@personal-os/connectors";
import {
  calendarAccounts,
  calendars,
  connectorSubscriptions,
  connectorSyncTriggers,
  createDatabaseClient,
  migrateDatabase,
  users,
} from "@personal-os/database";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { eq, inArray } from "drizzle-orm";
import { createConnectorNotificationService } from "./connector-notification-service.js";
import { encryptJson } from "./security.js";
import type { RequestLog } from "./types.js";

const timestamp = new Date("2026-08-06T12:00:00.000Z");
const encryptionKey = Buffer.alloc(32, 13).toString("base64");
const credentials: GoogleCredentials = {
  accessToken: "access",
  expiresAt: "2026-08-06T13:00:00.000Z",
  refreshToken: "refresh",
  scope:
    "https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/calendar.events",
  tokenType: "Bearer",
};

describe.sequential("connector notification service", () => {
  let container: StartedPostgreSqlContainer;
  let database: ReturnType<typeof createDatabaseClient>;
  let accountId: string;
  let service: ReturnType<typeof createConnectorNotificationService>;
  let google: GoogleConnector;
  const logs: RequestLog[] = [];

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
        encryptedCredentials: encryptJson(credentials, encryptionKey),
        label: "Google",
        mailEnabled: true,
        provider: "google",
        providerAccountId: "notification-google",
        userId: user.id,
      })
      .returning();
    if (!account) throw new Error("Notification account was not created.");
    accountId = account.id;
    await database.db.insert(calendars).values({
      accountId,
      isSelected: true,
      name: "Primary",
      provider: "google",
      remoteCalendarId: "remote-primary",
      timezone: "UTC",
      userId: user.id,
    });
    google = {
      watchGmail: vi.fn(async (value) => ({
        credentials: value,
        value: { expiresAt: "2026-08-13T12:00:00.000Z", historyId: "history-1" },
      })),
      watchCalendarList: vi.fn(async (value, channel) => ({
        credentials: value,
        value: {
          expiresAt: "2026-08-07T12:00:00.000Z",
          resourceId: `resource-${channel.id}`,
        },
      })),
      watchCalendarEvents: vi.fn(async (value, _calendarId, channel) => ({
        credentials: value,
        value: {
          expiresAt: "2026-08-07T12:00:00.000Z",
          resourceId: `resource-${channel.id}`,
        },
      })),
      stopCalendarWatch: vi.fn(async (value) => value),
    } as unknown as GoogleConnector;
    service = createConnectorNotificationService({
      calendarWebhookUrl: "https://api.example.com/v1/connectors/google/calendar/notifications",
      db: database.db,
      encryptionKey,
      gmailTopicName: "projects/ilo/topics/gmail-notifications",
      google,
      log: (entry) => logs.push(entry),
      now: () => timestamp,
    });
  }, 120_000);

  afterAll(async () => {
    await database.close();
    await container.stop();
  });

  beforeEach(async () => {
    await database.db.delete(connectorSyncTriggers);
    await database.db.delete(connectorSubscriptions);
    await database.db
      .update(calendarAccounts)
      .set({
        encryptedCredentials: encryptJson(credentials, encryptionKey),
        syncError: null,
        syncErrorCategory: null,
        syncErrorCode: null,
        syncFailureCount: 0,
        syncRecovery: null,
      })
      .where(eq(calendarAccounts.id, accountId));
    vi.clearAllMocks();
    logs.length = 0;
  });

  it("registers and renews one durable watch per enabled Google resource", async () => {
    await service.ensureGoogleSubscriptions(accountId);

    await expect(service.renewDueSubscriptions({ concurrency: 2 })).resolves.toEqual({
      attempted: 3,
      failed: 0,
      skipped: 0,
      succeeded: 3,
    });
    expect(google.watchGmail).toHaveBeenCalledOnce();
    expect(google.watchCalendarList).toHaveBeenCalledOnce();
    expect(google.watchCalendarEvents).toHaveBeenCalledOnce();
    const subscriptions = await database.db
      .select()
      .from(connectorSubscriptions)
      .orderBy(connectorSubscriptions.kind);
    expect(subscriptions).toEqual([
      expect.objectContaining({
        kind: "gmail_mailbox",
        providerCursor: "history-1",
        renewAfter: new Date("2026-08-07T12:00:00.000Z"),
        status: "active",
      }),
      expect.objectContaining({
        kind: "google_calendar_events",
        remoteResourceId: expect.stringMatching(/^resource-/),
        status: "active",
        verificationTokenHash: expect.any(String),
      }),
      expect.objectContaining({
        kind: "google_calendar_list",
        remoteResourceId: expect.stringMatching(/^resource-/),
        status: "active",
        verificationTokenHash: expect.any(String),
      }),
    ]);

    await database.db
      .update(connectorSubscriptions)
      .set({ renewAfter: timestamp })
      .where(
        inArray(connectorSubscriptions.kind, ["google_calendar_events", "google_calendar_list"]),
      );
    await expect(service.renewDueSubscriptions()).resolves.toMatchObject({
      attempted: 2,
      succeeded: 2,
    });
    expect(google.stopCalendarWatch).toHaveBeenCalledTimes(2);
  });

  it("claims renewal once across schedulers, backs off safely, and suppresses reconnects", async () => {
    await service.ensureGoogleSubscriptions(accountId);
    const watchGmail = google.watchGmail;
    if (!watchGmail) throw new Error("Gmail watch fixture is missing.");
    vi.mocked(watchGmail).mockRejectedValueOnce(
      new ConnectorError({
        category: "temporary",
        code: "google_temporary_failure",
        disposition: "retry",
        message: "Google is temporarily unavailable.",
        status: 503,
      }),
    );
    const second = createConnectorNotificationService({
      calendarWebhookUrl: "https://api.example.com/v1/connectors/google/calendar/notifications",
      db: database.db,
      encryptionKey,
      gmailTopicName: "projects/ilo/topics/gmail-notifications",
      google,
      now: () => timestamp,
    });
    const [firstResult, secondResult] = await Promise.all([
      service.renewDueSubscriptions({ limit: 10 }),
      second.renewDueSubscriptions({ limit: 10 }),
    ]);
    expect(firstResult.attempted + secondResult.attempted).toBe(3);
    expect(firstResult.failed + secondResult.failed).toBe(1);
    const [failed] = await database.db
      .select()
      .from(connectorSubscriptions)
      .where(eq(connectorSubscriptions.kind, "gmail_mailbox"));
    expect(failed).toMatchObject({
      failureCount: 1,
      nextAttemptAt: new Date("2026-08-06T12:01:00.000Z"),
      safeFailureCode: "google_temporary_failure",
      status: "failed",
    });

    await database.db
      .update(calendarAccounts)
      .set({
        syncError: "Reconnect this account to resume syncing.",
        syncErrorCategory: "authorization",
        syncErrorCode: "provider_authorization_required",
        syncFailureCount: 1,
        syncRecovery: "reconnect",
      })
      .where(eq(calendarAccounts.id, accountId));
    await database.db
      .update(connectorSubscriptions)
      .set({ nextAttemptAt: timestamp, status: "failed" })
      .where(eq(connectorSubscriptions.kind, "gmail_mailbox"));
    await expect(service.renewDueSubscriptions()).resolves.toMatchObject({ skipped: 1 });
    const [stopped] = await database.db
      .select()
      .from(connectorSubscriptions)
      .where(eq(connectorSubscriptions.kind, "gmail_mailbox"));
    expect(stopped?.status).toBe("stopped");
  });

  it("leases one bounded iCloud IDLE listener and leaves polling healthy on listener failure", async () => {
    const [owner] = await database.db
      .select({ userId: calendarAccounts.userId })
      .from(calendarAccounts)
      .where(eq(calendarAccounts.id, accountId));
    if (!owner) throw new Error("Notification owner was not found.");
    const [icloudAccount] = await database.db
      .insert(calendarAccounts)
      .values({
        calendarEnabled: false,
        encryptedCredentials: encryptJson(
          { appSpecificPassword: "xxxx-xxxx-xxxx-xxxx", email: "idle@icloud.com" },
          encryptionKey,
        ),
        label: "iCloud IDLE",
        mailEnabled: true,
        provider: "icloud",
        providerAccountId: "idle@icloud.com",
        userId: owner.userId,
      })
      .returning();
    if (!icloudAccount) throw new Error("iCloud IDLE account was not created.");
    let entered: (() => void) | undefined;
    const started = new Promise<void>((resolveStarted) => {
      entered = resolveStarted;
    });
    let release: (() => void) | undefined;
    const held = new Promise<void>((resolveHeld) => {
      release = resolveHeld;
    });
    const listenForMailChanges = vi.fn(async (_credentials, onChange) => {
      entered?.();
      await onChange();
      await held;
    });
    const icloud = { listenForMailChanges } as unknown as ICloudConnector;
    const idleService = createConnectorNotificationService({
      db: database.db,
      encryptionKey,
      icloud,
      icloudMailIdleConcurrency: 1,
      icloudMailIdleEnabled: true,
      now: () => timestamp,
    });
    const secondIdleService = createConnectorNotificationService({
      db: database.db,
      encryptionKey,
      icloud,
      icloudMailIdleConcurrency: 1,
      icloudMailIdleEnabled: true,
      now: () => timestamp,
    });
    const firstPass = idleService.runICloudIdlePass();
    await started;
    await expect(secondIdleService.runICloudIdlePass()).resolves.toEqual({
      claimed: 0,
      failed: 0,
      skipped: 0,
      succeeded: 0,
    });
    release?.();
    await expect(firstPass).resolves.toMatchObject({ claimed: 1, succeeded: 1 });
    expect(listenForMailChanges).toHaveBeenCalledOnce();
    await expect(
      database.db
        .select()
        .from(connectorSyncTriggers)
        .where(eq(connectorSyncTriggers.accountId, icloudAccount.id)),
    ).resolves.toEqual([expect.objectContaining({ reason: "notification" })]);

    vi.mocked(listenForMailChanges).mockRejectedValueOnce(new Error("socket closed"));
    await database.db
      .update(connectorSubscriptions)
      .set({ nextAttemptAt: timestamp })
      .where(eq(connectorSubscriptions.accountId, icloudAccount.id));
    await expect(idleService.runICloudIdlePass()).resolves.toMatchObject({ failed: 1 });
    const [healthyAccount] = await database.db
      .select()
      .from(calendarAccounts)
      .where(eq(calendarAccounts.id, icloudAccount.id));
    expect(healthyAccount).toMatchObject({ syncError: null, syncRecovery: null });
    vi.mocked(listenForMailChanges).mockRejectedValueOnce(
      new ConnectorError({
        category: "authorization",
        code: "icloud_mail_authorization_failed",
        disposition: "reconnect",
        message: "iCloud Mail authorization is no longer valid.",
        status: 401,
      }),
    );
    await database.db
      .update(connectorSubscriptions)
      .set({ nextAttemptAt: timestamp })
      .where(eq(connectorSubscriptions.accountId, icloudAccount.id));
    await expect(idleService.runICloudIdlePass()).resolves.toMatchObject({ failed: 1 });
    const [reconnectAccount] = await database.db
      .select()
      .from(calendarAccounts)
      .where(eq(calendarAccounts.id, icloudAccount.id));
    expect(reconnectAccount).toMatchObject({
      syncError: "Reconnect this iCloud account to resume syncing.",
      syncRecovery: "reconnect",
    });
    await database.db.delete(calendarAccounts).where(eq(calendarAccounts.id, icloudAccount.id));
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

  it("emits only bounded connector-operation fields without provider identities or bodies", async () => {
    await service.ensureGoogleSubscriptions(accountId);
    const watchGmail = google.watchGmail;
    if (!watchGmail) throw new Error("Gmail watch fixture is missing.");
    vi.mocked(watchGmail).mockRejectedValueOnce(
      new Error("RAW_PROVIDER_BODY token=secret identity=private@example.com"),
    );
    await service.renewDueSubscriptions();
    await service.receiveGmailNotification("private@example.com", "999999999999");
    await service.enqueue(accountId, "notification", new Date(timestamp.getTime() - 60_000));
    await service.dispatchTriggeredSyncs(async () => undefined);

    const allowedKeys = new Set([
      "ageMs",
      "code",
      "durationMs",
      "event",
      "method",
      "notificationDisposition",
      "path",
      "provider",
      "renewalLagMs",
      "requestId",
      "status",
      "subscriptionKind",
      "triggerReason",
    ]);
    expect(logs.length).toBeGreaterThan(0);
    for (const entry of logs) {
      expect(Object.keys(entry).every((key) => allowedKeys.has(key))).toBe(true);
    }
    expect(logs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "connector_subscription_failed",
          event: "connector_subscription_failed",
        }),
        expect.objectContaining({
          event: "connector_notification_received",
          notificationDisposition: "rejected",
        }),
        expect.objectContaining({
          ageMs: 60_000,
          event: "connector_trigger_dispatched",
        }),
      ]),
    );
    expect(JSON.stringify(logs)).not.toMatch(
      /RAW_PROVIDER_BODY|token=secret|private@example\.com|999999999999/u,
    );
  });
});
