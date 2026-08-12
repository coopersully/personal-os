import { randomUUID } from "node:crypto";
import type {
  GoogleConnector,
  GoogleCredentials,
  ICloudConnector,
  ICloudCredentials,
  MailSyncResult,
  NormalizedRemoteEvent,
  ProviderOperationOptions,
  RemoteMailThreadState,
  SyncResult,
} from "@personal-os/connectors";
import {
  ConnectorError,
  createICloudConnector,
  googleGrantedServices,
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
  mailRuleWorkItems,
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
  MAIL_RULE_EXECUTION_LIMIT_PER_RUN,
  mailProfilePreferencesSchema,
  mailRuleActionSchema,
  mailRuleActionsMatchRetentionPreferences,
  matchesMailRule,
  resolveStoredMailRule,
} from "@personal-os/domain";
import {
  and,
  asc,
  eq,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  ne,
  notExists,
  notInArray,
  or,
  sql,
} from "drizzle-orm";
import { auditValues } from "./audit.js";
import { invalidateCalendarProfileSources } from "./calendar-profile.js";
import { createConnectorAuthorizationService } from "./connector-authorization-service.js";
import { createConnectorNotificationService } from "./connector-notification-service.js";
import {
  type ConnectorSyncFailure,
  classifyConnectorSyncFailure,
  connectionHealthForAccount,
  connectorRetryAt,
  connectorSyncAppError,
} from "./connector-sync-health.js";
import { requireDatabaseRecord } from "./database.js";
import { AppError } from "./errors.js";
import {
  invalidateMailCalendarCommitmentIntakes,
  reconcileMailCalendarMailboxRevisionChange,
  reconcileMissingMailCalendarCommitmentMessages,
  recordMailCalendarCommitmentIntakes,
} from "./mail-calendar-intake.js";
import {
  applyMailRuleActionToState,
  classifyMailRuleProviderFailure,
  durableMailRuleActionFingerprint,
  enqueueDurableMailRuleWork,
  mailRuleActionIsApplied,
  strongestMailRuleProviderEffect,
} from "./mail-rule-work.js";
import { decryptJson, encryptJson } from "./security.js";
import {
  auditAttentionItemMetadata,
  auditDomainProfileMetadata,
  auditSnapshot,
  domainProfileChangedFields,
} from "./serialization.js";
import type { RequestLog } from "./types.js";

const CONNECTOR_SYNC_LEASE_MS = 30 * 60_000;
const CONNECTOR_SYNC_INTERRUPTED_ERROR =
  "Synchronization was interrupted. ilo will retry automatically.";
const MAIL_RULE_WORK_CONCURRENCY = 2;
const MAIL_RULE_WORK_CLAIM_LEASE_MS = 10 * 60_000;
const MAIL_RULE_WORK_MAX_ATTEMPTS = 5;

type CalendarRow = typeof calendars.$inferSelect;
type EventRow = typeof calendarEvents.$inferSelect;
type AccountRow = typeof calendarAccounts.$inferSelect & {
  encryptedCredentials: NonNullable<typeof calendarAccounts.$inferSelect.encryptedCredentials>;
};
type DatabaseTransaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type CalendarProviderMutationAction = "create" | "delete" | "update";
type MailRuleWorkRow = typeof mailRuleWorkItems.$inferSelect;
type SyncClaim = { generation: number; id: string };

function calendarProviderMutationError(
  error: unknown,
  action: CalendarProviderMutationAction,
  calendar: CalendarRow,
  remoteEventId: string | null,
): AppError {
  if (error instanceof AppError) return error;
  const definitiveStatus =
    error instanceof ConnectorError &&
    error.status !== null &&
    error.status < 500 &&
    error.status !== 408;
  if (definitiveStatus) {
    const code =
      error.status === 401 || error.status === 403
        ? "forbidden"
        : error.status === 404
          ? "not_found"
          : error.status === 409 || error.status === 412
            ? "conflict"
            : error.status === 429
              ? "rate_limited"
              : "invalid_request";
    return new AppError(code, `The Calendar provider rejected the event ${action}.`, {
      effectState: "rejected",
      provider: calendar.provider,
      providerStatus: error.status,
      recovery: "Review current provider state and synchronize Calendar before retrying.",
      ...(remoteEventId ? { remoteEventId } : {}),
    });
  }
  return new AppError(
    "service_unavailable",
    `The Calendar provider did not confirm whether the event ${action} completed.`,
    {
      effectState: "indeterminate",
      provider: calendar.provider,
      recovery:
        "Synchronize Calendar before retrying so Ilo can determine whether the provider mutation completed.",
      ...(remoteEventId ? { remoteEventId } : {}),
    },
  );
}

async function runCalendarProviderMutation<T>(
  action: CalendarProviderMutationAction,
  calendar: CalendarRow,
  remoteEventId: string | null,
  operation: () => Promise<T>,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    throw calendarProviderMutationError(error, action, calendar, remoteEventId);
  }
}

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

function requireCalendarCapability(account: AccountRow): void {
  if (!account.calendarEnabled) {
    throw new AppError(
      "forbidden",
      "Calendar access is disabled for this connected account. Reconnect Calendar before writing.",
    );
  }
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
  googleCalendarWebhookUrl?: string;
  googleGmailTopicName?: string;
  googleRedirectUri?: string;
  icloud?: ICloudConnector;
  icloudMailIdleConcurrency?: number;
  icloudMailIdleEnabled?: boolean;
  log?: (entry: RequestLog) => void;
  now: () => Date;
  observeRecoveryFailure?: (entry: {
    claimId: string;
    operation: "release_mail_rule_claim";
  }) => void;
  shutdown?: {
    deadlineMs: () => number | undefined;
    signal: AbortSignal;
  };
};

export function createConnectorService({
  db,
  encryptionKey,
  google,
  googleCalendarWebhookUrl,
  googleGmailTopicName,
  googleRedirectUri = "https://api.ilo.invalid/v1/connectors/google/callback",
  icloud = createICloudConnector(),
  icloudMailIdleConcurrency,
  icloudMailIdleEnabled,
  log,
  now,
  observeRecoveryFailure,
  shutdown,
}: ConnectorServiceOptions) {
  const authorization = createConnectorAuthorizationService({ db, encryptionKey, now });
  const notifications = createConnectorNotificationService({
    db,
    encryptionKey,
    google,
    icloud,
    ...(log ? { log } : {}),
    now,
    ...(googleCalendarWebhookUrl ? { calendarWebhookUrl: googleCalendarWebhookUrl } : {}),
    ...(googleGmailTopicName ? { gmailTopicName: googleGmailTopicName } : {}),
    ...(icloudMailIdleConcurrency ? { icloudMailIdleConcurrency } : {}),
    ...(icloudMailIdleEnabled ? { icloudMailIdleEnabled } : {}),
  });
  function syncOperation(): ProviderOperationOptions | undefined {
    if (!shutdown) return undefined;
    const deadlineMs = shutdown.deadlineMs();
    return {
      ...(deadlineMs === undefined ? {} : { deadlineMs }),
      signal: shutdown.signal,
    };
  }

  function throwIfQuiescing(): void {
    shutdown?.signal.throwIfAborted();
  }

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
    syncClaim?: SyncClaim,
  ): Promise<GoogleCredentials> {
    return db.transaction(async (transaction) => {
      const [account] = await transaction
        .select({
          encryptedCredentials: calendarAccounts.encryptedCredentials,
          id: calendarAccounts.id,
        })
        .from(calendarAccounts)
        .where(
          and(
            eq(calendarAccounts.id, accountId),
            ...(syncClaim
              ? [
                  eq(calendarAccounts.syncGeneration, syncClaim.generation),
                  eq(calendarAccounts.syncClaimId, syncClaim.id),
                ]
              : []),
          ),
        )
        .for("update")
        .limit(1);
      if (!account?.encryptedCredentials) {
        if (syncClaim) {
          throw new AppError(
            "conflict",
            "The connector synchronization claim was superseded before credentials were saved.",
          );
        }
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

  async function withConnectorSyncClaim<T>(
    account: AccountRow,
    syncClaim: SyncClaim,
    work: (transaction: DatabaseTransaction) => Promise<T>,
  ): Promise<T> {
    return db.transaction(async (transaction) => {
      await requireConnectorSyncClaim(transaction, account, syncClaim, "projection");
      return work(transaction);
    });
  }

  async function requireConnectorSyncClaim(
    transaction: DatabaseTransaction,
    account: Pick<AccountRow, "id" | "userId">,
    syncClaim: SyncClaim,
    operation: string,
  ): Promise<void> {
    const [currentClaim] = await transaction
      .select({ id: calendarAccounts.id })
      .from(calendarAccounts)
      .where(
        and(
          eq(calendarAccounts.id, account.id),
          eq(calendarAccounts.userId, account.userId),
          eq(calendarAccounts.syncGeneration, syncClaim.generation),
          eq(calendarAccounts.syncClaimId, syncClaim.id),
        ),
      )
      .for("update")
      .limit(1);
    if (!currentClaim) {
      throw new AppError(
        "conflict",
        `The connector synchronization claim was superseded before ${operation}.`,
      );
    }
  }

  const eventGateway: ConnectedEventGateway = {
    async create(calendar, input) {
      if (!calendar.remoteCalendarId) {
        throw new AppError("internal_error", "The connected calendar has no provider identifier.");
      }
      const remoteCalendarId = calendar.remoteCalendarId;
      const account = await getAccount(calendar.userId, calendar.accountId);
      requireCalendarCapability(account);
      if (calendar.provider === "google") {
        const result = await runCalendarProviderMutation("create", calendar, null, () =>
          google.createEvent(
            credentials<GoogleCredentials>(account),
            remoteCalendarId,
            providerEventInput(input) as CreateEventInput,
          ),
        );
        try {
          await saveGoogleCredentials(account.id, result.credentials);
        } catch {
          throw new AppError(
            "service_unavailable",
            "The provider event was created, but Ilo could not persist refreshed provider credentials.",
            {
              partialEffect: "provider_event_created",
              provider: "google",
              recovery:
                "Refresh or synchronize Calendar before retrying; reconnect the account if authorization fails.",
              remoteEventId: result.value.remoteEventId,
            },
          );
        }
        return result.value;
      }
      if (calendar.provider === "icloud") {
        return runCalendarProviderMutation("create", calendar, null, () =>
          icloud.createEvent(
            credentials<ICloudCredentials>(account),
            remoteCalendarId,
            providerEventInput(input) as CreateEventInput,
          ),
        );
      }
      throw new AppError("invalid_request", "Local calendars do not use a connector.");
    },

    async delete(calendar, event) {
      if (!calendar.remoteCalendarId || !event.remoteEventId) {
        throw new AppError("internal_error", "The connected event has no provider identifier.");
      }
      const remoteCalendarId = calendar.remoteCalendarId;
      const remoteEventId = event.remoteEventId;
      const account = await getAccount(calendar.userId, calendar.accountId);
      requireCalendarCapability(account);
      if (calendar.provider === "google") {
        const value = await runCalendarProviderMutation("delete", calendar, remoteEventId, () =>
          google.deleteEvent(
            credentials<GoogleCredentials>(account),
            remoteCalendarId,
            remoteEventId,
            event.remoteEtag,
          ),
        );
        try {
          await saveGoogleCredentials(account.id, value);
        } catch {
          throw new AppError(
            "service_unavailable",
            "The provider event was deleted, but Ilo could not persist refreshed provider credentials.",
            {
              partialEffect: "provider_event_deleted",
              provider: "google",
              recovery:
                "Synchronize Calendar before retrying; reconnect the account if authorization fails.",
              remoteEventId,
            },
          );
        }
        return;
      }
      if (calendar.provider === "icloud") {
        await runCalendarProviderMutation("delete", calendar, remoteEventId, () =>
          icloud.deleteEvent(
            credentials<ICloudCredentials>(account),
            remoteEventId,
            event.remoteEtag,
          ),
        );
        return;
      }
      throw new AppError("invalid_request", "Local calendars do not use a connector.");
    },

    async update(calendar, event, input) {
      if (!calendar.remoteCalendarId || !event.remoteEventId) {
        throw new AppError("internal_error", "The connected event has no provider identifier.");
      }
      const remoteCalendarId = calendar.remoteCalendarId;
      const remoteEventId = event.remoteEventId;
      const account = await getAccount(calendar.userId, calendar.accountId);
      requireCalendarCapability(account);
      if (calendar.provider === "google") {
        const result = await runCalendarProviderMutation("update", calendar, remoteEventId, () =>
          google.updateEvent(
            credentials<GoogleCredentials>(account),
            remoteCalendarId,
            remoteEventId,
            event.remoteEtag,
            providerEventInput(input) as UpdateEventInput,
          ),
        );
        try {
          await saveGoogleCredentials(account.id, result.credentials);
        } catch {
          throw new AppError(
            "service_unavailable",
            "The provider event was updated, but Ilo could not persist refreshed provider credentials.",
            {
              partialEffect: "provider_event_updated",
              provider: "google",
              recovery:
                "Synchronize Calendar before retrying; reconnect the account if authorization fails.",
              remoteEventId: result.value.remoteEventId,
            },
          );
        }
        return result.value;
      }
      if (calendar.provider === "icloud") {
        return runCalendarProviderMutation("update", calendar, remoteEventId, () =>
          icloud.updateEvent(
            credentials<ICloudCredentials>(account),
            remoteCalendarId,
            remoteEventId,
            event.remoteEtag,
            providerEventInput(input) as UpdateEventInput,
          ),
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
    throwIfQuiescing();
    const startedAt = Date.now();
    const staleBefore = new Date(now().getTime() - CONNECTOR_SYNC_LEASE_MS);
    const syncClaimId = randomUUID();
    const attemptedAt = now();
    const [claimedAccount] = await db
      .update(calendarAccounts)
      .set({
        syncClaimId,
        syncGeneration: sql`${calendarAccounts.syncGeneration} + 1`,
        lastSyncAttemptAt: attemptedAt,
        nextSyncAt: null,
        syncStatus: "syncing",
        updatedAt: attemptedAt,
      })
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
    const syncClaim: SyncClaim = {
      generation: claimedAccount.syncGeneration,
      id: syncClaimId,
    };
    const requestId = `sync:${syncClaimId}`;
    const principal = { actorId: claimedAccount.id, actorType: "connector", userId } as const;
    try {
      throwIfQuiescing();
      if (!claimedAccount.encryptedCredentials) {
        throw new ConnectorError({
          category: "configuration",
          code: "connector_credentials_missing",
          disposition: "operator",
          message: "Connected account credentials are unavailable.",
          status: 503,
        });
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
          const remoteCalendars = await google.listCalendars(googleCredentials, syncOperation());
          googleCredentials = remoteCalendars.credentials;
          throwIfQuiescing();
          await saveCalendars(
            account,
            remoteCalendars.value,
            "google",
            principal,
            requestId,
            syncClaim,
          );
        } else if (account.provider === "icloud" && icloudCredentials) {
          await saveCalendars(
            account,
            await icloud.listCalendars(icloudCredentials, syncOperation()),
            "icloud",
            principal,
            requestId,
            syncClaim,
          );
        }
        const accountCalendars = await db
          .select()
          .from(calendars)
          .where(and(eq(calendars.accountId, account.id), isNull(calendars.deletedAt)))
          .orderBy(asc(calendars.name));
        for (const calendar of accountCalendars) {
          throwIfQuiescing();
          if (!calendar.remoteCalendarId) continue;
          let result: SyncResult["value"];
          if (calendar.provider === "google" && googleCredentials) {
            const remote = await google.syncCalendar(
              googleCredentials,
              calendar.remoteCalendarId,
              calendar.syncToken,
              syncOperation(),
            );
            googleCredentials = remote.credentials;
            result = remote.value;
          } else if (calendar.provider === "icloud" && icloudCredentials) {
            result = await icloud.syncCalendar(
              icloudCredentials,
              calendar.remoteCalendarId,
              calendar.syncToken,
              syncOperation(),
            );
          } else {
            continue;
          }
          throwIfQuiescing();
          changed += await withConnectorSyncClaim(account, syncClaim, (transaction) =>
            projectCalendarChanges(transaction, userId, calendar, result, principal, requestId),
          );
        }
      }
      throwIfQuiescing();
      if (account.mailEnabled && !options.skipMail) {
        let mail: MailSyncResult["value"];
        if (account.provider === "google" && googleCredentials && google.syncMail) {
          const result = await google.syncMail(
            googleCredentials,
            account.mailSyncToken,
            syncOperation(),
          );
          googleCredentials = await saveGoogleCredentials(
            account.id,
            result.credentials,
            true,
            syncClaim,
          );
          mailCredentialsPersisted = true;
          mail = result.value;
        } else if (account.provider === "icloud" && icloudCredentials) {
          mail = await icloud.syncMail(icloudCredentials, account.mailSyncToken, syncOperation());
        } else {
          throw new ConnectorError({
            category: "configuration",
            code: "connector_mail_capability_unavailable",
            disposition: "operator",
            message: "Connected Mail capability is unavailable.",
            status: 503,
          });
        }
        throwIfQuiescing();
        const projected = await projectMail(
          account,
          mail,
          principal,
          requestId,
          googleCredentials,
          syncClaim,
        );
        changed += projected.changed;
        mailCredentialsPersisted = mailCredentialsPersisted || projected.credentials !== null;
        googleCredentials = projected.credentials ?? googleCredentials;
      }
      throwIfQuiescing();
      const completedAt = now();
      const [completedAccount] = await db
        .update(calendarAccounts)
        .set({
          ...(googleCredentials && !mailCredentialsPersisted
            ? { encryptedCredentials: encryptJson(googleCredentials, encryptionKey) }
            : {}),
          lastSyncedAt: completedAt,
          nextSyncAt: new Date(completedAt.getTime() + 5 * 60_000),
          syncClaimId: null,
          syncError: null,
          syncErrorCategory: null,
          syncErrorCode: null,
          syncFailureCount: 0,
          syncRecovery: null,
          syncStatus: "idle",
          updatedAt: completedAt,
        })
        .where(
          and(
            eq(calendarAccounts.id, account.id),
            eq(calendarAccounts.syncGeneration, syncClaim.generation),
            eq(calendarAccounts.syncClaimId, syncClaim.id),
          ),
        )
        .returning({ id: calendarAccounts.id });
      if (!completedAccount) {
        throw new AppError(
          "conflict",
          "The connector synchronization claim was superseded before completion.",
        );
      }
      log?.({
        accountId: claimedAccount.id,
        durationMs: Date.now() - startedAt,
        event: "connector_sync_completed",
        freshnessAgeMs: Math.max(
          0,
          completedAt.getTime() - (claimedAccount.lastSyncedAt?.getTime() ?? attemptedAt.getTime()),
        ),
        method: "CONNECTOR",
        path: "/internal/connectors/sync",
        provider: claimedAccount.provider === "icloud" ? "icloud" : "google",
        requestId,
        status: 200,
      });
      if (claimedAccount.syncFailureCount > 0) {
        log?.({
          accountId: claimedAccount.id,
          durationMs: Date.now() - startedAt,
          event: "connector_sync_recovered",
          failureCount: claimedAccount.syncFailureCount,
          method: "CONNECTOR",
          path: `/internal/connectors/${claimedAccount.id}/sync`,
          provider: claimedAccount.provider === "icloud" ? "icloud" : "google",
          requestId,
          status: 200,
        });
      }
      return { changed };
    } catch (error) {
      const interrupted = shutdown?.signal.aborted === true;
      const failureCount = claimedAccount.syncFailureCount + 1;
      const provider = claimedAccount.provider === "icloud" ? "icloud" : "google";
      const failure: ConnectorSyncFailure = interrupted
        ? {
            category: "temporary",
            code: "connector_sync_interrupted",
            message: CONNECTOR_SYNC_INTERRUPTED_ERROR,
            recovery: "automatic",
            retryAfterMs: null,
            status: null,
          }
        : classifyConnectorSyncFailure(error, provider);
      const failedAt = now();
      const nextSyncAt = interrupted
        ? failedAt
        : failure.recovery === "reconnect"
          ? null
          : connectorRetryAt({
              accountId: claimedAccount.id,
              failureCount,
              now: failedAt,
              retryAfterMs: failure.retryAfterMs,
            });
      try {
        const [settledAccount] = await db
          .update(calendarAccounts)
          .set({
            nextSyncAt,
            syncClaimId: null,
            syncError: failure.message,
            syncErrorCategory: failure.category,
            syncErrorCode: failure.code,
            syncFailureCount: failureCount,
            syncRecovery: failure.recovery,
            syncStatus: interrupted ? "idle" : "error",
            updatedAt: failedAt,
          })
          .where(
            and(
              eq(calendarAccounts.id, claimedAccount.id),
              eq(calendarAccounts.syncGeneration, syncClaim.generation),
              eq(calendarAccounts.syncClaimId, syncClaim.id),
            ),
          )
          .returning({ id: calendarAccounts.id });
        if (settledAccount) {
          log?.({
            accountId: claimedAccount.id,
            category: failure.category,
            code: failure.code,
            disposition: failure.recovery,
            durationMs: Date.now() - startedAt,
            event: "connector_sync_failed",
            failureCount,
            method: "CONNECTOR",
            nextSyncAt: nextSyncAt?.toISOString() ?? null,
            path: `/internal/connectors/${claimedAccount.id}/sync`,
            provider,
            requestId,
            status: failure.status ?? 503,
          });
        }
      } catch {
        if (interrupted) {
          throw new AppError(
            "service_unavailable",
            "The interrupted connector sync could not be made retryable.",
            {
              accountId: claimedAccount.id,
              recovery: "Do not close PostgreSQL; retry claim settlement or allow stale recovery.",
            },
          );
        }
        // Terminal status is best-effort and must not mask a structured
        // provider partial-effect/reconciliation contract.
      }
      if (interrupted) throw shutdown?.signal.reason ?? error;
      if (error instanceof AppError && error.code === "conflict") throw error;
      throw connectorSyncAppError(failure, claimedAccount.id, provider, nextSyncAt);
    }
  }

  async function projectCalendarChanges(
    transaction: DatabaseTransaction,
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
        const [before] = await transaction
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
          const [after] = await transaction
            .update(calendarEvents)
            .set({ deletedAt: now(), status: "cancelled", syncedAt: now(), updatedAt: now() })
            .where(eq(calendarEvents.id, before.id))
            .returning();
          if (after) {
            changed += 1;
            await auditCalendarChange(
              transaction,
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
      const [before] = await transaction
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
        ? await transaction
            .update(calendarEvents)
            .set(values)
            .where(eq(calendarEvents.id, before.id))
            .returning()
        : await transaction.insert(calendarEvents).values(values).returning();
      if (after) {
        changed += 1;
        await auditCalendarChange(
          transaction,
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
      const stale = await transaction
        .select()
        .from(calendarEvents)
        .where(and(...staleConditions));
      for (const before of stale) {
        const [after] = await transaction
          .update(calendarEvents)
          .set({ deletedAt: now(), syncedAt: now(), updatedAt: now() })
          .where(eq(calendarEvents.id, before.id))
          .returning();
        if (after) {
          changed += 1;
          await auditCalendarChange(
            transaction,
            "calendar_event.removed_by_full_sync",
            before,
            after,
            principal,
            requestId,
          );
        }
      }
    }
    await transaction
      .update(calendars)
      .set({ lastSyncedAt: now(), syncToken: result.nextSyncToken, updatedAt: now() })
      .where(eq(calendars.id, calendar.id));
    return changed;
  }

  async function auditCalendarChange(
    transaction: DatabaseTransaction,
    action: string,
    before: EventRow | null,
    after: EventRow,
    principal: { actorId: string; actorType: "connector"; userId: string },
    requestId: string,
  ): Promise<void> {
    await transaction.insert(auditEvents).values(
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
        .set({ ...attentionValues, version: sql`${attentionItems.version} + 1` })
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
    const [unresolvedProviderEffect] = await transaction
      .select({
        id: mailRuleWorkItems.id,
        providerEffect: mailRuleWorkItems.providerEffect,
        status: mailRuleWorkItems.status,
      })
      .from(mailRuleWorkItems)
      .where(
        and(
          eq(mailRuleWorkItems.accountId, account.id),
          or(
            eq(mailRuleWorkItems.status, "claimed"),
            and(
              inArray(mailRuleWorkItems.status, ["reconcile", "failed"]),
              inArray(mailRuleWorkItems.providerEffect, ["applied", "indeterminate"]),
            ),
          ),
        ),
      )
      .for("update")
      .limit(1);
    if (unresolvedProviderEffect) {
      const message =
        unresolvedProviderEffect.status === "claimed"
          ? "Mail automation is reconciling a provider effect. Retry this connection change after it settles."
          : account.provider === "google"
            ? "Mail automation retains unresolved provider-effect evidence. Reauthorize this Google Mail account to restart exact reconciliation before changing the connection."
            : "Legacy unresolved Mail provider-effect evidence requires support review before this connection can be changed.";
      throw new AppError("conflict", message);
    }
    const principal = {
      actorId: account.userId,
      actorType: "user" as const,
      userId: account.userId,
    };
    await invalidateMailCalendarCommitmentIntakes(transaction, {
      accountId: account.id,
      invalidatedAt: now(),
      principal,
      reasonCode,
      requestId,
    });
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
          version: item.version + 1,
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

  async function disableCalendarAccount(
    transaction: DatabaseTransaction,
    account: typeof calendarAccounts.$inferSelect,
    requestId: string,
  ): Promise<void> {
    const accountCalendars = await transaction
      .select()
      .from(calendars)
      .where(
        and(
          eq(calendars.accountId, account.id),
          eq(calendars.userId, account.userId),
          isNull(calendars.deletedAt),
        ),
      )
      .orderBy(asc(calendars.id))
      .for("update");
    if (accountCalendars.length === 0) return;
    const disabledAt = now();
    const calendarIds = accountCalendars.map((calendar) => calendar.id);
    await transaction
      .update(calendars)
      .set({ deletedAt: disabledAt, updatedAt: disabledAt })
      .where(inArray(calendars.id, calendarIds));
    await transaction
      .update(calendarEvents)
      .set({ deletedAt: disabledAt, updatedAt: disabledAt })
      .where(
        and(inArray(calendarEvents.calendarId, calendarIds), isNull(calendarEvents.deletedAt)),
      );
    await invalidateCalendarProfileSources(transaction, {
      context: {
        principal: {
          actorId: account.userId,
          actorType: "user",
          userId: account.userId,
        },
        requestId,
      },
      now: disabledAt,
      unavailableCalendarIds: calendarIds,
      userId: account.userId,
    });
    for (const calendar of accountCalendars) {
      await transaction.insert(auditEvents).values(
        auditValues({
          action: "calendar.source_disabled",
          after: { calendarId: calendar.id, disabled: true },
          before: { calendarId: calendar.id, disabled: false },
          entityId: calendar.id,
          entityType: "calendar",
          principal: {
            actorId: account.userId,
            actorType: "user",
            userId: account.userId,
          },
          requestId,
        }),
      );
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
        preferences?.success &&
        !mailRuleActionsMatchRetentionPreferences(resolved.actions, preferences.data)
      ) {
        invalidReason =
          "The linked Mail profile no longer authorizes this rule's delayed retention.";
      }
      if (invalidReason) {
        await pauseInvalidMailRule(rule, invalidReason, principal, requestId);
        continue;
      }
      const executableProfile = profile as NonNullable<typeof profile>;
      executable.push({
        profileVersion: executableProfile.version,
        resolved,
        rule,
      });
    }
    return executable;
  }

  async function projectMail(
    account: AccountRow,
    value: MailSyncResult["value"],
    principal: { actorId: string; actorType: "connector"; userId: string },
    requestId: string,
    initialGoogleCredentials: GoogleCredentials | null,
    syncClaim: SyncClaim,
  ): Promise<{ changed: number; credentials: GoogleCredentials | null }> {
    const provider = account.provider === "icloud" ? "icloud" : "google";
    const mailboxIds = value.mailboxes.map((mailbox) => mailbox.id);
    const sourceProjectionApplied = await db.transaction(async (transaction) => {
      const activeAccount = (
        await transaction
          .select({ id: calendarAccounts.id })
          .from(calendarAccounts)
          .where(
            and(
              eq(calendarAccounts.id, account.id),
              eq(calendarAccounts.userId, account.userId),
              eq(calendarAccounts.mailEnabled, true),
              eq(calendarAccounts.syncGeneration, syncClaim.generation),
              eq(calendarAccounts.syncClaimId, syncClaim.id),
            ),
          )
          .for("update")
          .limit(1)
      )[0];
      if (!activeAccount) return false;
      for (const mailbox of value.mailboxes) {
        const [existingMailbox] = await transaction
          .select({ providerRevision: mailboxes.providerRevision })
          .from(mailboxes)
          .where(
            and(eq(mailboxes.accountId, account.id), eq(mailboxes.remoteMailboxId, mailbox.id)),
          )
          .for("update")
          .limit(1);
        if (
          provider === "icloud" &&
          existingMailbox?.providerRevision &&
          mailbox.providerRevision &&
          existingMailbox.providerRevision !== mailbox.providerRevision
        ) {
          await reconcileMailCalendarMailboxRevisionChange(transaction, {
            accountId: account.id,
            mailboxId: mailbox.id,
            principal,
            reconciledAt: now(),
            requestId,
          });
          await transaction
            .update(mailThreads)
            .set({ deletedAt: now(), updatedAt: now() })
            .where(
              and(
                eq(mailThreads.accountId, account.id),
                isNull(mailThreads.deletedAt),
                sql<boolean>`${mailThreads.remoteMailboxIds} @> ${JSON.stringify([mailbox.id])}::jsonb`,
              ),
            );
        }
        await transaction
          .insert(mailboxes)
          .values({
            accountId: account.id,
            deletedAt: null,
            lastSyncedAt: now(),
            name: mailbox.name,
            provider,
            providerRevision: mailbox.providerRevision ?? null,
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
              providerRevision: mailbox.providerRevision ?? null,
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
      await transaction
        .update(mailboxes)
        .set({ deletedAt: now(), updatedAt: now() })
        .where(and(...staleMailboxConditions));

      if (value.deletedThreadIds.length > 0) {
        await transaction
          .update(mailThreads)
          .set({ deletedAt: now(), updatedAt: now() })
          .where(
            and(
              eq(mailThreads.accountId, account.id),
              inArray(mailThreads.remoteThreadId, value.deletedThreadIds),
              isNull(mailThreads.deletedAt),
            ),
          );
      }

      for (const thread of value.threads) {
        const [storedThread] = await transaction
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
          .returning();
        if (!storedThread)
          throw new AppError("internal_error", "The mail conversation could not be saved.");
        const projectedMessages = thread.messages ?? [];
        for (const message of projectedMessages) {
          const [storedMessage] = await transaction
            .insert(mailMessages)
            .values({
              attachments: message.attachments,
              bodyText: message.bodyText,
              cc: message.cc,
              from: message.from,
              providerMailboxIds: message.mailboxIds ?? [],
              providerRevision: message.providerRevision ?? null,
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
                providerMailboxIds: message.mailboxIds ?? [],
                providerRevision: message.providerRevision ?? null,
                receivedAt: message.receivedAt,
                to: message.to,
                updatedAt: now(),
              },
              target: [mailMessages.threadId, mailMessages.remoteMessageId],
            })
            .returning();
          if (!storedMessage)
            throw new AppError("internal_error", "The mail message could not be saved.");
          await recordMailCalendarCommitmentIntakes(transaction, {
            accountId: account.id,
            message: storedMessage,
            principal,
            privacyKey: encryptionKey,
            providerAccountAddressHint: account.email,
            recordedAt: now(),
            requestId,
            thread: storedThread,
          });
        }
        if (thread.messagesComplete === true) {
          await reconcileMissingMailCalendarCommitmentMessages(transaction, {
            accountId: account.id,
            observedRemoteMessageIds: new Set(
              projectedMessages.map((message) => message.remoteMessageId),
            ),
            principal,
            reconciledAt: now(),
            requestId,
            thread: storedThread,
          });
        }
      }
      await transaction
        .update(calendarAccounts)
        .set({ mailSyncToken: value.nextSyncToken, updatedAt: now() })
        .where(
          and(
            eq(calendarAccounts.id, account.id),
            eq(calendarAccounts.userId, account.userId),
            eq(calendarAccounts.syncGeneration, syncClaim.generation),
            eq(calendarAccounts.syncClaimId, syncClaim.id),
          ),
        );
      return true;
    });
    if (!sourceProjectionApplied) {
      throw new AppError(
        "conflict",
        "The connector synchronization claim was superseded before Mail projection.",
      );
    }
    const rules = await executableMailRules(account, principal, requestId);
    await db.transaction(async (transaction) => {
      await requireConnectorSyncClaim(transaction, account, syncClaim, "durable Mail rule handoff");
      for (const { profileVersion, resolved, rule } of rules) {
        const matchingRemoteThreadIds = value.threads
          .filter((thread) =>
            matchesMailRule(resolved.condition, {
              from: thread.from,
              snippet: thread.snippet,
              subject: thread.subject,
            }),
          )
          .map((thread) => thread.remoteThreadId);
        if (matchingRemoteThreadIds.length === 0) continue;
        const matchingThreads = await transaction
          .select()
          .from(mailThreads)
          .where(
            and(
              eq(mailThreads.userId, account.userId),
              eq(mailThreads.accountId, account.id),
              isNull(mailThreads.deletedAt),
              inArray(mailThreads.remoteThreadId, matchingRemoteThreadIds),
            ),
          )
          .orderBy(asc(mailThreads.id))
          .for("share");
        if (!rule.profileId) continue;
        await enqueueDurableMailRuleWork(transaction, {
          actions: resolved.actions,
          profileId: rule.profileId,
          profileVersion,
          ruleId: rule.id,
          ruleVersion: rule.version,
          threads: matchingThreads,
          userId: account.userId,
        });
      }
      await transaction.insert(auditEvents).values(
        auditValues({
          action: "mail.synced",
          after: {
            durableRuleHandoffCompleted: true,
            mailboxes: value.mailboxes.length,
            retainedPriorThreads: true,
            threads: value.threads.length,
          },
          before: null,
          entityId: account.id,
          entityType: "mail_account",
          principal,
          requestId,
        }),
      );
    });
    return {
      changed: value.mailboxes.length + value.threads.length,
      credentials: initialGoogleCredentials,
    };
  }

  function retryAt(attemptCount: number): Date {
    const delaysMinutes = [1, 5, 15, 60, 360] as const;
    const delay = delaysMinutes[
      Math.min(Math.max(attemptCount - 1, 0), delaysMinutes.length - 1)
    ] as number;
    return new Date(now().getTime() + delay * 60_000);
  }

  async function releaseMailRuleClaimForQuiesce(claimId: string): Promise<void> {
    if (!shutdown?.signal.aborted) return;
    try {
      await db
        .update(mailRuleWorkItems)
        .set({
          attemptCount: sql`greatest(${mailRuleWorkItems.attemptCount} - 1, 0)`,
          claimId: null,
          claimedAt: null,
          claimMode: null,
          status: sql`
            CASE
              WHEN ${mailRuleWorkItems.claimMode} = 'reconcile' THEN 'reconcile'
              ELSE 'pending'
            END
          `,
          updatedAt: now(),
        })
        .where(
          and(eq(mailRuleWorkItems.claimId, claimId), eq(mailRuleWorkItems.status, "claimed")),
        );
    } catch {
      observeRecoveryFailure?.({ claimId, operation: "release_mail_rule_claim" });
      throw new AppError(
        "service_unavailable",
        "Mail work claimed during shutdown could not be released for a safe retry.",
        {
          claimId,
          operation: "release_mail_rule_claim",
          retryable: true,
        },
      );
    }
    shutdown.signal.throwIfAborted();
  }

  async function claimDueMailRuleWork(): Promise<{
    claimed: MailRuleWorkRow[];
    maintenanceFailed: number;
    touchedAccountIds: string[];
  }> {
    throwIfQuiescing();
    const claimId = randomUUID();
    const current = now();
    const staleBefore = new Date(current.getTime() - MAIL_RULE_WORK_CLAIM_LEASE_MS);
    const touchedAccountIds = new Set<string>();
    let maintenanceFailed = 0;
    await db.transaction(async (transaction) => {
      const exhaustedStaleClaims = await transaction
        .update(mailRuleWorkItems)
        .set({
          claimId: null,
          claimedAt: null,
          claimMode: null,
          completedAt: current,
          lastErrorCode: "stale_claim_exhausted",
          lastErrorMessage:
            "A prior worker stopped before confirming the provider effect, and the bounded retry budget is exhausted.",
          nextAttemptAt: current,
          providerEffect: sql`
            CASE
              WHEN ${mailRuleWorkItems.providerEffect} = 'applied' THEN 'applied'
              ELSE 'indeterminate'
            END
          `,
          status: "failed",
          updatedAt: current,
        })
        .where(
          and(
            eq(mailRuleWorkItems.status, "claimed"),
            lt(mailRuleWorkItems.claimedAt, staleBefore),
            sql`${mailRuleWorkItems.attemptCount} >= ${MAIL_RULE_WORK_MAX_ATTEMPTS}`,
          ),
        )
        .returning({ accountId: mailRuleWorkItems.accountId });
      maintenanceFailed += exhaustedStaleClaims.length;
      for (const item of exhaustedStaleClaims) touchedAccountIds.add(item.accountId);
      const staleClaims = await transaction
        .update(mailRuleWorkItems)
        .set({
          claimId: null,
          claimedAt: null,
          claimMode: null,
          lastErrorCode: "stale_claim",
          lastErrorMessage:
            "A prior worker stopped before confirming the provider effect; exact provider reconciliation is required.",
          nextAttemptAt: current,
          providerEffect: sql`
            CASE
              WHEN ${mailRuleWorkItems.providerEffect} = 'applied' THEN 'applied'
              ELSE 'indeterminate'
            END
          `,
          status: "reconcile",
          updatedAt: current,
        })
        .where(
          and(
            eq(mailRuleWorkItems.status, "claimed"),
            lt(mailRuleWorkItems.claimedAt, staleBefore),
            lt(mailRuleWorkItems.attemptCount, MAIL_RULE_WORK_MAX_ATTEMPTS),
          ),
        )
        .returning({ accountId: mailRuleWorkItems.accountId });
      for (const item of staleClaims) touchedAccountIds.add(item.accountId);
      const missingSources = await transaction
        .update(mailRuleWorkItems)
        .set({
          claimId: null,
          claimedAt: null,
          claimMode: null,
          completedAt: current,
          lastErrorCode: "source_missing",
          lastErrorMessage: "The projected Mail conversation is no longer available.",
          status: "failed",
          updatedAt: current,
        })
        .where(
          and(
            inArray(mailRuleWorkItems.status, ["pending", "reconcile"]),
            isNull(mailRuleWorkItems.threadId),
          ),
        )
        .returning({ accountId: mailRuleWorkItems.accountId });
      maintenanceFailed += missingSources.length;
      for (const item of missingSources) touchedAccountIds.add(item.accountId);
      await transaction.execute(sql`
        WITH due_rule_groups AS MATERIALIZED (
          SELECT
            work.thread_id,
            work.rule_id,
            work.rule_version,
            work.profile_version,
            min(work.due_at) AS next_due
          FROM mail_rule_work_items work
          WHERE work.thread_id IS NOT NULL
            AND work.status IN ('pending', 'reconcile')
            AND work.due_at <= ${current}
            AND work.next_attempt_at <= ${current}
            AND work.attempt_count < ${MAIL_RULE_WORK_MAX_ATTEMPTS}
          GROUP BY work.thread_id, work.rule_id, work.rule_version, work.profile_version
        ),
        next_thread_rule AS MATERIALIZED (
          SELECT DISTINCT ON (due.thread_id)
            due.thread_id,
            due.rule_id,
            due.rule_version,
            due.profile_version,
            due.next_due
          FROM due_rule_groups due
          ORDER BY due.thread_id, due.next_due, due.rule_id
        ),
        candidate_threads AS (
          SELECT
            threads.id,
            due.rule_id,
            due.rule_version,
            due.profile_version
          FROM next_thread_rule due
          INNER JOIN mail_threads threads ON threads.id = due.thread_id
          INNER JOIN calendar_accounts accounts ON accounts.id = threads.account_id
          WHERE NOT EXISTS (
            SELECT 1
            FROM mail_rule_work_items active
            WHERE active.thread_id = threads.id
              AND active.status = 'claimed'
          )
          ORDER BY due.next_due, threads.id
          FOR UPDATE OF threads, accounts SKIP LOCKED
          LIMIT ${MAIL_RULE_EXECUTION_LIMIT_PER_RUN}
        )
        UPDATE mail_rule_work_items work
        SET
          attempt_count = work.attempt_count + 1,
          claim_id = ${claimId},
          claimed_at = ${current},
          claim_mode = CASE
            WHEN work.status = 'reconcile' THEN 'reconcile'
            ELSE 'execute'
          END,
          status = 'claimed',
          updated_at = ${current}
        FROM candidate_threads
        WHERE work.thread_id = candidate_threads.id
          AND work.rule_id = candidate_threads.rule_id
          AND work.rule_version = candidate_threads.rule_version
          AND work.profile_version = candidate_threads.profile_version
          AND work.status IN ('pending', 'reconcile')
          AND work.due_at <= ${current}
          AND work.next_attempt_at <= ${current}
          AND work.attempt_count < ${MAIL_RULE_WORK_MAX_ATTEMPTS}
      `);
    });
    await releaseMailRuleClaimForQuiesce(claimId);
    const claimed = await db
      .select()
      .from(mailRuleWorkItems)
      .where(and(eq(mailRuleWorkItems.claimId, claimId), eq(mailRuleWorkItems.status, "claimed")))
      .orderBy(asc(mailRuleWorkItems.accountId), asc(mailRuleWorkItems.remoteThreadId));
    await releaseMailRuleClaimForQuiesce(claimId);
    for (const item of claimed) touchedAccountIds.add(item.accountId);
    const outstandingAccounts = await db
      .select({
        accountId: mailRuleWorkItems.accountId,
        oldestUpdatedAt: sql<Date>`min(${mailRuleWorkItems.updatedAt})`,
      })
      .from(mailRuleWorkItems)
      .where(
        and(
          inArray(mailRuleWorkItems.status, ["pending", "claimed", "reconcile", "failed"]),
          notExists(
            db
              .select({ id: attentionItems.id })
              .from(attentionItems)
              .where(
                and(
                  eq(attentionItems.domain, "mail"),
                  eq(attentionItems.kind, "run_summary"),
                  eq(attentionItems.status, "open"),
                  eq(attentionItems.relatedEntityType, "mail_account"),
                  eq(attentionItems.relatedEntityId, mailRuleWorkItems.accountId),
                ),
              ),
          ),
        ),
      )
      .groupBy(mailRuleWorkItems.accountId)
      .orderBy(asc(sql`min(${mailRuleWorkItems.updatedAt})`), asc(mailRuleWorkItems.accountId))
      .limit(MAIL_RULE_EXECUTION_LIMIT_PER_RUN);
    for (const item of outstandingAccounts) touchedAccountIds.add(item.accountId);
    const openSummaryAccounts = await db
      .select({
        accountId: attentionItems.relatedEntityId,
        oldestUpdatedAt: sql<Date>`min(${attentionItems.updatedAt})`,
      })
      .from(attentionItems)
      .where(
        and(
          eq(attentionItems.domain, "mail"),
          eq(attentionItems.kind, "run_summary"),
          eq(attentionItems.status, "open"),
          eq(attentionItems.relatedEntityType, "mail_account"),
          isNotNull(attentionItems.relatedEntityId),
        ),
      )
      .groupBy(attentionItems.relatedEntityId)
      .orderBy(asc(sql`min(${attentionItems.updatedAt})`), asc(attentionItems.relatedEntityId))
      .limit(MAIL_RULE_EXECUTION_LIMIT_PER_RUN);
    for (const item of openSummaryAccounts) {
      if (item.accountId) touchedAccountIds.add(item.accountId);
    }
    return { claimed, maintenanceFailed, touchedAccountIds: [...touchedAccountIds] };
  }

  async function transitionMailRuleWork(
    work: MailRuleWorkRow[],
    input: {
      code: string | null;
      effect: MailRuleWorkRow["providerEffect"];
      message: string | null;
      status: "failed" | "pending" | "reconcile" | "succeeded";
    },
  ): Promise<void> {
    if (work.length === 0) return;
    const workIds = work.map((item) => item.id);
    const claimIds = [...new Set(work.map((item) => item.claimId).filter(Boolean))] as string[];
    const exhausted =
      (input.status === "pending" || input.status === "reconcile") &&
      work.some((item) => item.attemptCount >= MAIL_RULE_WORK_MAX_ATTEMPTS);
    const effectiveStatus = exhausted ? "failed" : input.status;
    const terminal = effectiveStatus === "failed" || effectiveStatus === "succeeded";
    await db.transaction(async (transaction) => {
      const transitioned = await transaction
        .update(mailRuleWorkItems)
        .set({
          claimId: null,
          claimedAt: null,
          claimMode: null,
          completedAt: terminal ? now() : null,
          lastErrorCode: input.code,
          lastErrorMessage: input.message,
          nextAttemptAt:
            effectiveStatus === "pending" || effectiveStatus === "reconcile"
              ? retryAt(Math.max(...work.map((item) => item.attemptCount)))
              : now(),
          providerEffect: input.effect,
          status: effectiveStatus,
          updatedAt: now(),
        })
        .where(
          and(
            inArray(mailRuleWorkItems.id, workIds),
            inArray(mailRuleWorkItems.claimId, claimIds),
            eq(mailRuleWorkItems.status, "claimed"),
          ),
        )
        .returning({ id: mailRuleWorkItems.id });
      if (transitioned.length === 0) return;
      const first = work[0];
      if (!first) return;
      await transaction.insert(auditEvents).values(
        auditValues({
          action: "mail.rule.durable_state_changed",
          after: {
            affectedCount: transitioned.length,
            errorCode: input.code,
            providerEffect: input.effect,
            status: effectiveStatus,
          },
          before: { status: "claimed" },
          entityId: first.accountId,
          entityType: "mail_account",
          principal: {
            actorId: first.accountId,
            actorType: "connector",
            userId: first.userId,
          },
          requestId: `scheduler:mail-rule:${claimIds[0] as string}`,
        }),
      );
    });
  }

  async function resolveClaimedMailRuleAction(
    work: MailRuleWorkRow,
    executor: Database | DatabaseTransaction = db,
    includeDeletedDestination = false,
  ): Promise<
    { action: MailRuleAction; remoteMailboxId: string | null } | { code: string; message: string }
  > {
    const parsedAction = mailRuleActionSchema.safeParse(work.action);
    if (
      !parsedAction.success ||
      durableMailRuleActionFingerprint(parsedAction.data) !== work.actionFingerprint
    ) {
      return {
        code: "invalid_action",
        message: "The durable Mail action no longer matches its accepted snapshot.",
      };
    }
    let remoteMailboxId: string | null = null;
    if (parsedAction.data.type === "add_label") {
      if (!parsedAction.data.mailboxId) {
        return {
          code: "destination_changed",
          message: "The accepted destination label is no longer available.",
        };
      }
      const destinationConditions = [
        eq(mailboxes.id, parsedAction.data.mailboxId),
        eq(mailboxes.userId, work.userId),
        eq(mailboxes.accountId, work.accountId),
        eq(mailboxes.role, "custom"),
      ];
      if (!includeDeletedDestination) destinationConditions.push(isNull(mailboxes.deletedAt));
      const [mailbox] = await executor
        .select({ remoteMailboxId: mailboxes.remoteMailboxId })
        .from(mailboxes)
        .where(and(...destinationConditions))
        .limit(1);
      if (!mailbox) {
        return {
          code: "destination_changed",
          message: "The accepted destination label is no longer available.",
        };
      }
      remoteMailboxId = mailbox.remoteMailboxId;
    }
    return { action: parsedAction.data, remoteMailboxId };
  }

  async function validateClaimedMailRuleWork(
    work: MailRuleWorkRow,
    thread: typeof mailThreads.$inferSelect,
    executor: Database | DatabaseTransaction = db,
  ): Promise<
    { action: MailRuleAction; remoteMailboxId: string | null } | { code: string; message: string }
  > {
    const resolvedAction = await resolveClaimedMailRuleAction(work, executor);
    if ("code" in resolvedAction) return resolvedAction;
    const [rule] = await executor
      .select()
      .from(mailRules)
      .where(
        and(
          eq(mailRules.id, work.ruleId),
          eq(mailRules.userId, work.userId),
          eq(mailRules.enabled, true),
          eq(mailRules.version, work.ruleVersion),
        ),
      )
      .limit(1);
    if (rule?.policy !== "approved_rule" || rule.profileId !== work.profileId) {
      return {
        code: "authorization_changed",
        message: "The accepted Mail rule is no longer active at the recorded revision.",
      };
    }
    if (
      !rule.sourceAccountIds.includes(work.accountId) ||
      new Set(rule.sourceAccountIds).size !== rule.sourceAccountIds.length
    ) {
      return {
        code: "source_changed",
        message: "The accepted Mail rule no longer includes this source account.",
      };
    }
    const resolved = resolveStoredMailRule({
      action: rule.legacyAction,
      actions: rule.actions,
      condition: rule.condition,
      enabled: rule.enabled,
      policy: rule.policy,
      query: rule.legacyQuery,
    });
    if (
      !resolved.actions.some(
        (action) => durableMailRuleActionFingerprint(action) === work.actionFingerprint,
      )
    ) {
      return {
        code: "action_changed",
        message: "The accepted action is no longer present in the current Mail rule.",
      };
    }
    if (resolved.actions.some((action) => action.type === "trash") && resolved.actions.length > 1) {
      return {
        code: "ambiguous_trash_rule",
        message: "Recoverable Trash must remain the rule's only provider action.",
      };
    }
    if (!work.profileId) {
      return {
        code: "profile_changed",
        message: "The active Mail profile or its retention preferences changed.",
      };
    }
    const [profile] = await executor
      .select()
      .from(domainProfiles)
      .where(
        and(
          eq(domainProfiles.id, work.profileId),
          eq(domainProfiles.userId, work.userId),
          eq(domainProfiles.domain, "mail"),
          eq(domainProfiles.status, "active"),
          eq(domainProfiles.version, work.profileVersion),
        ),
      )
      .limit(1);
    const preferences = mailProfilePreferencesSchema.safeParse(profile?.preferences ?? {});
    if (
      !profile?.sourceContexts.some((source) => source.sourceId === work.accountId) ||
      !preferences.success ||
      !mailRuleActionsMatchRetentionPreferences(resolved.actions, preferences.data)
    ) {
      return {
        code: "profile_changed",
        message: "The active Mail profile or its retention preferences changed.",
      };
    }
    if (
      thread.id !== work.threadId ||
      thread.accountId !== work.accountId ||
      thread.userId !== work.userId ||
      thread.remoteThreadId !== work.remoteThreadId ||
      thread.deletedAt !== null ||
      !matchesMailRule(resolved.condition, {
        from: thread.from,
        snippet: thread.snippet,
        subject: thread.subject,
      })
    ) {
      return {
        code: "source_changed",
        message: "The Mail conversation no longer matches the accepted rule and source identity.",
      };
    }
    return resolvedAction;
  }

  async function persistMailRuleWorkProjection(
    results: Array<{
      action: MailRuleAction;
      observedApplied: boolean;
      providerMutated: boolean;
      remoteMailboxId: string | null;
      work: MailRuleWorkRow;
    }>,
    thread: typeof mailThreads.$inferSelect,
    state: RemoteMailThreadState,
    principal: { actorId: string; actorType: "connector"; userId: string },
  ): Promise<void> {
    await db.transaction(async (transaction) => {
      const [lockedThread] = await transaction
        .select()
        .from(mailThreads)
        .where(eq(mailThreads.id, thread.id))
        .for("update")
        .limit(1);
      if (!lockedThread) {
        throw new AppError("not_found", "The projected Mail conversation was removed.");
      }
      const successful: MailRuleWorkRow[] = [];
      const changedAuthorization: MailRuleWorkRow[] = [];
      const effects = new Map<string, MailRuleWorkRow["providerEffect"]>();
      for (const result of results) {
        const authorization = await validateClaimedMailRuleWork(
          result.work,
          lockedThread,
          transaction,
        );
        const provedApplied = result.observedApplied || result.providerMutated;
        effects.set(
          result.work.id,
          strongestMailRuleProviderEffect(
            [result.work.providerEffect, provedApplied ? "applied" : "none"],
            "none",
          ),
        );
        if ("code" in authorization && !result.observedApplied) {
          changedAuthorization.push(result.work);
        } else {
          successful.push(result.work);
        }
      }
      const completedAt = now();
      for (const item of successful) {
        await transaction
          .update(mailRuleWorkItems)
          .set({
            claimId: null,
            claimedAt: null,
            claimMode: null,
            completedAt,
            lastErrorCode: null,
            lastErrorMessage: null,
            nextAttemptAt: completedAt,
            providerEffect: effects.get(item.id) ?? item.providerEffect,
            status: "succeeded",
            updatedAt: completedAt,
          })
          .where(
            and(
              eq(mailRuleWorkItems.id, item.id),
              eq(mailRuleWorkItems.claimId, item.claimId as string),
              eq(mailRuleWorkItems.status, "claimed"),
            ),
          );
      }
      for (const item of changedAuthorization) {
        const effect = effects.get(item.id) ?? item.providerEffect;
        const providerMayHaveChanged = effect === "applied" || effect === "indeterminate";
        await transaction
          .update(mailRuleWorkItems)
          .set({
            claimId: null,
            claimedAt: null,
            claimMode: null,
            completedAt: providerMayHaveChanged ? null : completedAt,
            lastErrorCode: "authorization_changed",
            lastErrorMessage:
              "The rule authorization changed during execution; review current provider state before retrying.",
            nextAttemptAt: completedAt,
            providerEffect: effect,
            status: providerMayHaveChanged ? "reconcile" : "failed",
            updatedAt: completedAt,
          })
          .where(
            and(
              eq(mailRuleWorkItems.id, item.id),
              eq(mailRuleWorkItems.claimId, item.claimId as string),
              eq(mailRuleWorkItems.status, "claimed"),
            ),
          );
      }
      await transaction
        .update(mailThreads)
        .set({
          remoteMailboxIds: state.mailboxIds,
          starred: state.starred,
          unread: state.unread,
          updatedAt: completedAt,
        })
        .where(eq(mailThreads.id, lockedThread.id));
      if (successful.length > 0) {
        await transaction.insert(auditEvents).values(
          auditValues({
            action: "mail.rule.durable_applied",
            after: {
              actionCount: successful.length,
              delayedActionCount: successful.filter((item) => item.action.afterDays > 0).length,
              durable: true,
              providerMutation: results.some(
                (result) =>
                  successful.some((item) => item.id === result.work.id) && result.providerMutated,
              ),
              providerObservation: results.some(
                (result) =>
                  successful.some((item) => item.id === result.work.id) && result.observedApplied,
              ),
              ruleCount: new Set(successful.map((item) => item.ruleId)).size,
            },
            before: null,
            entityId: lockedThread.id,
            entityType: "mail_thread",
            principal,
            requestId: `scheduler:mail-rule:${(successful[0] as MailRuleWorkRow).claimId as string}`,
          }),
        );
      }
    });
  }

  async function executeClaimedMailRuleWorkGroup(work: MailRuleWorkRow[]): Promise<void> {
    const first = work[0];
    if (!first?.threadId) {
      await transitionMailRuleWork(work, {
        code: "source_missing",
        effect: strongestMailRuleProviderEffect(
          work.map((item) => item.providerEffect),
          "none",
        ),
        message: "The projected Mail conversation is no longer available.",
        status: "failed",
      });
      return;
    }
    const [[account], [thread]] = await Promise.all([
      db
        .select()
        .from(calendarAccounts)
        .where(
          and(
            eq(calendarAccounts.id, first.accountId),
            eq(calendarAccounts.userId, first.userId),
            eq(calendarAccounts.mailEnabled, true),
            eq(calendarAccounts.provider, "google"),
          ),
        )
        .limit(1),
      db
        .select()
        .from(mailThreads)
        .where(
          and(
            eq(mailThreads.id, first.threadId),
            eq(mailThreads.userId, first.userId),
            eq(mailThreads.accountId, first.accountId),
            isNull(mailThreads.deletedAt),
          ),
        )
        .limit(1),
    ]);
    if (!account?.encryptedCredentials || !thread) {
      await transitionMailRuleWork(work, {
        code: "source_unavailable",
        effect: strongestMailRuleProviderEffect(
          work.map((item) => item.providerEffect),
          "none",
        ),
        message: "The connected Google Mail source is no longer available.",
        status: "failed",
      });
      return;
    }
    const candidates: Array<{
      action: MailRuleAction;
      authorization:
        | { action: MailRuleAction; remoteMailboxId: string | null }
        | { code: string; message: string };
      remoteMailboxId: string | null;
      work: MailRuleWorkRow;
    }> = [];
    for (const item of work) {
      const resolvedAction = await resolveClaimedMailRuleAction(
        item,
        db,
        item.claimMode === "reconcile",
      );
      if ("code" in resolvedAction) {
        await transitionMailRuleWork([item], {
          code: resolvedAction.code,
          effect: item.providerEffect,
          message: resolvedAction.message,
          status: "failed",
        });
        continue;
      }
      const authorization = await validateClaimedMailRuleWork(item, thread);
      if ("code" in authorization && item.claimMode !== "reconcile") {
        await transitionMailRuleWork([item], {
          code: authorization.code,
          effect: item.providerEffect,
          message: authorization.message,
          status: "failed",
        });
      } else {
        candidates.push({ ...resolvedAction, authorization, work: item });
      }
    }
    if (candidates.length === 0) return;
    let state: RemoteMailThreadState = {
      mailboxIds: thread.remoteMailboxIds,
      remoteThreadId: thread.remoteThreadId,
      starred: thread.starred,
      unread: thread.unread,
    };
    let currentCredentials = credentials<GoogleCredentials>({
      ...account,
      encryptedCredentials: account.encryptedCredentials,
    });
    const needsReconciliation = candidates.some(({ work: item }) => item.claimMode === "reconcile");
    if (needsReconciliation) {
      if (!google.getMailThreadState) {
        for (const candidate of candidates) {
          await transitionMailRuleWork([candidate.work], {
            code: "reconciliation_unavailable",
            effect: strongestMailRuleProviderEffect(
              [candidate.work.providerEffect, "indeterminate"],
              "none",
            ),
            message: "This connector cannot read exact provider state for reconciliation.",
            status: "reconcile",
          });
        }
        return;
      }
      try {
        const observed = await google.getMailThreadState(currentCredentials, thread.remoteThreadId);
        currentCredentials = await saveGoogleCredentials(account.id, observed.credentials, true);
        state = observed.value;
      } catch (error) {
        const failure = classifyMailRuleProviderFailure(error);
        for (const candidate of candidates) {
          const retryable = candidate.work.attemptCount < MAIL_RULE_WORK_MAX_ATTEMPTS;
          await transitionMailRuleWork([candidate.work], {
            code: failure.code,
            effect: strongestMailRuleProviderEffect(
              [candidate.work.providerEffect, failure.effect],
              "none",
            ),
            message: failure.message,
            status:
              failure.disposition === "failed" ? "failed" : retryable ? "reconcile" : "failed",
          });
        }
        return;
      }
    }
    const exactlyObservedApplied = needsReconciliation
      ? candidates.filter(({ action, remoteMailboxId }) =>
          mailRuleActionIsApplied(action, state, remoteMailboxId),
        )
      : [];
    if (exactlyObservedApplied.length > 0) {
      try {
        await persistMailRuleWorkProjection(
          exactlyObservedApplied.map((candidate) => ({
            ...candidate,
            observedApplied: true,
            providerMutated: false,
          })),
          thread,
          state,
          { actorId: account.id, actorType: "connector", userId: account.userId },
        );
      } catch {
        for (const candidate of exactlyObservedApplied) {
          await transitionMailRuleWork([candidate.work], {
            code: "projection_commit_failed",
            effect: "applied",
            message: "Ilo observed the provider change but could not commit its projection.",
            status: "reconcile",
          }).catch(() => {});
        }
      }
    }
    const mutationCandidates: typeof candidates = [];
    for (const candidate of candidates) {
      if (exactlyObservedApplied.includes(candidate)) continue;
      if (needsReconciliation) {
        if ("code" in candidate.authorization) {
          await transitionMailRuleWork([candidate.work], {
            code: candidate.authorization.code,
            effect: candidate.work.providerEffect,
            message:
              "The accepted rule is no longer authorized; exact provider state was observed without replaying the action.",
            status: "failed",
          });
          continue;
        }
        const currentAuthorization = await validateClaimedMailRuleWork(candidate.work, thread);
        if ("code" in currentAuthorization) {
          await transitionMailRuleWork([candidate.work], {
            code: currentAuthorization.code,
            effect: candidate.work.providerEffect,
            message:
              "The accepted rule changed during reconciliation; exact provider state was observed without replaying the action.",
            status: "failed",
          });
          continue;
        }
      }
      mutationCandidates.push(candidate);
    }
    const notApplied = mutationCandidates.filter(
      ({ action, remoteMailboxId }) => !mailRuleActionIsApplied(action, state, remoteMailboxId),
    );
    let providerMutated = false;
    if (notApplied.length > 0) {
      try {
        const trash = notApplied.find(({ action }) => action.type === "trash");
        if (trash) {
          if (!google.trashMailThread || notApplied.length !== 1) {
            throw new ConnectorError({
              category: "rejected",
              code: "mail_rule_trash_contract_invalid",
              disposition: "operator",
              message: "Recoverable Trash must be the only provider action in this work item.",
              status: 400,
            });
          }
          currentCredentials = await google.trashMailThread(
            currentCredentials,
            thread.remoteThreadId,
          );
        } else {
          if (!google.updateMailThread) {
            throw new ConnectorError({
              category: "configuration",
              code: "google_mail_write_unavailable",
              disposition: "operator",
              message: "Google Mail write-through is unavailable.",
              status: 501,
            });
          }
          const addMailboxIds = new Set<string>();
          const removeMailboxIds = new Set<string>();
          for (const { action, remoteMailboxId } of notApplied) {
            if (action.type === "archive") removeMailboxIds.add("INBOX");
            if (action.type === "mark_read") removeMailboxIds.add("UNREAD");
            if (action.type === "star") addMailboxIds.add("STARRED");
            if (action.type === "add_label" && remoteMailboxId) addMailboxIds.add(remoteMailboxId);
          }
          currentCredentials = await google.updateMailThread(
            currentCredentials,
            thread.remoteThreadId,
            {
              addMailboxIds: [...addMailboxIds],
              removeMailboxIds: [...removeMailboxIds],
            },
          );
        }
        providerMutated = true;
      } catch (error) {
        const failure = classifyMailRuleProviderFailure(error);
        const retryable =
          failure.disposition === "retry" &&
          mutationCandidates.every(
            ({ work: item }) => item.attemptCount < MAIL_RULE_WORK_MAX_ATTEMPTS,
          );
        for (const candidate of mutationCandidates) {
          await transitionMailRuleWork([candidate.work], {
            code: failure.code,
            effect: strongestMailRuleProviderEffect(
              [candidate.work.providerEffect, failure.effect],
              "none",
            ),
            message: failure.message,
            status:
              failure.disposition === "reconcile" ? "reconcile" : retryable ? "pending" : "failed",
          });
        }
        return;
      }
      try {
        currentCredentials = await saveGoogleCredentials(account.id, currentCredentials, true);
      } catch {
        for (const candidate of mutationCandidates) {
          await transitionMailRuleWork([candidate.work], {
            code: "credential_persistence_failed",
            effect: "applied",
            message:
              "The provider change completed, but refreshed Mail credentials were not persisted.",
            status: "reconcile",
          });
        }
        return;
      }
      for (const { action, remoteMailboxId } of notApplied) {
        state = {
          remoteThreadId: state.remoteThreadId,
          ...applyMailRuleActionToState(action, state, remoteMailboxId),
        };
      }
    }
    if (mutationCandidates.length === 0) return;
    try {
      await persistMailRuleWorkProjection(
        mutationCandidates.map((candidate) => ({
          ...candidate,
          observedApplied: false,
          providerMutated: providerMutated && notApplied.includes(candidate),
        })),
        thread,
        state,
        { actorId: account.id, actorType: "connector", userId: account.userId },
      );
    } catch {
      for (const candidate of mutationCandidates) {
        const itemMutated = providerMutated && notApplied.includes(candidate);
        await transitionMailRuleWork([candidate.work], {
          code: "projection_commit_failed",
          effect: strongestMailRuleProviderEffect(
            [candidate.work.providerEffect, itemMutated ? "applied" : "none"],
            "none",
          ),
          message: itemMutated
            ? "The provider change completed, but Ilo could not commit its projection."
            : "Ilo could not commit the reconciled Mail projection.",
          status: itemMutated ? "reconcile" : "pending",
        }).catch(() => {});
      }
    }
  }

  async function refreshMailRuleWorkAttentionForAccount(accountId: string): Promise<void> {
    const [account] = await db
      .select({ id: calendarAccounts.id, userId: calendarAccounts.userId })
      .from(calendarAccounts)
      .where(eq(calendarAccounts.id, accountId))
      .limit(1);
    if (!account) return;
    const requestId = `mail-rule-work-attention:${randomUUID()}`;
    await db.transaction(async (transaction) => {
      await transaction.execute(
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${`mail-rule-work:${account.id}`}, 0))`,
      );
      const summaries = await transaction
        .select({
          count: sql<number>`count(*)::int`,
          status: mailRuleWorkItems.status,
        })
        .from(mailRuleWorkItems)
        .where(
          and(
            eq(mailRuleWorkItems.accountId, accountId),
            inArray(mailRuleWorkItems.status, ["pending", "claimed", "reconcile", "failed"]),
          ),
        )
        .groupBy(mailRuleWorkItems.status);
      const count = (status: MailRuleWorkRow["status"]) =>
        summaries.find((summary) => summary.status === status)?.count ?? 0;
      const pending = count("pending") + count("claimed");
      const reconcile = count("reconcile");
      const failed = count("failed");
      const [existing] = await transaction
        .select()
        .from(attentionItems)
        .where(
          and(
            eq(attentionItems.userId, account.userId),
            eq(attentionItems.domain, "mail"),
            eq(attentionItems.kind, "run_summary"),
            eq(attentionItems.status, "open"),
            eq(attentionItems.relatedEntityType, "mail_account"),
            eq(attentionItems.relatedEntityId, account.id),
          ),
        )
        .for("update")
        .limit(1);
      if (pending === 0 && reconcile === 0 && failed === 0) {
        if (existing) {
          const [resolved] = await transaction
            .update(attentionItems)
            .set({
              status: "resolved",
              updatedAt: now(),
              version: existing.version + 1,
            })
            .where(
              and(eq(attentionItems.id, existing.id), eq(attentionItems.version, existing.version)),
            )
            .returning();
          if (!resolved) {
            throw new AppError(
              "conflict",
              "The Mail run summary changed while it was being resolved.",
            );
          }
          await transaction.insert(auditEvents).values(
            auditValues({
              action: "assistant.attention.resolved",
              after: {
                ...auditAttentionItemMetadata(resolved),
                execution: "background_dispatch",
                policy: "approved_rule",
              },
              before: auditAttentionItemMetadata(existing),
              entityId: resolved.id,
              entityType: "attention_item",
              principal: {
                actorId: account.id,
                actorType: "connector",
                userId: account.userId,
              },
              requestId,
            }),
          );
        }
        return;
      }
      const values = {
        importance: reconcile > 0 || failed > 0 ? ("high" as const) : ("normal" as const),
        summary: `${pending} durable Mail actions are pending; ${reconcile} require exact provider reconciliation; ${failed} stopped safely and need rule, source, or connection review.`,
        title:
          reconcile > 0
            ? "Mail automation needs reconciliation"
            : failed > 0
              ? "Mail automation needs review"
              : "Mail automation has pending work",
        updatedAt: now(),
      };
      if (existing) {
        const [updated] = await transaction
          .update(attentionItems)
          .set({ ...values, version: existing.version + 1 })
          .where(
            and(eq(attentionItems.id, existing.id), eq(attentionItems.version, existing.version)),
          )
          .returning();
        if (!updated) {
          throw new AppError("conflict", "The Mail run summary changed while it was being saved.");
        }
        await transaction.insert(auditEvents).values(
          auditValues({
            action: "assistant.attention.updated",
            after: {
              ...auditAttentionItemMetadata(updated),
              execution: "background_dispatch",
              policy: "approved_rule",
            },
            before: auditAttentionItemMetadata(existing),
            entityId: updated.id,
            entityType: "attention_item",
            principal: {
              actorId: account.id,
              actorType: "connector",
              userId: account.userId,
            },
            requestId,
          }),
        );
      } else {
        const [created] = await transaction
          .insert(attentionItems)
          .values({
            ...values,
            domain: "mail",
            kind: "run_summary",
            relatedEntityId: account.id,
            relatedEntityType: "mail_account",
            status: "open",
            userId: account.userId,
          })
          .returning();
        if (!created) {
          throw new AppError("internal_error", "The Mail run summary could not be created.");
        }
        await transaction.insert(auditEvents).values(
          auditValues({
            action: "assistant.attention.created",
            after: {
              ...auditAttentionItemMetadata(created),
              execution: "background_dispatch",
              policy: "approved_rule",
            },
            before: null,
            entityId: created.id,
            entityType: "attention_item",
            principal: {
              actorId: account.id,
              actorType: "connector",
              userId: account.userId,
            },
            requestId,
          }),
        );
      }
    });
  }

  async function refreshMailRuleWorkAttention(accountIds: string[]): Promise<void> {
    let firstError: unknown;
    for (const accountId of [...new Set(accountIds)]) {
      try {
        await refreshMailRuleWorkAttentionForAccount(accountId);
      } catch (error) {
        firstError ??= error;
      }
    }
    if (firstError) throw firstError;
  }

  async function dispatchDueMailRuleWork(): Promise<{
    claimed: number;
    failed: number;
    pending: number;
    reconciliation: number;
    succeeded: number;
  }> {
    const claim = await claimDueMailRuleWork();
    const { claimed } = claim;
    const groups = new Map<string, MailRuleWorkRow[]>();
    for (const work of claimed) {
      const key = `${work.accountId}:${work.remoteThreadId}`;
      const group = groups.get(key) ?? [];
      group.push(work);
      groups.set(key, group);
    }
    const entries = [...groups.values()];
    let nextIndex = 0;
    const worker = async () => {
      while (nextIndex < entries.length) {
        const group = entries[nextIndex++];
        if (group) await executeClaimedMailRuleWorkGroup(group);
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(MAIL_RULE_WORK_CONCURRENCY, entries.length) }, () => worker()),
    );
    await refreshMailRuleWorkAttention(claim.touchedAccountIds);
    if (claimed.length === 0) {
      return {
        claimed: 0,
        failed: claim.maintenanceFailed,
        pending: 0,
        reconciliation: 0,
        succeeded: 0,
      };
    }
    const final = await db
      .select({ status: mailRuleWorkItems.status })
      .from(mailRuleWorkItems)
      .where(
        inArray(
          mailRuleWorkItems.id,
          claimed.map((work) => work.id),
        ),
      );
    const count = (status: MailRuleWorkRow["status"]) =>
      final.filter((item) => item.status === status).length;
    return {
      claimed: claimed.length,
      failed: count("failed") + claim.maintenanceFailed,
      pending: count("pending"),
      reconciliation: count("reconcile"),
      succeeded: count("succeeded"),
    };
  }

  const safeReturnPath = (value: string | null): "/setup" | "/settings?section=connections" =>
    value === "/setup" || value === "/settings?section=connections"
      ? value
      : "/settings?section=connections";

  async function handleGoogleAuthorizationCallback(input: {
    code?: string;
    error?: string;
    issuer?: string;
    requestId: string;
    state: string;
  }): Promise<{
    attemptId: string | null;
    returnPath: "/setup" | "/settings?section=connections";
    status: "pending" | "connected" | "cancelled" | "expired" | "permission_incomplete" | "failed";
  }> {
    const consumed = await authorization.consume("google", input.state, input.requestId);
    if (consumed.kind === "invalid") {
      return {
        attemptId: null,
        returnPath: "/settings?section=connections",
        status: "failed",
      };
    }
    const returnPath = safeReturnPath(consumed.attempt.returnPath);
    if (consumed.kind === "expired") {
      return { attemptId: consumed.attempt.id, returnPath, status: "expired" };
    }
    if (consumed.kind === "processing") {
      return { attemptId: consumed.attempt.id, returnPath, status: "pending" };
    }
    if (consumed.kind === "closed") {
      return {
        attemptId: consumed.attempt.id,
        returnPath,
        status:
          consumed.attempt.status === "processing" || consumed.attempt.status === "pending"
            ? "pending"
            : consumed.attempt.status,
      };
    }

    const close = async (
      status: "cancelled" | "permission_incomplete" | "failed",
      outcomeCode: string,
    ) => {
      await authorization.close({
        accountId: null,
        attemptId: consumed.attempt.id,
        outcomeCode,
        status,
      });
      return { attemptId: consumed.attempt.id, returnPath, status };
    };

    if (input.issuer && input.issuer !== "https://accounts.google.com") {
      return close("failed", "authorization_issuer_invalid");
    }
    if (input.error) {
      return input.error === "access_denied"
        ? close("cancelled", "authorization_cancelled")
        : close("failed", "provider_authorization_failed");
    }
    if (!input.code) return close("failed", "authorization_code_missing");

    try {
      let googleCredentials = await google.exchangeCode(
        input.code,
        consumed.codeVerifier,
        consumed.attempt.redirectUri ?? googleRedirectUri,
      );
      const profileResult = await google.getProfile(googleCredentials);
      googleCredentials = profileResult.credentials;
      const requestedServices = consumed.attempt.requestedServices ?? ["calendar", "mail"];
      const grantedServices = googleGrantedServices(googleCredentials);
      const target = consumed.attempt.targetAccountId
        ? await getAccount(consumed.attempt.userId, consumed.attempt.targetAccountId)
        : null;
      if (
        target &&
        (target.provider !== "google" ||
          (target.providerAccountId && target.providerAccountId !== profileResult.value.id))
      ) {
        return close("failed", "account_mismatch");
      }
      const [matchedAccount] = await db
        .select({
          calendarEnabled: calendarAccounts.calendarEnabled,
          mailEnabled: calendarAccounts.mailEnabled,
        })
        .from(calendarAccounts)
        .where(
          and(
            eq(calendarAccounts.userId, consumed.attempt.userId),
            eq(calendarAccounts.provider, "google"),
            eq(calendarAccounts.providerAccountId, profileResult.value.id),
          ),
        )
        .limit(1);
      const requiredServices = new Set(requestedServices);
      if ((target ?? matchedAccount)?.calendarEnabled) requiredServices.add("calendar");
      if ((target ?? matchedAccount)?.mailEnabled) requiredServices.add("mail");
      if ([...requiredServices].some((service) => !grantedServices.includes(service))) {
        return close("permission_incomplete", "required_permission_missing");
      }

      await db.transaction(async (transaction) => {
        const requestedCalendar = requestedServices.includes("calendar");
        const requestedMail = requestedServices.includes("mail");
        await transaction
          .insert(calendarAccounts)
          .values({
            avatarUrl: profileResult.value.pictureUrl,
            calendarEnabled: requestedCalendar,
            email: profileResult.value.email,
            encryptedCredentials: encryptJson(googleCredentials, encryptionKey),
            label: profileResult.value.name ?? profileResult.value.email,
            mailEnabled: requestedMail,
            nextSyncAt: now(),
            provider: "google",
            providerAccountId: profileResult.value.id,
            userId: consumed.attempt.userId,
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
                  eq(calendarAccounts.userId, consumed.attempt.userId),
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
        const updatedAccount = requireDatabaseRecord(
          (
            await transaction
              .update(calendarAccounts)
              .set({
                avatarUrl: profileResult.value.pictureUrl,
                calendarEnabled: lockedMatchedAccount.calendarEnabled || requestedCalendar,
                email: profileResult.value.email,
                encryptedCredentials: encryptJson(googleCredentials, encryptionKey),
                label: profileResult.value.name ?? profileResult.value.email,
                mailEnabled: lockedMatchedAccount.mailEnabled || requestedMail,
                nextSyncAt: now(),
                syncClaimId: null,
                syncError: null,
                syncErrorCategory: null,
                syncErrorCode: null,
                syncFailureCount: 0,
                syncGeneration: sql`${calendarAccounts.syncGeneration} + 1`,
                syncRecovery: null,
                syncStatus: "idle",
                updatedAt: now(),
              })
              .where(eq(calendarAccounts.id, lockedMatchedAccount.id))
              .returning()
          )[0],
          "The Google account could not be saved.",
        );
        if (requestedMail) {
          const reconciliationRequeued = await transaction
            .update(mailRuleWorkItems)
            .set({
              attemptCount: 0,
              completedAt: null,
              lastErrorCode: "mail_reauthorized",
              lastErrorMessage:
                "Google Mail access was renewed; exact provider reconciliation is queued without replaying the action.",
              nextAttemptAt: now(),
              status: "reconcile",
              updatedAt: now(),
            })
            .where(
              and(
                eq(mailRuleWorkItems.accountId, updatedAccount.id),
                eq(mailRuleWorkItems.status, "failed"),
                inArray(mailRuleWorkItems.providerEffect, ["applied", "indeterminate"]),
              ),
            )
            .returning({ id: mailRuleWorkItems.id });
          if (reconciliationRequeued.length > 0) {
            await transaction.insert(auditEvents).values(
              auditValues({
                action: "mail.rule.reconciliation_requeued",
                after: {
                  affectedCount: reconciliationRequeued.length,
                  providerEvidencePreserved: true,
                  status: "reconcile",
                },
                before: { status: "failed" },
                entityId: updatedAccount.id,
                entityType: "mail_account",
                principal: {
                  actorId: consumed.attempt.userId,
                  actorType: "user",
                  userId: consumed.attempt.userId,
                },
                requestId: input.requestId,
              }),
            );
          }
        }
        await authorization.close(
          {
            accountId: updatedAccount.id,
            attemptId: consumed.attempt.id,
            outcomeCode: "connected",
            status: "connected",
          },
          transaction,
        );
        await notifications.enqueue(updatedAccount.id, "initial", now(), transaction);
      });
      return { attemptId: consumed.attempt.id, returnPath, status: "connected" };
    } catch (error) {
      const outcomeCode =
        error instanceof ConnectorError &&
        (error.category === "temporary" || error.category === "transport")
          ? "provider_temporarily_unavailable"
          : "authorization_failed";
      try {
        return await close("failed", outcomeCode);
      } catch {
        return { attemptId: consumed.attempt.id, returnPath, status: "failed" };
      }
    }
  }

  return {
    async completeGoogleAuthorization(state: string, code: string) {
      const result = await handleGoogleAuthorizationCallback({
        code,
        requestId: randomUUID(),
        state,
      });
      if (result.status !== "connected" || !result.attemptId) {
        throw new AppError("invalid_request", "Google authorization could not be completed.");
      }
      const [attempt] = await db
        .select()
        .from(oauthStates)
        .where(eq(oauthStates.id, result.attemptId))
        .limit(1);
      if (!attempt?.connectedAccountId) {
        throw new AppError("invalid_request", "Google authorization could not be completed.");
      }
      const account = await getAccount(attempt.userId, attempt.connectedAccountId);
      return {
        accountId: account.id,
        email: account.email,
        returnPath: result.returnPath,
        userId: attempt.userId,
      };
    },

    handleGoogleAuthorizationCallback,

    authorizationOutcome(userId: string, attemptId: string) {
      return authorization.publicOutcome(userId, attemptId);
    },

    purgeExpiredAuthorizationAttempts() {
      return authorization.purgeExpired();
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
        if (existing.calendarEnabled && !input.calendar) {
          await disableCalendarAccount(transaction, existing, requestId);
        }
        const updatedAccount = requireDatabaseRecord(
          (
            await transaction
              .update(calendarAccounts)
              .set({
                calendarEnabled: input.calendar,
                encryptedCredentials: encryptJson(icloudCredentials, encryptionKey),
                mailEnabled: input.mail,
                nextSyncAt: now(),
                syncClaimId: null,
                syncError: null,
                syncErrorCategory: null,
                syncErrorCode: null,
                syncFailureCount: 0,
                syncGeneration: sql`${calendarAccounts.syncGeneration} + 1`,
                syncRecovery: null,
                syncStatus: "idle",
                updatedAt: now(),
              })
              .where(eq(calendarAccounts.id, existing.id))
              .returning()
          )[0],
          "The iCloud account could not be saved.",
        );
        await notifications.enqueue(updatedAccount.id, "initial", now(), transaction);
        return updatedAccount;
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
        const accountCalendars = await transaction
          .select({ id: calendars.id })
          .from(calendars)
          .where(and(eq(calendars.accountId, account.id), eq(calendars.userId, account.userId)))
          .orderBy(asc(calendars.id))
          .for("update");
        await invalidateCalendarProfileSources(transaction, {
          context: {
            principal: {
              actorId: account.userId,
              actorType: "user",
              userId: account.userId,
            },
            requestId,
          },
          now: now(),
          unavailableCalendarIds: accountCalendars.map((calendar) => calendar.id),
          userId: account.userId,
        });
        const [record] = await transaction
          .delete(calendarAccounts)
          .where(
            and(eq(calendarAccounts.id, account.id), eq(calendarAccounts.userId, account.userId)),
          )
          .returning({ id: calendarAccounts.id });
        if (!record) throw new AppError("not_found", "The connected account was not found.");
      });
    },

    dispatchDueMailRuleWork,
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
        health: connectionHealthForAccount(record),
        lastSyncAttemptAt: record.lastSyncAttemptAt?.toISOString() ?? null,
        lastSyncedAt: record.lastSyncedAt?.toISOString() ?? null,
        mailEnabled: record.mailEnabled,
        provider: record.provider,
        nextSyncAt: record.nextSyncAt?.toISOString() ?? null,
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
      const attempt = await authorization.create({
        provider: "google",
        redirectUri: googleRedirectUri,
        requestedServices: input.services,
        returnPath: input.returnTo,
        targetAccountId: target?.id ?? null,
        userId,
      });
      let url: string;
      try {
        url = google.authorizationUrl(
          attempt.state,
          attempt.codeChallenge,
          target?.email ?? undefined,
          input.services,
        );
      } catch (error) {
        if (error instanceof ConnectorError) {
          throw new AppError("service_unavailable", error.message);
        }
        throw error;
      }
      return url;
    },

    dispatchTriggeredSyncs(options: { concurrency?: number; limit?: number } = {}) {
      return notifications.dispatchTriggeredSyncs(syncAccount, options);
    },

    enqueueSyncTrigger(
      accountId: string,
      reason: "initial" | "notification" | "reconciliation" | "manual" | "retry" | "recovery",
    ) {
      return notifications.enqueue(accountId, reason);
    },

    renewSubscriptions(options: { concurrency?: number; limit?: number } = {}) {
      return notifications.renewDueSubscriptions(options);
    },

    receiveGmailNotification(mailboxIdentity: string, historyId: string) {
      return notifications.receiveGmailNotification(mailboxIdentity, historyId);
    },

    receiveCalendarNotification(input: {
      channelId: string;
      messageNumber: string;
      resourceId: string;
      resourceState: "exists" | "not_exists" | "sync";
      token: string;
    }) {
      return notifications.receiveCalendarNotification(input);
    },

    runICloudIdlePass() {
      return notifications.runICloudIdlePass(
        shutdown?.signal ? { signal: shutdown.signal } : undefined,
      );
    },

    syncAccount,
    async observeSyncFreshness(): Promise<{
      eligibleAccountCount: number;
      freshnessAgeMs: number;
    }> {
      const observedAt = now();
      const accounts = await db
        .select({
          createdAt: calendarAccounts.createdAt,
          lastSyncedAt: calendarAccounts.lastSyncedAt,
        })
        .from(calendarAccounts)
        .where(
          and(
            ne(calendarAccounts.provider, "local"),
            or(eq(calendarAccounts.calendarEnabled, true), eq(calendarAccounts.mailEnabled, true)),
            or(
              isNull(calendarAccounts.syncRecovery),
              eq(calendarAccounts.syncRecovery, "automatic"),
            ),
          ),
        );
      return {
        eligibleAccountCount: accounts.length,
        freshnessAgeMs: accounts.reduce(
          (maximumAge, account) =>
            Math.max(
              maximumAge,
              Math.max(
                0,
                observedAt.getTime() - (account.lastSyncedAt ?? account.createdAt).getTime(),
              ),
            ),
          0,
        ),
      };
    },
    async syncDueAccounts(options: { concurrency?: number; limit?: number } = {}): Promise<{
      attempted: number;
      failed: number;
      recovered: number;
      skipped: number;
      succeeded: number;
    }> {
      throwIfQuiescing();
      const selectedAt = now();
      const staleLeaseThreshold = new Date(selectedAt.getTime() - CONNECTOR_SYNC_LEASE_MS);
      const limit = Math.max(1, Math.min(options.limit ?? 25, 100));
      const concurrency = Math.max(1, Math.min(options.concurrency ?? 3, 10));
      const accounts = await db
        .select({
          id: calendarAccounts.id,
          syncFailureCount: calendarAccounts.syncFailureCount,
          userId: calendarAccounts.userId,
        })
        .from(calendarAccounts)
        .where(
          and(
            ne(calendarAccounts.provider, "local"),
            or(eq(calendarAccounts.calendarEnabled, true), eq(calendarAccounts.mailEnabled, true)),
            or(
              and(
                ne(calendarAccounts.syncStatus, "syncing"),
                isNotNull(calendarAccounts.nextSyncAt),
                lte(calendarAccounts.nextSyncAt, selectedAt),
                or(
                  isNull(calendarAccounts.syncRecovery),
                  ne(calendarAccounts.syncRecovery, "reconnect"),
                ),
              ),
              and(
                eq(calendarAccounts.syncStatus, "syncing"),
                lt(calendarAccounts.updatedAt, staleLeaseThreshold),
              ),
            ),
          ),
        )
        .orderBy(asc(calendarAccounts.nextSyncAt), asc(calendarAccounts.updatedAt))
        .limit(limit);
      const result = {
        attempted: accounts.length,
        failed: 0,
        recovered: 0,
        skipped: 0,
        succeeded: 0,
      };
      let cursor = 0;
      const worker = async () => {
        while (cursor < accounts.length) {
          const account = accounts[cursor];
          cursor += 1;
          if (!account) continue;
          try {
            await syncAccount(account.userId, account.id);
            result.succeeded += 1;
            if (account.syncFailureCount > 0) result.recovered += 1;
          } catch (error) {
            if (error instanceof AppError && error.code === "conflict") result.skipped += 1;
            else result.failed += 1;
          }
        }
      };
      await Promise.all(
        Array.from({ length: Math.min(concurrency, accounts.length) }, async () => worker()),
      );
      return result;
    },
    async syncStaleAccounts(_intervalMs = 5 * 60_000): Promise<void> {
      await this.syncDueAccounts();
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
    principal: { actorId: string; actorType: "connector"; userId: string },
    requestId: string,
    syncClaim: SyncClaim,
  ): Promise<void> {
    await db.transaction(async (transaction) => {
      await requireConnectorSyncClaim(transaction, account, syncClaim, "Calendar projection");
      const existing = await transaction
        .select()
        .from(calendars)
        .where(
          and(
            eq(calendars.accountId, account.id),
            eq(calendars.userId, account.userId),
            eq(calendars.provider, provider),
            isNull(calendars.deletedAt),
          ),
        )
        .orderBy(asc(calendars.id))
        .for("update");
      const remoteIds = new Set(remoteCalendars.map((remote) => remote.id));
      const unavailable = existing.filter(
        (calendar) =>
          calendar.remoteCalendarId !== null && !remoteIds.has(calendar.remoteCalendarId),
      );
      const unwritableCalendarIds: string[] = [];
      for (const remote of remoteCalendars) {
        const [saved] = await transaction
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
          })
          .returning({ id: calendars.id });
        if (!saved) {
          throw new AppError("internal_error", "The connected calendar could not be saved.");
        }
        if (!remote.writable) unwritableCalendarIds.push(saved.id);
      }
      const unavailableCalendarIds = unavailable.map((calendar) => calendar.id);
      if (unavailableCalendarIds.length > 0) {
        const unavailableAt = now();
        const removed = await transaction
          .update(calendars)
          .set({ deletedAt: unavailableAt, updatedAt: unavailableAt })
          .where(inArray(calendars.id, unavailableCalendarIds))
          .returning();
        await transaction
          .update(calendarEvents)
          .set({ deletedAt: unavailableAt, updatedAt: unavailableAt })
          .where(
            and(
              inArray(calendarEvents.calendarId, unavailableCalendarIds),
              isNull(calendarEvents.deletedAt),
            ),
          );
        for (const calendar of removed) {
          const before = unavailable.find((candidate) => candidate.id === calendar.id) ?? null;
          await transaction.insert(auditEvents).values(
            auditValues({
              action: "calendar.source_unavailable",
              after: auditSnapshot(calendar),
              before: auditSnapshot(before),
              entityId: calendar.id,
              entityType: "calendar",
              principal,
              requestId,
            }),
          );
        }
      }
      await invalidateCalendarProfileSources(transaction, {
        context: { principal, requestId },
        now: now(),
        unavailableCalendarIds,
        unwritableCalendarIds,
        userId: account.userId,
      });
    });
  }
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
