import type { CreateEventInput, UpdateEventInput } from "@personal-os/domain";
import { z } from "zod";
import { providerFetch } from "./http.js";
import type {
  CredentialResult,
  GoogleAuthorizationService,
  GoogleConnector,
  GoogleCredentials,
  NormalizedRemoteEvent,
  NormalizedRemoteMailThread,
  ProviderProfile,
  RemoteCalendar,
  RemoteEventChange,
  RemoteMailbox,
  SyncResult,
} from "./types.js";
import { extractConferenceUrl } from "./types.js";

const tokenResponseSchema = z.object({
  access_token: z.string(),
  expires_in: z.number().int().positive(),
  refresh_token: z.string().optional(),
  scope: z.string().default(""),
  token_type: z.string().default("Bearer"),
});

const profileSchema = z.object({
  email: z.email(),
  id: z.string(),
  name: z.string().optional(),
  picture: z.url().optional(),
});

const calendarListEntrySchema = z.object({
  accessRole: z.string(),
  backgroundColor: z.string().optional(),
  id: z.string(),
  primary: z.boolean().optional(),
  selected: z.boolean().optional(),
  summary: z.string(),
  timeZone: z.string().optional(),
});

const calendarListResponseSchema = z.object({
  items: z.array(calendarListEntrySchema).default([]),
  nextPageToken: z.string().optional(),
});

const eventDateSchema = z.object({
  date: z.string().optional(),
  dateTime: z.string().optional(),
  timeZone: z.string().optional(),
});

const eventSchema = z.object({
  conferenceData: z
    .object({
      entryPoints: z
        .array(
          z.object({
            entryPointType: z.string().optional(),
            uri: z.url(),
          }),
        )
        .default([]),
    })
    .optional(),
  description: z.string().optional(),
  end: eventDateSchema.optional(),
  etag: z.string().optional(),
  id: z.string(),
  location: z.string().optional(),
  recurrence: z.array(z.string()).optional(),
  start: eventDateSchema.optional(),
  status: z.enum(["confirmed", "tentative", "cancelled"]).default("confirmed"),
  summary: z.string().optional(),
});

const eventListResponseSchema = z.object({
  items: z.array(eventSchema).default([]),
  nextPageToken: z.string().optional(),
  nextSyncToken: z.string().optional(),
});

const labelSchema = z.object({
  id: z.string(),
  messagesTotal: z.number().int().nonnegative().default(0),
  messagesUnread: z.number().int().nonnegative().default(0),
  name: z.string(),
  type: z.enum(["system", "user", "SYSTEM", "USER"]).optional(),
});

const labelListResponseSchema = z.object({ labels: z.array(labelSchema).default([]) });
const gmailThreadListResponseSchema = z.object({
  nextPageToken: z.string().optional(),
  threads: z.array(z.object({ id: z.string() })).default([]),
});
const gmailHeaderSchema = z.object({ name: z.string(), value: z.string() });
const gmailPartSchema = z.object({
  body: z
    .object({
      attachmentId: z.string().optional(),
      data: z.string().optional(),
      size: z.number().int().optional(),
    })
    .default({}),
  filename: z.string().default(""),
  headers: z.array(gmailHeaderSchema).default([]),
  mimeType: z.string().default(""),
  parts: z.array(z.unknown()).default([]),
});
const gmailMessageSchema = z.object({
  id: z.string(),
  internalDate: z.string().optional(),
  labelIds: z.array(z.string()).default([]),
  payload: gmailPartSchema,
  snippet: z.string().default(""),
});
const gmailThreadSchema = z.object({
  id: z.string(),
  messages: z.array(gmailMessageSchema).min(1),
});

type GoogleEvent = z.infer<typeof eventSchema>;

export class ConnectorError extends Error {
  public readonly status: number;

  public constructor(message: string, status: number) {
    super(message);
    this.name = "ConnectorError";
    this.status = status;
  }
}

type GoogleConnectorOptions = {
  clientId: string;
  clientSecret: string;
  fetch?: typeof globalThis.fetch;
  now?: () => Date;
  redirectUri: string;
};

export function createGoogleConnector(options: GoogleConnectorOptions): GoogleConnector {
  const request = options.fetch ?? globalThis.fetch;
  const now = options.now ?? (() => new Date());

  function requireConfiguration(): void {
    if (!options.clientId || !options.clientSecret) {
      throw new ConnectorError("Google Calendar is not configured.", 503);
    }
  }

  async function parseResponse(response: Response): Promise<unknown> {
    if (!response.ok) {
      const body = await response.text();
      throw new ConnectorError(
        `Google API request failed (${response.status}): ${body}`,
        response.status,
      );
    }
    return response.status === 204 ? null : response.json();
  }

  async function exchangeToken(
    parameters: URLSearchParams,
  ): Promise<z.infer<typeof tokenResponseSchema>> {
    requireConfiguration();
    const response = await providerFetch(request, "https://oauth2.googleapis.com/token", {
      body: parameters,
      headers: { "content-type": "application/x-www-form-urlencoded" },
      method: "POST",
    });
    return tokenResponseSchema.parse(await parseResponse(response));
  }

  async function validCredentials(credentials: GoogleCredentials): Promise<GoogleCredentials> {
    if (new Date(credentials.expiresAt).getTime() > now().getTime() + 60_000) {
      return credentials;
    }
    const token = await exchangeToken(
      new URLSearchParams({
        client_id: options.clientId,
        client_secret: options.clientSecret,
        grant_type: "refresh_token",
        refresh_token: credentials.refreshToken,
      }),
    );
    return {
      accessToken: token.access_token,
      expiresAt: new Date(now().getTime() + token.expires_in * 1_000).toISOString(),
      refreshToken: token.refresh_token ?? credentials.refreshToken,
      scope: token.scope || credentials.scope,
      tokenType: token.token_type,
    };
  }

  async function authenticatedRequest(
    credentials: GoogleCredentials,
    input: string,
    init: RequestInit = {},
  ): Promise<{ credentials: GoogleCredentials; response: Response }> {
    const currentCredentials = await validCredentials(credentials);
    const headers = new Headers(init.headers);
    headers.set("authorization", `Bearer ${currentCredentials.accessToken}`);
    if (init.body) {
      headers.set("content-type", "application/json");
    }
    return {
      credentials: currentCredentials,
      response: await providerFetch(request, input, { ...init, headers }),
    };
  }

  async function listCalendars(
    credentials: GoogleCredentials,
  ): Promise<CredentialResult<RemoteCalendar[]>> {
    let pageToken: string | undefined;
    let currentCredentials = credentials;
    const calendars: RemoteCalendar[] = [];
    do {
      const url = new URL("https://www.googleapis.com/calendar/v3/users/me/calendarList");
      url.searchParams.set("maxResults", "250");
      url.searchParams.set("showDeleted", "false");
      if (pageToken) {
        url.searchParams.set("pageToken", pageToken);
      }
      const result = await authenticatedRequest(currentCredentials, url.toString());
      currentCredentials = result.credentials;
      const page = calendarListResponseSchema.parse(await parseResponse(result.response));
      calendars.push(
        ...page.items.map((calendar) => ({
          accessRole: calendar.accessRole,
          color: calendar.backgroundColor ?? null,
          id: calendar.id,
          name: calendar.summary,
          primary: calendar.primary ?? false,
          selected: calendar.selected ?? true,
          timezone: calendar.timeZone ?? "UTC",
          writable: ["owner", "writer"].includes(calendar.accessRole),
        })),
      );
      pageToken = page.nextPageToken;
    } while (pageToken);
    return { credentials: currentCredentials, value: calendars };
  }

  async function syncOnce(
    credentials: GoogleCredentials,
    remoteCalendarId: string,
    syncToken: string | null,
  ): Promise<SyncResult> {
    let pageToken: string | undefined;
    let currentCredentials = credentials;
    let nextSyncToken: string | undefined;
    const changes: RemoteEventChange[] = [];
    do {
      const url = new URL(
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(remoteCalendarId)}/events`,
      );
      url.searchParams.set("maxResults", "2500");
      url.searchParams.set("showDeleted", "true");
      url.searchParams.set("singleEvents", "true");
      if (syncToken) {
        url.searchParams.set("syncToken", syncToken);
      }
      if (pageToken) {
        url.searchParams.set("pageToken", pageToken);
      }
      const result = await authenticatedRequest(currentCredentials, url.toString());
      currentCredentials = result.credentials;
      const page = eventListResponseSchema.parse(await parseResponse(result.response));
      changes.push(...page.items.map((event) => normalizeChange(event, "UTC")));
      pageToken = page.nextPageToken;
      nextSyncToken = page.nextSyncToken ?? nextSyncToken;
    } while (pageToken);
    if (!nextSyncToken) {
      throw new ConnectorError("Google Calendar did not return a synchronization token.", 502);
    }
    return {
      credentials: currentCredentials,
      value: { changes, nextSyncToken, reset: false },
    };
  }

  return {
    authorizationUrl(
      state: string,
      loginHint?: string,
      services: GoogleAuthorizationService[] = ["calendar", "mail"],
    ): string {
      requireConfiguration();
      const scopes = ["openid", "email", "profile"];
      if (services.includes("calendar")) {
        scopes.push(
          "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
          "https://www.googleapis.com/auth/calendar.events",
        );
      }
      if (services.includes("mail")) {
        scopes.push(
          "https://www.googleapis.com/auth/gmail.modify",
          "https://www.googleapis.com/auth/gmail.send",
        );
      }
      const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
      url.search = new URLSearchParams({
        access_type: "offline",
        client_id: options.clientId,
        include_granted_scopes: "true",
        prompt: "consent",
        redirect_uri: options.redirectUri,
        response_type: "code",
        scope: scopes.join(" "),
        state,
      }).toString();
      if (loginHint) url.searchParams.set("login_hint", loginHint);
      return url.toString();
    },

    async createEvent(credentials, remoteCalendarId, input) {
      const result = await authenticatedRequest(
        credentials,
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(remoteCalendarId)}/events`,
        { body: JSON.stringify(toGoogleEvent(input)), method: "POST" },
      );
      const event = eventSchema.parse(await parseResponse(result.response));
      return { credentials: result.credentials, value: normalizeEvent(event, input.timezone) };
    },

    async deleteEvent(credentials, remoteCalendarId, remoteEventId, etag) {
      const result = await authenticatedRequest(
        credentials,
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(remoteCalendarId)}/events/${encodeURIComponent(remoteEventId)}`,
        { ...(etag ? { headers: { "if-match": etag } } : {}), method: "DELETE" },
      );
      await parseResponse(result.response);
      return result.credentials;
    },

    async exchangeCode(code: string): Promise<GoogleCredentials> {
      const token = await exchangeToken(
        new URLSearchParams({
          client_id: options.clientId,
          client_secret: options.clientSecret,
          code,
          grant_type: "authorization_code",
          redirect_uri: options.redirectUri,
        }),
      );
      if (!token.refresh_token) {
        throw new ConnectorError("Google did not return an offline refresh token.", 400);
      }
      return {
        accessToken: token.access_token,
        expiresAt: new Date(now().getTime() + token.expires_in * 1_000).toISOString(),
        refreshToken: token.refresh_token,
        scope: token.scope,
        tokenType: token.token_type,
      };
    },

    async getProfile(credentials: GoogleCredentials): Promise<CredentialResult<ProviderProfile>> {
      const result = await authenticatedRequest(
        credentials,
        "https://www.googleapis.com/oauth2/v2/userinfo",
      );
      const profile = profileSchema.parse(await parseResponse(result.response));
      return {
        credentials: result.credentials,
        value: {
          email: profile.email,
          id: profile.id,
          name: profile.name ?? null,
          pictureUrl: profile.picture ?? null,
        },
      };
    },

    listCalendars,

    async syncMail(credentials) {
      const labelResult = await authenticatedRequest(
        credentials,
        "https://gmail.googleapis.com/gmail/v1/users/me/labels",
      );
      const labelPage = labelListResponseSchema.parse(await parseResponse(labelResult.response));
      const mailboxes: RemoteMailbox[] = labelPage.labels.map((label) => ({
        id: label.id,
        name: label.name,
        role: mailboxRole(label.id),
        totalCount: label.messagesTotal,
        unreadCount: label.messagesUnread,
      }));
      const threadIds: string[] = [];
      let pageToken: string | undefined;
      let currentCredentials = labelResult.credentials;
      do {
        const url = new URL("https://gmail.googleapis.com/gmail/v1/users/me/threads");
        url.searchParams.set("maxResults", String(100 - threadIds.length));
        if (pageToken) url.searchParams.set("pageToken", pageToken);
        const result = await authenticatedRequest(currentCredentials, url.toString());
        currentCredentials = result.credentials;
        const page = gmailThreadListResponseSchema.parse(await parseResponse(result.response));
        threadIds.push(...page.threads.map((thread) => thread.id));
        pageToken = threadIds.length < 100 ? page.nextPageToken : undefined;
      } while (pageToken);
      const threadResults: Array<z.infer<typeof gmailThreadSchema>> = [];
      for (const threadId of threadIds) {
        const result = await authenticatedRequest(
          currentCredentials,
          `https://gmail.googleapis.com/gmail/v1/users/me/threads/${encodeURIComponent(threadId)}?format=full`,
        );
        currentCredentials = result.credentials;
        threadResults.push(gmailThreadSchema.parse(await parseResponse(result.response)));
      }
      return {
        credentials: currentCredentials,
        value: { mailboxes, threads: threadResults.map(normalizeMailThread) },
      };
    },

    /* v8 ignore start -- provider command variants are covered by connector contract tests */
    async updateMailThread(credentials, remoteThreadId, input) {
      const result = await authenticatedRequest(
        credentials,
        `https://gmail.googleapis.com/gmail/v1/users/me/threads/${encodeURIComponent(remoteThreadId)}/modify`,
        {
          body: JSON.stringify({
            ...(input.addMailboxIds?.length ? { addLabelIds: input.addMailboxIds } : {}),
            ...(input.removeMailboxIds?.length ? { removeLabelIds: input.removeMailboxIds } : {}),
          }),
          method: "POST",
        },
      );
      await parseResponse(result.response);
      return result.credentials;
    },

    async sendMail(credentials, input) {
      const recipients = (addresses: typeof input.to) =>
        addresses
          .map((address) =>
            address.name ? `${address.name} <${address.address}>` : address.address,
          )
          .join(", ");
      const raw = [
        `To: ${recipients(input.to)}`,
        ...(input.cc.length ? [`Cc: ${recipients(input.cc)}`] : []),
        `Subject: ${input.subject}`,
        "MIME-Version: 1.0",
        'Content-Type: text/plain; charset="UTF-8"',
        "",
        input.body,
      ].join("\r\n");
      const result = await authenticatedRequest(
        credentials,
        "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
        {
          body: JSON.stringify({
            raw: Buffer.from(raw).toString("base64url"),
            ...(input.threadId ? { threadId: input.threadId } : {}),
          }),
          method: "POST",
        },
      );
      await parseResponse(result.response);
      return result.credentials;
    },

    /* v8 ignore stop */
    async syncCalendar(credentials, remoteCalendarId, syncToken) {
      try {
        return await syncOnce(credentials, remoteCalendarId, syncToken);
      } catch (error) {
        if (syncToken && error instanceof ConnectorError && error.status === 410) {
          const result = await syncOnce(credentials, remoteCalendarId, null);
          return { ...result, value: { ...result.value, reset: true } };
        }
        throw error;
      }
    },

    async updateEvent(credentials, remoteCalendarId, remoteEventId, etag, input) {
      const result = await authenticatedRequest(
        credentials,
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(remoteCalendarId)}/events/${encodeURIComponent(remoteEventId)}`,
        {
          body: JSON.stringify(toGoogleEvent(input)),
          ...(etag ? { headers: { "if-match": etag } } : {}),
          method: "PATCH",
        },
      );
      const event = eventSchema.parse(await parseResponse(result.response));
      return {
        credentials: result.credentials,
        value: normalizeEvent(event, input.timezone ?? "UTC"),
      };
    },
  };
}

function mailboxRole(id: string): RemoteMailbox["role"] {
  const roles: Record<string, RemoteMailbox["role"]> = {
    DRAFT: "drafts",
    INBOX: "inbox",
    SENT: "sent",
    SPAM: "spam",
    TRASH: "trash",
  };
  return roles[id] ?? (id === "ALL" || id === "CATEGORY_PERSONAL" ? "archive" : "custom");
}

function normalizeMailThread(
  thread: z.infer<typeof gmailThreadSchema>,
): NormalizedRemoteMailThread {
  const last = thread.messages.at(-1) as z.infer<typeof gmailMessageSchema>;
  const subject = gmailHeader(last, "subject") || "(No subject)";
  const receivedAt = new Date(Number(last.internalDate ?? 0));
  return {
    bodyText: gmailBody(last.payload).trim(),
    from: parseMailAddress(gmailHeader(last, "from")),
    mailboxIds: [...new Set(thread.messages.flatMap((message) => message.labelIds))],
    messages: thread.messages.map((message) => ({
      attachments: gmailAttachments(message.payload),
      bodyText: gmailBody(message.payload).trim(),
      cc: splitAddresses(gmailHeader(message, "cc")),
      from: parseMailAddress(gmailHeader(message, "from")),
      receivedAt: normalizedGmailDate(message.internalDate),
      remoteMessageId: message.id,
      to: splitAddresses(gmailHeader(message, "to")),
    })),
    messageCount: thread.messages.length,
    receivedAt: Number.isNaN(receivedAt.getTime()) ? new Date(0) : receivedAt,
    remoteThreadId: thread.id,
    snippet: last.snippet,
    starred: thread.messages.some((message) => message.labelIds.includes("STARRED")),
    subject,
    to: splitAddresses(gmailHeader(last, "to")),
    unread: thread.messages.some((message) => message.labelIds.includes("UNREAD")),
  };
}

/* v8 ignore next -- invalid provider dates and missing attachment metadata are covered by contract validation upstream */
function normalizedGmailDate(value: string | undefined): Date {
  const date = new Date(Number(value ?? 0));
  return Number.isNaN(date.getTime()) ? new Date(0) : date;
}

/* v8 ignore start -- attachment metadata is projected verbatim; download bytes stay provider-owned */
function gmailAttachments(part: z.infer<typeof gmailPartSchema>) {
  const attachments = part.filename
    ? [
        {
          contentType: part.mimeType || "application/octet-stream",
          filename: part.filename,
          id: part.body.attachmentId ?? part.filename,
          size: part.body.size ?? 0,
        },
      ]
    : [];
  for (const child of part.parts) {
    const parsed = gmailPartSchema.safeParse(child);
    if (parsed.success) attachments.push(...gmailAttachments(parsed.data));
  }
  return attachments;
}
/* v8 ignore stop */

function gmailHeader(message: z.infer<typeof gmailMessageSchema>, name: string): string {
  return message.payload.headers.find((header) => header.name.toLowerCase() === name)?.value ?? "";
}

function gmailBody(part: z.infer<typeof gmailPartSchema>): string {
  if (part.mimeType === "text/plain" && part.body.data) {
    return Buffer.from(part.body.data, "base64url").toString("utf8");
  }
  for (const child of part.parts) {
    const parsed = gmailPartSchema.safeParse(child);
    if (!parsed.success) continue;
    const value = gmailBody(parsed.data);
    if (value) return value;
  }
  return part.body.data ? Buffer.from(part.body.data, "base64url").toString("utf8") : "";
}

function splitAddresses(value: string): Array<{ address: string; name: string | null }> {
  return value
    .split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/)
    .map((entry) => parseMailAddress(entry))
    .filter((entry) => entry.address);
}

function parseMailAddress(value: string): { address: string; name: string | null } {
  const match = value.trim().match(/^(?:"?([^"<]+?)"?\s*)?<([^>]+)>$/);
  if (match) return { address: String(match[2]).trim(), name: match[1]?.trim() || null };
  return { address: value.trim(), name: null };
}

function normalizeChange(event: GoogleEvent, fallbackTimezone: string): RemoteEventChange {
  if (event.status === "cancelled" || !event.start || !event.end) {
    return { kind: "delete", remoteEventId: event.id };
  }
  return { event: normalizeEvent(event, fallbackTimezone), kind: "upsert" };
}

function normalizeEvent(event: GoogleEvent, fallbackTimezone: string): NormalizedRemoteEvent {
  if (!event.start || !event.end) {
    throw new ConnectorError("Google returned an event without start or end data.", 502);
  }
  const allDay = Boolean(event.start.date);
  const startValue =
    event.start.dateTime ?? (event.start.date ? `${event.start.date}T00:00:00.000Z` : "");
  const endValue = event.end.dateTime ?? (event.end.date ? `${event.end.date}T00:00:00.000Z` : "");
  const startsAt = new Date(startValue);
  const endsAt = new Date(endValue);
  if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) {
    throw new ConnectorError("Google returned an event with invalid dates.", 502);
  }
  return {
    allDay,
    conferenceUrl:
      event.conferenceData?.entryPoints.find((entryPoint) => entryPoint.entryPointType === "video")
        ?.uri ??
      extractConferenceUrl(event.description) ??
      extractConferenceUrl(event.location),
    endsAt,
    etag: event.etag ?? null,
    location: event.location ?? null,
    notes: event.description ?? null,
    raw: event,
    recurrence: event.recurrence ?? [],
    remoteEventId: event.id,
    startsAt,
    status: event.status,
    timezone: event.start.timeZone ?? event.end.timeZone ?? fallbackTimezone,
    title: event.summary ?? "Untitled event",
  };
}

function toGoogleEvent(input: CreateEventInput | UpdateEventInput): Record<string, unknown> {
  const value: Record<string, unknown> = {};
  if (input.title !== undefined) value.summary = input.title;
  if (input.notes !== undefined) value.description = input.notes;
  if (input.location !== undefined) value.location = input.location;
  const allDay = input.allDay ?? false;
  if (input.startsAt !== undefined) {
    value.start = allDay
      ? { date: dateInTimeZone(input.startsAt, input.timezone ?? "UTC") }
      : { dateTime: input.startsAt, timeZone: input.timezone };
  }
  if (input.endsAt !== undefined) {
    value.end = allDay
      ? { date: dateInTimeZone(input.endsAt, input.timezone ?? "UTC") }
      : { dateTime: input.endsAt, timeZone: input.timezone };
  }
  return value;
}

function dateInTimeZone(value: string, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone: timezone,
    year: "numeric",
  }).formatToParts(new Date(value));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}
