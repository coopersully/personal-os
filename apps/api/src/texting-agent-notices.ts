import {
  automationHostSchedules,
  type Database,
  textingAgentRuns,
  textingAgentSettings,
  textMessages,
} from "@personal-os/database";
import { and, asc, eq, gt, gte, inArray, isNull, lte, or } from "drizzle-orm";
import { AppError } from "./errors.js";
import { textingHostBindingFingerprint } from "./texting-agent-authority.js";
import type { createTextingService } from "./texting-service.js";

const DELAY_MS = 5 * 60_000;
const COOLDOWN_MS = 15 * 60_000;

type NoticeRun = { state: string; reason: string | null; updatedAt: Date };
export function textingAgentNoticeBody(run: NoticeRun, now: Date): string | null {
  if (run.state === "blocked" && run.reason === "host_rejected")
    return "nohmi couldn't start your agent. Your message is saved. Check your Claude routine in Texting settings before retrying.";
  if (run.state === "blocked" && run.reason === "rate_limited")
    return "Your agent's usage limit was reached. Your message is saved for a later attempt. Check Messages in nohmi for progress.";
  if (
    run.state === "uncertain" ||
    (run.state === "submitting" && now.getTime() - run.updatedAt.getTime() >= DELAY_MS)
  )
    return "nohmi couldn't confirm your agent started. Your message is saved. Check Messages in nohmi before trying again; your agent may still reply.";
  if (
    ["started", "running"].includes(run.state) &&
    now.getTime() - run.updatedAt.getTime() >= DELAY_MS
  )
    return "Your agent hasn't finished replying yet. Your message is saved. Check Messages in nohmi for progress; your agent may still reply.";
  return null;
}

/** Durable per-run notice identity commits before a single provider submission. */
export function createTextingAgentNotices(options: {
  db: Database;
  now: () => Date;
  enabled: () => boolean;
  texting: Pick<ReturnType<typeof createTextingService>, "sendNotification">;
}) {
  let cursor: string | null = null;
  return async (shouldContinue: () => boolean = () => true) => {
    if (!options.enabled() || !shouldContinue()) return;
    const { db, now } = options;
    const scan = (after: string | null) =>
      db
        .select({ id: textingAgentRuns.id, userId: textingAgentRuns.userId })
        .from(textingAgentRuns)
        .where(
          and(
            isNull(textingAgentRuns.failureNoticeMessageId),
            or(
              and(
                eq(textingAgentRuns.state, "blocked"),
                inArray(textingAgentRuns.reason, ["host_rejected", "rate_limited"]),
              ),
              eq(textingAgentRuns.state, "uncertain"),
              and(
                inArray(textingAgentRuns.state, ["submitting", "started", "running"]),
                lte(textingAgentRuns.updatedAt, new Date(now().getTime() - DELAY_MS)),
              ),
            ),
            after ? gt(textingAgentRuns.id, after) : undefined,
          ),
        )
        .orderBy(asc(textingAgentRuns.id))
        .limit(25);
    let candidates = await scan(cursor);
    if (!candidates.length && cursor) candidates = await scan(null);
    let failed = 0;
    for (const candidate of candidates) {
      if (!options.enabled() || !shouldContinue()) break;
      cursor = candidate.id;
      try {
        await options.texting.sendNotification(candidate.userId, async (tx, connection) => {
          if (!options.enabled() || !shouldContinue()) return null;
          const [run] = await tx
            .select()
            .from(textingAgentRuns)
            .where(
              and(
                eq(textingAgentRuns.id, candidate.id),
                eq(textingAgentRuns.userId, candidate.userId),
              ),
            )
            .for("update");
          if (
            !run ||
            run.failureNoticeMessageId ||
            run.connectionId !== connection.id ||
            run.consentEpoch !== connection.consentEpoch
          )
            return null;
          const body = textingAgentNoticeBody(run, now());
          if (!body) return null;
          const [settings] = await tx
            .select()
            .from(textingAgentSettings)
            .where(eq(textingAgentSettings.userId, run.userId));
          const [schedule] = await tx
            .select()
            .from(automationHostSchedules)
            .where(
              and(
                eq(automationHostSchedules.userId, run.userId),
                eq(automationHostSchedules.id, run.scheduleId),
              ),
            );
          if (
            settings?.scheduleId !== run.scheduleId ||
            schedule?.authorizationConnectionId !== run.authorizationConnectionId ||
            settings.updatedAt > run.createdAt ||
            !run.hostBindingFingerprint ||
            textingHostBindingFingerprint(schedule) !== run.hostBindingFingerprint
          )
            return null;
          const [recent] = await tx
            .select({ id: textMessages.id })
            .from(textMessages)
            .innerJoin(
              textingAgentRuns,
              and(
                eq(textingAgentRuns.failureNoticeMessageId, textMessages.id),
                eq(textingAgentRuns.userId, textMessages.userId),
              ),
            )
            .where(
              and(
                eq(textMessages.userId, run.userId),
                gte(textMessages.createdAt, new Date(now().getTime() - COOLDOWN_MS)),
              ),
            )
            .limit(1);
          if (recent) return null;
          const inputs = run.inputMessageIds.length
            ? await tx
                .select({ id: textMessages.id, workspaces: textMessages.workspaces })
                .from(textMessages)
                .where(
                  and(
                    eq(textMessages.userId, run.userId),
                    eq(textMessages.connectionId, run.connectionId),
                    inArray(textMessages.id, run.inputMessageIds),
                  ),
                )
                .limit(25)
            : [];
          return {
            body,
            queued: async (messageId) => {
              await tx
                .update(textMessages)
                .set({
                  senderKind: "system",
                  workspaces: [...new Set(inputs.flatMap((input) => input.workspaces))],
                  replyToMessageIds: inputs.map((input) => input.id),
                  classifiedAt: now(),
                })
                .where(and(eq(textMessages.id, messageId), eq(textMessages.userId, run.userId)));
              await tx
                .update(textingAgentRuns)
                .set({ failureNoticeMessageId: messageId })
                .where(
                  and(eq(textingAgentRuns.id, run.id), eq(textingAgentRuns.userId, run.userId)),
                );
            },
          };
        });
      } catch (error) {
        // Consent/provider availability and quota can change after the scan. No message was
        // reserved in those cases; a later pass rechecks. A reserved uncertain send never repeats.
        if (
          !(
            error instanceof AppError &&
            ["forbidden", "rate_limited", "service_unavailable"].includes(error.code)
          )
        )
          failed += 1;
      }
    }
    if (failed) throw new Error(`Texting handoff notices failed for ${failed} runs.`);
  };
}
