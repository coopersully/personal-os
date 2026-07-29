import { simpleParser } from "mailparser";
import {
  ConnectorError,
  createGoogleConnector,
  MailSendPreAcceptanceError,
  projectGmailAttachments,
} from "./google.js";
import {
  calendarAttachmentProjectionOverflow,
  MAX_MAIL_ATTACHMENT_METADATA_LENGTH,
  MAX_MAIL_CALENDAR_PARTS_PER_MESSAGE,
  MAX_MAIL_MIME_DEPTH,
} from "./mail-attachments.js";
import type { GoogleCredentials } from "./types.js";

const now = new Date("2026-07-13T12:00:00.000Z");
const fresh: GoogleCredentials = {
  accessToken: "access",
  expiresAt: "2026-07-13T14:00:00.000Z",
  refreshToken: "refresh",
  scope: "calendar",
  tokenType: "Bearer",
};
const expired: GoogleCredentials = { ...fresh, expiresAt: "2026-07-13T11:00:00.000Z" };
const timedEvent = {
  conferenceData: {
    entryPoints: [
      { entryPointType: "phone", uri: "tel:+15551234567" },
      { entryPointType: "video", uri: "https://meet.google.com/abc-defg-hij" },
    ],
  },
  id: "event/1",
  etag: "etag-1",
  summary: "Focus",
  description: "Notes",
  location: "Desk",
  start: { dateTime: "2026-07-13T13:00:00.000Z", timeZone: "America/New_York" },
  end: { dateTime: "2026-07-13T14:00:00.000Z" },
  status: "confirmed",
  recurrence: ["RRULE:FREQ=DAILY"],
};

function response(value: unknown, status = 200): Response {
  return status === 204 ? new Response(null, { status }) : Response.json(value, { status });
}

function connector(fetch: typeof globalThis.fetch, configured = true) {
  return createGoogleConnector({
    clientId: configured ? "client" : "",
    clientSecret: configured ? "secret" : "",
    redirectUri: "https://api.example.com/callback",
    fetch,
    now: () => now,
  });
}

function queued(...responses: Response[]) {
  return vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => {
    const next = responses.shift();
    if (!next) throw new Error("No queued response");
    return next;
  });
}

describe("Google Calendar connector", () => {
  it("bounds nested Gmail MIME trees and calendar attachment metadata", () => {
    let nested: Record<string, unknown> = {
      body: {},
      filename: "",
      mimeType: "text/plain",
      partId: "leaf",
      parts: [],
    };
    for (let depth = 0; depth <= MAX_MAIL_MIME_DEPTH; depth += 1) {
      nested = {
        body: {},
        filename: "",
        mimeType: "multipart/mixed",
        partId: `nested-${String(depth)}`,
        parts: [nested],
      };
    }
    expect(projectGmailAttachments(nested as never)).toEqual([
      calendarAttachmentProjectionOverflow("part:projection-overflow"),
    ]);

    const excessiveCalendarParts = {
      body: {},
      filename: "",
      headers: [],
      mimeType: "multipart/mixed",
      partId: "root",
      parts: Array.from({ length: MAX_MAIL_CALENDAR_PARTS_PER_MESSAGE + 1 }, (_, index) => ({
        body: { attachmentId: `body-${String(index)}`, size: 1 },
        filename: "",
        headers: [],
        mimeType: "text/calendar",
        partId: String(index),
        parts: [],
      })),
    };
    expect(projectGmailAttachments(excessiveCalendarParts)).toEqual([
      calendarAttachmentProjectionOverflow("part:projection-overflow"),
    ]);

    const oversizedIdentifier = {
      body: {},
      filename: "",
      headers: [],
      mimeType: "text/calendar",
      partId: "x".repeat(MAX_MAIL_ATTACHMENT_METADATA_LENGTH + 1),
      parts: [],
    };
    const overflow = projectGmailAttachments(oversizedIdentifier);
    expect(overflow).toEqual([calendarAttachmentProjectionOverflow("part:projection-overflow")]);
    expect(JSON.stringify(overflow)).not.toContain(oversizedIdentifier.partId);
  });

  it("builds authorization and exchanges an offline code", async () => {
    const fetch = queued(
      response({ access_token: "new", expires_in: 3600, refresh_token: "offline" }),
    );
    const google = connector(fetch);
    const url = new URL(google.authorizationUrl("state-value", "test@example.com"));
    expect(url.origin).toBe("https://accounts.google.com");
    expect(url.searchParams.get("state")).toBe("state-value");
    expect(url.searchParams.get("scope")).toContain("calendar.events");
    expect(url.searchParams.get("scope")).toContain("gmail.modify");
    expect(url.searchParams.get("scope")).toContain("gmail.send");
    expect(url.searchParams.get("login_hint")).toBe("test@example.com");
    await expect(google.exchangeCode("code")).resolves.toEqual({
      accessToken: "new",
      expiresAt: "2026-07-13T13:00:00.000Z",
      refreshToken: "offline",
      scope: "",
      tokenType: "Bearer",
    });
    expect(String(fetch.mock.calls[0]?.[0])).toBe("https://oauth2.googleapis.com/token");
    expect(String(fetch.mock.calls[0]?.[1]?.body)).toContain("grant_type=authorization_code");

    expect(() => connector(fetch, false).authorizationUrl("state")).toThrow("not configured");
    await expect(
      connector(queued(response({ access_token: "new", expires_in: 3600 }))).exchangeCode("code"),
    ).rejects.toMatchObject({ name: "ConnectorError", status: 400 });
  });

  it("requests only the Google services selected during setup", () => {
    const google = connector(queued());
    const calendarScopes = new URL(
      google.authorizationUrl("calendar-state", undefined, ["calendar"]),
    ).searchParams.get("scope");
    const mailScopes = new URL(
      google.authorizationUrl("mail-state", undefined, ["mail"]),
    ).searchParams.get("scope");

    expect(calendarScopes).toContain("calendar.events");
    expect(calendarScopes).not.toContain("gmail.modify");
    expect(mailScopes).toContain("gmail.modify");
    expect(mailScopes).toContain("gmail.send");
    expect(mailScopes).not.toContain("calendar.events");
  });

  it("refreshes credentials and reads a paginated profile and calendar list", async () => {
    const fetch = queued(
      response({
        access_token: "refreshed",
        expires_in: 7200,
        refresh_token: "refresh-2",
        scope: "scope-2",
        token_type: "Custom",
      }),
      response({
        email: "test@example.com",
        id: "profile",
        name: "Test User",
        picture: "https://example.com/profile.png",
      }),
      response({
        items: [
          {
            id: "one",
            summary: "Primary",
            accessRole: "owner",
            backgroundColor: "#123456",
            primary: true,
            selected: false,
            timeZone: "America/New_York",
          },
        ],
        nextPageToken: "page-2",
      }),
      response({ items: [{ id: "two", summary: "Holidays", accessRole: "reader" }] }),
    );
    const google = connector(fetch);
    const profile = await google.getProfile(expired);
    expect(profile.value).toEqual({
      email: "test@example.com",
      id: "profile",
      name: "Test User",
      pictureUrl: "https://example.com/profile.png",
    });
    expect(profile.credentials).toMatchObject({
      accessToken: "refreshed",
      refreshToken: "refresh-2",
      scope: "scope-2",
      tokenType: "Custom",
    });
    const calendars = await google.listCalendars(profile.credentials);
    expect(calendars.value).toEqual([
      {
        accessRole: "owner",
        color: "#123456",
        id: "one",
        name: "Primary",
        primary: true,
        selected: false,
        timezone: "America/New_York",
        writable: true,
      },
      {
        accessRole: "reader",
        color: null,
        id: "two",
        name: "Holidays",
        primary: false,
        selected: true,
        timezone: "UTC",
        writable: false,
      },
    ]);
    expect(String(fetch.mock.calls[3]?.[0])).toContain("pageToken=page-2");
    expect(new Headers(fetch.mock.calls[1]?.[1]?.headers).get("authorization")).toBe(
      "Bearer refreshed",
    );
  });

  it("creates, updates, and deletes timed and all-day events", async () => {
    const fetch = queued(
      response(timedEvent),
      response({
        id: "event-2",
        start: { date: "2026-07-14" },
        end: { date: "2026-07-15" },
        status: "tentative",
      }),
      response({
        ...timedEvent,
        summary: undefined,
        start: { dateTime: "2026-07-13T13:00:00.000Z" },
        end: { dateTime: "2026-07-13T14:00:00.000Z", timeZone: "Europe/London" },
      }),
      response(null, 204),
      response(null, 204),
    );
    const google = connector(fetch);
    const created = await google.createEvent(fresh, "primary/id", {
      calendarId: "11111111-1111-4111-8111-111111111111",
      title: "Focus",
      notes: "Notes",
      location: "Desk",
      startsAt: "2026-07-13T13:00:00.000Z",
      endsAt: "2026-07-13T14:00:00.000Z",
      timezone: "America/New_York",
      allDay: false,
    });
    expect(created.value).toMatchObject({
      title: "Focus",
      allDay: false,
      timezone: "America/New_York",
      etag: "etag-1",
      conferenceUrl: "https://meet.google.com/abc-defg-hij",
      notes: "Notes",
      location: "Desk",
      recurrence: ["RRULE:FREQ=DAILY"],
    });
    expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toMatchObject({
      summary: "Focus",
      start: { dateTime: "2026-07-13T13:00:00.000Z", timeZone: "America/New_York" },
    });

    const allDay = await google.createEvent(fresh, "primary", {
      calendarId: "11111111-1111-4111-8111-111111111111",
      title: "Holiday",
      notes: null,
      location: null,
      startsAt: "2026-07-14T04:00:00.000Z",
      endsAt: "2026-07-15T04:00:00.000Z",
      timezone: "America/New_York",
      allDay: true,
    });
    expect(allDay.value).toMatchObject({
      allDay: true,
      title: "Untitled event",
      etag: null,
      notes: null,
      location: null,
      recurrence: [],
      timezone: "America/New_York",
    });
    expect(JSON.parse(String(fetch.mock.calls[1]?.[1]?.body))).toMatchObject({
      start: { date: "2026-07-14" },
      end: { date: "2026-07-15" },
    });

    const updated = await google.updateEvent(fresh, "primary", "event/1", "etag-1", {
      notes: null,
    });
    expect(updated.value).toMatchObject({ title: "Untitled event", timezone: "Europe/London" });
    expect(new Headers(fetch.mock.calls[2]?.[1]?.headers).get("if-match")).toBe("etag-1");
    expect(JSON.parse(String(fetch.mock.calls[2]?.[1]?.body))).toEqual({ description: null });
    await expect(google.deleteEvent(fresh, "primary", "event/1", "etag-1")).resolves.toEqual(fresh);
    await expect(google.deleteEvent(fresh, "primary", "event/1", null)).resolves.toEqual(fresh);
    expect(new Headers(fetch.mock.calls[3]?.[1]?.headers).get("if-match")).toBe("etag-1");
    expect(new Headers(fetch.mock.calls[4]?.[1]?.headers).has("if-match")).toBe(false);
  });

  it("syncs pages, normalizes deletions, and resets an expired sync token", async () => {
    const fetch = queued(
      response({
        items: [
          timedEvent,
          { id: "gone", status: "cancelled" },
          { id: "incomplete", status: "confirmed" },
        ],
        nextPageToken: "p2",
      }),
      response({ items: [], nextSyncToken: "sync-2" }),
      new Response("expired", { status: 410 }),
      response({ items: [timedEvent], nextSyncToken: "sync-reset" }),
    );
    const google = connector(fetch);
    const result = await google.syncCalendar(fresh, "primary", null);
    expect(result.value).toMatchObject({ nextSyncToken: "sync-2", reset: false });
    expect(result.value.changes.map((change) => change.kind)).toEqual([
      "upsert",
      "delete",
      "delete",
    ]);
    expect(String(fetch.mock.calls[1]?.[0])).toContain("pageToken=p2");
    const reset = await google.syncCalendar(fresh, "primary", "old-sync");
    expect(reset.value).toMatchObject({ nextSyncToken: "sync-reset", reset: true });
    expect(String(fetch.mock.calls[3]?.[0])).not.toContain("syncToken=");
  });

  it("syncs Gmail labels and normalized read-only conversations", async () => {
    const encoded = (value: string) => Buffer.from(value).toString("base64url");
    const fetch = queued(
      response({
        labels: [
          { id: "INBOX", name: "Inbox", messagesTotal: 4, messagesUnread: 2 },
          { id: "SENT", name: "Sent" },
          { id: "DRAFT", name: "Drafts" },
          { id: "SPAM", name: "Spam" },
          { id: "TRASH", name: "Trash" },
          { id: "ALL", name: "All Mail" },
          { id: "CATEGORY_PERSONAL", name: "Personal" },
          { id: "Label_1", name: "Projects", type: "USER" },
        ],
      }),
      response({ threads: [{ id: "thread/1" }, { id: "thread-2" }], nextPageToken: "next" }),
      response({ threads: [{ id: "thread-3" }, { id: "thread-4" }] }),
      response({
        id: "thread/1",
        messages: [
          {
            id: "m1",
            internalDate: "1783958400000",
            labelIds: ["INBOX", "UNREAD", "STARRED"],
            payload: { headers: [], mimeType: "multipart/alternative", parts: [] },
          },
          {
            historyId: "history-2",
            id: "m2",
            internalDate: "1783958460000",
            labelIds: ["INBOX"],
            payload: {
              headers: [
                { name: "Subject", value: "Project update" },
                { name: "From", value: '"Ada Lovelace" <ada@example.com>' },
                { name: "To", value: '"Example User" <user@example.com>, other@example.com' },
              ],
              mimeType: "multipart/alternative",
              parts: [
                { body: "invalid" },
                { body: { data: encoded("Plain body") }, headers: [], mimeType: "text/plain" },
                {
                  body: { attachmentId: "attachment-1", size: 42 },
                  filename: "brief.pdf",
                  headers: [],
                  mimeType: "application/pdf",
                  partId: "2",
                },
                {
                  body: { data: encoded("BEGIN:VCALENDAR"), size: 15 },
                  filename: "",
                  headers: [],
                  mimeType: "text/calendar; method=REQUEST",
                  partId: "3",
                },
                {
                  body: { attachmentId: "calendar-attachment-1", size: 84 },
                  filename: "invite.ics",
                  headers: [],
                  mimeType: "text/calendar",
                  partId: "4",
                },
              ],
            },
            snippet: "Project update preview",
          },
        ],
      }),
      response({
        id: "thread-2",
        messages: [
          {
            id: "m3",
            internalDate: "invalid",
            payload: {
              body: { data: encoded("Fallback body") },
              headers: [],
              mimeType: "text/html",
            },
          },
        ],
      }),
      response({
        id: "thread-3",
        messages: [
          {
            id: "m4",
            internalDate: "1783958520000",
            payload: {
              body: { data: encoded("Direct body") },
              headers: [{ name: "From", value: "direct@example.com" }],
              mimeType: "text/plain",
            },
          },
        ],
      }),
      response({
        id: "thread-4",
        messages: [
          {
            id: "m5",
            payload: {
              headers: [{ name: "From", value: "<anonymous@example.com>" }],
              mimeType: "text/plain",
            },
          },
        ],
      }),
    );
    const syncMail = connector(fetch).syncMail;
    if (!syncMail) throw new Error("Google Mail connector is missing.");
    const result = await syncMail(fresh);
    expect(result.value.mailboxes.map((mailbox) => mailbox.role)).toEqual([
      "inbox",
      "sent",
      "drafts",
      "spam",
      "trash",
      "archive",
      "archive",
      "custom",
    ]);
    expect(result.value.threads[0]).toMatchObject({
      bodyText: "Plain body",
      from: { address: "ada@example.com", name: "Ada Lovelace" },
      mailboxIds: ["INBOX", "UNREAD", "STARRED"],
      messagesComplete: true,
      messageCount: 2,
      remoteThreadId: "thread/1",
      starred: true,
      subject: "Project update",
      to: [
        { address: "user@example.com", name: "Example User" },
        { address: "other@example.com", name: null },
      ],
      unread: true,
    });
    expect(result.value.threads[0]?.messages?.[1]?.attachments).toEqual([
      {
        contentType: "application/pdf",
        filename: "brief.pdf",
        id: "attachment-1",
        providerAttachmentId: "attachment-1",
        providerPartId: "2",
        size: 42,
      },
      {
        contentType: "text/calendar; method=REQUEST",
        filename: "",
        id: "part:3",
        providerAttachmentId: null,
        providerPartId: "3",
        size: 15,
      },
      {
        contentType: "text/calendar",
        filename: "invite.ics",
        id: "calendar-attachment-1",
        providerAttachmentId: "calendar-attachment-1",
        providerPartId: "4",
        size: 84,
      },
    ]);
    expect(result.value.threads[0]?.messages?.[1]).toMatchObject({
      mailboxIds: ["INBOX"],
      providerRevision: "history-2",
    });
    expect(result.value.threads[1]).toMatchObject({
      bodyText: "Fallback body",
      receivedAt: new Date(0),
      subject: "(No subject)",
    });
    expect(result.value.threads[2]?.bodyText).toBe("Direct body");
    expect(result.value.threads[3]).toMatchObject({
      from: { address: "anonymous@example.com", name: null },
      receivedAt: new Date(0),
    });
    expect(String(fetch.mock.calls[2]?.[0])).toContain("pageToken=next");
  });

  it("caps a Gmail synchronization at one hundred conversations", async () => {
    const threadIds = Array.from({ length: 100 }, (_, index) => ({ id: `thread-${index}` }));
    let activeThreadRequests = 0;
    let maximumThreadRequests = 0;
    const fetch = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/labels")) return response({ labels: [] });
      if (url.pathname.endsWith("/threads")) {
        return response({ nextPageToken: "ignored", threads: threadIds });
      }
      activeThreadRequests += 1;
      maximumThreadRequests = Math.max(maximumThreadRequests, activeThreadRequests);
      await Promise.resolve();
      activeThreadRequests -= 1;
      return response({
        id: url.pathname.split("/").at(-1),
        messages: [{ id: "message", payload: { mimeType: "text/plain" } }],
      });
    });
    const syncMail = connector(fetch).syncMail;
    if (!syncMail) throw new Error("Google Mail connector is missing.");
    const result = await syncMail(fresh);
    expect(result.value.threads).toHaveLength(100);
    expect(fetch).toHaveBeenCalledTimes(102);
    expect(maximumThreadRequests).toBe(1);
  });

  it("writes Gmail labels and sends composed mail", async () => {
    const fetch = queued(response({}), response({}), response({}), response({}), response({}));
    const google = connector(fetch);
    if (!google.updateMailThread || !google.sendMail)
      throw new Error("Google Mail writes are missing.");
    await google.updateMailThread(fresh, "thread/1", {
      addMailboxIds: ["STARRED"],
      removeMailboxIds: ["UNREAD"],
    });
    await google.sendMail(fresh, {
      body: "Hello",
      cc: [{ address: "cc@example.com", name: 'Zoë "Ops, Inc."' }],
      from: "sender@example.com",
      subject: "Résumé, review",
      threadId: "thread/1",
      to: [{ address: "to@example.com", name: 'Renée "Primary, Team"' }],
    });
    await google.sendMail(fresh, {
      body: "Hello",
      cc: [],
      from: "sender@example.com",
      subject: "Subject",
      to: [{ address: "to@example.com", name: null }],
    });
    await google.sendMail(fresh, {
      body: "Hello",
      cc: [],
      from: "sender@example.com",
      subject: "Safe\r\nBcc: attacker@example.com",
      to: [
        {
          address: "to@example.com",
          name: "Visible\r\nBcc: attacker@example.com",
        },
      ],
    });
    await google.sendMail(fresh, {
      body: "No subject",
      cc: [],
      from: "sender@example.com",
      subject: "",
      to: [{ address: "to@example.com", name: null }],
    });
    expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toEqual({
      addLabelIds: ["STARRED"],
      removeLabelIds: ["UNREAD"],
    });
    const firstMessage = JSON.parse(String(fetch.mock.calls[1]?.[1]?.body));
    expect(firstMessage.threadId).toBe("thread/1");
    const parsedFirst = await simpleParser(Buffer.from(firstMessage.raw, "base64url"));
    expect(parsedFirst.subject).toBe("Résumé, review");
    const parsedFirstTo = Array.isArray(parsedFirst.to)
      ? parsedFirst.to.flatMap((value) => value.value)
      : parsedFirst.to?.value;
    const parsedFirstCc = Array.isArray(parsedFirst.cc)
      ? parsedFirst.cc.flatMap((value) => value.value)
      : parsedFirst.cc?.value;
    expect(parsedFirstTo).toEqual([{ address: "to@example.com", name: 'Renée "Primary, Team"' }]);
    expect(parsedFirstCc).toEqual([{ address: "cc@example.com", name: 'Zoë "Ops, Inc."' }]);
    expect(parsedFirst.from?.value).toEqual([{ address: "sender@example.com", name: "" }]);
    const secondMessage = JSON.parse(String(fetch.mock.calls[2]?.[1]?.body));
    expect(secondMessage.threadId).toBeUndefined();
    expect(Buffer.from(secondMessage.raw, "base64url").toString()).toContain("To: to@example.com");
    const injectedMessage = JSON.parse(String(fetch.mock.calls[3]?.[1]?.body));
    const parsedInjected = await simpleParser(Buffer.from(injectedMessage.raw, "base64url"));
    expect(parsedInjected.headers.has("bcc")).toBe(false);
    const injectedRecipients = Array.isArray(parsedInjected.to)
      ? parsedInjected.to.flatMap((value) => value.value)
      : (parsedInjected.to?.value ?? []);
    expect(injectedRecipients.map((recipient) => recipient.address)).toEqual(["to@example.com"]);
    expect(Buffer.from(injectedMessage.raw, "base64url").toString()).not.toContain(
      "\r\nBcc: attacker@example.com",
    );
    const emptySubjectMessage = JSON.parse(String(fetch.mock.calls[4]?.[1]?.body));
    const parsedEmptySubject = await simpleParser(
      Buffer.from(emptySubjectMessage.raw, "base64url"),
    );
    expect(parsedEmptySubject.subject ?? "").toBe("");
  });

  it("reads exact minimal Gmail state and uses recoverable Trash", async () => {
    const fetch = queued(
      response({
        id: "thread/1",
        messages: [
          { id: "message-1", labelIds: ["INBOX", "UNREAD"] },
          { id: "message-2", labelIds: ["STARRED"] },
        ],
      }),
      response({ id: "thread/1", messages: [] }),
    );
    const google = connector(fetch);
    if (!google.getMailThreadState || !google.trashMailThread)
      throw new Error("Google Mail durable-work operations are missing.");
    await expect(google.getMailThreadState(fresh, "thread/1")).resolves.toEqual({
      credentials: fresh,
      value: {
        mailboxIds: ["INBOX", "UNREAD", "STARRED"],
        remoteThreadId: "thread/1",
        starred: true,
        unread: true,
      },
    });
    await expect(google.trashMailThread(fresh, "thread/1")).resolves.toEqual(fresh);
    expect(String(fetch.mock.calls[0]?.[0])).toContain("thread%2F1?format=minimal");
    expect(String(fetch.mock.calls[1]?.[0])).toContain("thread%2F1/trash");
    expect(fetch.mock.calls[1]?.[1]).toMatchObject({ method: "POST" });
  });

  it("distinguishes pre-request Mail send failures from ambiguous provider outcomes", async () => {
    const input = {
      body: "Hello",
      cc: [],
      from: "sender@example.com",
      subject: "Subject",
      to: [{ address: "to@example.com", name: null }],
    };
    for (const status of [400, 401, 500]) {
      const sendMail = connector(queued(new Response(`status ${status}`, { status }))).sendMail;
      if (!sendMail) throw new Error("Google Mail send is unavailable.");
      await expect(sendMail(fresh, input)).rejects.toMatchObject({
        name: "ConnectorError",
        status,
      });
    }
    const timeout = new DOMException("Timed out", "AbortError");
    const timeoutFetch = vi.fn(async () => {
      throw timeout;
    });
    const timedSend = connector(timeoutFetch).sendMail;
    if (!timedSend) throw new Error("Google Mail send is unavailable.");
    await expect(timedSend(fresh, input)).rejects.toBe(timeout);

    const refreshRejected = connector(
      queued(new Response("refresh rejected", { status: 401 })),
    ).sendMail;
    if (!refreshRejected) throw new Error("Google Mail send is unavailable.");
    await expect(refreshRejected(expired, input)).rejects.toBeInstanceOf(
      MailSendPreAcceptanceError,
    );
  });

  it("surfaces provider, synchronization, and malformed-event failures", async () => {
    const google = connector(queued(new Response("unavailable", { status: 503 })));
    await expect(google.getProfile(fresh)).rejects.toMatchObject({
      name: "ConnectorError",
      status: 503,
      message: expect.stringContaining("unavailable"),
    });
    await expect(
      connector(queued(response({ items: [] }))).syncCalendar(fresh, "primary", null),
    ).rejects.toThrow("synchronization token");
    await expect(
      connector(queued(new Response("bad", { status: 500 }))).syncCalendar(
        fresh,
        "primary",
        "sync",
      ),
    ).rejects.toMatchObject({ status: 500 });
    await expect(
      connector(queued(response({ id: "missing-range", status: "confirmed" }))).createEvent(
        fresh,
        "primary",
        {
          calendarId: "11111111-1111-4111-8111-111111111111",
          title: "Missing range",
          notes: null,
          location: null,
          startsAt: "2026-07-13T13:00:00.000Z",
          endsAt: "2026-07-13T14:00:00.000Z",
          timezone: "UTC",
          allDay: false,
        },
      ),
    ).rejects.toThrow("without start or end");
    await expect(
      connector(
        queued(response({ id: "broken", start: {}, end: {}, status: "confirmed" })),
      ).createEvent(fresh, "primary", {
        calendarId: "11111111-1111-4111-8111-111111111111",
        title: "Broken",
        notes: null,
        location: null,
        startsAt: "2026-07-13T13:00:00.000Z",
        endsAt: "2026-07-13T14:00:00.000Z",
        timezone: "UTC",
        allDay: false,
      }),
    ).rejects.toBeInstanceOf(ConnectorError);
    await expect(
      connector(
        queued(
          response({
            id: "broken",
            start: { dateTime: "bad" },
            end: { dateTime: "also-bad" },
            status: "confirmed",
          }),
        ),
      ).createEvent(fresh, "primary", {
        calendarId: "11111111-1111-4111-8111-111111111111",
        title: "Broken",
        notes: null,
        location: null,
        startsAt: "2026-07-13T13:00:00.000Z",
        endsAt: "2026-07-13T14:00:00.000Z",
        timezone: "UTC",
        allDay: false,
      }),
    ).rejects.toThrow("invalid dates");
    const error = new ConnectorError("x", 418);
    expect(error.name).toBe("ConnectorError");
    expect(error.status).toBe(418);
  });

  it("uses credential, profile, clock, etag, and timezone fallbacks", async () => {
    const fetch = queued(
      response({ access_token: "fallback", expires_in: 3600, scope: "", token_type: "Bearer" }),
      response({ email: "fallback@example.com", id: "fallback" }),
      response(timedEvent),
      response(timedEvent),
    );
    const google = connector(fetch);
    const profile = await google.getProfile(expired);
    expect(profile.credentials).toMatchObject({ refreshToken: "refresh", scope: "calendar" });
    expect(profile.value.name).toBeNull();
    await google.updateEvent(fresh, "primary", "event", null, { title: "No etag" });
    expect(new Headers(fetch.mock.calls[2]?.[1]?.headers).has("if-match")).toBe(false);

    await google.updateEvent(fresh, "primary", "event", null, {
      allDay: true,
      endsAt: "2026-07-15T00:00:00.000Z",
      startsAt: "2026-07-14T00:00:00.000Z",
    });
    expect(JSON.parse(String(fetch.mock.calls[3]?.[1]?.body))).toMatchObject({
      end: { date: "2026-07-15" },
      start: { date: "2026-07-14" },
    });

    const realClock = createGoogleConnector({
      clientId: "client",
      clientSecret: "secret",
      fetch: queued(response(timedEvent)),
      redirectUri: "https://api.example.com/callback",
    });
    await expect(
      realClock.createEvent({ ...fresh, expiresAt: "2099-01-01T00:00:00.000Z" }, "primary", {
        calendarId: "11111111-1111-4111-8111-111111111111",
        title: "Real clock",
        notes: null,
        location: null,
        startsAt: "2026-07-13T13:00:00.000Z",
        endsAt: "2026-07-13T14:00:00.000Z",
        timezone: "UTC",
        allDay: false,
      }),
    ).resolves.toBeDefined();
  });

  it("writes Gmail thread labels and sends RFC 2822 mail", async () => {
    const fetch = queued(response({}), response({ id: "sent" }));
    const google = connector(fetch);
    if (!google.updateMailThread || !google.sendMail)
      throw new Error("Mail writes are unavailable.");
    await expect(
      google.updateMailThread(fresh, "thread/1", {
        addMailboxIds: ["STARRED"],
        removeMailboxIds: ["UNREAD"],
      }),
    ).resolves.toEqual(fresh);
    expect(String(fetch.mock.calls[0]?.[0])).toContain("thread%2F1/modify");
    expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toEqual({
      addLabelIds: ["STARRED"],
      removeLabelIds: ["UNREAD"],
    });

    await expect(
      google.sendMail(fresh, {
        body: "Hello",
        cc: [{ address: "cc@example.com", name: "CC" }],
        from: "sender@example.com",
        subject: "Hello there",
        threadId: "thread/1",
        to: [{ address: "to@example.com", name: "To" }],
      }),
    ).resolves.toEqual(fresh);
    const sent = JSON.parse(String(fetch.mock.calls[1]?.[1]?.body));
    expect(sent.threadId).toBe("thread/1");
    expect(Buffer.from(sent.raw, "base64url").toString()).toContain("Cc: CC <cc@example.com>");
    expect(Buffer.from(sent.raw, "base64url").toString()).toContain("From: sender@example.com");
    expect(Buffer.from(sent.raw, "base64url").toString()).toContain("Subject: Hello there");
  });
});
