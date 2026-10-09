import {
  type Database,
  financeContextRevisions,
  financeSmsCompletions,
  notificationPreferences,
  textInboundClaims,
  textReplyBindings,
  users,
} from "@personal-os/database";
import {
  defaultNotificationPreferences,
  notificationEligibility,
  notificationPreferencesSchema,
} from "@personal-os/domain";
import { and, asc, eq, exists, gt, inArray, isNull, or } from "drizzle-orm";
import type { createTextingRecoveryService } from "./texting-recovery-service.js";
import type { createTextingService } from "./texting-service.js";

/** Receipt-confirmed acknowledgment, atomically paired with its durable Texting message.
 * A queued or uncertain provider delivery never causes another acknowledgment. */
export function createFinanceSmsAcknowledgementDispatcher(options: {
  db: Database;
  recovery: Pick<ReturnType<typeof createTextingRecoveryService>, "inspectClaim">;
  texting: Pick<ReturnType<typeof createTextingService>, "sendNotification">;
  enabled: () => boolean;
  now: () => Date;
}) {
  let cursor: { userId: string; id: string } | null = null;
  return async (shouldContinue: () => boolean = () => true) => {
    if (!options.enabled() || !shouldContinue()) return;
    const accepted = options.db
      .select({ id: textReplyBindings.id })
      .from(textReplyBindings)
      .where(
        and(
          eq(textReplyBindings.userId, textInboundClaims.userId),
          eq(textReplyBindings.inboundClaimId, textInboundClaims.id),
          inArray(textReplyBindings.state, ["accepted", "blocked"]),
        ),
      );
    const rows = await options.db
      .select({ claim: textInboundClaims, completion: financeSmsCompletions })
      .from(textInboundClaims)
      .leftJoin(
        financeSmsCompletions,
        and(
          eq(financeSmsCompletions.userId, textInboundClaims.userId),
          eq(financeSmsCompletions.claimId, textInboundClaims.id),
        ),
      )
      .where(
        and(
          isNull(financeSmsCompletions.acknowledgementMessageId),
          or(
            exists(accepted),
            inArray(financeSmsCompletions.disposition, [
              "context_captured",
              "clarification_required",
            ]),
          ),
          cursor
            ? or(
                gt(textInboundClaims.userId, cursor.userId),
                and(
                  eq(textInboundClaims.userId, cursor.userId),
                  gt(textInboundClaims.id, cursor.id),
                ),
              )
            : undefined,
        ),
      )
      .orderBy(asc(textInboundClaims.userId), asc(textInboundClaims.id))
      .limit(25);
    if (!rows.length) cursor = null;
    for (const { claim: inboundClaim, completion } of rows) {
      const row = {
        ...inboundClaim,
        financeDisposition: completion?.disposition ?? null,
        financeContextId: completion?.contextId ?? null,
      };
      if (!options.enabled() || !shouldContinue()) break;
      try {
        const receipt = ["context_captured", "clarification_required"].includes(
          row.financeDisposition ?? "",
        )
          ? null
          : await options.recovery.inspectClaim(row.userId, row.messageId);
        if (row.financeDisposition === "context_captured") {
          if (!row.financeContextId) continue;
          const [source] = await options.db
            .select({ id: financeContextRevisions.id })
            .from(financeContextRevisions)
            .where(
              and(
                eq(financeContextRevisions.userId, row.userId),
                eq(financeContextRevisions.contextId, row.financeContextId),
                eq(financeContextRevisions.operationId, row.id),
                eq(financeContextRevisions.requestId, row.messageId),
                eq(financeContextRevisions.sourceKind, "sms"),
              ),
            )
            .limit(1);
          if (!source) continue;
        } else if (
          row.financeDisposition !== "clarification_required" &&
          (!receipt?.children.length ||
            receipt.children.some((child) => !child.terminal) ||
            !receipt.children.some(
              (child) => child.state === "accepted" || child.state === "blocked",
            ))
        )
          continue;
        await options.texting.sendNotification(row.userId, async (tx, connection) => {
          if (
            !options.enabled() ||
            !shouldContinue() ||
            connection.id !== row.connectionId ||
            connection.consentEpoch !== row.consentEpoch
          )
            return null;
          const [stored] = await tx
            .select()
            .from(financeSmsCompletions)
            .where(
              and(
                eq(financeSmsCompletions.claimId, row.id),
                eq(financeSmsCompletions.userId, row.userId),
              ),
            )
            .for("update");
          if (stored?.acknowledgementMessageId) return null;
          const [owner] = await tx.select().from(users).where(eq(users.id, row.userId));
          const preferences = await tx
            .select()
            .from(notificationPreferences)
            .where(eq(notificationPreferences.userId, row.userId));
          const global =
            preferences.find((item) => item.scope === "global")?.preferences ??
            defaultNotificationPreferences;
          const effective = notificationPreferencesSchema.parse(
            preferences.find((item) => item.scope === "finances")?.preferences ?? global,
          );
          if (
            !owner ||
            !global.enabled ||
            notificationEligibility({
              work: {
                work: {
                  domain: "finances",
                  kind: "question",
                  id: row.id,
                  revision: "1",
                  actionRevision: "1",
                },
                active: true,
                expiresAt: null,
                disclosure: "minimal",
                context: null,
                occurredAt: null,
                destination: "/finances?review=open",
              },
              preferences: effective,
              timeZone: owner.planningTimezone,
              now: options.now(),
              attempts: [],
            }) !== "eligible"
          )
            return null;
          const acceptedCount = (receipt?.children ?? []).filter(
            (child) => child.state === "accepted",
          ).length;
          const blockedCount = (receipt?.children ?? []).filter(
            (child) => child.state === "blocked",
          ).length;
          return {
            body:
              row.financeDisposition === "clarification_required"
                ? "nohmi: I could not safely attach that reply. For new context, send Finance: followed by your note. For a question, include its item number. Approvals require the exact approve/reject choices or the nohmi app."
                : row.financeDisposition === "context_captured"
                  ? "nohmi: Saved your Finance context. No transaction, amount or bookkeeping change was assumed. Review or revise it in nohmi."
                  : acceptedCount === 0
                    ? "nohmi: Your Finance reply could not apply to the current work. No decision was applied. Review the current proposal or question in nohmi."
                    : `nohmi: Saved ${acceptedCount === 1 ? "your reply" : `${acceptedCount} replies`}.${blockedCount ? ` ${blockedCount} other ${blockedCount === 1 ? "reply needs" : "replies need"} review in nohmi.` : ""} Finance maintenance may still be waiting for its host or another decision. Review progress in nohmi.`,
            queued: async (messageId) => {
              if (stored)
                await tx
                  .update(financeSmsCompletions)
                  .set({ acknowledgementMessageId: messageId })
                  .where(eq(financeSmsCompletions.claimId, row.id));
              else
                await tx.insert(financeSmsCompletions).values({
                  userId: row.userId,
                  claimId: row.id,
                  connectionId: row.connectionId,
                  disposition: "answer_received",
                  acknowledgementMessageId: messageId,
                });
            },
          };
        });
      } finally {
        cursor = { userId: row.userId, id: row.id };
      }
    }
  };
}
