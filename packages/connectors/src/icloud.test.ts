import { ConnectorError } from "./failures.js";
import { createICloudConnector } from "./icloud.js";
import {
  calendarAttachmentProjectionOverflow,
  MAX_MAIL_CALENDAR_PARTS_PER_MESSAGE,
  MAX_MAIL_SOURCE_BYTES,
} from "./mail-attachments.js";

const credentials = {
  appSpecificPassword: "xxxx-xxxx-xxxx-xxxx",
  email: "test@icloud.com",
};
const calendarId = "https://caldav.icloud.com/calendars/test/home/";
const timedIcs = `BEGIN:VCALENDAR\r
VERSION:2.0\r
BEGIN:VEVENT\r
UID:event-1\r
DTSTART:20260715T130000Z\r
DTEND:20260715T140000Z\r
SUMMARY:Focus\r
DESCRIPTION:Notes\r
LOCATION:Desk\r
STATUS:TENTATIVE\r
RRULE:FREQ=DAILY\r
END:VEVENT\r
END:VCALENDAR\r
`;
const allDayIcs = `BEGIN:VCALENDAR\r
VERSION:2.0\r
BEGIN:VEVENT\r
UID:event-2\r
DTSTART;VALUE=DATE:20260716\r
DTEND;VALUE=DATE:20260717\r
STATUS:CANCELLED\r
END:VEVENT\r
END:VCALENDAR\r
`;

function response(status = 200, etag?: string): Response {
  return new Response(null, { ...(etag ? { headers: { etag } } : {}), status });
}

function davClient(overrides: Record<string, unknown> = {}) {
  const calendar = {
    calendarColor: "#123456",
    ctag: "ctag-1",
    displayName: "Calendar",
    timezone: "America/New_York",
    url: calendarId,
  };
  return {
    createCalendarObject: vi.fn(async () => response(201, "etag-new")),
    deleteCalendarObject: vi.fn(async () => response(204)),
    fetchCalendarObjects: vi.fn(async ({ objectUrls }: { objectUrls?: string[] }) =>
      objectUrls
        ? [{ data: timedIcs, etag: "etag-1", url: objectUrls[0] }]
        : [
            { data: timedIcs, etag: "etag-1", url: `${calendarId}event-1.ics` },
            { data: allDayIcs, url: `${calendarId}event-2.ics` },
            { data: "BEGIN:VCALENDAR\r\nEND:VCALENDAR", url: `${calendarId}empty.ics` },
            { url: `${calendarId}missing.ics` },
          ],
    ),
    fetchCalendars: vi.fn(async () => [
      calendar,
      { displayName: { value: "not projected" }, url: "https://example.com/other/" },
    ]),
    supportedReportSet: vi.fn(async () => []),
    syncCollection: vi.fn(async () => []),
    updateCalendarObject: vi.fn(async () => response(200, "etag-updated")),
    ...overrides,
  };
}

function connector(
  client = davClient(),
  imap?: Record<string, unknown>,
  createSmtpTransport?: () => { close: () => void; sendMail: (input: unknown) => Promise<unknown> },
) {
  const createDavClient = vi.fn(async () => client as never);
  return {
    client,
    createDavClient,
    value: createICloudConnector({
      createDavClient,
      ...(imap ? { createImapClient: vi.fn(() => imap as never) } : {}),
      ...(createSmtpTransport ? { createSmtpTransport } : {}),
    }),
  };
}

describe("iCloud connector", () => {
  it("uses a bounded abortable IMAP IDLE session only as a change signal", async () => {
    const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
    let finishIdle: (() => void) | undefined;
    const idle = new Promise<void>((resolveIdle) => {
      finishIdle = resolveIdle;
    });
    const imap = {
      close: vi.fn(() => finishIdle?.()),
      connect: vi.fn(async () => undefined),
      idle: vi.fn(async () => idle),
      logout: vi.fn(async () => undefined),
      mailboxOpen: vi.fn(async () => ({ path: "INBOX" })),
      on: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
        const registered = listeners.get(event) ?? new Set();
        registered.add(listener);
        listeners.set(event, registered);
        return imap;
      }),
      removeListener: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
        listeners.get(event)?.delete(listener);
        return imap;
      }),
    };
    const { value } = connector(davClient(), imap);
    if (!value.listenForMailChanges) throw new Error("iCloud IDLE capability is missing.");
    const controller = new AbortController();
    const onChange = vi.fn(async () => undefined);
    const listening = value.listenForMailChanges(credentials, onChange, {
      signal: controller.signal,
    });
    await vi.waitFor(() => expect(imap.idle).toHaveBeenCalledOnce());
    listeners.get("exists")?.forEach((listener) => {
      listener({ count: 2 });
    });
    listeners.get("expunge")?.forEach((listener) => {
      listener({ seq: 1 });
    });
    listeners.get("flags")?.forEach((listener) => {
      listener({ seq: 1 });
    });
    await vi.waitFor(() => expect(onChange).toHaveBeenCalledTimes(3));
    controller.abort();
    await expect(listening).resolves.toBeUndefined();
    expect(imap.mailboxOpen).toHaveBeenCalledWith("INBOX");
    expect(imap.close).toHaveBeenCalledOnce();
    expect(imap.removeListener).toHaveBeenCalledTimes(5);
  });
  it("extracts supported conference links from CalDAV event descriptions", async () => {
    const meetingIcs = timedIcs.replace(
      "DESCRIPTION:Notes",
      "DESCRIPTION:Join https://zoom.us/j/12345",
    );
    const { value } = connector(
      davClient({
        fetchCalendarObjects: vi.fn(async () => [
          { data: meetingIcs, etag: "etag-1", url: `${calendarId}event-1.ics` },
        ]),
      }),
    );

    await expect(value.syncCalendar(credentials, calendarId, null)).resolves.toMatchObject({
      changes: [
        {
          event: { conferenceUrl: "https://zoom.us/j/12345" },
          kind: "upsert",
        },
      ],
    });
  });

  it("lists calendars and creates, syncs, updates, and deletes CalDAV events", async () => {
    const { client, value } = connector();
    await expect(value.listCalendars(credentials)).resolves.toEqual([
      {
        accessRole: "owner",
        color: "#123456",
        id: calendarId,
        name: "Calendar",
        primary: true,
        selected: true,
        timezone: "America/New_York",
        writable: true,
      },
      {
        accessRole: "owner",
        color: null,
        id: "https://example.com/other/",
        name: "iCloud Calendar",
        primary: false,
        selected: true,
        timezone: "UTC",
        writable: true,
      },
    ]);
    const created = await value.createEvent(credentials, calendarId, {
      allDay: false,
      calendarId: "11111111-1111-4111-8111-111111111111",
      endsAt: "2026-07-15T14:00:00.000Z",
      location: "Desk",
      notes: "Notes",
      startsAt: "2026-07-15T13:00:00.000Z",
      timezone: "UTC",
      title: "Focus",
    });
    expect(created).toMatchObject({
      allDay: false,
      etag: "etag-new",
      location: "Desk",
      notes: "Notes",
      status: "confirmed",
      title: "Focus",
    });
    expect(created.remoteEventId).toMatch(/\.ics$/);

    const sync = await value.syncCalendar(credentials, calendarId, null);
    expect(sync).toMatchObject({ nextSyncToken: "ctag-1", reset: true });
    expect(sync.changes).toHaveLength(2);
    expect(sync.changes[0]).toMatchObject({
      event: { recurrence: ["RRULE:FREQ=DAILY"], status: "tentative", title: "Focus" },
      kind: "upsert",
    });
    expect(sync.changes[1]).toMatchObject({
      event: { allDay: true, status: "cancelled", title: "Untitled event" },
    });

    const updated = await value.updateEvent(
      credentials,
      calendarId,
      `${calendarId}event-1.ics`,
      "etag-1",
      { allDay: true, location: null, notes: null, title: "Changed" },
    );
    expect(updated).toMatchObject({
      etag: "etag-updated",
      location: null,
      notes: null,
      title: "Changed",
    });
    await expect(
      value.deleteEvent(credentials, `${calendarId}event-1.ics`, "etag-1"),
    ).resolves.toBeUndefined();
    expect(client.createCalendarObject).toHaveBeenCalledOnce();
    expect(client.updateCalendarObject).toHaveBeenCalledOnce();
    expect(client.deleteCalendarObject).toHaveBeenCalledOnce();
  });

  it("uses WebDAV collection tokens for incremental iCloud Calendar changes", async () => {
    const supportedReportSet = vi.fn(async () => ["syncCollection"]);
    const syncCollection = vi.fn(async () => [
      {
        href: `${calendarId}event-1.ics`,
        ok: true,
        props: { getetag: "etag-2" },
        raw: { multistatus: { syncToken: "opaque-sync-2" } },
        status: 200,
        statusText: "OK",
      },
      {
        href: `${calendarId}event-2.ics`,
        ok: false,
        status: 404,
        statusText: "Not Found",
      },
    ]);
    const client = davClient({ supportedReportSet, syncCollection });
    const { value } = connector(client);

    await expect(
      value.syncCalendar(credentials, calendarId, "opaque-sync-1"),
    ).resolves.toMatchObject({
      changes: [
        { event: { remoteEventId: `${calendarId}event-1.ics` }, kind: "upsert" },
        { kind: "delete", remoteEventId: `${calendarId}event-2.ics` },
      ],
      nextSyncToken: "opaque-sync-2",
      reset: false,
    });
    expect(syncCollection).toHaveBeenCalledWith(
      expect.objectContaining({ syncLevel: 1, syncToken: "opaque-sync-1", url: calendarId }),
    );
    expect(client.fetchCalendarObjects).toHaveBeenCalledWith(
      expect.objectContaining({ objectUrls: [`${calendarId}event-1.ics`] }),
    );
  });

  it("starts an advertised WebDAV collection sync without inventing a provider token", async () => {
    const syncCollection = vi.fn(async () => [
      {
        href: `${calendarId}event-1.ics`,
        ok: true,
        raw: { multistatus: { syncToken: "opaque-initial-token" } },
        status: 200,
        statusText: "OK",
      },
    ]);
    const client = davClient({
      supportedReportSet: vi.fn(async () => ["sync-collection"]),
      syncCollection,
    });

    await expect(
      connector(client).value.syncCalendar(credentials, calendarId, null),
    ).resolves.toMatchObject({
      nextSyncToken: "opaque-initial-token",
      reset: true,
    });
    expect(syncCollection).toHaveBeenCalledWith(
      expect.not.objectContaining({ syncToken: expect.anything() }),
    );
  });

  it("continues a truncated WebDAV collection report from the returned opaque token", async () => {
    const syncCollection = vi
      .fn()
      .mockResolvedValueOnce([
        {
          href: `${calendarId}event-1.ics`,
          ok: true,
          raw: { multistatus: { syncToken: "opaque-page-1" } },
          status: 200,
          statusText: "OK",
        },
        {
          href: calendarId,
          ok: false,
          raw: { multistatus: { syncToken: "opaque-page-1" } },
          status: 507,
          statusText: "Insufficient Storage",
        },
      ])
      .mockResolvedValueOnce([
        {
          href: `${calendarId}event-2.ics`,
          ok: false,
          raw: { multistatus: { syncToken: "opaque-page-2" } },
          status: 404,
          statusText: "Not Found",
        },
      ]);
    const client = davClient({
      supportedReportSet: vi.fn(async () => ["syncCollection"]),
      syncCollection,
    });

    await expect(
      connector(client).value.syncCalendar(credentials, calendarId, "opaque-start"),
    ).resolves.toMatchObject({
      changes: [
        { event: { remoteEventId: `${calendarId}event-1.ics` }, kind: "upsert" },
        { kind: "delete", remoteEventId: `${calendarId}event-2.ics` },
      ],
      nextSyncToken: "opaque-page-2",
      reset: false,
    });
    expect(syncCollection).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ syncToken: "opaque-page-1" }),
    );
  });

  it("falls back to bounded full CalDAV reconciliation when a collection token is invalid", async () => {
    const client = davClient({
      supportedReportSet: vi.fn(async () => ["syncCollection"]),
      syncCollection: vi.fn(async () => [{ ok: false, status: 409, statusText: "Conflict" }]),
    });
    const { value } = connector(client);

    await expect(
      value.syncCalendar(credentials, calendarId, "expired-token"),
    ).resolves.toMatchObject({
      nextSyncToken: "ctag-1",
      reset: true,
    });
    expect(client.fetchCalendarObjects).toHaveBeenCalledWith(
      expect.not.objectContaining({ objectUrls: expect.anything() }),
    );
  });

  it("classifies WebDAV collection authorization failures without exposing provider details", async () => {
    const client = davClient({
      supportedReportSet: vi.fn(async () => ["syncCollection"]),
      syncCollection: vi.fn(async () => [
        { ok: false, status: 403, statusText: "provider secret response" },
      ]),
    });

    await expect(
      connector(client).value.syncCalendar(credentials, calendarId, "opaque-token"),
    ).rejects.toMatchObject({
      category: "authorization",
      code: "icloud_calendar_authorization_failed",
      disposition: "reconnect",
      message: "iCloud Calendar authorization is no longer valid.",
    });

    const unavailable = davClient({
      supportedReportSet: vi.fn(async () => {
        throw Object.assign(new Error("socket timeout with provider response"), {
          code: "ETIMEDOUT",
        });
      }),
    });
    await expect(
      connector(unavailable).value.syncCalendar(credentials, calendarId, "opaque-token"),
    ).rejects.toMatchObject({
      category: "transport",
      code: "icloud_calendar_transport_failure",
      disposition: "retry",
      message: "iCloud Calendar is temporarily unavailable.",
    });
  });

  it("syncs IMAP mailboxes and recent plain-text messages", async () => {
    const release = vi.fn();
    const raw = Buffer.from(
      [
        "From: Ada <ada@example.com>",
        "To: Example User <user@example.com>",
        "Subject: Hello from iCloud",
        "Date: Wed, 15 Jul 2026 09:00:00 -0400",
        "Message-ID: <message-1@example.com>",
        "Content-Type: text/plain; charset=utf-8",
        "",
        "Hello Example User.\n\nThis is a test.",
      ].join("\r\n"),
    );
    let selectedPath = "INBOX";
    const imap = {
      connect: vi.fn(async () => undefined),
      fetch: vi.fn(async function* () {
        yield { flags: new Set<string>(), internalDate: new Date(0), uid: 1 };
        yield {
          flags: new Set(["\\Flagged"]),
          internalDate: "2026-07-15T13:00:00.000Z",
          source: raw,
          threadId: "thread-1",
          uid: 2,
        };
        yield {
          flags: new Set(["\\Seen"]),
          internalDate: "2026-07-15T13:00:00.000Z",
          source: Buffer.from("Subject: No addresses\r\n\r\nBody"),
          uid: 3,
        };
      }),
      get mailbox() {
        return {
          exists: selectedPath === "INBOX" ? 3 : 0,
          path: selectedPath,
          uidValidity: 777n,
        };
      },
      getMailboxLock: vi.fn(async (path: string) => {
        selectedPath = path;
        return { release };
      }),
      list: vi.fn(async () => [
        {
          flags: new Set<string>(),
          name: "Inbox",
          path: "INBOX",
          status: { messages: 3, uidValidity: 777n, unseen: 2 },
        },
        {
          flags: new Set<string>(),
          name: "Sent",
          path: "Sent Messages",
          specialUse: "\\Sent",
          status: { messages: 0 },
        },
        { flags: new Set<string>(), name: "Drafts", path: "Drafts", status: { messages: 0 } },
        {
          flags: new Set<string>(),
          name: "Deleted",
          path: "Deleted Messages",
          status: { messages: 0 },
        },
        { flags: new Set<string>(), name: "Junk", path: "Junk", status: { messages: 0 } },
        { flags: new Set<string>(), name: "Archive", path: "Archive", status: { messages: 0 } },
        { flags: new Set<string>(), name: "Projects", path: "Projects", status: { messages: 0 } },
        {
          flags: new Set(["\\Noselect"]),
          name: "Container",
          path: "Container",
          status: { messages: 0 },
        },
      ]),
      logout: vi.fn(async () => undefined),
    };
    const { value } = connector(davClient(), imap);
    const result = await value.syncMail(credentials, null);
    expect(result.mailboxes.map((mailbox) => mailbox.role)).toEqual([
      "inbox",
      "sent",
      "drafts",
      "trash",
      "spam",
      "archive",
      "custom",
    ]);
    expect(result.threads).toHaveLength(2);
    expect(result.threads[0]).toMatchObject({
      bodyText: "Hello Example User.\n\nThis is a test.",
      from: { address: "ada@example.com", name: "Ada" },
      messagesComplete: true,
      remoteThreadId: "INBOX:777:2",
      starred: true,
      subject: "Hello from iCloud",
      to: [{ address: "user@example.com", name: "Example User" }],
      unread: true,
    });
    expect(result.threads[0]?.messages?.[0]).toMatchObject({
      providerRevision: "777:2",
      remoteMessageId: "INBOX:777:2",
    });
    expect(result.threads[1]).toMatchObject({
      from: { address: "", name: null },
      remoteThreadId: "INBOX:777:3",
      unread: false,
    });
    expect(release).toHaveBeenCalledTimes(7);
    expect(imap.logout).toHaveBeenCalledOnce();
  });

  it("changes iCloud source identity when UIDVALIDITY resets and a UID is reused", async () => {
    let uidValidity = 100n;
    const imap = {
      connect: vi.fn(async () => undefined),
      fetch: vi.fn(async function* () {
        yield {
          source: Buffer.from(
            "From: organizer@example.com\r\nSubject: Invite\r\nContent-Type: text/calendar\r\n\r\nBEGIN:VCALENDAR",
          ),
          uid: 7,
        };
      }),
      mailbox: {
        exists: 1,
        path: "INBOX",
        get uidValidity() {
          return uidValidity;
        },
      },
      getMailboxLock: vi.fn(async () => ({ release: vi.fn() })),
      list: vi.fn(async () => [
        {
          flags: new Set<string>(),
          name: "Inbox",
          path: "INBOX",
          status: { messages: 1, uidValidity },
        },
      ]),
      logout: vi.fn(async () => undefined),
    };
    const { value } = connector(davClient(), imap);
    const first = await value.syncMail(credentials, null);
    uidValidity = 101n;
    const second = await value.syncMail(credentials, null);

    expect(first.threads[0]?.remoteThreadId).toBe("INBOX:100:7");
    expect(first.threads[0]?.messages?.[0]).toMatchObject({
      providerRevision: "100:7",
      remoteMessageId: "INBOX:100:7",
    });
    expect(second.threads[0]?.remoteThreadId).toBe("INBOX:101:7");
    expect(second.threads[0]?.messages?.[0]).toMatchObject({
      providerRevision: "101:7",
      remoteMessageId: "INBOX:101:7",
    });
  });

  it("collapses excessive iCloud calendar MIME parts to one provider-scoped marker", async () => {
    const calendarParts = Array.from(
      { length: MAX_MAIL_CALENDAR_PARTS_PER_MESSAGE + 1 },
      (_, index) =>
        [
          "--calendar-parts",
          `Content-Type: text/calendar; name="invite-${String(index)}.ics"`,
          `Content-Disposition: attachment; filename="invite-${String(index)}.ics"`,
          "",
          "BEGIN:VCALENDAR",
          "END:VCALENDAR",
        ].join("\r\n"),
    ).join("\r\n");
    const source = Buffer.from(
      [
        "From: organizer@example.com",
        "Subject: Excessive invitations",
        'Content-Type: multipart/mixed; boundary="calendar-parts"',
        "",
        calendarParts,
        "--calendar-parts--",
      ].join("\r\n"),
    );
    const imap = {
      connect: vi.fn(async () => undefined),
      fetch: vi.fn(async function* () {
        yield { source, uid: 9 };
      }),
      mailbox: { exists: 1, path: "INBOX", uidValidity: 888n },
      getMailboxLock: vi.fn(async () => ({ release: vi.fn() })),
      list: vi.fn(async () => [
        {
          flags: new Set<string>(),
          name: "Inbox",
          path: "INBOX",
          status: { messages: 1, uidValidity: 888n },
        },
      ]),
      logout: vi.fn(async () => undefined),
    };
    const mail = await connector(davClient(), imap).value.syncMail(credentials, null);
    expect(mail.threads[0]?.messages?.[0]?.attachments).toEqual([
      expect.objectContaining({
        ...calendarAttachmentProjectionOverflow("ignored"),
        id: expect.stringMatching(/^projection-overflow:[0-9a-f]{64}$/),
        providerPartId: expect.stringMatching(/^projection-overflow:[0-9a-f]{64}$/),
      }),
    ]);
  });

  it("bounds iCloud RFC822 retrieval before MIME parsing", async () => {
    const fetch = vi.fn(async function* () {
      yield {
        envelope: {
          date: new Date("2026-07-15T13:00:00.000Z"),
          from: [{ address: "organizer@example.com", name: "Organizer" }],
          subject: "Oversized source",
          to: [{ address: "user@example.com", name: "User" }],
        },
        size: MAX_MAIL_SOURCE_BYTES + 1,
        source: Buffer.from("truncated-untrusted-source"),
        uid: 10,
      };
    });
    const imap = {
      connect: vi.fn(async () => undefined),
      fetch,
      mailbox: { exists: 1, path: "INBOX", uidValidity: 889n },
      getMailboxLock: vi.fn(async () => ({ release: vi.fn() })),
      list: vi.fn(async () => [
        {
          flags: new Set<string>(),
          name: "Inbox",
          path: "INBOX",
          status: { messages: 1, uidValidity: 889n },
        },
      ]),
      logout: vi.fn(async () => undefined),
    };

    const mail = await connector(davClient(), imap).value.syncMail(credentials, null);

    expect(fetch).toHaveBeenCalledWith(
      "1:*",
      expect.objectContaining({
        size: true,
        source: { maxLength: MAX_MAIL_SOURCE_BYTES + 1 },
      }),
    );
    expect(mail.threads[0]).toMatchObject({
      bodyText: "",
      from: { address: "organizer@example.com", name: "Organizer" },
      subject: "Oversized source",
      to: [{ address: "user@example.com", name: "User" }],
    });
    expect(mail.threads[0]?.messages?.[0]?.attachments).toEqual([
      expect.objectContaining({
        projectionIssue: "calendar_attachment_projection_overflow",
        providerPartId: expect.stringMatching(/^projection-overflow:[0-9a-f]{64}$/),
      }),
    ]);
  });

  it("closes an in-flight multi-mailbox IMAP sync when quiescing", async () => {
    const controller = new AbortController();
    const interrupted = new Error("runtime quiescing");
    let rejectFetch: (error: unknown) => void = () => {};
    let markFetchStarted: () => void = () => {};
    const fetchStarted = new Promise<void>((resolve) => {
      markFetchStarted = resolve;
    });
    const close = vi.fn(() => {
      rejectFetch(new Error("socket closed"));
      throw new Error("socket already destroyed");
    });
    const release = vi.fn();
    const imap = {
      close,
      connect: vi.fn(async () => undefined),
      fetch: vi.fn(async function* () {
        markFetchStarted();
        await new Promise<void>((_resolve, reject) => {
          rejectFetch = reject;
        });
        yield {};
      }),
      get mailbox() {
        return { exists: 1, path: "INBOX", uidValidity: 777n };
      },
      getMailboxLock: vi.fn(async () => ({ release })),
      list: vi.fn(async () => [
        {
          flags: new Set<string>(),
          name: "Inbox",
          path: "INBOX",
          status: { messages: 1, uidValidity: 777n, unseen: 1 },
        },
        {
          flags: new Set<string>(),
          name: "Archive",
          path: "Archive",
          status: { messages: 1, uidValidity: 778n, unseen: 0 },
        },
      ]),
      logout: vi.fn(async () => undefined),
    };
    const { value } = connector(davClient(), imap);
    const sync = value.syncMail(credentials, null, {
      deadlineMs: Date.now() + 105_000,
      signal: controller.signal,
    });
    await fetchStarted;
    expect(() => controller.abort(interrupted)).not.toThrow();

    await expect(sync).rejects.toBe(interrupted);
    expect(close).toHaveBeenCalled();
    expect(imap.logout).not.toHaveBeenCalled();
    expect(imap.fetch).toHaveBeenCalledOnce();
    expect(release).toHaveBeenCalledOnce();
  });

  it("passes the quiesce signal through CalDAV discovery and object fetches", async () => {
    const controller = new AbortController();
    const operation = {
      deadlineMs: Date.now() + 105_000,
      signal: controller.signal,
    };
    const { client, createDavClient, value } = connector();

    await value.syncCalendar(credentials, calendarId, null, operation);

    expect(createDavClient).toHaveBeenCalledWith(credentials, operation);
    expect(client.fetchCalendars).toHaveBeenCalledWith({
      fetchOptions: { signal: controller.signal },
    });
    expect(client.fetchCalendarObjects).toHaveBeenCalledWith({
      calendar: expect.objectContaining({ url: calendarId }),
      fetchOptions: { signal: controller.signal },
    });
  });

  it("sends iCloud mail through the authenticated SMTP transport", async () => {
    const transport = { close: vi.fn(), sendMail: vi.fn(async () => undefined) };
    const { value } = connector(davClient(), undefined, () => transport);
    if (!value.sendMail) throw new Error("Mail sending is unavailable.");
    await value.sendMail(credentials, {
      body: "Hello",
      cc: [{ address: "cc@example.com", name: "CC" }],
      from: credentials.email,
      subject: "Subject",
      to: [{ address: "to@example.com", name: "To" }],
    });
    expect(transport.sendMail).toHaveBeenCalledWith({
      cc: [{ address: "cc@example.com", name: "CC" }],
      from: credentials.email,
      subject: "Subject",
      text: "Hello",
      to: [{ address: "to@example.com", name: "To" }],
    });
    expect(transport.close).toHaveBeenCalledOnce();

    const failingTransport = {
      close: vi.fn(),
      sendMail: vi.fn(async () => {
        throw new Error("SMTP unavailable");
      }),
    };
    const { value: failing } = connector(davClient(), undefined, () => failingTransport);
    if (!failing.sendMail) throw new Error("Mail sending is unavailable.");
    await expect(
      failing.sendMail(credentials, {
        body: "Hello",
        cc: [],
        from: credentials.email,
        subject: "Subject",
        to: [{ address: "to@example.com", name: null }],
      }),
    ).rejects.toMatchObject({
      category: "transport",
      disposition: "retry",
      status: null,
    });
    expect(failingTransport.close).toHaveBeenCalledOnce();
  });

  it("writes iCloud flags and mailbox moves through IMAP", async () => {
    const release = vi.fn();
    let selectedUidValidity = 777n;
    const imap = {
      connect: vi.fn(async () => undefined),
      get mailbox() {
        return { exists: 1, path: "INBOX", uidValidity: selectedUidValidity };
      },
      getMailboxLock: vi.fn(async () => ({ release })),
      list: vi.fn(async () => [
        { name: "Inbox", path: "INBOX" },
        { name: "Archive", path: "Archive", specialUse: "\\Archive" },
        { name: "Trash", path: "Trash", specialUse: "\\Trash" },
      ]),
      logout: vi.fn(async () => undefined),
      messageFlagsAdd: vi.fn(async () => true),
      messageFlagsRemove: vi.fn(async () => true),
      messageMove: vi.fn(async () => true),
    };
    const { value } = connector(davClient(), imap);
    if (!value.updateMailThread) throw new Error("Mail updates are unavailable.");
    await value.updateMailThread(credentials, "INBOX:777:42", {
      addMailboxIds: ["Trash", "STARRED"],
      removeMailboxIds: ["INBOX", "UNREAD"],
    });
    expect(imap.messageFlagsAdd).toHaveBeenCalledWith([42], ["\\Flagged"], { uid: true });
    expect(imap.messageFlagsAdd).toHaveBeenCalledWith([42], ["\\Seen"], { uid: true });
    expect(imap.messageMove).toHaveBeenCalledWith([42], "Trash", { uid: true });
    expect(release).toHaveBeenCalledOnce();
    expect(imap.logout).toHaveBeenCalledOnce();
    await expect(value.updateMailThread(credentials, "not-a-message", {})).rejects.toMatchObject({
      status: 404,
    });
    selectedUidValidity = 778n;
    await expect(
      value.updateMailThread(credentials, "INBOX:777:42", { addMailboxIds: ["STARRED"] }),
    ).rejects.toMatchObject({ status: 409 });
    expect(release).toHaveBeenCalledTimes(2);
  });

  it("normalizes sparse CalDAV and IMAP responses", async () => {
    const sparseCalendar = { displayName: "Sparse", url: calendarId };
    const sparseDav = davClient({
      createCalendarObject: vi.fn(async () => response(201)),
      fetchCalendarObjects: vi.fn(async ({ objectUrls }: { objectUrls?: string[] }) => [
        { data: timedIcs, url: objectUrls?.[0] ?? `${calendarId}event-1.ics` },
      ]),
      fetchCalendars: vi.fn(async () => [sparseCalendar]),
      updateCalendarObject: vi.fn(async () => response(200)),
    });
    const raw = Buffer.from(
      [
        "From: <anonymous@example.com>",
        "To: first@example.com",
        "To: second@example.com",
        'Content-Type: multipart/mixed; boundary="part"',
        "",
        "--part",
        "Content-Type: application/octet-stream",
        "Content-Transfer-Encoding: base64",
        "Content-Disposition: attachment; filename=test.bin",
        "",
        "AA==",
        "--part--",
      ].join("\r\n"),
    );
    const release = vi.fn();
    let selectedSparsePath = "Empty";
    const sparseImap = {
      connect: vi.fn(async () => undefined),
      fetch: vi.fn(async function* () {
        yield { source: raw, uid: 9 };
      }),
      get mailbox() {
        return {
          exists: selectedSparsePath === "INBOX" ? 1 : 0,
          path: selectedSparsePath,
          uidValidity: 888n,
        };
      },
      getMailboxLock: vi.fn(async (path: string) => {
        selectedSparsePath = path;
        return { release };
      }),
      list: vi.fn(async () => [
        { flags: new Set<string>(), name: "Empty", path: "Empty" },
        {
          flags: new Set<string>(),
          name: "Inbox",
          path: "INBOX",
          status: { messages: 1, uidValidity: 888n },
        },
      ]),
      logout: vi.fn(async () => undefined),
    };
    const { value } = connector(sparseDav, sparseImap);
    await expect(
      value.createEvent(credentials, calendarId, {
        allDay: false,
        calendarId: "11111111-1111-4111-8111-111111111111",
        endsAt: "2026-07-15T14:00:00.000Z",
        location: null,
        notes: null,
        startsAt: "2026-07-15T13:00:00.000Z",
        timezone: "UTC",
        title: "Sparse",
      }),
    ).resolves.toMatchObject({ etag: null });
    await expect(value.syncCalendar(credentials, calendarId, null)).resolves.toMatchObject({
      nextSyncToken: "1:",
    });
    await expect(
      value.updateEvent(credentials, calendarId, `${calendarId}event-1.ics`, null, {
        endsAt: "2026-07-15T16:00:00.000Z",
        startsAt: "2026-07-15T15:00:00.000Z",
      }),
    ).resolves.toMatchObject({ etag: null, timezone: "UTC" });

    const mail = await value.syncMail(credentials, null);
    expect(mail.mailboxes).toEqual([
      expect.objectContaining({ totalCount: 0, unreadCount: 0 }),
      expect.objectContaining({ totalCount: 1, unreadCount: 0 }),
    ]);
    expect(mail.threads[0]).toMatchObject({
      bodyText: "",
      from: { address: "anonymous@example.com", name: null },
      receivedAt: new Date(0),
      starred: false,
      subject: "(No subject)",
      unread: true,
    });
    expect(mail.threads[0]?.to.map((address) => address.address)).toEqual([
      "first@example.com",
      "second@example.com",
    ]);
    expect(mail.threads[0]?.messages?.[0]).toMatchObject({
      attachments: [
        expect.objectContaining({
          id: "INBOX:888:9:0",
          providerPartId: "INBOX:888:9:0",
        }),
      ],
      providerRevision: "888:9",
      remoteMessageId: "INBOX:888:9",
    });
    expect(release).toHaveBeenCalledTimes(2);
  });

  it("rejects a CalDAV object that mentions an event without containing one", async () => {
    const malformed = connector(
      davClient({
        fetchCalendarObjects: vi.fn(async () => [
          {
            data: "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nX-BAD:BEGIN:VEVENT\r\nEND:VCALENDAR\r\n",
            url: "event",
          },
        ]),
      }),
    ).value;
    await expect(malformed.syncCalendar(credentials, calendarId, null)).rejects.toThrow(
      "invalid calendar event",
    );
  });

  it("surfaces CalDAV and IMAP provider failures and rejected writes", async () => {
    const missing = connector(davClient({ fetchCalendars: vi.fn(async () => []) })).value;
    await expect(
      missing.createEvent(credentials, calendarId, {
        allDay: false,
        calendarId: "11111111-1111-4111-8111-111111111111",
        endsAt: "2026-07-15T14:00:00.000Z",
        location: null,
        notes: null,
        startsAt: "2026-07-15T13:00:00.000Z",
        timezone: "UTC",
        title: "Focus",
      }),
    ).rejects.toMatchObject({ status: 404 });

    const rejectedCreate = connector(
      davClient({ createCalendarObject: vi.fn(async () => response(500)) }),
    ).value;
    await expect(
      rejectedCreate.createEvent(credentials, calendarId, {
        allDay: false,
        calendarId: "11111111-1111-4111-8111-111111111111",
        endsAt: "2026-07-15T14:00:00.000Z",
        location: null,
        notes: null,
        startsAt: "2026-07-15T13:00:00.000Z",
        timezone: "UTC",
        title: "Focus",
      }),
    ).rejects.toThrow("rejected");

    const deleted = connector(
      davClient({ deleteCalendarObject: vi.fn(async () => response(404)) }),
    ).value;
    await expect(deleted.deleteEvent(credentials, "missing", null)).resolves.toBeUndefined();
    const rejectedDelete = connector(
      davClient({ deleteCalendarObject: vi.fn(async () => response(500)) }),
    ).value;
    await expect(rejectedDelete.deleteEvent(credentials, "event", null)).rejects.toThrow(
      "deletion",
    );

    const absentUpdate = connector(
      davClient({ fetchCalendarObjects: vi.fn(async () => []) }),
    ).value;
    await expect(
      absentUpdate.updateEvent(credentials, calendarId, "missing", null, { title: "Changed" }),
    ).rejects.toMatchObject({ status: 404 });
    const rejectedUpdate = connector(
      davClient({ updateCalendarObject: vi.fn(async () => response(500)) }),
    ).value;
    await expect(
      rejectedUpdate.updateEvent(credentials, calendarId, "event", null, { title: "Changed" }),
    ).rejects.toThrow("update");

    const invalid = connector(
      davClient({
        fetchCalendarObjects: vi.fn(async () => [
          { data: "BEGIN:VCALENDAR\r\nEND:VCALENDAR", url: "event" },
        ]),
      }),
    ).value;
    await expect(
      invalid.updateEvent(credentials, calendarId, "event", null, { title: "Changed" }),
    ).rejects.toThrow("invalid");

    const connectFailure = connector(davClient(), {
      connect: vi.fn(async () => {
        throw new Error("bad password");
      }),
      fetch: vi.fn(),
      getMailboxLock: vi.fn(),
      list: vi.fn(),
      logout: vi.fn(),
      mailbox: false,
    }).value;
    await expect(connectFailure.syncMail(credentials, null)).rejects.toMatchObject({
      category: "transport",
      disposition: "retry",
      status: null,
    });

    const authorizationFailure = connector(davClient(), {
      connect: vi.fn(async () => {
        throw { authenticationFailed: true };
      }),
      fetch: vi.fn(),
      getMailboxLock: vi.fn(),
      list: vi.fn(),
      logout: vi.fn(),
      mailbox: false,
    }).value;
    await expect(authorizationFailure.syncMail(credentials, null)).rejects.toMatchObject({
      category: "authorization",
      disposition: "reconnect",
    });

    const connectorFailure = createICloudConnector({
      createDavClient: vi.fn(async () => {
        throw new ConnectorError({
          category: "temporary",
          code: "icloud_calendar_temporary_failure",
          disposition: "retry",
          message: "iCloud Calendar is temporarily unavailable.",
          status: 503,
        });
      }),
    });
    await expect(connectorFailure.listCalendars(credentials)).rejects.toMatchObject({
      status: 503,
    });
  });
});
