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
import {
  ConnectorError,
  createICloudConnector,
  MailSendPreAcceptanceError,
} from "@personal-os/connectors";
import {
  attentionItems,
  auditEvents,
  calendarAccounts,
  calendarEvents,
  calendars,
  type Database,
  domainProfiles,
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
  MailRuleAction,
  StartGoogleAuthorizationInput,
  UpdateEventInput,
} from "@personal-os/domain";
import {
  mailProfilePreferencesSchema,
  matchesMailRule,
  resolveStoredMailRule,
} from "@personal-os/domain";
import { and, asc, eq, gt, inArray, isNull, lt, ne, notInArray, or, sql } from "drizzle-orm";
import { auditValues } from "./audit.js";
import { requireDatabaseRecord } from "./database.js";
import { AppError } from "./errors.js";
import { decryptJson, encryptJson, generateToken, hashToken } from "./security.js";
import {
  auditAttentionItemMetadata,
  auditDomainProfileMetadata,
  auditSnapshot,
  domainProfileChangedFields,
} from "./serialization.js";

const GOOGLE_OAUTH_STATE_TTL_MS = 30 * 60_000;
const CONNECTOR_SYNC_LEASE_MS = 30 * 60_000;
const MAIL_RULE_EXECUTION_BUDGET = 6;
const MAIL_RULE_WRITE_CONCURRENCY = 2;

type CalendarRow = typeof calendars.$inferSelect;
type EventRow = typeof calendarEvents.$inferSelect;
type AccountRow = typeof calendarAccounts.$inferSelect & {
  encryptedCredentials: NonNullable<typeof calendarAccounts.$inferSelect.encryptedCredentials>;
};
type DatabaseTransaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type ExecutableMailRuleAction = MailRuleAction & {
  type: "add_label" | "mark_read" | "star";
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

type MailProviderPartialEffectContext = {
  accountId: string;
  cause: unknown;
  credentialsPersisted: boolean;
  draftId?: string;
  operation: "rule_execution" | "send" | "thread_update";
  remoteThreadId?: string;
  ruleId?: string;
  threadId?: string;
};

export function mailProviderPartialEffectError({
  accountId,
  cause,
  credentialsPersisted,
  draftId,
  operation,
  remoteThreadId,
  ruleId,
  threadId,
}: MailProviderPartialEffectContext): AppError {
  if (
    cause instanceof AppError &&
    typeof cause.details === "object" &&
    cause.details !== null &&
    "partialEffect" in cause.details &&
    cause.details.partialEffect === true
  ) {
    return cause;
  }
  const sentMessageNeedsReconciliation = operation === "send";
  const sentDraftNeedsReconciliation = sentMessageNeedsReconciliation && draftId !== undefined;
  const repairAction = !credentialsPersisted
    ? "reconnect_then_sync_mail_account"
    : sentDraftNeedsReconciliation
      ? "verify_sent_mail_then_reconcile_draft"
      : sentMessageNeedsReconciliation
        ? "verify_sent_mail_never_retry"
        : "sync_mail_account";
  const userAction = !credentialsPersisted
    ? "Open Settings → Connections, reconnect this Mail account, then open Mail and choose Sync."
    : sentMessageNeedsReconciliation
      ? "Inspect the provider's Sent Mail before any retry. If the message exists, do not resend it; return to Ilo to reconcile the local state."
      : "Open Mail and choose Sync before retrying this action.";
  const userActionDestination = !credentialsPersisted
    ? "Settings → Connections → reconnect; Mail → Sync"
    : sentMessageNeedsReconciliation
      ? "Provider Sent Mail; then Ilo Mail"
      : "Mail → Sync";
  const message = !credentialsPersisted
    ? "The provider Mail mutation may have committed, but Ilo could not persist rotated provider credentials. Reconnect this Mail account, then sync it to reconcile provider state before retrying."
    : sentDraftNeedsReconciliation
      ? "The provider may have sent this message, but Ilo could not mark its draft as sent. Verify Sent Mail before retrying, then reconcile or remove the local draft."
      : sentMessageNeedsReconciliation
        ? "The provider may have sent this message, but this draftless send has no durable Ilo recovery object. Inspect Sent Mail and never automatically retry this request."
        : "The provider Mail mutation may have committed, but Ilo could not persist its local projection and audit. Sync this Mail account to reconcile provider state before retrying.";
  return new AppError("service_unavailable", message, {
    accountId,
    ...(cause instanceof AppError ? { causeCode: cause.code } : {}),
    credentialPersistenceMayHaveFailed: !credentialsPersisted,
    ...(draftId ? { draftId } : {}),
    operation,
    partialEffect: true,
    repairAction,
    userAction,
    userActionDestination,
    userActionRequired: true,
    ...(remoteThreadId ? { remoteThreadId } : {}),
    ...(ruleId ? { ruleId } : {}),
    ...(threadId ? { threadId } : {}),
  });
}

/**
 * A provider response that proves a send was rejected before acceptance.
 *
 * Transport failures are deliberately not classified this way: a connection can
 * fail after the provider accepted the message, so callers must reconcile those.
 */
export class MailProviderRejectedError extends Error {
  public override readonly cause: unknown;

  public constructor(message: string, cause: unknown) {
    super(message);
    this.name = "MailProviderRejectedError";
    this.cause = cause;
  }
}

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

  async function saveGoogleCredentials(
    accountId: string,
    value: GoogleCredentials,
    requireExisting = false,
  ): Promise<GoogleCredentials> {
    return db.transaction(async (transaction) => {
      const [account] = await transaction
        .select({
          encryptedCredentials: calendarAccounts.encryptedCredentials,
          id: calendarAccounts.id,
        })
        .from(calendarAccounts)
        .where(eq(calendarAccounts.id, accountId))
        .for("update")
        .limit(1);
      if (!account?.encryptedCredentials) {
        if (requireExisting) {
          throw new AppError(
            "not_found",
            "The connected Mail account disappeared before provider credentials were saved.",
          );
        }
        return value;
      }
      const durable = decryptJson<GoogleCredentials>(account.encryptedCredentials, encryptionKey);
      const candidateIsNewer =
        new Date(value.expiresAt).getTime() > new Date(durable.expiresAt).getTime();
      if (!candidateIsNewer) return durable;
      const merged = {
        ...value,
        refreshToken: value.refreshToken || durable.refreshToken,
      };
      const [updated] = await transaction
        .update(calendarAccounts)
        .set({ encryptedCredentials: encryptJson(merged, encryptionKey), updatedAt: now() })
        .where(eq(calendarAccounts.id, accountId))
        .returning({ id: calendarAccounts.id });
      if (!updated && requireExisting) {
        throw new AppError(
          "not_found",
          "The connected Mail account disappeared before provider credentials were saved.",
        );
      }
      return merged;
    });
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
      if (!account.mailEnabled) {
        throw new AppError("invalid_request", "Mail is not enabled for this connected account.");
      }
      if (!account.email) {
        throw new AppError("internal_error", "The connected Mail account has no sender address.");
      }
      const providerInput = { ...input, from: account.email };
      if (account.provider === "icloud" && icloud.sendMail) {
        await icloud.sendMail(credentials<ICloudCredentials>(account), providerInput);
        return;
      }
      if (account.provider !== "google" || !google.sendMail) {
        throw new AppError(
          "service_unavailable",
          "This mail provider does not yet support sending mail.",
        );
      }
      let updatedCredentials: GoogleCredentials;
      try {
        updatedCredentials = await google.sendMail(
          credentials<GoogleCredentials>(account),
          providerInput,
        );
      } catch (error) {
        if (error instanceof MailSendPreAcceptanceError) {
          throw new MailProviderRejectedError(
            "The Mail provider rejected the message before accepting it.",
            error,
          );
        }
        throw error;
      }
      try {
        await saveGoogleCredentials(account.id, updatedCredentials, true);
      } catch (error) {
        throw mailProviderPartialEffectError({
          accountId: account.id,
          cause: error,
          credentialsPersisted: false,
          operation: "send",
          ...(input.threadId ? { remoteThreadId: input.threadId } : {}),
        });
      }
    },
    /* v8 ignore start -- provider dispatch variants are exercised in connector contracts */
    async update(userId, accountId, remoteThreadId, input) {
      const account = await getAccount(userId, accountId);
      if (!account.mailEnabled) {
        throw new AppError("invalid_request", "Mail is not enabled for this connected account.");
      }
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
      try {
        await saveGoogleCredentials(account.id, updatedCredentials, true);
      } catch (error) {
        throw mailProviderPartialEffectError({
          accountId: account.id,
          cause: error,
          credentialsPersisted: false,
          operation: "thread_update",
          remoteThreadId,
        });
      }
    },
  };
  /* v8 ignore stop */

  async function syncAccount(
    userId: string,
    accountId: string,
    options: { skipMail?: boolean } = {},
  ): Promise<{ changed: number }> {
    const staleBefore = new Date(now().getTime() - CONNECTOR_SYNC_LEASE_MS);
    const [claimedAccount] = await db
      .update(calendarAccounts)
      .set({ syncError: null, syncStatus: "syncing", updatedAt: now() })
      .where(
        and(
          eq(calendarAccounts.id, accountId),
          eq(calendarAccounts.userId, userId),
          ne(calendarAccounts.provider, "local"),
          or(
            ne(calendarAccounts.syncStatus, "syncing"),
            lt(calendarAccounts.updatedAt, staleBefore),
          ),
        ),
      )
      .returning();
    if (!claimedAccount) {
      const [current] = await db
        .select({ id: calendarAccounts.id, syncStatus: calendarAccounts.syncStatus })
        .from(calendarAccounts)
        .where(
          and(
            eq(calendarAccounts.id, accountId),
            eq(calendarAccounts.userId, userId),
            ne(calendarAccounts.provider, "local"),
          ),
        )
        .limit(1);
      if (!current) throw new AppError("not_found", "The connected account was not found.");
      throw new AppError("conflict", "This connected account is already syncing.", {
        accountId,
        syncStatus: current.syncStatus,
      });
    }
    const requestId = `sync:${randomUUID()}`;
    const principal = { actorId: claimedAccount.id, actorType: "connector", userId } as const;
    try {
      if (!claimedAccount.encryptedCredentials) {
        throw new AppError("not_found", "The connected account was not found.");
      }
      const account: AccountRow = {
        ...claimedAccount,
        encryptedCredentials: claimedAccount.encryptedCredentials,
      };
      let googleCredentials =
        account.provider === "google" ? credentials<GoogleCredentials>(account) : null;
      const icloudCredentials =
        account.provider === "icloud" ? credentials<ICloudCredentials>(account) : null;
      let changed = 0;
      let mailCredentialsPersisted = false;
      if (account.calendarEnabled) {
        if (account.provider === "google" && googleCredentials) {
          const remoteCalendars = await google.listCalendars(googleCredentials);
          googleCredentials = remoteCalendars.credentials;
          await saveCalendars(account, remoteCalendars.value, "google");
        } else if (account.provider === "icloud" && icloudCredentials) {
          await saveCalendars(account, await icloud.listCalendars(icloudCredentials), "icloud");
        }
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
          googleCredentials = await saveGoogleCredentials(account.id, result.credentials, true);
          mailCredentialsPersisted = true;
          mail = result.value;
        } else if (account.provider === "icloud" && icloudCredentials) {
          mail = await icloud.syncMail(icloudCredentials);
        } else {
          throw new AppError("internal_error", "Mail credentials are unavailable.");
        }
        const projected = await projectMail(account, mail, principal, requestId, googleCredentials);
        changed += projected.changed;
        mailCredentialsPersisted = mailCredentialsPersisted || projected.credentials !== null;
        googleCredentials = projected.credentials ?? googleCredentials;
      }
      await db
        .update(calendarAccounts)
        .set({
          ...(googleCredentials && !mailCredentialsPersisted
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
      try {
        await db
          .update(calendarAccounts)
          .set({
            syncError: error instanceof Error ? error.message : "Unknown connector error",
            syncStatus: "error",
            updatedAt: now(),
          })
          .where(eq(calendarAccounts.id, claimedAccount.id));
      } catch {
        // Terminal status is best-effort and must not mask a structured
        // provider partial-effect/reconciliation contract.
      }
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

  async function pauseInvalidMailRuleInTransaction(
    transaction: DatabaseTransaction,
    rule: typeof mailRules.$inferSelect,
    reason: string,
    reasonCode: string,
    principal: { actorId: string; actorType: "connector" | "user"; userId: string },
    requestId: string,
  ): Promise<void> {
    const [paused] = await transaction
      .update(mailRules)
      .set({
        enabled: false,
        policy: "preview",
        updatedAt: now(),
        version: rule.version + 1,
      })
      .where(
        and(
          eq(mailRules.id, rule.id),
          eq(mailRules.enabled, true),
          eq(mailRules.version, rule.version),
        ),
      )
      .returning();
    if (!paused) return;
    const [existingAttention] = await transaction
      .select({ id: attentionItems.id })
      .from(attentionItems)
      .where(
        and(
          eq(attentionItems.userId, rule.userId),
          eq(attentionItems.domain, "mail"),
          eq(attentionItems.status, "open"),
          eq(attentionItems.relatedEntityType, "mail_rule"),
          eq(attentionItems.relatedEntityId, rule.id),
        ),
      )
      .limit(1);
    const attentionValues = {
      importance: "high" as const,
      kind: "follow_up" as const,
      summary: `${reason} Review the Mail profile and rule, then re-review it before activating again.`,
      title: `Mail rule paused: ${rule.name}`,
      updatedAt: now(),
    };
    if (existingAttention) {
      await transaction
        .update(attentionItems)
        .set(attentionValues)
        .where(eq(attentionItems.id, existingAttention.id));
    } else {
      await transaction.insert(attentionItems).values({
        ...attentionValues,
        domain: "mail",
        relatedEntityId: rule.id,
        relatedEntityType: "mail_rule",
        status: "open",
        userId: rule.userId,
      });
    }
    await transaction.insert(auditEvents).values(
      auditValues({
        action: "mail.rule.paused_policy_mismatch",
        after: {
          enabled: false,
          policy: paused.policy,
          reasonCode,
          version: paused.version,
        },
        before: { enabled: true, policy: rule.policy, version: rule.version },
        entityId: rule.id,
        entityType: "mail_rule",
        principal,
        requestId,
      }),
    );
  }

  async function pauseInvalidMailRule(
    rule: typeof mailRules.$inferSelect,
    reason: string,
    principal: { actorId: string; actorType: "connector"; userId: string },
    requestId: string,
  ): Promise<void> {
    await db.transaction((transaction) =>
      pauseInvalidMailRuleInTransaction(
        transaction,
        rule,
        reason,
        "runtime_policy_mismatch",
        principal,
        requestId,
      ),
    );
  }

  async function invalidateMailAccountDependents(
    transaction: DatabaseTransaction,
    account: typeof calendarAccounts.$inferSelect,
    reason: string,
    reasonCode: "account_disconnected" | "mail_capability_disabled",
    requestId: string,
  ): Promise<void> {
    const principal = {
      actorId: account.userId,
      actorType: "user" as const,
      userId: account.userId,
    };
    const accountThreads = await transaction
      .select({ id: mailThreads.id })
      .from(mailThreads)
      .where(and(eq(mailThreads.accountId, account.id), eq(mailThreads.userId, account.userId)))
      .orderBy(asc(mailThreads.id))
      .for("update");
    const threadIds = new Set(accountThreads.map((thread) => thread.id));
    const rules = await transaction
      .select()
      .from(mailRules)
      .where(
        and(
          eq(mailRules.userId, account.userId),
          eq(mailRules.enabled, true),
          sql<boolean>`${mailRules.sourceAccountIds} @> ${JSON.stringify([account.id])}::jsonb`,
        ),
      )
      .orderBy(asc(mailRules.id))
      .for("update");
    const openMailAttention = await transaction
      .select()
      .from(attentionItems)
      .where(
        and(
          eq(attentionItems.userId, account.userId),
          eq(attentionItems.domain, "mail"),
          eq(attentionItems.status, "open"),
        ),
      )
      .orderBy(asc(attentionItems.id))
      .for("update");
    for (const item of openMailAttention) {
      const sourceAccountId =
        item.source && "accountId" in item.source ? item.source.accountId : null;
      if (
        !(
          (item.relatedEntityId !== null && threadIds.has(item.relatedEntityId)) ||
          (item.relatedEntityType === "mail_account" && item.relatedEntityId === account.id) ||
          sourceAccountId === account.id
        )
      ) {
        continue;
      }
      const [detached] = await transaction
        .update(attentionItems)
        .set({
          relatedEntityId: null,
          relatedEntityType: null,
          source: null,
          updatedAt: now(),
        })
        .where(eq(attentionItems.id, item.id))
        .returning();
      if (!detached) continue;
      await transaction.insert(auditEvents).values(
        auditValues({
          action: "assistant.attention.detached",
          after: auditAttentionItemMetadata(detached),
          before: auditAttentionItemMetadata(item),
          entityId: detached.id,
          entityType: "attention_item",
          principal,
          requestId,
        }),
      );
    }
    const [profile] = await transaction
      .select()
      .from(domainProfiles)
      .where(and(eq(domainProfiles.userId, account.userId), eq(domainProfiles.domain, "mail")))
      .for("update")
      .limit(1);
    if (profile?.sourceContexts.some((sourceContext) => sourceContext.sourceId === account.id)) {
      const nextSourceContexts = profile.sourceContexts.filter(
        (sourceContext) => sourceContext.sourceId !== account.id,
      );
      const [updatedProfile] = await transaction
        .update(domainProfiles)
        .set({
          sourceContexts: nextSourceContexts,
          status: profile.status === "active" ? "draft" : profile.status,
          updatedAt: now(),
          version: profile.version + 1,
        })
        .where(and(eq(domainProfiles.id, profile.id), eq(domainProfiles.version, profile.version)))
        .returning();
      if (!updatedProfile) {
        throw new AppError(
          "conflict",
          "The Mail profile changed while its disconnected source was being removed.",
        );
      }
      const changedFields = domainProfileChangedFields(profile, updatedProfile);
      await transaction.insert(auditEvents).values(
        auditValues({
          action: "assistant.profile.updated",
          after: auditDomainProfileMetadata(updatedProfile, changedFields),
          before: auditDomainProfileMetadata(profile, changedFields),
          entityId: updatedProfile.id,
          entityType: "domain_profile",
          principal,
          requestId,
        }),
      );
    }
    for (const rule of rules) {
      await pauseInvalidMailRuleInTransaction(
        transaction,
        rule,
        reason,
        reasonCode,
        principal,
        requestId,
      );
    }
    if (reasonCode === "mail_capability_disabled") {
      await transaction
        .delete(mailThreads)
        .where(and(eq(mailThreads.accountId, account.id), eq(mailThreads.userId, account.userId)));
      await transaction
        .delete(mailboxes)
        .where(and(eq(mailboxes.accountId, account.id), eq(mailboxes.userId, account.userId)));
    }
  }

  async function executableMailRules(
    account: AccountRow,
    principal: { actorId: string; actorType: "connector"; userId: string },
    requestId: string,
  ): Promise<
    Array<{
      profileVersion: number;
      resolved: ReturnType<typeof resolveStoredMailRule>;
      rule: typeof mailRules.$inferSelect;
    }>
  > {
    const rules = await db
      .select()
      .from(mailRules)
      .where(and(eq(mailRules.userId, account.userId), eq(mailRules.enabled, true)));
    const [mailProfile] = await db
      .select()
      .from(domainProfiles)
      .where(and(eq(domainProfiles.userId, account.userId), eq(domainProfiles.domain, "mail")))
      .limit(1);
    const executable = [];
    for (const rule of rules) {
      const resolved = resolveStoredMailRule({
        action: rule.legacyAction,
        actions: rule.actions,
        condition: rule.condition,
        enabled: rule.enabled,
        policy: rule.policy,
        query: rule.legacyQuery,
      });
      if (resolved.policy !== "approved_rule") {
        await pauseInvalidMailRule(
          rule,
          "The rule no longer has approved-rule policy.",
          principal,
          requestId,
        );
        continue;
      }
      if (rule.sourceAccountIds.length > 0 && !rule.sourceAccountIds.includes(account.id)) continue;
      let invalidReason: string | null = null;
      if (!rule.profileId) {
        invalidReason = "The rule is not linked to an active Mail profile.";
      } else if (
        rule.sourceAccountIds.length === 0 ||
        new Set(rule.sourceAccountIds).size !== rule.sourceAccountIds.length
      ) {
        invalidReason = "The rule does not have a unique explicit Mail account source set.";
      }
      const profile = rule.profileId === mailProfile?.id ? mailProfile : null;
      if (!invalidReason && profile?.status !== "active") {
        invalidReason = "The linked Mail profile is no longer active.";
      }
      if (
        !invalidReason &&
        profile &&
        rule.sourceAccountIds.some(
          (sourceId) =>
            !profile.sourceContexts.some((sourceContext) => sourceContext.sourceId === sourceId),
        )
      ) {
        invalidReason = "A rule source no longer has an explicit meaning in the Mail profile.";
      }
      const sourceAccounts =
        rule.sourceAccountIds.length === 0
          ? []
          : await db
              .select({
                id: calendarAccounts.id,
                mailEnabled: calendarAccounts.mailEnabled,
                provider: calendarAccounts.provider,
              })
              .from(calendarAccounts)
              .where(
                and(
                  eq(calendarAccounts.userId, rule.userId),
                  inArray(calendarAccounts.id, rule.sourceAccountIds),
                ),
              );
      if (
        !invalidReason &&
        (sourceAccounts.length !== rule.sourceAccountIds.length ||
          sourceAccounts.some((source) => !source.mailEnabled || source.provider !== "google"))
      ) {
        invalidReason = "Automatic Mail rules currently require connected Google Mail sources.";
      }
      const labelIds = resolved.actions.flatMap((action) =>
        action.type === "add_label" && action.mailboxId ? [action.mailboxId] : [],
      );
      if (!invalidReason && labelIds.length > 0) {
        const destinations = await db
          .select({ accountId: mailboxes.accountId, id: mailboxes.id, role: mailboxes.role })
          .from(mailboxes)
          .where(
            and(
              eq(mailboxes.userId, rule.userId),
              isNull(mailboxes.deletedAt),
              inArray(mailboxes.id, labelIds),
            ),
          );
        if (
          destinations.length !== new Set(labelIds).size ||
          destinations.some((destination) => destination.role !== "custom") ||
          rule.sourceAccountIds.length !== 1 ||
          destinations.some((destination) => destination.accountId !== rule.sourceAccountIds[0])
        ) {
          invalidReason =
            "A destination label is unavailable or no longer belongs to the rule's Mail source.";
        }
      }
      const preferences = profile
        ? mailProfilePreferencesSchema.safeParse(profile.preferences)
        : null;
      if (!invalidReason && preferences && !preferences.success) {
        invalidReason = "The linked Mail profile has invalid retention preferences.";
      }
      if (
        !invalidReason &&
        resolved.actions.some(
          (action) => action.afterDays > 0 || action.type === "archive" || action.type === "trash",
        )
      ) {
        invalidReason =
          "Delayed archive and recoverable Trash automation is paused until Mail has a durable due-work backlog.";
      }
      if (invalidReason) {
        await pauseInvalidMailRule(rule, invalidReason, principal, requestId);
        continue;
      }
      const executableProfile = profile as NonNullable<typeof profile>;
      executable.push({
        profileVersion: executableProfile.version,
        resolved: {
          ...resolved,
          actions: resolved.actions as ExecutableMailRuleAction[],
        },
        rule,
      });
    }
    return executable;
  }

  async function mailRuleAuthorizationIsCurrent(
    rule: typeof mailRules.$inferSelect,
    profileVersion: number,
  ): Promise<boolean> {
    const [authorization] = await db
      .select({ id: mailRules.id })
      .from(mailRules)
      .innerJoin(domainProfiles, eq(domainProfiles.id, mailRules.profileId))
      .where(
        and(
          eq(mailRules.id, rule.id),
          eq(mailRules.enabled, true),
          eq(mailRules.version, rule.version),
          eq(domainProfiles.status, "active"),
          eq(domainProfiles.version, profileVersion),
        ),
      )
      .limit(1);
    return authorization !== undefined;
  }

  async function projectMail(
    account: AccountRow,
    value: MailSyncResult["value"],
    principal: { actorId: string; actorType: "connector"; userId: string },
    requestId: string,
    initialGoogleCredentials: GoogleCredentials | null,
  ): Promise<{ changed: number; credentials: GoogleCredentials | null }> {
    const provider = account.provider === "icloud" ? "icloud" : "google";
    let updatedGoogleCredentials: GoogleCredentials | null = null;
    let successfulRuleMutationCount = 0;
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
    const rules = await executableMailRules(account, principal, requestId);
    let runSummaryPersisted = true;
    if (account.provider === "google" && google.updateMailThread && rules.length > 0) {
      const updateMailThread = google.updateMailThread;
      let currentCredentials = initialGoogleCredentials ?? credentials<GoogleCredentials>(account);
      let credentialCoordinator = currentCredentials;
      let credentialWriteTail = Promise.resolve();
      const persistProviderCredentials = async (
        candidate: GoogleCredentials,
      ): Promise<GoogleCredentials> => {
        const previousWrite = credentialWriteTail;
        let releaseWrite: (() => void) | undefined;
        credentialWriteTail = new Promise<void>((resolveWrite) => {
          releaseWrite = resolveWrite;
        });
        await previousWrite;
        try {
          const candidateIsNewer =
            new Date(candidate.expiresAt).getTime() >=
            new Date(credentialCoordinator.expiresAt).getTime();
          const merged = candidateIsNewer
            ? {
                ...candidate,
                refreshToken: candidate.refreshToken || credentialCoordinator.refreshToken,
              }
            : {
                ...credentialCoordinator,
                refreshToken: credentialCoordinator.refreshToken || candidate.refreshToken,
              };
          const persisted = await saveGoogleCredentials(account.id, merged, true);
          credentialCoordinator = persisted;
          currentCredentials = persisted;
          return persisted;
        } finally {
          releaseWrite?.();
        }
      };
      const accountMailboxes = await db
        .select({ id: mailboxes.id, remoteMailboxId: mailboxes.remoteMailboxId })
        .from(mailboxes)
        .where(
          and(
            eq(mailboxes.accountId, account.id),
            eq(mailboxes.userId, account.userId),
            isNull(mailboxes.deletedAt),
          ),
        );
      const remoteMailboxById = new Map(
        accountMailboxes.map((mailbox) => [mailbox.id, mailbox.remoteMailboxId]),
      );
      const plannedMutations: Array<{
        addMailboxIds: string[];
        authorizations: Array<{
          profileVersion: number;
          rule: typeof mailRules.$inferSelect;
        }>;
        nextMailboxIds: string[];
        nextStarred: boolean;
        nextUnread: boolean;
        remoteThreadId: string;
        removeMailboxIds: string[];
      }> = [];
      for (const thread of value.threads) {
        let projectedMailboxIds = thread.mailboxIds;
        let projectedStarred = thread.starred;
        let projectedUnread = thread.unread;
        const authorizations: Array<{
          profileVersion: number;
          rule: typeof mailRules.$inferSelect;
        }> = [];
        for (const { profileVersion, resolved: resolvedRule, rule } of rules) {
          if (
            !matchesMailRule(resolvedRule.condition, {
              from: thread.from,
              snippet: thread.snippet,
              subject: thread.subject,
            })
          )
            continue;
          const addMailboxIds: string[] = [];
          const removeMailboxIds: string[] = [];
          for (const action of resolvedRule.actions) {
            if (action.type === "mark_read" && projectedUnread) removeMailboxIds.push("UNREAD");
            if (action.type === "star" && !projectedStarred) addMailboxIds.push("STARRED");
            if (action.type === "add_label" && action.mailboxId) {
              const remoteMailboxId = remoteMailboxById.get(action.mailboxId);
              if (remoteMailboxId && !projectedMailboxIds.includes(remoteMailboxId))
                addMailboxIds.push(remoteMailboxId);
            }
          }
          const uniqueAddMailboxIds = [...new Set(addMailboxIds)];
          const uniqueRemoveMailboxIds = [...new Set(removeMailboxIds)];
          if (uniqueAddMailboxIds.length === 0 && uniqueRemoveMailboxIds.length === 0) continue;
          authorizations.push({ profileVersion, rule });
          const nextMailboxIds = [
            ...projectedMailboxIds.filter(
              (mailboxId) => !uniqueRemoveMailboxIds.includes(mailboxId),
            ),
            ...uniqueAddMailboxIds.filter(
              (mailboxId) => mailboxId !== "STARRED" && !projectedMailboxIds.includes(mailboxId),
            ),
          ];
          projectedMailboxIds = nextMailboxIds;
          if (uniqueRemoveMailboxIds.includes("UNREAD")) projectedUnread = false;
          if (uniqueAddMailboxIds.includes("STARRED")) projectedStarred = true;
        }
        if (authorizations.length > 0) {
          const finalMailboxIds = new Set(projectedMailboxIds);
          const originalMailboxIds = new Set(thread.mailboxIds);
          const removeMailboxIds = [
            ...new Set([
              ...thread.mailboxIds.filter((mailboxId) => !finalMailboxIds.has(mailboxId)),
              ...(thread.unread && !projectedUnread ? ["UNREAD"] : []),
            ]),
          ];
          const removals = new Set(removeMailboxIds);
          const addMailboxIds = [
            ...new Set([
              ...projectedMailboxIds.filter((mailboxId) => !originalMailboxIds.has(mailboxId)),
              ...(!thread.starred && projectedStarred ? ["STARRED"] : []),
            ]),
          ].filter((mailboxId) => !removals.has(mailboxId));
          plannedMutations.push({
            addMailboxIds,
            authorizations,
            nextMailboxIds: projectedMailboxIds,
            nextStarred: projectedStarred,
            nextUnread: projectedUnread,
            remoteThreadId: thread.remoteThreadId,
            removeMailboxIds,
          });
        }
      }
      const executionBudget = plannedMutations.slice(0, MAIL_RULE_EXECUTION_BUDGET);
      const backlogCount = Math.max(0, plannedMutations.length - executionBudget.length);
      const outcomes: Array<{
        authorizationChanged?: boolean;
        error?: AppError;
        providerEffect?: boolean;
        succeeded: boolean;
      }> = new Array(executionBudget.length);
      let nextMutationIndex = 0;
      const executeWorker = async () => {
        while (nextMutationIndex < executionBudget.length) {
          const index = nextMutationIndex++;
          const planned = executionBudget[index] as (typeof executionBudget)[number];
          const authorizationsCurrent = await Promise.all(
            planned.authorizations.map(({ profileVersion, rule }) =>
              mailRuleAuthorizationIsCurrent(rule, profileVersion),
            ),
          );
          if (authorizationsCurrent.some((current) => !current)) {
            outcomes[index] = {
              authorizationChanged: true,
              error: new AppError(
                "conflict",
                "A Mail rule authorization changed before provider execution.",
              ),
              providerEffect: false,
              succeeded: false,
            };
            continue;
          }
          const ruleErrorDetails =
            planned.authorizations.length === 1 && planned.authorizations[0]
              ? { ruleId: planned.authorizations[0].rule.id }
              : {};
          let providerCredentials: GoogleCredentials;
          try {
            providerCredentials = await updateMailThread(
              credentialCoordinator,
              planned.remoteThreadId,
              {
                addMailboxIds: planned.addMailboxIds,
                removeMailboxIds: planned.removeMailboxIds,
              },
            );
          } catch (error) {
            outcomes[index] = {
              error: mailProviderPartialEffectError({
                accountId: account.id,
                cause: error,
                credentialsPersisted: true,
                operation: "rule_execution",
                remoteThreadId: planned.remoteThreadId,
                ...ruleErrorDetails,
              }),
              providerEffect: true,
              succeeded: false,
            };
            continue;
          }
          let credentialsPersisted = false;
          try {
            providerCredentials = await persistProviderCredentials(providerCredentials);
            credentialsPersisted = true;
            await db.transaction(async (transaction) => {
              for (const { profileVersion, rule } of planned.authorizations) {
                const [authorization] = await transaction
                  .select({ id: mailRules.id })
                  .from(mailRules)
                  .innerJoin(domainProfiles, eq(domainProfiles.id, mailRules.profileId))
                  .where(
                    and(
                      eq(mailRules.id, rule.id),
                      eq(mailRules.enabled, true),
                      eq(mailRules.version, rule.version),
                      eq(domainProfiles.status, "active"),
                      eq(domainProfiles.version, profileVersion),
                    ),
                  )
                  .for("update");
                if (!authorization) {
                  throw new AppError(
                    "conflict",
                    "A Mail rule authorization changed during provider execution.",
                  );
                }
              }
              const [updatedThread] = await transaction
                .update(mailThreads)
                .set({
                  remoteMailboxIds: planned.nextMailboxIds,
                  starred: planned.nextStarred,
                  unread: planned.nextUnread,
                  updatedAt: now(),
                })
                .where(
                  and(
                    eq(mailThreads.accountId, account.id),
                    eq(mailThreads.remoteThreadId, planned.remoteThreadId),
                  ),
                )
                .returning({ id: mailThreads.id });
              if (!updatedThread) {
                throw new AppError("not_found", "The projected Mail conversation was not found.");
              }
              await transaction.insert(auditEvents).values(
                auditValues({
                  action: "mail.rule.applied",
                  after: {
                    contributingRuleCount: planned.authorizations.length,
                    providerMutationCount:
                      planned.addMailboxIds.length + planned.removeMailboxIds.length,
                  },
                  before: null,
                  entityId: updatedThread.id,
                  entityType: "mail_thread",
                  principal,
                  requestId,
                }),
              );
            });
            outcomes[index] = { succeeded: true };
          } catch (error) {
            outcomes[index] = {
              error: mailProviderPartialEffectError({
                accountId: account.id,
                cause: error,
                credentialsPersisted,
                operation: "rule_execution",
                remoteThreadId: planned.remoteThreadId,
                ...ruleErrorDetails,
              }),
              providerEffect: true,
              succeeded: false,
            };
          }
        }
      };
      await Promise.all(
        Array.from({ length: Math.min(MAIL_RULE_WRITE_CONCURRENCY, executionBudget.length) }, () =>
          executeWorker(),
        ),
      );
      const succeededCount = outcomes.filter((outcome) => outcome?.succeeded).length;
      successfulRuleMutationCount = succeededCount;
      const failures = outcomes.filter(
        (
          outcome,
        ): outcome is {
          authorizationChanged?: boolean;
          error: AppError;
          providerEffect?: boolean;
          succeeded: false;
        } => outcome?.succeeded === false && outcome.error !== undefined,
      );
      const authorizationChangedCount = failures.filter(
        ({ authorizationChanged }) => authorizationChanged === true,
      ).length;
      const partialEffectCount = failures.filter(
        ({ providerEffect }) => providerEffect === true,
      ).length;
      const hasCredentialFailure = failures.some(
        ({ error }) =>
          typeof error.details === "object" &&
          error.details !== null &&
          (error.details as Record<string, unknown>).credentialPersistenceMayHaveFailed === true,
      );
      const failedProviderEffect = failures.some(({ providerEffect }) => providerEffect === true);
      if (plannedMutations.length > 0) {
        try {
          await db.transaction(async (transaction) => {
            await transaction.insert(auditEvents).values(
              auditValues({
                action: "mail.rule.run",
                after: {
                  attemptedCount: executionBudget.length,
                  authorizationChangedCount,
                  backlogCount,
                  failedCount: failures.length,
                  partialEffectCount,
                  succeededCount,
                },
                before: null,
                entityId: account.id,
                entityType: "mail_account",
                principal,
                requestId,
              }),
            );
            if (backlogCount > 0 || failures.length > 0) {
              const [existingRunAttention] = await transaction
                .select({ id: attentionItems.id })
                .from(attentionItems)
                .where(
                  and(
                    eq(attentionItems.userId, account.userId),
                    eq(attentionItems.domain, "mail"),
                    eq(attentionItems.kind, "follow_up"),
                    eq(attentionItems.status, "open"),
                    eq(attentionItems.relatedEntityType, "mail_account"),
                    eq(attentionItems.relatedEntityId, account.id),
                  ),
                )
                .limit(1);
              const attentionValues = failedProviderEffect
                ? {
                    importance: "high" as const,
                    kind: "follow_up" as const,
                    summary: `Mail automation applied ${succeededCount} thread updates; ${partialEffectCount} failed updates need ${hasCredentialFailure ? "account reconnection and Mail sync" : "Mail sync and provider reconciliation"}, ${authorizationChangedCount} need policy review, and ${backlogCount} remain for a later sync.`,
                    title: hasCredentialFailure
                      ? "Reconnect Mail to reconcile automation"
                      : "Mail automation needs provider reconciliation",
                    updatedAt: now(),
                  }
                : authorizationChangedCount > 0
                  ? {
                      importance: "high" as const,
                      kind: "follow_up" as const,
                      summary: `Mail automation applied ${succeededCount} thread updates; ${authorizationChangedCount} were stopped before provider access and need rule or profile review, and ${backlogCount} remain for a later sync.`,
                      title: "Mail automation needs policy review",
                      updatedAt: now(),
                    }
                  : {
                      importance: "normal" as const,
                      kind: "follow_up" as const,
                      summary: `Mail automation applied ${succeededCount} thread updates; ${backlogCount} remain for a later sync.`,
                      title: "Mail automation has pending work",
                      updatedAt: now(),
                    };
              if (existingRunAttention) {
                await transaction
                  .update(attentionItems)
                  .set(attentionValues)
                  .where(eq(attentionItems.id, existingRunAttention.id));
              } else {
                // The per-account sync lease serializes this Mail-owned run-summary upsert.
                await transaction.insert(attentionItems).values({
                  ...attentionValues,
                  domain: "mail",
                  relatedEntityId: account.id,
                  relatedEntityType: "mail_account",
                  status: "open",
                  userId: account.userId,
                });
              }
            }
          });
        } catch {
          runSummaryPersisted = false;
        }
      }
      if (failures.length > 0) {
        const hasProviderEffect = succeededCount > 0 || failedProviderEffect;
        throw new AppError(
          hasProviderEffect ? "service_unavailable" : "conflict",
          hasCredentialFailure
            ? "Mail automation had partial provider effects and could not persist provider credentials. Reconnect this account, then sync before retrying."
            : failedProviderEffect
              ? "Mail automation had partial provider effects. Sync this account to reconcile before retrying."
              : succeededCount > 0
                ? "Mail automation applied some authorized work, while other policy changed before provider execution. Review the current Mail policy."
                : "Mail automation authorization changed before provider execution. Review the current Mail policy.",
          {
            attemptedCount: executionBudget.length,
            authorizationChangedCount,
            backlogCount,
            failedCount: failures.length,
            partialEffect: hasProviderEffect,
            repairAction: hasCredentialFailure
              ? "reconnect_then_sync_mail_account"
              : failedProviderEffect
                ? "sync_mail_account"
                : "review_current_policy",
            runSummaryPersisted,
            succeededCount,
            userAction: hasCredentialFailure
              ? "Open Settings → Connections, reconnect this Mail account, then open Mail and choose Sync."
              : failedProviderEffect
                ? "Open Mail and choose Sync before retrying any failed automation."
                : "Open Settings → Agent access → Review Mail rules and review the current policy.",
            userActionDestination: hasCredentialFailure
              ? "Settings → Connections → reconnect; Mail → Sync"
              : failedProviderEffect
                ? "Mail → Sync"
                : "Settings → Agent access → Review Mail rules",
            userActionRequired: true,
          },
        );
      }
      updatedGoogleCredentials = currentCredentials;
    }
    try {
      await db.insert(auditEvents).values(
        auditValues({
          action: "mail.synced",
          after: {
            mailboxes: value.mailboxes.length,
            retainedPriorThreads: true,
            runSummaryPersisted,
            threads: value.threads.length,
          },
          before: null,
          entityId: account.id,
          entityType: "mail_account",
          principal,
          requestId,
        }),
      );
    } catch (error) {
      if (successfulRuleMutationCount === 0) throw error;
      throw new AppError(
        "service_unavailable",
        "Mail automation changed provider state, but Ilo could not record the final synchronization audit. Sync this account before retrying.",
        {
          accountId: account.id,
          operation: "rule_execution",
          partialEffect: true,
          repairAction: "sync_mail_account",
          runSummaryPersisted,
          succeededCount: successfulRuleMutationCount,
          synchronizationAuditPersisted: false,
          userAction: "Open Mail and choose Sync before retrying any automation.",
          userActionDestination: "Mail → Sync",
          userActionRequired: true,
        },
      );
    }
    return {
      changed: value.mailboxes.length + value.threads.length,
      credentials: updatedGoogleCredentials,
    };
  }

  return {
    async completeGoogleAuthorization(state: string, code: string) {
      const [oauthState] = await db
        .update(oauthStates)
        .set({ consumedAt: now() })
        .where(
          and(
            eq(oauthStates.tokenHash, hashToken(state)),
            eq(oauthStates.provider, "google"),
            isNull(oauthStates.consumedAt),
            gt(oauthStates.expiresAt, now()),
          ),
        )
        .returning();
      if (!oauthState) {
        throw new AppError(
          "invalid_request",
          "The Google authorization state is invalid or expired.",
        );
      }
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
      const account = await db.transaction(async (transaction) => {
        const requestedCalendar = requestedServices.includes("calendar");
        const requestedMail =
          requestedServices.includes("mail") && hasGoogleMailScope(googleCredentials);
        await transaction
          .insert(calendarAccounts)
          .values({
            calendarEnabled: requestedCalendar,
            avatarUrl: profileResult.value.pictureUrl,
            email: profileResult.value.email,
            encryptedCredentials: encryptJson(googleCredentials, encryptionKey),
            label: profileResult.value.name ?? profileResult.value.email,
            mailEnabled: requestedMail,
            provider: "google",
            providerAccountId: profileResult.value.id,
            userId: oauthState.userId,
          })
          .onConflictDoNothing({
            target: [
              calendarAccounts.userId,
              calendarAccounts.provider,
              calendarAccounts.providerAccountId,
            ],
          });
        const lockedMatchedAccount = requireDatabaseRecord(
          (
            await transaction
              .select()
              .from(calendarAccounts)
              .where(
                and(
                  eq(calendarAccounts.userId, oauthState.userId),
                  eq(calendarAccounts.provider, "google"),
                  eq(calendarAccounts.providerAccountId, profileResult.value.id),
                ),
              )
              .for("update")
              .limit(1)
          )[0],
          "The Google account could not be saved.",
        );
        if (target && lockedMatchedAccount.id !== target.id) {
          throw new AppError(
            "conflict",
            "The selected Google account changed while authorization was completing.",
          );
        }
        const calendarEnabled = lockedMatchedAccount.calendarEnabled || requestedCalendar;
        const mailEnabled = lockedMatchedAccount.mailEnabled || requestedMail;
        return requireDatabaseRecord(
          (
            await transaction
              .update(calendarAccounts)
              .set({
                avatarUrl: profileResult.value.pictureUrl,
                calendarEnabled,
                email: profileResult.value.email,
                encryptedCredentials: encryptJson(googleCredentials, encryptionKey),
                label: profileResult.value.name ?? profileResult.value.email,
                mailEnabled,
                syncError: null,
                syncStatus: "idle",
                updatedAt: now(),
              })
              .where(eq(calendarAccounts.id, lockedMatchedAccount.id))
              .returning()
          )[0],
          "The Google account could not be saved.",
        );
      });
      return {
        accountId: account.id,
        email: account.email,
        returnPath:
          oauthState.returnPath === "/setup" ||
          oauthState.returnPath === "/settings?section=connections"
            ? oauthState.returnPath
            : "/settings?section=connections",
        userId: oauthState.userId,
      };
    },

    async connectICloud(
      userId: string,
      input: ConnectICloudInput,
      requestId: string = randomUUID(),
    ) {
      const icloudCredentials: ICloudCredentials = {
        appSpecificPassword: input.appSpecificPassword,
        email: input.email,
      };
      const account = await db.transaction(async (transaction) => {
        await transaction
          .insert(calendarAccounts)
          .values({
            calendarEnabled: input.calendar,
            email: input.email,
            encryptedCredentials: encryptJson(icloudCredentials, encryptionKey),
            label: input.email,
            mailEnabled: input.mail,
            provider: "icloud",
            providerAccountId: input.email,
            syncStatus: "idle",
            userId,
          })
          .onConflictDoNothing({
            target: [
              calendarAccounts.userId,
              calendarAccounts.provider,
              calendarAccounts.providerAccountId,
            ],
          });
        const existing = requireDatabaseRecord(
          (
            await transaction
              .select()
              .from(calendarAccounts)
              .where(
                and(
                  eq(calendarAccounts.userId, userId),
                  eq(calendarAccounts.provider, "icloud"),
                  eq(calendarAccounts.providerAccountId, input.email),
                ),
              )
              .for("update")
              .limit(1)
          )[0],
          "The iCloud account could not be saved.",
        );
        if (existing.mailEnabled && !input.mail) {
          await invalidateMailAccountDependents(
            transaction,
            existing,
            "Mail access for a connected account was turned off.",
            "mail_capability_disabled",
            requestId,
          );
        }
        return requireDatabaseRecord(
          (
            await transaction
              .update(calendarAccounts)
              .set({
                calendarEnabled: input.calendar,
                encryptedCredentials: encryptJson(icloudCredentials, encryptionKey),
                mailEnabled: input.mail,
                syncError: null,
                syncStatus: "idle",
                updatedAt: now(),
              })
              .where(eq(calendarAccounts.id, existing.id))
              .returning()
          )[0],
          "The iCloud account could not be saved.",
        );
      });
      return { accountId: account.id, email: account.email, userId };
    },

    async disconnect(
      userId: string,
      accountId: string,
      requestId: string = randomUUID(),
    ): Promise<void> {
      await db.transaction(async (transaction) => {
        const [account] = await transaction
          .select()
          .from(calendarAccounts)
          .where(
            and(
              eq(calendarAccounts.id, accountId),
              eq(calendarAccounts.userId, userId),
              ne(calendarAccounts.provider, "local"),
            ),
          )
          .for("update")
          .limit(1);
        if (!account) throw new AppError("not_found", "The connected account was not found.");
        await invalidateMailAccountDependents(
          transaction,
          account,
          "The connected Mail account is no longer available.",
          "account_disconnected",
          requestId,
        );
        const [record] = await transaction
          .delete(calendarAccounts)
          .where(
            and(eq(calendarAccounts.id, account.id), eq(calendarAccounts.userId, account.userId)),
          )
          .returning({ id: calendarAccounts.id });
        if (!record) throw new AppError("not_found", "The connected account was not found.");
      });
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
    async syncStaleAccounts(intervalMs = 5 * 60_000): Promise<void> {
      const threshold = new Date(now().getTime() - intervalMs);
      const staleLeaseThreshold = new Date(
        now().getTime() - Math.max(intervalMs, CONNECTOR_SYNC_LEASE_MS),
      );
      const accounts = await db
        .select({ id: calendarAccounts.id, userId: calendarAccounts.userId })
        .from(calendarAccounts)
        .where(
          and(
            ne(calendarAccounts.provider, "local"),
            or(
              and(
                eq(calendarAccounts.syncStatus, "idle"),
                or(
                  isNull(calendarAccounts.lastSyncedAt),
                  and(
                    eq(calendarAccounts.mailEnabled, true),
                    lt(calendarAccounts.lastSyncedAt, threshold),
                  ),
                ),
              ),
              and(
                eq(calendarAccounts.syncStatus, "syncing"),
                lt(calendarAccounts.updatedAt, staleLeaseThreshold),
              ),
            ),
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
