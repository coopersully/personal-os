import { fireClaudeRoutine } from "@personal-os/connectors";
import {
  type Database,
  textInboundClaims,
  textingAgentQueue,
  textingAgentRuns,
} from "@personal-os/database";
import { and, asc, count, eq, gt, inArray, isNull, lte } from "drizzle-orm";
import { decryptJson } from "./security.js";
import {
  lockTextingOwner,
  textingAgentAuthority,
  textingHostBindingFingerprint,
} from "./texting-agent-authority.js";

/** A durable submitting commit precedes transport. No uncertain request is automatically repeated. */
export function createTextingAgentDispatcher(options: {
  db: Database;
  enabled: () => boolean;
  now: () => Date;
  encryptionKey: string;
  fetch: typeof globalThis.fetch;
}) {
  const { db, now } = options;
  let cursor: string | null = null;
  return async (shouldContinue: () => boolean = () => true) => {
    if (!options.enabled() || !shouldContinue()) return;
    const scan = (after: string | null) =>
      db
        .selectDistinct({ userId: textingAgentQueue.userId })
        .from(textingAgentQueue)
        .where(
          and(
            isNull(textingAgentQueue.runId),
            isNull(textingAgentQueue.cancelledAt),
            lte(textingAgentQueue.availableAt, now()),
            after ? gt(textingAgentQueue.userId, after) : undefined,
          ),
        )
        .orderBy(asc(textingAgentQueue.userId))
        .limit(25);
    let owners = await scan(cursor);
    if (!owners.length && cursor) owners = await scan(null);
    for (const { userId } of owners) {
      if (!shouldContinue() || !options.enabled()) break;
      cursor = userId;
      const run = await db.transaction(async (tx) => {
        await lockTextingOwner(tx, userId);
        const authority = await textingAgentAuthority(tx, userId, now(), options.enabled());
        if (authority.readiness !== "ready" || !authority.schedule || !authority.connection)
          return null;
        const [active] = await tx
          .select()
          .from(textingAgentRuns)
          .where(
            and(
              eq(textingAgentRuns.userId, userId),
              inArray(textingAgentRuns.state, ["submitting", "started", "running", "uncertain"]),
            ),
          )
          .limit(1);
        if (active) {
          if (
            active.consentEpoch === authority.connection.consentEpoch &&
            active.connectionId === authority.connection.id &&
            active.scheduleId === authority.schedule.id &&
            active.authorizationConnectionId === authority.schedule.authorizationConnectionId &&
            active.hostBindingFingerprint === textingHostBindingFingerprint(authority.schedule)
          )
            return null;
          await tx
            .update(textingAgentRuns)
            .set({ state: "blocked", reason: "authority_changed", updatedAt: now() })
            .where(eq(textingAgentRuns.id, active.id));
        }
        const [recent] = await tx
          .select({ value: count() })
          .from(textingAgentRuns)
          .where(
            and(
              eq(textingAgentRuns.userId, userId),
              gt(textingAgentRuns.createdAt, new Date(now().getTime() - 3_600_000)),
            ),
          );
        if ((recent?.value ?? 0) >= 25) return null;
        // The exact epoch-bound membership is frozen before the host can see the run.
        const pending = await tx
          .select({ claimId: textingAgentQueue.claimId, messageId: textInboundClaims.messageId })
          .from(textingAgentQueue)
          .innerJoin(
            textInboundClaims,
            and(
              eq(textInboundClaims.id, textingAgentQueue.claimId),
              eq(textInboundClaims.userId, userId),
            ),
          )
          .where(
            and(
              eq(textingAgentQueue.userId, userId),
              isNull(textingAgentQueue.runId),
              isNull(textingAgentQueue.cancelledAt),
              lte(textingAgentQueue.availableAt, now()),
              eq(textInboundClaims.connectionId, authority.connection.id),
              eq(textInboundClaims.consentEpoch, authority.connection.consentEpoch),
            ),
          )
          .orderBy(asc(textingAgentQueue.createdAt), asc(textingAgentQueue.claimId))
          .limit(25);
        if (!pending.length) return null;
        const [created] = await tx
          .insert(textingAgentRuns)
          .values({
            userId,
            connectionId: authority.connection.id,
            consentEpoch: authority.connection.consentEpoch,
            scheduleId: authority.schedule.id,
            authorizationConnectionId: authority.schedule.authorizationConnectionId,
            hostBindingFingerprint: textingHostBindingFingerprint(authority.schedule),
            inputMessageIds: pending.map((entry) => entry.messageId),
            state: "submitting",
            createdAt: now(),
            updatedAt: now(),
          })
          .returning();
        if (!created) return null;
        await tx
          .update(textingAgentQueue)
          .set({ runId: created.id })
          .where(
            and(
              eq(textingAgentQueue.userId, userId),
              inArray(
                textingAgentQueue.claimId,
                pending.map((p) => p.claimId),
              ),
              isNull(textingAgentQueue.runId),
            ),
          );
        return created;
      });
      if (!run) continue;
      await db.transaction(async (tx) => {
        await lockTextingOwner(tx, userId);
        const authority = await textingAgentAuthority(tx, userId, now(), options.enabled());
        const [current] = await tx
          .select()
          .from(textingAgentRuns)
          .where(and(eq(textingAgentRuns.userId, userId), eq(textingAgentRuns.id, run.id)))
          .for("update");
        if (current?.state !== "submitting") return;
        if (!shouldContinue()) {
          await tx
            .update(textingAgentRuns)
            .set({ state: "blocked", reason: "shutdown_deferred", updatedAt: now() })
            .where(eq(textingAgentRuns.id, run.id));
          await tx
            .update(textingAgentQueue)
            .set({ runId: null, availableAt: new Date(now().getTime() + 5000) })
            .where(and(eq(textingAgentQueue.userId, userId), eq(textingAgentQueue.runId, run.id)));
          return;
        }
        if (
          authority.readiness !== "ready" ||
          authority.settings?.scheduleId !== run.scheduleId ||
          authority.connection?.id !== run.connectionId ||
          authority.connection.consentEpoch !== run.consentEpoch ||
          authority.schedule?.authorizationConnectionId !== run.authorizationConnectionId ||
          textingHostBindingFingerprint(authority.schedule) !== run.hostBindingFingerprint ||
          !authority.schedule.encryptedFireCredentials ||
          !authority.schedule.schedule.hostAutomationId
        ) {
          await tx
            .update(textingAgentRuns)
            .set({ state: "blocked", reason: "authority_changed", updatedAt: now() })
            .where(eq(textingAgentRuns.id, run.id));
          return;
        }
        let result: Awaited<ReturnType<typeof fireClaudeRoutine>>;
        try {
          const credentials = decryptJson<{ token: string }>(
            authority.schedule.encryptedFireCredentials,
            options.encryptionKey,
          );
          result = await fireClaudeRoutine(options.fetch, {
            routineId: authority.schedule.schedule.hostAutomationId,
            token: credentials.token,
            runId: run.id,
          });
        } catch {
          result = { state: "uncertain", reason: "host_uncertain", hostSessionId: null };
        }
        await tx
          .update(textingAgentRuns)
          .set({ ...result, updatedAt: now() })
          .where(and(eq(textingAgentRuns.id, run.id), eq(textingAgentRuns.state, "submitting")));
        if (result.reason === "rate_limited") {
          await tx
            .update(textingAgentQueue)
            .set({ runId: null, availableAt: new Date(now().getTime() + 3_600_000) })
            .where(and(eq(textingAgentQueue.userId, userId), eq(textingAgentQueue.runId, run.id)));
        }
      });
    }
  };
}
