import { randomUUID } from "node:crypto";
import {
  type Database,
  financeConversationMessages,
  nativePushDeliveries,
  nativePushDevices,
  nativePushEvents,
  notificationPreferences,
  sessions,
  users,
} from "@personal-os/database";
import {
  defaultNotificationPreferences,
  type NativePushDeviceInput,
  type NativePushDeviceRegistration,
  type NativePushEventDestination,
  nativePushDeviceInputSchema,
} from "@personal-os/domain";
import { and, asc, eq, gt, inArray, lte, sql } from "drizzle-orm";
import { AppError } from "./errors.js";
import type { ApnsConfig, NativePushTransport } from "./native-push-transport.js";
import { decryptJson, encryptJson, hashToken } from "./security.js";
import type { Principal } from "./types.js";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Store = Pick<Database, "insert" | "select" | "execute">;

/** Caller supplies its transaction: a rolled-back reply cannot leave an orphan notification. */
export async function enqueueNativePushEvent(
  tx: Store,
  input: {
    userId: string;
    sourceId: string;
    kind: "reply" | "attention" | "activity";
    sourceType?:
      | "conversation_message"
      | "maintenance_run"
      | "contextual_question"
      | "review_case"
      | "action_review";
    sourceRevision: string;
    createdAt: Date;
  },
) {
  const [inserted] = await tx
    .insert(nativePushEvents)
    .values({ ...input, sourceType: input.sourceType ?? "conversation_message" })
    .onConflictDoNothing()
    .returning();
  if (!inserted) return;
  const devices = await tx
    .select()
    .from(nativePushDevices)
    .innerJoin(sessions, eq(sessions.id, nativePushDevices.sessionId))
    .where(
      and(
        eq(nativePushDevices.userId, input.userId),
        eq(sessions.userId, input.userId),
        eq(nativePushDevices.financeEnabled, true),
        gt(sessions.expiresAt, input.createdAt),
        lte(nativePushDevices.enrolledAt, input.createdAt),
      ),
    );
  if (devices.length)
    await tx
      .insert(nativePushDeliveries)
      .values(
        devices.map(({ native_push_devices: device }) => ({
          eventId: inserted.id,
          deviceId: device.id,
          audience: device.audience,
          deviceRevision: device.revision,
          nextAttemptAt: input.createdAt,
        })),
      )
      .onConflictDoNothing();
}

function humanSession(principal: Principal): string {
  if (principal.actorType !== "user" || !principal.sessionId)
    throw new AppError("forbidden", "A current human session is required.");
  return principal.sessionId;
}

export function createNativePushService(options: {
  db: Database;
  encryptionKey: string;
  config: ApnsConfig;
  transport: NativePushTransport;
  now?: () => Date;
}) {
  const { db } = options;
  const now = options.now ?? (() => new Date());
  async function lockSession(tx: Transaction, principal: Principal) {
    const [session] = await tx
      .select()
      .from(sessions)
      .where(
        and(
          eq(sessions.id, humanSession(principal)),
          eq(sessions.userId, principal.userId),
          gt(sessions.expiresAt, now()),
        ),
      )
      .for("update");
    if (!session) throw new AppError("unauthorized", "The session has expired or been revoked.");
    return session;
  }
  async function sourceCurrent(tx: Store, event: typeof nativePushEvents.$inferSelect) {
    if (event.kind === "reply" && event.sourceType === "conversation_message") {
      const [message] = await tx
        .select({ id: financeConversationMessages.id })
        .from(financeConversationMessages)
        .where(
          and(
            eq(financeConversationMessages.id, event.sourceId),
            eq(financeConversationMessages.userId, event.userId),
            eq(financeConversationMessages.authorKind, "agent"),
          ),
        );
      return !!message;
    }
    const result = await tx.execute<{ current: boolean }>(sql`SELECT EXISTS(
      SELECT 1 FROM workspace_maintenance_runs WHERE ${event.sourceType}='maintenance_run' AND id=${event.sourceId}::uuid AND user_id=${event.userId}::uuid AND domain='finances' AND status=${event.sourceRevision}
      UNION ALL SELECT 1 FROM finance_contextual_questions WHERE ${event.sourceType}='contextual_question' AND id=${event.sourceId}::uuid AND user_id=${event.userId}::uuid AND state='open' AND action_revision::text=${event.sourceRevision}
      UNION ALL SELECT 1 FROM finance_agent_action_reviews WHERE ${event.sourceType}='action_review' AND id=${event.sourceId}::uuid AND user_id=${event.userId}::uuid AND status='pending' AND floor(extract(epoch FROM updated_at)*1000)::bigint::text=${event.sourceRevision}
      UNION ALL SELECT 1 FROM finance_review_cases WHERE ${event.sourceType}='review_case' AND id=${event.sourceId}::uuid AND user_id=${event.userId}::uuid AND status='open' AND human_action->>'state'='open' AND human_action->'request'->'work'->>'actionRevision'=${event.sourceRevision}
    ) AS current`);
    return result.rows[0]?.current === true;
  }
  return {
    async register(
      principal: Principal,
      raw: NativePushDeviceInput,
    ): Promise<NativePushDeviceRegistration> {
      const input = nativePushDeviceInputSchema.parse(raw);
      humanSession(principal);
      if (!options.config.enabled)
        throw new AppError("service_unavailable", "Native notifications are not available yet.");
      if (input.environment !== options.config.environment)
        throw new AppError("invalid_request", "This build's push environment is unavailable.");
      return db.transaction(async (tx) => {
        await lockSession(tx, principal);
        const fingerprint = hashToken(input.token.toLowerCase());
        for (const key of [input.installationId, fingerprint].sort())
          await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 771))`);
        const [old] = await tx
          .select()
          .from(nativePushDevices)
          .where(eq(nativePushDevices.installationId, input.installationId))
          .for("update");
        await tx
          .delete(nativePushDevices)
          .where(
            and(
              eq(nativePushDevices.tokenFingerprint, fingerprint),
              sql`${nativePushDevices.installationId} <> ${input.installationId}::uuid`,
            ),
          );
        const same =
          !!old &&
          old.sessionId === principal.sessionId &&
          old.tokenFingerprint === fingerprint &&
          old.financeEnabled === input.financeEnabled &&
          old.environment === input.environment;
        const values = {
          userId: principal.userId,
          sessionId: principal.sessionId as string,
          encryptedToken: encryptJson({ token: input.token.toLowerCase() }, options.encryptionKey),
          tokenFingerprint: fingerprint,
          environment: input.environment,
          financeEnabled: input.financeEnabled,
          revision: same ? old.revision : (old?.revision ?? 0) + 1,
          audience: same ? old.audience : randomUUID(),
          enrolledAt: same ? old.enrolledAt : now(),
          updatedAt: now(),
        };
        const [device] = await tx
          .insert(nativePushDevices)
          .values({ installationId: input.installationId, ...values })
          .onConflictDoUpdate({ target: nativePushDevices.installationId, set: values })
          .returning();
        if (!device) throw new AppError("internal_error", "The device could not be registered.");
        return {
          installationId: device.installationId,
          financeEnabled: device.financeEnabled,
          revision: device.revision,
          audience: device.audience,
          status: device.financeEnabled ? "registered" : "disabled",
        };
      });
    },
    async disable(principal: Principal, installationId: string) {
      return db.transaction(async (tx) => {
        await lockSession(tx, principal);
        await tx
          .update(nativePushDevices)
          .set({
            financeEnabled: false,
            audience: randomUUID(),
            revision: sql`${nativePushDevices.revision}+1`,
            updatedAt: now(),
          })
          .where(
            and(
              eq(nativePushDevices.installationId, installationId),
              eq(nativePushDevices.userId, principal.userId),
              eq(nativePushDevices.sessionId, humanSession(principal)),
            ),
          );
        return { disabled: true as const };
      });
    },
    async resolve(
      principal: Principal,
      eventId: string,
      installationId: string,
    ): Promise<NativePushEventDestination> {
      return db.transaction(async (tx) => {
        await lockSession(tx, principal);
        const [row] = await tx
          .select({
            event: nativePushEvents,
            device: nativePushDevices,
            delivery: nativePushDeliveries,
          })
          .from(nativePushDeliveries)
          .innerJoin(nativePushEvents, eq(nativePushEvents.id, nativePushDeliveries.eventId))
          .innerJoin(nativePushDevices, eq(nativePushDevices.id, nativePushDeliveries.deviceId))
          .where(
            and(
              eq(nativePushEvents.id, eventId),
              eq(nativePushEvents.userId, principal.userId),
              eq(nativePushDevices.userId, principal.userId),
              eq(nativePushDevices.sessionId, humanSession(principal)),
              eq(nativePushDevices.installationId, installationId),
              eq(nativePushDevices.financeEnabled, true),
              eq(nativePushDevices.audience, nativePushDeliveries.audience),
              eq(nativePushDevices.revision, nativePushDeliveries.deviceRevision),
              inArray(nativePushDeliveries.state, ["accepted", "uncertain", "submitting"]),
            ),
          );
        if (
          !row ||
          row.event.createdAt.getTime() < now().getTime() - 86_400_000 ||
          !(await sourceCurrent(tx, row.event))
        )
          throw new AppError("not_found", "This notification is no longer available.");
        return {
          audience: row.device.audience,
          destination:
            row.event.kind === "reply"
              ? "finance_chat"
              : row.event.kind === "attention"
                ? "finance_attention"
                : "finance_activity",
        };
      });
    },
    async dispatch(shouldContinue: () => boolean = () => true) {
      if (!options.config.enabled || !shouldContinue()) return;
      // A stale submitting lease can have crossed APNs's acceptance point. Never replay it.
      await db
        .update(nativePushDeliveries)
        .set({ state: "uncertain", outcomeCode: "submission_interrupted", updatedAt: now() })
        .where(
          and(
            eq(nativePushDeliveries.state, "submitting"),
            lte(nativePushDeliveries.leaseUntil, now()),
          ),
        );
      const due = await db
        .select({ id: nativePushDeliveries.id })
        .from(nativePushDeliveries)
        .where(
          and(
            eq(nativePushDeliveries.state, "pending"),
            lte(nativePushDeliveries.nextAttemptAt, now()),
          ),
        )
        .orderBy(asc(nativePushDeliveries.nextAttemptAt), asc(nativePushDeliveries.id))
        .limit(25);
      for (const item of due) {
        if (!shouldContinue()) break;
        const [claimed] = await db
          .update(nativePushDeliveries)
          .set({
            state: "submitting",
            leaseUntil: new Date(now().getTime() + 60_000),
            attempts: sql`${nativePushDeliveries.attempts}+1`,
            updatedAt: now(),
          })
          .where(
            and(eq(nativePushDeliveries.id, item.id), eq(nativePushDeliveries.state, "pending")),
          )
          .returning();
        if (!claimed) continue;
        await db.transaction(async (tx) => {
          const [snapshot] = await tx
            .select({ sessionId: nativePushDevices.sessionId })
            .from(nativePushDevices)
            .where(eq(nativePushDevices.id, claimed.deviceId));
          if (snapshot)
            await tx
              .select({ id: sessions.id })
              .from(sessions)
              .where(eq(sessions.id, snapshot.sessionId))
              .for("update");
          const [row] = await tx
            .select({
              event: nativePushEvents,
              device: nativePushDevices,
              session: sessions,
              user: users,
            })
            .from(nativePushDevices)
            .innerJoin(nativePushEvents, eq(nativePushEvents.id, claimed.eventId))
            .innerJoin(sessions, eq(sessions.id, nativePushDevices.sessionId))
            .innerJoin(users, eq(users.id, nativePushDevices.userId))
            .where(
              and(
                eq(nativePushDevices.id, claimed.deviceId),
                eq(
                  nativePushDevices.sessionId,
                  snapshot?.sessionId ?? "00000000-0000-0000-0000-000000000000",
                ),
              ),
            )
            .for("update", { of: [nativePushDevices] });
          const finish = (
            state: "suppressed" | "pending" | "accepted" | "uncertain" | "failed",
            outcomeCode: string,
          ) =>
            tx
              .update(nativePushDeliveries)
              .set({
                state,
                outcomeCode,
                leaseUntil: null,
                nextAttemptAt: new Date(now().getTime() + 60_000),
                updatedAt: now(),
              })
              .where(
                and(
                  eq(nativePushDeliveries.id, claimed.id),
                  eq(nativePushDeliveries.state, "submitting"),
                ),
              );
          if (
            !row ||
            row.event.createdAt.getTime() < now().getTime() - 86_400_000 ||
            !shouldContinue() ||
            !row.device.financeEnabled ||
            row.device.userId !== row.event.userId ||
            row.session.userId !== row.event.userId ||
            row.session.expiresAt <= now() ||
            row.device.revision !== claimed.deviceRevision ||
            row.device.audience !== claimed.audience ||
            row.device.environment !== options.config.environment ||
            !(await sourceCurrent(tx, row.event))
          ) {
            await finish("suppressed", "authority_or_source_changed");
            return;
          }
          const prefs = await tx
            .select()
            .from(notificationPreferences)
            .where(
              and(
                eq(notificationPreferences.userId, row.event.userId),
                inArray(notificationPreferences.scope, ["global", "finances"]),
              ),
            );
          const preferences =
            prefs.find((p) => p.scope === "finances")?.preferences ??
            prefs.find((p) => p.scope === "global")?.preferences ??
            defaultNotificationPreferences;
          if (!preferences.enabled) {
            await finish("suppressed", "preferences_disabled");
            return;
          }
          let minute: number;
          try {
            const parts = new Intl.DateTimeFormat("en-GB", {
              timeZone: row.user.planningTimezone,
              hour: "2-digit",
              minute: "2-digit",
              hourCycle: "h23",
            }).formatToParts(now());
            minute =
              Number(parts.find((p) => p.type === "hour")?.value) * 60 +
              Number(parts.find((p) => p.type === "minute")?.value);
          } catch {
            await tx
              .update(nativePushDeliveries)
              .set({ attempts: claimed.attempts - 1 })
              .where(eq(nativePushDeliveries.id, claimed.id));
            await finish("pending", "timezone_unavailable");
            return;
          }
          const start = preferences.quietStartMinute,
            end = preferences.quietEndMinute;
          if (
            preferences.quietMode === "window" &&
            (start < end ? minute >= start && minute < end : minute >= start || minute < end)
          ) {
            await tx
              .update(nativePushDeliveries)
              .set({ attempts: claimed.attempts - 1 })
              .where(eq(nativePushDeliveries.id, claimed.id));
            await finish("pending", "quiet_hours");
            return;
          }
          let result: Awaited<ReturnType<NativePushTransport>>;
          try {
            const { token } = decryptJson<{ token: string }>(
              row.device.encryptedToken,
              options.encryptionKey,
            );
            result = await options.transport({
              token,
              id: claimed.id,
              payload: {
                aps: {
                  alert: { title: "nohmi", body: "You have a Finance update." },
                  sound: "default",
                },
                version: 1,
                kind: "finance",
                eventId: row.event.id,
                audience: row.device.audience,
              },
            });
          } catch {
            result = "uncertain";
          }
          if (result === "invalid_token")
            await tx
              .update(nativePushDevices)
              .set({
                financeEnabled: false,
                revision: sql`${nativePushDevices.revision}+1`,
                audience: randomUUID(),
                updatedAt: now(),
              })
              .where(eq(nativePushDevices.id, row.device.id));
          await finish(
            result === "accepted"
              ? "accepted"
              : result === "uncertain"
                ? "uncertain"
                : result === "retryable" && claimed.attempts < 3
                  ? "pending"
                  : "failed",
            result,
          );
        });
      }
    },
  };
}
