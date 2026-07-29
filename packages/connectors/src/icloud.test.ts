import { ConnectorError } from "./google.js";
import { createICloudConnector } from "./icloud.js";

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
    updateCalendarObject: vi.fn(async () => response(200, "etag-updated")),
    ...overrides,
  };
}

function connector(
  client = davClient(),
  imap?: Record<string, unknown>,
  createSmtpTransport?: () => { close: () => void; sendMail: (input: unknown) => Promise<unknown> },
) {
  return {
    client,
    value: createICloudConnector({
      createDavClient: vi.fn(async () => client as never),
      ...(imap ? { createImapClient: vi.fn(() => imap as never) } : {}),
      ...(createSmtpTransport ? { createSmtpTransport } : {}),
    }),
  };
}

describe("iCloud connector", () => {
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
      getMailboxLock: vi.fn(async () => ({ release })),
      list: vi.fn(async () => [
        {
          flags: new Set<string>(),
          name: "Inbox",
          path: "INBOX",
          status: { messages: 3, unseen: 2 },
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
    const result = await value.syncMail(credentials);
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
      remoteThreadId: "INBOX:2",
      starred: true,
      subject: "Hello from iCloud",
      to: [{ address: "user@example.com", name: "Example User" }],
      unread: true,
    });
    expect(result.threads[1]).toMatchObject({
      from: { address: "", name: null },
      remoteThreadId: "INBOX:3",
      unread: false,
    });
    expect(release).toHaveBeenCalledOnce();
    expect(imap.logout).toHaveBeenCalledOnce();
  });

  it("sends iCloud mail through the authenticated SMTP transport", async () => {
    const transport = { close: vi.fn(), sendMail: vi.fn(async () => undefined) };
    const { value } = connector(davClient(), undefined, () => transport);
    if (!value.sendMail) throw new Error("Mail sending is unavailable.");
    await value.sendMail(credentials, {
      body: "Hello",
      cc: [{ address: "cc@example.com", name: "CC" }],
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
        subject: "Subject",
        to: [{ address: "to@example.com", name: null }],
      }),
    ).rejects.toMatchObject({ status: 401 });
    expect(failingTransport.close).toHaveBeenCalledOnce();
  });

  it("writes iCloud flags and mailbox moves through IMAP", async () => {
    const release = vi.fn();
    const imap = {
      connect: vi.fn(async () => undefined),
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
    await value.updateMailThread(credentials, "INBOX:42", {
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
    const sparseImap = {
      connect: vi.fn(async () => undefined),
      fetch: vi.fn(async function* () {
        yield { source: raw, uid: 9 };
      }),
      getMailboxLock: vi.fn(async () => ({ release })),
      list: vi.fn(async () => [
        { flags: new Set<string>(), name: "Empty", path: "Empty" },
        { flags: new Set<string>(), name: "Inbox", path: "INBOX", status: { messages: 1 } },
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

    const mail = await value.syncMail(credentials);
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
    expect(release).toHaveBeenCalledOnce();
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
    }).value;
    await expect(connectFailure.syncMail(credentials)).rejects.toMatchObject({ status: 401 });

    const connectorFailure = createICloudConnector({
      createDavClient: vi.fn(async () => {
        throw new ConnectorError("CalDAV unavailable", 503);
      }),
    });
    await expect(connectorFailure.listCalendars(credentials)).rejects.toMatchObject({
      status: 503,
    });
  });
});
