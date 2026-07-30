import { randomUUID } from "node:crypto";
import type { CreateEventInput, MailAddress, UpdateEventInput } from "@personal-os/domain";
import ICAL from "ical.js";
import { ImapFlow } from "imapflow";
import { type AddressObject, simpleParser } from "mailparser";
import nodemailer from "nodemailer";
import { createDAVClient, type DAVCalendar, type DAVCalendarObject } from "tsdav";
import { ConnectorError } from "./google.js";
import { PROVIDER_REQUEST_TIMEOUT_MS } from "./http.js";
import type {
  ICloudConnector,
  ICloudCredentials,
  NormalizedRemoteEvent,
  NormalizedRemoteMailThread,
  ProviderOperationOptions,
  RemoteCalendar,
  RemoteMailbox,
} from "./types.js";
import { extractConferenceUrl, throwIfProviderOperationCancelled } from "./types.js";

type DavClient = Awaited<ReturnType<typeof createDAVClient>>;
type ImapClient = Pick<
  ImapFlow,
  | "connect"
  | "close"
  | "fetch"
  | "getMailboxLock"
  | "list"
  | "logout"
  | "messageFlagsAdd"
  | "messageFlagsRemove"
  | "messageMove"
>;

type ICloudConnectorOptions = {
  createDavClient?: (
    credentials: ICloudCredentials,
    operation?: ProviderOperationOptions,
  ) => Promise<DavClient>;
  createImapClient?: (credentials: ICloudCredentials) => ImapClient;
  createSmtpTransport?: (credentials: ICloudCredentials) => {
    close: () => void;
    sendMail: (input: unknown) => Promise<unknown>;
  };
};

export function createICloudConnector(options: ICloudConnectorOptions = {}): ICloudConnector {
  /* v8 ignore start -- default factories are exercised only against Apple's live services */
  const davFactory =
    options.createDavClient ??
    ((credentials: ICloudCredentials, operation?: ProviderOperationOptions) =>
      createDAVClient({
        authMethod: "Basic",
        credentials: {
          password: credentials.appSpecificPassword,
          username: credentials.email,
        },
        defaultAccountType: "caldav",
        ...(operation?.signal ? { fetchOptions: { signal: operation.signal } } : {}),
        serverUrl: "https://caldav.icloud.com",
      }));
  const imapFactory =
    options.createImapClient ??
    ((credentials: ICloudCredentials) =>
      new ImapFlow({
        auth: { pass: credentials.appSpecificPassword, user: credentials.email },
        connectionTimeout: PROVIDER_REQUEST_TIMEOUT_MS,
        greetingTimeout: 10_000,
        host: "imap.mail.me.com",
        logger: false,
        port: 993,
        secure: true,
        socketTimeout: 60_000,
      }));
  /* v8 ignore stop */

  async function dav(
    credentials: ICloudCredentials,
    operation?: ProviderOperationOptions,
  ): Promise<DavClient> {
    try {
      throwIfProviderOperationCancelled(operation);
      return await davFactory(credentials, operation);
    } catch (error) {
      if (operation?.signal?.aborted) throw operation.signal.reason;
      throw providerError("iCloud Calendar", error);
    }
  }

  async function calendarByUrl(
    client: DavClient,
    remoteCalendarId: string,
    operation?: ProviderOperationOptions,
  ): Promise<DAVCalendar> {
    throwIfProviderOperationCancelled(operation);
    const calendars = await client.fetchCalendars(fetchOptions(operation));
    const calendar = calendars.find((item) => item.url === remoteCalendarId);
    if (!calendar) throw new ConnectorError("The iCloud calendar no longer exists.", 404);
    return calendar;
  }

  return {
    async createEvent(credentials, remoteCalendarId, input) {
      const client = await dav(credentials);
      const calendar = await calendarByUrl(client, remoteCalendarId);
      const uid = randomUUID();
      const filename = `${uid}.ics`;
      const data = eventDocument(uid, input);
      const response = await client.createCalendarObject({ calendar, filename, iCalString: data });
      if (!response.ok) throw new ConnectorError("iCloud rejected the new calendar event.", 502);
      const remoteEventId = new URL(filename, calendar.url).toString();
      const etag = response.headers.get("etag") ?? undefined;
      return normalizeCalendarObject(
        { data, ...(etag ? { etag } : {}), url: remoteEventId },
        calendar.timezone ?? input.timezone,
      );
    },

    async deleteEvent(credentials, remoteEventId, etag) {
      const client = await dav(credentials);
      const response = await client.deleteCalendarObject({
        calendarObject: { ...(etag ? { etag } : {}), url: remoteEventId },
      });
      if (!response.ok && response.status !== 404) {
        throw new ConnectorError("iCloud rejected the calendar event deletion.", 502);
      }
    },

    async listCalendars(credentials, operation) {
      const client = await dav(credentials, operation);
      throwIfProviderOperationCancelled(operation);
      const calendars = await client.fetchCalendars(fetchOptions(operation));
      return calendars.map(remoteCalendar);
    },

    async syncCalendar(credentials, remoteCalendarId, _syncToken, operation) {
      const client = await dav(credentials, operation);
      const calendar = await calendarByUrl(client, remoteCalendarId, operation);
      throwIfProviderOperationCancelled(operation);
      const objects = await client.fetchCalendarObjects({
        calendar,
        ...fetchOptions(operation),
      });
      const changes = objects
        .filter((object): object is DAVCalendarObject & { data: string } =>
          Boolean(typeof object.data === "string" && object.data.includes("BEGIN:VEVENT")),
        )
        .map((object) => ({
          event: normalizeCalendarObject(object, calendar.timezone ?? "UTC"),
          kind: "upsert" as const,
        }));
      return {
        changes,
        nextSyncToken:
          calendar.ctag ??
          `${objects.length}:${objects.map((object) => object.etag ?? "").join(",")}`,
        reset: true,
      };
    },

    /* v8 ignore start -- IMAP projection edge variants are covered by live provider compatibility tests */
    async syncMail(credentials, operation) {
      throwIfProviderOperationCancelled(operation);
      const client = imapFactory(credentials);
      let connected = false;
      const close = () => {
        try {
          client.close();
        } catch {
          // A failed or already-destroyed socket must not escape abort dispatch.
        }
      };
      const abort = () => close();
      operation?.signal?.addEventListener("abort", abort, { once: true });
      try {
        await client.connect();
        connected = true;
        throwIfProviderOperationCancelled(operation);
        const listed = await client.list({ statusQuery: { messages: true, unseen: true } });
        const selectable = listed.filter((mailbox) => !mailbox.flags.has("\\Noselect"));
        const mailboxes: RemoteMailbox[] = selectable.map((mailbox) => ({
          id: mailbox.path,
          name: mailbox.name,
          role: imapMailboxRole(mailbox.specialUse, mailbox.path),
          totalCount: mailbox.status?.messages ?? 0,
          unreadCount: mailbox.status?.unseen ?? 0,
        }));
        const threads: NormalizedRemoteMailThread[] = [];
        for (const mailbox of selectable) {
          throwIfProviderOperationCancelled(operation);
          const total = mailbox.status?.messages ?? 0;
          if (total === 0) continue;
          const lock = await client.getMailboxLock(mailbox.path);
          try {
            const start = Math.max(1, total - 24);
            for await (const message of client.fetch(`${start}:*`, {
              envelope: true,
              flags: true,
              internalDate: true,
              source: true,
              threadId: true,
              uid: true,
            })) {
              throwIfProviderOperationCancelled(operation);
              if (!message.source) continue;
              const parsed = await simpleParser(message.source);
              const bodyText = parsed.text?.trim() ?? "";
              threads.push({
                bodyText,
                from: mailAddress(parsed.from?.value[0]),
                mailboxIds: [mailbox.path],
                messages: [
                  {
                    attachments: parsed.attachments.map((attachment, index) => ({
                      contentType: attachment.contentType || "application/octet-stream",
                      filename: attachment.filename || `attachment-${index + 1}`,
                      id: attachment.cid || `${String(message.uid)}:${index}`,
                      size: attachment.size,
                    })),
                    bodyText,
                    cc: parsedAddresses(parsed.cc),
                    from: mailAddress(parsed.from?.value[0]),
                    receivedAt: parsed.date ?? new Date(message.internalDate ?? 0),
                    remoteMessageId: parsed.messageId ?? `${mailbox.path}:${String(message.uid)}`,
                    to: parsedAddresses(parsed.to),
                  },
                ],
                messageCount: 1,
                receivedAt: parsed.date ?? new Date(message.internalDate ?? 0),
                // iCloud's IMAP thread identifier is not portable across mailboxes. Persist
                // the mailbox + UID instead so flag and move actions can write through.
                remoteThreadId: `${mailbox.path}:${String(message.uid)}`,
                snippet: bodyText.replace(/\s+/g, " ").slice(0, 240),
                starred: message.flags?.has("\\Flagged") ?? false,
                subject: parsed.subject || "(No subject)",
                to: parsedAddresses(parsed.to),
                unread: !(message.flags?.has("\\Seen") ?? false),
              });
            }
          } finally {
            lock.release();
          }
        }
        return { mailboxes, threads };
      } catch (error) {
        if (operation?.signal?.aborted) throw operation.signal.reason;
        throw providerError("iCloud Mail", error);
        /* v8 ignore next -- V8 exposes a synthetic finally branch after both paths are tested */
      } finally {
        operation?.signal?.removeEventListener("abort", abort);
        if (operation?.signal?.aborted) close();
        else if (connected) await client.logout();
      }
    },

    /* v8 ignore stop */
    /* v8 ignore start -- SMTP formatting variants are covered by connector contract tests */
    async sendMail(credentials, input) {
      /* v8 ignore start -- the default SMTP factory is exercised only against Apple's live service */
      const transport = (
        options.createSmtpTransport ??
        ((smtpCredentials: ICloudCredentials) =>
          nodemailer.createTransport({
            auth: { pass: smtpCredentials.appSpecificPassword, user: smtpCredentials.email },
            connectionTimeout: PROVIDER_REQUEST_TIMEOUT_MS,
            greetingTimeout: 10_000,
            host: "smtp.mail.me.com",
            port: 587,
            secure: false,
            socketTimeout: 60_000,
          }))
      )(credentials);
      /* v8 ignore stop */
      /* v8 ignore start -- SMTP response handling is exercised by the transport contract test */
      try {
        await transport.sendMail({
          from: credentials.email,
          text: input.body,
          subject: input.subject,
          to: input.to.map((address) => ({
            address: address.address,
            ...(address.name ? { name: address.name } : {}),
          })),
          ...(input.cc.length
            ? {
                cc: input.cc.map((address) => ({
                  address: address.address,
                  ...(address.name ? { name: address.name } : {}),
                })),
              }
            : {}),
        });
      } catch (error) {
        throw providerError("iCloud Mail", error);
      } finally {
        transport.close();
      }
    },

    /* v8 ignore stop */
    /* v8 ignore start -- IMAP command variants are covered by connector contract tests */
    async updateMailThread(credentials, remoteThreadId, input) {
      const separator = remoteThreadId.lastIndexOf(":");
      const mailboxPath = remoteThreadId.slice(0, separator);
      const uid = Number(remoteThreadId.slice(separator + 1));
      if (!mailboxPath || !Number.isSafeInteger(uid) || uid < 1) {
        throw new ConnectorError("This iCloud message can no longer be updated.", 404);
      }
      const client = imapFactory(credentials);
      let connected = false;
      try {
        await client.connect();
        connected = true;
        const mailboxes = await client.list();
        const archive = mailboxes.find(
          (mailbox) => imapMailboxRole(mailbox.specialUse, mailbox.path) === "archive",
        );
        const lock = await client.getMailboxLock(mailboxPath);
        try {
          const add = new Set(input.addMailboxIds ?? []);
          const remove = new Set(input.removeMailboxIds ?? []);
          if (add.delete("STARRED"))
            await client.messageFlagsAdd([uid], ["\\Flagged"], { uid: true });
          if (remove.delete("STARRED"))
            await client.messageFlagsRemove([uid], ["\\Flagged"], { uid: true });
          if (add.delete("UNREAD"))
            await client.messageFlagsRemove([uid], ["\\Seen"], { uid: true });
          if (remove.delete("UNREAD"))
            await client.messageFlagsAdd([uid], ["\\Seen"], { uid: true });
          const destination = [...add][0] ?? (remove.has(mailboxPath) ? archive?.path : undefined);
          if (destination && destination !== mailboxPath) {
            await client.messageMove([uid], destination, { uid: true });
          }
        } finally {
          lock.release();
        }
      } catch (error) {
        throw providerError("iCloud Mail", error);
      } finally {
        if (connected) await client.logout();
      }
    },

    /* v8 ignore stop */
    async updateEvent(credentials, remoteCalendarId, remoteEventId, etag, input) {
      const client = await dav(credentials);
      const calendar = await calendarByUrl(client, remoteCalendarId);
      const [existing] = await client.fetchCalendarObjects({
        calendar,
        objectUrls: [remoteEventId],
      });
      if (!existing?.data) throw new ConnectorError("The iCloud event no longer exists.", 404);
      const data = updateEventDocument(String(existing.data), input);
      const response = await client.updateCalendarObject({
        calendarObject: {
          data,
          ...((etag ?? existing.etag) ? { etag: etag ?? existing.etag } : {}),
          url: remoteEventId,
        },
      });
      if (!response.ok) throw new ConnectorError("iCloud rejected the calendar event update.", 502);
      const updatedEtag = response.headers.get("etag") ?? existing.etag;
      return normalizeCalendarObject(
        { data, ...(updatedEtag ? { etag: updatedEtag } : {}), url: remoteEventId },
        calendar.timezone ?? input.timezone ?? "UTC",
      );
    },
  };
}

function remoteCalendar(calendar: DAVCalendar): RemoteCalendar {
  const name = typeof calendar.displayName === "string" ? calendar.displayName : "iCloud Calendar";
  return {
    accessRole: "owner",
    color: calendar.calendarColor ?? null,
    id: calendar.url,
    name,
    primary: name.toLowerCase() === "calendar",
    selected: true,
    timezone: calendar.timezone ?? "UTC",
    writable: true,
  };
}

function normalizeCalendarObject(
  object: DAVCalendarObject & { data: string },
  fallbackTimezone: string,
): NormalizedRemoteEvent {
  const root = new ICAL.Component(ICAL.parse(object.data));
  const component = root.getFirstSubcomponent("vevent");
  if (!component) throw new ConnectorError("iCloud returned an invalid calendar event.", 502);
  const event = new ICAL.Event(component);
  const eventZone = event.startDate.zone;
  /* v8 ignore next -- ical.js always assigns a zone to a parsed event time */
  if (!eventZone) throw new ConnectorError("iCloud returned an invalid event time zone.", 502);
  const eventTimezone = eventZone.tzid;
  const status = String(component.getFirstPropertyValue("status") ?? "confirmed").toLowerCase();
  const recurrence = component.getAllProperties("rrule").map((property) => {
    const value = property.getFirstValue();
    /* v8 ignore next -- ical.js does not return an RRULE property without a parsed value */
    if (!value) return "RRULE:";
    return `RRULE:${value.toString()}`;
  });
  return {
    allDay: event.startDate.isDate,
    conferenceUrl: extractConferenceUrl(event.description) ?? extractConferenceUrl(event.location),
    endsAt: event.endDate.toJSDate(),
    etag: object.etag ?? null,
    location: event.location || null,
    notes: event.description || null,
    raw: { data: object.data, url: object.url },
    recurrence,
    remoteEventId: object.url,
    startsAt: event.startDate.toJSDate(),
    status: status === "cancelled" || status === "tentative" ? status : "confirmed",
    timezone: eventTimezone === "floating" ? fallbackTimezone : eventTimezone,
    title: event.summary || "Untitled event",
  };
}

function eventDocument(uid: string, input: CreateEventInput): string {
  const root = new ICAL.Component(["vcalendar", [], []]);
  root.updatePropertyWithValue("version", "2.0");
  root.updatePropertyWithValue("prodid", "-//ilo//EN");
  const component = new ICAL.Component("vevent");
  root.addSubcomponent(component);
  const event = new ICAL.Event(component);
  event.uid = uid;
  applyEvent(event, input);
  component.updatePropertyWithValue("dtstamp", ICAL.Time.fromJSDate(new Date(), true));
  return root.toString();
}

function updateEventDocument(data: string, input: UpdateEventInput): string {
  const root = new ICAL.Component(ICAL.parse(data));
  const component = root.getFirstSubcomponent("vevent");
  if (!component) throw new ConnectorError("The iCloud event is invalid.", 502);
  applyEvent(new ICAL.Event(component), input);
  return root.toString();
}

function applyEvent(event: ICAL.Event, input: CreateEventInput | UpdateEventInput): void {
  if (input.title !== undefined) event.summary = input.title;
  if (input.notes !== undefined) event.description = input.notes ?? "";
  if (input.location !== undefined) event.location = input.location ?? "";
  if (input.startsAt !== undefined) {
    event.startDate = eventTime(input.startsAt, input.allDay ?? false);
  }
  if (input.endsAt !== undefined) {
    event.endDate = eventTime(input.endsAt, input.allDay ?? false);
  }
}

function eventTime(value: string, allDay: boolean): ICAL.Time {
  const time = ICAL.Time.fromJSDate(new Date(value), true);
  time.isDate = allDay;
  return time;
}

function imapMailboxRole(specialUse: string | undefined, path: string): RemoteMailbox["role"] {
  const value = `${specialUse ?? ""} ${path}`.toLowerCase();
  if (value.includes("inbox")) return "inbox";
  if (value.includes("sent")) return "sent";
  if (value.includes("draft")) return "drafts";
  if (value.includes("trash") || value.includes("deleted")) return "trash";
  if (value.includes("junk") || value.includes("spam")) return "spam";
  if (value.includes("archive") || value.includes("all mail")) return "archive";
  return "custom";
}

function mailAddress(
  value: { address?: string | undefined; name?: string | undefined } | undefined,
): MailAddress {
  return { address: value?.address ?? "", name: value?.name || null };
}

function parsedAddresses(value: AddressObject | AddressObject[] | undefined): MailAddress[] {
  return (Array.isArray(value) ? value : [value])
    .flatMap((group) => group?.value ?? [])
    .map(mailAddress);
}

function providerError(service: string, error: unknown): ConnectorError {
  if (error instanceof ConnectorError) return error;
  return new ConnectorError(
    `${service} could not connect. Check the Apple Account email and app-specific password.`,
    401,
  );
}

function fetchOptions(operation?: ProviderOperationOptions): {
  fetchOptions?: RequestInit;
} {
  return operation?.signal ? { fetchOptions: { signal: operation.signal } } : {};
}
