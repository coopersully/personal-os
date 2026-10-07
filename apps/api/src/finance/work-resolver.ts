import {
  type FinanceHumanWorkRef,
  financeHumanWorkRefSchema,
  type NotificationResolution,
} from "@personal-os/domain";
import { z } from "zod";
import { AppError } from "../errors.js";
import type { FinanceTransaction } from "./context.js";
import {
  admitContextualOwner,
  contextualRetry,
  currentContextualParents,
  exactContextualAnswer,
  type LockedContextualQuestion,
  lockContextualQuestion,
  lockContextualQuestions,
} from "./contextual-question-store.js";

const batchSchema = z.array(financeHumanWorkRefSchema).min(1).max(100);

function contextualResolution(locked: LockedContextualQuestion, work: FinanceHumanWorkRef) {
  const { question } = locked;
  if (
    question.state !== "open" ||
    question.workRevision.toString() !== work.revision ||
    question.actionRevision.toString() !== work.actionRevision ||
    !currentContextualParents(locked)
  )
    return { state: "stale" } as const;
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
  } as const;
}

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
  if (await exactContextualAnswer(tx, userId, locked.question, work)) return { state: "resolved" };
  return contextualResolution(locked, work);
}

/** Resolve one bounded notification batch in a caller-owned transaction. Never loop the
 * single-work port for a batch: every parent and question lock must follow one global order. */
export async function resolveContextualWorks(
  userId: string,
  raw: FinanceHumanWorkRef[],
  tx: FinanceTransaction,
): Promise<NotificationResolution[]> {
  const refs = batchSchema.parse(raw);
  if (new Set(refs.map((ref) => ref.id.toLowerCase())).size !== refs.length) {
    throw new AppError("invalid_request", "Each Finance work item may appear once.");
  }
  const supported = refs.filter((ref) => ref.kind === "question");
  if (!supported.length) return refs.map(() => ({ state: "unavailable" }));
  await admitContextualOwner(tx, userId);
  try {
    const locked = await lockContextualQuestions(
      tx,
      userId,
      supported.map((ref) => ref.id),
    );
    const results: NotificationResolution[] = [];
    for (const ref of refs) {
      if (ref.kind !== "question") {
        results.push({ state: "unavailable" });
        continue;
      }
      const question = locked.get(ref.id);
      if (!question) {
        results.push({ state: "unavailable" });
        continue;
      }
      results.push(
        (await exactContextualAnswer(tx, userId, question.question, ref))
          ? { state: "resolved" }
          : contextualResolution(question, ref),
      );
    }
    return results;
  } catch (error) {
    let cause: unknown = error;
    const seen = new Set<unknown>();
    while (typeof cause === "object" && cause !== null && !seen.has(cause)) {
      seen.add(cause);
      if ("code" in cause && (cause.code === "55P03" || cause.code === "40001"))
        throw contextualRetry();
      cause = "cause" in cause ? cause.cause : null;
    }
    throw error;
  }
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
