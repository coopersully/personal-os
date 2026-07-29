import { resolve } from "node:path";
import type {
  GoogleConnector,
  GoogleCredentials,
  ICloudConnector,
  NormalizedRemoteEvent,
} from "@personal-os/connectors";
import { ConnectorError, MailSendPreAcceptanceError } from "@personal-os/connectors";
import {
  attentionItems,
  auditEvents,
  calendarAccounts,
  calendarEvents,
  calendars,
  createDatabaseClient,
  type DatabaseClient,
  domainProfiles,
  mailboxes,
  mailDrafts,
  mailMessages,
  mailRules,
  mailThreads,
  migrateDatabase,
  users,
} from "@personal-os/database";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { createAssistantService } from "./assistant-service.js";
import { createCalendarService } from "./calendar-service.js";
import { createConnectorService, MailProviderRejectedError } from "./connector-service.js";
import { createMailService } from "./mail-service.js";
import { decryptJson } from "./security.js";

const timestamp = new Date("2026-07-13T12:00:00.000Z");
const encryptionKey = Buffer.alloc(32, 7).toString("base64");
const credentials: GoogleCredentials = {
  accessToken: "access-1",
  expiresAt: "2026-07-13T13:00:00.000Z",
  refreshToken: "refresh-1",
  scope: "calendar",
  tokenType: "Bearer",
};
const rotatedCredentials: GoogleCredentials = {
  ...credentials,
  accessToken: "access-2",
  expiresAt: "2026-07-13T14:00:00.000Z",
};

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
      value: { mailboxes: [], threads: [] },
    })),
    sendMail: vi.fn(async () => rotatedCredentials),
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
      mailboxes: [
        { id: "INBOX", name: "Inbox", role: "inbox" as const, totalCount: 1, unreadCount: 1 },
      ],
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

  async function waitForDomainProfileLock(): Promise<boolean> {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const result = await database.pool.query<{ blocked: boolean }>(`
        SELECT EXISTS (
          SELECT 1
          FROM pg_stat_activity
          WHERE datname = current_database()
            AND wait_event_type = 'Lock'
            AND query LIKE '%domain_profiles%'
            AND query LIKE '%for update%'
        ) AS blocked
      `);
      if (result.rows[0]?.blocked) return true;
      await new Promise<void>((resolveAttempt) => {
        setTimeout(resolveAttempt, 25);
      });
    }
    return false;
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
    const initialUrl = await service.startGoogleAuthorization(userId);
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
      scope: "https://www.googleapis.com/auth/gmail.readonly",
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
        mailboxes: [{ id: "INBOX", name: "Inbox", role: "inbox", totalCount: 1, unreadCount: 1 }],
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
    await expect(service.syncAccount(userId, account.id)).rejects.toThrow(
      "Mailbox bootstrap unavailable",
    );
    expect(
      (await service.listAccounts(userId)).find((item) => item.id === account.id),
    ).toMatchObject({
      mailEnabled: true,
      syncError: "Mailbox bootstrap unavailable",
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
        value: { mailboxes: [], threads: [] },
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
      code: "not_found",
    });
    await expect(
      database.db
        .select()
        .from(calendarAccounts)
        .where(eq(calendarAccounts.id, missingCredentialsAccount.id)),
    ).resolves.toEqual([
      expect.objectContaining({
        syncError: "The connected account was not found.",
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
      new MailSendPreAcceptanceError("Token refresh rejected", new ConnectorError("401", 401)),
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
        new ConnectorError(`Ambiguous Google ${status}`, status),
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
    vi.mocked(sendICloud).mockRejectedValueOnce(new ConnectorError("SMTP transport closed", 502));
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

  it("applies enabled Mail rules during Google synchronization", async () => {
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
    vi.mocked(syncMail).mockResolvedValueOnce({
      credentials,
      value: {
        mailboxes: [{ id: "INBOX", name: "Inbox", role: "inbox", totalCount: 1, unreadCount: 1 }],
        threads: [
          {
            bodyText: "Body",
            from: { address: "sender@example.com", name: "Sender" },
            mailboxIds: ["INBOX", "UNREAD"],
            messages: [
              {
                attachments: [
                  {
                    contentType: "application/pdf",
                    filename: "brief.pdf",
                    id: "attachment-1",
                    size: 42,
                  },
                ],
                bodyText: "Body",
                cc: [],
                from: { address: "sender@example.com", name: "Sender" },
                receivedAt: timestamp,
                remoteMessageId: "ruled-message",
                to: [],
              },
            ],
            messageCount: 1,
            receivedAt: timestamp,
            remoteThreadId: "ruled-thread",
            snippet: "Google Mail",
            starred: false,
            subject: "Google Mail",
            to: [],
            unread: true,
          },
        ],
      },
    });
    await service.syncAccount(userId, account.id);
    expect(google.updateMailThread).toHaveBeenCalledWith(expect.anything(), "ruled-thread", {
      addMailboxIds: ["STARRED"],
      removeMailboxIds: ["UNREAD"],
    });
    expect(google.updateMailThread).toHaveBeenCalledTimes(1);
    const [thread] = await database.db
      .select()
      .from(mailThreads)
      .where(eq(mailThreads.remoteThreadId, "ruled-thread"));
    expect(thread).toMatchObject({ remoteMailboxIds: ["INBOX"], starred: true, unread: false });
    const [previouslyObserved] = await database.db
      .select()
      .from(mailThreads)
      .where(eq(mailThreads.remoteThreadId, "previously-observed-thread"));
    expect(previouslyObserved?.deletedAt).toBeNull();
    await expect(database.db.select().from(mailRules)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          enabled: false,
          name: "Trash project mail after one day",
          policy: "preview",
          version: 2,
        }),
      ]),
    );
    await expect(database.db.select().from(attentionItems)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          domain: "mail",
          relatedEntityType: "mail_rule",
          status: "open",
          summary: expect.stringContaining("durable due-work backlog"),
          title: "Mail rule paused: Trash project mail after one day",
        }),
      ]),
    );
    await expect(database.db.select().from(mailMessages)).resolves.toEqual([
      expect.objectContaining({ remoteMessageId: "ruled-message" }),
    ]);
  });

  it("bounds automatic Mail runs, preserves rules, and drains backlog on a later sync", async () => {
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
    const boundedSync = service.syncAccount(userId, account.id);
    try {
      await vi.waitFor(() => expect(updateMailThread).toHaveBeenCalledTimes(2));
    } finally {
      releaseWrites?.();
    }
    await boundedSync;
    expect(updateMailThread).toHaveBeenCalledTimes(6);
    expect(maximumWrites).toBe(2);
    const runAudits = await database.db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, "mail.rule.run"));
    expect(runAudits.at(-1)?.after).toMatchObject({
      attemptedCount: 6,
      backlogCount: 1,
      failedCount: 0,
      succeededCount: 6,
    });
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
    vi.mocked(syncMail).mockResolvedValueOnce({
      credentials,
      value: {
        mailboxes: [{ id: "INBOX", name: "Inbox", role: "inbox", totalCount: 1, unreadCount: 1 }],
        threads: [threads[6] as (typeof threads)[number]],
      },
    });
    await service.syncAccount(userId, account.id);
    expect(updateMailThread).toHaveBeenCalledTimes(1);
    vi.mocked(updateMailThread).mockResolvedValue(rotatedCredentials);
  });

  it("preserves provider repair details when supplemental Mail run-summary persistence fails", async () => {
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
      await expect(service.syncAccount(userId, account.id)).rejects.toMatchObject({
        code: "service_unavailable",
        details: expect.objectContaining({
          partialEffect: true,
          repairAction: "sync_mail_account",
          runSummaryPersisted: false,
          userActionRequired: true,
        }),
      });
    } finally {
      await database.pool.query(`
        DROP TRIGGER IF EXISTS fail_mail_run_summary_for_test ON audit_events;
        DROP FUNCTION IF EXISTS fail_mail_run_summary_for_test();
      `);
      vi.mocked(updateMailThread).mockResolvedValue(rotatedCredentials);
    }
  });

  it("records supplemental summary loss without masking successfully applied Mail work", async () => {
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
    vi.mocked(updateMailThread).mockResolvedValueOnce(rotatedCredentials);
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
      expect(syncedAudits.at(-1)?.after).toMatchObject({ runSummaryPersisted: false });
      await expect(
        database.db.select().from(auditEvents).where(eq(auditEvents.action, "mail.rule.applied")),
      ).resolves.toEqual(expect.arrayContaining([expect.any(Object)]));
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
        details: expect.objectContaining({
          operation: "rule_execution",
          partialEffect: true,
          repairAction: "sync_mail_account",
          succeededCount: 1,
          synchronizationAuditPersisted: false,
          userActionRequired: true,
        }),
      });
      expect(updateMailThread).toHaveBeenCalledWith(
        expect.anything(),
        "final-audit-failure",
        expect.objectContaining({ removeMailboxIds: ["UNREAD"] }),
      );
    } finally {
      await database.pool.query(`
        DROP TRIGGER IF EXISTS fail_mail_sync_audit_for_test ON audit_events;
        DROP FUNCTION IF EXISTS fail_mail_sync_audit_for_test();
      `);
    }
  });

  it("describes mixed success and pre-provider authorization changes as policy review", async () => {
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
        mailboxes: [{ id: "INBOX", name: "Inbox", role: "inbox", totalCount: 3, unreadCount: 3 }],
        threads,
      },
    });
    let releasePolicyC: (() => void) | undefined;
    let policyCStarted: (() => void) | undefined;
    const policyCProviderStarted = new Promise<void>((resolveStarted) => {
      policyCStarted = resolveStarted;
    });
    vi.mocked(updateMailThread).mockClear();
    vi.mocked(updateMailThread).mockImplementation(async (_value, remoteThreadId) => {
      if (remoteThreadId === "policy-c") {
        policyCStarted?.();
        await new Promise<void>((resolveProvider) => {
          releasePolicyC = resolveProvider;
        });
      }
      return rotatedCredentials;
    });
    const priorAppliedCount = (
      await database.db
        .select({ id: auditEvents.id })
        .from(auditEvents)
        .where(eq(auditEvents.action, "mail.rule.applied"))
    ).length;
    try {
      const sync = service.syncAccount(userId, account.id);
      await policyCProviderStarted;
      await vi.waitFor(async () => {
        const appliedCount = (
          await database.db
            .select({ id: auditEvents.id })
            .from(auditEvents)
            .where(eq(auditEvents.action, "mail.rule.applied"))
        ).length;
        expect(appliedCount).toBeGreaterThan(priorAppliedCount);
      });
      releasePolicyC?.();
      await expect(sync).rejects.toMatchObject({
        code: "service_unavailable",
        details: expect.objectContaining({
          authorizationChangedCount: 1,
          partialEffect: true,
          repairAction: "review_current_policy",
          succeededCount: 2,
        }),
      });
      expect(updateMailThread).toHaveBeenCalledTimes(2);
      const [runAttention] = await database.db
        .select()
        .from(attentionItems)
        .where(
          and(
            eq(attentionItems.relatedEntityType, "mail_account"),
            eq(attentionItems.relatedEntityId, account.id),
          ),
        );
      expect(runAttention).toMatchObject({
        summary: expect.stringContaining("stopped before provider access"),
        title: "Mail automation needs policy review",
      });
      expect(runAttention?.summary).not.toContain("provider reconciliation");
    } finally {
      releasePolicyC?.();
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

  it("reports provider-partial automatic rule effects and rolls back local audit state", async () => {
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
      await expect(service.syncAccount(userId, account.id)).rejects.toMatchObject({
        code: "service_unavailable",
        details: {
          attemptedCount: 1,
          failedCount: 1,
          partialEffect: true,
          repairAction: "sync_mail_account",
          succeededCount: 0,
        },
      });
      expect(updateMailThread).toHaveBeenCalledWith(
        expect.anything(),
        "partial-rule-thread",
        expect.objectContaining({ removeMailboxIds: ["UNREAD"] }),
      );
      const [thread] = await database.db
        .select()
        .from(mailThreads)
        .where(eq(mailThreads.remoteThreadId, "partial-rule-thread"));
      expect(thread).toMatchObject({ starred: false, unread: true });
      const runAudits = await database.db
        .select()
        .from(auditEvents)
        .where(eq(auditEvents.action, "mail.rule.run"));
      expect(runAudits.at(-1)?.after).toMatchObject({
        attemptedCount: 1,
        failedCount: 1,
        partialEffectCount: 1,
        succeededCount: 0,
      });
      await expect(database.db.select().from(attentionItems)).resolves.toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            relatedEntityId: account.id,
            relatedEntityType: "mail_account",
            title: "Mail automation needs provider reconciliation",
          }),
        ]),
      );
    } finally {
      await database.pool.query(`
        DROP TRIGGER IF EXISTS fail_automatic_mail_audit_for_test ON audit_events;
        DROP FUNCTION IF EXISTS fail_automatic_mail_audit_for_test();
      `);
    }
  });

  it("reports provider effects when rotated Mail credentials cannot be persisted", async () => {
    const [account] = await database.db
      .select()
      .from(calendarAccounts)
      .where(eq(calendarAccounts.providerAccountId, "google-person"));
    if (!account) throw new Error("Connected account fixture is missing.");
    const syncMail = google.syncMail;
    const updateMailThread = google.updateMailThread;
    if (!syncMail || !updateMailThread) throw new Error("Google Mail fixtures are unavailable.");
    vi.mocked(updateMailThread).mockClear();
    vi.mocked(updateMailThread).mockResolvedValueOnce({
      ...rotatedCredentials,
      accessToken: "rule-fault-token",
      expiresAt: "2033-07-13T13:00:00.000Z",
    });
    vi.mocked(syncMail).mockResolvedValueOnce({
      credentials,
      value: {
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
      await expect(service.syncAccount(userId, account.id)).rejects.toMatchObject({
        code: "service_unavailable",
        details: {
          attemptedCount: 1,
          failedCount: 1,
          partialEffect: true,
          repairAction: "reconnect_then_sync_mail_account",
          succeededCount: 0,
        },
      });
      expect(updateMailThread).toHaveBeenCalledWith(
        expect.anything(),
        "credential-failure-thread",
        expect.objectContaining({ removeMailboxIds: ["UNREAD"] }),
      );
      const [thread] = await database.db
        .select()
        .from(mailThreads)
        .where(eq(mailThreads.remoteThreadId, "credential-failure-thread"));
      expect(thread).toMatchObject({ starred: false, unread: true });
      const [failedAccount] = await database.db
        .select()
        .from(calendarAccounts)
        .where(eq(calendarAccounts.id, account.id));
      expect(failedAccount).toMatchObject({
        syncError: expect.stringContaining("Reconnect this account"),
        syncStatus: "error",
      });
    } finally {
      await database.pool.query(`
        DROP TRIGGER IF EXISTS fail_mail_credential_save_for_test ON calendar_accounts;
        DROP FUNCTION IF EXISTS fail_mail_credential_save_for_test();
      `);
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
      value: { mailboxes: [], threads: [] },
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
      value: { mailboxes: [], threads: [] },
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
      value: { mailboxes: [], threads: [] },
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
    expect(updateMailThread).toHaveBeenCalledOnce();
    expect(updateMailThread).toHaveBeenCalledWith(expect.anything(), "safety-matrix-thread", {
      addMailboxIds: expect.arrayContaining(["Label_Projects", "STARRED"]),
      removeMailboxIds: ["UNREAD"],
    });
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
        expect.objectContaining({ enabled: true, name: "Star labeled mail" }),
        ...insertedRules
          .filter(
            (rule) =>
              ![
                "Current project label",
                "Different account",
                "Read labeled mail",
                "Star labeled mail",
              ].includes(rule.name),
          )
          .map((rule) =>
            expect.objectContaining({ enabled: false, name: rule.name, policy: "preview" }),
          ),
      ]),
    );
    const [storedThread] = await database.db
      .select()
      .from(mailThreads)
      .where(eq(mailThreads.remoteThreadId, "safety-matrix-thread"));
    expect(storedThread).toMatchObject({
      remoteMailboxIds: ["INBOX", "Label_Projects"],
      starred: true,
      unread: false,
    });
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

    await expect(service.syncAccount(userId, connected.accountId)).rejects.toThrow(
      "Apple Mail is unavailable",
    );
    expect(
      (await service.listAccounts(userId)).find((item) => item.id === connected.accountId),
    ).toMatchObject({
      email: "unavailable@icloud.com",
      syncError: "Apple Mail is unavailable",
      syncStatus: "error",
    });
  });

  it("completes OAuth, updates an existing connection, and validates one-time state", async () => {
    await expect(service.completeGoogleAuthorization("invalid", "code")).rejects.toMatchObject({
      code: "invalid_request",
    });

    const authorizationUrl = await service.startGoogleAuthorization(userId);
    const state = new URL(authorizationUrl).searchParams.get("state");
    expect(state).toMatch(/^oauth_/);
    const connected = await service.completeGoogleAuthorization(String(state), "code-1");
    expect(connected.email).toBe("person@example.com");
    expect(connected.returnPath).toBe("/settings?section=connections");
    expect(google.exchangeCode).toHaveBeenCalledWith("code-1");
    await expect(
      service.completeGoogleAuthorization(String(state), "code-again"),
    ).rejects.toMatchObject({ code: "invalid_request" });
    const concurrentAuthorizationUrl = await service.startGoogleAuthorization(userId);
    const concurrentState = String(new URL(concurrentAuthorizationUrl).searchParams.get("state"));
    const exchangeCountBeforeRace = vi.mocked(google.exchangeCode).mock.calls.length;
    const concurrentResults = await Promise.allSettled([
      service.completeGoogleAuthorization(concurrentState, "concurrent-code-1"),
      service.completeGoogleAuthorization(concurrentState, "concurrent-code-2"),
    ]);
    expect(concurrentResults.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(concurrentResults.filter((result) => result.status === "rejected")).toEqual([
      expect.objectContaining({ reason: expect.objectContaining({ code: "invalid_request" }) }),
    ]);
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
    const secondUrl = await service.startGoogleAuthorization(userId);
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
      new ConnectorError("Provider precondition failed.", 412),
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

    vi.mocked(google.syncCalendar).mockRejectedValueOnce(new Error("Provider unavailable"));
    await expect(service.syncAccount(userId, account.id)).rejects.toThrow("Provider unavailable");
    vi.mocked(google.syncCalendar).mockRejectedValueOnce("opaque failure");
    await expect(service.syncAccount(userId, account.id)).rejects.toBe("opaque failure");
    const [failed] = await database.db
      .select()
      .from(calendarAccounts)
      .where(eq(calendarAccounts.id, account.id));
    expect(failed).toMatchObject({ syncError: "Unknown connector error", syncStatus: "error" });
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
      code: "internal_error",
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
          action: "assistant.profile.updated",
          requestId: "disable-mail-capability",
        }),
        expect.objectContaining({
          action: "mail.rule.paused_policy_mismatch",
          requestId: "disable-mail-capability",
        }),
      ]),
    );
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
    const url = await service.startGoogleAuthorization(profileUser.id);
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
