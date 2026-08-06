import { resolve } from "node:path";
import type {
  GoogleConnector,
  GoogleCredentials,
  ICloudConnector,
  MailSyncResult,
  NormalizedRemoteEvent,
} from "@personal-os/connectors";
import { ConnectorError, MailSendPreAcceptanceError } from "@personal-os/connectors";
import {
  attentionItems,
  auditEvents,
  calendarAccounts,
  calendarEvents,
  calendars,
  connectorSyncTriggers,
  createDatabaseClient,
  type DatabaseClient,
  domainProfiles,
  mailboxes,
  mailCalendarCommitmentIntakes,
  mailDrafts,
  mailMessages,
  mailRules,
  mailRuleWorkItems,
  mailThreads,
  migrateDatabase,
  oauthStates,
  users,
} from "@personal-os/database";
import { MAIL_RULE_EXECUTION_LIMIT_PER_RUN, type MailRuleAction } from "@personal-os/domain";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { createAssistantService } from "./assistant-service.js";
import { createCalendarService } from "./calendar-service.js";
import { createConnectorService, MailProviderRejectedError } from "./connector-service.js";
import {
  invalidateMailCalendarCommitmentIntakes,
  mailCommitmentMessageLockKey,
  recordMailCalendarCommitmentIntakes,
} from "./mail-calendar-intake.js";
import { durableMailRuleActionFingerprint } from "./mail-rule-work.js";
import { createMailService } from "./mail-service.js";
import { decryptJson, encryptJson } from "./security.js";

const timestamp = new Date("2026-07-13T12:00:00.000Z");
const encryptionKey = Buffer.alloc(32, 7).toString("base64");
const googleCalendarScope = [
  "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
  "https://www.googleapis.com/auth/calendar.events",
].join(" ");
const googleCalendarAndMailScope = [
  googleCalendarScope,
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/gmail.send",
].join(" ");
const credentials: GoogleCredentials = {
  accessToken: "access-1",
  expiresAt: "2026-07-13T13:00:00.000Z",
  refreshToken: "refresh-1",
  scope: googleCalendarScope,
  tokenType: "Bearer",
};
const rotatedCredentials: GoogleCredentials = {
  ...credentials,
  accessToken: "access-2",
  expiresAt: "2026-07-13T14:00:00.000Z",
};

function connectorError(message: string, status: number): ConnectorError {
  const authorization = status === 401 || status === 403;
  const retry = status === 408 || status === 429 || status >= 500;
  return new ConnectorError({
    category: authorization
      ? "authorization"
      : status === 404
        ? "not_found"
        : status === 429
          ? "rate_limited"
          : retry
            ? "temporary"
            : "rejected",
    code: `test_connector_${status}`,
    disposition: authorization ? "reconnect" : retry ? "retry" : "operator",
    message,
    status,
  });
}

function remoteEvent(
  remoteEventId: string,
  etag: string,
  title = remoteEventId,
  conferenceUrl: string | null = null,
): NormalizedRemoteEvent {
  return {
    allDay: false,
    conferenceUrl,
    endsAt: new Date("2026-07-13T14:00:00.000Z"),
    etag,
    location: null,
    notes: null,
    raw: { id: remoteEventId },
    recurrence: [],
    remoteEventId,
    startsAt: new Date("2026-07-13T13:00:00.000Z"),
    status: "confirmed",
    timezone: "UTC",
    title,
  };
}

function mockGoogle(): GoogleConnector {
  return {
    authorizationUrl: vi.fn((state) => `https://accounts.example.com/auth?state=${state}`),
    createEvent: vi.fn(async () => ({
      credentials: rotatedCredentials,
      value: remoteEvent("created-remote", "etag-created", "Created remotely"),
    })),
    deleteEvent: vi.fn(async () => rotatedCredentials),
    exchangeCode: vi.fn(async () => credentials),
    getProfile: vi.fn(async (value) => ({
      credentials: value,
      value: { email: "person@example.com", id: "google-person", name: null },
    })),
    getMailThreadState: vi.fn(async (value, remoteThreadId) => ({
      credentials: value,
      value: {
        mailboxIds: ["INBOX", "UNREAD"],
        remoteThreadId,
        starred: false,
        unread: true,
      },
    })),
    listCalendars: vi.fn(async (value) => ({
      credentials: value,
      value: [
        {
          accessRole: "owner",
          color: "#123456",
          id: "remote-primary",
          name: "Google Primary",
          primary: true,
          selected: true,
          timezone: "UTC",
          writable: true,
        },
        {
          accessRole: "reader",
          color: null,
          id: "remote-readonly",
          name: "Google Readonly",
          primary: false,
          selected: false,
          timezone: "America/New_York",
          writable: false,
        },
      ],
    })),
    syncCalendar: vi.fn(async () => ({
      credentials: rotatedCredentials,
      value: { changes: [], nextSyncToken: "initial-sync", reset: false },
    })),
    syncMail: vi.fn(async (value) => ({
      credentials: value,
      value: {
        deletedThreadIds: [],
        mailboxes: [],
        nextSyncToken: "mail-history",
        reset: false,
        threads: [],
      },
    })),
    sendMail: vi.fn(async () => rotatedCredentials),
    trashMailThread: vi.fn(async () => rotatedCredentials),
    updateMailThread: vi.fn(async () => rotatedCredentials),
    updateEvent: vi.fn(async () => ({
      credentials: rotatedCredentials,
      value: remoteEvent("updated-remote", "etag-updated", "Updated remotely"),
    })),
  };
}

function mockICloud(): ICloudConnector {
  return {
    createEvent: vi.fn(async () => remoteEvent("icloud-created", "icloud-etag", "iCloud create")),
    deleteEvent: vi.fn(async () => undefined),
    listCalendars: vi.fn(async () => [
      {
        accessRole: "owner",
        color: "#88aaff",
        id: "icloud-primary",
        name: "iCloud Calendar",
        primary: true,
        selected: true,
        timezone: "UTC",
        writable: true,
      },
    ]),
    syncCalendar: vi.fn(async () => ({
      changes: [],
      nextSyncToken: "icloud-sync",
      reset: true,
    })),
    syncMail: vi.fn(async () => ({
      deletedThreadIds: [],
      mailboxes: [
        { id: "INBOX", name: "Inbox", role: "inbox" as const, totalCount: 1, unreadCount: 1 },
      ],
      nextSyncToken: null,
      reset: true,
      threads: [
        {
          bodyText: "Hello from iCloud",
          from: { address: "sender@icloud.com", name: "Sender" },
          mailboxIds: ["INBOX"],
          messageCount: 1,
          receivedAt: timestamp,
          remoteThreadId: "icloud-thread",
          snippet: "Hello from iCloud",
          starred: false,
          subject: "iCloud mail",
          to: [],
          unread: true,
        },
      ],
    })),
    sendMail: vi.fn(async () => undefined),
    updateMailThread: vi.fn(async () => undefined),
    updateEvent: vi.fn(async () =>
      remoteEvent("icloud-created", "icloud-updated", "iCloud update"),
    ),
  };
}

describe.sequential("connector service", () => {
  let container: StartedPostgreSqlContainer;
  let database: DatabaseClient;
  let userId: string;
  let google: GoogleConnector;
  let icloud: ICloudConnector;
  let service: ReturnType<typeof createConnectorService>;

  async function waitForLock(queryPatterns: string[]): Promise<boolean> {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const result = await database.pool.query<{ blocked: boolean }>(
        `
        SELECT EXISTS (
          SELECT 1
          FROM pg_stat_activity
          WHERE datname = current_database()
            AND wait_event_type = 'Lock'
            ${queryPatterns.map((_, index) => `AND query LIKE $${index + 1}`).join("\n")}
        ) AS blocked
      `,
        queryPatterns,
      );
      if (result.rows[0]?.blocked) return true;
      await new Promise<void>((resolveAttempt) => {
        setTimeout(resolveAttempt, 25);
      });
    }
    return false;
  }

  async function waitForDomainProfileLock(): Promise<boolean> {
    return waitForLock(["%domain_profiles%", "%for update%"]);
  }

  async function waitForMailRuleWorkLock(): Promise<boolean> {
    return waitForLock(["%mail_rule_work_items%"]);
  }

  async function createDurableMailWorkFixture(name: string, action: MailRuleAction) {
    const slug = name.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-");
    const [workUser] = await database.db
      .insert(users)
      .values({
        displayName: name,
        email: `${slug}@example.com`,
        passwordHash: "unused",
        planningTimezone: "UTC",
      })
      .returning();
    if (!workUser) throw new Error("Durable Mail work user was not created.");
    const [account] = await database.db
      .insert(calendarAccounts)
      .values({
        calendarEnabled: false,
        email: `${slug}@example.com`,
        encryptedCredentials: encryptJson(credentials, encryptionKey),
        label: name,
        mailEnabled: true,
        provider: "google",
        providerAccountId: `provider-${slug}`,
        userId: workUser.id,
      })
      .returning();
    if (!account) throw new Error("Durable Mail work account was not created.");
    const delayedRetention =
      action.afterDays > 0 && (action.type === "archive" || action.type === "trash");
    const [profile] = await database.db
      .insert(domainProfiles)
      .values({
        categories: [],
        domain: "mail",
        instructions: [],
        objective: "Keep routine Mail noise out of the inbox.",
        preferences: {
          importantEmailHandling: "inbox_only",
          inboxStyle: "signal_only",
          noiseDisposition: delayedRetention
            ? action.type === "archive"
              ? "archive_after_days"
              : "trash_after_days"
            : "review_only",
          noiseRetentionDays: delayedRetention ? action.afterDays : null,
        },
        sourceContexts: [
          {
            notes: null,
            purpose: "Routine inbox",
            sourceId: account.id,
            sourceLabel: account.label,
          },
        ],
        status: "active",
        summary: "Routine Mail cleanup is approved.",
        userId: workUser.id,
      })
      .returning();
    if (!profile) throw new Error("Durable Mail work profile was not created.");
    const [rule] = await database.db
      .insert(mailRules)
      .values({
        actions: [action],
        condition: { field: "subject", operator: "contains", value: "routine" },
        enabled: true,
        name,
        policy: "approved_rule",
        profileId: profile.id,
        sourceAccountIds: [account.id],
        userId: workUser.id,
      })
      .returning();
    if (!rule) throw new Error("Durable Mail work rule was not created.");
    const [thread] = await database.db
      .insert(mailThreads)
      .values({
        accountId: account.id,
        bodyText: "Routine receipt",
        from: { address: "orders@example.com", name: "Orders" },
        provider: "google",
        receivedAt: new Date(timestamp.getTime() - 2 * 86_400_000),
        remoteMailboxIds: ["INBOX", "UNREAD"],
        remoteThreadId: `thread-${slug}`,
        snippet: "Routine receipt",
        starred: false,
        subject: `Routine ${name}`,
        to: [],
        unread: true,
        userId: workUser.id,
      })
      .returning();
    if (!thread) throw new Error("Durable Mail work thread was not created.");
    const dueAt = new Date(thread.receivedAt.getTime() + action.afterDays * 86_400_000);
    const [work] = await database.db
      .insert(mailRuleWorkItems)
      .values({
        accountId: account.id,
        action,
        actionFingerprint: durableMailRuleActionFingerprint(action),
        dueAt,
        nextAttemptAt: dueAt,
        profileId: profile.id,
        profileVersion: profile.version,
        remoteThreadId: thread.remoteThreadId,
        ruleId: rule.id,
        ruleVersion: rule.version,
        sourceUpdatedAt: thread.updatedAt,
        threadId: thread.id,
        userId: workUser.id,
      })
      .returning();
    if (!work) throw new Error("Durable Mail work item was not created.");
    return { account, profile, rule, thread, user: workUser, work };
  }

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
        displayName: "Connector Test",
        email: "connector@example.com",
        passwordHash: "unused",
        planningTimezone: "UTC",
      })
      .returning();
    if (!user) throw new Error("Fixture user was not created.");
    userId = user.id;
    google = mockGoogle();
    icloud = mockICloud();
    service = createConnectorService({
      db: database.db,
      encryptionKey,
      google,
      icloud,
      now: () => timestamp,
    });
    const initialUrl = await service.startGoogleAuthorization(userId, {
      returnTo: "/settings?section=connections",
      services: ["calendar"],
    });
    await service.completeGoogleAuthorization(
      String(new URL(initialUrl).searchParams.get("state")),
      "bootstrap-code",
    );
    const [initialAccount] = await service.listAccounts(userId);
    if (!initialAccount) throw new Error("Initial Google account was not created.");
    await service.syncAccount(userId, initialAccount.id);
    vi.clearAllMocks();
  }, 120_000);

  afterAll(async () => {
    await database.close();
    await container.stop();
  });

  it("upgrades an existing Google account with Mail and validates the selected identity", async () => {
    const [account] = await database.db
      .select()
      .from(calendarAccounts)
      .where(eq(calendarAccounts.providerAccountId, "google-person"));
    if (!account) throw new Error("Google account fixture is missing.");
    const mailCredentials = {
      ...credentials,
      scope: googleCalendarAndMailScope,
    };
    vi.mocked(google.exchangeCode).mockResolvedValueOnce(mailCredentials);
    vi.mocked(google.getProfile).mockResolvedValueOnce({
      credentials: mailCredentials,
      value: { email: "person@example.com", id: "google-person", name: "Google Person" },
    });
    vi.mocked(google.listCalendars).mockResolvedValueOnce({
      credentials: mailCredentials,
      value: [],
    });
    const syncMail = google.syncMail;
    if (!syncMail) throw new Error("Google Mail fixture is missing.");
    vi.mocked(syncMail).mockResolvedValueOnce({
      credentials: mailCredentials,
      value: {
        deletedThreadIds: [],
        mailboxes: [{ id: "INBOX", name: "Inbox", role: "inbox", totalCount: 1, unreadCount: 1 }],
        nextSyncToken: "mail-history-upgraded",
        reset: true,
        threads: [
          {
            bodyText: "Google body",
            from: { address: "sender@example.com", name: null },
            mailboxIds: ["INBOX"],
            messageCount: 1,
            receivedAt: timestamp,
            remoteThreadId: "google-thread",
            snippet: "Google preview",
            starred: false,
            subject: "Google mail",
            to: [],
            unread: true,
          },
        ],
      },
    });
    const url = await service.startGoogleAuthorization(userId, {
      accountId: account.id,
      returnTo: "/settings?section=connections",
      services: ["calendar", "mail"],
    });
    expect(google.authorizationUrl).toHaveBeenLastCalledWith(
      expect.stringMatching(/^oauth_/),
      expect.any(String),
      account.email,
      ["calendar", "mail"],
    );
    await service.completeGoogleAuthorization(
      String(new URL(url).searchParams.get("state")),
      "mail-code",
    );
    expect(google.listCalendars).not.toHaveBeenCalled();
    expect(google.syncMail).not.toHaveBeenCalled();
    await service.syncAccount(userId, account.id);
    expect(
      (await service.listAccounts(userId)).find((item) => item.id === account.id),
    ).toMatchObject({
      calendarEnabled: true,
      mailEnabled: true,
    });
    expect(
      await database.db.select().from(mailboxes).where(eq(mailboxes.accountId, account.id)),
    ).toEqual([expect.objectContaining({ name: "Inbox", unreadCount: 1 })]);
    expect(
      await database.db.select().from(mailThreads).where(eq(mailThreads.accountId, account.id)),
    ).toEqual([expect.objectContaining({ bodyText: "Google body", subject: "Google mail" })]);

    vi.mocked(google.exchangeCode).mockResolvedValueOnce(mailCredentials);
    vi.mocked(google.getProfile).mockResolvedValueOnce({
      credentials: mailCredentials,
      value: { email: "person@example.com", id: "google-person", name: "Google Person" },
    });
    vi.mocked(google.listCalendars).mockResolvedValueOnce({
      credentials: mailCredentials,
      value: [],
    });
    vi.mocked(syncMail).mockRejectedValueOnce(new Error("Mailbox bootstrap unavailable"));
    const degradedUrl = await service.startGoogleAuthorization(userId, {
      accountId: account.id,
      returnTo: "/settings?section=connections",
      services: ["calendar", "mail"],
    });
    await expect(
      service.completeGoogleAuthorization(
        String(new URL(degradedUrl).searchParams.get("state")),
        "degraded-mail-code",
      ),
    ).resolves.toEqual({
      accountId: account.id,
      email: "person@example.com",
      returnPath: "/settings?section=connections",
      userId,
    });
    await expect(service.syncAccount(userId, account.id)).rejects.toMatchObject({
      code: "service_unavailable",
      details: expect.objectContaining({ recovery: "automatic" }),
    });
    expect(
      (await service.listAccounts(userId)).find((item) => item.id === account.id),
    ).toMatchObject({
      mailEnabled: true,
      syncError: "Google is temporarily unavailable. ilo will retry automatically.",
      syncStatus: "error",
    });
    await service.syncAccount(userId, account.id);

    vi.mocked(google.getProfile).mockResolvedValueOnce({
      credentials,
      value: { email: "wrong@example.com", id: "wrong-account", name: null },
    });
    const mismatchUrl = await service.startGoogleAuthorization(userId, {
      accountId: account.id,
      returnTo: "/settings?section=connections",
      services: ["calendar", "mail"],
    });
    await expect(
      service.completeGoogleAuthorization(
        String(new URL(mismatchUrl).searchParams.get("state")),
        "wrong-code",
      ),
    ).rejects.toMatchObject({ code: "invalid_request" });
  });

  it("advances Gmail history and applies only explicit deletions under the sync claim", async () => {
    const [account] = await database.db
      .select()
      .from(calendarAccounts)
      .where(eq(calendarAccounts.providerAccountId, "google-person"));
    if (!account) throw new Error("Google account fixture is missing.");
    await database.db
      .update(calendarAccounts)
      .set({
        encryptedCredentials: encryptJson(
          { ...credentials, scope: googleCalendarAndMailScope },
          encryptionKey,
        ),
        mailEnabled: true,
        mailSyncToken: "history-before",
        syncStatus: "idle",
      })
      .where(eq(calendarAccounts.id, account.id));
    await database.db.insert(mailThreads).values([
      {
        accountId: account.id,
        bodyText: "Delete this thread",
        from: { address: "deleted@example.com", name: null },
        provider: "google",
        receivedAt: timestamp,
        remoteMailboxIds: ["INBOX"],
        remoteThreadId: "explicitly-deleted-thread",
        snippet: "Delete this thread",
        starred: false,
        subject: "Deleted",
        to: [],
        unread: false,
        userId,
      },
      {
        accountId: account.id,
        bodyText: "Retain this thread",
        from: { address: "retained@example.com", name: null },
        provider: "google",
        receivedAt: timestamp,
        remoteMailboxIds: ["INBOX"],
        remoteThreadId: "unobserved-retained-thread",
        snippet: "Retain this thread",
        starred: false,
        subject: "Retained",
        to: [],
        unread: false,
        userId,
      },
    ]);
    const syncMail = google.syncMail;
    if (!syncMail) throw new Error("Google Mail fixture is missing.");
    vi.mocked(syncMail).mockResolvedValueOnce({
      credentials,
      value: {
        deletedThreadIds: ["explicitly-deleted-thread"],
        mailboxes: [],
        nextSyncToken: "history-after",
        reset: false,
        threads: [],
      },
    });

    await service.syncAccount(userId, account.id);

    expect(syncMail).toHaveBeenLastCalledWith(
      expect.objectContaining({ accessToken: expect.any(String) }),
      "history-before",
      undefined,
    );
    const [updatedAccount] = await database.db
      .select({ mailSyncToken: calendarAccounts.mailSyncToken })
      .from(calendarAccounts)
      .where(eq(calendarAccounts.id, account.id));
    expect(updatedAccount?.mailSyncToken).toBe("history-after");
    const storedThreads = await database.db
      .select({ deletedAt: mailThreads.deletedAt, remoteThreadId: mailThreads.remoteThreadId })
      .from(mailThreads)
      .where(
        inArray(mailThreads.remoteThreadId, [
          "explicitly-deleted-thread",
          "unobserved-retained-thread",
        ]),
      )
      .orderBy(asc(mailThreads.remoteThreadId));
    expect(storedThreads).toEqual([
      { deletedAt: timestamp, remoteThreadId: "explicitly-deleted-thread" },
      { deletedAt: null, remoteThreadId: "unobserved-retained-thread" },
    ]);
  });

  it("claims one sync lease and rejects a concurrent sync for the same account", async () => {
    const [account] = await database.db
      .select()
      .from(calendarAccounts)
      .where(eq(calendarAccounts.providerAccountId, "google-person"));
    if (!account) throw new Error("Connected account fixture is missing.");
    const syncMail = google.syncMail;
    if (!syncMail) throw new Error("Google Mail sync fixture is unavailable.");
    await database.db
      .update(calendarAccounts)
      .set({ mailEnabled: true, syncStatus: "idle" })
      .where(eq(calendarAccounts.id, account.id));
    vi.mocked(syncMail).mockClear();
    let enteredSync: (() => void) | undefined;
    const syncWasEntered = new Promise<void>((resolveEntered) => {
      enteredSync = resolveEntered;
    });
    let releaseSync: (() => void) | undefined;
    const syncCanFinish = new Promise<void>((resolveSync) => {
      releaseSync = resolveSync;
    });
    vi.mocked(syncMail).mockImplementationOnce(async (currentCredentials) => {
      enteredSync?.();
      await syncCanFinish;
      return {
        credentials: currentCredentials,
        value: {
          deletedThreadIds: [],
          mailboxes: [],
          nextSyncToken: null,
          reset: false,
          threads: [],
        },
      };
    });

    const firstSync = service.syncAccount(userId, account.id);
    await syncWasEntered;
    await expect(service.syncAccount(userId, account.id)).rejects.toMatchObject({
      code: "conflict",
      details: { accountId: account.id, syncStatus: "syncing" },
    });
    releaseSync?.();
    await expect(firstSync).resolves.toEqual(
      expect.objectContaining({ changed: expect.any(Number) }),
    );
    expect(syncMail).toHaveBeenCalledOnce();
  });

  it("settles a quiesce-interrupted sync durably and allows a new runtime to retry it", async () => {
    const controller = new AbortController();
    const interrupted = new Error("runtime quiescing");
    const cancellableGoogle = mockGoogle();
    let markProviderStarted: () => void = () => {};
    const providerStarted = new Promise<void>((resolve) => {
      markProviderStarted = resolve;
    });
    const cancellableSyncMail = cancellableGoogle.syncMail;
    if (!cancellableSyncMail) throw new Error("Google Mail sync fixture is unavailable.");
    vi.mocked(cancellableSyncMail).mockImplementationOnce(
      async (_currentCredentials, _syncToken, operation) => {
        markProviderStarted();
        await new Promise<void>((resolve) => {
          operation?.signal?.addEventListener("abort", () => resolve(), {
            once: true,
          });
        });
        return {
          credentials: rotatedCredentials,
          value: {
            deletedThreadIds: [],
            mailboxes: [],
            nextSyncToken: null,
            reset: false,
            threads: [],
          },
        };
      },
    );
    const [account] = await database.db
      .insert(calendarAccounts)
      .values({
        calendarEnabled: false,
        email: "quiesce-retry@example.com",
        encryptedCredentials: encryptJson(credentials, encryptionKey),
        label: "Quiesce retry",
        lastSyncedAt: timestamp,
        mailEnabled: true,
        provider: "google",
        providerAccountId: "quiesce-retry",
        userId,
      })
      .returning();
    if (!account) throw new Error("Quiesce retry account fixture was not created.");
    const cancellableService = createConnectorService({
      db: database.db,
      encryptionKey,
      google: cancellableGoogle,
      now: () => timestamp,
      shutdown: {
        deadlineMs: () => timestamp.getTime() + 105_000,
        signal: controller.signal,
      },
    });

    const sync = cancellableService.syncAccount(userId, account.id);
    await providerStarted;
    controller.abort(interrupted);
    await expect(sync).rejects.toBe(interrupted);

    const [settled] = await database.db
      .select()
      .from(calendarAccounts)
      .where(eq(calendarAccounts.id, account.id));
    expect(settled).toMatchObject({
      lastSyncedAt: timestamp,
      nextSyncAt: timestamp,
      syncError: "Synchronization was interrupted. ilo will retry automatically.",
      syncRecovery: "automatic",
      syncStatus: "idle",
    });

    const retryService = createConnectorService({
      db: database.db,
      encryptionKey,
      google: cancellableGoogle,
      now: () => timestamp,
    });
    await expect(retryService.syncStaleAccounts()).resolves.toBeUndefined();
    await expect(
      database.db.select().from(calendarAccounts).where(eq(calendarAccounts.id, account.id)),
    ).resolves.toEqual([
      expect.objectContaining({
        lastSyncedAt: timestamp,
        syncError: null,
        syncStatus: "idle",
      }),
    ]);

    const [lateAccount] = await database.db
      .insert(calendarAccounts)
      .values({
        calendarEnabled: false,
        email: "late-quiesce-claim@example.com",
        encryptedCredentials: encryptJson(credentials, encryptionKey),
        label: "Late quiesce claim",
        mailEnabled: true,
        provider: "google",
        providerAccountId: "late-quiesce-claim",
        userId,
      })
      .returning();
    if (!lateAccount) throw new Error("Late quiesce account fixture was not created.");
    const providerCallsBeforeLateClaim = vi.mocked(cancellableSyncMail).mock.calls.length;
    await expect(cancellableService.syncAccount(userId, lateAccount.id)).rejects.toBe(interrupted);
    expect(vi.mocked(cancellableSyncMail)).toHaveBeenCalledTimes(providerCallsBeforeLateClaim);
    await expect(
      database.db.select().from(calendarAccounts).where(eq(calendarAccounts.id, lateAccount.id)),
    ).resolves.toEqual([expect.objectContaining({ syncError: null, syncStatus: "idle" })]);
  });

  it("releases the sync lease when credential setup fails", async () => {
    const [account] = await database.db
      .insert(calendarAccounts)
      .values({
        calendarEnabled: false,
        email: "corrupt-credentials@example.com",
        encryptedCredentials: {
          ciphertext: "invalid",
          iv: "invalid",
          tag: "invalid",
          version: 1,
        },
        label: "Corrupt credentials",
        mailEnabled: true,
        provider: "google",
        providerAccountId: "corrupt-credentials",
        userId,
      })
      .returning();
    if (!account) throw new Error("Corrupt credential account fixture was not created.");

    await expect(service.syncAccount(userId, account.id)).rejects.toBeDefined();
    await expect(
      database.db.select().from(calendarAccounts).where(eq(calendarAccounts.id, account.id)),
    ).resolves.toEqual([
      expect.objectContaining({
        syncError: expect.any(String),
        syncStatus: "error",
      }),
    ]);
    const [missingCredentialsAccount] = await database.db
      .insert(calendarAccounts)
      .values({
        calendarEnabled: false,
        email: "missing-credentials@example.com",
        label: "Missing credentials",
        mailEnabled: true,
        provider: "google",
        providerAccountId: "missing-credentials",
        userId,
      })
      .returning();
    if (!missingCredentialsAccount) {
      throw new Error("Missing credential account fixture was not created.");
    }
    await expect(service.syncAccount(userId, missingCredentialsAccount.id)).rejects.toMatchObject({
      code: "service_unavailable",
      details: expect.objectContaining({ recovery: "operator" }),
    });
    await expect(
      database.db
        .select()
        .from(calendarAccounts)
        .where(eq(calendarAccounts.id, missingCredentialsAccount.id)),
    ).resolves.toEqual([
      expect.objectContaining({
        syncError: "Google is not configured correctly. ilo is resolving this.",
        syncRecovery: "operator",
        syncStatus: "error",
      }),
    ]);
  });

  it("recovers a stale sync lease", async () => {
    const [account] = await database.db
      .select()
      .from(calendarAccounts)
      .where(eq(calendarAccounts.providerAccountId, "google-person"));
    if (!account) throw new Error("Connected account fixture is missing.");
    await database.db
      .update(calendarAccounts)
      .set({
        syncClaimId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        syncStatus: "syncing",
        updatedAt: new Date(timestamp.getTime() - 31 * 60_000),
      })
      .where(eq(calendarAccounts.id, account.id));
    await expect(service.syncAccount(userId, account.id)).resolves.toEqual(
      expect.objectContaining({ changed: expect.any(Number) }),
    );
    const [recovered] = await database.db
      .select()
      .from(calendarAccounts)
      .where(eq(calendarAccounts.id, account.id));
    expect(recovered).toMatchObject({ syncError: null, syncStatus: "idle" });
  });

  it("schedules every due capability with bounded concurrency and skips reconnect accounts", async () => {
    const [schedulerUser] = await database.db
      .insert(users)
      .values({
        displayName: "Connector Scheduler",
        email: "connector-scheduler@example.com",
        passwordHash: "unused",
        planningTimezone: "UTC",
      })
      .returning();
    if (!schedulerUser) throw new Error("Connector scheduler user was not created.");
    const schedulerGoogle = mockGoogle();
    let active = 0;
    let maxObservedConcurrency = 0;
    const boundedProviderCall = async () => {
      active += 1;
      maxObservedConcurrency = Math.max(maxObservedConcurrency, active);
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 10));
      active -= 1;
    };
    vi.mocked(schedulerGoogle.listCalendars).mockImplementation(async (value) => {
      await boundedProviderCall();
      return { credentials: value, value: [] };
    });
    const schedulerSyncMail = schedulerGoogle.syncMail;
    if (!schedulerSyncMail) throw new Error("Scheduler Mail fixture is unavailable.");
    vi.mocked(schedulerSyncMail).mockImplementation(async (value) => {
      await boundedProviderCall();
      return {
        credentials: value,
        value: {
          deletedThreadIds: [],
          mailboxes: [],
          nextSyncToken: null,
          reset: false,
          threads: [],
        },
      };
    });
    const schedulerLogs: unknown[] = [];
    const encryptedCredentials = encryptJson(credentials, encryptionKey);
    await database.db.insert(calendarAccounts).values([
      {
        calendarEnabled: true,
        encryptedCredentials,
        label: "Due Calendar",
        mailEnabled: false,
        nextSyncAt: new Date(timestamp.getTime() - 5 * 60_000),
        provider: "google",
        providerAccountId: "scheduler-calendar",
        userId: schedulerUser.id,
      },
      {
        calendarEnabled: false,
        encryptedCredentials,
        label: "Due Mail",
        mailEnabled: true,
        nextSyncAt: new Date(timestamp.getTime() - 4 * 60_000),
        provider: "google",
        providerAccountId: "scheduler-mail",
        userId: schedulerUser.id,
      },
      {
        calendarEnabled: false,
        encryptedCredentials,
        label: "Retry Mail",
        mailEnabled: true,
        nextSyncAt: new Date(timestamp.getTime() - 3 * 60_000),
        provider: "google",
        providerAccountId: "scheduler-retry",
        syncError: "Google is temporarily unavailable. ilo will retry automatically.",
        syncErrorCategory: "temporary",
        syncErrorCode: "google_temporary_failure",
        syncFailureCount: 1,
        syncRecovery: "automatic",
        syncStatus: "error",
        userId: schedulerUser.id,
      },
      {
        calendarEnabled: true,
        encryptedCredentials,
        label: "Future Calendar",
        mailEnabled: false,
        nextSyncAt: new Date(timestamp.getTime() + 5 * 60_000),
        provider: "google",
        providerAccountId: "scheduler-future",
        userId: schedulerUser.id,
      },
      {
        calendarEnabled: false,
        encryptedCredentials,
        label: "Reconnect Mail",
        mailEnabled: true,
        provider: "google",
        providerAccountId: "scheduler-reconnect",
        syncError: "Google authorization is no longer valid. Reconnect to resume syncing.",
        syncErrorCategory: "authorization",
        syncErrorCode: "google_authorization_failed",
        syncFailureCount: 1,
        syncRecovery: "reconnect",
        syncStatus: "error",
        userId: schedulerUser.id,
      },
      {
        calendarEnabled: true,
        encryptedCredentials,
        label: "Stale Calendar Claim",
        mailEnabled: false,
        provider: "google",
        providerAccountId: "scheduler-stale",
        syncClaimId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        syncStatus: "syncing",
        updatedAt: new Date(timestamp.getTime() - 31 * 60_000),
        userId: schedulerUser.id,
      },
    ]);
    const schedulerService = createConnectorService({
      db: database.db,
      encryptionKey,
      google: schedulerGoogle,
      icloud,
      log: (entry) => schedulerLogs.push(entry),
      now: () => timestamp,
    });

    await expect(schedulerService.syncDueAccounts({ concurrency: 2, limit: 10 })).resolves.toEqual({
      attempted: 4,
      failed: 0,
      recovered: 1,
      skipped: 0,
      succeeded: 4,
    });
    expect(schedulerGoogle.listCalendars).toHaveBeenCalledTimes(2);
    expect(schedulerSyncMail).toHaveBeenCalledTimes(2);
    expect(maxObservedConcurrency).toBeLessThanOrEqual(2);

    const [concurrentAccount] = await database.db
      .insert(calendarAccounts)
      .values({
        calendarEnabled: false,
        encryptedCredentials,
        label: "Concurrent Mail",
        mailEnabled: true,
        nextSyncAt: new Date(timestamp.getTime() - 60_000),
        provider: "google",
        providerAccountId: "scheduler-concurrent",
        userId: schedulerUser.id,
      })
      .returning();
    if (!concurrentAccount) throw new Error("Concurrent scheduler account was not created.");
    vi.mocked(schedulerSyncMail).mockClear();
    await Promise.all([
      schedulerService.syncDueAccounts({ concurrency: 1, limit: 10 }),
      schedulerService.syncDueAccounts({ concurrency: 1, limit: 10 }),
    ]);
    expect(schedulerSyncMail).toHaveBeenCalledOnce();

    vi.mocked(schedulerSyncMail).mockRejectedValueOnce(
      new Error("scheduler-provider-canary token=secret"),
    );
    const [failingAccount] = await database.db
      .insert(calendarAccounts)
      .values({
        calendarEnabled: false,
        encryptedCredentials,
        label: "Failing Mail",
        mailEnabled: true,
        nextSyncAt: new Date(timestamp.getTime() - 60_000),
        provider: "google",
        providerAccountId: "scheduler-failure",
        userId: schedulerUser.id,
      })
      .returning();
    if (!failingAccount) throw new Error("Failing scheduler account was not created.");
    await expect(schedulerService.syncDueAccounts()).resolves.toMatchObject({
      attempted: 1,
      failed: 1,
    });
    expect(schedulerLogs).toContainEqual(
      expect.objectContaining({
        accountId: failingAccount.id,
        category: "unknown",
        disposition: "automatic",
        event: "connector_sync_failed",
      }),
    );
    expect(JSON.stringify(schedulerLogs)).not.toContain("scheduler-provider-canary");

    await database.db
      .update(calendarAccounts)
      .set({ nextSyncAt: timestamp })
      .where(eq(calendarAccounts.id, failingAccount.id));
    await expect(schedulerService.syncDueAccounts()).resolves.toMatchObject({
      recovered: 1,
      succeeded: 1,
    });
    expect(schedulerLogs).toContainEqual(
      expect.objectContaining({
        accountId: failingAccount.id,
        event: "connector_sync_recovered",
      }),
    );
  });

  it("writes Google Mail through the provider gateway and refreshes credentials", async () => {
    const [account] = await database.db
      .select()
      .from(calendarAccounts)
      .where(eq(calendarAccounts.providerAccountId, "google-person"));
    if (!account) throw new Error("Connected account fixture is missing.");
    await service.mailGateway.send(userId, account.id, {
      body: "Hello",
      cc: [],
      subject: "Subject",
      to: [{ address: "to@example.com", name: null }],
    });
    await service.mailGateway.update(userId, account.id, "remote-thread", {
      addMailboxIds: ["STARRED"],
      removeMailboxIds: ["UNREAD"],
    });
    expect(google.sendMail).toHaveBeenCalledOnce();
    expect(google.updateMailThread).toHaveBeenCalledOnce();
    const { sendMail: _sendMail, ...googleWithoutSend } = google;
    const serviceWithoutSend = createConnectorService({
      db: database.db,
      encryptionKey,
      google: googleWithoutSend,
      icloud,
      now: () => timestamp,
    });
    await expect(
      serviceWithoutSend.mailGateway.send(userId, account.id, {
        body: "Hello",
        cc: [],
        subject: "Subject",
        to: [{ address: "to@example.com", name: null }],
      }),
    ).rejects.toMatchObject({ code: "service_unavailable" });
  });

  it("reports direct provider updates when rotated credentials cannot be saved", async () => {
    const [account] = await database.db
      .select()
      .from(calendarAccounts)
      .where(eq(calendarAccounts.providerAccountId, "google-person"));
    if (!account) throw new Error("Connected account fixture is missing.");
    const updateMailThread = google.updateMailThread;
    if (!updateMailThread) throw new Error("Google Mail update fixture is unavailable.");
    vi.mocked(updateMailThread).mockClear();
    vi.mocked(updateMailThread).mockResolvedValueOnce({
      ...rotatedCredentials,
      accessToken: "direct-fault-token",
      expiresAt: "2027-07-13T13:00:00.000Z",
    });
    await database.pool.query(`
      CREATE OR REPLACE FUNCTION fail_direct_mail_credential_save_for_test() RETURNS trigger AS $$
      BEGIN
        IF NEW.encrypted_credentials IS DISTINCT FROM OLD.encrypted_credentials THEN
          RAISE EXCEPTION 'forced direct credential save failure';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
      CREATE TRIGGER fail_direct_mail_credential_save_for_test
      BEFORE UPDATE ON calendar_accounts
      FOR EACH ROW EXECUTE FUNCTION fail_direct_mail_credential_save_for_test();
    `);
    try {
      await expect(
        service.mailGateway.update(userId, account.id, "direct-partial-thread", {
          addMailboxIds: ["STARRED"],
          removeMailboxIds: [],
        }),
      ).rejects.toMatchObject({
        code: "service_unavailable",
        details: {
          accountId: account.id,
          credentialPersistenceMayHaveFailed: true,
          operation: "thread_update",
          partialEffect: true,
          remoteThreadId: "direct-partial-thread",
          repairAction: "reconnect_then_sync_mail_account",
        },
      });
      expect(updateMailThread).toHaveBeenCalledWith(
        expect.anything(),
        "direct-partial-thread",
        expect.any(Object),
      );
    } finally {
      await database.pool.query(`
        DROP TRIGGER IF EXISTS fail_direct_mail_credential_save_for_test ON calendar_accounts;
        DROP FUNCTION IF EXISTS fail_direct_mail_credential_save_for_test();
      `);
    }
  });

  it("rejects Mail gateways when Google or iCloud Mail capability is disabled", async () => {
    const [googleAccount] = await database.db
      .select()
      .from(calendarAccounts)
      .where(eq(calendarAccounts.providerAccountId, "google-person"));
    if (!googleAccount) throw new Error("Connected Google fixture is missing.");
    await database.db
      .update(calendarAccounts)
      .set({ mailEnabled: false })
      .where(eq(calendarAccounts.id, googleAccount.id));
    await expect(
      service.mailGateway.send(userId, googleAccount.id, {
        body: "Blocked",
        cc: [],
        subject: "Blocked",
        to: [{ address: "to@example.com", name: null }],
      }),
    ).rejects.toThrow("Mail is not enabled");
    await expect(
      service.mailGateway.update(userId, googleAccount.id, "blocked-thread", {
        addMailboxIds: ["STARRED"],
      }),
    ).rejects.toThrow("Mail is not enabled");
    await database.db
      .update(calendarAccounts)
      .set({ mailEnabled: true })
      .where(eq(calendarAccounts.id, googleAccount.id));

    const disabledICloud = await service.connectICloud(userId, {
      appSpecificPassword: "disabled-mail-password",
      calendar: true,
      email: "calendar-only@icloud.example",
      mail: false,
    });
    await expect(
      service.mailGateway.send(userId, disabledICloud.accountId, {
        body: "Blocked",
        cc: [],
        subject: "Blocked",
        to: [{ address: "to@example.com", name: null }],
      }),
    ).rejects.toThrow("Mail is not enabled");
    await expect(
      service.mailGateway.update(userId, disabledICloud.accountId, "blocked-thread", {
        removeMailboxIds: ["UNREAD"],
      }),
    ).rejects.toThrow("Mail is not enabled");
    const [missingSender] = await database.db
      .insert(calendarAccounts)
      .values({
        calendarEnabled: false,
        encryptedCredentials: {
          ciphertext: "unused",
          iv: "unused",
          tag: "unused",
          version: 1,
        },
        label: "Missing sender",
        mailEnabled: true,
        provider: "google",
        providerAccountId: "missing-sender",
        userId,
      })
      .returning();
    if (!missingSender) throw new Error("Missing sender account fixture was not created.");
    await expect(
      service.mailGateway.send(userId, missingSender.id, {
        body: "Blocked",
        cc: [],
        subject: "Blocked",
        to: [{ address: "to@example.com", name: null }],
      }),
    ).rejects.toThrow("no sender address");
  });

  it("classifies only failures before a Google send request as safe pre-acceptance failures", async () => {
    const [googleAccount] = await database.db
      .select()
      .from(calendarAccounts)
      .where(eq(calendarAccounts.providerAccountId, "google-person"));
    if (!googleAccount) throw new Error("Google account fixture is missing.");
    const sendGoogle = google.sendMail;
    const sendICloud = icloud.sendMail;
    if (!sendGoogle || !sendICloud) throw new Error("Mail send fixtures are unavailable.");
    vi.mocked(sendGoogle).mockRejectedValueOnce(
      new MailSendPreAcceptanceError("Token refresh rejected", connectorError("401", 401)),
    );
    await expect(
      service.mailGateway.send(userId, googleAccount.id, {
        body: "Rejected",
        cc: [],
        subject: "Rejected",
        to: [{ address: "to@example.com", name: null }],
      }),
    ).rejects.toBeInstanceOf(MailProviderRejectedError);
    for (const status of [400, 401, 500]) {
      vi.mocked(sendGoogle).mockRejectedValueOnce(
        connectorError(`Ambiguous Google ${status}`, status),
      );
      await expect(
        service.mailGateway.send(userId, googleAccount.id, {
          body: "Ambiguous",
          cc: [],
          subject: `Ambiguous ${status}`,
          to: [{ address: "to@example.com", name: null }],
        }),
      ).rejects.toMatchObject({ status });
    }
    vi.mocked(sendGoogle).mockRejectedValueOnce(new DOMException("Timed out", "AbortError"));
    await expect(
      service.mailGateway.send(userId, googleAccount.id, {
        body: "Timed out",
        cc: [],
        subject: "Timed out",
        to: [{ address: "to@example.com", name: null }],
      }),
    ).rejects.toMatchObject({ name: "AbortError" });

    const connectedICloud = await service.connectICloud(userId, {
      appSpecificPassword: "test-app-password",
      calendar: false,
      email: "ambiguous@icloud.example",
      mail: true,
    });
    vi.mocked(sendICloud).mockRejectedValueOnce(connectorError("SMTP transport closed", 502));
    await expect(
      service.mailGateway.send(userId, connectedICloud.accountId, {
        body: "Ambiguous",
        cc: [],
        subject: "Ambiguous",
        to: [{ address: "to@example.com", name: null }],
      }),
    ).rejects.toBeInstanceOf(ConnectorError);
    vi.mocked(sendGoogle).mockResolvedValue(rotatedCredentials);
    vi.mocked(sendICloud).mockResolvedValue(undefined);
  });

  it("preserves durable draft recovery when provider send credential persistence fails", async () => {
    const [account] = await database.db
      .select()
      .from(calendarAccounts)
      .where(eq(calendarAccounts.providerAccountId, "google-person"));
    if (!account) throw new Error("Google account fixture is missing.");
    const mail = createMailService({
      db: database.db,
      gateway: service.mailGateway,
      now: () => timestamp,
      reviewSigningKey: "connector-send-review-key",
    });
    const draft = await mail.createDraft(userId, {
      accountId: account.id,
      body: "Credential persistence body",
      cc: [],
      subject: "Credential persistence send",
      to: [{ address: "to@example.com", name: null }],
    });
    const sendGoogle = google.sendMail;
    if (!sendGoogle) throw new Error("Google Mail send fixture is unavailable.");
    vi.mocked(sendGoogle).mockResolvedValueOnce({
      ...rotatedCredentials,
      accessToken: "send-persistence-fault-token",
      expiresAt: "2032-07-13T13:00:00.000Z",
    });
    await database.pool.query(`
      CREATE OR REPLACE FUNCTION fail_mail_send_credential_save_for_test() RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'forced credential persistence failure';
      END;
      $$ LANGUAGE plpgsql;
      CREATE TRIGGER fail_mail_send_credential_save_for_test
      BEFORE UPDATE OF encrypted_credentials ON calendar_accounts
      FOR EACH ROW
      WHEN (OLD.id = '${account.id}'::uuid)
      EXECUTE FUNCTION fail_mail_send_credential_save_for_test();
    `);
    try {
      await expect(
        mail.send(
          userId,
          {
            accountId: account.id,
            body: draft.body,
            cc: draft.cc,
            draftId: draft.id,
            subject: draft.subject,
            to: draft.to,
          },
          {
            principal: {
              actorId: userId,
              actorType: "user",
              scopes: new Set(["mail:read", "mail:write"]),
              userId,
            },
            requestId: "credential-partial-draft-send",
          },
        ),
      ).rejects.toMatchObject({
        code: "service_unavailable",
        details: expect.objectContaining({
          credentialPersistenceMayHaveFailed: true,
          draftId: draft.id,
          draftReconciliationStatePersisted: true,
          partialEffect: true,
          repairAction: "verify_sent_mail_then_reconcile_draft",
          userActionDestination: "Provider Sent Mail; then Ilo Mail",
          userActionRequired: true,
        }),
      });
      await expect(
        database.db.select().from(mailDrafts).where(eq(mailDrafts.id, draft.id)),
      ).resolves.toEqual([expect.objectContaining({ sendStatus: "reconcile" })]);
    } finally {
      await database.pool.query(`
        DROP TRIGGER IF EXISTS fail_mail_send_credential_save_for_test ON calendar_accounts;
        DROP FUNCTION IF EXISTS fail_mail_send_credential_save_for_test();
      `);
    }
  });

  it("persists the newest out-of-order Google credential across concurrent Mail gateways", async () => {
    const [account] = await database.db
      .select()
      .from(calendarAccounts)
      .where(eq(calendarAccounts.providerAccountId, "google-person"));
    if (!account) throw new Error("Connected account fixture is missing.");
    const updateMailThread = google.updateMailThread;
    if (!updateMailThread) throw new Error("Google Mail update fixture is unavailable.");
    let releaseOlder: (() => void) | undefined;
    let olderStarted: (() => void) | undefined;
    const olderCallStarted = new Promise<void>((resolveStarted) => {
      olderStarted = resolveStarted;
    });
    vi.mocked(updateMailThread).mockImplementation(async (_value, remoteThreadId) => {
      if (remoteThreadId === "older-credential-thread") {
        olderStarted?.();
        await new Promise<void>((resolveOlder) => {
          releaseOlder = resolveOlder;
        });
        return {
          ...rotatedCredentials,
          accessToken: "older-access",
          expiresAt: "2030-07-13T13:00:00.000Z",
          refreshToken: "",
        };
      }
      return {
        ...rotatedCredentials,
        accessToken: "newest-access",
        expiresAt: "2031-07-13T13:00:00.000Z",
        refreshToken: "newest-refresh",
      };
    });
    const older = service.mailGateway.update(userId, account.id, "older-credential-thread", {
      addMailboxIds: ["STARRED"],
    });
    await olderCallStarted;
    await service.mailGateway.update(userId, account.id, "newer-credential-thread", {
      removeMailboxIds: ["UNREAD"],
    });
    releaseOlder?.();
    await older;
    const [persistedAccount] = await database.db
      .select({ encryptedCredentials: calendarAccounts.encryptedCredentials })
      .from(calendarAccounts)
      .where(eq(calendarAccounts.id, account.id));
    if (!persistedAccount?.encryptedCredentials) {
      throw new Error("Persisted credential fixture disappeared.");
    }
    expect(
      decryptJson<GoogleCredentials>(persistedAccount.encryptedCredentials, encryptionKey),
    ).toMatchObject({
      accessToken: "newest-access",
      expiresAt: "2031-07-13T13:00:00.000Z",
      refreshToken: "newest-refresh",
    });
    vi.mocked(updateMailThread).mockResolvedValue(rotatedCredentials);
  });

  it("records every approved Mail effect durably before provider execution", async () => {
    const [account] = await database.db
      .select()
      .from(calendarAccounts)
      .where(eq(calendarAccounts.providerAccountId, "google-person"));
    if (!account) throw new Error("Connected account fixture is missing.");
    const updateMailThread = google.updateMailThread;
    if (!updateMailThread) throw new Error("Google Mail update fixture is unavailable.");
    vi.mocked(updateMailThread).mockClear();
    const [profile] = await database.db
      .insert(domainProfiles)
      .values({
        categories: [],
        domain: "mail",
        instructions: [],
        objective: "Keep important Mail visible.",
        preferences: {
          importantEmailHandling: "inbox_and_attention",
          inboxStyle: "conservative",
          noiseDisposition: "trash_after_days",
          noiseRetentionDays: 1,
        },
        sourceContexts: [
          {
            notes: null,
            purpose: "Primary inbox",
            sourceId: account.id,
            sourceLabel: account.label,
          },
        ],
        status: "active",
        summary: "Review noise manually.",
        userId,
      })
      .returning();
    if (!profile) throw new Error("Mail profile fixture was not created.");
    await database.db.insert(mailThreads).values({
      accountId: account.id,
      bodyText: "Previously observed body",
      from: { address: "older@example.com", name: null },
      provider: "google",
      receivedAt: new Date("2026-07-01T12:00:00.000Z"),
      remoteMailboxIds: ["INBOX"],
      remoteThreadId: "previously-observed-thread",
      snippet: "Previously observed",
      starred: false,
      subject: "Previously observed",
      to: [],
      unread: false,
      userId,
    });
    await database.db.insert(mailRules).values([
      {
        actions: [{ afterDays: 0, mailboxId: null, type: "mark_read" }],
        condition: { field: "any", operator: "contains", value: "google mail" },
        enabled: true,
        name: "Read project mail",
        policy: "approved_rule",
        profileId: profile.id,
        sourceAccountIds: [account.id],
        userId,
      },
      {
        actions: [{ afterDays: 1, mailboxId: null, type: "trash" }],
        condition: { field: "any", operator: "contains", value: "google mail" },
        enabled: true,
        name: "Trash project mail after one day",
        policy: "approved_rule",
        profileId: profile.id,
        sourceAccountIds: [account.id],
        userId,
      },
      {
        actions: [{ afterDays: 0, mailboxId: null, type: "star" }],
        condition: { field: "any", operator: "contains", value: "google mail" },
        enabled: true,
        name: "Star project mail",
        policy: "approved_rule",
        profileId: profile.id,
        sourceAccountIds: [account.id],
        userId,
      },
    ]);
    const syncMail = google.syncMail;
    if (!syncMail) throw new Error("Google Mail sync is unavailable.");
    const completeMailValue: MailSyncResult["value"] = {
      deletedThreadIds: [],
      mailboxes: [{ id: "INBOX", name: "Inbox", role: "inbox", totalCount: 1, unreadCount: 1 }],
      nextSyncToken: "complete-mail-history",
      reset: false,
      threads: [
        {
          bodyText: "Body",
          from: { address: "sender@example.com", name: "Sender" },
          mailboxIds: ["INBOX", "UNREAD"],
          messages: [
            {
              attachments: [
                {
                  contentType: "text/calendar",
                  filename: "removed.ics",
                  id: "removed-calendar-attachment",
                  providerAttachmentId: "removed-calendar-attachment",
                  providerPartId: "1",
                  size: 72,
                },
              ],
              bodyText: "Removed message",
              cc: [],
              from: { address: "sender@example.com", name: "Sender" },
              mailboxIds: ["INBOX"],
              providerRevision: "history-removed",
              receivedAt: new Date(timestamp.getTime() - 1_000),
              remoteMessageId: "removed-message",
              to: [],
            },
            {
              attachments: [
                {
                  contentType: "application/pdf",
                  filename: "brief.pdf",
                  id: "attachment-1",
                  size: 42,
                },
                {
                  contentType: "text/calendar; method=REQUEST",
                  filename: "invite.ics",
                  id: "calendar-attachment-1",
                  providerAttachmentId: "calendar-attachment-1",
                  providerPartId: "2",
                  size: 84,
                },
                {
                  contentType: "text/calendar; method=REQUEST",
                  filename: "",
                  id: "part:3",
                  providerAttachmentId: null,
                  providerPartId: "3",
                  size: 64,
                },
              ],
              bodyText: "Body",
              cc: [],
              from: { address: "sender@example.com", name: "Sender" },
              mailboxIds: ["INBOX", "SENT"],
              providerRevision: "history-1",
              receivedAt: timestamp,
              remoteMessageId: "ruled-message",
              to: [],
            },
          ],
          messagesComplete: true,
          messageCount: 2,
          receivedAt: timestamp,
          remoteThreadId: "ruled-thread",
          snippet: "Google Mail",
          starred: false,
          subject: "Google Mail",
          to: [],
          unread: true,
        },
      ],
    };
    vi.mocked(syncMail).mockResolvedValueOnce({ credentials, value: completeMailValue });
    await service.syncAccount(userId, account.id);
    expect(google.updateMailThread).not.toHaveBeenCalled();
    await expect(database.db.select().from(mailRuleWorkItems)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: { afterDays: 0, mailboxId: null, type: "mark_read" },
          remoteThreadId: "ruled-thread",
          status: "pending",
        }),
        expect.objectContaining({
          action: { afterDays: 0, mailboxId: null, type: "star" },
          remoteThreadId: "ruled-thread",
          status: "pending",
        }),
        expect.objectContaining({
          action: { afterDays: 1, mailboxId: null, type: "trash" },
          remoteThreadId: "ruled-thread",
          status: "pending",
        }),
      ]),
    );
    await expect(service.dispatchDueMailRuleWork()).resolves.toMatchObject({
      claimed: 1,
      succeeded: 1,
    });
    await expect(service.dispatchDueMailRuleWork()).resolves.toMatchObject({
      claimed: 1,
      succeeded: 1,
    });
    expect(google.updateMailThread).toHaveBeenCalledWith(expect.anything(), "ruled-thread", {
      addMailboxIds: [],
      removeMailboxIds: ["UNREAD"],
    });
    expect(google.updateMailThread).toHaveBeenCalledWith(expect.anything(), "ruled-thread", {
      addMailboxIds: ["STARRED"],
      removeMailboxIds: [],
    });
    expect(google.updateMailThread).toHaveBeenCalledTimes(2);
    const [thread] = await database.db
      .select()
      .from(mailThreads)
      .where(eq(mailThreads.remoteThreadId, "ruled-thread"));
    expect(thread).toMatchObject({
      remoteMailboxIds: ["INBOX", "STARRED"],
      starred: true,
      unread: false,
    });
    const [previouslyObserved] = await database.db
      .select()
      .from(mailThreads)
      .where(eq(mailThreads.remoteThreadId, "previously-observed-thread"));
    expect(previouslyObserved?.deletedAt).toBeNull();
    await expect(database.db.select().from(mailRules)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          enabled: true,
          name: "Trash project mail after one day",
          policy: "approved_rule",
          version: 1,
        }),
      ]),
    );
    await expect(database.db.select().from(mailMessages)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ remoteMessageId: "removed-message" }),
        expect.objectContaining({ remoteMessageId: "ruled-message" }),
      ]),
    );
    await expect(database.db.select().from(mailCalendarCommitmentIntakes)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          attachment: expect.objectContaining({
            providerAttachmentId: "calendar-attachment-1",
            providerPartId: "2",
          }),
          authority: "provider_projected_unverified",
          evidenceKind: "calendar_attachment_metadata",
          remoteMessageId: "ruled-message",
          remotePartId: "2",
          sourceMessageMailboxIds: ["INBOX", "SENT"],
          sourceMessageRevision: "history-1",
          status: "preview_only",
        }),
        expect.objectContaining({
          attachment: expect.objectContaining({
            filename: "",
            providerAttachmentId: null,
            providerPartId: "3",
          }),
          remoteMessageId: "ruled-message",
          remotePartId: "3",
          status: "preview_only",
        }),
      ]),
    );
    const intakeAudit = (
      await database.db
        .select()
        .from(auditEvents)
        .where(eq(auditEvents.entityType, "mail_calendar_commitment_intake"))
    ).at(-1);
    expect(intakeAudit).toMatchObject({
      action: "mail_calendar_intake.recorded",
      actorType: "connector",
      after: {
        authority: "provider_projected_unverified",
        evidenceKind: "calendar_attachment_metadata",
        status: "preview_only",
      },
    });
    expect(JSON.stringify(intakeAudit)).not.toContain("invite.ics");

    const [intake] = await database.db
      .select()
      .from(mailCalendarCommitmentIntakes)
      .where(eq(mailCalendarCommitmentIntakes.remoteMessageId, "ruled-message"));
    const [message] = await database.db
      .select()
      .from(mailMessages)
      .where(eq(mailMessages.remoteMessageId, "ruled-message"));
    if (!intake || !message || !thread) throw new Error("Commitment intake fixture is missing.");
    expect(JSON.stringify(intakeAudit)).not.toContain(intake.sourceFingerprint);
    await expect(
      database.db.transaction((transaction) =>
        recordMailCalendarCommitmentIntakes(transaction, {
          accountId: account.id,
          message,
          principal: {
            actorId: "11111111-1111-4111-8111-111111111111",
            actorType: "connector",
            userId: "11111111-1111-4111-8111-111111111111",
          },
          privacyKey: encryptionKey,
          providerAccountAddressHint: account.email,
          recordedAt: timestamp,
          requestId: "cross-user-intake",
          thread,
        }),
      ),
    ).rejects.toMatchObject({ code: "forbidden" });
    const connectorPrincipal = {
      actorId: account.id,
      actorType: "connector" as const,
      userId,
    };
    let verifierLocked: (() => void) | undefined;
    const verifierHasLock = new Promise<void>((resolve) => {
      verifierLocked = resolve;
    });
    let releaseVerifier: (() => void) | undefined;
    const verifierCanCommit = new Promise<void>((resolve) => {
      releaseVerifier = resolve;
    });
    const verifier = database.db.transaction(async (transaction) => {
      const lockKey = mailCommitmentMessageLockKey(account.id, message.remoteMessageId);
      await transaction.execute(sql`select pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`);
      await transaction
        .select()
        .from(mailCalendarCommitmentIntakes)
        .where(eq(mailCalendarCommitmentIntakes.id, intake.id))
        .for("update");
      verifierLocked?.();
      await verifierCanCommit;
      await transaction
        .update(mailCalendarCommitmentIntakes)
        .set({
          authority: "server_verified",
          evidenceKind: "test_verified_invitation",
          status: "succeeded",
        })
        .where(
          and(
            eq(mailCalendarCommitmentIntakes.id, intake.id),
            eq(mailCalendarCommitmentIntakes.sourceFingerprint, intake.sourceFingerprint),
          ),
        );
    });
    await verifierHasLock;
    const overlappingSync = database.db.transaction((transaction) =>
      recordMailCalendarCommitmentIntakes(transaction, {
        accountId: account.id,
        message,
        principal: connectorPrincipal,
        privacyKey: encryptionKey,
        providerAccountAddressHint: account.email,
        recordedAt: new Date(timestamp.getTime() + 1_000),
        requestId: "same-intake-source",
        thread,
      }),
    );
    releaseVerifier?.();
    await Promise.all([verifier, overlappingSync]);
    await expect(
      database.db
        .select()
        .from(mailCalendarCommitmentIntakes)
        .where(eq(mailCalendarCommitmentIntakes.id, intake.id)),
    ).resolves.toEqual([
      expect.objectContaining({
        authority: "server_verified",
        evidenceKind: "test_verified_invitation",
        status: "succeeded",
      }),
    ]);
    await database.db.transaction((transaction) =>
      recordMailCalendarCommitmentIntakes(transaction, {
        accountId: account.id,
        message,
        principal: connectorPrincipal,
        privacyKey: encryptionKey,
        providerAccountAddressHint: "changed-account-hint@example.com",
        recordedAt: new Date(timestamp.getTime() + 1_500),
        requestId: "changed-intake-address-hint",
        thread,
      }),
    );
    await expect(
      database.db
        .select()
        .from(mailCalendarCommitmentIntakes)
        .where(eq(mailCalendarCommitmentIntakes.id, intake.id)),
    ).resolves.toEqual([
      expect.objectContaining({
        authority: "provider_projected_unverified",
        evidenceKind: "calendar_attachment_metadata",
        status: "preview_only",
      }),
    ]);
    const [addressHintAudit] = await database.db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.requestId, "changed-intake-address-hint"));
    expect(addressHintAudit).toMatchObject({
      action: "mail_calendar_intake.source_changed",
      after: {
        changedFields: expect.arrayContaining(["providerAccountAddressHint"]),
      },
    });
    expect(JSON.stringify(addressHintAudit)).not.toContain("changed-account-hint@example.com");
    const [changedMessage] = await database.db
      .update(mailMessages)
      .set({ providerMailboxIds: ["SENT"], providerRevision: "history-2" })
      .where(eq(mailMessages.id, message.id))
      .returning();
    if (!changedMessage) throw new Error("Changed commitment message fixture is missing.");
    await database.db.transaction((transaction) =>
      recordMailCalendarCommitmentIntakes(transaction, {
        accountId: account.id,
        message: changedMessage,
        principal: connectorPrincipal,
        privacyKey: encryptionKey,
        providerAccountAddressHint: account.email,
        recordedAt: new Date(timestamp.getTime() + 2_000),
        requestId: "changed-intake-source",
        thread,
      }),
    );
    await expect(
      database.db
        .select()
        .from(mailCalendarCommitmentIntakes)
        .where(eq(mailCalendarCommitmentIntakes.id, intake.id)),
    ).resolves.toEqual([
      expect.objectContaining({
        authority: "provider_projected_unverified",
        evidenceKind: "calendar_attachment_metadata",
        sourceMessageMailboxIds: ["SENT"],
        sourceMessageRevision: "history-2",
        status: "preview_only",
      }),
    ]);
    await database.db
      .update(mailCalendarCommitmentIntakes)
      .set({
        authority: "server_verified",
        evidenceKind: "test_verified_invitation",
        status: "succeeded",
      })
      .where(eq(mailCalendarCommitmentIntakes.id, intake.id));
    const [ineligibleMessage] = await database.db
      .update(mailMessages)
      .set({
        attachments: changedMessage.attachments.map((attachment) =>
          (attachment.providerPartId ?? attachment.id) === intake.remotePartId
            ? { ...attachment, contentType: "text/plain" }
            : attachment,
        ),
        providerRevision: "history-3",
      })
      .where(eq(mailMessages.id, message.id))
      .returning();
    if (!ineligibleMessage) throw new Error("Ineligible commitment message fixture is missing.");
    await database.db.transaction((transaction) =>
      recordMailCalendarCommitmentIntakes(transaction, {
        accountId: account.id,
        message: ineligibleMessage,
        principal: connectorPrincipal,
        privacyKey: encryptionKey,
        providerAccountAddressHint: account.email,
        recordedAt: new Date(timestamp.getTime() + 2_500),
        requestId: "ineligible-intake-source",
        thread,
      }),
    );
    await expect(
      database.db
        .select()
        .from(mailCalendarCommitmentIntakes)
        .where(eq(mailCalendarCommitmentIntakes.id, intake.id)),
    ).resolves.toEqual([
      expect.objectContaining({
        authority: "provider_projected_unverified",
        evidenceKind: "calendar_attachment_missing",
        sourceMessageRevision: "history-3",
        status: "preview_only",
      }),
    ]);
    await database.db.transaction((transaction) =>
      recordMailCalendarCommitmentIntakes(transaction, {
        accountId: account.id,
        message: ineligibleMessage,
        principal: connectorPrincipal,
        privacyKey: encryptionKey,
        providerAccountAddressHint: account.email,
        recordedAt: new Date(timestamp.getTime() + 2_750),
        requestId: "unchanged-ineligible-intake-source",
        thread,
      }),
    );
    await expect(
      database.db
        .select()
        .from(auditEvents)
        .where(eq(auditEvents.requestId, "unchanged-ineligible-intake-source")),
    ).resolves.toHaveLength(0);

    const [concurrentMessage] = await database.db
      .insert(mailMessages)
      .values({
        attachments: [
          {
            contentType: "text/calendar",
            filename: "",
            id: "part:9",
            providerAttachmentId: null,
            providerPartId: "9",
            size: 64,
          },
        ],
        bodyText: "BEGIN:VCALENDAR",
        cc: [],
        from: { address: "organizer@example.com", name: null },
        providerMailboxIds: ["INBOX"],
        providerRevision: "history-9",
        receivedAt: timestamp,
        remoteMessageId: "concurrent-message",
        threadId: thread.id,
        to: [],
      })
      .returning();
    if (!concurrentMessage) throw new Error("Concurrent commitment message fixture is missing.");
    await Promise.all(
      ["concurrent-intake-a", "concurrent-intake-b"].map((requestId) =>
        database.db.transaction((transaction) =>
          recordMailCalendarCommitmentIntakes(transaction, {
            accountId: account.id,
            message: concurrentMessage,
            principal: connectorPrincipal,
            privacyKey: encryptionKey,
            providerAccountAddressHint: account.email,
            recordedAt: new Date(timestamp.getTime() + 3_000),
            requestId,
            thread,
          }),
        ),
      ),
    );
    const concurrentIntakes = await database.db
      .select()
      .from(mailCalendarCommitmentIntakes)
      .where(eq(mailCalendarCommitmentIntakes.remoteMessageId, "concurrent-message"));
    expect(concurrentIntakes).toHaveLength(1);
    const [concurrentIntake] = concurrentIntakes;
    if (!concurrentIntake) throw new Error("Concurrent commitment intake was not recorded.");
    await expect(
      database.db.select().from(auditEvents).where(eq(auditEvents.entityId, concurrentIntake.id)),
    ).resolves.toHaveLength(1);

    await database.pool.query(`
      CREATE OR REPLACE FUNCTION fail_atomic_commitment_intake_for_test() RETURNS trigger AS $$
      BEGIN
        IF NEW.remote_message_id = 'atomic-message' THEN
          RAISE EXCEPTION 'forced intake failure';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
      CREATE TRIGGER fail_atomic_commitment_intake_for_test
      BEFORE INSERT ON mail_calendar_commitment_intakes
      FOR EACH ROW EXECUTE FUNCTION fail_atomic_commitment_intake_for_test();
    `);
    try {
      await expect(
        database.db.transaction(async (transaction) => {
          const [atomicMessage] = await transaction
            .insert(mailMessages)
            .values({
              attachments: [
                {
                  contentType: "text/calendar",
                  filename: "",
                  id: "part:10",
                  providerAttachmentId: null,
                  providerPartId: "10",
                  size: 64,
                },
              ],
              bodyText: "BEGIN:VCALENDAR",
              cc: [],
              from: { address: "organizer@example.com", name: null },
              providerMailboxIds: ["INBOX"],
              providerRevision: "history-10",
              receivedAt: timestamp,
              remoteMessageId: "atomic-message",
              threadId: thread.id,
              to: [],
            })
            .returning();
          if (!atomicMessage) throw new Error("Atomic commitment message fixture is missing.");
          await recordMailCalendarCommitmentIntakes(transaction, {
            accountId: account.id,
            message: atomicMessage,
            principal: connectorPrincipal,
            privacyKey: encryptionKey,
            providerAccountAddressHint: account.email,
            recordedAt: new Date(timestamp.getTime() + 4_000),
            requestId: "atomic-intake",
            thread,
          });
        }),
      ).rejects.toThrow();
    } finally {
      await database.pool.query(`
        DROP TRIGGER IF EXISTS fail_atomic_commitment_intake_for_test
        ON mail_calendar_commitment_intakes;
        DROP FUNCTION IF EXISTS fail_atomic_commitment_intake_for_test();
      `);
    }
    await expect(
      database.db
        .select()
        .from(mailMessages)
        .where(eq(mailMessages.remoteMessageId, "atomic-message")),
    ).resolves.toEqual([]);

    const [removedIntake] = await database.db
      .select()
      .from(mailCalendarCommitmentIntakes)
      .where(eq(mailCalendarCommitmentIntakes.remoteMessageId, "removed-message"));
    if (!removedIntake) throw new Error("Removed-message intake fixture is missing.");
    await database.db
      .update(mailCalendarCommitmentIntakes)
      .set({
        authority: "server_verified",
        evidenceKind: "test_verified_invitation",
        status: "succeeded",
      })
      .where(eq(mailCalendarCommitmentIntakes.id, removedIntake.id));
    const completeThread = completeMailValue.threads[0];
    if (!completeThread?.messages) throw new Error("Complete Gmail thread fixture is missing.");
    vi.mocked(syncMail).mockResolvedValueOnce({
      credentials,
      value: {
        ...completeMailValue,
        threads: [
          {
            ...completeThread,
            messageCount: 1,
            messages: completeThread.messages.filter(
              (candidate) => candidate.remoteMessageId === "ruled-message",
            ),
          },
        ],
      },
    });
    await service.syncAccount(userId, account.id);
    await expect(
      database.db
        .select()
        .from(mailCalendarCommitmentIntakes)
        .where(eq(mailCalendarCommitmentIntakes.id, removedIntake.id)),
    ).resolves.toEqual([
      expect.objectContaining({
        authority: "provider_projected_unverified",
        evidenceKind: "source_message_missing",
        sourceMessageId: null,
        status: "preview_only",
      }),
    ]);
    await expect(
      database.db
        .select()
        .from(mailMessages)
        .where(eq(mailMessages.remoteMessageId, "removed-message")),
    ).resolves.toEqual([]);
    const missingMessageAudits = await database.db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.entityId, removedIntake.id));
    expect(missingMessageAudits).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "mail_calendar_intake.source_unavailable",
          after: expect.objectContaining({
            changedFields: expect.arrayContaining(["sourceMessage"]),
          }),
        }),
      ]),
    );
    expect(JSON.stringify(missingMessageAudits)).not.toContain("Removed message");
    vi.mocked(syncMail).mockResolvedValueOnce({
      credentials,
      value: {
        ...completeMailValue,
        threads: [
          {
            ...completeThread,
            messageCount: 1,
            messages: completeThread.messages.filter(
              (candidate) => candidate.remoteMessageId === "ruled-message",
            ),
          },
        ],
      },
    });
    await service.syncAccount(userId, account.id);
    await expect(
      database.db.select().from(auditEvents).where(eq(auditEvents.entityId, removedIntake.id)),
    ).resolves.toHaveLength(missingMessageAudits.length);
  });

  it("bounds durable Mail runs, preserves rules, and drains backlog on a later dispatch", async () => {
    await database.db.delete(mailRuleWorkItems);
    const [account] = await database.db
      .select()
      .from(calendarAccounts)
      .where(eq(calendarAccounts.providerAccountId, "google-person"));
    if (!account) throw new Error("Connected account fixture is missing.");
    const syncMail = google.syncMail;
    const updateMailThread = google.updateMailThread;
    if (!syncMail || !updateMailThread) throw new Error("Google Mail fixtures are unavailable.");
    const threads = Array.from({ length: 7 }, (_, index) => ({
      bodyText: `Body ${index}`,
      from: { address: "sender@example.com", name: "Sender" },
      mailboxIds: ["INBOX", "UNREAD"],
      messageCount: 1,
      receivedAt: new Date(timestamp.getTime() - index * 1_000),
      remoteThreadId: `budget-thread-${index}`,
      snippet: "Google Mail",
      starred: false,
      subject: `Google Mail budget ${index}`,
      to: [],
      unread: true,
    }));
    vi.mocked(syncMail).mockResolvedValueOnce({
      credentials,
      value: {
        deletedThreadIds: [],
        nextSyncToken: null,
        reset: false,
        mailboxes: [{ id: "INBOX", name: "Inbox", role: "inbox", totalCount: 7, unreadCount: 7 }],
        threads,
      },
    });
    let activeWrites = 0;
    let maximumWrites = 0;
    let releaseWrites: (() => void) | undefined;
    const heldWrites = new Promise<void>((resolveWrites) => {
      releaseWrites = resolveWrites;
    });
    vi.mocked(updateMailThread).mockClear();
    vi.mocked(updateMailThread).mockImplementation(async () => {
      activeWrites += 1;
      maximumWrites = Math.max(maximumWrites, activeWrites);
      await heldWrites;
      activeWrites -= 1;
      return rotatedCredentials;
    });
    await service.syncAccount(userId, account.id);
    expect(updateMailThread).not.toHaveBeenCalled();
    const boundedRun = service.dispatchDueMailRuleWork();
    try {
      await vi.waitFor(() => expect(updateMailThread).toHaveBeenCalledTimes(2));
    } finally {
      releaseWrites?.();
    }
    await boundedRun;
    expect(updateMailThread).toHaveBeenCalledTimes(6);
    expect(maximumWrites).toBe(2);
    await expect(
      database.db
        .select()
        .from(mailRules)
        .where(and(eq(mailRules.userId, userId), eq(mailRules.enabled, true))),
    ).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "Read project mail" }),
        expect.objectContaining({ name: "Star project mail" }),
      ]),
    );
    await expect(database.db.select().from(attentionItems)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          relatedEntityId: account.id,
          relatedEntityType: "mail_account",
          status: "open",
          title: "Mail automation has pending work",
        }),
      ]),
    );

    vi.mocked(updateMailThread).mockClear();
    await expect(service.dispatchDueMailRuleWork()).resolves.toMatchObject({
      claimed: 6,
      succeeded: 6,
    });
    expect(updateMailThread).toHaveBeenCalledTimes(6);
    await database.db.delete(mailRuleWorkItems);
    vi.mocked(updateMailThread).mockResolvedValue(rotatedCredentials);
  });

  it("refuses a capability transition while a durable Mail provider effect is claimed", async () => {
    await database.db.delete(mailRuleWorkItems);
    const [account] = await database.db
      .select()
      .from(calendarAccounts)
      .where(eq(calendarAccounts.providerAccountId, "google-person"));
    if (!account) throw new Error("Connected account fixture is missing.");
    const syncMail = google.syncMail;
    const updateMailThread = google.updateMailThread;
    if (!syncMail || !updateMailThread) throw new Error("Google Mail fixtures are unavailable.");
    vi.mocked(syncMail).mockResolvedValueOnce({
      credentials,
      value: {
        deletedThreadIds: [],
        nextSyncToken: null,
        reset: false,
        mailboxes: [{ id: "INBOX", name: "Inbox", role: "inbox", totalCount: 1, unreadCount: 1 }],
        threads: [
          {
            bodyText: "Google Mail",
            from: { address: "sender@example.com", name: "Sender" },
            mailboxIds: ["INBOX", "UNREAD"],
            messageCount: 1,
            receivedAt: timestamp,
            remoteThreadId: "lifecycle-fenced-rule-thread",
            snippet: "Google Mail",
            starred: false,
            subject: "Google Mail lifecycle fence",
            to: [],
            unread: true,
          },
        ],
      },
    });
    let providerStarted: (() => void) | undefined;
    let releaseProvider: (() => void) | undefined;
    const providerCallStarted = new Promise<void>((resolveStarted) => {
      providerStarted = resolveStarted;
    });
    vi.mocked(updateMailThread).mockReset();
    vi.mocked(updateMailThread).mockImplementation(async () => {
      providerStarted?.();
      await new Promise<void>((resolveProvider) => {
        releaseProvider = resolveProvider;
      });
      return rotatedCredentials;
    });

    await service.syncAccount(userId, account.id);
    expect(updateMailThread).not.toHaveBeenCalled();
    const dispatch = service.dispatchDueMailRuleWork();
    await providerCallStarted;
    await expect(
      service.disconnect(userId, account.id, "claimed-effect-disconnect"),
    ).rejects.toMatchObject({
      code: "conflict",
      message: expect.stringContaining("reconciling a provider effect"),
    });
    await expect(
      database.db
        .select()
        .from(mailRuleWorkItems)
        .where(eq(mailRuleWorkItems.remoteThreadId, "lifecycle-fenced-rule-thread")),
    ).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          claimId: expect.any(String),
          providerEffect: "none",
          status: "claimed",
        }),
      ]),
    );
    releaseProvider?.();
    await expect(dispatch).resolves.toMatchObject({
      claimed: 1,
      succeeded: 1,
    });
    await expect(
      database.db.select().from(calendarAccounts).where(eq(calendarAccounts.id, account.id)),
    ).resolves.toEqual([
      expect.objectContaining({
        mailEnabled: true,
        syncStatus: "idle",
      }),
    ]);
    await expect(
      database.db
        .select()
        .from(mailRuleWorkItems)
        .where(eq(mailRuleWorkItems.remoteThreadId, "lifecycle-fenced-rule-thread")),
    ).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          claimId: null,
          providerEffect: "applied",
          status: "succeeded",
        }),
      ]),
    );
    vi.mocked(updateMailThread).mockResolvedValue(rotatedCredentials);
  });

  it("retains account lifecycle authority for unresolved durable Mail effect evidence", async () => {
    await database.db.delete(mailRuleWorkItems);
    const fixture = await createDurableMailWorkFixture("Lifecycle evidence fence", {
      afterDays: 1,
      mailboxId: null,
      type: "archive",
    });

    await database.db
      .update(mailRuleWorkItems)
      .set({ providerEffect: "indeterminate", status: "reconcile" })
      .where(eq(mailRuleWorkItems.id, fixture.work.id));
    await expect(
      service.disconnect(fixture.user.id, fixture.account.id, "reconcile-effect-disconnect"),
    ).rejects.toMatchObject({
      code: "conflict",
      message: expect.stringContaining("Reauthorize this Google Mail account"),
    });

    await database.db
      .update(mailRuleWorkItems)
      .set({
        completedAt: timestamp,
        lastErrorCode: "reconciliation_exhausted",
        lastErrorMessage: "Exact provider review is still required.",
        providerEffect: "applied",
        status: "failed",
      })
      .where(eq(mailRuleWorkItems.id, fixture.work.id));
    await expect(
      service.disconnect(fixture.user.id, fixture.account.id, "failed-effect-disconnect"),
    ).rejects.toMatchObject({
      code: "conflict",
      message: expect.stringContaining("Reauthorize this Google Mail account"),
    });
    await expect(
      database.db
        .select()
        .from(calendarAccounts)
        .where(eq(calendarAccounts.id, fixture.account.id)),
    ).resolves.toHaveLength(1);
    const reauthorizedCredentials = {
      ...credentials,
      scope:
        "https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/gmail.send",
    };
    vi.mocked(google.exchangeCode).mockResolvedValueOnce(reauthorizedCredentials);
    vi.mocked(google.getProfile).mockResolvedValueOnce({
      credentials: reauthorizedCredentials,
      value: {
        email: fixture.account.email as string,
        id: fixture.account.providerAccountId as string,
        name: fixture.account.label,
      },
    });
    const repairUrl = await service.startGoogleAuthorization(fixture.user.id, {
      accountId: fixture.account.id,
      returnTo: "/settings?section=connections",
      services: ["mail"],
    });
    await service.completeGoogleAuthorization(
      String(new URL(repairUrl).searchParams.get("state")),
      "repair-provider-evidence",
    );
    await expect(
      database.db.select().from(mailRuleWorkItems).where(eq(mailRuleWorkItems.id, fixture.work.id)),
    ).resolves.toEqual([
      expect.objectContaining({
        attemptCount: 0,
        completedAt: null,
        lastErrorCode: "mail_reauthorized",
        providerEffect: "applied",
        status: "reconcile",
      }),
    ]);
    await expect(
      database.db
        .select({ action: auditEvents.action })
        .from(auditEvents)
        .where(
          and(
            eq(auditEvents.entityId, fixture.account.id),
            eq(auditEvents.action, "mail.rule.reconciliation_requeued"),
          ),
        ),
    ).resolves.toEqual([{ action: "mail.rule.reconciliation_requeued" }]);
    const getMailThreadState = vi.mocked(
      google.getMailThreadState as NonNullable<GoogleConnector["getMailThreadState"]>,
    );
    const updateMailThread = vi.mocked(
      google.updateMailThread as NonNullable<GoogleConnector["updateMailThread"]>,
    );
    getMailThreadState.mockResolvedValueOnce({
      credentials: reauthorizedCredentials,
      value: {
        mailboxIds: ["UNREAD"],
        remoteThreadId: fixture.thread.remoteThreadId,
        starred: false,
        unread: true,
      },
    });
    updateMailThread.mockClear();
    await expect(service.dispatchDueMailRuleWork()).resolves.toMatchObject({
      claimed: 1,
      succeeded: 1,
    });
    expect(updateMailThread).not.toHaveBeenCalled();
    await expect(
      service.disconnect(fixture.user.id, fixture.account.id, "reconciled-effect-disconnect"),
    ).resolves.toBeUndefined();
    await expect(
      database.db
        .select()
        .from(calendarAccounts)
        .where(eq(calendarAccounts.id, fixture.account.id)),
    ).resolves.toHaveLength(0);
    getMailThreadState.mockClear();
    updateMailThread.mockClear();

    const iCloudFixture = await createDurableMailWorkFixture("Capability evidence fence", {
      afterDays: 1,
      mailboxId: null,
      type: "archive",
    });
    const iCloudEmail = iCloudFixture.account.email;
    if (!iCloudEmail) throw new Error("iCloud lifecycle fixture email is missing.");
    await database.db
      .update(calendarAccounts)
      .set({
        encryptedCredentials: encryptJson(
          {
            appSpecificPassword: "app-password",
            email: iCloudEmail,
          },
          encryptionKey,
        ),
        provider: "icloud",
        providerAccountId: iCloudEmail,
      })
      .where(eq(calendarAccounts.id, iCloudFixture.account.id));
    await database.db
      .update(mailThreads)
      .set({ provider: "icloud" })
      .where(eq(mailThreads.id, iCloudFixture.thread.id));
    await database.db
      .update(mailRuleWorkItems)
      .set({ providerEffect: "indeterminate", status: "reconcile" })
      .where(eq(mailRuleWorkItems.id, iCloudFixture.work.id));
    await expect(
      service.connectICloud(
        iCloudFixture.user.id,
        {
          appSpecificPassword: "app-password",
          calendar: false,
          email: iCloudEmail,
          mail: false,
        },
        "reconcile-effect-mail-disable",
      ),
    ).rejects.toMatchObject({
      code: "conflict",
      message: expect.stringContaining("support review"),
    });
    await expect(
      database.db
        .select({ mailEnabled: calendarAccounts.mailEnabled })
        .from(calendarAccounts)
        .where(eq(calendarAccounts.id, iCloudFixture.account.id)),
    ).resolves.toEqual([{ mailEnabled: true }]);
    await expect(
      database.db
        .select({ deletedAt: mailThreads.deletedAt })
        .from(mailThreads)
        .where(eq(mailThreads.id, iCloudFixture.thread.id)),
    ).resolves.toEqual([{ deletedAt: null }]);
    await database.db
      .delete(mailRuleWorkItems)
      .where(eq(mailRuleWorkItems.id, iCloudFixture.work.id));
  });

  it("retains accepted Mail effects for reconciliation across concurrent rule revocation", async () => {
    await database.db.delete(mailRuleWorkItems);
    const [account] = await database.db
      .select()
      .from(calendarAccounts)
      .where(eq(calendarAccounts.providerAccountId, "google-person"));
    if (!account) throw new Error("Mail rule lifecycle fixtures are missing.");
    const syncMail = google.syncMail;
    const updateMailThread = google.updateMailThread;
    const getMailThreadState = google.getMailThreadState;
    if (!syncMail || !updateMailThread || !getMailThreadState) {
      throw new Error("Google Mail fixtures are unavailable.");
    }
    vi.mocked(syncMail).mockResolvedValueOnce({
      credentials,
      value: {
        deletedThreadIds: [],
        nextSyncToken: null,
        reset: false,
        mailboxes: [{ id: "INBOX", name: "Inbox", role: "inbox", totalCount: 1, unreadCount: 1 }],
        threads: [
          {
            bodyText: "Google Mail",
            from: { address: "sender@example.com", name: "Sender" },
            mailboxIds: ["INBOX", "UNREAD"],
            messageCount: 1,
            receivedAt: timestamp,
            remoteThreadId: "rule-revocation-fenced-thread",
            snippet: "Google Mail",
            starred: false,
            subject: "Google Mail rule revocation fence",
            to: [],
            unread: true,
          },
        ],
      },
    });
    let providerStarted: (() => void) | undefined;
    let releaseProvider: (() => void) | undefined;
    const providerCallStarted = new Promise<void>((resolveStarted) => {
      providerStarted = resolveStarted;
    });
    vi.mocked(updateMailThread).mockReset();
    vi.mocked(updateMailThread).mockImplementation(async () => {
      providerStarted?.();
      await new Promise<void>((resolveProvider) => {
        releaseProvider = resolveProvider;
      });
      return rotatedCredentials;
    });

    await service.syncAccount(userId, account.id);
    const dispatch = service.dispatchDueMailRuleWork();
    await providerCallStarted;
    const [claimed] = await database.db
      .select({ ruleId: mailRuleWorkItems.ruleId })
      .from(mailRuleWorkItems)
      .where(
        and(
          eq(mailRuleWorkItems.remoteThreadId, "rule-revocation-fenced-thread"),
          eq(mailRuleWorkItems.status, "claimed"),
        ),
      );
    if (!claimed) throw new Error("Durable Mail provider effect was not claimed.");
    await database.db
      .update(mailRules)
      .set({
        enabled: false,
        policy: "preview",
        version: sql`${mailRules.version} + 1`,
      })
      .where(eq(mailRules.id, claimed.ruleId));
    releaseProvider?.();
    try {
      await expect(dispatch).resolves.toMatchObject({
        claimed: 1,
        reconciliation: 1,
      });
      await expect(
        database.db
          .select()
          .from(mailRuleWorkItems)
          .where(eq(mailRuleWorkItems.remoteThreadId, "rule-revocation-fenced-thread")),
      ).resolves.toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            claimId: null,
            lastErrorCode: "authorization_changed",
            providerEffect: "applied",
            status: "reconcile",
          }),
        ]),
      );
      const [projectedThread] = await database.db
        .select()
        .from(mailThreads)
        .where(eq(mailThreads.remoteThreadId, "rule-revocation-fenced-thread"));
      if (!projectedThread) throw new Error("Reconciled Mail thread was not projected.");
      vi.mocked(getMailThreadState).mockResolvedValueOnce({
        credentials: rotatedCredentials,
        value: {
          mailboxIds: projectedThread.remoteMailboxIds,
          remoteThreadId: "rule-revocation-fenced-thread",
          starred: projectedThread.starred,
          unread: projectedThread.unread,
        },
      });
      vi.mocked(updateMailThread).mockClear();
      vi.mocked(updateMailThread).mockResolvedValue(rotatedCredentials);
      await expect(service.dispatchDueMailRuleWork()).resolves.toMatchObject({
        claimed: 1,
        succeeded: 1,
      });
      expect(getMailThreadState).toHaveBeenCalledTimes(1);
      expect(updateMailThread).not.toHaveBeenCalled();
      await expect(
        database.db
          .select()
          .from(mailRuleWorkItems)
          .where(eq(mailRuleWorkItems.remoteThreadId, "rule-revocation-fenced-thread")),
      ).resolves.toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            claimId: null,
            lastErrorCode: null,
            providerEffect: "applied",
            status: "succeeded",
          }),
        ]),
      );
      await expect(
        database.db
          .select({ action: auditEvents.action })
          .from(auditEvents)
          .where(
            and(
              eq(auditEvents.entityType, "mail_thread"),
              eq(auditEvents.action, "mail.rule.durable_applied"),
            ),
          ),
      ).resolves.toEqual(expect.arrayContaining([{ action: "mail.rule.durable_applied" }]));
    } finally {
      await database.db
        .update(mailRules)
        .set({
          enabled: true,
          policy: "approved_rule",
          version: sql`${mailRules.version} + 1`,
        })
        .where(eq(mailRules.id, claimed.ruleId));
      vi.mocked(updateMailThread).mockResolvedValue(rotatedCredentials);
    }
  });

  it("keeps provider execution out of synchronization when legacy run-summary writes fail", async () => {
    const [account] = await database.db
      .select()
      .from(calendarAccounts)
      .where(eq(calendarAccounts.providerAccountId, "google-person"));
    if (!account) throw new Error("Connected account fixture is missing.");
    const syncMail = google.syncMail;
    const updateMailThread = google.updateMailThread;
    if (!syncMail || !updateMailThread) throw new Error("Google Mail fixtures are unavailable.");
    vi.mocked(syncMail).mockResolvedValueOnce({
      credentials,
      value: {
        deletedThreadIds: [],
        nextSyncToken: null,
        reset: false,
        mailboxes: [{ id: "INBOX", name: "Inbox", role: "inbox", totalCount: 1, unreadCount: 1 }],
        threads: [
          {
            bodyText: "Body",
            from: { address: "sender@example.com", name: "Sender" },
            mailboxIds: ["INBOX", "UNREAD"],
            messageCount: 1,
            receivedAt: timestamp,
            remoteThreadId: "summary-provider-failure",
            snippet: "Google Mail",
            starred: false,
            subject: "Google Mail summary provider failure",
            to: [],
            unread: true,
          },
        ],
      },
    });
    vi.mocked(updateMailThread).mockReset();
    vi.mocked(updateMailThread).mockRejectedValueOnce(new Error("ambiguous provider failure"));
    await database.pool.query(`
      CREATE OR REPLACE FUNCTION fail_mail_run_summary_for_test() RETURNS trigger AS $$
      BEGIN
        IF NEW.action = 'mail.rule.run' THEN
          RAISE EXCEPTION 'forced Mail run summary failure';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
      CREATE TRIGGER fail_mail_run_summary_for_test
      BEFORE INSERT ON audit_events
      FOR EACH ROW EXECUTE FUNCTION fail_mail_run_summary_for_test();
    `);
    try {
      await expect(service.syncAccount(userId, account.id)).resolves.toMatchObject({ changed: 2 });
      expect(updateMailThread).not.toHaveBeenCalled();
      await expect(
        database.db
          .select()
          .from(mailRuleWorkItems)
          .where(eq(mailRuleWorkItems.remoteThreadId, "summary-provider-failure")),
      ).resolves.toEqual(expect.arrayContaining([expect.objectContaining({ status: "pending" })]));
    } finally {
      await database.pool.query(`
        DROP TRIGGER IF EXISTS fail_mail_run_summary_for_test ON audit_events;
        DROP FUNCTION IF EXISTS fail_mail_run_summary_for_test();
      `);
      vi.mocked(updateMailThread).mockReset();
      vi.mocked(updateMailThread).mockResolvedValue(rotatedCredentials);
    }
  });

  it("records source synchronization independently from deferred Mail work", async () => {
    const [account] = await database.db
      .select()
      .from(calendarAccounts)
      .where(eq(calendarAccounts.providerAccountId, "google-person"));
    if (!account) throw new Error("Connected account fixture is missing.");
    const syncMail = google.syncMail;
    const updateMailThread = google.updateMailThread;
    if (!syncMail || !updateMailThread) throw new Error("Google Mail fixtures are unavailable.");
    vi.mocked(syncMail).mockResolvedValueOnce({
      credentials,
      value: {
        deletedThreadIds: [],
        nextSyncToken: null,
        reset: false,
        mailboxes: [{ id: "INBOX", name: "Inbox", role: "inbox", totalCount: 1, unreadCount: 1 }],
        threads: [
          {
            bodyText: "Body",
            from: { address: "sender@example.com", name: "Sender" },
            mailboxIds: ["INBOX", "UNREAD"],
            messageCount: 1,
            receivedAt: timestamp,
            remoteThreadId: "summary-success",
            snippet: "Google Mail",
            starred: false,
            subject: "Google Mail summary success",
            to: [],
            unread: true,
          },
        ],
      },
    });
    vi.mocked(updateMailThread).mockClear();
    await database.pool.query(`
      CREATE OR REPLACE FUNCTION fail_mail_run_summary_for_test() RETURNS trigger AS $$
      BEGIN
        IF NEW.action = 'mail.rule.run' THEN
          RAISE EXCEPTION 'forced Mail run summary failure';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
      CREATE TRIGGER fail_mail_run_summary_for_test
      BEFORE INSERT ON audit_events
      FOR EACH ROW EXECUTE FUNCTION fail_mail_run_summary_for_test();
    `);
    try {
      await expect(service.syncAccount(userId, account.id)).resolves.toMatchObject({
        changed: expect.any(Number),
      });
      const syncedAudits = await database.db
        .select()
        .from(auditEvents)
        .where(eq(auditEvents.action, "mail.synced"));
      expect(syncedAudits.at(-1)?.after).toMatchObject({
        durableRuleHandoffCompleted: true,
      });
      expect(updateMailThread).not.toHaveBeenCalled();
    } finally {
      await database.pool.query(`
        DROP TRIGGER IF EXISTS fail_mail_run_summary_for_test ON audit_events;
        DROP FUNCTION IF EXISTS fail_mail_run_summary_for_test();
      `);
    }
  });

  it("reports provider effects when the final Mail synchronization audit cannot be saved", async () => {
    const [account] = await database.db
      .select()
      .from(calendarAccounts)
      .where(eq(calendarAccounts.providerAccountId, "google-person"));
    if (!account) throw new Error("Connected account fixture is missing.");
    const syncMail = google.syncMail;
    const updateMailThread = google.updateMailThread;
    if (!syncMail || !updateMailThread) throw new Error("Google Mail fixtures are unavailable.");
    vi.mocked(syncMail).mockResolvedValueOnce({
      credentials,
      value: {
        deletedThreadIds: [],
        nextSyncToken: null,
        reset: false,
        mailboxes: [{ id: "INBOX", name: "Inbox", role: "inbox", totalCount: 1, unreadCount: 1 }],
        threads: [
          {
            bodyText: "Body",
            from: { address: "sender@example.com", name: "Sender" },
            mailboxIds: ["INBOX", "UNREAD"],
            messageCount: 1,
            receivedAt: timestamp,
            remoteThreadId: "final-audit-failure",
            snippet: "Google Mail",
            starred: false,
            subject: "Google Mail final audit failure",
            to: [],
            unread: true,
          },
        ],
      },
    });
    vi.mocked(updateMailThread).mockResolvedValue(rotatedCredentials);
    await database.pool.query(`
      CREATE OR REPLACE FUNCTION fail_mail_sync_audit_for_test() RETURNS trigger AS $$
      BEGIN
        IF NEW.action = 'mail.synced' THEN
          RAISE EXCEPTION 'forced Mail synchronization audit failure';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
      CREATE TRIGGER fail_mail_sync_audit_for_test
      BEFORE INSERT ON audit_events
      FOR EACH ROW EXECUTE FUNCTION fail_mail_sync_audit_for_test();
    `);
    try {
      await expect(service.syncAccount(userId, account.id)).rejects.toMatchObject({
        code: "service_unavailable",
        details: expect.objectContaining({ recovery: "automatic" }),
      });
      expect(updateMailThread).not.toHaveBeenCalled();
    } finally {
      await database.pool.query(`
        DROP TRIGGER IF EXISTS fail_mail_sync_audit_for_test ON audit_events;
        DROP FUNCTION IF EXISTS fail_mail_sync_audit_for_test();
      `);
    }
  });

  it("records separate durable snapshots for multiple approved rules without inline effects", async () => {
    const [account] = await database.db
      .select()
      .from(calendarAccounts)
      .where(eq(calendarAccounts.providerAccountId, "google-person"));
    const [profile] = await database.db
      .select()
      .from(domainProfiles)
      .where(
        and(
          eq(domainProfiles.userId, userId),
          eq(domainProfiles.domain, "mail"),
          eq(domainProfiles.status, "active"),
        ),
      );
    if (!account || !profile) throw new Error("Active Mail automation fixtures are missing.");
    const syncMail = google.syncMail;
    const updateMailThread = google.updateMailThread;
    if (!syncMail || !updateMailThread) throw new Error("Google Mail fixtures are unavailable.");
    const previouslyEnabled = await database.db
      .select({ id: mailRules.id })
      .from(mailRules)
      .where(and(eq(mailRules.userId, userId), eq(mailRules.enabled, true)));
    if (previouslyEnabled.length > 0) {
      await database.db
        .update(mailRules)
        .set({ enabled: false, policy: "preview" })
        .where(
          inArray(
            mailRules.id,
            previouslyEnabled.map((rule) => rule.id),
          ),
        );
    }
    const [ruleA, ruleB, ruleC] = await database.db
      .insert(mailRules)
      .values(
        ["Policy A", "Policy B", "Policy C"].map((name, index) => ({
          actions: [{ afterDays: 0, mailboxId: null, type: "mark_read" as const }],
          condition: {
            field: "subject" as const,
            operator: "equals" as const,
            value: `Policy ${String.fromCharCode(65 + index)}`,
          },
          enabled: true,
          name,
          policy: "approved_rule" as const,
          profileId: profile.id,
          sourceAccountIds: [account.id],
          userId,
        })),
      )
      .returning();
    if (!ruleA || !ruleB || !ruleC) throw new Error("Policy rule fixtures were not created.");
    await database.pool.query(`
      CREATE OR REPLACE FUNCTION invalidate_policy_b_for_test() RETURNS trigger AS $$
      BEGIN
        IF NEW.action = 'mail.rule.applied' THEN
          UPDATE mail_rules
          SET enabled = false, policy = 'preview', version = version + 1, updated_at = now()
          WHERE id = '${ruleB.id}'::uuid;
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
      CREATE TRIGGER invalidate_policy_b_for_test
      AFTER INSERT ON audit_events
      FOR EACH ROW EXECUTE FUNCTION invalidate_policy_b_for_test();
    `);
    const threads = ["Policy A", "Policy C", "Policy B"].map((subject) => ({
      bodyText: subject,
      from: { address: "sender@example.com", name: "Sender" },
      mailboxIds: ["INBOX", "UNREAD"],
      messageCount: 1,
      receivedAt: timestamp,
      remoteThreadId: subject.toLowerCase().replace(" ", "-"),
      snippet: subject,
      starred: false,
      subject,
      to: [],
      unread: true,
    }));
    vi.mocked(syncMail).mockResolvedValueOnce({
      credentials,
      value: {
        deletedThreadIds: [],
        nextSyncToken: null,
        reset: false,
        mailboxes: [{ id: "INBOX", name: "Inbox", role: "inbox", totalCount: 3, unreadCount: 3 }],
        threads,
      },
    });
    vi.mocked(updateMailThread).mockClear();
    try {
      await expect(service.syncAccount(userId, account.id)).resolves.toMatchObject({ changed: 4 });
      expect(updateMailThread).not.toHaveBeenCalled();
      await expect(
        database.db
          .select({ remoteThreadId: mailRuleWorkItems.remoteThreadId })
          .from(mailRuleWorkItems)
          .where(inArray(mailRuleWorkItems.remoteThreadId, ["policy-a", "policy-b", "policy-c"])),
      ).resolves.toEqual(
        expect.arrayContaining([
          { remoteThreadId: "policy-a" },
          { remoteThreadId: "policy-b" },
          { remoteThreadId: "policy-c" },
        ]),
      );
    } finally {
      await database.pool.query(`
        DROP TRIGGER IF EXISTS invalidate_policy_b_for_test ON audit_events;
        DROP FUNCTION IF EXISTS invalidate_policy_b_for_test();
      `);
      await database.db
        .delete(mailRules)
        .where(inArray(mailRules.id, [ruleA.id, ruleB.id, ruleC.id]));
      if (previouslyEnabled.length > 0) {
        await database.db
          .update(mailRules)
          .set({ enabled: true, policy: "approved_rule" })
          .where(
            inArray(
              mailRules.id,
              previouslyEnabled.map((rule) => rule.id),
            ),
          );
      }
      vi.mocked(updateMailThread).mockResolvedValue(rotatedCredentials);
    }
  });

  it("does not expose projected Mail synchronization to legacy inline-effect audit failures", async () => {
    const [account] = await database.db
      .select()
      .from(calendarAccounts)
      .where(eq(calendarAccounts.providerAccountId, "google-person"));
    if (!account) throw new Error("Connected account fixture is missing.");
    const syncMail = google.syncMail;
    const updateMailThread = google.updateMailThread;
    if (!syncMail || !updateMailThread) throw new Error("Google Mail fixtures are unavailable.");
    vi.mocked(updateMailThread).mockClear();
    vi.mocked(syncMail).mockResolvedValueOnce({
      credentials,
      value: {
        deletedThreadIds: [],
        nextSyncToken: null,
        reset: false,
        mailboxes: [{ id: "INBOX", name: "Inbox", role: "inbox", totalCount: 1, unreadCount: 1 }],
        threads: [
          {
            bodyText: "Body",
            from: { address: "sender@example.com", name: "Sender" },
            mailboxIds: ["INBOX", "UNREAD"],
            messageCount: 1,
            receivedAt: timestamp,
            remoteThreadId: "partial-rule-thread",
            snippet: "Google Mail",
            starred: false,
            subject: "Google Mail partial",
            to: [],
            unread: true,
          },
        ],
      },
    });
    await database.pool.query(`
      CREATE OR REPLACE FUNCTION fail_automatic_mail_audit_for_test() RETURNS trigger AS $$
      BEGIN
        IF NEW.action = 'mail.rule.applied' THEN
          RAISE EXCEPTION 'forced automatic rule audit failure';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
      CREATE TRIGGER fail_automatic_mail_audit_for_test
      BEFORE INSERT ON audit_events
      FOR EACH ROW EXECUTE FUNCTION fail_automatic_mail_audit_for_test();
    `);
    try {
      await expect(service.syncAccount(userId, account.id)).resolves.toMatchObject({ changed: 2 });
      expect(updateMailThread).not.toHaveBeenCalled();
      const [thread] = await database.db
        .select()
        .from(mailThreads)
        .where(eq(mailThreads.remoteThreadId, "partial-rule-thread"));
      expect(thread).toMatchObject({ starred: false, unread: true });
      await expect(
        database.db
          .select()
          .from(mailRuleWorkItems)
          .where(eq(mailRuleWorkItems.remoteThreadId, "partial-rule-thread")),
      ).resolves.toEqual(expect.arrayContaining([expect.objectContaining({ status: "pending" })]));
    } finally {
      await database.pool.query(`
        DROP TRIGGER IF EXISTS fail_automatic_mail_audit_for_test ON audit_events;
        DROP FUNCTION IF EXISTS fail_automatic_mail_audit_for_test();
      `);
    }
  });

  it("does not rotate provider credentials while synchronization only enqueues Mail work", async () => {
    const [account] = await database.db
      .select()
      .from(calendarAccounts)
      .where(eq(calendarAccounts.providerAccountId, "google-person"));
    if (!account) throw new Error("Connected account fixture is missing.");
    const syncMail = google.syncMail;
    const updateMailThread = google.updateMailThread;
    if (!syncMail || !updateMailThread) throw new Error("Google Mail fixtures are unavailable.");
    vi.mocked(updateMailThread).mockReset();
    vi.mocked(updateMailThread).mockResolvedValueOnce({
      ...rotatedCredentials,
      accessToken: "rule-fault-token",
      expiresAt: "2033-07-13T13:00:00.000Z",
    });
    vi.mocked(syncMail).mockResolvedValueOnce({
      credentials,
      value: {
        deletedThreadIds: [],
        nextSyncToken: null,
        reset: false,
        mailboxes: [{ id: "INBOX", name: "Inbox", role: "inbox", totalCount: 1, unreadCount: 1 }],
        threads: [
          {
            bodyText: "Body",
            from: { address: "sender@example.com", name: "Sender" },
            mailboxIds: ["INBOX", "UNREAD"],
            messageCount: 1,
            receivedAt: timestamp,
            remoteThreadId: "credential-failure-thread",
            snippet: "Google Mail",
            starred: false,
            subject: "Google Mail credential failure",
            to: [],
            unread: true,
          },
        ],
      },
    });
    await database.pool.query(`
      CREATE OR REPLACE FUNCTION fail_mail_credential_save_for_test() RETURNS trigger AS $$
      BEGIN
        IF NEW.encrypted_credentials IS DISTINCT FROM OLD.encrypted_credentials THEN
          RAISE EXCEPTION 'forced credential save failure';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
      CREATE TRIGGER fail_mail_credential_save_for_test
      BEFORE UPDATE ON calendar_accounts
      FOR EACH ROW EXECUTE FUNCTION fail_mail_credential_save_for_test();
    `);
    try {
      await expect(service.syncAccount(userId, account.id)).resolves.toMatchObject({ changed: 2 });
      expect(updateMailThread).not.toHaveBeenCalled();
      const [thread] = await database.db
        .select()
        .from(mailThreads)
        .where(eq(mailThreads.remoteThreadId, "credential-failure-thread"));
      expect(thread).toMatchObject({ starred: false, unread: true });
      const [failedAccount] = await database.db
        .select()
        .from(calendarAccounts)
        .where(eq(calendarAccounts.id, account.id));
      expect(failedAccount).toMatchObject({ syncError: null, syncStatus: "idle" });
    } finally {
      await database.pool.query(`
        DROP TRIGGER IF EXISTS fail_mail_credential_save_for_test ON calendar_accounts;
        DROP FUNCTION IF EXISTS fail_mail_credential_save_for_test();
      `);
      vi.mocked(updateMailThread).mockReset();
      vi.mocked(updateMailThread).mockResolvedValue(rotatedCredentials);
    }
  });

  it("pauses active rules when their Mail profile policy changes", async () => {
    const [account] = await database.db
      .select()
      .from(calendarAccounts)
      .where(eq(calendarAccounts.providerAccountId, "google-person"));
    if (!account) throw new Error("Connected account fixture is missing.");
    const [profile] = await database.db
      .select()
      .from(domainProfiles)
      .where(eq(domainProfiles.userId, userId));
    if (!profile) throw new Error("Mail profile fixture is missing.");
    await database.db
      .update(domainProfiles)
      .set({ status: "draft", version: profile.version + 1 })
      .where(eq(domainProfiles.id, profile.id));
    const syncMail = google.syncMail;
    const updateMailThread = google.updateMailThread;
    if (!syncMail || !updateMailThread) throw new Error("Google Mail fixtures are unavailable.");
    vi.mocked(updateMailThread).mockClear();
    vi.mocked(syncMail).mockResolvedValueOnce({
      credentials,
      value: {
        deletedThreadIds: [],
        nextSyncToken: null,
        reset: false,
        mailboxes: [{ id: "INBOX", name: "Inbox", role: "inbox", totalCount: 1, unreadCount: 1 }],
        threads: [
          {
            bodyText: "Body",
            from: { address: "sender@example.com", name: "Sender" },
            mailboxIds: ["INBOX", "UNREAD"],
            messageCount: 1,
            receivedAt: timestamp,
            remoteThreadId: "policy-change-thread",
            snippet: "Google Mail",
            starred: false,
            subject: "Google Mail policy change",
            to: [],
            unread: true,
          },
        ],
      },
    });
    await expect(service.syncAccount(userId, account.id)).resolves.toMatchObject({
      changed: expect.any(Number),
    });
    expect(updateMailThread).not.toHaveBeenCalled();
    const activeRules = await database.db
      .select()
      .from(mailRules)
      .where(and(eq(mailRules.userId, userId), eq(mailRules.enabled, true)));
    expect(activeRules).toEqual([]);
    await expect(database.db.select().from(attentionItems)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          domain: "mail",
          status: "open",
          summary: expect.stringContaining("Mail profile is no longer active"),
        }),
      ]),
    );
  });

  it("validates the full automatic Mail rule safety matrix before provider access", async () => {
    const [account] = await database.db
      .select()
      .from(calendarAccounts)
      .where(eq(calendarAccounts.providerAccountId, "google-person"));
    if (!account) throw new Error("Connected account fixture is missing.");
    const syncMail = google.syncMail;
    const updateMailThread = google.updateMailThread;
    if (!syncMail || !updateMailThread) throw new Error("Google Mail fixtures are unavailable.");

    const [otherGoogle, unsupportedICloud] = await database.db
      .insert(calendarAccounts)
      .values([
        {
          calendarEnabled: false,
          email: "other-google@example.com",
          label: "Other Google",
          mailEnabled: true,
          provider: "google",
          providerAccountId: "other-google-rule-source",
          userId,
        },
        {
          calendarEnabled: false,
          email: "unsupported-icloud@example.com",
          label: "Unsupported iCloud",
          mailEnabled: true,
          provider: "icloud",
          providerAccountId: "unsupported-icloud-rule-source",
          userId,
        },
      ])
      .returning();
    if (!otherGoogle || !unsupportedICloud) {
      throw new Error("Automatic Mail source fixtures were not created.");
    }
    const [currentLabel, foreignLabel] = await database.db
      .insert(mailboxes)
      .values([
        {
          accountId: account.id,
          name: "Projects",
          provider: "google",
          remoteMailboxId: "Label_Projects",
          role: "custom",
          userId,
        },
        {
          accountId: otherGoogle.id,
          name: "Foreign",
          provider: "google",
          remoteMailboxId: "Label_Foreign",
          role: "custom",
          userId,
        },
      ])
      .returning();
    if (!currentLabel || !foreignLabel) throw new Error("Mail label fixtures were not created.");

    const [profile] = await database.db
      .select()
      .from(domainProfiles)
      .where(and(eq(domainProfiles.userId, userId), eq(domainProfiles.domain, "mail")));
    if (!profile) throw new Error("Mail profile fixture is missing.");

    const baseRule = {
      actions: [{ afterDays: 0, mailboxId: null, type: "mark_read" as const }],
      condition: { field: "subject" as const, operator: "equals" as const, value: "Label me" },
      enabled: true,
      policy: "approved_rule" as const,
      userId,
    };
    const initialRules = await database.db
      .insert(mailRules)
      .values([
        { ...baseRule, name: "Missing profile", profileId: null, sourceAccountIds: [account.id] },
        {
          ...baseRule,
          name: "Missing explicit source",
          profileId: profile.id,
          sourceAccountIds: [],
        },
        {
          ...baseRule,
          name: "Duplicate source",
          profileId: profile.id,
          sourceAccountIds: [account.id, account.id],
        },
        {
          ...baseRule,
          name: "Inactive profile",
          profileId: profile.id,
          sourceAccountIds: [account.id],
        },
        {
          ...baseRule,
          name: "Different account",
          profileId: null,
          sourceAccountIds: [otherGoogle.id],
        },
      ])
      .returning({ id: mailRules.id, name: mailRules.name });

    vi.mocked(updateMailThread).mockClear();
    vi.mocked(syncMail).mockResolvedValueOnce({
      credentials,
      value: {
        deletedThreadIds: [],
        mailboxes: [],
        nextSyncToken: null,
        reset: false,
        threads: [],
      },
    });
    await expect(service.syncAccount(userId, account.id)).resolves.toMatchObject({ changed: 0 });
    expect(updateMailThread).not.toHaveBeenCalled();

    await database.db
      .update(domainProfiles)
      .set({
        preferences: {
          importantEmailHandling: "inbox_only",
          inboxStyle: "conservative",
          noiseDisposition: "review_only",
        },
        sourceContexts: [],
        status: "active",
        version: profile.version + 1,
      })
      .where(eq(domainProfiles.id, profile.id));
    const missingMeaningRules = await database.db
      .insert(mailRules)
      .values({
        ...baseRule,
        name: "Missing source meaning",
        profileId: profile.id,
        sourceAccountIds: [account.id],
      })
      .returning({ id: mailRules.id, name: mailRules.name });
    vi.mocked(syncMail).mockResolvedValueOnce({
      credentials,
      value: {
        deletedThreadIds: [],
        mailboxes: [],
        nextSyncToken: null,
        reset: false,
        threads: [],
      },
    });
    await expect(service.syncAccount(userId, account.id)).resolves.toMatchObject({ changed: 0 });

    await database.db
      .update(domainProfiles)
      .set({
        preferences: {
          importantEmailHandling: "inbox_only",
          inboxStyle: "conservative",
          noiseDisposition: "archive_after_days",
        },
        sourceContexts: [
          {
            notes: null,
            purpose: "Current Google inbox",
            sourceId: account.id,
            sourceLabel: account.label,
          },
          {
            notes: null,
            purpose: "Unsupported iCloud inbox",
            sourceId: unsupportedICloud.id,
            sourceLabel: unsupportedICloud.label,
          },
        ],
        version: profile.version + 2,
      })
      .where(eq(domainProfiles.id, profile.id));
    const sourceAndPreferenceRules = await database.db
      .insert(mailRules)
      .values([
        {
          ...baseRule,
          name: "Unsupported source provider",
          profileId: profile.id,
          sourceAccountIds: [account.id, unsupportedICloud.id],
        },
        {
          ...baseRule,
          name: "Invalid stored preferences",
          profileId: profile.id,
          sourceAccountIds: [account.id],
        },
      ])
      .returning({ id: mailRules.id, name: mailRules.name });
    vi.mocked(syncMail).mockResolvedValueOnce({
      credentials,
      value: {
        deletedThreadIds: [],
        mailboxes: [],
        nextSyncToken: null,
        reset: false,
        threads: [],
      },
    });
    await expect(service.syncAccount(userId, account.id)).resolves.toMatchObject({ changed: 0 });

    await database.db
      .update(domainProfiles)
      .set({
        preferences: {
          importantEmailHandling: "inbox_only",
          inboxStyle: "conservative",
          noiseDisposition: "review_only",
        },
        version: profile.version + 3,
      })
      .where(eq(domainProfiles.id, profile.id));
    const finalRules = await database.db
      .insert(mailRules)
      .values([
        {
          ...baseRule,
          actions: [{ afterDays: 0, mailboxId: foreignLabel.id, type: "add_label" as const }],
          name: "Foreign destination label",
          profileId: profile.id,
          sourceAccountIds: [account.id],
        },
        {
          ...baseRule,
          actions: [{ afterDays: 0, mailboxId: null, type: "archive" as const }],
          name: "Retention requires durable work",
          profileId: profile.id,
          sourceAccountIds: [account.id],
        },
        {
          ...baseRule,
          actions: [{ afterDays: 0, mailboxId: currentLabel.id, type: "add_label" as const }],
          name: "Current project label",
          profileId: profile.id,
          sourceAccountIds: [account.id],
        },
        {
          ...baseRule,
          name: "Read labeled mail",
          profileId: profile.id,
          sourceAccountIds: [account.id],
        },
        {
          ...baseRule,
          actions: [{ afterDays: 0, mailboxId: null, type: "star" as const }],
          name: "Star labeled mail",
          profileId: profile.id,
          sourceAccountIds: [account.id],
        },
      ])
      .returning({ id: mailRules.id, name: mailRules.name });
    vi.mocked(syncMail).mockResolvedValueOnce({
      credentials,
      value: {
        deletedThreadIds: [],
        nextSyncToken: null,
        reset: false,
        mailboxes: [
          { id: "INBOX", name: "Inbox", role: "inbox", totalCount: 1, unreadCount: 1 },
          {
            id: "Label_Projects",
            name: "Projects",
            role: "custom",
            totalCount: 0,
            unreadCount: 0,
          },
        ],
        threads: [
          {
            bodyText: "Label this conversation",
            from: { address: "sender@example.com", name: "Sender" },
            mailboxIds: ["INBOX", "UNREAD"],
            messageCount: 1,
            receivedAt: timestamp,
            remoteThreadId: "safety-matrix-thread",
            snippet: "Label me",
            starred: false,
            subject: "Label me",
            to: [],
            unread: true,
          },
          {
            bodyText: "Already organized",
            from: { address: "sender@example.com", name: "Sender" },
            mailboxIds: ["INBOX", "Label_Projects"],
            messageCount: 1,
            receivedAt: timestamp,
            remoteThreadId: "safety-matrix-noop-thread",
            snippet: "Label me",
            starred: true,
            subject: "Label me",
            to: [],
            unread: false,
          },
        ],
      },
    });

    await expect(service.syncAccount(userId, account.id)).resolves.toMatchObject({
      changed: 4,
    });
    expect(updateMailThread).not.toHaveBeenCalled();
    const insertedRules = [
      ...initialRules,
      ...missingMeaningRules,
      ...sourceAndPreferenceRules,
      ...finalRules,
    ];
    const ruleStates = await database.db
      .select({ enabled: mailRules.enabled, name: mailRules.name, policy: mailRules.policy })
      .from(mailRules)
      .where(
        inArray(
          mailRules.id,
          insertedRules.map((rule) => rule.id),
        ),
      );
    expect(ruleStates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ enabled: true, name: "Current project label" }),
        expect.objectContaining({ enabled: true, name: "Different account" }),
        expect.objectContaining({ enabled: true, name: "Read labeled mail" }),
        expect.objectContaining({ enabled: true, name: "Retention requires durable work" }),
        expect.objectContaining({ enabled: true, name: "Star labeled mail" }),
        ...insertedRules
          .filter(
            (rule) =>
              ![
                "Current project label",
                "Different account",
                "Read labeled mail",
                "Retention requires durable work",
                "Star labeled mail",
              ].includes(rule.name),
          )
          .map((rule) =>
            expect.objectContaining({ enabled: false, name: rule.name, policy: "preview" }),
          ),
      ]),
    );
    await expect(database.db.select().from(mailRuleWorkItems)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: { afterDays: 0, mailboxId: null, type: "archive" },
          remoteThreadId: "safety-matrix-thread",
          status: "pending",
        }),
      ]),
    );
    const [storedThread] = await database.db
      .select()
      .from(mailThreads)
      .where(eq(mailThreads.remoteThreadId, "safety-matrix-thread"));
    expect(storedThread).toMatchObject({
      remoteMailboxIds: ["INBOX", "UNREAD"],
      starred: false,
      unread: true,
    });
    await database.db.delete(mailRuleWorkItems);
  });

  it("connects one encrypted iCloud account to Mail and Calendar with write-through", async () => {
    const connected = await service.connectICloud(userId, {
      appSpecificPassword: "xxxx-xxxx-xxxx-xxxx",
      calendar: true,
      email: "person@icloud.com",
      mail: true,
    });
    const account = (await service.listAccounts(userId)).find(
      (item) => item.id === connected.accountId,
    );
    expect(account).toMatchObject({
      calendarEnabled: true,
      mailEnabled: true,
      provider: "icloud",
      syncStatus: "idle",
    });
    expect(icloud.listCalendars).not.toHaveBeenCalled();
    expect(icloud.syncMail).not.toHaveBeenCalled();
    await expect(service.syncAccount(userId, connected.accountId)).resolves.toMatchObject({
      changed: expect.any(Number),
    });
    await service.mailGateway.send(userId, connected.accountId, {
      body: "Hello",
      cc: [],
      subject: "Subject",
      to: [{ address: "to@example.com", name: null }],
    });
    await expect(
      service.mailGateway.update(userId, connected.accountId, "thread", {
        addMailboxIds: [],
        removeMailboxIds: [],
      }),
    ).resolves.toBeUndefined();
    expect(icloud.updateMailThread).toHaveBeenCalledOnce();
    const [calendar] = await database.db
      .select()
      .from(calendars)
      .where(eq(calendars.accountId, connected.accountId));
    if (!calendar) throw new Error("iCloud calendar fixture is missing.");
    const created = await service.eventGateway.create(calendar, {
      allDay: false,
      calendarId: calendar.id,
      endsAt: "2026-07-13T14:00:00.000Z",
      location: null,
      notes: null,
      startsAt: "2026-07-13T13:00:00.000Z",
      timezone: "UTC",
      title: "Create",
    });
    const event = {
      ...(await database.db
        .insert(calendarEvents)
        .values({
          calendarId: calendar.id,
          endsAt: created.endsAt,
          provider: "icloud" as const,
          remoteEtag: created.etag,
          remoteEventId: created.remoteEventId,
          startsAt: created.startsAt,
          timezone: created.timezone,
          title: created.title,
          userId,
        })
        .returning()
        .then((records) => records[0] as NonNullable<(typeof records)[0]>)),
    };
    await expect(
      service.eventGateway.update(calendar, event, { title: "Update" }),
    ).resolves.toMatchObject({
      title: "iCloud update",
    });
    await expect(service.eventGateway.delete(calendar, event)).resolves.toBeUndefined();
    expect(
      await database.db
        .select()
        .from(mailThreads)
        .where(eq(mailThreads.accountId, connected.accountId)),
    ).toEqual([expect.objectContaining({ subject: "iCloud mail" })]);
    await expect(
      service.startGoogleAuthorization(userId, {
        accountId: connected.accountId,
        returnTo: "/settings?section=connections",
        services: ["calendar", "mail"],
      }),
    ).rejects.toMatchObject({
      code: "invalid_request",
    });

    const mailOnly = await service.connectICloud(userId, {
      appSpecificPassword: "mail-only",
      calendar: false,
      email: "mail-only@icloud.com",
      mail: true,
    });
    await service.syncAccount(userId, mailOnly.accountId);
    const calendarOnly = await service.connectICloud(userId, {
      appSpecificPassword: "calendar-only",
      calendar: true,
      email: "calendar-only@icloud.com",
      mail: false,
    });
    await service.syncAccount(userId, calendarOnly.accountId);
    const [calendarOnlyDestination] = await database.db
      .select()
      .from(calendars)
      .where(eq(calendars.accountId, calendarOnly.accountId));
    if (!calendarOnlyDestination) throw new Error("Calendar-only destination is missing.");
    const [calendarOnlyProfile] = await database.db
      .insert(domainProfiles)
      .values({
        categories: [],
        domain: "calendar",
        instructions: [],
        objective: "Use the iCloud calendar.",
        preferences: {
          afterBufferMinutes: 0,
          automaticEventCreation: false,
          automaticEventEvidence: [],
          beforeBufferMinutes: 0,
          busyBlockPrivacy: "busy",
          defaultCalendarId: calendarOnlyDestination.id,
          defaultTimezone: "UTC",
        },
        sourceContexts: [
          {
            notes: null,
            purpose: "iCloud commitments",
            sourceId: calendarOnlyDestination.id,
            sourceLabel: calendarOnlyDestination.name,
          },
        ],
        status: "active",
        summary: "Use iCloud.",
        userId,
      })
      .returning();
    if (!calendarOnlyProfile) throw new Error("Calendar-only profile is missing.");
    await service.connectICloud(
      userId,
      {
        appSpecificPassword: "calendar-disabled",
        calendar: false,
        email: "calendar-only@icloud.com",
        mail: true,
      },
      "disable-icloud-calendar",
    );
    await expect(
      database.db
        .select()
        .from(domainProfiles)
        .where(eq(domainProfiles.id, calendarOnlyProfile.id)),
    ).resolves.toEqual([
      expect.objectContaining({ sourceContexts: [], status: "draft", version: 2 }),
    ]);
    await expect(
      database.db.select().from(calendars).where(eq(calendars.id, calendarOnlyDestination.id)),
    ).resolves.toEqual([expect.objectContaining({ deletedAt: timestamp })]);
    await expect(
      service.eventGateway.create(calendarOnlyDestination, {
        allDay: false,
        calendarId: calendarOnlyDestination.id,
        endsAt: "2026-07-13T14:00:00.000Z",
        location: null,
        notes: null,
        startsAt: "2026-07-13T13:00:00.000Z",
        timezone: "UTC",
        title: "Disabled Calendar write",
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
    await database.db.delete(domainProfiles).where(eq(domainProfiles.id, calendarOnlyProfile.id));
  });

  it("keeps a failed iCloud bootstrap available for retry", async () => {
    const connected = await service.connectICloud(userId, {
      appSpecificPassword: "invalid-provider-password",
      calendar: false,
      email: "unavailable@icloud.com",
      mail: true,
    });
    vi.mocked(icloud.syncMail).mockRejectedValueOnce(new Error("Apple Mail is unavailable"));

    await expect(service.syncAccount(userId, connected.accountId)).rejects.toMatchObject({
      code: "service_unavailable",
      details: expect.objectContaining({ recovery: "automatic" }),
    });
    expect(
      (await service.listAccounts(userId)).find((item) => item.id === connected.accountId),
    ).toMatchObject({
      email: "unavailable@icloud.com",
      syncError: "iCloud is temporarily unavailable. ilo will retry automatically.",
      syncStatus: "error",
    });
  });

  it("closes Google callbacks with safe outcomes and never enables ungranted services", async () => {
    const deniedUrl = await service.startGoogleAuthorization(userId);
    const deniedState = String(new URL(deniedUrl).searchParams.get("state"));
    const denied = await service.handleGoogleAuthorizationCallback({
      error: "access_denied",
      issuer: "https://accounts.google.com",
      requestId: "request-denied",
      state: deniedState,
    });
    expect(denied).toEqual({
      attemptId: expect.any(String),
      returnPath: "/settings?section=connections",
      status: "cancelled",
    });
    if (!denied.attemptId) throw new Error("Denied attempt ID is missing.");
    expect(
      await database.db.select().from(oauthStates).where(eq(oauthStates.id, denied.attemptId)),
    ).toEqual([
      expect.objectContaining({
        connectedAccountId: null,
        outcomeCode: "authorization_cancelled",
        status: "cancelled",
      }),
    ]);

    const [accountBefore] = await database.db
      .select()
      .from(calendarAccounts)
      .where(eq(calendarAccounts.providerAccountId, "google-person"));
    if (!accountBefore) throw new Error("Google account fixture is missing.");
    const incompleteCredentials = {
      ...credentials,
      accessToken: "<html>RAW_PROVIDER_CANARY</html>",
      scope: `${googleCalendarScope} https://www.googleapis.com/auth/gmail.send`,
    };
    vi.mocked(google.exchangeCode).mockResolvedValueOnce(incompleteCredentials);
    vi.mocked(google.getProfile).mockResolvedValueOnce({
      credentials: incompleteCredentials,
      value: {
        email: "private-canary@example.com",
        id: "google-person",
        name: "RAW_PROVIDER_CANARY",
      },
    });
    const incompleteUrl = await service.startGoogleAuthorization(userId, {
      accountId: accountBefore.id,
      returnTo: "/settings?section=connections",
      services: ["calendar", "mail"],
    });
    const incompleteState = String(new URL(incompleteUrl).searchParams.get("state"));
    const incomplete = await service.handleGoogleAuthorizationCallback({
      code: "RAW_CODE_CANARY",
      issuer: "https://accounts.google.com",
      requestId: "request-incomplete",
      state: incompleteState,
    });
    expect(incomplete.status).toBe("permission_incomplete");
    if (!incomplete.attemptId) throw new Error("Incomplete attempt ID is missing.");
    const [attempt] = await database.db
      .select()
      .from(oauthStates)
      .where(eq(oauthStates.id, incomplete.attemptId));
    expect(JSON.stringify(attempt)).not.toContain("RAW_PROVIDER_CANARY");
    expect(JSON.stringify(attempt)).not.toContain("private-canary@example.com");
    expect(JSON.stringify(attempt)).not.toContain("RAW_CODE_CANARY");
    const [accountAfter] = await database.db
      .select()
      .from(calendarAccounts)
      .where(eq(calendarAccounts.id, accountBefore.id));
    expect(accountAfter).toEqual(accountBefore);

    await database.db
      .update(calendarAccounts)
      .set({
        nextSyncAt: new Date("2026-07-14T12:00:00.000Z"),
        syncError: "Reconnect required.",
        syncErrorCategory: "authorization",
        syncErrorCode: "authorization_revoked",
        syncFailureCount: 2,
        syncRecovery: "reconnect",
        syncStatus: "error",
      })
      .where(eq(calendarAccounts.id, accountBefore.id));
    const completeCredentials = { ...credentials, scope: googleCalendarAndMailScope };
    vi.mocked(google.exchangeCode).mockResolvedValueOnce(completeCredentials);
    vi.mocked(google.getProfile).mockResolvedValueOnce({
      credentials: completeCredentials,
      value: { email: "person@example.com", id: "google-person", name: "Google Person" },
    });
    const successUrl = await service.startGoogleAuthorization(userId, {
      accountId: accountBefore.id,
      returnTo: "/settings?section=connections",
      services: ["calendar", "mail"],
    });
    const success = await service.handleGoogleAuthorizationCallback({
      code: "success-code",
      issuer: "https://accounts.google.com",
      requestId: "request-success",
      state: String(new URL(successUrl).searchParams.get("state")),
    });
    expect(success.status).toBe("connected");
    const [healthyAccount] = await database.db
      .select()
      .from(calendarAccounts)
      .where(eq(calendarAccounts.id, accountBefore.id));
    expect(healthyAccount).toMatchObject({
      calendarEnabled: true,
      mailEnabled: true,
      nextSyncAt: timestamp,
      syncClaimId: null,
      syncError: null,
      syncErrorCategory: null,
      syncErrorCode: null,
      syncFailureCount: 0,
      syncRecovery: null,
      syncStatus: "idle",
    });
  });

  it("completes OAuth, updates an existing connection, and validates one-time state", async () => {
    await expect(service.completeGoogleAuthorization("invalid", "code")).rejects.toMatchObject({
      code: "invalid_request",
    });

    const authorizationUrl = await service.startGoogleAuthorization(userId, {
      returnTo: "/settings?section=connections",
      services: ["calendar"],
    });
    const state = new URL(authorizationUrl).searchParams.get("state");
    expect(state).toMatch(/^oauth_/);
    const connected = await service.completeGoogleAuthorization(String(state), "code-1");
    expect(connected.email).toBe("person@example.com");
    expect(connected.returnPath).toBe("/settings?section=connections");
    expect(google.exchangeCode).toHaveBeenCalledWith("code-1", expect.stringMatching(/^pkce_/));
    await expect(service.completeGoogleAuthorization(String(state), "code-again")).resolves.toEqual(
      connected,
    );
    const concurrentAuthorizationUrl = await service.startGoogleAuthorization(userId, {
      returnTo: "/settings?section=connections",
      services: ["calendar"],
    });
    const concurrentState = String(new URL(concurrentAuthorizationUrl).searchParams.get("state"));
    const exchangeCountBeforeRace = vi.mocked(google.exchangeCode).mock.calls.length;
    const concurrentResults = await Promise.allSettled([
      service.completeGoogleAuthorization(concurrentState, "concurrent-code-1"),
      service.completeGoogleAuthorization(concurrentState, "concurrent-code-2"),
    ]);
    expect(
      concurrentResults.filter((result) => result.status === "fulfilled").length,
    ).toBeGreaterThanOrEqual(1);
    expect(vi.mocked(google.exchangeCode).mock.calls).toHaveLength(exchangeCountBeforeRace + 1);

    expect(
      (await service.listAccounts(userId)).find((item) => item.id === connected.accountId),
    ).toEqual(
      expect.objectContaining({
        id: connected.accountId,
        label: "person@example.com",
        provider: "google",
        syncStatus: "idle",
      }),
    );

    vi.mocked(google.getProfile).mockResolvedValueOnce({
      credentials,
      value: {
        email: "renamed@example.com",
        id: "google-person",
        name: "Renamed Google",
      },
    });
    vi.mocked(google.listCalendars).mockResolvedValueOnce({
      credentials,
      value: [
        {
          accessRole: "owner",
          color: "#abcdef",
          id: "remote-primary",
          name: "Renamed Primary",
          primary: true,
          selected: true,
          timezone: "America/Chicago",
          writable: true,
        },
      ],
    });
    const secondUrl = await service.startGoogleAuthorization(userId, {
      returnTo: "/settings?section=connections",
      services: ["calendar"],
    });
    const secondState = new URL(secondUrl).searchParams.get("state");
    const reconnected = await service.completeGoogleAuthorization(String(secondState), "code-2");
    await service.syncAccount(userId, reconnected.accountId);
    expect(reconnected.accountId).toBe(connected.accountId);
    expect((await service.listAccounts(userId))[0]).toMatchObject({
      email: "renamed@example.com",
      label: "Renamed Google",
    });
    const [updatedCalendar] = await database.db
      .select()
      .from(calendars)
      .where(eq(calendars.remoteCalendarId, "remote-primary"));
    expect(updatedCalendar).toMatchObject({
      color: "#abcdef",
      name: "Renamed Primary",
      timezone: "America/Chicago",
    });
  });

  it("drains durable low-latency triggers through the fenced sync engine", async () => {
    await database.db.delete(connectorSyncTriggers);
    const [account] = await database.db
      .select()
      .from(calendarAccounts)
      .where(eq(calendarAccounts.providerAccountId, "google-person"));
    if (!account) throw new Error("Triggered sync account is missing.");
    await service.enqueueSyncTrigger(account.id, "notification");
    await expect(service.dispatchTriggeredSyncs({ concurrency: 1, limit: 1 })).resolves.toEqual({
      attempted: 1,
      failed: 0,
      succeeded: 1,
    });
    await expect(
      database.db
        .select()
        .from(connectorSyncTriggers)
        .where(eq(connectorSyncTriggers.accountId, account.id)),
    ).resolves.toEqual([]);
  });

  it("rotates credentials through remote event create, update, and delete operations", async () => {
    const [calendar] = await database.db
      .select()
      .from(calendars)
      .where(eq(calendars.remoteCalendarId, "remote-primary"));
    if (!calendar) throw new Error("Google calendar fixture is missing.");
    const created = await service.eventGateway.create(calendar, {
      allDay: false,
      calendarId: calendar.id,
      endsAt: "2026-07-13T14:00:00.000Z",
      location: null,
      notes: null,
      startsAt: "2026-07-13T13:00:00.000Z",
      timezone: "UTC",
      title: "Create",
    });
    expect(created.title).toBe("Created remotely");

    const [event] = await database.db
      .insert(calendarEvents)
      .values({
        calendarId: calendar.id,
        endsAt: created.endsAt,
        provider: "google",
        remoteEtag: created.etag,
        remoteEventId: created.remoteEventId,
        startsAt: created.startsAt,
        timezone: created.timezone,
        title: created.title,
        userId,
      })
      .returning();
    if (!event) throw new Error("Remote event fixture is missing.");
    expect((await service.eventGateway.update(calendar, event, { title: "Update" })).title).toBe(
      "Updated remotely",
    );
    await service.eventGateway.delete(calendar, event);
    expect(google.deleteEvent).toHaveBeenCalledWith(
      expect.objectContaining({ accessToken: "access-2" }),
      "remote-primary",
      "created-remote",
      "etag-created",
    );

    const calendarWithoutRemote = { ...calendar, remoteCalendarId: null };
    await expect(
      service.eventGateway.create(calendarWithoutRemote, {
        allDay: false,
        calendarId: calendar.id,
        endsAt: "2026-07-13T14:00:00.000Z",
        location: null,
        notes: null,
        startsAt: "2026-07-13T13:00:00.000Z",
        timezone: "UTC",
        title: "Invalid",
      }),
    ).rejects.toMatchObject({ code: "internal_error" });
    await expect(
      service.eventGateway.update(calendarWithoutRemote, event, {}),
    ).rejects.toMatchObject({ code: "internal_error" });
    await expect(
      service.eventGateway.delete(calendar, { ...event, remoteEventId: null }),
    ).rejects.toMatchObject({ code: "internal_error" });

    const localConnectorCalendar = { ...calendar, provider: "local" as const };
    await expect(
      service.eventGateway.create(localConnectorCalendar, {
        allDay: false,
        calendarId: calendar.id,
        endsAt: "2026-07-13T14:00:00.000Z",
        location: null,
        notes: null,
        startsAt: "2026-07-13T13:00:00.000Z",
        timezone: "UTC",
        title: "Invalid local write",
      }),
    ).rejects.toMatchObject({ code: "invalid_request" });
    await expect(
      service.eventGateway.update(localConnectorCalendar, event, {}),
    ).rejects.toMatchObject({ code: "invalid_request" });
    await expect(service.eventGateway.delete(localConnectorCalendar, event)).rejects.toMatchObject({
      code: "invalid_request",
    });

    const [credentiallessAccount] = await database.db
      .insert(calendarAccounts)
      .values({
        label: "Broken",
        provider: "google",
        providerAccountId: "broken-google",
        userId,
      })
      .returning();
    if (!credentiallessAccount) throw new Error("Broken account fixture is missing.");
    const [credentiallessCalendar] = await database.db
      .insert(calendars)
      .values({
        accountId: credentiallessAccount.id,
        name: "Broken",
        provider: "google",
        remoteCalendarId: "broken-remote",
        timezone: "UTC",
        userId,
      })
      .returning();
    if (!credentiallessCalendar) throw new Error("Broken calendar fixture is missing.");
    await expect(
      service.eventGateway.create(credentiallessCalendar, {
        allDay: false,
        calendarId: credentiallessCalendar.id,
        endsAt: "2026-07-13T14:00:00.000Z",
        location: null,
        notes: null,
        startsAt: "2026-07-13T13:00:00.000Z",
        timezone: "UTC",
        title: "No credentials",
      }),
    ).rejects.toMatchObject({ code: "not_found" });
  });

  it("discloses a provider create when refreshed credential persistence fails", async () => {
    const [calendar] = await database.db
      .select()
      .from(calendars)
      .where(eq(calendars.remoteCalendarId, "remote-primary"));
    if (!calendar) throw new Error("Google calendar fixture is missing.");
    const newlyRefreshedCredentials = {
      ...rotatedCredentials,
      accessToken: "access-credential-failure",
      expiresAt: "2026-07-13T15:00:00.000Z",
    };
    vi.mocked(google.createEvent).mockResolvedValueOnce({
      credentials: newlyRefreshedCredentials,
      value: remoteEvent("created-remote", "etag-created", "Created remotely"),
    });
    vi.mocked(google.updateEvent).mockResolvedValueOnce({
      credentials: newlyRefreshedCredentials,
      value: remoteEvent("updated-remote", "etag-updated", "Updated remotely"),
    });
    vi.mocked(google.deleteEvent).mockResolvedValueOnce(newlyRefreshedCredentials);
    await database.db.execute(sql`
      CREATE FUNCTION reject_calendar_credential_update() RETURNS trigger AS $$
      BEGIN
        IF NEW.encrypted_credentials IS DISTINCT FROM OLD.encrypted_credentials THEN
          RAISE EXCEPTION 'credential persistence unavailable';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await database.db.execute(sql`
      CREATE TRIGGER reject_calendar_credential_update
      BEFORE UPDATE ON calendar_accounts
      FOR EACH ROW EXECUTE FUNCTION reject_calendar_credential_update()
    `);
    try {
      await expect(
        service.eventGateway.create(calendar, {
          allDay: false,
          calendarId: calendar.id,
          endsAt: "2026-07-13T14:00:00.000Z",
          location: null,
          notes: null,
          startsAt: "2026-07-13T13:00:00.000Z",
          timezone: "UTC",
          title: "Credential failure",
        }),
      ).rejects.toMatchObject({
        code: "service_unavailable",
        details: {
          partialEffect: "provider_event_created",
          provider: "google",
          remoteEventId: "created-remote",
        },
      });
      const [event] = await database.db
        .select()
        .from(calendarEvents)
        .where(eq(calendarEvents.calendarId, calendar.id))
        .limit(1);
      if (!event) throw new Error("Google event fixture is missing.");
      await expect(
        service.eventGateway.update(calendar, event, { title: "Credential failure update" }),
      ).rejects.toMatchObject({
        code: "service_unavailable",
        details: {
          partialEffect: "provider_event_updated",
          provider: "google",
          recovery: expect.stringContaining("reconnect"),
          remoteEventId: "updated-remote",
        },
      });
      await expect(service.eventGateway.delete(calendar, event)).rejects.toMatchObject({
        code: "service_unavailable",
        details: {
          partialEffect: "provider_event_deleted",
          provider: "google",
          recovery: expect.stringContaining("reconnect"),
          remoteEventId: event.remoteEventId,
        },
      });
    } finally {
      await database.db.execute(
        sql`DROP TRIGGER reject_calendar_credential_update ON calendar_accounts`,
      );
      await database.db.execute(sql`DROP FUNCTION reject_calendar_credential_update()`);
    }
  });

  it("distinguishes indeterminate provider transport failures from definitive rejections", async () => {
    const [calendar] = await database.db
      .select()
      .from(calendars)
      .where(eq(calendars.remoteCalendarId, "remote-primary"));
    const [event] = await database.db
      .select()
      .from(calendarEvents)
      .where(eq(calendarEvents.calendarId, calendar?.id ?? crypto.randomUUID()))
      .limit(1);
    if (!calendar || !event) throw new Error("Google Calendar mutation fixtures are missing.");
    vi.mocked(google.createEvent).mockRejectedValueOnce(
      new DOMException("Provider request timed out.", "AbortError"),
    );
    await expect(
      service.eventGateway.create(calendar, {
        allDay: false,
        calendarId: calendar.id,
        endsAt: "2026-07-13T14:00:00.000Z",
        location: null,
        notes: null,
        startsAt: "2026-07-13T13:00:00.000Z",
        timezone: "UTC",
        title: "Unknown provider result",
      }),
    ).rejects.toMatchObject({
      code: "service_unavailable",
      details: {
        effectState: "indeterminate",
        provider: "google",
        recovery: expect.stringContaining("Synchronize Calendar before retrying"),
      },
    });

    vi.mocked(google.updateEvent).mockRejectedValueOnce(
      connectorError("Provider precondition failed.", 412),
    );
    await expect(
      service.eventGateway.update(calendar, event, { title: "Rejected provider update" }),
    ).rejects.toMatchObject({
      code: "conflict",
      details: {
        effectState: "rejected",
        provider: "google",
        providerStatus: 412,
        remoteEventId: event.remoteEventId,
      },
    });

    vi.mocked(google.createEvent).mockRejectedValueOnce(
      connectorError("Provider access was forbidden.", 403),
    );
    await expect(
      service.eventGateway.create(calendar, {
        allDay: false,
        calendarId: calendar.id,
        endsAt: "2026-07-13T14:00:00.000Z",
        location: null,
        notes: null,
        startsAt: "2026-07-13T13:00:00.000Z",
        timezone: "UTC",
        title: "Forbidden provider create",
      }),
    ).rejects.toMatchObject({
      code: "forbidden",
      details: {
        effectState: "rejected",
        provider: "google",
        providerStatus: 403,
      },
    });
  });

  it("reconciles incremental and full sync changes with an audit trail", async () => {
    const account = (await service.listAccounts(userId)).find(
      (value) => value.email === "renamed@example.com",
    );
    if (!account) throw new Error("Connected account fixture is missing.");
    const accountCalendars = await database.db
      .select()
      .from(calendars)
      .where(eq(calendars.accountId, account.id))
      .orderBy(asc(calendars.name));
    const primary = accountCalendars.find((value) => value.remoteCalendarId === "remote-primary");
    const readonly = accountCalendars.find((value) => value.remoteCalendarId === "remote-readonly");
    if (!primary || !readonly) throw new Error("Remote calendar fixtures are missing.");

    for (const value of [
      remoteEvent("unchanged", "etag-same"),
      remoteEvent("changed", "etag-old", "Old title"),
      remoteEvent("deleted", "etag-delete"),
      remoteEvent("stale", "etag-stale"),
    ]) {
      await database.db.insert(calendarEvents).values({
        allDay: value.allDay,
        calendarId: primary.id,
        endsAt: value.endsAt,
        provider: "google",
        remoteEtag: value.etag,
        remoteEventId: value.remoteEventId,
        startsAt: value.startsAt,
        timezone: value.timezone,
        title: value.title,
        userId,
      });
    }
    await database.db.insert(calendarEvents).values({
      calendarId: readonly.id,
      endsAt: new Date("2026-07-13T14:00:00.000Z"),
      provider: "google",
      remoteEtag: "etag-readonly-stale",
      remoteEventId: "readonly-stale",
      startsAt: new Date("2026-07-13T13:00:00.000Z"),
      timezone: "UTC",
      title: "Readonly stale",
      userId,
    });
    await database.db.insert(calendars).values({
      accountId: account.id,
      name: "Missing provider id",
      provider: "google",
      remoteCalendarId: null,
      timezone: "UTC",
      userId,
    });
    await database.db.insert(calendars).values({
      accountId: account.id,
      name: "Mismatched local calendar",
      provider: "local",
      remoteCalendarId: "invalid-local-provider-id",
      timezone: "UTC",
      userId,
    });

    vi.mocked(google.syncCalendar).mockImplementation(async (_credentials, remoteCalendarId) => {
      if (remoteCalendarId === "remote-primary") {
        return {
          credentials: rotatedCredentials,
          value: {
            changes: [
              { kind: "delete", remoteEventId: "missing-delete" },
              { kind: "delete", remoteEventId: "deleted" },
              { event: remoteEvent("unchanged", "etag-same"), kind: "upsert" },
              {
                event: remoteEvent(
                  "changed",
                  "etag-new",
                  "New title",
                  "https://meet.google.com/abc-defg-hij",
                ),
                kind: "upsert",
              },
              { event: remoteEvent("created", "etag-new"), kind: "upsert" },
            ],
            nextSyncToken: "primary-next",
            reset: true,
          },
        };
      }
      return {
        credentials: rotatedCredentials,
        value: { changes: [], nextSyncToken: "readonly-next", reset: true },
      };
    });

    await expect(service.syncAccount(userId, account.id)).resolves.toEqual({ changed: 6 });
    const records = await database.db
      .select()
      .from(calendarEvents)
      .where(eq(calendarEvents.calendarId, primary.id));
    expect(records.find((value) => value.remoteEventId === "unchanged")?.deletedAt).toBeNull();
    expect(records.find((value) => value.remoteEventId === "changed")).toMatchObject({
      conferenceUrl: "https://meet.google.com/abc-defg-hij",
      deletedAt: null,
      remoteEtag: "etag-new",
      title: "New title",
    });
    expect(records.find((value) => value.remoteEventId === "created")?.deletedAt).toBeNull();
    expect(records.find((value) => value.remoteEventId === "deleted")?.status).toBe("cancelled");
    expect(records.find((value) => value.remoteEventId === "stale")?.deletedAt).toEqual(timestamp);
    const actions = (
      await database.db.select().from(auditEvents).where(eq(auditEvents.userId, userId))
    ).map((value) => value.action);
    expect(actions).toEqual(
      expect.arrayContaining([
        "calendar_event.created_by_connector",
        "calendar_event.updated_by_connector",
        "calendar_event.deleted_by_connector",
        "calendar_event.removed_by_full_sync",
      ]),
    );

    vi.mocked(google.syncCalendar).mockRejectedValueOnce(
      new Error("raw-provider-canary token=secret"),
    );
    await expect(service.syncAccount(userId, account.id)).rejects.toMatchObject({
      code: "service_unavailable",
      details: expect.objectContaining({
        accountId: account.id,
        category: "unknown",
        provider: "google",
        recovery: "automatic",
      }),
    });
    const [retrying] = await database.db
      .select()
      .from(calendarAccounts)
      .where(eq(calendarAccounts.id, account.id));
    expect(retrying).toMatchObject({
      lastSyncAttemptAt: timestamp,
      syncError: "Google is temporarily unavailable. ilo will retry automatically.",
      syncErrorCategory: "unknown",
      syncFailureCount: 1,
      syncRecovery: "automatic",
      syncStatus: "error",
    });
    expect(retrying?.nextSyncAt?.getTime()).toBeGreaterThanOrEqual(timestamp.getTime() + 60_000);
    expect(JSON.stringify(retrying)).not.toContain("raw-provider-canary");

    vi.mocked(google.syncCalendar).mockRejectedValueOnce(
      new ConnectorError({
        category: "authorization",
        code: "google_authorization_failed",
        disposition: "reconnect",
        message: "raw-authorization-canary",
        status: 401,
      }),
    );
    await expect(service.syncAccount(userId, account.id)).rejects.toMatchObject({
      code: "service_unavailable",
      details: expect.objectContaining({ recovery: "reconnect" }),
    });
    const [reconnect] = await database.db
      .select()
      .from(calendarAccounts)
      .where(eq(calendarAccounts.id, account.id));
    expect(reconnect).toMatchObject({
      nextSyncAt: null,
      syncErrorCategory: "authorization",
      syncFailureCount: 2,
      syncRecovery: "reconnect",
      syncStatus: "error",
    });
    expect(JSON.stringify(reconnect)).not.toContain("raw-authorization-canary");

    await expect(service.syncAccount(userId, account.id)).resolves.toEqual({ changed: 0 });
    const [recovered] = await database.db
      .select()
      .from(calendarAccounts)
      .where(eq(calendarAccounts.id, account.id));
    expect(recovered).toMatchObject({
      nextSyncAt: new Date(timestamp.getTime() + 5 * 60_000),
      syncError: null,
      syncErrorCategory: null,
      syncErrorCode: null,
      syncFailureCount: 0,
      syncRecovery: null,
      syncStatus: "idle",
    });
  });

  it("persists iCloud collection tokens only inside the active sync claim", async () => {
    const [account] = await database.db
      .insert(calendarAccounts)
      .values({
        calendarEnabled: true,
        email: "calendar-fence@icloud.example",
        encryptedCredentials: encryptJson(
          {
            appSpecificPassword: "app-password",
            email: "calendar-fence@icloud.example",
          },
          encryptionKey,
        ),
        label: "iCloud Calendar fence",
        mailEnabled: false,
        provider: "icloud",
        providerAccountId: "calendar-fence@icloud.example",
        userId,
      })
      .returning();
    if (!account) throw new Error("iCloud calendar fence account was not created.");
    const [calendar] = await database.db
      .insert(calendars)
      .values({
        accountId: account.id,
        name: "iCloud Calendar",
        provider: "icloud",
        remoteCalendarId: "icloud-primary",
        syncToken: "opaque-old-token",
        timezone: "UTC",
        userId,
      })
      .returning();
    if (!calendar) throw new Error("iCloud calendar fence source was not created.");
    await database.db.insert(calendarEvents).values({
      calendarId: calendar.id,
      endsAt: new Date("2026-07-13T14:00:00.000Z"),
      provider: "icloud",
      remoteEtag: "etag-stale",
      remoteEventId: "icloud-stale",
      startsAt: new Date("2026-07-13T13:00:00.000Z"),
      timezone: "UTC",
      title: "Stale iCloud event",
      userId,
    });
    const projected = remoteEvent("icloud-projected", "etag-projected");
    vi.mocked(icloud.syncCalendar).mockResolvedValueOnce({
      changes: [
        { event: projected, kind: "upsert" },
        { event: projected, kind: "upsert" },
      ],
      nextSyncToken: "opaque-next-token",
      reset: true,
    });

    await expect(service.syncAccount(userId, account.id)).resolves.toEqual({ changed: 2 });
    await expect(
      database.db
        .select({ syncToken: calendars.syncToken })
        .from(calendars)
        .where(eq(calendars.id, calendar.id)),
    ).resolves.toEqual([{ syncToken: "opaque-next-token" }]);
    await expect(
      database.db
        .select({ remoteEventId: calendarEvents.remoteEventId })
        .from(calendarEvents)
        .where(
          and(
            eq(calendarEvents.calendarId, calendar.id),
            eq(calendarEvents.remoteEventId, "icloud-projected"),
          ),
        ),
    ).resolves.toHaveLength(1);

    const replacementClaimId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    vi.mocked(icloud.syncCalendar).mockImplementationOnce(async () => {
      await database.db
        .update(calendarAccounts)
        .set({ syncClaimId: replacementClaimId })
        .where(eq(calendarAccounts.id, account.id));
      return {
        changes: [{ event: remoteEvent("must-not-project", "etag-new"), kind: "upsert" }],
        nextSyncToken: "must-not-persist",
        reset: false,
      };
    });

    await expect(service.syncAccount(userId, account.id)).rejects.toMatchObject({
      code: "conflict",
      message: expect.stringContaining("superseded"),
    });
    await expect(
      database.db
        .select({ syncToken: calendars.syncToken })
        .from(calendars)
        .where(eq(calendars.id, calendar.id)),
    ).resolves.toEqual([{ syncToken: "opaque-next-token" }]);
    await expect(
      database.db
        .select({ id: calendarEvents.id })
        .from(calendarEvents)
        .where(eq(calendarEvents.remoteEventId, "must-not-project")),
    ).resolves.toHaveLength(0);
    await expect(
      database.db
        .select({ syncClaimId: calendarAccounts.syncClaimId })
        .from(calendarAccounts)
        .where(eq(calendarAccounts.id, account.id)),
    ).resolves.toEqual([{ syncClaimId: replacementClaimId }]);
  });

  it("records an unavailable optional mail connector as a synchronization error", async () => {
    const [account] = await database.db
      .select()
      .from(calendarAccounts)
      .where(eq(calendarAccounts.providerAccountId, "google-person"));
    if (!account) throw new Error("Connected account fixture is missing.");
    const { syncMail: _syncMail, ...googleWithoutMail } = google;
    const serviceWithoutMail = createConnectorService({
      db: database.db,
      encryptionKey,
      google: googleWithoutMail,
      icloud,
      now: () => timestamp,
    });
    await database.db
      .update(calendarAccounts)
      .set({ calendarEnabled: false, mailEnabled: true })
      .where(eq(calendarAccounts.id, account.id));
    await expect(serviceWithoutMail.syncAccount(userId, account.id)).rejects.toMatchObject({
      code: "service_unavailable",
      details: expect.objectContaining({ recovery: "operator" }),
    });
    await database.db
      .update(calendarAccounts)
      .set({ calendarEnabled: true })
      .where(eq(calendarAccounts.id, account.id));
  });

  it("writes connected events through the calendar domain service", async () => {
    const [account] = await database.db
      .select()
      .from(calendarAccounts)
      .where(eq(calendarAccounts.providerAccountId, "google-person"));
    if (!account) throw new Error("Connected account fixture is missing.");
    const remoteCalendars = await database.db
      .select()
      .from(calendars)
      .where(eq(calendars.accountId, account.id));
    const primary = remoteCalendars.find((value) => value.remoteCalendarId === "remote-primary");
    const readonly = remoteCalendars.find((value) => value.remoteCalendarId === "remote-readonly");
    if (!primary || !readonly) throw new Error("Connected calendar fixtures are missing.");
    const gateway = {
      create: vi.fn(async () =>
        remoteEvent("domain-created", "domain-create-etag", "Provider create"),
      ),
      delete: vi.fn(async () => undefined),
      update: vi.fn(async () =>
        remoteEvent("domain-created", "domain-update-etag", "Provider update"),
      ),
    };
    const calendarService = createCalendarService({
      connectedEvents: gateway,
      db: database.db,
      now: () => timestamp,
    });
    const context = {
      principal: {
        actorId: userId,
        actorType: "user" as const,
        scopes: new Set(["calendar:read" as const, "calendar:write" as const]),
        userId,
      },
      requestId: "calendar-domain-test",
    };

    await expect(
      calendarService.createEvent(
        {
          allDay: false,
          calendarId: readonly.id,
          endsAt: "2026-07-13T14:00:00.000Z",
          location: null,
          notes: null,
          startsAt: "2026-07-13T13:00:00.000Z",
          timezone: "UTC",
          title: "Read only",
        },
        context,
      ),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      calendarService.createEvent(
        {
          allDay: false,
          calendarId: crypto.randomUUID(),
          endsAt: "2026-07-13T14:00:00.000Z",
          location: null,
          notes: null,
          startsAt: "2026-07-13T13:00:00.000Z",
          timezone: "UTC",
          title: "Missing calendar",
        },
        context,
      ),
    ).rejects.toMatchObject({ code: "not_found" });
    await expect(
      calendarService.createLocalCalendar(
        { color: null, name: "No local account", timezone: "UTC" },
        context,
      ),
    ).rejects.toMatchObject({ code: "internal_error" });
    await expect(calendarService.getEvent(crypto.randomUUID(), userId)).rejects.toMatchObject({
      code: "not_found",
    });

    const created = await calendarService.createEvent(
      {
        allDay: false,
        calendarId: primary.id,
        endsAt: "2026-07-13T14:00:00.000Z",
        location: "Ignored local location",
        notes: "Ignored local notes",
        startsAt: "2026-07-13T13:00:00.000Z",
        timezone: "UTC",
        title: "Local title",
      },
      context,
    );
    expect(created).toMatchObject({
      provider: "google",
      remoteEventId: "domain-created",
      title: "Provider create",
    });
    await expect(calendarService.getEvent(created.id, userId)).resolves.toEqual(created);
    await expect(
      calendarService.updateEvent(created.id, { title: "Changed" }, context),
    ).resolves.toMatchObject({ title: "Provider update" });
    expect(gateway.update).toHaveBeenCalled();
    await expect(calendarService.deleteEvent(created.id, context)).resolves.toMatchObject({
      blockUpdatedAtById: {},
      eventId: created.id,
    });
    expect(gateway.delete).toHaveBeenCalled();
    await expect(calendarService.restoreEvent(created.id, context)).resolves.toMatchObject({
      title: "Provider create",
    });
    expect(gateway.create).toHaveBeenCalledTimes(2);

    const [duplicateAccount] = await database.db
      .insert(calendarAccounts)
      .values({
        label: "Second Google account",
        provider: "google",
        providerAccountId: "google-second",
        userId,
      })
      .returning();
    if (!duplicateAccount) throw new Error("Second connected account fixture is missing.");
    const [duplicateCalendar] = await database.db
      .insert(calendars)
      .values({
        accountId: duplicateAccount.id,
        isWritable: false,
        name: "Duplicate primary projection",
        provider: "google",
        remoteCalendarId: "remote-primary",
        timezone: "UTC",
        userId,
      })
      .returning();
    if (!duplicateCalendar) throw new Error("Duplicate calendar fixture is missing.");
    const [duplicateEvent] = await database.db
      .insert(calendarEvents)
      .values({
        calendarId: duplicateCalendar.id,
        endsAt: new Date("2026-07-13T14:00:00.000Z"),
        provider: "google",
        remoteEtag: "domain-create-etag",
        remoteEventId: "domain-created",
        startsAt: new Date("2026-07-13T13:00:00.000Z"),
        timezone: "UTC",
        title: "Provider create",
        userId,
      })
      .returning();
    if (!duplicateEvent) throw new Error("Duplicate event fixture is missing.");

    const [mirroredCalendar] = await database.db
      .insert(calendars)
      .values({
        accountId: duplicateAccount.id,
        isPrimary: true,
        isWritable: true,
        name: "ZZ Mirrored primary",
        provider: "google",
        remoteCalendarId: "another-primary",
        timezone: "UTC",
        userId,
      })
      .returning();
    if (!mirroredCalendar) throw new Error("Mirrored calendar fixture is missing.");
    const [mirroredEvent] = await database.db
      .insert(calendarEvents)
      .values({
        calendarId: mirroredCalendar.id,
        endsAt: new Date("2026-07-13T14:00:00.000Z"),
        provider: "google",
        remoteEtag: "mirrored-etag",
        remoteEventId: "mirrored-domain-created",
        startsAt: new Date("2026-07-13T13:00:00.000Z"),
        timezone: "UTC",
        title: "  PROVIDER CREATE  ",
        userId,
      })
      .returning();
    if (!mirroredEvent) throw new Error("Mirrored event fixture is missing.");

    const unifiedCalendars = await calendarService.list(userId);
    expect(unifiedCalendars.some((value) => value.id === primary.id)).toBe(true);
    expect(unifiedCalendars.some((value) => value.id === duplicateCalendar.id)).toBe(false);
    const unifiedEvents = await calendarService.listEvents(userId, {
      from: "2026-07-13T00:00:00.000Z",
      to: "2026-07-14T00:00:00.000Z",
    });
    expect(unifiedEvents.filter((value) => value.remoteEventId === "domain-created")).toEqual([
      expect.objectContaining({ calendarId: primary.id }),
    ]);
    expect(unifiedEvents.some((value) => value.remoteEventId === mirroredEvent.remoteEventId)).toBe(
      true,
    );
    await expect(
      calendarService.listEvents(userId, {
        calendarIds: [duplicateCalendar.id],
        from: "2026-07-13T00:00:00.000Z",
        to: "2026-07-14T00:00:00.000Z",
      }),
    ).resolves.toEqual([expect.objectContaining({ id: duplicateEvent.id })]);

    await expect(calendarService.setSelected(primary.id, false, context)).resolves.toMatchObject({
      isSelected: false,
    });
    await expect(
      calendarService.updateLocalCalendar(primary.id, { name: "Not local" }, context),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(calendarService.deleteLocalCalendar(primary.id, context)).rejects.toMatchObject({
      code: "forbidden",
    });
    const eventsAfterHidingCanonicalCalendar = await calendarService.listEvents(userId, {
      from: "2026-07-13T00:00:00.000Z",
      to: "2026-07-14T00:00:00.000Z",
    });
    expect(
      eventsAfterHidingCanonicalCalendar.some((value) => value.remoteEventId === "domain-created"),
    ).toBe(false);

    const [localAccount] = await database.db
      .insert(calendarAccounts)
      .values({
        label: "Local domain account",
        provider: "local",
        providerAccountId: "local-domain",
        userId,
      })
      .returning();
    if (!localAccount) throw new Error("Local account fixture is missing.");
    const localCalendar = await calendarService.createLocalCalendar(
      { color: "#ffffff", name: "Local domain", timezone: "UTC" },
      context,
    );
    await expect(
      calendarService.updateLocalCalendar(localCalendar.id, { name: "Renamed local" }, context),
    ).resolves.toMatchObject({ color: "#ffffff", name: "Renamed local", timezone: "UTC" });
    await expect(
      calendarService.updateLocalCalendar(localCalendar.id, { color: null }, context),
    ).resolves.toMatchObject({ color: null, name: "Renamed local" });
    const localEvent = await calendarService.createEvent(
      {
        allDay: false,
        calendarId: localCalendar.id,
        endsAt: "2026-07-13T16:00:00.000Z",
        location: "Local",
        notes: "Local notes",
        startsAt: "2026-07-13T15:00:00.000Z",
        timezone: "UTC",
        title: "Local event",
      },
      context,
    );
    await expect(
      calendarService.updateEvent(localEvent.id, { title: "Only title" }, context),
    ).resolves.toMatchObject({
      allDay: false,
      endsAt: "2026-07-13T16:00:00.000Z",
      location: "Local",
      notes: "Local notes",
      startsAt: "2026-07-13T15:00:00.000Z",
      timezone: "UTC",
      title: "Only title",
    });
    await expect(
      calendarService.updateEvent(localEvent.id, { notes: null }, context),
    ).resolves.toMatchObject({ notes: null, title: "Only title" });
    await expect(
      calendarService.createEventBlock(
        localEvent.id,
        { calendarId: localCalendar.id, mode: "busy" },
        context,
      ),
    ).rejects.toMatchObject({ code: "invalid_request" });
    await expect(
      calendarService.createEventBlock(
        localEvent.id,
        { calendarId: readonly.id, mode: "busy" },
        context,
      ),
    ).rejects.toMatchObject({ code: "forbidden" });
    const linked = await calendarService.createEventBlock(
      localEvent.id,
      { calendarId: mirroredCalendar.id, mode: "busy" },
      context,
    );
    expect(linked.blocks).toEqual([
      expect.objectContaining({ calendarId: mirroredCalendar.id, mode: "busy" }),
    ]);
    await expect(
      calendarService.createEventBlock(
        localEvent.id,
        { calendarId: mirroredCalendar.id, mode: "details" },
        context,
      ),
    ).resolves.toEqual(linked);
    const blockId = linked.blocks[0]?.eventId as string;
    await expect(calendarService.getEvent(blockId, userId)).resolves.toMatchObject({
      blockMode: "busy",
      blockSourceEventId: localEvent.id,
    });
    await expect(
      calendarService.updateEvent(blockId, { title: "Detached" }, context),
    ).rejects.toMatchObject({ code: "conflict" });
    await expect(calendarService.deleteEvent(blockId, context)).rejects.toMatchObject({
      code: "conflict",
    });
    await expect(
      calendarService.updateEventBlock(localEvent.id, blockId, { mode: "busy" }, context),
    ).resolves.toEqual(linked);
    await expect(
      calendarService.updateEventBlock(localEvent.id, blockId, { mode: "details" }, context),
    ).resolves.toMatchObject({ blocks: [expect.objectContaining({ mode: "details" })] });
    await expect(
      calendarService.updateEventBlock(created.id, blockId, { mode: "busy" }, context),
    ).rejects.toMatchObject({ code: "not_found" });
    await expect(
      calendarService.deleteEventBlock(created.id, blockId, context),
    ).rejects.toMatchObject({ code: "not_found" });
    await expect(
      calendarService.deleteEventBlock(localEvent.id, crypto.randomUUID(), context),
    ).rejects.toMatchObject({ code: "not_found" });
    await expect(
      calendarService.updateEvent(localEvent.id, { title: "Linked title" }, context),
    ).resolves.toMatchObject({ title: "Linked title" });
    await expect(calendarService.deleteEvent(localEvent.id, context)).resolves.toMatchObject({
      blockUpdatedAtById: { [blockId]: expect.any(String) },
      eventId: localEvent.id,
    });
    await expect(calendarService.restoreEvent(localEvent.id, context)).resolves.toMatchObject({
      blocks: [expect.objectContaining({ eventId: blockId, mode: "details" })],
      title: "Linked title",
    });
    await expect(
      calendarService.deleteEventBlock(localEvent.id, blockId, context),
    ).resolves.toMatchObject({ blocks: [] });
    await calendarService.deleteLocalCalendar(localCalendar.id, context);
  });

  it("serializes an active Mail profile save against account disconnect", async () => {
    const [raceUser] = await database.db
      .insert(users)
      .values({
        displayName: "Mail disconnect race",
        email: "mail-disconnect-race@example.com",
        passwordHash: "unused",
        planningTimezone: "UTC",
      })
      .returning();
    if (!raceUser) throw new Error("Race user fixture was not created.");
    const [account] = await database.db
      .insert(calendarAccounts)
      .values({
        calendarEnabled: false,
        email: "race@icloud.example",
        label: "Race Mail",
        mailEnabled: true,
        provider: "icloud",
        providerAccountId: "race@icloud.example",
        userId: raceUser.id,
      })
      .returning();
    if (!account) throw new Error("Race account fixture was not created.");
    const [profile] = await database.db
      .insert(domainProfiles)
      .values({
        categories: [],
        domain: "mail",
        instructions: [],
        objective: "Keep the race inbox organized.",
        preferences: {
          importantEmailHandling: "inbox_only",
          inboxStyle: "conservative",
          noiseDisposition: "review_only",
        },
        sourceContexts: [
          {
            notes: null,
            purpose: "Race inbox",
            sourceId: account.id,
            sourceLabel: account.label,
          },
        ],
        status: "draft",
        summary: "Race profile",
        userId: raceUser.id,
      })
      .returning();
    if (!profile) throw new Error("Race profile fixture was not created.");
    const [rule] = await database.db
      .insert(mailRules)
      .values({
        actions: [{ afterDays: 0, mailboxId: null, type: "mark_read" }],
        condition: { field: "subject", operator: "contains", value: "receipt" },
        enabled: true,
        name: "Race rule",
        policy: "approved_rule",
        profileId: profile.id,
        sourceAccountIds: [account.id],
        userId: raceUser.id,
      })
      .returning();
    if (!rule) throw new Error("Race rule fixture was not created.");
    const mail = createMailService({
      db: database.db,
      gateway: service.mailGateway,
      now: () => timestamp,
      reviewSigningKey: encryptionKey,
    });
    let sourceLocked: (() => void) | undefined;
    const sourceWasLocked = new Promise<void>((resolveLocked) => {
      sourceLocked = resolveLocked;
    });
    let releaseValidation: (() => void) | undefined;
    const validationCanFinish = new Promise<void>((resolveValidation) => {
      releaseValidation = resolveValidation;
    });
    const assistant = createAssistantService({
      db: database.db,
      now: () => timestamp,
      profileRequiresApproval: () => false,
      validateProfileSources: async (transaction, domain, profileUserId, sourceIds) => {
        if (domain !== "mail") return;
        await mail.validateProfileSources(transaction, profileUserId, sourceIds);
        sourceLocked?.();
        await validationCanFinish;
        return undefined;
      },
    });
    const save = assistant.upsertProfile(
      {
        categories: [],
        domain: "mail",
        expectedVersion: profile.version,
        instructions: [],
        objective: profile.objective,
        preferences: profile.preferences,
        sourceContexts: profile.sourceContexts,
        status: "active",
        summary: profile.summary,
      },
      {
        principal: {
          actorId: raceUser.id,
          actorType: "user",
          scopes: new Set(["mail:read", "mail:write"]),
          userId: raceUser.id,
        },
        requestId: "profile-save-race",
      },
    );
    await sourceWasLocked;
    const disconnect = service.disconnect(raceUser.id, account.id, "disconnect-race");
    await new Promise<void>((resolveTurn) => {
      setImmediate(resolveTurn);
    });
    releaseValidation?.();
    await expect(Promise.all([save, disconnect])).resolves.toBeDefined();

    const [finalProfile] = await database.db
      .select()
      .from(domainProfiles)
      .where(eq(domainProfiles.id, profile.id));
    const [finalRule] = await database.db.select().from(mailRules).where(eq(mailRules.id, rule.id));
    expect(finalProfile).toMatchObject({
      sourceContexts: [],
      status: "draft",
      version: profile.version + 2,
    });
    expect(finalRule).toMatchObject({
      enabled: false,
      policy: "preview",
      version: rule.version + 1,
    });
    await expect(
      database.db.select().from(calendarAccounts).where(eq(calendarAccounts.id, account.id)),
    ).resolves.toEqual([]);
    await expect(
      database.db.select().from(attentionItems).where(eq(attentionItems.relatedEntityId, rule.id)),
    ).resolves.toEqual([
      expect.objectContaining({
        domain: "mail",
        relatedEntityType: "mail_rule",
        status: "open",
      }),
    ]);
  });

  it("fails activation closed when disconnect owns the account lifecycle lock", async () => {
    const [raceUser] = await database.db
      .insert(users)
      .values({
        displayName: "Mail activation race",
        email: "mail-activation-race@example.com",
        passwordHash: "unused",
        planningTimezone: "UTC",
      })
      .returning();
    if (!raceUser) throw new Error("Activation race user fixture was not created.");
    const [account] = await database.db
      .insert(calendarAccounts)
      .values({
        calendarEnabled: false,
        email: "activation-race@example.com",
        label: "Activation Race",
        mailEnabled: true,
        provider: "google",
        providerAccountId: "activation-race",
        userId: raceUser.id,
      })
      .returning();
    if (!account) throw new Error("Activation race account fixture was not created.");
    const [profile] = await database.db
      .insert(domainProfiles)
      .values({
        categories: [],
        domain: "mail",
        instructions: [],
        objective: "Keep activation race mail organized.",
        preferences: {
          importantEmailHandling: "inbox_only",
          inboxStyle: "conservative",
          noiseDisposition: "review_only",
        },
        sourceContexts: [
          {
            notes: null,
            purpose: "Activation race inbox",
            sourceId: account.id,
            sourceLabel: account.label,
          },
        ],
        status: "active",
        summary: "Activation race profile",
        userId: raceUser.id,
      })
      .returning();
    if (!profile) throw new Error("Activation race profile fixture was not created.");
    await database.db.insert(mailThreads).values({
      accountId: account.id,
      bodyText: "Receipt body",
      from: { address: "sender@example.com", name: null },
      provider: "google",
      receivedAt: timestamp,
      remoteMailboxIds: ["INBOX", "UNREAD"],
      remoteThreadId: "activation-race-thread",
      snippet: "Receipt",
      starred: false,
      subject: "Receipt",
      to: [],
      unread: true,
      userId: raceUser.id,
    });
    const [rule] = await database.db
      .insert(mailRules)
      .values({
        actions: [{ afterDays: 0, mailboxId: null, type: "mark_read" }],
        condition: { field: "subject", operator: "contains", value: "receipt" },
        enabled: false,
        name: "Activation race rule",
        policy: "preview",
        profileId: profile.id,
        sourceAccountIds: [account.id],
        userId: raceUser.id,
      })
      .returning();
    if (!rule) throw new Error("Activation race rule fixture was not created.");
    const mail = createMailService({
      db: database.db,
      gateway: service.mailGateway,
      now: () => timestamp,
      reviewSigningKey: encryptionKey,
    });
    const preview = await mail.previewSavedRule(raceUser.id, rule.id);
    const blocker = await database.pool.connect();
    try {
      await blocker.query("BEGIN");
      await blocker.query("SELECT id FROM domain_profiles WHERE id = $1 FOR UPDATE", [profile.id]);
      const disconnect = service.disconnect(raceUser.id, account.id, "activation-disconnect-race");
      const disconnectIsWaiting = await waitForDomainProfileLock();
      expect(disconnectIsWaiting).toBe(true);
      const activation = mail.activateRule(
        rule.id,
        {
          expectedCandidateIds: preview.candidates.map((candidate) => candidate.id),
          expectedPreviewFingerprint: preview.fingerprint,
          expectedPreviewedAt: preview.previewedAt,
          expectedVersion: rule.version,
        },
        {
          principal: {
            actorId: raceUser.id,
            actorType: "user",
            scopes: new Set(["mail:read", "mail:write"]),
            userId: raceUser.id,
          },
          requestId: "activation-race",
        },
      );
      await new Promise<void>((resolveTurn) => {
        setImmediate(resolveTurn);
      });
      await blocker.query("COMMIT");
      await expect(disconnect).resolves.toBeUndefined();
      await expect(activation).rejects.toMatchObject({
        code: expect.stringMatching(/conflict|invalid_request/),
      });
    } finally {
      await blocker.query("ROLLBACK");
      blocker.release();
    }
    const [finalRule] = await database.db.select().from(mailRules).where(eq(mailRules.id, rule.id));
    const [finalProfile] = await database.db
      .select()
      .from(domainProfiles)
      .where(eq(domainProfiles.id, profile.id));
    expect(finalRule?.enabled).toBe(false);
    expect(finalProfile).toMatchObject({ sourceContexts: [], status: "draft" });
  });

  it("rejects rule creation when disconnect removes its source first", async () => {
    const [raceUser] = await database.db
      .insert(users)
      .values({
        displayName: "Mail rule save race",
        email: "mail-rule-save-race@example.com",
        passwordHash: "unused",
        planningTimezone: "UTC",
      })
      .returning();
    if (!raceUser) throw new Error("Rule save race user fixture was not created.");
    const [account] = await database.db
      .insert(calendarAccounts)
      .values({
        calendarEnabled: false,
        email: "rule-save-race@example.com",
        label: "Rule Save Race",
        mailEnabled: true,
        provider: "google",
        providerAccountId: "rule-save-race",
        userId: raceUser.id,
      })
      .returning();
    if (!account) throw new Error("Rule save race account fixture was not created.");
    const [profile] = await database.db
      .insert(domainProfiles)
      .values({
        categories: [],
        domain: "mail",
        instructions: [],
        objective: "Keep rule-save race mail organized.",
        preferences: {
          importantEmailHandling: "inbox_only",
          inboxStyle: "conservative",
          noiseDisposition: "review_only",
        },
        sourceContexts: [
          {
            notes: null,
            purpose: "Rule-save race inbox",
            sourceId: account.id,
            sourceLabel: account.label,
          },
        ],
        status: "active",
        summary: "Rule-save race profile",
        userId: raceUser.id,
      })
      .returning();
    if (!profile) throw new Error("Rule save race profile fixture was not created.");
    const mail = createMailService({
      db: database.db,
      gateway: service.mailGateway,
      now: () => timestamp,
      reviewSigningKey: encryptionKey,
    });
    const blocker = await database.pool.connect();
    try {
      await blocker.query("BEGIN");
      await blocker.query("SELECT id FROM domain_profiles WHERE id = $1 FOR UPDATE", [profile.id]);
      const disconnect = service.disconnect(raceUser.id, account.id, "rule-save-disconnect-race");
      const disconnectIsWaiting = await waitForDomainProfileLock();
      expect(disconnectIsWaiting).toBe(true);
      const create = mail.createRule(
        {
          actions: [{ afterDays: 0, mailboxId: null, type: "mark_read" }],
          condition: { field: "subject", operator: "contains", value: "receipt" },
          confidenceThreshold: null,
          description: "Race-safe rule",
          enabled: false,
          name: "Rule save race",
          policy: "preview",
          profileId: profile.id,
          sourceIds: [account.id],
        },
        {
          principal: {
            actorId: raceUser.id,
            actorType: "user",
            scopes: new Set(["mail:read", "mail:write"]),
            userId: raceUser.id,
          },
          requestId: "rule-save-race",
        },
      );
      await new Promise<void>((resolveTurn) => {
        setImmediate(resolveTurn);
      });
      await blocker.query("COMMIT");
      await expect(disconnect).resolves.toBeUndefined();
      await expect(create).rejects.toMatchObject({ code: "invalid_request" });
    } finally {
      await blocker.query("ROLLBACK");
      blocker.release();
    }
    await expect(
      database.db
        .select()
        .from(mailRules)
        .where(and(eq(mailRules.userId, raceUser.id), eq(mailRules.name, "Rule save race"))),
    ).resolves.toEqual([]);
  });

  it("rejects a rule revision when its label disappears before save", async () => {
    const [labelUser] = await database.db
      .insert(users)
      .values({
        displayName: "Mail label race",
        email: "mail-label-race@example.com",
        passwordHash: "unused",
        planningTimezone: "UTC",
      })
      .returning();
    if (!labelUser) throw new Error("Label race user fixture was not created.");
    const [account] = await database.db
      .insert(calendarAccounts)
      .values({
        calendarEnabled: false,
        email: "label-race@example.com",
        label: "Label Race",
        mailEnabled: true,
        provider: "google",
        providerAccountId: "label-race",
        userId: labelUser.id,
      })
      .returning();
    if (!account) throw new Error("Label race account fixture was not created.");
    const [profile] = await database.db
      .insert(domainProfiles)
      .values({
        categories: [],
        domain: "mail",
        instructions: [],
        objective: "Keep label race mail organized.",
        preferences: {
          importantEmailHandling: "inbox_only",
          inboxStyle: "conservative",
          noiseDisposition: "review_only",
        },
        sourceContexts: [
          {
            notes: null,
            purpose: "Label race inbox",
            sourceId: account.id,
            sourceLabel: account.label,
          },
        ],
        status: "draft",
        summary: "Label race profile",
        userId: labelUser.id,
      })
      .returning();
    const [label] = await database.db
      .insert(mailboxes)
      .values({
        accountId: account.id,
        name: "Orders",
        provider: "google",
        remoteMailboxId: "orders",
        role: "custom",
        userId: labelUser.id,
      })
      .returning();
    if (!profile || !label) throw new Error("Label race fixtures were not created.");
    const [rule] = await database.db
      .insert(mailRules)
      .values({
        actions: [{ afterDays: 0, mailboxId: null, type: "mark_read" }],
        condition: { field: "subject", operator: "contains", value: "receipt" },
        enabled: false,
        name: "Label race rule",
        policy: "preview",
        profileId: profile.id,
        sourceAccountIds: [account.id],
        userId: labelUser.id,
      })
      .returning();
    if (!rule) throw new Error("Label race rule fixture was not created.");
    const mail = createMailService({
      db: database.db,
      gateway: service.mailGateway,
      now: () => timestamp,
      reviewSigningKey: encryptionKey,
    });
    const remover = await database.pool.connect();
    try {
      await remover.query("BEGIN");
      await remover.query("UPDATE mailboxes SET deleted_at = $1 WHERE id = $2", [
        timestamp,
        label.id,
      ]);
      const save = mail.updateRule(
        rule.id,
        {
          actions: [{ afterDays: 0, mailboxId: label.id, type: "add_label" }],
          expectedVersion: rule.version,
        },
        {
          principal: {
            actorId: labelUser.id,
            actorType: "user",
            scopes: new Set(["mail:read", "mail:write"]),
            userId: labelUser.id,
          },
          requestId: "label-save-race",
        },
      );
      await new Promise<void>((resolveTurn) => {
        setImmediate(resolveTurn);
      });
      await remover.query("COMMIT");
      await expect(save).rejects.toMatchObject({ code: "invalid_request" });
    } finally {
      await remover.query("ROLLBACK");
      remover.release();
    }
    const [unchanged] = await database.db.select().from(mailRules).where(eq(mailRules.id, rule.id));
    expect(unchanged).toMatchObject({
      actions: [{ afterDays: 0, mailboxId: null, type: "mark_read" }],
      version: rule.version,
    });
  });

  it("invalidates Mail dependents when an account loses Mail capability", async () => {
    const [capabilityUser] = await database.db
      .insert(users)
      .values({
        displayName: "Mail capability transition",
        email: "mail-capability-transition@example.com",
        passwordHash: "unused",
        planningTimezone: "UTC",
      })
      .returning();
    if (!capabilityUser) throw new Error("Capability user fixture was not created.");
    const connected = await service.connectICloud(capabilityUser.id, {
      appSpecificPassword: "test-password",
      calendar: true,
      email: "capability@icloud.example",
      mail: true,
    });
    const [profile] = await database.db
      .insert(domainProfiles)
      .values({
        categories: [],
        domain: "mail",
        instructions: [],
        objective: "Keep capability mail organized.",
        preferences: {
          importantEmailHandling: "inbox_only",
          inboxStyle: "conservative",
          noiseDisposition: "review_only",
        },
        sourceContexts: [
          {
            notes: null,
            purpose: "Capability inbox",
            sourceId: connected.accountId,
            sourceLabel: "Capability Mail",
          },
        ],
        status: "active",
        summary: "Capability profile",
        userId: capabilityUser.id,
      })
      .returning();
    if (!profile) throw new Error("Capability profile fixture was not created.");
    const [rule] = await database.db
      .insert(mailRules)
      .values({
        actions: [{ afterDays: 0, mailboxId: null, type: "mark_read" }],
        condition: { field: "subject", operator: "contains", value: "receipt" },
        enabled: true,
        name: "Capability rule",
        policy: "approved_rule",
        profileId: profile.id,
        sourceAccountIds: [connected.accountId],
        userId: capabilityUser.id,
      })
      .returning();
    if (!rule) throw new Error("Capability rule fixture was not created.");
    const [cachedThread] = await database.db
      .insert(mailThreads)
      .values({
        accountId: connected.accountId,
        bodyText: "Cached capability mail",
        from: { address: "sender@example.com", name: null },
        provider: "icloud",
        receivedAt: timestamp,
        remoteMailboxIds: ["INBOX"],
        remoteThreadId: "capability-thread",
        snippet: "Cached",
        starred: false,
        subject: "Cached capability mail",
        to: [],
        unread: true,
        userId: capabilityUser.id,
      })
      .returning();
    if (!cachedThread) throw new Error("Capability thread fixture was not created.");
    const [cachedMessage] = await database.db
      .insert(mailMessages)
      .values({
        attachments: [
          {
            contentType: "text/calendar",
            filename: "",
            id: "capability-part",
            providerAttachmentId: null,
            providerPartId: "capability-part",
            size: 64,
          },
        ],
        bodyText: "BEGIN:VCALENDAR",
        cc: [],
        from: { address: "organizer@example.com", name: null },
        providerMailboxIds: ["INBOX"],
        providerRevision: "capability-revision",
        receivedAt: timestamp,
        remoteMessageId: "capability-message",
        threadId: cachedThread.id,
        to: [],
      })
      .returning();
    if (!cachedMessage) throw new Error("Capability message fixture was not created.");
    await database.db.transaction((transaction) =>
      recordMailCalendarCommitmentIntakes(transaction, {
        accountId: connected.accountId,
        message: cachedMessage,
        principal: {
          actorId: capabilityUser.id,
          actorType: "user",
          userId: capabilityUser.id,
        },
        privacyKey: encryptionKey,
        providerAccountAddressHint: "capability@icloud.example",
        recordedAt: timestamp,
        requestId: "capability-intake",
        thread: cachedThread,
      }),
    );
    await database.db
      .update(mailCalendarCommitmentIntakes)
      .set({
        authority: "server_verified",
        evidenceKind: "test_verified_invitation",
        status: "succeeded",
      })
      .where(eq(mailCalendarCommitmentIntakes.accountId, connected.accountId));
    const [importantAttention, runAttention] = await database.db
      .insert(attentionItems)
      .values([
        {
          domain: "mail",
          importance: "high",
          kind: "important",
          relatedEntityId: cachedThread.id,
          relatedEntityType: "mail_thread",
          source: {
            accountId: connected.accountId,
            provider: "icloud",
            remoteId: "capability-thread",
            revision: cachedThread.updatedAt.toISOString(),
            sourceType: "mail_thread",
          },
          status: "open",
          summary: "Preserve this important signal.",
          title: "Important cached mail",
          userId: capabilityUser.id,
        },
        {
          domain: "mail",
          importance: "normal",
          kind: "follow_up",
          relatedEntityId: connected.accountId,
          relatedEntityType: "mail_account",
          status: "open",
          summary: "Pending Mail automation.",
          title: "Mail automation has pending work",
          userId: capabilityUser.id,
        },
      ])
      .returning();
    if (!importantAttention || !runAttention) {
      throw new Error("Capability attention fixtures were not created.");
    }

    await service.connectICloud(
      capabilityUser.id,
      {
        appSpecificPassword: "replacement-password",
        calendar: true,
        email: "capability@icloud.example",
        mail: false,
      },
      "disable-mail-capability",
    );

    const [account] = await database.db
      .select()
      .from(calendarAccounts)
      .where(eq(calendarAccounts.id, connected.accountId));
    const [finalProfile] = await database.db
      .select()
      .from(domainProfiles)
      .where(eq(domainProfiles.id, profile.id));
    const [finalRule] = await database.db.select().from(mailRules).where(eq(mailRules.id, rule.id));
    expect(account?.mailEnabled).toBe(false);
    expect(finalProfile).toMatchObject({
      sourceContexts: [],
      status: "draft",
      version: profile.version + 1,
    });
    expect(finalRule).toMatchObject({
      enabled: false,
      policy: "preview",
      version: rule.version + 1,
    });
    await expect(
      database.db.select().from(mailThreads).where(eq(mailThreads.accountId, connected.accountId)),
    ).resolves.toEqual([]);
    await expect(
      database.db
        .select()
        .from(mailCalendarCommitmentIntakes)
        .where(eq(mailCalendarCommitmentIntakes.accountId, connected.accountId)),
    ).resolves.toEqual([
      expect.objectContaining({
        authority: "provider_projected_unverified",
        evidenceKind: "source_mail_capability_disabled",
        sourceMessageId: null,
        sourceThreadId: null,
        status: "preview_only",
      }),
    ]);
    await expect(
      database.db.transaction((transaction) =>
        invalidateMailCalendarCommitmentIntakes(transaction, {
          accountId: connected.accountId,
          invalidatedAt: new Date(timestamp.getTime() + 1_000),
          principal: {
            actorId: capabilityUser.id,
            actorType: "user",
            userId: capabilityUser.id,
          },
          reasonCode: "mail_capability_disabled",
          requestId: "repeat-mail-capability-invalidation",
        }),
      ),
    ).resolves.toBe(0);
    await expect(
      database.db
        .select()
        .from(auditEvents)
        .where(eq(auditEvents.requestId, "repeat-mail-capability-invalidation")),
    ).resolves.toHaveLength(0);
    const disabledMail = createMailService({
      db: database.db,
      gateway: service.mailGateway,
      now: () => timestamp,
      reviewSigningKey: encryptionKey,
    });
    await expect(disabledMail.listSetupContext(capabilityUser.id)).resolves.toMatchObject({
      commitmentIntake: { previewOnlyCount: 0 },
    });
    const detachedAttention = await database.db
      .select()
      .from(attentionItems)
      .where(inArray(attentionItems.id, [importantAttention.id, runAttention.id]));
    expect(detachedAttention).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: importantAttention.id,
          relatedEntityId: null,
          relatedEntityType: null,
          source: null,
          status: "open",
        }),
        expect.objectContaining({
          id: runAttention.id,
          relatedEntityId: null,
          relatedEntityType: null,
          status: "open",
        }),
      ]),
    );
    const lifecycleAudits = await database.db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.userId, capabilityUser.id));
    expect(JSON.stringify(lifecycleAudits)).not.toContain(connected.accountId);
    expect(lifecycleAudits).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "mail_calendar_intake.source_unavailable",
          requestId: "disable-mail-capability",
        }),
      ]),
    );
    expect(lifecycleAudits).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "assistant.profile.updated",
          requestId: "disable-mail-capability",
        }),
        expect.objectContaining({
          action: "mail.rule.paused_policy_mismatch",
          requestId: "disable-mail-capability",
        }),
      ]),
    );

    const restoredMail = {
      deletedThreadIds: [],
      mailboxes: [
        {
          id: "INBOX",
          name: "Inbox",
          providerRevision: "100",
          role: "inbox" as const,
          totalCount: 1,
          unreadCount: 0,
        },
      ],
      nextSyncToken: null,
      reset: true,
      threads: [
        {
          bodyText: "BEGIN:VCALENDAR",
          from: { address: "organizer@example.com", name: null },
          mailboxIds: ["INBOX"],
          messageCount: 1,
          messages: [
            {
              attachments: [
                {
                  contentType: "text/calendar",
                  filename: "",
                  id: "capability-part",
                  providerAttachmentId: null,
                  providerPartId: "capability-part",
                  size: 64,
                },
              ],
              bodyText: "BEGIN:VCALENDAR",
              cc: [],
              from: { address: "organizer@example.com", name: null },
              mailboxIds: ["INBOX"],
              providerRevision: "capability-revision",
              receivedAt: timestamp,
              remoteMessageId: "capability-message",
              to: [],
            },
          ],
          receivedAt: timestamp,
          remoteThreadId: "capability-thread",
          snippet: "Calendar request",
          starred: false,
          subject: "Calendar request",
          to: [],
          unread: false,
        },
      ],
    };
    await service.connectICloud(capabilityUser.id, {
      appSpecificPassword: "replacement-password",
      calendar: true,
      email: "capability@icloud.example",
      mail: true,
    });
    vi.mocked(icloud.syncMail).mockResolvedValueOnce(restoredMail);
    await service.syncAccount(capabilityUser.id, connected.accountId);
    await expect(
      database.db
        .select()
        .from(mailCalendarCommitmentIntakes)
        .where(eq(mailCalendarCommitmentIntakes.accountId, connected.accountId)),
    ).resolves.toEqual([
      expect.objectContaining({
        authority: "provider_projected_unverified",
        evidenceKind: "calendar_attachment_metadata",
        sourceMessageId: expect.any(String),
        sourceThreadId: expect.any(String),
        status: "preview_only",
      }),
    ]);

    const [preResetIntake] = await database.db
      .select()
      .from(mailCalendarCommitmentIntakes)
      .where(eq(mailCalendarCommitmentIntakes.remoteMessageId, "capability-message"));
    if (!preResetIntake) throw new Error("Pre-reset iCloud intake fixture is missing.");
    await database.db
      .update(mailCalendarCommitmentIntakes)
      .set({
        authority: "server_verified",
        evidenceKind: "test_verified_invitation",
        status: "succeeded",
      })
      .where(eq(mailCalendarCommitmentIntakes.id, preResetIntake.id));
    const resetMail = {
      ...restoredMail,
      mailboxes: restoredMail.mailboxes.map((mailbox) => ({
        ...mailbox,
        providerRevision: "101",
      })),
      threads: restoredMail.threads.map((remoteThread) => ({
        ...remoteThread,
        messages: remoteThread.messages?.map((remoteMessage) => ({
          ...remoteMessage,
          attachments: remoteMessage.attachments.map((attachment, index) => ({
            ...attachment,
            id: `INBOX:101:7:${String(index)}`,
            providerPartId: `INBOX:101:7:${String(index)}`,
          })),
          providerRevision: "101:7",
          remoteMessageId: "INBOX:101:7",
        })),
        remoteThreadId: "INBOX:101:7",
      })),
    };
    vi.mocked(icloud.syncMail).mockResolvedValueOnce(resetMail);
    await service.syncAccount(capabilityUser.id, connected.accountId);
    await expect(
      database.db
        .select()
        .from(mailCalendarCommitmentIntakes)
        .where(eq(mailCalendarCommitmentIntakes.id, preResetIntake.id)),
    ).resolves.toEqual([
      expect.objectContaining({
        authority: "provider_projected_unverified",
        evidenceKind: "source_mailbox_revision_changed",
        sourceMessageId: null,
        sourceThreadId: null,
        status: "preview_only",
      }),
    ]);
    await expect(
      database.db
        .select()
        .from(mailMessages)
        .where(eq(mailMessages.remoteMessageId, "capability-message")),
    ).resolves.toEqual([
      expect.objectContaining({
        remoteMessageId: "capability-message",
        providerRevision: "capability-revision",
      }),
    ]);
    const secondResetMail = {
      ...resetMail,
      mailboxes: resetMail.mailboxes.map((mailbox) => ({
        ...mailbox,
        providerRevision: "102",
      })),
      threads: resetMail.threads.map((remoteThread) => ({
        ...remoteThread,
        messages: remoteThread.messages?.map((remoteMessage) => ({
          ...remoteMessage,
          attachments: remoteMessage.attachments.map((attachment, index) => ({
            ...attachment,
            id: `INBOX:102:7:${String(index)}`,
            providerPartId: `INBOX:102:7:${String(index)}`,
          })),
          providerRevision: "102:7",
          remoteMessageId: "INBOX:102:7",
        })),
        remoteThreadId: "INBOX:102:7",
      })),
    };
    vi.mocked(icloud.syncMail).mockResolvedValueOnce(secondResetMail);
    await service.syncAccount(capabilityUser.id, connected.accountId);
    const preResetAudits = await database.db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.entityId, preResetIntake.id));
    expect(
      preResetAudits.filter(
        (audit) =>
          audit.action === "mail_calendar_intake.source_unavailable" &&
          JSON.stringify(audit.after).includes("mailboxRevision"),
      ),
    ).toHaveLength(1);

    let releaseInFlightMail: ((mail: typeof resetMail) => void) | undefined;
    const inFlightMail = new Promise<typeof resetMail>((resolveMail) => {
      releaseInFlightMail = resolveMail;
    });
    const priorICloudSyncCount = vi.mocked(icloud.syncMail).mock.calls.length;
    vi.mocked(icloud.syncMail).mockImplementationOnce(() => inFlightMail);
    const inFlightSync = service.syncAccount(capabilityUser.id, connected.accountId);
    await vi.waitFor(() => expect(icloud.syncMail).toHaveBeenCalledTimes(priorICloudSyncCount + 1));
    await service.connectICloud(
      capabilityUser.id,
      {
        appSpecificPassword: "replacement-password",
        calendar: true,
        email: "capability@icloud.example",
        mail: false,
      },
      "disable-mail-during-sync",
    );
    await service.connectICloud(capabilityUser.id, {
      appSpecificPassword: "newest-password",
      calendar: true,
      email: "capability@icloud.example",
      mail: true,
    });
    const newerMail = {
      ...resetMail,
      threads: resetMail.threads.map((remoteThread) => ({
        ...remoteThread,
        bodyText: "NEWER BEGIN:VCALENDAR",
        messages: remoteThread.messages?.map((remoteMessage) => ({
          ...remoteMessage,
          bodyText: "NEWER BEGIN:VCALENDAR",
        })),
      })),
    };
    vi.mocked(icloud.syncMail).mockResolvedValueOnce(newerMail);
    await service.syncAccount(capabilityUser.id, connected.accountId);
    releaseInFlightMail?.(resetMail);
    await expect(inFlightSync).rejects.toMatchObject({ code: "conflict" });
    await expect(
      database.db
        .select()
        .from(mailMessages)
        .where(eq(mailMessages.remoteMessageId, "INBOX:101:7")),
    ).resolves.toEqual([
      expect.objectContaining({
        bodyText: "NEWER BEGIN:VCALENDAR",
        providerRevision: "101:7",
      }),
    ]);
    await expect(
      database.db
        .select()
        .from(mailCalendarCommitmentIntakes)
        .where(eq(mailCalendarCommitmentIntakes.remoteMessageId, "INBOX:101:7")),
    ).resolves.toEqual([
      expect.objectContaining({
        evidenceKind: "calendar_attachment_metadata",
        sourceMessageRevision: "101:7",
      }),
    ]);
    await expect(
      database.db
        .select()
        .from(calendarAccounts)
        .where(eq(calendarAccounts.id, connected.accountId)),
    ).resolves.toEqual([
      expect.objectContaining({
        mailEnabled: true,
        syncClaimId: null,
        syncStatus: "idle",
      }),
    ]);
  });

  it("demotes an active Calendar profile when its default destination becomes read-only", async () => {
    const [profileUser] = await database.db
      .insert(users)
      .values({
        displayName: "Calendar capability",
        email: "calendar-capability@example.com",
        passwordHash: "unused",
        planningTimezone: "UTC",
      })
      .returning();
    if (!profileUser) throw new Error("Calendar capability user was not created.");
    vi.mocked(google.getProfile).mockResolvedValueOnce({
      credentials,
      value: {
        email: "calendar-capability@example.com",
        id: "calendar-capability-provider",
        name: "Calendar Capability",
      },
    });
    const url = await service.startGoogleAuthorization(profileUser.id, {
      returnTo: "/settings?section=connections",
      services: ["calendar"],
    });
    await service.completeGoogleAuthorization(
      String(new URL(url).searchParams.get("state")),
      "calendar-capability-code",
    );
    const [account] = await service.listAccounts(profileUser.id);
    if (!account) throw new Error("Calendar capability account was not created.");
    vi.mocked(google.listCalendars).mockResolvedValueOnce({
      credentials,
      value: [
        {
          accessRole: "owner",
          color: null,
          id: "calendar-capability-primary",
          name: "Capability primary",
          primary: true,
          selected: true,
          timezone: "UTC",
          writable: true,
        },
      ],
    });
    await service.syncAccount(profileUser.id, account.id);
    const [defaultCalendar] = await database.db
      .select()
      .from(calendars)
      .where(eq(calendars.accountId, account.id));
    if (!defaultCalendar) throw new Error("Calendar capability destination was not created.");
    const [profile] = await database.db
      .insert(domainProfiles)
      .values({
        categories: [],
        domain: "calendar",
        instructions: [],
        objective: "Use the connected destination.",
        preferences: {
          afterBufferMinutes: 0,
          automaticEventCreation: false,
          automaticEventEvidence: [],
          beforeBufferMinutes: 0,
          busyBlockPrivacy: "busy",
          defaultCalendarId: defaultCalendar.id,
          defaultTimezone: "UTC",
        },
        sourceContexts: [
          {
            notes: null,
            purpose: "Connected commitments",
            sourceId: defaultCalendar.id,
            sourceLabel: defaultCalendar.name,
          },
        ],
        status: "active",
        summary: "Use the connected destination.",
        userId: profileUser.id,
      })
      .returning();
    if (!profile) throw new Error("Calendar capability profile was not created.");
    vi.mocked(google.listCalendars).mockResolvedValueOnce({
      credentials,
      value: [
        {
          accessRole: "reader",
          color: null,
          id: "calendar-capability-primary",
          name: "Capability primary",
          primary: true,
          selected: true,
          timezone: "UTC",
          writable: false,
        },
      ],
    });
    await service.syncAccount(profileUser.id, account.id);
    await expect(
      database.db.select().from(domainProfiles).where(eq(domainProfiles.id, profile.id)),
    ).resolves.toEqual([
      expect.objectContaining({
        sourceContexts: profile.sourceContexts,
        status: "draft",
        version: 2,
      }),
    ]);

    vi.mocked(google.listCalendars).mockResolvedValueOnce({
      credentials,
      value: [
        {
          accessRole: "reader",
          color: null,
          id: "calendar-capability-primary",
          name: "Capability primary",
          primary: true,
          selected: true,
          timezone: "UTC",
          writable: false,
        },
      ],
    });
    await service.syncAccount(profileUser.id, account.id);
    await expect(
      database.db.select().from(domainProfiles).where(eq(domainProfiles.id, profile.id)),
    ).resolves.toEqual([
      expect.objectContaining({
        sourceContexts: profile.sourceContexts,
        status: "draft",
        version: 2,
      }),
    ]);

    vi.mocked(google.listCalendars).mockResolvedValueOnce({
      credentials,
      value: [
        {
          accessRole: "owner",
          color: null,
          id: "calendar-capability-primary",
          name: "Capability primary",
          primary: true,
          selected: true,
          timezone: "UTC",
          writable: true,
        },
      ],
    });
    await service.syncAccount(profileUser.id, account.id);
    await database.db
      .update(domainProfiles)
      .set({ status: "active", version: 3 })
      .where(eq(domainProfiles.id, profile.id));
    vi.mocked(google.listCalendars).mockResolvedValueOnce({
      credentials,
      value: [],
    });
    await service.syncAccount(profileUser.id, account.id);
    await expect(
      database.db.select().from(domainProfiles).where(eq(domainProfiles.id, profile.id)),
    ).resolves.toEqual([
      expect.objectContaining({
        sourceContexts: [],
        status: "draft",
        version: 4,
      }),
    ]);
    await expect(
      database.db.select().from(calendars).where(eq(calendars.id, defaultCalendar.id)),
    ).resolves.toEqual([expect.objectContaining({ deletedAt: timestamp })]);
  });

  it("rejects unknown accounts and only disconnects external accounts", async () => {
    await expect(service.syncAccount(userId, crypto.randomUUID())).rejects.toMatchObject({
      code: "not_found",
    });
    await expect(service.disconnect(userId, crypto.randomUUID())).rejects.toMatchObject({
      code: "not_found",
    });
    const [local] = await database.db
      .select()
      .from(calendarAccounts)
      .where(eq(calendarAccounts.providerAccountId, "local-domain"));
    if (!local) throw new Error("Local account fixture is missing.");
    await expect(service.disconnect(userId, local.id)).rejects.toMatchObject({ code: "not_found" });

    const [external] = await database.db
      .select()
      .from(calendarAccounts)
      .where(
        and(
          eq(calendarAccounts.userId, userId),
          eq(calendarAccounts.providerAccountId, "google-person"),
        ),
      );
    if (!external) throw new Error("External account fixture is missing.");
    const [defaultCalendar] = await database.db
      .select()
      .from(calendars)
      .where(
        and(eq(calendars.accountId, external.id), eq(calendars.remoteCalendarId, "remote-primary")),
      );
    if (!defaultCalendar) throw new Error("External Calendar profile fixture is missing.");
    const [calendarProfile] = await database.db
      .insert(domainProfiles)
      .values({
        categories: [],
        domain: "calendar",
        instructions: ["Keep connected commitments accurate."],
        objective: "Use the connected primary calendar.",
        preferences: {
          afterBufferMinutes: 0,
          automaticEventCreation: false,
          automaticEventEvidence: [],
          beforeBufferMinutes: 0,
          busyBlockPrivacy: "busy",
          defaultCalendarId: defaultCalendar.id,
          defaultTimezone: "UTC",
        },
        sourceContexts: [
          {
            notes: null,
            purpose: "Connected commitments",
            sourceId: defaultCalendar.id,
            sourceLabel: defaultCalendar.name,
          },
        ],
        status: "active",
        summary: "Connected primary is the default.",
        userId,
      })
      .returning();
    if (!calendarProfile) throw new Error("Calendar profile fixture was not created.");
    await expect(service.disconnect(userId, external.id)).resolves.toBeUndefined();
    expect((await service.listAccounts(userId)).some((value) => value.id === external.id)).toBe(
      false,
    );
    await expect(
      database.db.select().from(domainProfiles).where(eq(domainProfiles.id, calendarProfile.id)),
    ).resolves.toEqual([
      expect.objectContaining({
        sourceContexts: [],
        status: "draft",
        version: 2,
      }),
    ]);
  });

  it("executes due Mail work once after the conversation leaves the bounded sync page", async () => {
    await database.db.delete(mailRuleWorkItems);
    const fixture = await createDurableMailWorkFixture("Durable archive", {
      afterDays: 1,
      mailboxId: null,
      type: "archive",
    });
    const updateMailThread = vi.mocked(
      google.updateMailThread as NonNullable<GoogleConnector["updateMailThread"]>,
    );
    updateMailThread.mockClear();
    updateMailThread.mockResolvedValue(rotatedCredentials);
    const [existingRunSummary] = await database.db
      .insert(attentionItems)
      .values({
        domain: "mail",
        importance: "normal",
        kind: "run_summary",
        relatedEntityId: fixture.account.id,
        relatedEntityType: "mail_account",
        status: "open",
        summary: "Prior durable Mail status.",
        title: "Prior Mail automation status",
        userId: fixture.user.id,
      })
      .returning();
    if (!existingRunSummary) throw new Error("Existing run summary was not created.");

    const overlappingRuns = await Promise.all([
      service.dispatchDueMailRuleWork(),
      service.dispatchDueMailRuleWork(),
    ]);
    expect(overlappingRuns.reduce((total, result) => total + result.claimed, 0)).toBe(1);
    expect(overlappingRuns.reduce((total, result) => total + result.succeeded, 0)).toBe(1);
    expect(updateMailThread).toHaveBeenCalledTimes(1);
    expect(updateMailThread).toHaveBeenCalledWith(
      expect.any(Object),
      fixture.thread.remoteThreadId,
      { addMailboxIds: [], removeMailboxIds: ["INBOX"] },
    );
    await expect(service.dispatchDueMailRuleWork()).resolves.toEqual({
      claimed: 0,
      failed: 0,
      pending: 0,
      reconciliation: 0,
      succeeded: 0,
    });
    expect(updateMailThread).toHaveBeenCalledTimes(1);
    await expect(
      database.db.select().from(mailRuleWorkItems).where(eq(mailRuleWorkItems.id, fixture.work.id)),
    ).resolves.toEqual([
      expect.objectContaining({
        attemptCount: 1,
        completedAt: timestamp,
        providerEffect: "applied",
        status: "succeeded",
      }),
    ]);
    await expect(
      database.db.select().from(mailThreads).where(eq(mailThreads.id, fixture.thread.id)),
    ).resolves.toEqual([expect.objectContaining({ remoteMailboxIds: ["UNREAD"] })]);
    await expect(
      database.db
        .select({ status: attentionItems.status })
        .from(attentionItems)
        .where(eq(attentionItems.id, existingRunSummary.id)),
    ).resolves.toEqual([{ status: "resolved" }]);
  });

  it("releases Mail work claimed while quiescing before any provider effect", async () => {
    await database.db.delete(mailRuleWorkItems);
    const fixture = await createDurableMailWorkFixture("Quiesce claim", {
      afterDays: 1,
      mailboxId: null,
      type: "archive",
    });
    const updateMailThread = vi.mocked(
      google.updateMailThread as NonNullable<GoogleConnector["updateMailThread"]>,
    );
    updateMailThread.mockClear();
    const controller = new AbortController();
    const quiescingService = createConnectorService({
      db: database.db,
      encryptionKey,
      google,
      icloud,
      now: () => timestamp,
      shutdown: {
        deadlineMs: () => timestamp.getTime() + 105_000,
        signal: controller.signal,
      },
    });
    const lockClient = await database.pool.connect();
    const interruption = new Error("API runtime is quiescing.");
    let dispatch: Promise<unknown> | undefined;
    let transactionOpen = false;
    try {
      await lockClient.query("BEGIN");
      transactionOpen = true;
      await lockClient.query("LOCK TABLE mail_rule_work_items IN ACCESS EXCLUSIVE MODE");
      dispatch = quiescingService.dispatchDueMailRuleWork();
      await expect(waitForMailRuleWorkLock()).resolves.toBe(true);
      controller.abort(interruption);
      await lockClient.query("COMMIT");
      transactionOpen = false;
      await expect(dispatch).rejects.toBe(interruption);
    } finally {
      if (transactionOpen) await lockClient.query("ROLLBACK");
      lockClient.release();
      if (dispatch) await dispatch.catch(() => undefined);
    }
    expect(updateMailThread).not.toHaveBeenCalled();
    await expect(
      database.db.select().from(mailRuleWorkItems).where(eq(mailRuleWorkItems.id, fixture.work.id)),
    ).resolves.toEqual([
      expect.objectContaining({
        attemptCount: 0,
        claimId: null,
        claimedAt: null,
        claimMode: null,
        status: "pending",
      }),
    ]);
  });

  it("claims at most six due conversations per scheduled Mail run", async () => {
    await database.db.delete(mailRuleWorkItems);
    const fixture = await createDurableMailWorkFixture("Bounded archive", {
      afterDays: 1,
      mailboxId: null,
      type: "archive",
    });
    const additionalThreads = await database.db
      .insert(mailThreads)
      .values(
        Array.from({ length: 6 }, (_, index) => ({
          accountId: fixture.account.id,
          bodyText: "Routine receipt",
          from: { address: "orders@example.com", name: "Orders" },
          provider: "google" as const,
          receivedAt: new Date(timestamp.getTime() - 2 * 86_400_000),
          remoteMailboxIds: ["INBOX", "UNREAD"],
          remoteThreadId: `thread-bounded-archive-${index}`,
          snippet: "Routine receipt",
          starred: false,
          subject: `Routine bounded archive ${index}`,
          to: [],
          unread: true,
          userId: fixture.user.id,
        })),
      )
      .returning();
    await database.db.insert(mailRuleWorkItems).values(
      additionalThreads.map((thread) => ({
        accountId: fixture.account.id,
        action: fixture.work.action,
        actionFingerprint: fixture.work.actionFingerprint,
        dueAt: fixture.work.dueAt,
        nextAttemptAt: fixture.work.nextAttemptAt,
        profileId: fixture.profile.id,
        profileVersion: fixture.profile.version,
        remoteThreadId: thread.remoteThreadId,
        ruleId: fixture.rule.id,
        ruleVersion: fixture.rule.version,
        sourceUpdatedAt: thread.updatedAt,
        threadId: thread.id,
        userId: fixture.user.id,
      })),
    );
    const updateMailThread = vi.mocked(
      google.updateMailThread as NonNullable<GoogleConnector["updateMailThread"]>,
    );
    updateMailThread.mockReset();
    updateMailThread.mockResolvedValue(rotatedCredentials);

    await expect(service.dispatchDueMailRuleWork()).resolves.toMatchObject({
      claimed: 6,
      succeeded: 6,
    });
    expect(updateMailThread).toHaveBeenCalledTimes(6);
    await expect(
      database.db
        .select({ count: sql<number>`count(*)::int` })
        .from(mailRuleWorkItems)
        .where(eq(mailRuleWorkItems.status, "pending")),
    ).resolves.toEqual([{ count: 1 }]);
    await expect(service.dispatchDueMailRuleWork()).resolves.toMatchObject({
      claimed: 1,
      succeeded: 1,
    });
    expect(updateMailThread).toHaveBeenCalledTimes(7);
  });

  it("moves one-day cleanup work to recoverable Trash without permanent deletion", async () => {
    await database.db.delete(mailRuleWorkItems);
    const fixture = await createDurableMailWorkFixture("One day Trash", {
      afterDays: 1,
      mailboxId: null,
      type: "trash",
    });
    const trashMailThread = vi.mocked(
      google.trashMailThread as NonNullable<GoogleConnector["trashMailThread"]>,
    );
    const updateMailThread = vi.mocked(
      google.updateMailThread as NonNullable<GoogleConnector["updateMailThread"]>,
    );
    trashMailThread.mockReset();
    trashMailThread.mockResolvedValue(rotatedCredentials);
    updateMailThread.mockClear();

    await expect(service.dispatchDueMailRuleWork()).resolves.toMatchObject({
      claimed: 1,
      succeeded: 1,
    });
    expect(trashMailThread).toHaveBeenCalledOnce();
    expect(trashMailThread).toHaveBeenCalledWith(expect.any(Object), fixture.thread.remoteThreadId);
    expect(updateMailThread).not.toHaveBeenCalled();
    await expect(
      database.db.select().from(mailThreads).where(eq(mailThreads.id, fixture.thread.id)),
    ).resolves.toEqual([expect.objectContaining({ remoteMailboxIds: ["UNREAD", "TRASH"] })]);
  });

  it("isolates due work from different rules on the same conversation", async () => {
    await database.db.delete(mailRuleWorkItems);
    const fixture = await createDurableMailWorkFixture("Isolated Trash rule", {
      afterDays: 1,
      mailboxId: null,
      type: "trash",
    });
    const delayedRead = { afterDays: 1, mailboxId: null, type: "mark_read" as const };
    const [readRule] = await database.db
      .insert(mailRules)
      .values({
        actions: [delayedRead],
        condition: { field: "subject", operator: "contains", value: "routine" },
        enabled: true,
        name: "Isolated delayed read rule",
        policy: "approved_rule",
        profileId: fixture.profile.id,
        sourceAccountIds: [fixture.account.id],
        userId: fixture.user.id,
      })
      .returning();
    if (!readRule) throw new Error("Second isolated Mail rule was not created.");
    await database.db.insert(mailRuleWorkItems).values({
      accountId: fixture.account.id,
      action: delayedRead,
      actionFingerprint: durableMailRuleActionFingerprint(delayedRead),
      dueAt: fixture.work.dueAt,
      nextAttemptAt: fixture.work.nextAttemptAt,
      profileId: fixture.profile.id,
      profileVersion: fixture.profile.version,
      remoteThreadId: fixture.thread.remoteThreadId,
      ruleId: readRule.id,
      ruleVersion: readRule.version,
      sourceUpdatedAt: fixture.thread.updatedAt,
      threadId: fixture.thread.id,
      userId: fixture.user.id,
    });
    const trashMailThread = vi.mocked(
      google.trashMailThread as NonNullable<GoogleConnector["trashMailThread"]>,
    );
    const updateMailThread = vi.mocked(
      google.updateMailThread as NonNullable<GoogleConnector["updateMailThread"]>,
    );
    trashMailThread.mockReset();
    trashMailThread.mockResolvedValue(rotatedCredentials);
    updateMailThread.mockReset();
    updateMailThread.mockResolvedValue(rotatedCredentials);

    const firstRun = await service.dispatchDueMailRuleWork();
    const secondRun = await service.dispatchDueMailRuleWork();
    expect(firstRun).toMatchObject({ claimed: 1, succeeded: 1 });
    expect(secondRun).toMatchObject({ claimed: 1, succeeded: 1 });
    expect(trashMailThread).toHaveBeenCalledOnce();
    expect(updateMailThread).toHaveBeenCalledOnce();
    await expect(
      database.db
        .select({ status: mailRuleWorkItems.status })
        .from(mailRuleWorkItems)
        .where(eq(mailRuleWorkItems.accountId, fixture.account.id)),
    ).resolves.toEqual([{ status: "succeeded" }, { status: "succeeded" }]);
  });

  it("coalesces delayed star and owned custom-label work for one rule", async () => {
    await database.db.delete(mailRuleWorkItems);
    const starAction = { afterDays: 1, mailboxId: null, type: "star" as const };
    const fixture = await createDurableMailWorkFixture("Delayed signal markers", starAction);
    const [label] = await database.db
      .insert(mailboxes)
      .values({
        accountId: fixture.account.id,
        name: "Orders",
        provider: "google",
        remoteMailboxId: "Label_Orders",
        role: "custom",
        userId: fixture.user.id,
      })
      .returning();
    if (!label) throw new Error("Custom Mail label was not created.");
    const labelAction = { afterDays: 1, mailboxId: label.id, type: "add_label" as const };
    await database.db
      .update(mailRules)
      .set({ actions: [starAction, labelAction] })
      .where(eq(mailRules.id, fixture.rule.id));
    await database.db.insert(mailRuleWorkItems).values({
      accountId: fixture.account.id,
      action: labelAction,
      actionFingerprint: durableMailRuleActionFingerprint(labelAction),
      dueAt: fixture.work.dueAt,
      nextAttemptAt: fixture.work.nextAttemptAt,
      profileId: fixture.profile.id,
      profileVersion: fixture.profile.version,
      remoteThreadId: fixture.thread.remoteThreadId,
      ruleId: fixture.rule.id,
      ruleVersion: fixture.rule.version,
      sourceUpdatedAt: fixture.thread.updatedAt,
      threadId: fixture.thread.id,
      userId: fixture.user.id,
    });
    const updateMailThread = vi.mocked(
      google.updateMailThread as NonNullable<GoogleConnector["updateMailThread"]>,
    );
    updateMailThread.mockReset();
    updateMailThread.mockResolvedValue(rotatedCredentials);

    await expect(service.dispatchDueMailRuleWork()).resolves.toMatchObject({
      claimed: 2,
      succeeded: 2,
    });
    expect(updateMailThread).toHaveBeenCalledOnce();
    expect(updateMailThread).toHaveBeenCalledWith(
      expect.any(Object),
      fixture.thread.remoteThreadId,
      {
        addMailboxIds: expect.arrayContaining(["STARRED", "Label_Orders"]),
        removeMailboxIds: [],
      },
    );
    await expect(
      database.db.select().from(mailThreads).where(eq(mailThreads.id, fixture.thread.id)),
    ).resolves.toEqual([
      expect.objectContaining({
        remoteMailboxIds: expect.arrayContaining(["INBOX", "UNREAD", "Label_Orders"]),
        starred: true,
      }),
    ]);
  });

  it("executes durable Mail work for two independent accounts concurrently", async () => {
    await database.db.delete(mailRuleWorkItems);
    const first = await createDurableMailWorkFixture("Concurrent archive one", {
      afterDays: 1,
      mailboxId: null,
      type: "archive",
    });
    const second = await createDurableMailWorkFixture("Concurrent archive two", {
      afterDays: 1,
      mailboxId: null,
      type: "archive",
    });
    const updateMailThread = vi.mocked(
      google.updateMailThread as NonNullable<GoogleConnector["updateMailThread"]>,
    );
    let activeWrites = 0;
    let maximumWrites = 0;
    let releaseWrites: (() => void) | undefined;
    const heldWrites = new Promise<void>((resolveWrites) => {
      releaseWrites = resolveWrites;
    });
    updateMailThread.mockReset();
    updateMailThread.mockImplementation(async () => {
      activeWrites += 1;
      maximumWrites = Math.max(maximumWrites, activeWrites);
      await heldWrites;
      activeWrites -= 1;
      return rotatedCredentials;
    });

    const dispatch = service.dispatchDueMailRuleWork();
    try {
      await vi.waitFor(() => expect(updateMailThread).toHaveBeenCalledTimes(2));
      expect(maximumWrites).toBe(2);
      await expect(
        database.db
          .select({ accountId: mailRuleWorkItems.accountId, status: mailRuleWorkItems.status })
          .from(mailRuleWorkItems)
          .where(inArray(mailRuleWorkItems.accountId, [first.account.id, second.account.id])),
      ).resolves.toEqual(
        expect.arrayContaining([
          { accountId: first.account.id, status: "claimed" },
          { accountId: second.account.id, status: "claimed" },
        ]),
      );
    } finally {
      releaseWrites?.();
    }
    await expect(dispatch).resolves.toMatchObject({ claimed: 2, succeeded: 2 });
    expect(maximumWrites).toBe(2);
    updateMailThread.mockResolvedValue(rotatedCredentials);
  });

  it("reconciles a stale pre-restart claim by exact provider state without replaying Trash", async () => {
    await database.db.delete(mailRuleWorkItems);
    const fixture = await createDurableMailWorkFixture("Stale Trash claim", {
      afterDays: 1,
      mailboxId: null,
      type: "trash",
    });
    await database.db
      .update(mailRuleWorkItems)
      .set({
        claimId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        claimedAt: new Date(timestamp.getTime() - 20 * 60_000),
        claimMode: "execute",
        status: "claimed",
      })
      .where(eq(mailRuleWorkItems.id, fixture.work.id));
    const getMailThreadState = vi.mocked(
      google.getMailThreadState as NonNullable<GoogleConnector["getMailThreadState"]>,
    );
    const trashMailThread = vi.mocked(
      google.trashMailThread as NonNullable<GoogleConnector["trashMailThread"]>,
    );
    getMailThreadState.mockClear();
    trashMailThread.mockClear();
    getMailThreadState.mockResolvedValue({
      credentials: rotatedCredentials,
      value: {
        mailboxIds: ["TRASH"],
        remoteThreadId: fixture.thread.remoteThreadId,
        starred: false,
        unread: false,
      },
    });

    const restartedService = createConnectorService({
      db: database.db,
      encryptionKey,
      google,
      icloud,
      now: () => timestamp,
    });
    await expect(restartedService.dispatchDueMailRuleWork()).resolves.toMatchObject({
      claimed: 1,
      succeeded: 1,
    });
    expect(getMailThreadState).toHaveBeenCalledTimes(1);
    expect(trashMailThread).not.toHaveBeenCalled();
    await expect(
      database.db.select().from(mailRuleWorkItems).where(eq(mailRuleWorkItems.id, fixture.work.id)),
    ).resolves.toEqual([
      expect.objectContaining({
        attemptCount: 1,
        lastErrorCode: null,
        providerEffect: "applied",
        status: "succeeded",
      }),
    ]);
  });

  it("fails an exhausted stale claim terminally instead of stranding reconciliation", async () => {
    await database.db.delete(mailRuleWorkItems);
    const fixture = await createDurableMailWorkFixture("Exhausted stale claim", {
      afterDays: 1,
      mailboxId: null,
      type: "archive",
    });
    await database.db
      .update(mailRuleWorkItems)
      .set({
        attemptCount: 5,
        claimId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        claimedAt: new Date(timestamp.getTime() - 20 * 60_000),
        claimMode: "execute",
        status: "claimed",
      })
      .where(eq(mailRuleWorkItems.id, fixture.work.id));
    const getMailThreadState = vi.mocked(
      google.getMailThreadState as NonNullable<GoogleConnector["getMailThreadState"]>,
    );
    const updateMailThread = vi.mocked(
      google.updateMailThread as NonNullable<GoogleConnector["updateMailThread"]>,
    );
    getMailThreadState.mockClear();
    updateMailThread.mockClear();

    await expect(service.dispatchDueMailRuleWork()).resolves.toEqual({
      claimed: 0,
      failed: 1,
      pending: 0,
      reconciliation: 0,
      succeeded: 0,
    });
    expect(getMailThreadState).not.toHaveBeenCalled();
    expect(updateMailThread).not.toHaveBeenCalled();
    await expect(
      database.db.select().from(mailRuleWorkItems).where(eq(mailRuleWorkItems.id, fixture.work.id)),
    ).resolves.toEqual([
      expect.objectContaining({
        attemptCount: 5,
        completedAt: timestamp,
        lastErrorCode: "stale_claim_exhausted",
        providerEffect: "indeterminate",
        status: "failed",
      }),
    ]);
  });

  it("handles exact-read rejection and revoked authorization during reconciliation", async () => {
    await database.db.delete(mailRuleWorkItems);
    const missingProviderSource = await createDurableMailWorkFixture(
      "Exact read missing provider source",
      {
        afterDays: 1,
        mailboxId: null,
        type: "archive",
      },
    );
    await database.db
      .update(mailRuleWorkItems)
      .set({
        claimId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
        claimedAt: new Date(timestamp.getTime() - 20 * 60_000),
        claimMode: "execute",
        status: "claimed",
      })
      .where(eq(mailRuleWorkItems.id, missingProviderSource.work.id));
    const getMailThreadState = vi.mocked(
      google.getMailThreadState as NonNullable<GoogleConnector["getMailThreadState"]>,
    );
    const updateMailThread = vi.mocked(
      google.updateMailThread as NonNullable<GoogleConnector["updateMailThread"]>,
    );
    getMailThreadState.mockReset();
    getMailThreadState.mockRejectedValueOnce(connectorError("Not found", 404));
    updateMailThread.mockClear();
    await expect(service.dispatchDueMailRuleWork()).resolves.toMatchObject({
      claimed: 1,
      failed: 1,
    });
    expect(updateMailThread).not.toHaveBeenCalled();
    await expect(
      database.db
        .select()
        .from(mailRuleWorkItems)
        .where(eq(mailRuleWorkItems.id, missingProviderSource.work.id)),
    ).resolves.toEqual([
      expect.objectContaining({
        lastErrorCode: "provider_source_missing",
        providerEffect: "indeterminate",
        status: "failed",
      }),
    ]);

    await database.db.delete(mailRuleWorkItems);
    const changedAuthorization = await createDurableMailWorkFixture(
      "Reconciliation authorization drift",
      {
        afterDays: 1,
        mailboxId: null,
        type: "archive",
      },
    );
    await database.db
      .update(mailRuleWorkItems)
      .set({ providerEffect: "indeterminate", status: "reconcile" })
      .where(eq(mailRuleWorkItems.id, changedAuthorization.work.id));
    getMailThreadState.mockReset();
    getMailThreadState.mockImplementationOnce(async (_credentials, remoteThreadId) => {
      await database.db
        .update(mailRules)
        .set({
          enabled: false,
          policy: "preview",
          version: changedAuthorization.rule.version + 1,
        })
        .where(eq(mailRules.id, changedAuthorization.rule.id));
      return {
        credentials: rotatedCredentials,
        value: {
          mailboxIds: ["INBOX", "UNREAD"],
          remoteThreadId,
          starred: false,
          unread: true,
        },
      };
    });
    await expect(service.dispatchDueMailRuleWork()).resolves.toMatchObject({
      claimed: 1,
      failed: 1,
    });
    expect(updateMailThread).not.toHaveBeenCalled();
    await expect(
      database.db
        .select()
        .from(mailRuleWorkItems)
        .where(eq(mailRuleWorkItems.id, changedAuthorization.work.id)),
    ).resolves.toEqual([
      expect.objectContaining({
        lastErrorCode: "authorization_changed",
        providerEffect: "indeterminate",
        status: "failed",
      }),
    ]);
  });

  it("backs off rejected work and reconciles an indeterminate provider timeout", async () => {
    await database.db.delete(mailRuleWorkItems);
    const fixture = await createDurableMailWorkFixture("Retry archive", {
      afterDays: 1,
      mailboxId: null,
      type: "archive",
    });
    const updateMailThread = vi.mocked(
      google.updateMailThread as NonNullable<GoogleConnector["updateMailThread"]>,
    );
    const getMailThreadState = vi.mocked(
      google.getMailThreadState as NonNullable<GoogleConnector["getMailThreadState"]>,
    );
    updateMailThread.mockReset();
    updateMailThread.mockRejectedValueOnce(connectorError("Rate limited", 429));
    const [existingRunSummary] = await database.db
      .insert(attentionItems)
      .values({
        domain: "mail",
        importance: "normal",
        kind: "run_summary",
        relatedEntityId: fixture.account.id,
        relatedEntityType: "mail_account",
        status: "open",
        summary: "Prior durable Mail status.",
        title: "Prior Mail automation status",
        userId: fixture.user.id,
      })
      .returning();
    if (!existingRunSummary) throw new Error("Existing run summary was not created.");

    await expect(service.dispatchDueMailRuleWork()).resolves.toMatchObject({
      claimed: 1,
      pending: 1,
    });
    await expect(
      database.db.select().from(mailRuleWorkItems).where(eq(mailRuleWorkItems.id, fixture.work.id)),
    ).resolves.toEqual([
      expect.objectContaining({
        attemptCount: 1,
        lastErrorCode: "provider_rate_limited",
        providerEffect: "rejected",
        status: "pending",
      }),
    ]);
    await expect(
      database.db.select().from(attentionItems).where(eq(attentionItems.id, existingRunSummary.id)),
    ).resolves.toEqual([
      expect.objectContaining({
        status: "open",
        title: "Mail automation has pending work",
        version: 2,
      }),
    ]);
    await expect(
      database.db
        .select()
        .from(auditEvents)
        .where(
          and(
            eq(auditEvents.entityId, existingRunSummary.id),
            eq(auditEvents.action, "assistant.attention.updated"),
          ),
        ),
    ).resolves.toEqual([
      expect.objectContaining({
        actorId: fixture.account.id,
        actorType: "connector",
        after: expect.objectContaining({
          execution: "background_dispatch",
          policy: "approved_rule",
          version: 2,
        }),
        requestId: expect.stringMatching(/^mail-rule-work-attention:[0-9a-f-]{36}$/),
      }),
    ]);

    await database.db
      .update(mailRuleWorkItems)
      .set({ nextAttemptAt: timestamp })
      .where(eq(mailRuleWorkItems.id, fixture.work.id));
    updateMailThread.mockRejectedValueOnce(connectorError("Timed out", 408));
    await expect(service.dispatchDueMailRuleWork()).resolves.toMatchObject({
      claimed: 1,
      reconciliation: 1,
    });
    await expect(
      database.db.select().from(mailRuleWorkItems).where(eq(mailRuleWorkItems.id, fixture.work.id)),
    ).resolves.toEqual([
      expect.objectContaining({
        attemptCount: 2,
        lastErrorCode: "provider_effect_indeterminate",
        providerEffect: "indeterminate",
        status: "reconcile",
      }),
    ]);

    await database.db
      .update(mailRuleWorkItems)
      .set({ nextAttemptAt: timestamp })
      .where(eq(mailRuleWorkItems.id, fixture.work.id));
    getMailThreadState.mockResolvedValueOnce({
      credentials: rotatedCredentials,
      value: {
        mailboxIds: ["UNREAD"],
        remoteThreadId: fixture.thread.remoteThreadId,
        starred: false,
        unread: true,
      },
    });
    await expect(service.dispatchDueMailRuleWork()).resolves.toMatchObject({
      claimed: 1,
      succeeded: 1,
    });
    expect(updateMailThread).toHaveBeenCalledTimes(2);
    await expect(
      database.db.select().from(attentionItems).where(eq(attentionItems.id, existingRunSummary.id)),
    ).resolves.toEqual([expect.objectContaining({ status: "resolved", version: 4 })]);
    await expect(
      database.db
        .select()
        .from(auditEvents)
        .where(
          and(
            eq(auditEvents.entityId, existingRunSummary.id),
            eq(auditEvents.action, "assistant.attention.resolved"),
          ),
        ),
    ).resolves.toHaveLength(1);
  });

  it("fails provider 404 work terminally without replay", async () => {
    await database.db.delete(mailRuleWorkItems);
    const fixture = await createDurableMailWorkFixture("Missing provider thread", {
      afterDays: 1,
      mailboxId: null,
      type: "archive",
    });
    const updateMailThread = vi.mocked(
      google.updateMailThread as NonNullable<GoogleConnector["updateMailThread"]>,
    );
    updateMailThread.mockReset();
    updateMailThread.mockRejectedValueOnce(connectorError("Not found", 404));

    await expect(service.dispatchDueMailRuleWork()).resolves.toMatchObject({
      claimed: 1,
      failed: 1,
    });
    await expect(service.dispatchDueMailRuleWork()).resolves.toEqual({
      claimed: 0,
      failed: 0,
      pending: 0,
      reconciliation: 0,
      succeeded: 0,
    });
    expect(updateMailThread).toHaveBeenCalledTimes(1);
    await expect(
      database.db.select().from(mailRuleWorkItems).where(eq(mailRuleWorkItems.id, fixture.work.id)),
    ).resolves.toEqual([
      expect.objectContaining({
        lastErrorCode: "provider_source_missing",
        providerEffect: "rejected",
        status: "failed",
      }),
    ]);
    const mail = createMailService({
      db: database.db,
      gateway: service.mailGateway,
      now: () => timestamp,
      reviewSigningKey: "durable-mail-status-review-key",
    });
    await expect(mail.listSetupContext(fixture.user.id)).resolves.toMatchObject({
      accounts: [
        expect.objectContaining({
          accountId: fixture.account.id,
          automation: expect.objectContaining({ failedCount: 1 }),
        }),
      ],
      automation: {
        executionLimitPerRun: 6,
        failedCount: 1,
        inProgressCount: 0,
        lastCompletedAt: timestamp.toISOString(),
        oldestDueAt: null,
        pendingCount: 0,
        reconciliationCount: 0,
      },
      commitmentIntake: {
        automaticCreationEnabled: false,
        serverVerifiedCount: 0,
      },
    });
    await expect(
      database.db
        .select()
        .from(attentionItems)
        .where(
          and(
            eq(attentionItems.relatedEntityId, fixture.account.id),
            eq(attentionItems.kind, "run_summary"),
            eq(attentionItems.status, "open"),
          ),
        ),
    ).resolves.toEqual([
      expect.objectContaining({
        summary:
          "0 durable Mail actions are pending; 0 require exact provider reconciliation; 1 stopped safely and need rule, source, or connection review.",
        title: "Mail automation needs review",
      }),
    ]);
    const [createdRunSummary] = await database.db
      .select()
      .from(attentionItems)
      .where(
        and(
          eq(attentionItems.relatedEntityId, fixture.account.id),
          eq(attentionItems.kind, "run_summary"),
        ),
      )
      .limit(1);
    if (!createdRunSummary) throw new Error("Created Mail run summary was not found.");
    await expect(
      database.db
        .select()
        .from(auditEvents)
        .where(
          and(
            eq(auditEvents.entityId, createdRunSummary.id),
            eq(auditEvents.action, "assistant.attention.created"),
          ),
        ),
    ).resolves.toEqual([
      expect.objectContaining({
        actorId: fixture.account.id,
        actorType: "connector",
        after: expect.objectContaining({
          execution: "background_dispatch",
          policy: "approved_rule",
          version: 1,
        }),
      }),
    ]);
  });

  it("rolls back a connector-managed run summary when its audit cannot be written", async () => {
    await database.db.delete(mailRuleWorkItems);
    const fixture = await createDurableMailWorkFixture("Atomic run summary", {
      afterDays: 1,
      mailboxId: null,
      type: "archive",
    });
    const secondFixture = await createDurableMailWorkFixture("Independent run summary", {
      afterDays: 1,
      mailboxId: null,
      type: "archive",
    });
    const updateMailThread = vi.mocked(
      google.updateMailThread as NonNullable<GoogleConnector["updateMailThread"]>,
    );
    updateMailThread.mockReset();
    updateMailThread.mockRejectedValueOnce(connectorError("Not found", 404));
    updateMailThread.mockRejectedValueOnce(connectorError("Not found", 404));
    await database.pool.query(`
      CREATE OR REPLACE FUNCTION fail_background_attention_audit_for_test() RETURNS trigger AS $$
      BEGIN
        IF NEW.request_id LIKE 'mail-rule-work-attention:%'
          AND NEW.actor_id = '${fixture.account.id}' THEN
          RAISE EXCEPTION 'forced background attention audit failure';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
      CREATE TRIGGER fail_background_attention_audit_for_test
      BEFORE INSERT ON audit_events
      FOR EACH ROW EXECUTE FUNCTION fail_background_attention_audit_for_test();
    `);
    try {
      await expect(service.dispatchDueMailRuleWork()).rejects.toThrow(
        'Failed query: insert into "audit_events"',
      );
    } finally {
      await database.pool.query(`
        DROP TRIGGER IF EXISTS fail_background_attention_audit_for_test ON audit_events;
        DROP FUNCTION IF EXISTS fail_background_attention_audit_for_test();
      `);
    }
    await expect(
      database.db
        .select()
        .from(attentionItems)
        .where(
          and(
            eq(attentionItems.relatedEntityId, fixture.account.id),
            eq(attentionItems.kind, "run_summary"),
          ),
        ),
    ).resolves.toEqual([]);
    await expect(
      database.db
        .select()
        .from(attentionItems)
        .where(
          and(
            eq(attentionItems.relatedEntityId, secondFixture.account.id),
            eq(attentionItems.kind, "run_summary"),
            eq(attentionItems.status, "open"),
          ),
        ),
    ).resolves.toEqual([expect.objectContaining({ importance: "high" })]);
    await expect(service.dispatchDueMailRuleWork()).resolves.toMatchObject({ claimed: 0 });
    const [repairedSummary] = await database.db
      .select()
      .from(attentionItems)
      .where(
        and(
          eq(attentionItems.relatedEntityId, fixture.account.id),
          eq(attentionItems.kind, "run_summary"),
          eq(attentionItems.status, "open"),
        ),
      );
    if (!repairedSummary) throw new Error("The Mail run summary was not repaired.");
    expect(repairedSummary).toMatchObject({ domain: "mail", importance: "high" });
    await expect(
      database.db.select().from(auditEvents).where(eq(auditEvents.entityId, repairedSummary.id)),
    ).resolves.toEqual([
      expect.objectContaining({
        action: "assistant.attention.created",
        actorId: fixture.account.id,
        actorType: "connector",
      }),
    ]);
    await database.db
      .update(mailRuleWorkItems)
      .set({ status: "succeeded" })
      .where(eq(mailRuleWorkItems.accountId, fixture.account.id));
    await database.pool.query(`
      CREATE OR REPLACE FUNCTION fail_background_attention_resolution_audit_for_test() RETURNS trigger AS $$
      BEGIN
        IF NEW.request_id LIKE 'mail-rule-work-attention:%' THEN
          RAISE EXCEPTION 'forced background attention resolution audit failure';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
      CREATE TRIGGER fail_background_attention_resolution_audit_for_test
      BEFORE INSERT ON audit_events
      FOR EACH ROW EXECUTE FUNCTION fail_background_attention_resolution_audit_for_test();
    `);
    try {
      await expect(service.dispatchDueMailRuleWork()).rejects.toThrow(
        'Failed query: insert into "audit_events"',
      );
    } finally {
      await database.pool.query(`
        DROP TRIGGER IF EXISTS fail_background_attention_resolution_audit_for_test ON audit_events;
        DROP FUNCTION IF EXISTS fail_background_attention_resolution_audit_for_test();
      `);
    }
    await expect(
      database.db.select().from(attentionItems).where(eq(attentionItems.id, repairedSummary.id)),
    ).resolves.toEqual([expect.objectContaining({ status: "open", version: 1 })]);
    await expect(service.dispatchDueMailRuleWork()).resolves.toMatchObject({ claimed: 0 });
    await expect(
      database.db.select().from(attentionItems).where(eq(attentionItems.id, repairedSummary.id)),
    ).resolves.toEqual([expect.objectContaining({ status: "resolved", version: 2 })]);
  });

  it("bounds Mail run-summary rediscovery while eventually repairing every account", async () => {
    await database.db.delete(mailRuleWorkItems);
    const fixtures = [];
    for (let index = 0; index <= MAIL_RULE_EXECUTION_LIMIT_PER_RUN; index += 1) {
      fixtures.push(
        await createDurableMailWorkFixture(`Bounded run summary ${index}`, {
          afterDays: 1,
          mailboxId: null,
          type: "archive",
        }),
      );
    }
    const accountIds = fixtures.map((fixture) => fixture.account.id);
    await database.db
      .update(mailRuleWorkItems)
      .set({ completedAt: timestamp, status: "failed" })
      .where(inArray(mailRuleWorkItems.accountId, accountIds));

    await expect(service.dispatchDueMailRuleWork()).resolves.toMatchObject({ claimed: 0 });
    await expect(
      database.db
        .select()
        .from(attentionItems)
        .where(
          and(
            inArray(attentionItems.relatedEntityId, accountIds),
            eq(attentionItems.kind, "run_summary"),
            eq(attentionItems.status, "open"),
          ),
        ),
    ).resolves.toHaveLength(MAIL_RULE_EXECUTION_LIMIT_PER_RUN);

    await expect(service.dispatchDueMailRuleWork()).resolves.toMatchObject({ claimed: 0 });
    await expect(
      database.db
        .select()
        .from(attentionItems)
        .where(
          and(
            inArray(attentionItems.relatedEntityId, accountIds),
            eq(attentionItems.kind, "run_summary"),
            eq(attentionItems.status, "open"),
          ),
        ),
    ).resolves.toHaveLength(MAIL_RULE_EXECUTION_LIMIT_PER_RUN + 1);

    await database.db
      .update(mailRuleWorkItems)
      .set({ status: "succeeded" })
      .where(inArray(mailRuleWorkItems.accountId, accountIds));
    await expect(service.dispatchDueMailRuleWork()).resolves.toMatchObject({ claimed: 0 });
    await expect(
      database.db
        .select()
        .from(attentionItems)
        .where(
          and(
            inArray(attentionItems.relatedEntityId, accountIds),
            eq(attentionItems.kind, "run_summary"),
            eq(attentionItems.status, "open"),
          ),
        ),
    ).resolves.toHaveLength(1);
    await expect(service.dispatchDueMailRuleWork()).resolves.toMatchObject({ claimed: 0 });
    await expect(
      database.db
        .select()
        .from(attentionItems)
        .where(
          and(
            inArray(attentionItems.relatedEntityId, accountIds),
            eq(attentionItems.kind, "run_summary"),
            eq(attentionItems.status, "open"),
          ),
        ),
    ).resolves.toHaveLength(0);
  });

  it("reconciles provider success after rotated credentials fail to persist", async () => {
    await database.db.delete(mailRuleWorkItems);
    const fixture = await createDurableMailWorkFixture("Credential rotation archive", {
      afterDays: 1,
      mailboxId: null,
      type: "archive",
    });
    const updateMailThread = vi.mocked(
      google.updateMailThread as NonNullable<GoogleConnector["updateMailThread"]>,
    );
    const getMailThreadState = vi.mocked(
      google.getMailThreadState as NonNullable<GoogleConnector["getMailThreadState"]>,
    );
    updateMailThread.mockReset();
    updateMailThread.mockResolvedValueOnce({
      ...rotatedCredentials,
      accessToken: "durable-rotation-fault",
      expiresAt: "2034-07-13T13:00:00.000Z",
    });
    await database.pool.query(`
      CREATE FUNCTION reject_durable_mail_credentials_for_test() RETURNS trigger AS $$
      BEGIN
        IF NEW.encrypted_credentials IS DISTINCT FROM OLD.encrypted_credentials THEN
          RAISE EXCEPTION 'forced durable Mail credential persistence failure';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
      CREATE TRIGGER reject_durable_mail_credentials_for_test
      BEFORE UPDATE OF encrypted_credentials ON calendar_accounts
      FOR EACH ROW EXECUTE FUNCTION reject_durable_mail_credentials_for_test();
    `);
    try {
      await expect(service.dispatchDueMailRuleWork()).resolves.toMatchObject({
        claimed: 1,
        reconciliation: 1,
      });
    } finally {
      await database.pool.query(`
        DROP TRIGGER reject_durable_mail_credentials_for_test ON calendar_accounts;
        DROP FUNCTION reject_durable_mail_credentials_for_test();
      `);
    }
    await expect(
      database.db.select().from(mailRuleWorkItems).where(eq(mailRuleWorkItems.id, fixture.work.id)),
    ).resolves.toEqual([
      expect.objectContaining({
        lastErrorCode: "credential_persistence_failed",
        providerEffect: "applied",
        status: "reconcile",
      }),
    ]);

    await database.db
      .update(mailRuleWorkItems)
      .set({ nextAttemptAt: timestamp })
      .where(eq(mailRuleWorkItems.id, fixture.work.id));
    getMailThreadState.mockResolvedValueOnce({
      credentials: rotatedCredentials,
      value: {
        mailboxIds: ["UNREAD"],
        remoteThreadId: fixture.thread.remoteThreadId,
        starred: false,
        unread: true,
      },
    });
    await expect(service.dispatchDueMailRuleWork()).resolves.toMatchObject({
      claimed: 1,
      succeeded: 1,
    });
    expect(updateMailThread).toHaveBeenCalledTimes(1);
  });

  it("records provider success as reconciliation work when the local commit fails", async () => {
    await database.db.delete(mailRuleWorkItems);
    const fixture = await createDurableMailWorkFixture("Partial archive", {
      afterDays: 1,
      mailboxId: null,
      type: "archive",
    });
    const updateMailThread = vi.mocked(
      google.updateMailThread as NonNullable<GoogleConnector["updateMailThread"]>,
    );
    const getMailThreadState = vi.mocked(
      google.getMailThreadState as NonNullable<GoogleConnector["getMailThreadState"]>,
    );
    updateMailThread.mockReset();
    updateMailThread.mockResolvedValue(rotatedCredentials);
    await database.pool.query(`
      CREATE FUNCTION reject_mail_work_success_for_test() RETURNS trigger AS $$
      BEGIN
        IF NEW.status = 'succeeded' THEN
          RAISE EXCEPTION 'forced durable Mail projection failure';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
      CREATE TRIGGER reject_mail_work_success_for_test
      BEFORE UPDATE ON mail_rule_work_items
      FOR EACH ROW EXECUTE FUNCTION reject_mail_work_success_for_test();
    `);
    try {
      await expect(service.dispatchDueMailRuleWork()).resolves.toMatchObject({
        claimed: 1,
        reconciliation: 1,
      });
    } finally {
      await database.pool.query(`
        DROP TRIGGER reject_mail_work_success_for_test ON mail_rule_work_items;
        DROP FUNCTION reject_mail_work_success_for_test();
      `);
    }
    await expect(
      database.db.select().from(mailRuleWorkItems).where(eq(mailRuleWorkItems.id, fixture.work.id)),
    ).resolves.toEqual([
      expect.objectContaining({
        lastErrorCode: "projection_commit_failed",
        providerEffect: "applied",
        status: "reconcile",
      }),
    ]);

    await database.db
      .update(mailRuleWorkItems)
      .set({ nextAttemptAt: timestamp })
      .where(eq(mailRuleWorkItems.id, fixture.work.id));
    getMailThreadState.mockResolvedValueOnce({
      credentials: rotatedCredentials,
      value: {
        mailboxIds: ["UNREAD"],
        remoteThreadId: fixture.thread.remoteThreadId,
        starred: false,
        unread: true,
      },
    });
    await expect(service.dispatchDueMailRuleWork()).resolves.toMatchObject({
      claimed: 1,
      succeeded: 1,
    });
    expect(updateMailThread).toHaveBeenCalledTimes(1);
  });

  it("preserves a provider effect when its local source disappears before projection", async () => {
    await database.db.delete(mailRuleWorkItems);
    const fixture = await createDurableMailWorkFixture("Removed during projection", {
      afterDays: 1,
      mailboxId: null,
      type: "archive",
    });
    const updateMailThread = vi.mocked(
      google.updateMailThread as NonNullable<GoogleConnector["updateMailThread"]>,
    );
    updateMailThread.mockReset();
    updateMailThread.mockImplementationOnce(async () => {
      await database.db.delete(mailThreads).where(eq(mailThreads.id, fixture.thread.id));
      return rotatedCredentials;
    });

    await expect(service.dispatchDueMailRuleWork()).resolves.toMatchObject({
      claimed: 1,
      reconciliation: 1,
    });
    await expect(
      database.db.select().from(mailRuleWorkItems).where(eq(mailRuleWorkItems.id, fixture.work.id)),
    ).resolves.toEqual([
      expect.objectContaining({
        lastErrorCode: "projection_commit_failed",
        providerEffect: "applied",
        status: "reconcile",
        threadId: null,
      }),
    ]);
    await database.db
      .update(mailRuleWorkItems)
      .set({ nextAttemptAt: timestamp })
      .where(eq(mailRuleWorkItems.id, fixture.work.id));
    await expect(service.dispatchDueMailRuleWork()).resolves.toMatchObject({
      claimed: 0,
      failed: 1,
    });
    await expect(
      database.db.select().from(mailRuleWorkItems).where(eq(mailRuleWorkItems.id, fixture.work.id)),
    ).resolves.toEqual([
      expect.objectContaining({
        lastErrorCode: "source_missing",
        providerEffect: "applied",
        status: "failed",
      }),
    ]);
  });

  it("fails closed when an approved delayed action loses its label destination", async () => {
    await database.db.delete(mailRuleWorkItems);
    const missingMailboxId = "99999999-9999-4999-8999-999999999999";
    const fixture = await createDurableMailWorkFixture("Removed label destination", {
      afterDays: 1,
      mailboxId: missingMailboxId,
      type: "add_label",
    });
    const updateMailThread = vi.mocked(
      google.updateMailThread as NonNullable<GoogleConnector["updateMailThread"]>,
    );
    updateMailThread.mockClear();

    await expect(service.dispatchDueMailRuleWork()).resolves.toMatchObject({
      claimed: 1,
      failed: 1,
    });
    expect(updateMailThread).not.toHaveBeenCalled();
    await expect(
      database.db.select().from(mailRuleWorkItems).where(eq(mailRuleWorkItems.id, fixture.work.id)),
    ).resolves.toEqual([
      expect.objectContaining({
        lastErrorCode: "destination_changed",
        providerEffect: "none",
        status: "failed",
      }),
    ]);
  });

  it("retains exact applied evidence when the local reconciliation projection fails", async () => {
    await database.db.delete(mailRuleWorkItems);
    const fixture = await createDurableMailWorkFixture("Failed reconciliation projection", {
      afterDays: 1,
      mailboxId: null,
      type: "archive",
    });
    await database.db
      .update(mailRuleWorkItems)
      .set({ providerEffect: "indeterminate", status: "reconcile" })
      .where(eq(mailRuleWorkItems.id, fixture.work.id));
    const getMailThreadState = vi.mocked(
      google.getMailThreadState as NonNullable<GoogleConnector["getMailThreadState"]>,
    );
    const updateMailThread = vi.mocked(
      google.updateMailThread as NonNullable<GoogleConnector["updateMailThread"]>,
    );
    getMailThreadState.mockReset();
    getMailThreadState.mockResolvedValueOnce({
      credentials: rotatedCredentials,
      value: {
        mailboxIds: ["UNREAD"],
        remoteThreadId: fixture.thread.remoteThreadId,
        starred: false,
        unread: true,
      },
    });
    updateMailThread.mockClear();
    await database.pool.query(`
      CREATE FUNCTION reject_mail_reconciliation_success_for_test() RETURNS trigger AS $$
      BEGIN
        IF NEW.status = 'succeeded' THEN
          RAISE EXCEPTION 'forced reconciled projection failure';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
      CREATE TRIGGER reject_mail_reconciliation_success_for_test
      BEFORE UPDATE ON mail_rule_work_items
      FOR EACH ROW EXECUTE FUNCTION reject_mail_reconciliation_success_for_test();
    `);
    try {
      await expect(service.dispatchDueMailRuleWork()).resolves.toMatchObject({
        claimed: 1,
        reconciliation: 1,
      });
    } finally {
      await database.pool.query(`
        DROP TRIGGER reject_mail_reconciliation_success_for_test ON mail_rule_work_items;
        DROP FUNCTION reject_mail_reconciliation_success_for_test();
      `);
    }
    expect(updateMailThread).not.toHaveBeenCalled();
    await expect(
      database.db.select().from(mailRuleWorkItems).where(eq(mailRuleWorkItems.id, fixture.work.id)),
    ).resolves.toEqual([
      expect.objectContaining({
        lastErrorCode: "projection_commit_failed",
        providerEffect: "applied",
        status: "reconcile",
      }),
    ]);
  });

  it("fails delayed Mail work closed when the approved profile revision changes", async () => {
    await database.db.delete(mailRuleWorkItems);
    const fixture = await createDurableMailWorkFixture("Changed profile archive", {
      afterDays: 1,
      mailboxId: null,
      type: "archive",
    });
    await database.db
      .update(domainProfiles)
      .set({ version: fixture.profile.version + 1 })
      .where(eq(domainProfiles.id, fixture.profile.id));
    const updateMailThread = vi.mocked(
      google.updateMailThread as NonNullable<GoogleConnector["updateMailThread"]>,
    );
    updateMailThread.mockClear();

    await expect(service.dispatchDueMailRuleWork()).resolves.toMatchObject({
      claimed: 1,
      failed: 1,
    });
    expect(updateMailThread).not.toHaveBeenCalled();
    await expect(
      database.db.select().from(mailRuleWorkItems).where(eq(mailRuleWorkItems.id, fixture.work.id)),
    ).resolves.toEqual([
      expect.objectContaining({
        lastErrorCode: "profile_changed",
        providerEffect: "none",
        status: "failed",
      }),
    ]);
  });

  it("fails durable Mail snapshots closed across rule, source, action, and profile drift", async () => {
    const cases: Array<{
      code: string;
      mutate: (fixture: Awaited<ReturnType<typeof createDurableMailWorkFixture>>) => Promise<void>;
      name: string;
    }> = [
      {
        code: "invalid_action",
        mutate: async (fixture) => {
          await database.db
            .update(mailRuleWorkItems)
            .set({ action: { afterDays: 1, mailboxId: null, type: "star" } })
            .where(eq(mailRuleWorkItems.id, fixture.work.id));
        },
        name: "Changed work action",
      },
      {
        code: "source_changed",
        mutate: async (fixture) => {
          await database.db
            .update(mailRules)
            .set({ sourceAccountIds: [] })
            .where(eq(mailRules.id, fixture.rule.id));
        },
        name: "Changed rule source",
      },
      {
        code: "action_changed",
        mutate: async (fixture) => {
          await database.db
            .update(mailRules)
            .set({ actions: [{ afterDays: 1, mailboxId: null, type: "star" }] })
            .where(eq(mailRules.id, fixture.rule.id));
        },
        name: "Removed accepted action",
      },
      {
        code: "profile_changed",
        mutate: async (fixture) => {
          await database.db
            .update(domainProfiles)
            .set({ preferences: {} })
            .where(eq(domainProfiles.id, fixture.profile.id));
        },
        name: "Invalid profile preferences",
      },
      {
        code: "source_changed",
        mutate: async (fixture) => {
          await database.db
            .update(mailThreads)
            .set({ subject: "No longer matches" })
            .where(eq(mailThreads.id, fixture.thread.id));
        },
        name: "Changed source facts",
      },
      {
        code: "ambiguous_trash_rule",
        mutate: async (fixture) => {
          await database.db
            .update(mailRules)
            .set({
              actions: [
                { afterDays: 1, mailboxId: null, type: "archive" },
                { afterDays: 1, mailboxId: null, type: "trash" },
              ],
            })
            .where(eq(mailRules.id, fixture.rule.id));
        },
        name: "Ambiguous Trash actions",
      },
      {
        code: "profile_changed",
        mutate: async (fixture) => {
          await database.db.delete(domainProfiles).where(eq(domainProfiles.id, fixture.profile.id));
        },
        name: "Removed profile",
      },
    ];
    const updateMailThread = vi.mocked(
      google.updateMailThread as NonNullable<GoogleConnector["updateMailThread"]>,
    );
    for (const testCase of cases) {
      await database.db.delete(mailRuleWorkItems);
      const fixture = await createDurableMailWorkFixture(testCase.name, {
        afterDays: 1,
        mailboxId: null,
        type: "archive",
      });
      await testCase.mutate(fixture);
      updateMailThread.mockClear();

      await expect(service.dispatchDueMailRuleWork()).resolves.toMatchObject({
        claimed: 1,
        failed: 1,
      });
      expect(updateMailThread).not.toHaveBeenCalled();
      await expect(
        database.db
          .select()
          .from(mailRuleWorkItems)
          .where(eq(mailRuleWorkItems.id, fixture.work.id)),
      ).resolves.toEqual([
        expect.objectContaining({
          lastErrorCode: testCase.code,
          providerEffect: "none",
          status: "failed",
        }),
      ]);
    }
  });

  it("handles missing durable sources, credentials, and connector recovery capabilities", async () => {
    await database.db.delete(mailRuleWorkItems);
    const missingThread = await createDurableMailWorkFixture("Removed local source", {
      afterDays: 1,
      mailboxId: null,
      type: "archive",
    });
    await database.db.delete(mailThreads).where(eq(mailThreads.id, missingThread.thread.id));
    await expect(service.dispatchDueMailRuleWork()).resolves.toMatchObject({
      claimed: 0,
      failed: 1,
    });
    await expect(
      database.db
        .select()
        .from(mailRuleWorkItems)
        .where(eq(mailRuleWorkItems.id, missingThread.work.id)),
    ).resolves.toEqual([
      expect.objectContaining({ lastErrorCode: "source_missing", status: "failed" }),
    ]);

    await database.db.delete(mailRuleWorkItems);
    const missingCredentials = await createDurableMailWorkFixture("Removed credentials", {
      afterDays: 1,
      mailboxId: null,
      type: "archive",
    });
    await database.db
      .update(calendarAccounts)
      .set({ encryptedCredentials: null })
      .where(eq(calendarAccounts.id, missingCredentials.account.id));
    await expect(service.dispatchDueMailRuleWork()).resolves.toMatchObject({
      claimed: 1,
      failed: 1,
    });
    await expect(
      database.db
        .select()
        .from(mailRuleWorkItems)
        .where(eq(mailRuleWorkItems.id, missingCredentials.work.id)),
    ).resolves.toEqual([
      expect.objectContaining({ lastErrorCode: "source_unavailable", status: "failed" }),
    ]);

    await database.db.delete(mailRuleWorkItems);
    const noExactRead = await createDurableMailWorkFixture("Missing exact read", {
      afterDays: 1,
      mailboxId: null,
      type: "archive",
    });
    await database.db
      .update(mailRuleWorkItems)
      .set({
        claimId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        claimedAt: new Date(timestamp.getTime() - 20 * 60_000),
        claimMode: "execute",
        status: "claimed",
      })
      .where(eq(mailRuleWorkItems.id, noExactRead.work.id));
    const { getMailThreadState: _getMailThreadState, ...googleWithoutExactRead } = google;
    const serviceWithoutExactRead = createConnectorService({
      db: database.db,
      encryptionKey,
      google: googleWithoutExactRead,
      icloud,
      now: () => timestamp,
    });
    await expect(serviceWithoutExactRead.dispatchDueMailRuleWork()).resolves.toMatchObject({
      claimed: 1,
      reconciliation: 1,
    });
    await expect(
      database.db
        .select()
        .from(mailRuleWorkItems)
        .where(eq(mailRuleWorkItems.id, noExactRead.work.id)),
    ).resolves.toEqual([
      expect.objectContaining({
        lastErrorCode: "reconciliation_unavailable",
        providerEffect: "indeterminate",
        status: "reconcile",
      }),
    ]);

    await database.db.delete(mailRuleWorkItems);
    const noModify = await createDurableMailWorkFixture("Missing modify capability", {
      afterDays: 1,
      mailboxId: null,
      type: "archive",
    });
    const { updateMailThread: _updateMailThread, ...googleWithoutModify } = google;
    const serviceWithoutModify = createConnectorService({
      db: database.db,
      encryptionKey,
      google: googleWithoutModify,
      icloud,
      now: () => timestamp,
    });
    await expect(serviceWithoutModify.dispatchDueMailRuleWork()).resolves.toMatchObject({
      claimed: 1,
      reconciliation: 1,
    });
    await expect(
      database.db
        .select()
        .from(mailRuleWorkItems)
        .where(eq(mailRuleWorkItems.id, noModify.work.id)),
    ).resolves.toEqual([
      expect.objectContaining({
        lastErrorCode: "provider_effect_indeterminate",
        status: "reconcile",
      }),
    ]);

    await database.db.delete(mailRuleWorkItems);
    const noTrash = await createDurableMailWorkFixture("Missing Trash capability", {
      afterDays: 1,
      mailboxId: null,
      type: "trash",
    });
    const { trashMailThread: _trashMailThread, ...googleWithoutTrash } = google;
    const serviceWithoutTrash = createConnectorService({
      db: database.db,
      encryptionKey,
      google: googleWithoutTrash,
      icloud,
      now: () => timestamp,
    });
    await expect(serviceWithoutTrash.dispatchDueMailRuleWork()).resolves.toMatchObject({
      claimed: 1,
      failed: 1,
    });
    await expect(
      database.db.select().from(mailRuleWorkItems).where(eq(mailRuleWorkItems.id, noTrash.work.id)),
    ).resolves.toEqual([
      expect.objectContaining({ lastErrorCode: "provider_rejected", status: "failed" }),
    ]);
  });

  it("makes retry exhaustion terminal and preserves post-provider authorization drift", async () => {
    await database.db.delete(mailRuleWorkItems);
    const exhausted = await createDurableMailWorkFixture("Exhausted rate limit", {
      afterDays: 1,
      mailboxId: null,
      type: "archive",
    });
    await database.db
      .update(mailRuleWorkItems)
      .set({ attemptCount: 4 })
      .where(eq(mailRuleWorkItems.id, exhausted.work.id));
    const updateMailThread = vi.mocked(
      google.updateMailThread as NonNullable<GoogleConnector["updateMailThread"]>,
    );
    updateMailThread.mockReset();
    updateMailThread.mockRejectedValueOnce(connectorError("Rate limited", 429));
    await expect(service.dispatchDueMailRuleWork()).resolves.toMatchObject({
      claimed: 1,
      failed: 1,
    });
    await expect(
      database.db
        .select()
        .from(mailRuleWorkItems)
        .where(eq(mailRuleWorkItems.id, exhausted.work.id)),
    ).resolves.toEqual([
      expect.objectContaining({
        attemptCount: 5,
        lastErrorCode: "provider_rate_limited",
        status: "failed",
      }),
    ]);

    await database.db.delete(mailRuleWorkItems);
    const changedAfterProvider = await createDurableMailWorkFixture(
      "Authorization changed after provider",
      {
        afterDays: 1,
        mailboxId: null,
        type: "archive",
      },
    );
    updateMailThread.mockReset();
    updateMailThread.mockImplementationOnce(async () => {
      await database.db
        .update(mailRules)
        .set({ enabled: false, policy: "preview", version: changedAfterProvider.rule.version + 1 })
        .where(eq(mailRules.id, changedAfterProvider.rule.id));
      return rotatedCredentials;
    });
    await expect(service.dispatchDueMailRuleWork()).resolves.toMatchObject({
      claimed: 1,
      reconciliation: 1,
    });
    await expect(
      database.db
        .select()
        .from(mailRuleWorkItems)
        .where(eq(mailRuleWorkItems.id, changedAfterProvider.work.id)),
    ).resolves.toEqual([
      expect.objectContaining({
        lastErrorCode: "authorization_changed",
        providerEffect: "applied",
        status: "reconcile",
      }),
    ]);
  });

  it("does not mask unexpected Google authorization failures", async () => {
    const unexpected = new Error("Unexpected authorization failure");
    const failingGoogle = mockGoogle();
    vi.mocked(failingGoogle.authorizationUrl).mockImplementationOnce(() => {
      throw unexpected;
    });
    const failingService = createConnectorService({
      db: database.db,
      encryptionKey,
      google: failingGoogle,
      now: () => timestamp,
    });

    await expect(failingService.startGoogleAuthorization(userId)).rejects.toBe(unexpected);
  });
});
