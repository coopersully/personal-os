import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import type {
  GoogleConnector,
  GoogleCredentials,
  ICloudConnector,
  ICloudCredentials,
} from "@personal-os/connectors";
import { ConnectorError } from "@personal-os/connectors";
import {
  calendarAccounts,
  calendars,
  connectorSubscriptions,
  connectorSyncTriggers,
  type Database,
} from "@personal-os/database";
import type { ConnectorSubscriptionKind, ConnectorSyncTriggerReason } from "@personal-os/domain";
import { and, asc, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { decryptJson, encryptJson } from "./security.js";
import type { RequestLog } from "./types.js";

const TRIGGER_CLAIM_LEASE_MS = 5 * 60_000;

export type ClaimedConnectorTrigger = {
  accountId: string;
  claimId: string;
  notificationCount: number;
  observedAt: Date;
  queuedAt: Date;
  reason: ConnectorSyncTriggerReason;
};

type Options = {
  calendarWebhookUrl?: string;
  db: Database;
  encryptionKey?: string;
  gmailTopicName?: string;
  google?: GoogleConnector;
  icloud?: ICloudConnector;
  icloudMailIdleConcurrency?: number;
  icloudMailIdleEnabled?: boolean;
  log?: (entry: RequestLog) => void;
  now: () => Date;
};
type NotificationDatabase = Pick<Database, "insert">;

const reasonRank = (value: ReturnType<typeof sql.raw>) => sql`CASE ${value}
  WHEN 'notification' THEN 6
  WHEN 'initial' THEN 5
  WHEN 'manual' THEN 4
  WHEN 'recovery' THEN 3
  WHEN 'retry' THEN 2
  ELSE 1
END`;

export function createConnectorNotificationService({
  calendarWebhookUrl,
  db,
  encryptionKey,
  gmailTopicName,
  google,
  icloud,
  icloudMailIdleConcurrency = 5,
  icloudMailIdleEnabled = false,
  log,
  now,
}: Options) {
  function observe(input: {
    ageMs?: number;
    code?: string;
    durationMs?: number;
    event: Extract<
      RequestLog["event"],
      | "connector_notification_received"
      | "connector_subscription_expired"
      | "connector_subscription_failed"
      | "connector_subscription_renewed"
      | "connector_trigger_dispatched"
    >;
    notificationDisposition?: "accepted" | "duplicate" | "rejected";
    provider: "google" | "icloud";
    renewalLagMs?: number;
    status: number;
    subscriptionKind?: ConnectorSubscriptionKind;
    triggerReason?: ConnectorSyncTriggerReason;
  }): void {
    log?.({
      ...(input.ageMs === undefined ? {} : { ageMs: Math.max(0, input.ageMs) }),
      ...(input.code ? { code: input.code } : {}),
      durationMs: Math.max(0, input.durationMs ?? 0),
      event: input.event,
      method: "CONNECTOR",
      ...(input.notificationDisposition
        ? { notificationDisposition: input.notificationDisposition }
        : {}),
      path: "/internal/connectors/notifications",
      provider: input.provider,
      ...(input.renewalLagMs === undefined
        ? {}
        : { renewalLagMs: Math.max(0, input.renewalLagMs) }),
      requestId: randomUUID(),
      status: input.status,
      ...(input.subscriptionKind ? { subscriptionKind: input.subscriptionKind } : {}),
      ...(input.triggerReason ? { triggerReason: input.triggerReason } : {}),
    });
  }
  async function persistGoogleCredentials(
    accountId: string,
    incoming: GoogleCredentials,
  ): Promise<void> {
    if (!encryptionKey) return;
    await db.transaction(async (transaction) => {
      const [account] = await transaction
        .select({ encryptedCredentials: calendarAccounts.encryptedCredentials })
        .from(calendarAccounts)
        .where(eq(calendarAccounts.id, accountId))
        .for("update")
        .limit(1);
      if (!account?.encryptedCredentials) return;
      const current = decryptJson<GoogleCredentials>(account.encryptedCredentials, encryptionKey);
      const selected =
        new Date(current.expiresAt).getTime() > new Date(incoming.expiresAt).getTime()
          ? current
          : incoming;
      await transaction
        .update(calendarAccounts)
        .set({ encryptedCredentials: encryptJson(selected, encryptionKey), updatedAt: now() })
        .where(eq(calendarAccounts.id, accountId));
    });
  }

  const retryAt = (failureCount: number) => {
    const delays = [1, 5, 15, 60, 360] as const;
    const minutes = delays[Math.min(failureCount - 1, delays.length - 1)] ?? delays.at(-1) ?? 360;
    return new Date(now().getTime() + minutes * 60_000);
  };

  return {
    async ensureGoogleSubscriptions(accountId: string): Promise<void> {
      const [account] = await db
        .select({
          calendarEnabled: calendarAccounts.calendarEnabled,
          mailEnabled: calendarAccounts.mailEnabled,
          provider: calendarAccounts.provider,
        })
        .from(calendarAccounts)
        .where(eq(calendarAccounts.id, accountId))
        .limit(1);
      if (account?.provider !== "google") return;
      const values: Array<typeof connectorSubscriptions.$inferInsert> = [];
      if (gmailTopicName && account.mailEnabled) {
        values.push({ accountId, kind: "gmail_mailbox", provider: "google", nextAttemptAt: now() });
      }
      if (calendarWebhookUrl && account.calendarEnabled) {
        values.push({
          accountId,
          kind: "google_calendar_list",
          provider: "google",
          nextAttemptAt: now(),
        });
        const enabledCalendars = await db
          .select({ id: calendars.id })
          .from(calendars)
          .where(
            and(
              eq(calendars.accountId, accountId),
              eq(calendars.isSelected, true),
              isNull(calendars.deletedAt),
            ),
          );
        values.push(
          ...enabledCalendars.map((calendar) => ({
            accountId,
            calendarId: calendar.id,
            kind: "google_calendar_events" as const,
            nextAttemptAt: now(),
            provider: "google" as const,
          })),
        );
      }
      if (values.length === 0) return;
      await db.insert(connectorSubscriptions).values(values).onConflictDoNothing();
    },

    async ensureICloudMailSubscription(accountId: string): Promise<void> {
      if (!icloudMailIdleEnabled) return;
      const [account] = await db
        .select({ mailEnabled: calendarAccounts.mailEnabled, provider: calendarAccounts.provider })
        .from(calendarAccounts)
        .where(eq(calendarAccounts.id, accountId))
        .limit(1);
      if (account?.provider !== "icloud" || !account.mailEnabled) return;
      await db
        .insert(connectorSubscriptions)
        .values({
          accountId,
          kind: "icloud_mail_idle",
          nextAttemptAt: now(),
          provider: "icloud",
        })
        .onConflictDoNothing();
    },

    async runICloudIdlePass(input: { signal?: AbortSignal } = {}): Promise<{
      claimed: number;
      failed: number;
      skipped: number;
      succeeded: number;
    }> {
      if (!icloudMailIdleEnabled || !icloud?.listenForMailChanges || !encryptionKey) {
        return { claimed: 0, failed: 0, skipped: 0, succeeded: 0 };
      }
      const accounts = await db
        .select({ id: calendarAccounts.id })
        .from(calendarAccounts)
        .where(and(eq(calendarAccounts.provider, "icloud"), eq(calendarAccounts.mailEnabled, true)))
        .limit(100);
      for (const account of accounts) await this.ensureICloudMailSubscription(account.id);
      const claimedAt = now();
      const limit = Math.max(1, Math.min(icloudMailIdleConcurrency, 25));
      const claims = await db.transaction(async (transaction) => {
        const due = await transaction
          .select()
          .from(connectorSubscriptions)
          .where(
            and(
              eq(connectorSubscriptions.kind, "icloud_mail_idle"),
              inArray(connectorSubscriptions.status, ["pending", "active", "failed"]),
              or(
                isNull(connectorSubscriptions.nextAttemptAt),
                lte(connectorSubscriptions.nextAttemptAt, claimedAt),
              ),
              or(
                isNull(connectorSubscriptions.leaseClaimId),
                lte(connectorSubscriptions.leaseExpiresAt, claimedAt),
              ),
            ),
          )
          .orderBy(asc(connectorSubscriptions.nextAttemptAt), asc(connectorSubscriptions.updatedAt))
          .limit(limit)
          .for("update", { skipLocked: true });
        const claimed = [];
        for (const subscription of due) {
          const claimId = randomUUID();
          const [row] = await transaction
            .update(connectorSubscriptions)
            .set({
              leaseClaimId: claimId,
              leaseExpiresAt: new Date(claimedAt.getTime() + 30 * 60_000),
              status: "active",
              updatedAt: claimedAt,
            })
            .where(eq(connectorSubscriptions.id, subscription.id))
            .returning();
          if (row) claimed.push({ ...row, claimId });
        }
        return claimed;
      });
      const result = { claimed: claims.length, failed: 0, skipped: 0, succeeded: 0 };
      await Promise.all(
        claims.map(async (subscription) => {
          const [account] = await db
            .select()
            .from(calendarAccounts)
            .where(eq(calendarAccounts.id, subscription.accountId))
            .limit(1);
          if (!account?.encryptedCredentials || account.syncRecovery === "reconnect") {
            await db
              .update(connectorSubscriptions)
              .set({
                leaseClaimId: null,
                leaseExpiresAt: null,
                nextAttemptAt: null,
                status: "stopped",
                updatedAt: now(),
              })
              .where(
                and(
                  eq(connectorSubscriptions.id, subscription.id),
                  eq(connectorSubscriptions.leaseClaimId, subscription.claimId),
                ),
              );
            result.skipped += 1;
            return;
          }
          try {
            const credentials = decryptJson<ICloudCredentials>(
              account.encryptedCredentials,
              encryptionKey,
            );
            await icloud.listenForMailChanges?.(
              credentials,
              () => this.enqueue(account.id, "notification"),
              input.signal ? { signal: input.signal } : undefined,
            );
            await db
              .update(connectorSubscriptions)
              .set({
                failureCount: 0,
                leaseClaimId: null,
                leaseExpiresAt: null,
                nextAttemptAt: new Date(now().getTime() + 5_000),
                safeFailureCode: null,
                status: "active",
                updatedAt: now(),
              })
              .where(
                and(
                  eq(connectorSubscriptions.id, subscription.id),
                  eq(connectorSubscriptions.leaseClaimId, subscription.claimId),
                ),
              );
            result.succeeded += 1;
          } catch (error) {
            const failureCount = subscription.failureCount + 1;
            if (error instanceof ConnectorError && error.disposition === "reconnect") {
              await db
                .update(calendarAccounts)
                .set({
                  nextSyncAt: null,
                  syncError: "Reconnect this iCloud account to resume syncing.",
                  syncErrorCategory: "authorization",
                  syncErrorCode: error.code,
                  syncFailureCount: sql`${calendarAccounts.syncFailureCount} + 1`,
                  syncRecovery: "reconnect",
                  syncStatus: "error",
                  updatedAt: now(),
                })
                .where(eq(calendarAccounts.id, account.id));
            }
            await db
              .update(connectorSubscriptions)
              .set({
                failureCount,
                leaseClaimId: null,
                leaseExpiresAt: null,
                nextAttemptAt: input.signal?.aborted ? now() : retryAt(failureCount),
                safeFailureCode:
                  error instanceof ConnectorError ? error.code : "icloud_idle_session_failed",
                status: input.signal?.aborted ? "active" : "failed",
                updatedAt: now(),
              })
              .where(
                and(
                  eq(connectorSubscriptions.id, subscription.id),
                  eq(connectorSubscriptions.leaseClaimId, subscription.claimId),
                ),
              );
            if (input.signal?.aborted) result.skipped += 1;
            else {
              result.failed += 1;
              observe({
                code: error instanceof ConnectorError ? error.code : "icloud_idle_session_failed",
                event: "connector_subscription_failed",
                provider: "icloud",
                status: 503,
                subscriptionKind: subscription.kind,
              });
            }
          }
        }),
      );
      return result;
    },

    async renewDueSubscriptions(
      options: { concurrency?: number; limit?: number } = {},
    ): Promise<{ attempted: number; failed: number; skipped: number; succeeded: number }> {
      if (!google || !encryptionKey) return { attempted: 0, failed: 0, skipped: 0, succeeded: 0 };
      const configuredAccounts = await db
        .select({ id: calendarAccounts.id })
        .from(calendarAccounts)
        .where(
          and(
            eq(calendarAccounts.provider, "google"),
            or(eq(calendarAccounts.calendarEnabled, true), eq(calendarAccounts.mailEnabled, true)),
          ),
        )
        .limit(100);
      for (const account of configuredAccounts) await this.ensureGoogleSubscriptions(account.id);
      const selectedAt = now();
      const limit = Math.max(1, Math.min(options.limit ?? 25, 100));
      const claims = await db.transaction(async (transaction) => {
        const due = await transaction
          .select()
          .from(connectorSubscriptions)
          .where(
            and(
              inArray(connectorSubscriptions.status, [
                "pending",
                "active",
                "renewing",
                "failed",
                "expired",
              ]),
              or(
                eq(connectorSubscriptions.status, "renewing"),
                and(
                  eq(connectorSubscriptions.status, "active"),
                  lte(connectorSubscriptions.renewAfter, selectedAt),
                ),
                and(
                  inArray(connectorSubscriptions.status, ["pending", "failed", "expired"]),
                  or(
                    isNull(connectorSubscriptions.nextAttemptAt),
                    lte(connectorSubscriptions.nextAttemptAt, selectedAt),
                  ),
                ),
              ),
              or(
                isNull(connectorSubscriptions.leaseClaimId),
                lte(connectorSubscriptions.leaseExpiresAt, selectedAt),
              ),
            ),
          )
          .orderBy(asc(connectorSubscriptions.nextAttemptAt), asc(connectorSubscriptions.updatedAt))
          .limit(limit)
          .for("update", { skipLocked: true });
        const claimed = [];
        for (const subscription of due) {
          const claimId = randomUUID();
          const [row] = await transaction
            .update(connectorSubscriptions)
            .set({
              leaseClaimId: claimId,
              leaseExpiresAt: new Date(selectedAt.getTime() + TRIGGER_CLAIM_LEASE_MS),
              status: subscription.status === "active" ? "renewing" : subscription.status,
              updatedAt: selectedAt,
            })
            .where(eq(connectorSubscriptions.id, subscription.id))
            .returning();
          if (row) claimed.push({ ...row, claimId });
        }
        return claimed;
      });
      const result = { attempted: claims.length, failed: 0, skipped: 0, succeeded: 0 };
      const concurrency = Math.max(1, Math.min(options.concurrency ?? 3, 10));
      let cursor = 0;
      const worker = async () => {
        while (cursor < claims.length) {
          const subscription = claims[cursor];
          cursor += 1;
          if (!subscription) continue;
          const operationStartedAt = Date.now();
          const [account] = await db
            .select()
            .from(calendarAccounts)
            .where(eq(calendarAccounts.id, subscription.accountId))
            .limit(1);
          if (!account?.encryptedCredentials || account.syncRecovery === "reconnect") {
            await db
              .update(connectorSubscriptions)
              .set({
                leaseClaimId: null,
                leaseExpiresAt: null,
                nextAttemptAt: null,
                status: "stopped",
                updatedAt: now(),
              })
              .where(
                and(
                  eq(connectorSubscriptions.id, subscription.id),
                  eq(connectorSubscriptions.leaseClaimId, subscription.claimId),
                ),
              );
            result.skipped += 1;
            continue;
          }
          try {
            if (subscription.expiresAt && subscription.expiresAt <= selectedAt) {
              observe({
                event: "connector_subscription_expired",
                provider: "google",
                status: 503,
                subscriptionKind: subscription.kind,
              });
            }
            let currentCredentials = decryptJson<GoogleCredentials>(
              account.encryptedCredentials,
              encryptionKey,
            );
            let expiresAt: string;
            let providerCursor: string | null = subscription.providerCursor;
            let channelId: string | null = null;
            let remoteResourceId: string | null = null;
            let verificationTokenHash: string | null = null;
            if (subscription.kind === "gmail_mailbox") {
              if (!gmailTopicName || !google.watchGmail) throw new Error("gmail_watch_disabled");
              const watch = await google.watchGmail(currentCredentials, gmailTopicName);
              currentCredentials = watch.credentials;
              expiresAt = watch.value.expiresAt;
              providerCursor = watch.value.historyId;
            } else {
              if (!calendarWebhookUrl) throw new Error("calendar_watch_disabled");
              channelId = randomUUID();
              const token = randomBytes(32).toString("base64url");
              verificationTokenHash = createHash("sha256").update(token).digest("hex");
              if (subscription.kind === "google_calendar_list") {
                if (!google.watchCalendarList) throw new Error("calendar_list_watch_disabled");
                const watch = await google.watchCalendarList(currentCredentials, {
                  address: calendarWebhookUrl,
                  id: channelId,
                  token,
                });
                currentCredentials = watch.credentials;
                expiresAt = watch.value.expiresAt;
                remoteResourceId = watch.value.resourceId;
              } else {
                if (!google.watchCalendarEvents || !subscription.calendarId) {
                  throw new Error("calendar_events_watch_disabled");
                }
                const [calendar] = await db
                  .select({ remoteCalendarId: calendars.remoteCalendarId })
                  .from(calendars)
                  .where(eq(calendars.id, subscription.calendarId))
                  .limit(1);
                if (!calendar?.remoteCalendarId) throw new Error("calendar_resource_missing");
                const watch = await google.watchCalendarEvents(
                  currentCredentials,
                  calendar.remoteCalendarId,
                  { address: calendarWebhookUrl, id: channelId, token },
                );
                currentCredentials = watch.credentials;
                expiresAt = watch.value.expiresAt;
                remoteResourceId = watch.value.resourceId;
              }
            }
            await persistGoogleCredentials(account.id, currentCredentials);
            const expiration = new Date(expiresAt);
            const renewAfter = new Date(
              Math.min(selectedAt.getTime() + 24 * 60 * 60_000, expiration.getTime() - 60 * 60_000),
            );
            const [persisted] = await db
              .update(connectorSubscriptions)
              .set({
                channelId,
                expiresAt: expiration,
                failureCount: 0,
                lastVerifiedAt: now(),
                leaseClaimId: null,
                leaseExpiresAt: null,
                nextAttemptAt: null,
                providerCursor,
                remoteIdentityHash: account.email
                  ? createHmac("sha256", Buffer.from(encryptionKey, "base64"))
                      .update(account.email.trim().toLowerCase())
                      .digest("hex")
                  : null,
                remoteResourceId,
                renewAfter,
                safeFailureCode: null,
                status: "active",
                updatedAt: now(),
                verificationTokenHash,
              })
              .where(
                and(
                  eq(connectorSubscriptions.id, subscription.id),
                  eq(connectorSubscriptions.leaseClaimId, subscription.claimId),
                ),
              )
              .returning({ id: connectorSubscriptions.id });
            if (!persisted) {
              if (
                channelId &&
                remoteResourceId &&
                google.stopCalendarWatch &&
                subscription.kind !== "gmail_mailbox"
              ) {
                await google
                  .stopCalendarWatch(currentCredentials, channelId, remoteResourceId)
                  .catch(() => undefined);
              }
              result.skipped += 1;
              continue;
            }
            if (
              subscription.kind !== "gmail_mailbox" &&
              subscription.channelId &&
              subscription.remoteResourceId &&
              google.stopCalendarWatch
            ) {
              await google
                .stopCalendarWatch(
                  currentCredentials,
                  subscription.channelId,
                  subscription.remoteResourceId,
                )
                .catch(() => undefined);
            }
            result.succeeded += 1;
            observe({
              durationMs: Date.now() - operationStartedAt,
              event: "connector_subscription_renewed",
              provider: "google",
              renewalLagMs: subscription.renewAfter
                ? selectedAt.getTime() - subscription.renewAfter.getTime()
                : 0,
              status: 200,
              subscriptionKind: subscription.kind,
            });
          } catch (error) {
            const failureCount = subscription.failureCount + 1;
            const safeFailureCode =
              error instanceof ConnectorError ? error.code : "connector_subscription_failed";
            const [failed] = await db
              .update(connectorSubscriptions)
              .set({
                failureCount,
                leaseClaimId: null,
                leaseExpiresAt: null,
                nextAttemptAt: retryAt(failureCount),
                safeFailureCode,
                status: "failed",
                updatedAt: now(),
              })
              .where(
                and(
                  eq(connectorSubscriptions.id, subscription.id),
                  eq(connectorSubscriptions.leaseClaimId, subscription.claimId),
                ),
              )
              .returning({ id: connectorSubscriptions.id });
            if (!failed) {
              result.skipped += 1;
              continue;
            }
            result.failed += 1;
            observe({
              code: safeFailureCode,
              durationMs: Date.now() - operationStartedAt,
              event: "connector_subscription_failed",
              provider: "google",
              status: error instanceof ConnectorError ? (error.status ?? 503) : 503,
              subscriptionKind: subscription.kind,
            });
          }
        }
      };
      await Promise.all(
        Array.from({ length: Math.min(concurrency, claims.length) }, async () => worker()),
      );
      return result;
    },

    async receiveGmailNotification(
      mailboxIdentity: string,
      historyId: string,
    ): Promise<"accepted" | "duplicate" | "unknown"> {
      if (!encryptionKey) {
        observe({
          event: "connector_notification_received",
          notificationDisposition: "rejected",
          provider: "google",
          status: 404,
          subscriptionKind: "gmail_mailbox",
        });
        return "unknown";
      }
      const remoteIdentityHash = createHmac("sha256", Buffer.from(encryptionKey, "base64"))
        .update(mailboxIdentity.trim().toLowerCase())
        .digest("hex");
      const outcome = await db.transaction(async (transaction) => {
        const [subscription] = await transaction
          .select()
          .from(connectorSubscriptions)
          .where(
            and(
              eq(connectorSubscriptions.kind, "gmail_mailbox"),
              eq(connectorSubscriptions.remoteIdentityHash, remoteIdentityHash),
              inArray(connectorSubscriptions.status, ["active", "renewing"]),
            ),
          )
          .for("update")
          .limit(1);
        if (!subscription) return "unknown" as const;
        const current = subscription.providerCursor;
        const isNewer =
          current === null ||
          (/^\d+$/u.test(current) &&
            /^\d+$/u.test(historyId) &&
            BigInt(historyId) > BigInt(current));
        await transaction
          .update(connectorSubscriptions)
          .set({
            ...(isNewer ? { providerCursor: historyId } : {}),
            lastNotificationAt: now(),
            updatedAt: now(),
          })
          .where(eq(connectorSubscriptions.id, subscription.id));
        if (isNewer) {
          await this.enqueue(subscription.accountId, "notification", now(), transaction);
        }
        return isNewer ? ("accepted" as const) : ("duplicate" as const);
      });
      observe({
        event: "connector_notification_received",
        notificationDisposition: outcome === "unknown" ? "rejected" : outcome,
        provider: "google",
        status: outcome === "unknown" ? 404 : 204,
        subscriptionKind: "gmail_mailbox",
      });
      return outcome;
    },

    async receiveCalendarNotification(input: {
      channelId: string;
      messageNumber: string;
      resourceId: string;
      resourceState: "exists" | "not_exists" | "sync";
      token: string;
    }): Promise<"accepted" | "duplicate" | "unknown"> {
      const tokenHash = createHash("sha256").update(input.token).digest();
      const outcome = await db.transaction(async (transaction) => {
        const [subscription] = await transaction
          .select()
          .from(connectorSubscriptions)
          .where(
            and(
              eq(connectorSubscriptions.channelId, input.channelId),
              inArray(connectorSubscriptions.kind, [
                "google_calendar_list",
                "google_calendar_events",
              ]),
              inArray(connectorSubscriptions.status, ["active", "renewing"]),
            ),
          )
          .for("update")
          .limit(1);
        const expectedHash = subscription?.verificationTokenHash;
        const verified =
          subscription?.remoteResourceId === input.resourceId &&
          typeof expectedHash === "string" &&
          /^[a-f0-9]{64}$/u.test(expectedHash) &&
          timingSafeEqual(Buffer.from(expectedHash, "hex"), tokenHash);
        if (!subscription || !verified) return "unknown" as const;
        const current = subscription.providerCursor;
        const isNewer =
          current === null ||
          (/^\d+$/u.test(current) && BigInt(input.messageNumber) > BigInt(current));
        await transaction
          .update(connectorSubscriptions)
          .set({
            ...(isNewer ? { providerCursor: input.messageNumber } : {}),
            lastNotificationAt: now(),
            ...(input.resourceState === "sync" ? { lastVerifiedAt: now(), status: "active" } : {}),
            updatedAt: now(),
          })
          .where(eq(connectorSubscriptions.id, subscription.id));
        if (isNewer && input.resourceState !== "sync") {
          await this.enqueue(subscription.accountId, "notification", now(), transaction);
        }
        return isNewer ? ("accepted" as const) : ("duplicate" as const);
      });
      observe({
        event: "connector_notification_received",
        notificationDisposition: outcome === "unknown" ? "rejected" : outcome,
        provider: "google",
        status: outcome === "unknown" ? 404 : 204,
      });
      return outcome;
    },

    async claimDueTriggers(options: { limit?: number } = {}): Promise<ClaimedConnectorTrigger[]> {
      const claimedAt = now();
      const limit = Math.max(1, Math.min(options.limit ?? 25, 100));
      return db.transaction(async (transaction) => {
        const available = await transaction
          .select()
          .from(connectorSyncTriggers)
          .where(
            and(
              lte(connectorSyncTriggers.availableAt, claimedAt),
              or(
                isNull(connectorSyncTriggers.claimId),
                lte(connectorSyncTriggers.claimExpiresAt, claimedAt),
              ),
            ),
          )
          .orderBy(asc(connectorSyncTriggers.availableAt))
          .limit(limit)
          .for("update", { skipLocked: true });
        const claims: ClaimedConnectorTrigger[] = [];
        for (const trigger of available) {
          const claimId = randomUUID();
          const [claimed] = await transaction
            .update(connectorSyncTriggers)
            .set({
              claimExpiresAt: new Date(claimedAt.getTime() + TRIGGER_CLAIM_LEASE_MS),
              claimId,
              updatedAt: claimedAt,
            })
            .where(eq(connectorSyncTriggers.accountId, trigger.accountId))
            .returning();
          if (claimed) {
            claims.push({
              accountId: claimed.accountId,
              claimId,
              notificationCount: claimed.notificationCount,
              observedAt: claimed.lastTriggeredAt,
              queuedAt: claimed.firstTriggeredAt,
              reason: claimed.reason,
            });
          }
        }
        return claims;
      });
    },

    async completeTrigger(claim: ClaimedConnectorTrigger): Promise<void> {
      const removed = await db
        .delete(connectorSyncTriggers)
        .where(
          and(
            eq(connectorSyncTriggers.accountId, claim.accountId),
            eq(connectorSyncTriggers.claimId, claim.claimId),
            lte(connectorSyncTriggers.lastTriggeredAt, claim.observedAt),
          ),
        )
        .returning({ accountId: connectorSyncTriggers.accountId });
      if (removed.length > 0) return;
      await db
        .update(connectorSyncTriggers)
        .set({
          availableAt: now(),
          claimExpiresAt: null,
          claimId: null,
          updatedAt: now(),
        })
        .where(
          and(
            eq(connectorSyncTriggers.accountId, claim.accountId),
            eq(connectorSyncTriggers.claimId, claim.claimId),
          ),
        );
    },

    async dispatchTriggeredSyncs(
      syncAccount: (userId: string, accountId: string) => Promise<unknown>,
      options: { concurrency?: number; limit?: number } = {},
    ): Promise<{ attempted: number; failed: number; succeeded: number }> {
      const claims = await this.claimDueTriggers(
        options.limit === undefined ? {} : { limit: options.limit },
      );
      const result = { attempted: claims.length, failed: 0, succeeded: 0 };
      const concurrency = Math.max(1, Math.min(options.concurrency ?? 3, 10));
      let cursor = 0;
      const worker = async () => {
        while (cursor < claims.length) {
          const claim = claims[cursor];
          cursor += 1;
          if (!claim) continue;
          const [account] = await db
            .select({
              provider: calendarAccounts.provider,
              syncRecovery: calendarAccounts.syncRecovery,
              userId: calendarAccounts.userId,
            })
            .from(calendarAccounts)
            .where(eq(calendarAccounts.id, claim.accountId))
            .limit(1);
          if (!account || account.syncRecovery === "reconnect") {
            await this.completeTrigger(claim);
            continue;
          }
          observe({
            ageMs: now().getTime() - claim.queuedAt.getTime(),
            event: "connector_trigger_dispatched",
            provider: account.provider === "icloud" ? "icloud" : "google",
            status: 200,
            triggerReason: claim.reason,
          });
          try {
            await syncAccount(account.userId, claim.accountId);
            await this.completeTrigger(claim);
            result.succeeded += 1;
          } catch {
            await this.releaseTrigger(claim, new Date(now().getTime() + 60_000));
            result.failed += 1;
          }
        }
      };
      await Promise.all(
        Array.from({ length: Math.min(concurrency, claims.length) }, async () => worker()),
      );
      return result;
    },

    async enqueue(
      accountId: string,
      reason: ConnectorSyncTriggerReason,
      at: Date = now(),
      executor: NotificationDatabase = db,
    ): Promise<void> {
      const currentReason = sql.raw('"connector_sync_triggers"."reason"');
      const incomingReason = sql.raw('excluded."reason"');
      await executor
        .insert(connectorSyncTriggers)
        .values({
          accountId,
          availableAt: at,
          firstTriggeredAt: at,
          lastTriggeredAt: at,
          reason,
        })
        .onConflictDoUpdate({
          set: {
            availableAt: sql`LEAST(${connectorSyncTriggers.availableAt}, excluded."available_at")`,
            firstTriggeredAt: sql`LEAST(${connectorSyncTriggers.firstTriggeredAt}, excluded."first_triggered_at")`,
            lastTriggeredAt: sql`GREATEST(${connectorSyncTriggers.lastTriggeredAt}, excluded."last_triggered_at")`,
            notificationCount: sql`LEAST(1000000, ${connectorSyncTriggers.notificationCount} + 1)`,
            reason: sql`CASE WHEN ${reasonRank(incomingReason)} > ${reasonRank(currentReason)} THEN excluded."reason" ELSE ${connectorSyncTriggers.reason} END`,
            updatedAt: at,
          },
          target: connectorSyncTriggers.accountId,
        });
    },

    async releaseTrigger(claim: ClaimedConnectorTrigger, availableAt: Date): Promise<void> {
      await db
        .update(connectorSyncTriggers)
        .set({ claimExpiresAt: null, claimId: null, availableAt, updatedAt: now() })
        .where(
          and(
            eq(connectorSyncTriggers.accountId, claim.accountId),
            eq(connectorSyncTriggers.claimId, claim.claimId),
          ),
        );
    },
  };
}
