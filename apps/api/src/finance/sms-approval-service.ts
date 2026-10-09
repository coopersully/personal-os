import {
  type Database,
  financeAccounts,
  financeAgentActionReviews,
  financeCategories,
  financeTransactions,
} from "@personal-os/database";
import {
  type FinanceDomainOutcome,
  type FinanceHumanWorkRef,
  type FinanceOutcomeReasonCode,
  type FinanceSmsAnswerCommand,
  financeDomainOutcomeSchema,
  type NotificationResolution,
} from "@personal-os/domain";
import { and, eq } from "drizzle-orm";
import type { createFinanceActionService } from "../finance-action-service.js";
import {
  executeFinanceAdmittedMutation,
  type FinanceTransaction,
  loadFinanceAuthorization,
} from "./context.js";
import type { ContextualPrincipal } from "./contextual-question-store.js";
import type { AdmitSmsAnswer } from "./sms-answer-port.js";

/** SMS approves only a single reversible transaction categorization, never budget authority,
 * recipient/scope changes, credentials or an entire maintenance batch. */
export function smsCategorizationSummary(
  row: typeof financeAgentActionReviews.$inferSelect,
): string | null {
  const payload = row.privatePayload as {
    input?: {
      decisions?: Array<{ learnMerchant?: string; transactionId?: string; categoryId?: string }>;
    };
  };
  if (
    row.actionKind !== "categorization" ||
    payload.input?.decisions?.length !== 1 ||
    payload.input.decisions[0]?.learnMerchant !== "never" ||
    row.safeChanges.length !== 1
  )
    return null;
  const change = row.safeChanges[0];
  if (
    !change ||
    typeof change.summary !== "string" ||
    change.entityType !== "finance_transaction" ||
    !change.entityId ||
    !change.summary.startsWith("Categorize ") ||
    change.summary.length > 120 ||
    /(?:\d[ .()-]*){5}|@|https?:|[\r\n]|[^\x20-\x7E]/iu.test(change.summary)
  )
    return null;
  return change.summary;
}

export async function resolveSmsApproval(
  userId: string,
  work: FinanceHumanWorkRef,
  tx: FinanceTransaction,
): Promise<NotificationResolution> {
  if (work.kind !== "approval") return { state: "unavailable" };
  const [row] = await tx
    .select()
    .from(financeAgentActionReviews)
    .where(
      and(eq(financeAgentActionReviews.userId, userId), eq(financeAgentActionReviews.id, work.id)),
    )
    .for("share", { noWait: true });
  if (!row) return { state: "unavailable" };
  if (row.status !== "pending") return { state: "resolved" };
  const revision = row.updatedAt.getTime().toString();
  if (revision !== work.revision || revision !== work.actionRevision) return { state: "stale" };
  const summary = smsCategorizationSummary(row);
  return {
    state: "current",
    value: {
      work,
      active: true,
      expiresAt: new Date(row.createdAt.getTime() + 86400000).toISOString(),
      context: summary,
      disclosure: summary ? "context" : "minimal",
      occurredAt: row.createdAt.toISOString(),
      destination: "/finances?review=open",
    },
  };
}

export function createFinanceSmsApprovalService(options: {
  db: Database;
  actions: ReturnType<typeof createFinanceActionService>;
  admit: AdmitSmsAnswer;
  now: () => Date;
}) {
  return async (
    command: FinanceSmsAnswerCommand,
    context: ContextualPrincipal,
    tx: FinanceTransaction,
  ): Promise<FinanceDomainOutcome> => {
    const outcome = (
      state: "accepted" | "blocked" | "unavailable",
      unavailableReason: FinanceOutcomeReasonCode = "producer_not_registered",
    ) =>
      financeDomainOutcomeSchema.parse({
        operationId: command.operationId,
        state,
        work: [],
        resultRevision:
          state === "accepted" ? (BigInt(command.work.revision) + 1n).toString() : null,
        reasonCode:
          state === "accepted" ? null : state === "blocked" ? "stale_revision" : unavailableReason,
      });
    if (
      command.work.kind !== "approval" ||
      !["approve", "reject"].includes(command.text) ||
      context.principal.actorType !== "user" ||
      context.principal.actorId !== context.principal.userId
    )
      return outcome("unavailable");
    const authority = await loadFinanceAuthorization({ db: tx, ...context });
    return executeFinanceAdmittedMutation(
      tx,
      authority,
      {
        idempotencyKey: command.operationId,
        operation: "decide_finance_sms_categorization_v1",
        payload: command,
        sourceKind: "sms",
      },
      async (executor) => {
        const admission = await options.admit(executor, {
          ...command,
          userId: context.principal.userId,
        });
        if (admission.state !== "verified")
          return { state: "unavailable", result: outcome("unavailable", admission.reasonCode) };
        const [preview] = await executor
          .select()
          .from(financeAgentActionReviews)
          .where(
            and(
              eq(financeAgentActionReviews.userId, context.principal.userId),
              eq(financeAgentActionReviews.id, command.work.id),
            ),
          );
        if (preview && smsCategorizationSummary(preview)) {
          const decision = (
            preview.privatePayload as {
              input: { decisions: Array<{ transactionId: string; categoryId: string }> };
            }
          ).input.decisions[0];
          if (decision) {
            const [transaction] = await executor
              .select()
              .from(financeTransactions)
              .where(
                and(
                  eq(financeTransactions.userId, context.principal.userId),
                  eq(financeTransactions.id, decision.transactionId),
                ),
              );
            if (transaction)
              await executor
                .select({ id: financeAccounts.id })
                .from(financeAccounts)
                .where(
                  and(
                    eq(financeAccounts.userId, context.principal.userId),
                    eq(financeAccounts.id, transaction.accountId),
                  ),
                )
                .for("update", { noWait: true });
            await executor
              .select({ id: financeTransactions.id })
              .from(financeTransactions)
              .where(
                and(
                  eq(financeTransactions.userId, context.principal.userId),
                  eq(financeTransactions.id, decision.transactionId),
                ),
              )
              .for("update", { noWait: true });
            await executor
              .select({ id: financeCategories.id })
              .from(financeCategories)
              .where(
                and(
                  eq(financeCategories.userId, context.principal.userId),
                  eq(financeCategories.id, decision.categoryId),
                ),
              )
              .for("update", { noWait: true });
          }
        }
        const [review] = await executor
          .select()
          .from(financeAgentActionReviews)
          .where(
            and(
              eq(financeAgentActionReviews.userId, context.principal.userId),
              eq(financeAgentActionReviews.id, command.work.id),
            ),
          )
          .for("update", { noWait: true });
        const current =
          review &&
          review.status === "pending" &&
          review.updatedAt.getTime().toString() === command.work.revision &&
          command.work.actionRevision === command.work.revision &&
          review.createdAt.getTime() + 86400000 > options.now().getTime() &&
          smsCategorizationSummary(review) !== null;
        return { state: "admitted", prepared: { current, consume: admission.consume } };
      },
      async (executor, prepared) => {
        if (!prepared.current) return outcome("blocked");
        if (command.text === "approve") {
          const result = await options.actions.approve(command.work.id, context, executor);
          if (result.status !== "applied") return outcome("blocked");
        } else {
          const result = await options.actions.dismiss(command.work.id, context, executor);
          if (result.status !== "dismissed") return outcome("blocked");
        }
        const accepted = { ...outcome("accepted"), state: "accepted" as const };
        await prepared.consume(accepted);
        return accepted;
      },
    );
  };
}
