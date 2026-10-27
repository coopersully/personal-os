import { createHash } from "node:crypto";
import {
  financeAccounts,
  financeContextualQuestions,
  financeReviewCases,
  financeTransactions,
  workspaceMaintenanceRuns,
} from "@personal-os/database";
import {
  type FinanceHumanWorkRef,
  financeHumanWorkRefSchema,
  idSchema,
  maintenanceScopeSchema,
  type NotificationResolution,
} from "@personal-os/domain";
import { and, eq, inArray, sql } from "drizzle-orm";
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
import { lockFinanceExecutionOwner } from "./execution-owner-guard.js";
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

/** Only a changed required owner action can reset delivery history. Evidence refresh,
 * wording and unclassified internal failure codes deliberately share their recovery action. */
function attentionAction(code: string): string {
  if (code === "forbidden" || code === "finance_authorization_control_pending")
    return "restore_finance_authority";
  if (code === "not_found") return "restore_finance_target";
  if (code === "invalid_request" || code === "finance_position_scope_unsupported")
    return "review_finance_scope";
  if (code === "finance_rulebook_changed") return "review_finance_rules";
  if (code === "finance_source_not_current") return "restore_finance_source";
  if (
    [
      "finance_budget_evaluation_missing",
      "finance_budget_evaluation_unavailable",
      "finance_budget_evaluation_changed",
    ].includes(code)
  )
    return "review_budget_evidence";
  if (
    [
      "finance_position_evidence_missing",
      "finance_position_evidence_unavailable",
      "finance_position_evidence_changed",
      "finance_canonical_evidence_changed",
    ].includes(code)
  )
    return "refresh_finance_evidence";
  return "inspect_finance_failure";
}

/** Stable owner/scope slot, semantic action code, exact run correlation. Run IDs, wording,
 * timestamps, host rotation and internal progress never create a new required action. */
export function financeRunAttentionWork(
  run: Pick<
    typeof workspaceMaintenanceRuns.$inferSelect,
    "id" | "userId" | "scope" | "lastSafeError" | "settledResult"
  >,
): FinanceHumanWorkRef {
  const scope = maintenanceScopeSchema.parse(run.scope);
  const digest = createHash("sha256")
    .update(JSON.stringify(["finance-attention:v1", run.userId, scope]))
    .digest("hex");
  const variant = ((Number.parseInt(digest[16] ?? "0", 16) & 3) | 8).toString(16);
  const id = `${digest.slice(0, 8)}-${digest.slice(8, 12)}-8${digest.slice(13, 16)}-${variant}${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
  const settled = run.settledResult as { code?: unknown } | null;
  const code =
    typeof settled?.code === "string"
      ? settled.code
      : (run.lastSafeError?.code ?? "finance_maintenance_attention");
  return {
    domain: "finances",
    kind: "repair",
    id,
    revision: run.id,
    actionRevision: `sha256:${createHash("sha256")
      .update(JSON.stringify(["finance-attention-action:v1", attentionAction(code)]))
      .digest("hex")}`,
  };
}

/** Currentness remains run-bound even when delivery history spans later runs. */
async function resolveRunAttention(
  tx: FinanceTransaction,
  userId: string,
  work: FinanceHumanWorkRef,
): Promise<NotificationResolution> {
  if (!idSchema.safeParse(work.revision).success) return { state: "stale" };
  const [run] = await tx
    .select()
    .from(workspaceMaintenanceRuns)
    .where(
      and(
        eq(workspaceMaintenanceRuns.userId, userId),
        eq(workspaceMaintenanceRuns.id, work.revision),
        eq(workspaceMaintenanceRuns.domain, "finances"),
      ),
    )
    .for("share", { noWait: true });
  if (!run) return { state: "unavailable" };
  const expected = financeRunAttentionWork(run);
  if (work.id !== expected.id || work.actionRevision !== expected.actionRevision)
    return { state: "stale" };
  if (!["blocked", "failed_terminal"].includes(run.status)) return { state: "resolved" };
  const newer = await tx.execute(sql`SELECT id FROM workspace_maintenance_runs
    WHERE user_id=${userId}::uuid AND domain='finances'
    AND (created_at,id)>(${run.createdAt},${run.id}::uuid) LIMIT 1`);
  if (newer.rows.length) return { state: "resolved" };
  return {
    state: "current",
    value: {
      work,
      active: true,
      expiresAt: null,
      disclosure: "minimal",
      context: null,
      occurredAt: null,
      destination: "/finances?review=open",
    },
  };
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
    // Serialize the run/question snapshot with the domain's canonical mutation gate.
    if (refs.some((ref) => ref.kind === "repair")) await lockFinanceExecutionOwner(tx, userId);
    await admitContextualOwner(tx, userId);
    const ids = refs.filter((r) => r.kind === "question").map((r) => r.id.toLowerCase());
    if (!ids.length && !refs.some((ref) => ref.kind === "approval" || ref.kind === "repair"))
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
    for (const ref of refs) {
      const result =
        ref.kind === "repair"
          ? await resolveRunAttention(tx, userId, ref)
          : ref.kind === "approval"
            ? await resolveSmsApproval(userId, ref, tx)
            : (resultMap.get(ref.id.toLowerCase()) ??
              (await resolveMaintenanceReviewQuestion(userId, ref, tx)));
      // The SMS answer port also returns a private prompt. Notification resolution is strict
      // and must expose only its own contract; keep the answer-port shape unchanged.
      results.push(result.state === "current" ? { state: "current", value: result.value } : result);
    }
    const currentQuestionRuns = new Set<string>();
    for (const [index, ref] of refs.entries()) {
      if (ref.kind !== "question" || results[index]?.state !== "current") continue;
      const caseId = manual.find((q) => q.id === ref.id)?.reviewCaseId ?? ref.id;
      const lineage = reviews.find((review) => review.id === caseId)?.evidence.maintenanceRunId;
      if (typeof lineage === "string") currentQuestionRuns.add(lineage);
    }
    return results.map((result, index) =>
      refs[index]?.kind === "repair" &&
      result.state === "current" &&
      currentQuestionRuns.has(refs[index]?.revision ?? "")
        ? { state: "resolved" }
        : result,
    );
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
