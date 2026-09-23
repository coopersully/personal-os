import {
  type FinanceHumanWorkRef,
  financeHumanWorkRefSchema,
  type NotificationResolution,
} from "@personal-os/domain";
import type { FinanceTransaction } from "./context.js";
import {
  admitContextualOwner,
  currentContextualParents,
  exactContextualAnswer,
  lockContextualQuestion,
} from "./contextual-question-store.js";

/** Internal one-question resolver. T1 is not registered; supplied caller owns commit/rollback. */
export async function resolveContextualWork(
  userId: string,
  raw: FinanceHumanWorkRef,
  tx: FinanceTransaction,
): Promise<NotificationResolution> {
  const work = financeHumanWorkRefSchema.parse(raw);
  if (work.kind !== "question") return { state: "unavailable" };
  await admitContextualOwner(tx, userId);
  const locked = await lockContextualQuestion(tx, userId, work.id, false);
  if (!locked) return { state: "unavailable" };
  const { question } = locked;
  if (await exactContextualAnswer(tx, userId, question, work)) return { state: "resolved" };
  if (
    question.state !== "open" ||
    question.workRevision.toString() !== work.revision ||
    question.actionRevision.toString() !== work.actionRevision ||
    !currentContextualParents(locked)
  )
    return { state: "stale" };
  return {
    state: "current",
    value: {
      work,
      active: true,
      expiresAt: null,
      disclosure: "minimal",
      context: null,
      occurredAt: null,
      destination: `/finances/review?contextualQuestion=${encodeURIComponent(work.id)}`,
    },
  };
}

export type FinanceSmsQuestionResolution =
  | Exclude<NotificationResolution, { state: "current" }>
  | (Extract<NotificationResolution, { state: "current" }> & { prompt: string });

/** Internal SMS prompt; exact currentness and parent locks remain Finance-owned. */
export async function resolveSmsQuestion(
  userId: string,
  work: FinanceHumanWorkRef,
  tx: FinanceTransaction,
): Promise<FinanceSmsQuestionResolution> {
  const resolved = await resolveContextualWork(userId, work, tx);
  return resolved.state === "current"
    ? { ...resolved, prompt: "What was this transaction for?" }
    : resolved;
}
