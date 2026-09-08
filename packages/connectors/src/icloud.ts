import { randomUUID } from "node:crypto";
import type { CreateEventInput, MailAddress, UpdateEventInput } from "@personal-os/domain";
import ICAL from "ical.js";
import { ImapFlow } from "imapflow";
import { type AddressObject, simpleParser } from "mailparser";
import nodemailer from "nodemailer";
import { createDAVClient, type DAVCalendar, type DAVCalendarObject, type DAVResponse } from "tsdav";
import { ConnectorError, classifyICloudError } from "./failures.js";
import { PROVIDER_REQUEST_TIMEOUT_MS } from "./http.js";
import {
  boundFlatMailAttachments,
  calendarAttachmentProjectionOverflow,
  MAX_MAIL_MIME_PARTS_PER_MESSAGE,
  MAX_MAIL_SOURCE_BYTES,
  redactedProjectionOverflowPartId,
} from "./mail-attachments.js";
import type {
  ICloudConnector,
  ICloudCredentials,
  NormalizedRemoteEvent,
  NormalizedRemoteMailThread,
  ProviderOperationOptions,
  RemoteCalendar,
  RemoteEventChange,
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
  | "idle"
  | "list"
  | "logout"
  | "mailboxOpen"
  | "messageFlagsAdd"
  | "messageFlagsRemove"
  | "messageMove"
  | "mailbox"
  | "on"
  | "removeListener"
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

const MAX_CALDAV_SYNC_PAGES = 10;
const MAX_CALDAV_SYNC_RESOURCES = 500;
const MAX_CALDAV_MULTIGET_RESOURCES = 100;
const MAX_CALDAV_SYNC_TOKEN_LENGTH = 8_192;

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
      throw providerError("calendar", error);
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
    if (!calendar) {
      throw new ConnectorError({
        category: "not_found",
        code: "icloud_calendar_not_found",
        disposition: "operator",
        message: "The iCloud calendar no longer exists.",
        status: 404,
      });
    }
    return calendar;
  }

  return {
    async listenForMailChanges(credentials, onChange, operation) {
      throwIfProviderOperationCancelled(operation);
      const client = imapFactory(credentials);
      let connected = false;
      let closed = false;
      let settleEvent: (() => void) | undefined;
      let rejectEvent: ((error: Error) => void) | undefined;
      const eventEnd = new Promise<void>((resolveEvent, reject) => {
        settleEvent = resolveEvent;
        rejectEvent = reject;
      });
      const signalChange = () => {
        void Promise.resolve(onChange()).catch(() => undefined);
      };
      const close = () => {
        if (closed) return;
        closed = true;
        try {
          client.close();
        } catch {
          // Closing an already-failed IDLE socket is best effort.
        }
        settleEvent?.();
      };
      const providerClosed = () => close();
      const providerFailed = (error: Error) => rejectEvent?.(error);
      const abort = () => close();
      const sessionTimeout = setTimeout(close, 25 * 60_000);
      operation?.signal?.addEventListener("abort", abort, { once: true });
      client.on("exists", signalChange);
      client.on("expunge", signalChange);
      client.on("flags", signalChange);
      client.on("close", providerClosed);
      client.on("error", providerFailed);
      let failure: ConnectorError | undefined;
      try {
        await client.connect();
        connected = true;
        throwIfProviderOperationCancelled(operation);
        await client.mailboxOpen("INBOX");
        await Promise.race([client.idle().then(() => undefined), eventEnd]);
      } catch (error) {
        if (!operation?.signal?.aborted) failure = providerError("mail", error);
      } finally {
        clearTimeout(sessionTimeout);
        operation?.signal?.removeEventListener("abort", abort);
        client.removeListener("exists", signalChange);
        client.removeListener("expunge", signalChange);
        client.removeListener("flags", signalChange);
        client.removeListener("close", providerClosed);
        client.removeListener("error", providerFailed);
        if (operation?.signal?.aborted || closed) close();
        else if (connected) {
          try {
            await client.logout();
          } catch (error) {
            failure ??= providerError("mail", error);
          }
        }
      }
      if (failure) throw failure;
    },

    async createEvent(credentials, remoteCalendarId, input) {
      const client = await dav(credentials);
      const calendar = await calendarByUrl(client, remoteCalendarId);
      const uid = randomUUID();
      const filename = `${uid}.ics`;
      const data = eventDocument(uid, input);
      const response = await client.createCalendarObject({ calendar, filename, iCalString: data });
      if (!response.ok) {
        throw new ConnectorError({
          category: "rejected",
          code: "icloud_calendar_create_rejected",
          disposition: "operator",
          message: "iCloud rejected the new calendar event.",
          status: 502,
        });
      }
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
        throw new ConnectorError({
          category: "rejected",
          code: "icloud_calendar_delete_rejected",
          disposition: "operator",
          message: "iCloud rejected the calendar event deletion.",
          status: 502,
        });
      }
    },

    async listCalendars(credentials, operation) {
      const client = await dav(credentials, operation);
      throwIfProviderOperationCancelled(operation);
      const calendars = await client.fetchCalendars(fetchOptions(operation));
      return calendars.map(remoteCalendar);
    },

    async syncCalendar(credentials, remoteCalendarId, syncToken, operation) {
      try {
        const client = await dav(credentials, operation);
        const calendar = await calendarByUrl(client, remoteCalendarId, operation);
        throwIfProviderOperationCancelled(operation);
        const reports = await client.supportedReportSet({
          collection: calendar,
          ...fetchOptions(operation),
        });
        const supportsCollectionSync = reports.some(
          (report) => report.toLowerCase().replaceAll(/[^a-z]/g, "") === "synccollection",
        );
        if (!supportsCollectionSync) {
          return await fullCalendarSync(client, calendar, operation);
        }

        async function syncCollection(
          activeSyncToken: string | null,
        ): Promise<{ changes: RemoteEventChange[]; nextSyncToken: string; reset: boolean }> {
          const changedResources = new Map<string, "changed" | "deleted">();
          let requestToken = activeSyncToken ?? undefined;
          let nextSyncToken: string | null = null;
          let completed = false;
          for (let page = 0; page < MAX_CALDAV_SYNC_PAGES; page += 1) {
            throwIfProviderOperationCancelled(operation);
            const responses = await client.syncCollection({
              props: { "d:getetag": {} },
              syncLevel: 1,
              ...(requestToken ? { syncToken: requestToken } : {}),
              url: calendar.url,
              ...fetchOptions(operation),
            });
            if (responses.some((response) => response.status === 409 || response.status === 410)) {
              return activeSyncToken
                ? syncCollection(null)
                : fullCalendarSync(client, calendar, operation);
            }
            let truncated = false;
            for (const response of responses) {
              if (response.status === 507) {
                truncated = true;
                continue;
              }
              if (response.status === 401 || response.status === 403) {
                throw providerError("calendar", { status: response.status });
              }
              if (response.status !== 404 && !response.ok) {
                throw new ConnectorError({
                  category: response.status >= 500 ? "temporary" : "invalid_response",
                  code: "icloud_calendar_sync_rejected",
                  disposition: response.status >= 500 ? "retry" : "operator",
                  message: "iCloud Calendar could not synchronize this calendar.",
                  status: response.status,
                });
              }
              if (!response.href) continue;
              const objectUrl = safeCalendarObjectUrl(response.href, calendar.url);
              if (!objectUrl) {
                return await fullCalendarSync(client, calendar, operation);
              }
              changedResources.set(objectUrl, response.status === 404 ? "deleted" : "changed");
              if (changedResources.size > MAX_CALDAV_SYNC_RESOURCES) {
                return await fullCalendarSync(client, calendar, operation);
              }
            }

            const responseToken = collectionSyncToken(responses);
            if (!responseToken) {
              return await fullCalendarSync(client, calendar, operation);
            }

            nextSyncToken = responseToken;
            if (!truncated) {
              completed = true;
              break;
            }
            if (responseToken === requestToken) {
              return await fullCalendarSync(client, calendar, operation);
            }
            requestToken = responseToken;
          }
          if (!completed || !nextSyncToken) {
            return await fullCalendarSync(client, calendar, operation);
          }

          const changedUrls = [...changedResources]
            .filter(([, state]) => state === "changed")
            .map(([url]) => url);
          const objects: DAVCalendarObject[] = [];
          for (
            let offset = 0;
            offset < changedUrls.length;
            offset += MAX_CALDAV_MULTIGET_RESOURCES
          ) {
            throwIfProviderOperationCancelled(operation);
            const objectUrls = changedUrls.slice(offset, offset + MAX_CALDAV_MULTIGET_RESOURCES);
            const expectedUrls = new Set(objectUrls);
            const fetched = await client.fetchCalendarObjects({
              calendar,
              objectUrls,
              ...fetchOptions(operation),
            });
            for (const object of fetched) {
              const objectUrl = safeCalendarObjectUrl(object.url, calendar.url);
              if (!objectUrl || !expectedUrls.has(objectUrl)) {
                return await fullCalendarSync(client, calendar, operation);
              }
              objects.push({ ...object, url: objectUrl });
              expectedUrls.delete(objectUrl);
            }
            if (expectedUrls.size > 0) {
              return await fullCalendarSync(client, calendar, operation);
            }
          }
          const changes: RemoteEventChange[] = objects
            .filter((object): object is DAVCalendarObject & { data: string } =>
              Boolean(typeof object.data === "string" && object.data.includes("BEGIN:VEVENT")),
            )
            .map((object) => ({
              event: normalizeCalendarObject(object, calendar.timezone ?? "UTC"),
              kind: "upsert" as const,
            }));
          for (const [remoteEventId, state] of changedResources) {
            if (state === "deleted") changes.push({ kind: "delete", remoteEventId });
          }
          return { changes, nextSyncToken, reset: activeSyncToken === null };
        }

        return await syncCollection(syncToken);
      } catch (error) {
        if (operation?.signal?.aborted) throw operation.signal.reason;
        throw providerError("calendar", error);
      }
    },

    /* v8 ignore start -- IMAP projection edge variants are covered by live provider compatibility tests */
    async syncMail(credentials, _syncToken, operation) {
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
        const listed = await client.list({
          statusQuery: { messages: true, uidValidity: true, unseen: true },
        });
        const selectable = listed.filter((mailbox) => !mailbox.flags.has("\\Noselect"));
        const mailboxes: RemoteMailbox[] = [];
        const threads: NormalizedRemoteMailThread[] = [];
        for (const mailbox of selectable) {
          throwIfProviderOperationCancelled(operation);
          const lock = await client.getMailboxLock(mailbox.path);
          try {
            const selectedMailbox = client.mailbox;
            if (!selectedMailbox || selectedMailbox.path !== mailbox.path) {
              throw new ConnectorError({
                category: "invalid_response",
                code: "icloud_mailbox_selection_invalid",
                disposition: "retry",
                message: "iCloud selected an unexpected mailbox.",
                status: 502,
              });
            }
            const mailboxRevision = selectedMailbox.uidValidity.toString();
            const total = selectedMailbox.exists;
            mailboxes.push({
              id: mailbox.path,
              name: mailbox.name,
              providerRevision: mailboxRevision,
              role: imapMailboxRole(mailbox.specialUse, mailbox.path),
              totalCount: total,
              unreadCount: mailbox.status?.unseen ?? 0,
            });
            if (total === 0) continue;
            const start = Math.max(1, total - 24);
            for await (const message of client.fetch(`${start}:*`, {
              envelope: true,
              flags: true,
              internalDate: true,
              size: true,
              source: { maxLength: MAX_MAIL_SOURCE_BYTES + 1 },
              threadId: true,
              uid: true,
            })) {
              throwIfProviderOperationCancelled(operation);
              if (!message.source) continue;
              const sourceOverflow =
                (message.size ?? message.source.length) > MAX_MAIL_SOURCE_BYTES ||
                message.source.length > MAX_MAIL_SOURCE_BYTES;
              const parsed = sourceOverflow ? null : await simpleParser(message.source);
              const bodyText = parsed?.text?.trim() ?? "";
              const overflowPartId = redactedProjectionOverflowPartId(
                `${mailbox.path}:${mailboxRevision}:${String(message.uid)}`,
              );
              const receivedAt =
                parsed?.date ?? message.envelope?.date ?? new Date(message.internalDate ?? 0);
              threads.push({
                bodyText,
                from: parsed
                  ? mailAddress(parsed.from?.value[0])
                  : mailAddress(message.envelope?.from?.[0]),
                mailboxIds: [mailbox.path],
                messages: [
                  {
                    attachments:
                      sourceOverflow ||
                      (parsed?.attachments.length ?? 0) > MAX_MAIL_MIME_PARTS_PER_MESSAGE
                        ? [calendarAttachmentProjectionOverflow(overflowPartId)]
                        : boundFlatMailAttachments(
                            (parsed?.attachments ?? []).map((attachment, index) => ({
                              contentType: attachment.contentType || "application/octet-stream",
                              filename: attachment.filename || `attachment-${index + 1}`,
                              id: `${mailbox.path}:${mailboxRevision}:${String(message.uid)}:${index}`,
                              providerAttachmentId: null,
                              providerPartId: `${mailbox.path}:${mailboxRevision}:${String(message.uid)}:${index}`,
                              size: attachment.size,
                            })),
                            overflowPartId,
                          ),
                    bodyText,
                    cc: parsed ? parsedAddresses(parsed.cc) : imapAddresses(message.envelope?.cc),
                    from: parsed
                      ? mailAddress(parsed.from?.value[0])
                      : mailAddress(message.envelope?.from?.[0]),
                    mailboxIds: [mailbox.path],
                    providerRevision: `${mailboxRevision}:${String(message.uid)}`,
                    receivedAt,
                    remoteMessageId: `${mailbox.path}:${mailboxRevision}:${String(message.uid)}`,
                    to: parsed ? parsedAddresses(parsed.to) : imapAddresses(message.envelope?.to),
                  },
                ],
                messageCount: 1,
                messagesComplete: true,
                receivedAt,
                // iCloud's IMAP thread identifier is not portable across mailboxes. Persist
                // the mailbox + UID instead so flag and move actions can write through.
                remoteThreadId: `${mailbox.path}:${mailboxRevision}:${String(message.uid)}`,
                snippet: bodyText.replace(/\s+/g, " ").slice(0, 240),
                starred: message.flags?.has("\\Flagged") ?? false,
                subject: parsed?.subject || message.envelope?.subject || "(No subject)",
                to: parsed ? parsedAddresses(parsed.to) : imapAddresses(message.envelope?.to),
                unread: !(message.flags?.has("\\Seen") ?? false),
              });
            }
          } finally {
            lock.release();
          }
        }
        return {
          deletedThreadIds: [],
          mailboxes,
          nextSyncToken: null,
          reset: true,
          threads,
        };
      } catch (error) {
        if (operation?.signal?.aborted) throw operation.signal.reason;
        throw providerError("mail", error);
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
        throw providerError("mail", error);
      } finally {
        transport.close();
      }
    },

    /* v8 ignore stop */
    /* v8 ignore start -- IMAP command variants are covered by connector contract tests */
    async updateMailThread(credentials, remoteThreadId, input) {
      const uidSeparator = remoteThreadId.lastIndexOf(":");
      if (uidSeparator < 0) {
        throw new ConnectorError({
          category: "not_found",
          code: "icloud_message_not_found",
          disposition: "operator",
          message: "This iCloud message can no longer be updated.",
          status: 404,
        });
      }
      const mailboxAndValidity = remoteThreadId.slice(0, uidSeparator);
      const validitySeparator = mailboxAndValidity.lastIndexOf(":");
      const mailboxPath = mailboxAndValidity.slice(0, validitySeparator);
      const expectedUidValidity = mailboxAndValidity.slice(validitySeparator + 1);
      const uid = Number(remoteThreadId.slice(uidSeparator + 1));
      if (
        validitySeparator < 0 ||
        !mailboxPath ||
        !/^\d+$/u.test(expectedUidValidity) ||
        !Number.isSafeInteger(uid) ||
        uid < 1
      ) {
        throw new ConnectorError({
          category: "not_found",
          code: "icloud_message_not_found",
          disposition: "operator",
          message: "This iCloud message can no longer be updated.",
          status: 404,
        });
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
          const selectedMailbox = client.mailbox;
          if (
            !selectedMailbox ||
            selectedMailbox.path !== mailboxPath ||
            selectedMailbox.uidValidity.toString() !== expectedUidValidity
          ) {
            throw new ConnectorError({
              category: "rejected",
              code: "icloud_message_revision_conflict",
              disposition: "operator",
              message: "This iCloud message source revision is no longer current.",
              status: 409,
            });
          }
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
        throw providerError("mail", error);
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
      if (!existing?.data) {
        throw new ConnectorError({
          category: "not_found",
          code: "icloud_event_not_found",
          disposition: "operator",
          message: "The iCloud event no longer exists.",
          status: 404,
        });
      }
      const data = updateEventDocument(String(existing.data), input);
      const response = await client.updateCalendarObject({
        calendarObject: {
          data,
          ...((etag ?? existing.etag) ? { etag: etag ?? existing.etag } : {}),
          url: remoteEventId,
        },
      });
      if (!response.ok) {
        throw new ConnectorError({
          category: "rejected",
          code: "icloud_calendar_update_rejected",
          disposition: "operator",
          message: "iCloud rejected the calendar event update.",
          status: 502,
        });
      }
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

async function fullCalendarSync(
  client: DavClient,
  calendar: DAVCalendar,
  operation?: ProviderOperationOptions,
) {
  throwIfProviderOperationCancelled(operation);
  const objects = await client.fetchCalendarObjects({
    calendar,
    ...fetchOptions(operation),
  });
  const normalizedObjects = objects.map((object) => {
    const objectUrl = safeCalendarObjectUrl(object.url, calendar.url);
    if (!objectUrl) {
      throw new ConnectorError({
        category: "invalid_response",
        code: "icloud_calendar_object_url_invalid",
        disposition: "operator",
        message: "iCloud Calendar returned an invalid event location.",
        status: 502,
      });
    }
    return { ...object, url: objectUrl };
  });
  const changes = normalizedObjects
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
      `${normalizedObjects.length}:${normalizedObjects.map((object) => object.etag ?? "").join(",")}`,
    reset: true,
  };
}

function collectionSyncToken(responses: DAVResponse[]): string | null {
  for (const response of responses) {
    const raw = response.raw as { multistatus?: { syncToken?: unknown } } | undefined;
    const token = raw?.multistatus?.syncToken;
    if (
      typeof token === "string" &&
      token.length > 0 &&
      token.length <= MAX_CALDAV_SYNC_TOKEN_LENGTH
    ) {
      return token;
    }
  }
  return null;
}

function safeCalendarObjectUrl(href: string, calendarUrl: string): string | null {
  try {
    const calendar = new URL(calendarUrl.endsWith("/") ? calendarUrl : `${calendarUrl}/`);
    const object = new URL(href, calendar);
    if (
      object.origin !== calendar.origin ||
      !object.pathname.startsWith(calendar.pathname) ||
      !object.pathname.toLowerCase().endsWith(".ics")
    ) {
      return null;
    }
    object.hash = "";
    return object.toString();
  } catch {
    return null;
  }
}

function normalizeCalendarObject(
  object: DAVCalendarObject & { data: string },
  fallbackTimezone: string,
): NormalizedRemoteEvent {
  const root = new ICAL.Component(ICAL.parse(object.data));
  const component = root.getFirstSubcomponent("vevent");
  if (!component) {
    throw new ConnectorError({
      category: "invalid_response",
      code: "icloud_event_invalid",
      disposition: "operator",
      message: "iCloud returned an invalid calendar event.",
      status: 502,
    });
  }
  const event = new ICAL.Event(component);
  const eventZone = event.startDate.zone;
  /* v8 ignore next -- ical.js always assigns a zone to a parsed event time */
  if (!eventZone) {
    throw new ConnectorError({
      category: "invalid_response",
      code: "icloud_event_timezone_invalid",
      disposition: "operator",
      message: "iCloud returned an invalid event time zone.",
      status: 502,
    });
  }
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
  root.updatePropertyWithValue("prodid", "-//nohmi//EN");
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
  if (!component) {
    throw new ConnectorError({
      category: "invalid_response",
      code: "icloud_event_document_invalid",
      disposition: "operator",
      message: "The iCloud event is invalid.",
      status: 502,
    });
  }
  applyEvent(new ICAL.Event(component), input);
  return root.toString();
}

function applyEvent(event: ICAL.Event, input: CreateEventInput | UpdateEventInput): void {
  const conferenceUrl = "conferenceUrl" in input ? input.conferenceUrl : undefined;
  if (input.title !== undefined) event.summary = input.title;
  if (input.notes !== undefined || conferenceUrl !== undefined) {
    const notes = input.notes ?? null;
    event.description =
      conferenceUrl && !notes?.includes(conferenceUrl)
        ? [notes, conferenceUrl].filter(Boolean).join("\n\n")
        : (notes ?? "");
  }
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

function imapAddresses(
  value: Array<{ address?: string | undefined; name?: string | undefined }> | undefined,
): MailAddress[] {
  return (value ?? []).map(mailAddress);
}

function providerError(service: "calendar" | "mail", error: unknown): ConnectorError {
  return classifyICloudError(service, error);
}

function fetchOptions(operation?: ProviderOperationOptions): {
  fetchOptions?: RequestInit;
} {
  return operation?.signal ? { fetchOptions: { signal: operation.signal } } : {};
}
