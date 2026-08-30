import { ConnectorError } from "./failures.js";
import {
  createGoogleConnector,
  googleGrantedServices,
  googleMailSendGranted,
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
    createRequest: { status: { statusCode: "success" } },
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
    const url = new URL(
      google.authorizationUrl("state-value", "pkce-challenge", "test@example.com"),
    );
    expect(url.origin).toBe("https://accounts.google.com");
    expect(url.searchParams.get("state")).toBe("state-value");
    expect(url.searchParams.get("scope")).toContain("calendar.events");
    expect(url.searchParams.get("scope")).toContain("gmail.modify");
    expect(url.searchParams.get("scope")).toContain("gmail.send");
    expect(url.searchParams.get("login_hint")).toBe("test@example.com");
    expect(url.searchParams.get("code_challenge")).toBe("pkce-challenge");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.toString()).not.toContain("pkce-verifier");
    await expect(
      google.exchangeCode("code", "pkce-verifier", "https://original.example.com/callback"),
    ).resolves.toEqual({
      accessToken: "new",
      expiresAt: "2026-07-13T13:00:00.000Z",
      refreshToken: "offline",
      scope: "",
      tokenType: "Bearer",
    });
    expect(String(fetch.mock.calls[0]?.[0])).toBe("https://oauth2.googleapis.com/token");
    expect(String(fetch.mock.calls[0]?.[1]?.body)).toContain("grant_type=authorization_code");
    expect(String(fetch.mock.calls[0]?.[1]?.body)).toContain("code_verifier=pkce-verifier");
    expect(String(fetch.mock.calls[0]?.[1]?.body)).toContain(
      "redirect_uri=https%3A%2F%2Foriginal.example.com%2Fcallback",
    );

    expect(() => connector(fetch, false).authorizationUrl("state", "challenge")).toThrow(
      "not configured",
    );
    await expect(
      connector(queued(response({ access_token: "new", expires_in: 3600 }))).exchangeCode(
        "code",
        "verifier",
      ),
    ).rejects.toMatchObject({ name: "ConnectorError", status: 400 });
  });

  it("requests only the Google services selected during setup", () => {
    const google = connector(queued());
    const calendarScopes = new URL(
      google.authorizationUrl("calendar-state", "calendar-challenge", undefined, ["calendar"]),
    ).searchParams.get("scope");
    const mailScopes = new URL(
      google.authorizationUrl("mail-state", "mail-challenge", undefined, ["mail"]),
    ).searchParams.get("scope");

    expect(calendarScopes).toContain("calendar.events");
    expect(calendarScopes).not.toContain("gmail.modify");
    expect(mailScopes).toContain("gmail.modify");
    expect(mailScopes).toContain("gmail.send");
    expect(mailScopes).not.toContain("calendar.events");
  });

  it("derives enabled services only from the complete granted scope set", () => {
    const credentialsWith = (scope: string): GoogleCredentials => ({ ...fresh, scope });
    expect(
      googleGrantedServices(
        credentialsWith(
          [
            "openid",
            "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
            "https://www.googleapis.com/auth/calendar.events",
            "https://www.googleapis.com/auth/gmail.modify",
          ].join(" "),
        ),
      ),
    ).toEqual(["calendar", "mail"]);
    expect(
      googleGrantedServices(
        credentialsWith(
          "https://www.googleapis.com/auth/calendar.calendarlist.readonly https://www.googleapis.com/auth/gmail.modify",
        ),
      ),
    ).toEqual(["mail"]);
    expect(
      googleGrantedServices(
        credentialsWith(
          "https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.calendarlist.readonly",
        ),
      ),
    ).toEqual(["calendar"]);
    expect(
      googleGrantedServices(credentialsWith("https://www.googleapis.com/auth/gmail.modify")),
    ).toEqual(["mail"]);
    expect(
      googleGrantedServices(credentialsWith("https://www.googleapis.com/auth/gmail.send")),
    ).toEqual([]);
    expect(
      googleMailSendGranted(credentialsWith("https://www.googleapis.com/auth/gmail.send")),
    ).toBe(true);
    expect(
      googleMailSendGranted(credentialsWith("https://www.googleapis.com/auth/gmail.modify")),
    ).toBe(false);
    expect(googleMailSendGranted(credentialsWith("https://mail.google.com/"))).toBe(true);
    expect(
      googleGrantedServices(credentialsWith("https://www.googleapis.com/auth/calendar")),
    ).toEqual(["calendar"]);
    expect(
      googleGrantedServices(
        credentialsWith(
          "https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/calendar.events",
        ),
      ),
    ).toEqual(["calendar"]);
    expect(googleGrantedServices(credentialsWith("https://mail.google.com/"))).toEqual(["mail"]);
    expect(googleGrantedServices(credentialsWith(""))).toEqual([]);
  });

  it("submits a plain-text message once with the confirmed provider thread", async () => {
    const fetch = queued(response({ id: "message-1", threadId: "thread-1" }));
    const google = connector(fetch);
    if (!google.sendMail) throw new Error("Google Mail delivery capability is missing.");

    await expect(
      google.sendMail(
        {
          ...fresh,
          scope:
            "https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/gmail.send",
        },
        {
          body: "Prepared response",
          cc: [{ address: "copy@example.com", name: null }],
          from: "sender@example.com",
          subject: "Follow up",
          threadId: "thread-1",
          to: [{ address: "person@example.com", name: "Person" }],
        },
      ),
    ).resolves.toMatchObject({ accessToken: "access" });

    expect(String(fetch.mock.calls[0]?.[0])).toBe(
      "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
    );
    const body = JSON.parse(String(fetch.mock.calls[0]?.[1]?.body)) as {
      raw: string;
      threadId: string;
    };
    expect(body.threadId).toBe("thread-1");
    expect(Buffer.from(body.raw, "base64url").toString()).toContain("person@example.com");
  });

  it("classifies credential failure before provider submission as known non-acceptance", async () => {
    const fetch = queued(response({ error: "invalid_grant" }, 400));
    const google = connector(fetch);
    if (!google.sendMail) throw new Error("Google Mail delivery capability is missing.");

    await expect(
      google.sendMail(expired, {
        body: "Prepared response",
        cc: [],
        from: "sender@example.com",
        subject: "Follow up",
        to: [{ address: "person@example.com", name: null }],
      }),
    ).rejects.toMatchObject({ name: "MailSendPreAcceptanceError" });
    expect(String(fetch.mock.calls[0]?.[0])).toBe("https://oauth2.googleapis.com/token");
    expect(fetch).toHaveBeenCalledOnce();
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

  it("aborts an in-flight multi-page calendar sync before fetching more pages", async () => {
    const controller = new AbortController();
    const interrupted = new Error("runtime quiescing");
    let markSecondPageStarted: () => void = () => {};
    const secondPageStarted = new Promise<void>((resolve) => {
      markSecondPageStarted = resolve;
    });
    const fetch = vi.fn(
      async (_input: string | URL | Request, init?: RequestInit): Promise<Response> => {
        if (fetch.mock.calls.length === 1) {
          return response({ items: [], nextPageToken: "page-2" });
        }
        markSecondPageStarted();
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), {
            once: true,
          });
        });
      },
    );

    const sync = connector(fetch).syncCalendar(fresh, "calendar", null, {
      deadlineMs: Date.now() + 105_000,
      signal: controller.signal,
    });
    await secondPageStarted;
    controller.abort(interrupted);

    await expect(sync).rejects.toBe(interrupted);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("rejects an expired provider deadline before starting network work", async () => {
    const fetch = queued(response({ items: [] }));

    await expect(
      connector(fetch).syncCalendar(fresh, "calendar", null, {
        deadlineMs: Date.now() - 1,
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({ name: "TimeoutError" });
    expect(fetch).not.toHaveBeenCalled();
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
      conferenceProvider: "google_meet",
    });
    expect(created.value).toMatchObject({
      title: "Focus",
      allDay: false,
      timezone: "America/New_York",
      etag: "etag-1",
      conferenceUrl: "https://meet.google.com/abc-defg-hij",
      conferenceStatus: "success",
      notes: "Notes",
      location: "Desk",
      recurrence: ["RRULE:FREQ=DAILY"],
    });
    expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toMatchObject({
      conferenceData: {
        createRequest: {
          conferenceSolutionKey: { type: "hangoutsMeet" },
          requestId: expect.any(String),
        },
      },
      summary: "Focus",
      start: { dateTime: "2026-07-13T13:00:00.000Z", timeZone: "America/New_York" },
    });
    expect(
      new URL(String(fetch.mock.calls[0]?.[0])).searchParams.get("conferenceDataVersion"),
    ).toBe("1");

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
      response({
        emailAddress: "user@example.com",
        historyId: "history-full",
        messagesTotal: 4,
        threadsTotal: 4,
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
    const result = await syncMail(fresh, null);
    expect(result.value).toMatchObject({
      deletedThreadIds: [],
      nextSyncToken: "history-full",
      reset: true,
    });
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
    expect(String(fetch.mock.calls[3]?.[0])).toContain("pageToken=next");
  });

  it("uses Gmail history incrementally and records only definitively missing threads", async () => {
    const fetch = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/labels")) return response({ labels: [] });
      if (url.pathname.endsWith("/history")) {
        if (url.searchParams.get("pageToken") === "next") {
          return response({
            history: [
              {
                id: "105",
                messagesDeleted: [{ message: { id: "message-gone", threadId: "thread-gone" } }],
                labelsRemoved: [{ message: { id: "message-2", threadId: "thread-2" } }],
              },
            ],
            historyId: "105",
          });
        }
        return response({
          history: [
            {
              id: "102",
              messagesAdded: [{ message: { id: "message-1", threadId: "thread-1" } }],
              labelsAdded: [{ message: { id: "message-2", threadId: "thread-2" } }],
            },
          ],
          historyId: "102",
          nextPageToken: "next",
        });
      }
      if (url.pathname.endsWith("/thread-gone")) return response({ error: "gone" }, 404);
      const id = url.pathname.split("/").at(-1);
      return response({
        id,
        messages: [{ id: `message-${id}`, payload: { headers: [], mimeType: "text/plain" } }],
      });
    });
    const syncMail = connector(fetch).syncMail;
    if (!syncMail) throw new Error("Google Mail connector is missing.");

    const result = await syncMail(fresh, "100");

    expect(result.value).toMatchObject({
      deletedThreadIds: ["thread-gone"],
      nextSyncToken: "105",
      reset: false,
    });
    expect(result.value.threads.map((thread) => thread.remoteThreadId)).toEqual([
      "thread-1",
      "thread-2",
    ]);
    const historyCalls = fetch.mock.calls.filter(([input]) => String(input).includes("/history"));
    expect(String(historyCalls[0]?.[0])).toContain("startHistoryId=100");
    expect(String(historyCalls[1]?.[0])).toContain("pageToken=next");
  });

  it("falls back safely when one Gmail history record contains an oversized change array", async () => {
    const messagesAdded = Array.from({ length: 1_001 }, (_, index) => ({
      message: { id: `message-${index}`, threadId: `thread-${index}` },
    }));
    const fetch = queued(
      response({ labels: [] }),
      response({ history: [{ id: "101", messagesAdded }], historyId: "101" }),
      response({ historyId: "history-reset" }),
      response({ threads: [] }),
    );
    const syncMail = connector(fetch).syncMail;
    if (!syncMail) throw new Error("Google Mail connector is missing.");

    await expect(syncMail(fresh, "100")).resolves.toMatchObject({
      value: { nextSyncToken: "history-reset", reset: true },
    });
  });

  it("rejects repeated full-sync page tokens instead of polling Gmail indefinitely", async () => {
    const fetch = queued(
      response({ labels: [] }),
      response({ historyId: "history-reset" }),
      response({ nextPageToken: "repeated", threads: [] }),
      response({ nextPageToken: "repeated", threads: [] }),
    );
    const syncMail = connector(fetch).syncMail;
    if (!syncMail) throw new Error("Google Mail connector is missing.");

    await expect(syncMail(fresh, null)).rejects.toMatchObject({
      code: "google_mail_page_limit_exceeded",
      disposition: "retry",
    });
  });

  it("falls back to a bounded full Gmail sync when the history cursor expires", async () => {
    const fetch = queued(
      response({ labels: [] }),
      response({ error: "history expired" }, 404),
      response({
        emailAddress: "user@example.com",
        historyId: "history-reset",
        messagesTotal: 0,
        threadsTotal: 0,
      }),
      response({ threads: [] }),
    );
    const syncMail = connector(fetch).syncMail;
    if (!syncMail) throw new Error("Google Mail connector is missing.");

    await expect(syncMail(fresh, "expired-history")).resolves.toMatchObject({
      value: {
        deletedThreadIds: [],
        nextSyncToken: "history-reset",
        reset: true,
        threads: [],
      },
    });
    expect(String(fetch.mock.calls[1]?.[0])).toContain("startHistoryId=expired-history");
    expect(String(fetch.mock.calls[3]?.[0])).not.toContain("startHistoryId=");
  });

  it("registers Gmail and Calendar watches and stops Calendar channels", async () => {
    const fetch = queued(
      response({ expiration: "1783972800000", historyId: "gmail-history" }),
      response({
        expiration: "1783976400000",
        id: "calendar-list-channel",
        resourceId: "calendar-list-resource",
      }),
      response({
        expiration: "1783980000000",
        id: "events-channel",
        resourceId: "events-resource",
      }),
      response({}, 204),
    );
    const google = connector(fetch);
    if (
      !google.watchGmail ||
      !google.watchCalendarList ||
      !google.watchCalendarEvents ||
      !google.stopCalendarWatch
    ) {
      throw new Error("Google watch capabilities are missing.");
    }

    await expect(
      google.watchGmail(fresh, "projects/ilo/topics/gmail-notifications"),
    ).resolves.toMatchObject({
      credentials: fresh,
      value: { expiresAt: "2026-07-13T20:00:00.000Z", historyId: "gmail-history" },
    });
    const channel = {
      address: "https://api.example.com/v1/connectors/google/calendar/notifications",
      id: "calendar-list-channel",
      token: "opaque-verification-token",
    };
    await expect(google.watchCalendarList(fresh, channel)).resolves.toMatchObject({
      value: { expiresAt: "2026-07-13T21:00:00.000Z", resourceId: "calendar-list-resource" },
    });
    await expect(
      google.watchCalendarEvents(fresh, "calendar/primary", {
        ...channel,
        id: "events-channel",
      }),
    ).resolves.toMatchObject({
      value: { expiresAt: "2026-07-13T22:00:00.000Z", resourceId: "events-resource" },
    });
    await expect(
      google.stopCalendarWatch(fresh, "events-channel", "events-resource"),
    ).resolves.toEqual(fresh);

    expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toEqual({
      topicName: "projects/ilo/topics/gmail-notifications",
    });
    expect(String(fetch.mock.calls[1]?.[0]).endsWith("/users/me/calendarList/watch")).toBe(true);
    expect(JSON.parse(String(fetch.mock.calls[1]?.[1]?.body))).toEqual({
      address: channel.address,
      id: channel.id,
      token: channel.token,
      type: "web_hook",
    });
    expect(String(fetch.mock.calls[2]?.[0])).toContain(
      "/calendars/calendar%2Fprimary/events/watch",
    );
    expect(JSON.parse(String(fetch.mock.calls[3]?.[1]?.body))).toEqual({
      id: "events-channel",
      resourceId: "events-resource",
    });
  });

  it("persists refreshed credentials from watch registration and rejects malformed expiry", async () => {
    const refresh = response({
      access_token: "watch-access",
      expires_in: 3600,
      scope: fresh.scope,
    });
    const google = connector(
      queued(
        refresh,
        response({ expiration: "1783972800000", historyId: "gmail-history" }),
        response({ expiration: "not-a-timestamp", historyId: "gmail-history" }),
      ),
    );
    if (!google.watchGmail) throw new Error("Gmail watch capability is missing.");
    await expect(
      google.watchGmail(expired, "projects/ilo/topics/gmail-notifications"),
    ).resolves.toMatchObject({
      credentials: { accessToken: "watch-access", refreshToken: fresh.refreshToken },
    });
    await expect(
      google.watchGmail(fresh, "projects/ilo/topics/gmail-notifications"),
    ).rejects.toBeDefined();
  });

  it("caps a Gmail synchronization at one hundred conversations", async () => {
    const threadIds = Array.from({ length: 100 }, (_, index) => ({ id: `thread-${index}` }));
    let activeThreadRequests = 0;
    let maximumThreadRequests = 0;
    const fetch = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/labels")) return response({ labels: [] });
      if (url.pathname.endsWith("/profile")) {
        return response({
          emailAddress: "user@example.com",
          historyId: "history-100",
          messagesTotal: 100,
          threadsTotal: 100,
        });
      }
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
    const result = await syncMail(fresh, null);
    expect(result.value.threads).toHaveLength(100);
    expect(result.value.nextSyncToken).toBe("history-100");
    expect(fetch).toHaveBeenCalledTimes(103);
    expect(maximumThreadRequests).toBe(1);
  });

  it("writes Gmail labels", async () => {
    const fetch = queued(response({}));
    const google = connector(fetch);
    if (!google.updateMailThread) throw new Error("Google Mail writes are missing.");
    await google.updateMailThread(fresh, "thread/1", {
      addMailboxIds: ["STARRED"],
      removeMailboxIds: ["UNREAD"],
    });
    expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toEqual({
      addLabelIds: ["STARRED"],
      removeLabelIds: ["UNREAD"],
    });
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

  it("surfaces provider, synchronization, and malformed-event failures", async () => {
    const google = connector(queued(new Response("unavailable", { status: 503 })));
    await expect(google.getProfile(fresh)).rejects.toMatchObject({
      category: "temporary",
      code: "google_temporary_failure",
      disposition: "retry",
      name: "ConnectorError",
      status: 503,
      message: "Google is temporarily unavailable.",
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
    const error = new ConnectorError({
      category: "rejected",
      code: "test_rejected",
      disposition: "operator",
      message: "Rejected.",
      status: 418,
    });
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

  it("writes Gmail thread labels", async () => {
    const fetch = queued(response({}));
    const google = connector(fetch);
    if (!google.updateMailThread) throw new Error("Mail writes are unavailable.");
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
  });
});
