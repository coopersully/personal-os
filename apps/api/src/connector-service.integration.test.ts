import { resolve } from "node:path";
import type {
  GoogleConnector,
  GoogleCredentials,
  ICloudConnector,
  NormalizedRemoteEvent,
} from "@personal-os/connectors";
import {
  auditEvents,
  calendarAccounts,
  calendarEvents,
  calendars,
  createDatabaseClient,
  type DatabaseClient,
  mailboxes,
  mailMessages,
  mailRules,
  mailThreads,
  migrateDatabase,
  users,
} from "@personal-os/database";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { and, asc, eq } from "drizzle-orm";
import { createCalendarService } from "./calendar-service.js";
import { createConnectorService } from "./connector-service.js";

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

  it("applies enabled Mail rules during Google synchronization", async () => {
    const [account] = await database.db
      .select()
      .from(calendarAccounts)
      .where(eq(calendarAccounts.providerAccountId, "google-person"));
    if (!account) throw new Error("Connected account fixture is missing.");
    await database.db.insert(mailRules).values([
      {
        actions: [{ afterDays: 0, mailboxId: null, type: "mark_read" }],
        condition: { field: "any", operator: "contains", value: "google mail" },
        enabled: true,
        name: "Read project mail",
        policy: "approved_rule",
        userId,
      },
      {
        actions: [{ afterDays: 0, mailboxId: null, type: "archive" }],
        condition: { field: "any", operator: "contains", value: "google mail" },
        enabled: true,
        name: "Archive project mail",
        policy: "approved_rule",
        userId,
      },
      {
        actions: [{ afterDays: 0, mailboxId: null, type: "star" }],
        condition: { field: "any", operator: "contains", value: "google mail" },
        enabled: true,
        name: "Star project mail",
        policy: "approved_rule",
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
      addMailboxIds: [],
      removeMailboxIds: ["UNREAD"],
    });
    expect(google.updateMailThread).toHaveBeenCalledWith(expect.anything(), "ruled-thread", {
      addMailboxIds: [],
      removeMailboxIds: ["INBOX"],
    });
    expect(google.updateMailThread).toHaveBeenCalledWith(expect.anything(), "ruled-thread", {
      addMailboxIds: ["STARRED"],
      removeMailboxIds: [],
    });
    const [thread] = await database.db
      .select()
      .from(mailThreads)
      .where(eq(mailThreads.remoteThreadId, "ruled-thread"));
    expect(thread).toMatchObject({ remoteMailboxIds: [], starred: true, unread: false });
    await expect(database.db.select().from(mailMessages)).resolves.toEqual([
      expect.objectContaining({ remoteMessageId: "ruled-message" }),
    ]);
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
      syncStatus: "syncing",
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
    await expect(calendarService.deleteEvent(created.id, context)).resolves.toBeUndefined();
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
      false,
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
    await expect(calendarService.deleteEvent(localEvent.id, context)).resolves.toBeUndefined();
    await expect(calendarService.restoreEvent(localEvent.id, context)).resolves.toMatchObject({
      blocks: [expect.objectContaining({ eventId: blockId, mode: "details" })],
      title: "Linked title",
    });
    await expect(
      calendarService.deleteEventBlock(localEvent.id, blockId, context),
    ).resolves.toMatchObject({ blocks: [] });
    await calendarService.deleteLocalCalendar(localCalendar.id, context);
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
    await expect(service.disconnect(userId, external.id)).resolves.toBeUndefined();
    expect((await service.listAccounts(userId)).some((value) => value.id === external.id)).toBe(
      false,
    );
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
