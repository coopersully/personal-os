import { randomUUID } from "node:crypto";
import type {
  GoogleConnector,
  GoogleCredentials,
  ICloudConnector,
  ICloudCredentials,
  MailSyncResult,
  NormalizedRemoteEvent,
  SyncResult,
} from "@personal-os/connectors";
import { ConnectorError, createICloudConnector } from "@personal-os/connectors";
import {
  auditEvents,
  calendarAccounts,
  calendarEvents,
  calendars,
  type Database,
  mailboxes,
  mailMessages,
  mailRules,
  mailThreads,
  oauthStates,
} from "@personal-os/database";
import type {
  CalendarProvider,
  ConnectICloudInput,
  CreateEventInput,
  StartGoogleAuthorizationInput,
  UpdateEventInput,
} from "@personal-os/domain";
import { and, asc, eq, gt, isNull, lt, ne, notInArray, or } from "drizzle-orm";
import { auditValues } from "./audit.js";
import { requireDatabaseRecord } from "./database.js";
import { AppError } from "./errors.js";
import { decryptJson, encryptJson, generateToken, hashToken } from "./security.js";
import { auditSnapshot } from "./serialization.js";

const GOOGLE_OAUTH_STATE_TTL_MS = 30 * 60_000;

type CalendarRow = typeof calendars.$inferSelect;
type EventRow = typeof calendarEvents.$inferSelect;
type AccountRow = typeof calendarAccounts.$inferSelect & {
  encryptedCredentials: NonNullable<typeof calendarAccounts.$inferSelect.encryptedCredentials>;
};

function providerEventInput(input: CreateEventInput | UpdateEventInput) {
  const {
    attendees: _attendees,
    eventType: _eventType,
    reminders: _reminders,
    transparency: _transparency,
    visibility: _visibility,
    ...providerInput
  } = input;
  return providerInput;
}

export type ConnectedEventGateway = {
  create: (calendar: CalendarRow, input: CreateEventInput) => Promise<NormalizedRemoteEvent>;
  delete: (calendar: CalendarRow, event: EventRow) => Promise<void>;
  update: (
    calendar: CalendarRow,
    event: EventRow,
    input: UpdateEventInput,
  ) => Promise<NormalizedRemoteEvent>;
};

export type ConnectedMailGateway = {
  send: (
    userId: string,
    accountId: string,
    input: {
      body: string;
      cc: Array<{ address: string; name: string | null }>;
      subject: string;
      threadId?: string;
      to: Array<{ address: string; name: string | null }>;
    },
  ) => Promise<void>;
  update: (
    userId: string,
    accountId: string,
    remoteThreadId: string,
    input: { addMailboxIds?: string[]; removeMailboxIds?: string[] },
  ) => Promise<void>;
};

type ConnectorServiceOptions = {
  db: Database;
  encryptionKey: string;
  google: GoogleConnector;
  icloud?: ICloudConnector;
  now: () => Date;
};

export function createConnectorService({
  db,
  encryptionKey,
  google,
  icloud = createICloudConnector(),
  now,
}: ConnectorServiceOptions) {
  async function getAccount(userId: string, accountId: string): Promise<AccountRow> {
    const [account] = await db
      .select()
      .from(calendarAccounts)
      .where(
        and(
          eq(calendarAccounts.id, accountId),
          eq(calendarAccounts.userId, userId),
          ne(calendarAccounts.provider, "local"),
        ),
      )
      .limit(1);
    if (!account?.encryptedCredentials) {
      throw new AppError("not_found", "The connected account was not found.");
    }
    return { ...account, encryptedCredentials: account.encryptedCredentials };
  }

  function credentials<T>(account: AccountRow): T {
    return decryptJson<T>(account.encryptedCredentials, encryptionKey);
  }

  async function saveGoogleCredentials(accountId: string, value: GoogleCredentials): Promise<void> {
    await db
      .update(calendarAccounts)
      .set({ encryptedCredentials: encryptJson(value, encryptionKey), updatedAt: now() })
      .where(eq(calendarAccounts.id, accountId));
  }

  const eventGateway: ConnectedEventGateway = {
    async create(calendar, input) {
      if (!calendar.remoteCalendarId) {
        throw new AppError("internal_error", "The connected calendar has no provider identifier.");
      }
      const account = await getAccount(calendar.userId, calendar.accountId);
      if (calendar.provider === "google") {
        const result = await google.createEvent(
          credentials<GoogleCredentials>(account),
          calendar.remoteCalendarId,
          providerEventInput(input) as CreateEventInput,
        );
        await saveGoogleCredentials(account.id, result.credentials);
        return result.value;
      }
      if (calendar.provider === "icloud") {
        return icloud.createEvent(
          credentials<ICloudCredentials>(account),
          calendar.remoteCalendarId,
          providerEventInput(input) as CreateEventInput,
        );
      }
      throw new AppError("invalid_request", "Local calendars do not use a connector.");
    },

    async delete(calendar, event) {
      if (!calendar.remoteCalendarId || !event.remoteEventId) {
        throw new AppError("internal_error", "The connected event has no provider identifier.");
      }
      const account = await getAccount(calendar.userId, calendar.accountId);
      if (calendar.provider === "google") {
        const value = await google.deleteEvent(
          credentials<GoogleCredentials>(account),
          calendar.remoteCalendarId,
          event.remoteEventId,
          event.remoteEtag,
        );
        await saveGoogleCredentials(account.id, value);
        return;
      }
      if (calendar.provider === "icloud") {
        await icloud.deleteEvent(
          credentials<ICloudCredentials>(account),
          event.remoteEventId,
          event.remoteEtag,
        );
        return;
      }
      throw new AppError("invalid_request", "Local calendars do not use a connector.");
    },

    async update(calendar, event, input) {
      if (!calendar.remoteCalendarId || !event.remoteEventId) {
        throw new AppError("internal_error", "The connected event has no provider identifier.");
      }
      const account = await getAccount(calendar.userId, calendar.accountId);
      if (calendar.provider === "google") {
        const result = await google.updateEvent(
          credentials<GoogleCredentials>(account),
          calendar.remoteCalendarId,
          event.remoteEventId,
          event.remoteEtag,
          providerEventInput(input) as UpdateEventInput,
        );
        await saveGoogleCredentials(account.id, result.credentials);
        return result.value;
      }
      if (calendar.provider === "icloud") {
        return icloud.updateEvent(
          credentials<ICloudCredentials>(account),
          calendar.remoteCalendarId,
          event.remoteEventId,
          event.remoteEtag,
          providerEventInput(input) as UpdateEventInput,
        );
      }
      throw new AppError("invalid_request", "Local calendars do not use a connector.");
    },
  };

  const mailGateway: ConnectedMailGateway = {
    async send(userId, accountId, input) {
      const account = await getAccount(userId, accountId);
      if (account.provider === "icloud" && icloud.sendMail) {
        await icloud.sendMail(credentials<ICloudCredentials>(account), input);
        return;
      }
      if (account.provider !== "google" || !google.sendMail) {
        throw new AppError(
          "service_unavailable",
          "This mail provider does not yet support sending mail.",
        );
      }
      await saveGoogleCredentials(
        account.id,
        await google.sendMail(credentials<GoogleCredentials>(account), input),
      );
    },
    /* v8 ignore start -- provider dispatch variants are exercised in connector contracts */
    async update(userId, accountId, remoteThreadId, input) {
      const account = await getAccount(userId, accountId);
      if (account.provider === "icloud" && icloud.updateMailThread) {
        await icloud.updateMailThread(
          credentials<ICloudCredentials>(account),
          remoteThreadId,
          input,
        );
        return;
      }
      if (account.provider !== "google" || !google.updateMailThread) {
        throw new AppError(
          "service_unavailable",
          "This mail provider does not yet support write-through mail actions.",
        );
      }
      const updatedCredentials = await google.updateMailThread(
        credentials<GoogleCredentials>(account),
        remoteThreadId,
        input,
      );
      await saveGoogleCredentials(account.id, updatedCredentials);
    },
  };
  /* v8 ignore stop */

  async function syncAccount(
    userId: string,
    accountId: string,
    options: { skipMail?: boolean } = {},
  ): Promise<{ changed: number }> {
    const account = await getAccount(userId, accountId);
    let googleCredentials =
      account.provider === "google" ? credentials<GoogleCredentials>(account) : null;
    const icloudCredentials =
      account.provider === "icloud" ? credentials<ICloudCredentials>(account) : null;
    const requestId = `sync:${randomUUID()}`;
    const principal = { actorId: account.id, actorType: "connector", userId } as const;
    let changed = 0;
    await db
      .update(calendarAccounts)
      .set({ syncError: null, syncStatus: "syncing", updatedAt: now() })
      .where(eq(calendarAccounts.id, account.id));
    try {
      if (account.calendarEnabled) {
        const accountCalendars = await db
          .select()
          .from(calendars)
          .where(and(eq(calendars.accountId, account.id), isNull(calendars.deletedAt)))
          .orderBy(asc(calendars.name));
        for (const calendar of accountCalendars) {
          if (!calendar.remoteCalendarId) continue;
          let result: SyncResult["value"];
          if (calendar.provider === "google" && googleCredentials) {
            const remote = await google.syncCalendar(
              googleCredentials,
              calendar.remoteCalendarId,
              calendar.syncToken,
            );
            googleCredentials = remote.credentials;
            result = remote.value;
          } else if (calendar.provider === "icloud" && icloudCredentials) {
            result = await icloud.syncCalendar(
              icloudCredentials,
              calendar.remoteCalendarId,
              calendar.syncToken,
            );
          } else {
            continue;
          }
          changed += await projectCalendarChanges(userId, calendar, result, principal, requestId);
        }
      }
      if (account.mailEnabled && !options.skipMail) {
        let mail: MailSyncResult["value"];
        if (account.provider === "google" && googleCredentials && google.syncMail) {
          const result = await google.syncMail(googleCredentials);
          googleCredentials = result.credentials;
          mail = result.value;
        } else if (account.provider === "icloud" && icloudCredentials) {
          mail = await icloud.syncMail(icloudCredentials);
        } else {
          throw new AppError("internal_error", "Mail credentials are unavailable.");
        }
        const projected = await projectMail(account, mail, principal, requestId, googleCredentials);
        changed += projected.changed;
        googleCredentials = projected.credentials ?? googleCredentials;
      }
      await db
        .update(calendarAccounts)
        .set({
          ...(googleCredentials
            ? { encryptedCredentials: encryptJson(googleCredentials, encryptionKey) }
            : {}),
          lastSyncedAt: now(),
          syncError: null,
          syncStatus: "idle",
          updatedAt: now(),
        })
        .where(eq(calendarAccounts.id, account.id));
      return { changed };
    } catch (error) {
      await db
        .update(calendarAccounts)
        .set({
          syncError: error instanceof Error ? error.message : "Unknown connector error",
          syncStatus: "error",
          updatedAt: now(),
        })
        .where(eq(calendarAccounts.id, account.id));
      throw error;
    }
  }

  async function projectCalendarChanges(
    userId: string,
    calendar: CalendarRow,
    result: SyncResult["value"],
    principal: { actorId: string; actorType: "connector"; userId: string },
    requestId: string,
  ): Promise<number> {
    let changed = 0;
    const presentIds: string[] = [];
    for (const change of result.changes) {
      if (change.kind === "delete") {
        const [before] = await db
          .select()
          .from(calendarEvents)
          .where(
            and(
              eq(calendarEvents.calendarId, calendar.id),
              eq(calendarEvents.remoteEventId, change.remoteEventId),
              isNull(calendarEvents.deletedAt),
            ),
          )
          .limit(1);
        if (before) {
          const [after] = await db
            .update(calendarEvents)
            .set({ deletedAt: now(), status: "cancelled", syncedAt: now(), updatedAt: now() })
            .where(eq(calendarEvents.id, before.id))
            .returning();
          if (after) {
            changed += 1;
            await auditCalendarChange(
              "calendar_event.deleted_by_connector",
              before,
              after,
              principal,
              requestId,
            );
          }
        }
        continue;
      }
      presentIds.push(change.event.remoteEventId);
      const [before] = await db
        .select()
        .from(calendarEvents)
        .where(
          and(
            eq(calendarEvents.calendarId, calendar.id),
            eq(calendarEvents.remoteEventId, change.event.remoteEventId),
          ),
        )
        .limit(1);
      if (before?.remoteEtag === change.event.etag && !before.deletedAt) continue;
      const values = remoteEventValues(userId, calendar.id, calendar.provider, change.event, now());
      const [after] = before
        ? await db
            .update(calendarEvents)
            .set(values)
            .where(eq(calendarEvents.id, before.id))
            .returning()
        : await db.insert(calendarEvents).values(values).returning();
      if (after) {
        changed += 1;
        await auditCalendarChange(
          before ? "calendar_event.updated_by_connector" : "calendar_event.created_by_connector",
          before ?? null,
          after,
          principal,
          requestId,
        );
      }
    }
    if (result.reset) {
      const staleConditions = [
        eq(calendarEvents.calendarId, calendar.id),
        eq(calendarEvents.provider, calendar.provider),
        isNull(calendarEvents.deletedAt),
      ];
      if (presentIds.length > 0) {
        staleConditions.push(notInArray(calendarEvents.remoteEventId, presentIds));
      }
      const stale = await db
        .select()
        .from(calendarEvents)
        .where(and(...staleConditions));
      for (const before of stale) {
        const [after] = await db
          .update(calendarEvents)
          .set({ deletedAt: now(), syncedAt: now(), updatedAt: now() })
          .where(eq(calendarEvents.id, before.id))
          .returning();
        if (after) {
          changed += 1;
          await auditCalendarChange(
            "calendar_event.removed_by_full_sync",
            before,
            after,
            principal,
            requestId,
          );
        }
      }
    }
    await db
      .update(calendars)
      .set({ lastSyncedAt: now(), syncToken: result.nextSyncToken, updatedAt: now() })
      .where(eq(calendars.id, calendar.id));
    return changed;
  }

  async function auditCalendarChange(
    action: string,
    before: EventRow | null,
    after: EventRow,
    principal: { actorId: string; actorType: "connector"; userId: string },
    requestId: string,
  ): Promise<void> {
    await db.insert(auditEvents).values(
      auditValues({
        action,
        after: auditSnapshot(after),
        before: auditSnapshot(before),
        entityId: after.id,
        entityType: "calendar_event",
        principal,
        requestId,
      }),
    );
  }

  /* v8 ignore start -- projection permutations are covered by provider integration contracts */
  async function projectMail(
    account: AccountRow,
    value: MailSyncResult["value"],
    principal: { actorId: string; actorType: "connector"; userId: string },
    requestId: string,
    initialGoogleCredentials: GoogleCredentials | null,
  ): Promise<{ changed: number; credentials: GoogleCredentials | null }> {
    const provider = account.provider === "icloud" ? "icloud" : "google";
    let updatedGoogleCredentials: GoogleCredentials | null = null;
    const mailboxIds = value.mailboxes.map((mailbox) => mailbox.id);
    for (const mailbox of value.mailboxes) {
      await db
        .insert(mailboxes)
        .values({
          accountId: account.id,
          deletedAt: null,
          lastSyncedAt: now(),
          name: mailbox.name,
          provider,
          remoteMailboxId: mailbox.id,
          role: mailbox.role,
          totalCount: mailbox.totalCount,
          unreadCount: mailbox.unreadCount,
          userId: account.userId,
        })
        .onConflictDoUpdate({
          set: {
            deletedAt: null,
            lastSyncedAt: now(),
            name: mailbox.name,
            role: mailbox.role,
            totalCount: mailbox.totalCount,
            unreadCount: mailbox.unreadCount,
            updatedAt: now(),
          },
          target: [mailboxes.accountId, mailboxes.remoteMailboxId],
        });
    }
    const staleMailboxConditions = [
      eq(mailboxes.accountId, account.id),
      isNull(mailboxes.deletedAt),
    ];
    if (mailboxIds.length > 0) {
      staleMailboxConditions.push(notInArray(mailboxes.remoteMailboxId, mailboxIds));
    }
    await db
      .update(mailboxes)
      .set({ deletedAt: now(), updatedAt: now() })
      .where(and(...staleMailboxConditions));

    const threadIds = value.threads.map((thread) => thread.remoteThreadId);
    for (const thread of value.threads) {
      const [storedThread] = await db
        .insert(mailThreads)
        .values({
          accountId: account.id,
          bodyText: thread.bodyText,
          deletedAt: null,
          from: thread.from,
          messageCount: thread.messageCount,
          provider,
          receivedAt: thread.receivedAt,
          remoteMailboxIds: thread.mailboxIds,
          remoteThreadId: thread.remoteThreadId,
          snippet: thread.snippet,
          starred: thread.starred,
          subject: thread.subject,
          to: thread.to,
          unread: thread.unread,
          userId: account.userId,
        })
        .onConflictDoUpdate({
          set: {
            bodyText: thread.bodyText,
            deletedAt: null,
            from: thread.from,
            messageCount: thread.messageCount,
            receivedAt: thread.receivedAt,
            remoteMailboxIds: thread.mailboxIds,
            snippet: thread.snippet,
            starred: thread.starred,
            subject: thread.subject,
            to: thread.to,
            unread: thread.unread,
            updatedAt: now(),
          },
          target: [mailThreads.accountId, mailThreads.remoteThreadId],
        })
        .returning({ id: mailThreads.id });
      if (!storedThread)
        throw new AppError("internal_error", "The mail conversation could not be saved.");
      for (const message of thread.messages ?? []) {
        await db
          .insert(mailMessages)
          .values({
            attachments: message.attachments,
            bodyText: message.bodyText,
            cc: message.cc,
            from: message.from,
            receivedAt: message.receivedAt,
            remoteMessageId: message.remoteMessageId,
            threadId: storedThread.id,
            to: message.to,
          })
          .onConflictDoUpdate({
            set: {
              attachments: message.attachments,
              bodyText: message.bodyText,
              cc: message.cc,
              from: message.from,
              receivedAt: message.receivedAt,
              to: message.to,
              updatedAt: now(),
            },
            target: [mailMessages.threadId, mailMessages.remoteMessageId],
          });
      }
    }
    const rules = await db
      .select()
      .from(mailRules)
      .where(and(eq(mailRules.userId, account.userId), eq(mailRules.enabled, true)));
    if (account.provider === "google" && google.updateMailThread && rules.length > 0) {
      let currentCredentials = initialGoogleCredentials ?? credentials<GoogleCredentials>(account);
      for (const thread of value.threads) {
        let projectedMailboxIds = thread.mailboxIds;
        let projectedStarred = thread.starred;
        let projectedUnread = thread.unread;
        const searchable =
          `${thread.subject}\n${thread.snippet}\n${thread.from.name ?? ""}\n${thread.from.address}`.toLowerCase();
        for (const rule of rules) {
          if (!searchable.includes(rule.query.toLowerCase())) continue;
          const addMailboxIds: string[] = [];
          const removeMailboxIds: string[] = [];
          if (rule.action === "archive" && projectedMailboxIds.includes("INBOX"))
            removeMailboxIds.push("INBOX");
          if (rule.action === "mark_read" && projectedUnread) removeMailboxIds.push("UNREAD");
          if (rule.action === "star" && !projectedStarred) addMailboxIds.push("STARRED");
          if (addMailboxIds.length === 0 && removeMailboxIds.length === 0) continue;
          currentCredentials = await google.updateMailThread(
            currentCredentials,
            thread.remoteThreadId,
            {
              addMailboxIds,
              removeMailboxIds,
            },
          );
          await db
            .update(mailThreads)
            .set({
              remoteMailboxIds: removeMailboxIds.length
                ? projectedMailboxIds.filter((mailboxId) => !removeMailboxIds.includes(mailboxId))
                : projectedMailboxIds,
              starred: addMailboxIds.includes("STARRED") || projectedStarred,
              unread: removeMailboxIds.includes("UNREAD") ? false : projectedUnread,
              updatedAt: now(),
            })
            .where(
              and(
                eq(mailThreads.accountId, account.id),
                eq(mailThreads.remoteThreadId, thread.remoteThreadId),
              ),
            );
          if (removeMailboxIds.length)
            projectedMailboxIds = projectedMailboxIds.filter(
              (mailboxId) => !removeMailboxIds.includes(mailboxId),
            );
          if (removeMailboxIds.includes("UNREAD")) projectedUnread = false;
          if (addMailboxIds.includes("STARRED")) projectedStarred = true;
        }
      }
      updatedGoogleCredentials = currentCredentials;
    }
    const staleThreadConditions = [
      eq(mailThreads.accountId, account.id),
      isNull(mailThreads.deletedAt),
    ];
    if (threadIds.length > 0) {
      staleThreadConditions.push(notInArray(mailThreads.remoteThreadId, threadIds));
    }
    await db
      .update(mailThreads)
      .set({ deletedAt: now(), updatedAt: now() })
      .where(and(...staleThreadConditions));
    await db.insert(auditEvents).values(
      auditValues({
        action: "mail.synced",
        after: { mailboxes: value.mailboxes.length, threads: value.threads.length },
        before: null,
        entityId: account.id,
        entityType: "mail_account",
        principal,
        requestId,
      }),
    );
    return {
      changed: value.mailboxes.length + value.threads.length,
      credentials: updatedGoogleCredentials,
    };
  }

  return {
    async completeGoogleAuthorization(state: string, code: string) {
      const [oauthState] = await db
        .select()
        .from(oauthStates)
        .where(
          and(
            eq(oauthStates.tokenHash, hashToken(state)),
            eq(oauthStates.provider, "google"),
            isNull(oauthStates.consumedAt),
            gt(oauthStates.expiresAt, now()),
          ),
        )
        .limit(1);
      if (!oauthState) {
        throw new AppError(
          "invalid_request",
          "The Google authorization state is invalid or expired.",
        );
      }
      await db
        .update(oauthStates)
        .set({ consumedAt: now() })
        .where(eq(oauthStates.id, oauthState.id));
      let googleCredentials = await google.exchangeCode(code);
      const profileResult = await google.getProfile(googleCredentials);
      googleCredentials = profileResult.credentials;
      const requestedServices = oauthState.requestedServices ?? ["calendar", "mail"];
      const target = oauthState.targetAccountId
        ? await getAccount(oauthState.userId, oauthState.targetAccountId)
        : null;
      if (target) {
        if (
          target.provider !== "google" ||
          (target.providerAccountId && target.providerAccountId !== profileResult.value.id)
        ) {
          throw new AppError("invalid_request", "Authorize the same Google account you selected.");
        }
      }
      const [matchedAccount] = target
        ? [target]
        : await db
            .select()
            .from(calendarAccounts)
            .where(
              and(
                eq(calendarAccounts.userId, oauthState.userId),
                eq(calendarAccounts.provider, "google"),
                eq(calendarAccounts.providerAccountId, profileResult.value.id),
              ),
            )
            .limit(1);
      const calendarResult = requestedServices.includes("calendar")
        ? await google.listCalendars(googleCredentials)
        : null;
      if (calendarResult) googleCredentials = calendarResult.credentials;
      const calendarEnabled =
        matchedAccount?.calendarEnabled === true || requestedServices.includes("calendar");
      const mailEnabled =
        matchedAccount?.mailEnabled === true ||
        (requestedServices.includes("mail") && hasGoogleMailScope(googleCredentials));
      const account = requireDatabaseRecord(
        (
          await db
            .insert(calendarAccounts)
            .values({
              calendarEnabled,
              avatarUrl: profileResult.value.pictureUrl,
              email: profileResult.value.email,
              encryptedCredentials: encryptJson(googleCredentials, encryptionKey),
              label: profileResult.value.name ?? profileResult.value.email,
              mailEnabled,
              provider: "google",
              providerAccountId: profileResult.value.id,
              userId: oauthState.userId,
            })
            .onConflictDoUpdate({
              set: {
                calendarEnabled,
                avatarUrl: profileResult.value.pictureUrl,
                email: profileResult.value.email,
                encryptedCredentials: encryptJson(googleCredentials, encryptionKey),
                label: profileResult.value.name ?? profileResult.value.email,
                mailEnabled,
                syncError: null,
                syncStatus: "idle",
                updatedAt: now(),
              },
              target: [
                calendarAccounts.userId,
                calendarAccounts.provider,
                calendarAccounts.providerAccountId,
              ],
            })
            .returning()
        )[0],
        "The Google account could not be saved.",
      );
      if (calendarResult) await saveCalendars(account, calendarResult.value, "google");
      try {
        await syncAccount(oauthState.userId, account.id);
      } catch {
        // The account and credentials are already saved, while syncAccount records
        // the provider error for the settings UI and a later manual retry.
      }
      return {
        accountId: account.id,
        email: account.email,
        returnPath:
          oauthState.returnPath === "/setup" ||
          oauthState.returnPath === "/settings?section=connections"
            ? oauthState.returnPath
            : "/settings?section=connections",
      };
    },

    async connectICloud(userId: string, input: ConnectICloudInput) {
      const icloudCredentials: ICloudCredentials = {
        appSpecificPassword: input.appSpecificPassword,
        email: input.email,
      };
      const [remoteCalendars, remoteMail] = await Promise.all([
        input.calendar ? icloud.listCalendars(icloudCredentials) : Promise.resolve([]),
        input.mail ? icloud.syncMail(icloudCredentials) : Promise.resolve(null),
      ]);
      const account = requireDatabaseRecord(
        (
          await db
            .insert(calendarAccounts)
            .values({
              calendarEnabled: input.calendar,
              email: input.email,
              encryptedCredentials: encryptJson(icloudCredentials, encryptionKey),
              label: input.email,
              mailEnabled: input.mail,
              provider: "icloud",
              providerAccountId: input.email,
              userId,
            })
            .onConflictDoUpdate({
              set: {
                calendarEnabled: input.calendar,
                encryptedCredentials: encryptJson(icloudCredentials, encryptionKey),
                mailEnabled: input.mail,
                syncError: null,
                syncStatus: "idle",
                updatedAt: now(),
              },
              target: [
                calendarAccounts.userId,
                calendarAccounts.provider,
                calendarAccounts.providerAccountId,
              ],
            })
            .returning()
        )[0],
        "The iCloud account could not be saved.",
      );
      await saveCalendars(account, remoteCalendars, "icloud");
      if (remoteMail) {
        const requestId = `connect:${randomUUID()}`;
        await projectMail(
          {
            ...account,
            encryptedCredentials: account.encryptedCredentials as NonNullable<
              typeof account.encryptedCredentials
            >,
          },
          remoteMail,
          { actorId: account.id, actorType: "connector", userId },
          requestId,
          null,
        );
      }
      await syncAccount(userId, account.id, { skipMail: true });
      return { accountId: account.id, email: account.email };
    },

    async disconnect(userId: string, accountId: string): Promise<void> {
      const [record] = await db
        .delete(calendarAccounts)
        .where(
          and(
            eq(calendarAccounts.id, accountId),
            eq(calendarAccounts.userId, userId),
            ne(calendarAccounts.provider, "local"),
          ),
        )
        .returning({ id: calendarAccounts.id });
      if (!record) throw new AppError("not_found", "The connected account was not found.");
    },

    eventGateway,
    mailGateway,

    async listAccounts(userId: string) {
      const records = await db
        .select()
        .from(calendarAccounts)
        .where(and(eq(calendarAccounts.userId, userId), ne(calendarAccounts.provider, "local")))
        .orderBy(asc(calendarAccounts.createdAt));
      return records.map((record) => ({
        calendarEnabled: record.calendarEnabled,
        avatarUrl: record.avatarUrl,
        email: record.email,
        id: record.id,
        label: record.label,
        lastSyncedAt: record.lastSyncedAt?.toISOString() ?? null,
        mailEnabled: record.mailEnabled,
        provider: record.provider,
        syncError: record.syncError,
        syncStatus: record.syncStatus,
      }));
    },

    async startGoogleAuthorization(
      userId: string,
      input: StartGoogleAuthorizationInput = {
        returnTo: "/settings?section=connections",
        services: ["calendar", "mail"],
      },
    ): Promise<string> {
      const target = input.accountId ? await getAccount(userId, input.accountId) : null;
      if (target && target.provider !== "google") {
        throw new AppError("invalid_request", "Only Google accounts use Google authorization.");
      }
      const state = generateToken("oauth");
      let url: string;
      try {
        url = google.authorizationUrl(state, target?.email ?? undefined, input.services);
      } catch (error) {
        if (error instanceof ConnectorError) {
          throw new AppError("service_unavailable", error.message);
        }
        throw error;
      }
      await db.insert(oauthStates).values({
        expiresAt: new Date(now().getTime() + GOOGLE_OAUTH_STATE_TTL_MS),
        provider: "google",
        requestedServices: input.services,
        returnPath: input.returnTo,
        targetAccountId: target?.id,
        tokenHash: hashToken(state),
        userId,
      });
      return url;
    },

    syncAccount,
    async syncStaleMailAccounts(intervalMs = 5 * 60_000): Promise<void> {
      const threshold = new Date(now().getTime() - intervalMs);
      const accounts = await db
        .select({ id: calendarAccounts.id, userId: calendarAccounts.userId })
        .from(calendarAccounts)
        .where(
          and(
            eq(calendarAccounts.mailEnabled, true),
            ne(calendarAccounts.provider, "local"),
            or(isNull(calendarAccounts.lastSyncedAt), lt(calendarAccounts.lastSyncedAt, threshold)),
          ),
        );
      await Promise.all(
        accounts.map((account) => syncAccount(account.userId, account.id).catch(() => {})),
      );
    },
  };

  async function saveCalendars(
    account: typeof calendarAccounts.$inferSelect,
    remoteCalendars: Array<{
      color: string | null;
      id: string;
      name: string;
      primary: boolean;
      selected: boolean;
      timezone: string;
      writable: boolean;
    }>,
    provider: Extract<CalendarProvider, "google" | "icloud">,
  ): Promise<void> {
    for (const remote of remoteCalendars) {
      await db
        .insert(calendars)
        .values({
          accountId: account.id,
          color: remote.color,
          isPrimary: remote.primary,
          isSelected: remote.selected,
          isWritable: remote.writable,
          name: remote.name,
          provider,
          remoteCalendarId: remote.id,
          timezone: remote.timezone,
          userId: account.userId,
        })
        .onConflictDoUpdate({
          set: {
            color: remote.color,
            deletedAt: null,
            isPrimary: remote.primary,
            isWritable: remote.writable,
            name: remote.name,
            timezone: remote.timezone,
            updatedAt: now(),
          },
          target: [calendars.accountId, calendars.remoteCalendarId],
        });
    }
  }
}

function hasGoogleMailScope(credentials: GoogleCredentials): boolean {
  const scopes = new Set(credentials.scope.split(/\s+/));
  return [
    "https://mail.google.com/",
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/gmail.modify",
  ].some((scope) => scopes.has(scope));
}

function remoteEventValues(
  userId: string,
  calendarId: string,
  provider: CalendarProvider,
  event: NormalizedRemoteEvent,
  timestamp: Date,
): typeof calendarEvents.$inferInsert {
  return {
    allDay: event.allDay,
    calendarId,
    conferenceUrl: event.conferenceUrl,
    deletedAt: null,
    endsAt: event.endsAt,
    location: event.location,
    notes: event.notes,
    provider,
    raw: event.raw,
    recurrence: event.recurrence,
    remoteEtag: event.etag,
    remoteEventId: event.remoteEventId,
    startsAt: event.startsAt,
    status: event.status,
    syncedAt: timestamp,
    timezone: event.timezone,
    title: event.title,
    updatedAt: timestamp,
    userId,
  };
}
