import {
  financeAccounts,
  financeContextualQuestions,
  financeReviewCases,
  financeTransactions,
} from "@personal-os/database";
import {
  type FinanceHumanWorkRef,
  financeHumanWorkRefSchema,
  type NotificationResolution,
} from "@personal-os/domain";
import { and, eq, inArray } from "drizzle-orm";
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
import { resolveMaintenanceReviewQuestion } from "./review-action-service.js";

import { minimalSmsQuestionPrompt } from "./review-prompt.js";

import { resolveSmsApproval } from "./sms-approval-service.js";

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
      questionPrompt: minimalSmsQuestionPrompt(question.prompt),
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
  if (resolved.state === "unavailable") return resolveMaintenanceReviewQuestion(userId, work, tx);
  return resolved.state === "current"
    ? { ...resolved, prompt: "What was this transaction for?" }
    : resolved;
}

/** Global parent lock order for batches containing interactive and maintenance questions. */
export async function resolveFinanceWorks(
  userId: string,
  raw: FinanceHumanWorkRef[],
  tx: FinanceTransaction,
): Promise<NotificationResolution[]> {
  const refs = batchSchema.parse(raw);
  if (new Set(refs.map((r) => r.id.toLowerCase())).size !== refs.length)
    throw new AppError("invalid_request", "Each Finance work item may appear once.");
  try {
    await admitContextualOwner(tx, userId);
    const ids = refs.filter((r) => r.kind === "question").map((r) => r.id.toLowerCase());
    if (!ids.length && !refs.some((ref) => ref.kind === "approval"))
      return refs.map(() => ({ state: "unavailable" }));
    const manual = await tx
      .select()
      .from(financeContextualQuestions)
      .where(
        and(
          eq(financeContextualQuestions.userId, userId),
          inArray(financeContextualQuestions.id, ids),
        ),
      );
    const reviews = await tx
      .select()
      .from(financeReviewCases)
      .where(
        and(
          eq(financeReviewCases.userId, userId),
          inArray(financeReviewCases.id, [...ids, ...manual.map((q) => q.reviewCaseId)]),
        ),
      );
    const transactionIds = [...new Set(reviews.map((r) => r.transactionId))].sort();
    const previews = transactionIds.length
      ? await tx
          .select()
          .from(financeTransactions)
          .where(
            and(
              eq(financeTransactions.userId, userId),
              inArray(financeTransactions.id, transactionIds),
            ),
          )
      : [];
    for (const id of [...new Set(previews.map((t) => t.accountId))].sort())
      await tx
        .select()
        .from(financeAccounts)
        .where(and(eq(financeAccounts.userId, userId), eq(financeAccounts.id, id)))
        .for("share", { noWait: true });
    for (const id of transactionIds)
      await tx
        .select()
        .from(financeTransactions)
        .where(and(eq(financeTransactions.userId, userId), eq(financeTransactions.id, id)))
        .for("share", { noWait: true });
    for (const id of reviews.map((r) => r.id).sort())
      await tx
        .select()
        .from(financeReviewCases)
        .where(and(eq(financeReviewCases.userId, userId), eq(financeReviewCases.id, id)))
        .for("share", { noWait: true });
    const manualIds = new Set(manual.map((q) => q.id));
    const manualRefs = refs.filter((r) => manualIds.has(r.id.toLowerCase()));
    const manualResults = manualRefs.length
      ? await resolveContextualWorks(userId, manualRefs, tx)
      : [];
    const resultMap = new Map(manualRefs.map((ref, i) => [ref.id.toLowerCase(), manualResults[i]]));
    const results: NotificationResolution[] = [];
    for (const ref of refs)
      results.push(
        ref.kind === "approval"
          ? await resolveSmsApproval(userId, ref, tx)
          : (resultMap.get(ref.id.toLowerCase()) ??
              (await resolveMaintenanceReviewQuestion(userId, ref, tx))),
      );
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
