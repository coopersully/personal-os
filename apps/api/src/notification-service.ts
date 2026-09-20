import {
  auditEvents,
  type Database,
  notificationAttemptItems,
  notificationDeliveryAttempts,
  notificationIntents,
  notificationPreferences,
  textingConnections,
  textMessages,
  users,
} from "@personal-os/database";
import {
  composeNotification,
  defaultNotificationPreferences,
  type FinanceHumanWorkRef,
  type NotificationAttemptHistory,
  type NotificationPreferences,
  type NotificationStatus,
  type NotificationWork,
  notificationEligibility,
  notificationPreferencesSchema,
  publishNotificationInputSchema,
  validateNotificationResolution,
} from "@personal-os/domain";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { AppError } from "./errors.js";
import type {
  NotificationTransaction,
  NotificationWorkResolver,
} from "./notification-work-resolver.js";
import type { createTextingService } from "./texting-service.js";
import type { Principal } from "./types.js";

const unavailable = { state: "unavailable", reason: "producer_not_registered" } as const;
const leaseMs = 60_000;

type Options = {
  db: Database;
  origin: string;
  transport: Pick<ReturnType<typeof createTextingService>, "sendNotification">;
  resolveWork?: NotificationWorkResolver;
  now?: () => Date;
};

/** Notification persistence owns delivery truth only. Domain status and disclosure are resolved
 * under domain locks; no domain business operation is performed here. */
export function createNotificationService(options: Options) {
  const url = new URL(options.origin);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  )
    throw new AppError(
      "invalid_request",
      "Notification origin must be an HTTP(S) origin without credentials, query, or fragment.",
    );
  const origin = url.origin;
  const now = options.now ?? (() => new Date());
  function authorize(principal: Principal, write = true) {
    if (
      !principal.scopes.has("texting:read") ||
      (write && !principal.scopes.has("texting:write")) ||
      !principal.scopes.has("finances:read")
    )
      throw new AppError("forbidden", "Notification access requires Texting and Finance access.");
  }
  async function lockUser(tx: NotificationTransaction, userId: string) {
    const [user] = await tx.select().from(users).where(eq(users.id, userId)).for("no key update");
    if (!user) throw new AppError("not_found", "Account not found.");
    return user;
  }
  async function preferences(tx: NotificationTransaction, userId: string) {
    const rows = await tx
      .select()
      .from(notificationPreferences)
      .where(eq(notificationPreferences.userId, userId));
    const global =
      rows.find((r) => r.scope === "global")?.preferences ?? defaultNotificationPreferences;
    const override = rows.find((r) => r.scope === "finances")?.preferences;
    const effective = notificationPreferencesSchema.parse(override ?? global);
    // The global disclosure ceiling cannot be widened by a workspace override.
    if (global.detail === "minimal") effective.detail = "minimal";
    return { rows, effective };
  }
  async function savePreferences(
    principal: Principal,
    scope: "global" | "finances",
    input: {
      expectedRevision: number | null;
      preferences: NotificationPreferences;
    },
  ) {
    authorize(principal);
    if (principal.actorType !== "user")
      throw new AppError("forbidden", "Only the person can change notification preferences.");
    const value = notificationPreferencesSchema.parse(input.preferences);
    return options.db.transaction(async (tx) => {
      await lockUser(tx, principal.userId);
      const [previous] = await tx
        .select()
        .from(notificationPreferences)
        .where(
          and(
            eq(notificationPreferences.userId, principal.userId),
            eq(notificationPreferences.scope, scope),
          ),
        );
      if ((previous?.revision ?? null) !== input.expectedRevision)
        throw new AppError("conflict", "Notification preferences changed. Reload before saving.");
      const revision = (previous?.revision ?? 0) + 1;
      await tx
        .insert(notificationPreferences)
        .values({ userId: principal.userId, scope, revision, preferences: value })
        .onConflictDoUpdate({
          target: [notificationPreferences.userId, notificationPreferences.scope],
          set: { revision, preferences: value, updatedAt: now() },
        });
      await tx.insert(auditEvents).values({
        userId: principal.userId,
        actorId: principal.actorId,
        actorType: principal.actorType,
        requestId: crypto.randomUUID(),
        action: "notifications.preferences.updated",
        entityType: "notification_preferences",
        entityId: principal.userId,
        before: previous
          ? { scope, revision: previous.revision, preferences: previous.preferences }
          : null,
        after: { scope, revision, preferences: value },
      });
      return { scope, revision, preferences: value };
    });
  }
  async function resolve(tx: NotificationTransaction, userId: string, ref: FinanceHumanWorkRef) {
    if (!options.resolveWork) return { state: "unavailable" } as const;
    return validateNotificationResolution(ref, await options.resolveWork(userId, ref, tx));
  }
  async function publish(principal: Principal, input: { work: FinanceHumanWorkRef[] }) {
    authorize(principal);
    const refs = publishNotificationInputSchema.parse(input).work;
    if (!options.resolveWork) return unavailable;
    if (new Set(refs.map((r) => r.id)).size !== refs.length)
      throw new AppError("invalid_request", "Each work item may appear once.");
    return options.db.transaction(async (tx) => {
      await lockUser(tx, principal.userId);
      const ids: string[] = [];
      for (const ref of [...refs].sort((a, b) => a.id.localeCompare(b.id))) {
        const result = await resolve(tx, principal.userId, ref);
        if (result.state !== "current")
          throw new AppError("conflict", "Current notification evidence is unavailable.");
      }
      for (const ref of [...refs].sort((a, b) => a.id.localeCompare(b.id))) {
        const [intent] = await tx
          .insert(notificationIntents)
          .values({
            userId: principal.userId,
            domain: ref.domain,
            workId: ref.id,
            work: ref,
            state: "pending",
          })
          .onConflictDoUpdate({
            target: [
              notificationIntents.userId,
              notificationIntents.domain,
              notificationIntents.workId,
            ],
            set: { work: ref, state: "pending", reason: null, updatedAt: now() },
          })
          .returning();
        if (intent) ids.push(intent.id);
      }
      return { state: "accepted", intentIds: ids } as const;
    });
  }
  async function reconcile(tx: NotificationTransaction, userId: string) {
    const targetState = sql<"failed" | "accepted" | "uncertain" | "submitting">`CASE
      WHEN ${textMessages.status} IN ('failed','undelivered') THEN 'failed'
      WHEN ${textMessages.status} = 'unknown' THEN 'uncertain'
      WHEN ${textMessages.providerMessageSid} IS NOT NULL THEN 'accepted'
      WHEN ${notificationDeliveryAttempts.leaseUntil} <= ${now()} THEN 'uncertain'
      ELSE 'submitting' END`;
    const changed = await tx
      .select({ attempt: notificationDeliveryAttempts, targetState })
      .from(notificationDeliveryAttempts)
      .innerJoin(
        textMessages,
        and(
          eq(textMessages.userId, notificationDeliveryAttempts.userId),
          eq(textMessages.id, notificationDeliveryAttempts.messageId),
        ),
      )
      .where(
        and(
          eq(notificationDeliveryAttempts.userId, userId),
          inArray(notificationDeliveryAttempts.state, ["submitting", "uncertain", "accepted"]),
          sql`${targetState} <> ${notificationDeliveryAttempts.state}`,
        ),
      )
      .orderBy(asc(notificationDeliveryAttempts.createdAt))
      .limit(100);
    for (const { attempt, targetState: state } of changed) {
      await tx
        .update(notificationDeliveryAttempts)
        .set({
          state,
          reason:
            state === "failed"
              ? "provider_rejected"
              : state === "accepted"
                ? null
                : "delivery_uncertain",
          updatedAt: now(),
        })
        .where(
          and(
            eq(notificationDeliveryAttempts.userId, userId),
            eq(notificationDeliveryAttempts.id, attempt.id),
          ),
        );
    }
  }
  async function history(
    tx: NotificationTransaction,
    userId: string,
    intentId: string,
    actionRevision: string,
  ): Promise<NotificationAttemptHistory[]> {
    const read = () =>
      tx
        .select({ attempt: notificationDeliveryAttempts, item: notificationAttemptItems })
        .from(notificationAttemptItems)
        .innerJoin(
          notificationDeliveryAttempts,
          and(
            eq(notificationAttemptItems.userId, notificationDeliveryAttempts.userId),
            eq(notificationAttemptItems.attemptId, notificationDeliveryAttempts.id),
          ),
        );
    const owned = and(
      eq(notificationAttemptItems.userId, userId),
      eq(notificationAttemptItems.intentId, intentId),
    );
    const uncertain = await read()
      .where(and(owned, inArray(notificationDeliveryAttempts.state, ["submitting", "uncertain"])))
      .limit(1);
    const rows = uncertain.length
      ? uncertain
      : await read()
          .where(
            and(
              owned,
              inArray(notificationDeliveryAttempts.state, ["accepted", "failed"]),
              sql`${notificationAttemptItems.work}->>'actionRevision' = ${actionRevision}`,
            ),
          )
          .orderBy(desc(notificationDeliveryAttempts.submittedAt))
          .limit(1);
    return rows.flatMap(({ attempt, item }) =>
      attempt.submittedAt && attempt.state !== "claimed" && attempt.state !== "suppressed"
        ? [
            {
              actionRevision: item.work.actionRevision,
              state: attempt.state,
              submittedAt: attempt.submittedAt,
            },
          ]
        : [],
    );
  }
  async function claim(principal: Principal) {
    authorize(principal);
    if (!options.resolveWork) return unavailable;
    await options.db.transaction(async (tx) => {
      await lockUser(tx, principal.userId);
      await reconcile(tx, principal.userId);
    });
    return options.db.transaction(async (tx) => {
      const user = await lockUser(tx, principal.userId);
      const [existing] = await tx
        .select()
        .from(notificationDeliveryAttempts)
        .where(
          and(
            eq(notificationDeliveryAttempts.userId, user.id),
            eq(notificationDeliveryAttempts.state, "claimed"),
          ),
        )
        .orderBy(asc(notificationDeliveryAttempts.createdAt))
        .limit(1);
      if (existing) {
        if (existing.leaseUntil > now())
          return { state: "pending", reason: "claim_active" } as const;
        const claimId = crypto.randomUUID();
        await tx
          .update(notificationDeliveryAttempts)
          .set({
            claimId,
            generation: existing.generation + 1,
            leaseUntil: new Date(now().getTime() + leaseMs),
            updatedAt: now(),
          })
          .where(eq(notificationDeliveryAttempts.id, existing.id));
        return { state: "claimed", id: existing.id, claimId } as const;
      }
      const [connection] = await tx
        .select()
        .from(textingConnections)
        .where(eq(textingConnections.userId, user.id));
      if (connection?.state !== "active")
        return { state: "pending", reason: "consent_unavailable" } as const;
      const { effective } = await preferences(tx, user.id);
      const intents = await tx
        .select()
        .from(notificationIntents)
        .where(
          and(
            eq(notificationIntents.userId, user.id),
            inArray(notificationIntents.state, ["pending", "deferred", "blocked"]),
          ),
        )
        .orderBy(asc(notificationIntents.updatedAt), asc(notificationIntents.workId))
        .limit(100);
      const eligible: typeof intents = [];
      const decisions: { intent: (typeof intents)[number]; reason: string }[] = [];
      for (const intent of intents.sort((a, b) => a.workId.localeCompare(b.workId))) {
        const result = await resolve(tx, user.id, intent.work);
        const reason =
          result.state !== "current"
            ? result.state
            : notificationEligibility({
                work: result.value,
                preferences: effective,
                timeZone: user.planningTimezone,
                now: now(),
                attempts: await history(tx, user.id, intent.id, intent.work.actionRevision),
              });
        decisions.push({ intent, reason });
        if (reason === "eligible") eligible.push(intent);
      }
      for (const { intent, reason } of decisions) {
        await tx
          .update(notificationIntents)
          .set({
            state:
              reason === "eligible"
                ? "pending"
                : ["resolved", "expired"].includes(reason)
                  ? "resolved"
                  : "deferred",
            reason: reason === "eligible" ? null : reason,
            updatedAt: now(),
          })
          .where(
            and(eq(notificationIntents.userId, user.id), eq(notificationIntents.id, intent.id)),
          );
      }
      if (!eligible.length) return { state: "pending", reason: "no_eligible_work" } as const;
      const claimId = crypto.randomUUID();
      const [attempt] = await tx
        .insert(notificationDeliveryAttempts)
        .values({
          userId: user.id,
          state: "claimed",
          connectionId: connection.id,
          consentEpoch: connection.consentEpoch,
          claimId,
          leaseUntil: new Date(now().getTime() + leaseMs),
        })
        .returning();
      if (!attempt) throw new AppError("internal_error", "Could not claim notifications.");
      await tx.insert(notificationAttemptItems).values(
        eligible.map((intent) => ({
          userId: user.id,
          attemptId: attempt.id,
          intentId: intent.id,
          work: intent.work,
        })),
      );
      return { state: "claimed", id: attempt.id, claimId } as const;
    });
  }
  async function deliver(principal: Principal, claim: { id: string; claimId: string }) {
    authorize(principal);
    if (!options.resolveWork) return unavailable;
    // No transaction or domain lock crosses the provider call. A committed submitting attempt
    // is never retried; status reconciliation preserves uncertainty after process loss.
    try {
      await options.transport.sendNotification(principal.userId, async (tx, connection) => {
        const user = await lockUser(tx, principal.userId);
        const [attempt] = await tx
          .select()
          .from(notificationDeliveryAttempts)
          .where(
            and(
              eq(notificationDeliveryAttempts.userId, user.id),
              eq(notificationDeliveryAttempts.id, claim.id),
            ),
          );
        if (
          attempt?.state !== "claimed" ||
          attempt.claimId !== claim.claimId ||
          attempt.leaseUntil <= now()
        )
          throw new AppError("conflict", "Notification claim is stale.");
        if (
          attempt.connectionId !== connection.id ||
          attempt.consentEpoch !== connection.consentEpoch
        ) {
          await tx
            .update(notificationDeliveryAttempts)
            .set({ state: "suppressed", reason: "consent_changed", updatedAt: now() })
            .where(eq(notificationDeliveryAttempts.id, attempt.id));
          return null;
        }
        const { effective } = await preferences(tx, user.id);
        const items = await tx
          .select()
          .from(notificationAttemptItems)
          .where(
            and(
              eq(notificationAttemptItems.userId, user.id),
              eq(notificationAttemptItems.attemptId, claim.id),
            ),
          );
        const works: NotificationWork[] = [];
        for (const item of items.sort((a, b) => a.work.id.localeCompare(b.work.id))) {
          const result = await resolve(tx, user.id, item.work);
          const reason =
            result.state !== "current"
              ? result.state
              : notificationEligibility({
                  work: result.value,
                  preferences: effective,
                  timeZone: user.planningTimezone,
                  now: now(),
                  attempts: await history(tx, user.id, item.intentId, item.work.actionRevision),
                });
          // Membership is immutable. If any item no longer qualifies, suppress this unsent batch;
          // a subsequent claim recomputes the eligible set without falsely marking omitted items sent.
          if (reason !== "eligible" || result.state !== "current") {
            await tx
              .update(notificationDeliveryAttempts)
              .set({ state: "suppressed", reason, updatedAt: now() })
              .where(eq(notificationDeliveryAttempts.id, attempt.id));
            return null;
          }
          works.push(result.value);
        }
        const [currentAttempt] = await tx
          .select()
          .from(notificationDeliveryAttempts)
          .where(
            and(
              eq(notificationDeliveryAttempts.userId, user.id),
              eq(notificationDeliveryAttempts.id, claim.id),
            ),
          )
          .for("update");
        if (
          currentAttempt?.state !== "claimed" ||
          currentAttempt.claimId !== claim.claimId ||
          currentAttempt.leaseUntil <= now()
        )
          throw new AppError("conflict", "Notification claim is stale.");
        if (works.some((work) => work.expiresAt && new Date(work.expiresAt) <= now())) {
          await tx
            .update(notificationDeliveryAttempts)
            .set({ state: "suppressed", reason: "expired", updatedAt: now() })
            .where(eq(notificationDeliveryAttempts.id, attempt.id));
          return null;
        }
        let body = composeNotification({
          works,
          now: now(),
          timeZone: user.planningTimezone,
          detail: effective.detail,
          origin,
        });
        // SMS Unicode can multiply segments; fall back to a short review summary, never truncate facts.
        if (body.length > 250 || /[^\x20-\x7E]/u.test(body))
          body = `nohmi: ${works.length} Finance item${works.length === 1 ? "" : "s"} need review. ${origin}/settings?section=reviews`;
        return {
          body,
          queued: async (messageId: string) => {
            await tx
              .update(notificationDeliveryAttempts)
              .set({
                state: "submitting",
                messageId,
                connectionId: connection.id,
                consentEpoch: connection.consentEpoch,
                timeZone: user.planningTimezone,
                timezoneRevision: user.updatedAt,
                submittedAt: now(),
                leaseUntil: new Date(now().getTime() + leaseMs),
                updatedAt: now(),
              })
              .where(
                and(
                  eq(notificationDeliveryAttempts.userId, user.id),
                  eq(notificationDeliveryAttempts.id, attempt.id),
                  eq(notificationDeliveryAttempts.claimId, claim.claimId),
                ),
              );
          },
        };
      });
    } catch (error) {
      // Do not expose provider text. A stale claim remains a caller error; transport failures retain
      // their durable message evidence, while pre-submission failure leaves the lease recoverable.
      if (error instanceof AppError && error.code === "conflict") throw error;
      await options.db.transaction(async (tx) => {
        await lockUser(tx, principal.userId);
        await tx
          .update(notificationDeliveryAttempts)
          .set({ reason: "delivery_blocked", updatedAt: now() })
          .where(
            and(
              eq(notificationDeliveryAttempts.userId, principal.userId),
              eq(notificationDeliveryAttempts.id, claim.id),
              eq(notificationDeliveryAttempts.claimId, claim.claimId),
            ),
          );
      });
    }
    return status(principal);
  }
  async function status(principal: Principal): Promise<NotificationStatus> {
    authorize(principal, false);
    return options.db.transaction(async (tx) => {
      const user = await lockUser(tx, principal.userId);
      await reconcile(tx, user.id);
      const { rows, effective } = await preferences(tx, user.id);
      const attempts = await tx
        .select()
        .from(notificationDeliveryAttempts)
        .where(eq(notificationDeliveryAttempts.userId, user.id))
        .orderBy(desc(notificationDeliveryAttempts.createdAt))
        .limit(20);
      const intents = await tx
        .select()
        .from(notificationIntents)
        .where(eq(notificationIntents.userId, user.id))
        .orderBy(desc(notificationIntents.updatedAt))
        .limit(100);
      return {
        capability: options.resolveWork ? ("available" as const) : ("unavailable" as const),
        reason: options.resolveWork ? null : "producer_not_registered",
        timeZone: user.planningTimezone,
        preferences: rows.map((r) => ({
          scope: r.scope,
          revision: r.revision,
          preferences: r.preferences,
        })),
        effective,
        intents: intents.map((r) => ({ id: r.id, work: r.work, state: r.state, reason: r.reason })),
        attempts: attempts.map((r) => ({
          id: r.id,
          state: r.state,
          reason: r.reason,
          messageId: r.messageId,
          submittedAt: r.submittedAt?.toISOString() ?? null,
          updatedAt: r.updatedAt.toISOString(),
          recovery:
            r.state === "uncertain"
              ? "reconcile_delivery"
              : r.state === "claimed"
                ? "retry_after_lease"
                : "review_in_app",
        })),
      };
    });
  }
  async function drain(principal: Principal) {
    const claimed = await claim(principal);
    return claimed.state === "claimed" ? deliver(principal, claimed) : claimed;
  }
  return { savePreferences, publish, claim, deliver, drain, status };
}
