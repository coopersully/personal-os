import {
  type Database,
  financeSmsCompletions,
  textInboundClaims,
  textingConnections,
  textMessages,
  textReplyBindings,
  users,
} from "@personal-os/database";
import { and, asc, eq, gt, notExists, or } from "drizzle-orm";
import { FinanceClaimReconciliationError } from "../finance-reconciliation-errors.js";
import { bindInboundReply } from "../texting-reply-binding.js";
import { createFinanceContextService } from "./context-service.js";

/** Explicit Finance prefix captures verbatim context; no amount, recipient or purpose is inferred. */
export function createFinanceSmsContextDispatcher(options: {
  db: Database;
  enabled: () => boolean;
  now: () => Date;
}) {
  let cursor: { userId: string; id: string } | null = null;
  return async (shouldContinue: () => boolean = () => true) => {
    if (!options.enabled() || !shouldContinue()) return;
    const attached = options.db
      .select({ id: textReplyBindings.id })
      .from(textReplyBindings)
      .where(
        and(
          eq(textReplyBindings.userId, textInboundClaims.userId),
          eq(textReplyBindings.inboundClaimId, textInboundClaims.id),
        ),
      );
    const rows = await options.db
      .select({ claim: textInboundClaims, message: textMessages })
      .from(textInboundClaims)
      .innerJoin(
        textingConnections,
        and(
          eq(textingConnections.userId, textInboundClaims.userId),
          eq(textingConnections.id, textInboundClaims.connectionId),
          eq(textingConnections.consentEpoch, textInboundClaims.consentEpoch),
          eq(textingConnections.state, "active"),
        ),
      )
      .innerJoin(
        textMessages,
        and(
          eq(textMessages.userId, textInboundClaims.userId),
          eq(textMessages.id, textInboundClaims.messageId),
          eq(textMessages.connectionId, textInboundClaims.connectionId),
          eq(textMessages.direction, "inbound"),
        ),
      )
      .where(
        and(
          notExists(
            options.db
              .select({ id: financeSmsCompletions.claimId })
              .from(financeSmsCompletions)
              .where(eq(financeSmsCompletions.claimId, textInboundClaims.id)),
          ),
          notExists(attached),
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
    let failed = 0;
    for (const { claim, message } of rows) {
      if (!options.enabled() || !shouldContinue()) break;
      try {
        // Only an explicit new-context command is routed here. Other messages remain recoverable
        // by the exact question coordinator, which determines whether routing is ambiguous.
        if (!/^Finance(?: context)?:\s*\S/iu.test(message.body)) {
          const binding = await bindInboundReply(
            options.db,
            claim.userId,
            message.id,
            options.enabled,
            options.now(),
          );
          if (
            binding.state !== "unavailable" ||
            !["ambiguous", "unsupported"].includes(binding.reason)
          )
            continue;
          await options.db.transaction(async (tx) => {
            const [owner] = await tx
              .select({ id: users.id })
              .from(users)
              .where(eq(users.id, claim.userId))
              .for("key share", { noWait: true });
            const [connection] = await tx
              .select()
              .from(textingConnections)
              .where(eq(textingConnections.userId, claim.userId))
              .for("share", { noWait: true });
            if (
              !owner ||
              !options.enabled() ||
              !shouldContinue() ||
              connection?.state !== "active" ||
              connection.id !== claim.connectionId ||
              connection.consentEpoch !== claim.consentEpoch
            )
              return;
            const [locked] = await tx
              .select()
              .from(textInboundClaims)
              .where(
                and(eq(textInboundClaims.userId, claim.userId), eq(textInboundClaims.id, claim.id)),
              )
              .for("update", { noWait: true });
            const [bound] = await tx
              .select({ id: textReplyBindings.id })
              .from(textReplyBindings)
              .where(
                and(
                  eq(textReplyBindings.userId, claim.userId),
                  eq(textReplyBindings.inboundClaimId, claim.id),
                ),
              )
              .limit(1);
            const [completed] = await tx
              .select({ id: financeSmsCompletions.claimId })
              .from(financeSmsCompletions)
              .where(eq(financeSmsCompletions.claimId, claim.id));
            if (!locked || completed || bound) return;
            await tx.insert(financeSmsCompletions).values({
              userId: claim.userId,
              claimId: claim.id,
              connectionId: claim.connectionId,
              disposition: "clarification_required",
            });
          });
          continue;
        }
        await options.db.transaction(async (tx) => {
          const [owner] = await tx
            .select({ id: users.id })
            .from(users)
            .where(eq(users.id, claim.userId))
            .for("key share", { noWait: true });
          if (!owner || !options.enabled() || !shouldContinue()) return;
          const service = createFinanceContextService({
            db: options.db,
            principal: {
              userId: claim.userId,
              actorId: claim.userId,
              actorType: "user",
              scopes: new Set(["finances:write"]),
            },
            requestId: message.id,
            now: options.now,
            smsEvidence: {
              claimId: claim.id,
              inboundMessageId: message.id,
              enabled: options.enabled,
            },
          });
          const context = await service.captureContext(
            {
              type: "create",
              operationId: claim.id,
              text: message.body.replace(/^Finance(?: context)?:\s*/iu, "").trim(),
              validFrom: null,
              validThrough: null,
              participants: [],
              paymentChannel: null,
              expectedCents: null,
              categoryId: null,
              transactionIds: [],
            },
            tx,
          );
          await tx
            .insert(financeSmsCompletions)
            .values({
              userId: claim.userId,
              claimId: claim.id,
              connectionId: claim.connectionId,
              contextId: context.id,
              disposition: "context_captured",
            })
            .onConflictDoNothing();
        });
      } catch {
        // Authority is rechecked under locks. Revoked/old-epoch claims leave the next scan;
        // transient lock or transport failures remain eligible without starving later owners.
        failed++;
      } finally {
        cursor = { userId: claim.userId, id: claim.id };
      }
    }
    if (failed) throw new FinanceClaimReconciliationError(failed);
  };
}
