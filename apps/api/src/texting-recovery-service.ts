import {
  type Database,
  textInboundClaims,
  textingConnections,
  textMessages,
  textReplyBindings,
} from "@personal-os/database";
import { type FinanceDomainOutcome, idSchema } from "@personal-os/domain";
import { and, asc, eq, exists, gt, inArray, notExists, or } from "drizzle-orm";
import {
  bindInboundReply,
  expireOpenReplyBindings,
  transitionReplyChild,
} from "./texting-reply-binding.js";
import {
  isTextingSmsRetryableError,
  readTextingEnabled,
  replyDeliveryState,
  type SmsAnswerCommand,
} from "./texting-sms-admission.js";

export type FinanceSmsRecoveryCommand = SmsAnswerCommand;
export type FinanceSmsReceiptInspection =
  | { state: "absent" }
  | { state: "completed"; outcome: FinanceDomainOutcome }
  | { state: "incomplete"; status: "started" | "failed" };

/** F composes this with C's owner/operation-locked Finance transaction wrapper. */
export type TextingRecoveryFinancePort = {
  inspectSmsReceipt: (
    userId: string,
    command: FinanceSmsRecoveryCommand,
  ) => Promise<FinanceSmsReceiptInspection>;
  executeAnswer: (
    userId: string,
    command: FinanceSmsRecoveryCommand,
  ) => Promise<FinanceDomainOutcome>;
};

export type TextingRecoveryCursor = { claimId: string };
export type TextingRecoveryChild = {
  itemNumber?: number;
  bindingId: string;
  operationId: string;
  state: "accepted" | "waiting" | "uncertain" | "blocked" | "unavailable";
  reason: string | null;
  terminal: boolean;
};
export type TextingRecoveryClaim = {
  inboundMessageId: string;
  state: "attached" | "waiting" | "unavailable" | "uncertain";
  reason: string | null;
  children: TextingRecoveryChild[];
};
export type TextingRecoveryPage = {
  claims: TextingRecoveryClaim[];
  hasMore: boolean;
  nextCursor: TextingRecoveryCursor | null;
  expirationSweep:
    | { state: "completed"; expiredOpenBindings: number }
    | { state: "uncertain"; reason: "expiration_sweep_failed" };
};

const UNFINISHED_STATES = ["pending", "waiting", "uncertain"] as const;

/** One bounded owner-scoped pass; the caller starts a later pass without a cursor. */
export function createTextingRecoveryService(options: {
  db: Database;
  enabled: () => boolean;
  finance: TextingRecoveryFinancePort;
  now?: () => Date;
}) {
  const current = options.now ?? (() => new Date());

  async function inspect(userId: string, command: FinanceSmsRecoveryCommand) {
    try {
      const receipt = await options.finance.inspectSmsReceipt(userId, command);
      if (receipt.state === "completed" && receipt.outcome.operationId !== command.operationId)
        throw new Error("Finance receipt operation mismatch");
      return receipt;
    } catch {
      // A failed read is not evidence that the receipt is absent.
      return { state: "inspection_failed" } as const;
    }
  }

  function commandFor(
    inboundMessageId: string,
    binding: typeof textReplyBindings.$inferSelect,
  ): FinanceSmsRecoveryCommand | null {
    if (binding.workKind !== "question" || !binding.canonicalAnswer) return null;
    return {
      operationId: binding.operationId,
      work: {
        domain: "finances",
        kind: binding.workKind,
        id: binding.workId,
        revision: binding.workRevision,
        actionRevision: binding.actionRevision,
      },
      text: binding.canonicalAnswer,
      inboundMessageId,
      replyBindingId: binding.id,
    };
  }

  function terminalStatus(
    binding: typeof textReplyBindings.$inferSelect,
    receipt: Awaited<ReturnType<typeof inspect>>,
  ): TextingRecoveryChild {
    const base = { bindingId: binding.id, operationId: binding.operationId };
    if (receipt.state === "inspection_failed")
      return { ...base, state: "uncertain", reason: "receipt_inspection_failed", terminal: false };
    if (receipt.state === "incomplete")
      return {
        ...base,
        state: "uncertain",
        reason: `finance_receipt_${receipt.status}`,
        terminal: false,
      };
    if (receipt.state === "absent")
      return { ...base, state: "uncertain", reason: "terminal_receipt_missing", terminal: false };
    const outcome = receipt.outcome;
    const expectedState =
      outcome.state === "accepted"
        ? "accepted"
        : outcome.state === "unavailable"
          ? "unavailable"
          : outcome.state === "blocked" || outcome.state === "failed"
            ? "blocked"
            : null;
    const expectedReason =
      outcome.state === "accepted" ? null : (outcome.reasonCode ?? `finance_${outcome.state}`);
    const revisionMatches =
      outcome.state !== "accepted" ||
      (outcome.resultRevision !== null && binding.resultRevision === outcome.resultRevision);
    return expectedState === binding.state &&
      expectedReason === binding.reasonCode &&
      revisionMatches
      ? {
          ...base,
          state: binding.state as "accepted" | "blocked" | "unavailable",
          reason: binding.reasonCode,
          terminal: true,
        }
      : { ...base, state: "uncertain", reason: "terminal_receipt_mismatch", terminal: false };
  }

  async function attachedChild(
    userId: string,
    inboundMessageId: string,
    claim: typeof textInboundClaims.$inferSelect,
    binding: typeof textReplyBindings.$inferSelect,
  ): Promise<TextingRecoveryChild> {
    const base = { bindingId: binding.id, operationId: binding.operationId };
    const command = commandFor(inboundMessageId, binding);
    if (!command)
      return { ...base, state: "uncertain", reason: "invalid_child_evidence", terminal: false };
    let receipt = await inspect(userId, command);
    if (
      binding.state === "accepted" ||
      binding.state === "blocked" ||
      binding.state === "unavailable"
    )
      return terminalStatus(binding, receipt);
    if (receipt.state === "inspection_failed")
      return { ...base, state: "uncertain", reason: "receipt_inspection_failed", terminal: false };
    if (receipt.state === "incomplete")
      return {
        ...base,
        state: "uncertain",
        reason: `finance_receipt_${receipt.status}`,
        terminal: false,
      };
    if (receipt.state === "absent") {
      const [connection] = await options.db
        .select({ state: textingConnections.state, consentEpoch: textingConnections.consentEpoch })
        .from(textingConnections)
        .where(
          and(eq(textingConnections.userId, userId), eq(textingConnections.id, claim.connectionId)),
        )
        .limit(1);
      if (
        connection?.state !== "active" ||
        connection.consentEpoch !== claim.consentEpoch ||
        binding.consentEpoch !== claim.consentEpoch
      )
        return { ...base, state: "blocked", reason: "consent_revoked", terminal: false };
      try {
        if (!readTextingEnabled(options.enabled))
          return { ...base, state: "waiting", reason: "texting_disabled", terminal: false };
      } catch {
        return { ...base, state: "waiting", reason: "policy_check_failed", terminal: false };
      }
      const [outbound] = await options.db
        .select()
        .from(textMessages)
        .where(and(eq(textMessages.userId, userId), eq(textMessages.id, binding.outboundMessageId)))
        .limit(1);
      const [inbound] = await options.db
        .select({ occurredAt: textMessages.occurredAt })
        .from(textMessages)
        .where(and(eq(textMessages.userId, userId), eq(textMessages.id, inboundMessageId)))
        .limit(1);
      if (!outbound || !inbound || binding.expiresAt <= current())
        return { ...base, state: "blocked", reason: "source_unavailable", terminal: false };
      const delivery = replyDeliveryState(outbound);
      if (delivery === "terminal")
        return { ...base, state: "blocked", reason: "delivery_failed", terminal: false };
      if (delivery === "waiting" || !outbound.providerSubmittedAt)
        return { ...base, state: "waiting", reason: "delivery_unconfirmed", terminal: false };
      if (outbound.providerSubmittedAt >= inbound.occurredAt)
        return { ...base, state: "blocked", reason: "causal_order_unproven", terminal: false };
      if (binding.state !== "pending") {
        const restored = await transitionReplyChild(
          options.db,
          userId,
          binding.id,
          binding.operationId,
          {
            state: "pending",
            reasonCode: null,
          },
        );
        if (!restored)
          return { ...base, state: "uncertain", reason: "child_changed", terminal: false };
      }
      try {
        await options.finance.executeAnswer(userId, command);
      } catch (error) {
        // A thrown response may follow a committed Finance transaction. Inspect again.
        receipt = await inspect(userId, command);
        if (receipt.state === "absent")
          return {
            ...base,
            state: "uncertain",
            reason: isTextingSmsRetryableError(error) ? error.reasonCode : "answer_uncertain",
            terminal: false,
          };
      }
      if (receipt.state === "absent") receipt = await inspect(userId, command);
    }
    if (receipt.state === "inspection_failed")
      return { ...base, state: "uncertain", reason: "receipt_inspection_failed", terminal: false };
    if (receipt.state === "incomplete")
      return {
        ...base,
        state: "uncertain",
        reason: `finance_receipt_${receipt.status}`,
        terminal: false,
      };
    if (receipt.state === "absent")
      return { ...base, state: "uncertain", reason: "receipt_not_completed", terminal: false };
    const outcome = receipt.outcome;
    if (outcome.state === "accepted") {
      const [stored] = await options.db
        .select({
          state: textReplyBindings.state,
          resultRevision: textReplyBindings.resultRevision,
        })
        .from(textReplyBindings)
        .where(and(eq(textReplyBindings.userId, userId), eq(textReplyBindings.id, binding.id)))
        .limit(1);
      return stored?.state === "accepted" &&
        outcome.resultRevision !== null &&
        stored.resultRevision === outcome.resultRevision
        ? { ...base, state: "accepted", reason: null, terminal: true }
        : { ...base, state: "uncertain", reason: "accepted_binding_mismatch", terminal: false };
    }
    const terminal =
      outcome.state === "unavailable"
        ? "unavailable"
        : outcome.state === "blocked" || outcome.state === "failed"
          ? "blocked"
          : null;
    if (terminal) {
      const projected = await transitionReplyChild(
        options.db,
        userId,
        binding.id,
        binding.operationId,
        {
          state: terminal,
          reasonCode: outcome.reasonCode ?? `finance_${outcome.state}`,
        },
      );
      return projected
        ? {
            ...base,
            state: terminal,
            reason: outcome.reasonCode ?? `finance_${outcome.state}`,
            terminal: true,
          }
        : { ...base, state: "uncertain", reason: "child_changed", terminal: false };
    }
    return { ...base, state: "uncertain", reason: `finance_${outcome.state}`, terminal: false };
  }

  /** Exact owner-scoped, read-only status, including lone terminal claims omitted by runPage. */
  async function inspectClaim(
    userId: string,
    inboundMessageId: string,
  ): Promise<TextingRecoveryClaim | null> {
    idSchema.parse(userId);
    idSchema.parse(inboundMessageId);
    const [claim] = await options.db
      .select()
      .from(textInboundClaims)
      .where(
        and(
          eq(textInboundClaims.userId, userId),
          eq(textInboundClaims.messageId, inboundMessageId),
        ),
      )
      .limit(1);
    if (!claim) return null;
    const bindings = await options.db
      .select()
      .from(textReplyBindings)
      .where(
        and(eq(textReplyBindings.userId, userId), eq(textReplyBindings.inboundClaimId, claim.id)),
      )
      .orderBy(asc(textReplyBindings.itemNumber));
    if (!bindings.length)
      return { inboundMessageId, state: "waiting", reason: "unattached_claim", children: [] };
    const children: TextingRecoveryChild[] = [];
    for (const binding of bindings) {
      const base = {
        itemNumber: binding.itemNumber,
        bindingId: binding.id,
        operationId: binding.operationId,
      };
      const command = commandFor(inboundMessageId, binding);
      if (!command) {
        children.push({
          ...base,
          state: "uncertain",
          reason: "invalid_child_evidence",
          terminal: false,
        });
        continue;
      }
      const receipt = await inspect(userId, command);
      if (
        binding.state === "accepted" ||
        binding.state === "blocked" ||
        binding.state === "unavailable"
      ) {
        children.push({ ...terminalStatus(binding, receipt), itemNumber: binding.itemNumber });
      } else if (receipt.state === "inspection_failed") {
        children.push({
          ...base,
          state: "uncertain",
          reason: "receipt_inspection_failed",
          terminal: false,
        });
      } else if (receipt.state === "incomplete") {
        children.push({
          ...base,
          state: "uncertain",
          reason: `finance_receipt_${receipt.status}`,
          terminal: false,
        });
      } else if (receipt.state === "completed") {
        children.push({
          ...base,
          state: "uncertain",
          reason: "receipt_projection_pending",
          terminal: false,
        });
      } else {
        children.push({
          ...base,
          state: binding.state === "waiting" ? "waiting" : "uncertain",
          reason: binding.reasonCode ?? "finance_receipt_absent",
          terminal: false,
        });
      }
    }
    return { inboundMessageId, state: "attached", reason: null, children };
  }

  async function runPage(
    userId: string,
    input: { limit: number; after?: TextingRecoveryCursor },
  ): Promise<TextingRecoveryPage> {
    idSchema.parse(userId);
    if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 25)
      throw new Error("Invalid Texting recovery limit");
    const limit = input.limit;
    const after = input.after;
    if (after && !idSchema.safeParse(after.claimId).success)
      throw new Error("Invalid Texting recovery cursor");
    const attached = options.db
      .select({ id: textReplyBindings.id })
      .from(textReplyBindings)
      .where(
        and(
          eq(textReplyBindings.userId, userId),
          eq(textReplyBindings.inboundClaimId, textInboundClaims.id),
        ),
      );
    const unfinished = options.db
      .select({ id: textReplyBindings.id })
      .from(textReplyBindings)
      .where(
        and(
          eq(textReplyBindings.userId, userId),
          eq(textReplyBindings.inboundClaimId, textInboundClaims.id),
          inArray(textReplyBindings.state, UNFINISHED_STATES),
        ),
      );
    const claims = await options.db
      .select()
      .from(textInboundClaims)
      .where(
        and(
          eq(textInboundClaims.userId, userId),
          or(notExists(attached), exists(unfinished)),
          after ? gt(textInboundClaims.id, after.claimId) : undefined,
        ),
      )
      .orderBy(asc(textInboundClaims.id))
      .limit(limit + 1);
    const selected = claims.slice(0, limit);
    const results: TextingRecoveryClaim[] = [];
    for (const claim of selected) {
      let bindings = await options.db
        .select()
        .from(textReplyBindings)
        .where(
          and(eq(textReplyBindings.userId, userId), eq(textReplyBindings.inboundClaimId, claim.id)),
        )
        .orderBy(asc(textReplyBindings.itemNumber));
      if (!bindings.length) {
        let bound: Awaited<ReturnType<typeof bindInboundReply>>;
        try {
          bound = await bindInboundReply(
            options.db,
            userId,
            claim.messageId,
            options.enabled,
            current(),
          );
        } catch {
          results.push({
            inboundMessageId: claim.messageId,
            state: "uncertain",
            reason: "binding_uncertain",
            children: [],
          });
          continue;
        }
        if (bound.state !== "pending") {
          results.push({
            inboundMessageId: claim.messageId,
            state: bound.state,
            reason: bound.reason,
            children: [],
          });
          continue;
        }
        bindings = await options.db
          .select()
          .from(textReplyBindings)
          .where(
            and(
              eq(textReplyBindings.userId, userId),
              eq(textReplyBindings.inboundClaimId, claim.id),
            ),
          )
          .orderBy(asc(textReplyBindings.itemNumber));
      }
      const children: TextingRecoveryChild[] = [];
      for (const binding of bindings) {
        if (
          binding.state !== "accepted" &&
          binding.state !== "blocked" &&
          binding.state !== "unavailable" &&
          !UNFINISHED_STATES.includes(binding.state as (typeof UNFINISHED_STATES)[number])
        )
          continue;
        try {
          children.push(await attachedChild(userId, claim.messageId, claim, binding));
        } catch {
          children.push({
            bindingId: binding.id,
            operationId: binding.operationId,
            state: "uncertain",
            reason: "child_recovery_failed",
            terminal: false,
          });
        }
      }
      results.push({
        inboundMessageId: claim.messageId,
        state: "attached",
        reason: null,
        children,
      });
    }
    const last = selected.at(-1);
    let expirationSweep: TextingRecoveryPage["expirationSweep"];
    try {
      expirationSweep = {
        state: "completed",
        expiredOpenBindings: await expireOpenReplyBindings(options.db, userId, current()),
      };
    } catch {
      // A lock conflict or outage does not erase independently reconciled children.
      expirationSweep = { state: "uncertain", reason: "expiration_sweep_failed" };
    }
    return {
      claims: results,
      hasMore: claims.length > limit,
      nextCursor: claims.length > limit && last ? { claimId: last.id } : null,
      expirationSweep,
    };
  }

  return { runPage, inspectClaim };
}
