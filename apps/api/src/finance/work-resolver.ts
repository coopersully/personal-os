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
  financeBudgetEvaluationCheckpointSchema,
  financeHumanWorkRefSchema,
  financePositionEvidenceCheckpointSchema,
  idSchema,
  maintenanceScopeSchema,
  type NotificationResolution,
} from "@personal-os/domain";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
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

type AttentionRun = Pick<
  typeof workspaceMaintenanceRuns.$inferSelect,
  "id" | "userId" | "scope" | "lastSafeError" | "settledResult"
>;
function attentionBasis(run: AttentionRun) {
  const settled = run.settledResult as {
    code?: unknown;
    position?: unknown;
    budget?: unknown;
  } | null;
  // Only typed canonical subjects/consequences distinguish targets. Never hash prose,
  // whole evidence revisions, confidence, provider payloads or an invented target ID.
  const position = financePositionEvidenceCheckpointSchema.safeParse(settled?.position);
  const budget = financeBudgetEvaluationCheckpointSchema.safeParse(settled?.budget);
  const targets = {
    position: position.success
      ? { ...position.data.scope, accountIds: [...new Set(position.data.scope.accountIds)].sort() }
      : null,
    budget:
      budget.success && budget.data.evaluations.length
        ? budget.data.evaluations
            .map((item) => ({
              proposal: item.proposal.id,
              policy: item.policy.id,
              plan: item.plan.id,
              outcome: item.outcome,
              reasons: [
                ...new Set(
                  item.reasons.filter((reason) =>
                    [
                      "direction_not_permitted",
                      "protected_release",
                      "protection_floor",
                      "per_change_cap",
                      "monthly_cap",
                      "unbalanced_plan",
                      "amount_overflow",
                    ].includes(reason),
                  ),
                ),
              ].sort(),
            }))
            .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
        : null,
  };
  const code =
    typeof settled?.code === "string"
      ? settled.code
      : (run.lastSafeError?.code ?? "finance_maintenance_attention");
  return { recovery: attentionAction(code), targets };
}

/** Stable owner/scope slot, semantic action code, exact run correlation. Run IDs, wording,
 * timestamps, host rotation and internal progress never create a new required action. */
export function financeRunAttentionWork(
  run: Pick<
    typeof workspaceMaintenanceRuns.$inferSelect,
    "id" | "userId" | "scope" | "lastSafeError" | "settledResult"
  >,
  resolutionId: string | null = null,
): FinanceHumanWorkRef {
  const scope = maintenanceScopeSchema.parse(run.scope);
  const digest = createHash("sha256")
    .update(JSON.stringify(["finance-attention:v1", run.userId, scope]))
    .digest("hex");
  const variant = ((Number.parseInt(digest[16] ?? "0", 16) & 3) | 8).toString(16);
  const id = `${digest.slice(0, 8)}-${digest.slice(8, 12)}-8${digest.slice(13, 16)}-${variant}${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
  const basis = attentionBasis(run);
  return {
    domain: "finances",
    kind: "repair",
    id,
    revision: run.id,
    actionRevision: `sha256:${createHash("sha256")
      .update(
        JSON.stringify([
          "finance-attention-action:v2",
          basis.recovery,
          resolutionId,
          basis.targets,
        ]),
      )
      .digest("hex")}`,
  };
}

/** Derive the episode from retained authoritative run history, even if no scan observed the
 * boundary. Completion of this exact scope resolves it; a different typed action/target starts
 * a different episode. Queued/retry/question waits and manual supersession are not resolution.
 * Read history in bounded pages without an arbitrary lookback cutoff. */
export async function loadFinanceRunAttentionWork(
  tx: FinanceTransaction,
  run: typeof workspaceMaintenanceRuns.$inferSelect,
): Promise<FinanceHumanWorkRef> {
  const basis = attentionBasis(run);
  let anchor = run;
  let before = run;
  const work = (boundary: string | null) =>
    financeRunAttentionWork(
      {
        ...run,
        lastSafeError: anchor.lastSafeError,
        settledResult: anchor.settledResult,
      },
      boundary,
    );
  for (;;) {
    const history = await tx
      .select()
      .from(workspaceMaintenanceRuns)
      .where(
        and(
          eq(workspaceMaintenanceRuns.userId, run.userId),
          eq(workspaceMaintenanceRuns.domain, "finances"),
          inArray(workspaceMaintenanceRuns.status, [
            "completed",
            "completed_with_questions",
            "blocked",
            "failed_terminal",
          ]),
          sql`${workspaceMaintenanceRuns.scope} = ${JSON.stringify(maintenanceScopeSchema.parse(run.scope))}::jsonb`,
          sql`(${workspaceMaintenanceRuns.createdAt},${workspaceMaintenanceRuns.id}) < (${before.createdAt},${before.id}::uuid)`,
        ),
      )
      .orderBy(desc(workspaceMaintenanceRuns.createdAt), desc(workspaceMaintenanceRuns.id))
      .limit(50)
      .for("share", { noWait: true });
    for (const prior of history) {
      const previous = attentionBasis(prior);
      const targetChanged = (["position", "budget"] as const).some(
        (key) =>
          basis.targets[key] !== null &&
          previous.targets[key] !== null &&
          JSON.stringify(basis.targets[key]) !== JSON.stringify(previous.targets[key]),
      );
      if (
        ["completed", "completed_with_questions"].includes(prior.status) ||
        previous.recovery !== basis.recovery ||
        targetChanged
      )
        return work(prior.id);
      // Missing subject evidence is not proof that a target changed. Preserve the earliest
      // compatible episode basis and carry known subjects across incomplete snapshots.
      basis.targets.position ??= previous.targets.position;
      basis.targets.budget ??= previous.targets.budget;
      anchor = prior;
    }
    const last = history.at(-1);
    if (history.length < 50 || !last) return work(null);
    before = last;
  }
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
  const expected = await loadFinanceRunAttentionWork(tx, run);
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
  const requested = batchSchema.parse(raw);
  const refs = [...requested];
  if (new Set(refs.map((r) => r.id.toLowerCase())).size !== refs.length)
    throw new AppError("invalid_request", "Each Finance work item may appear once.");
  try {
    // Serialize the run/question snapshot with the domain's canonical mutation gate.
    if (refs.some((ref) => ref.kind === "repair")) await lockFinanceExecutionOwner(tx, userId);
    await admitContextualOwner(tx, userId);
    // The discovery cursor is not an authority boundary. Gather same-run question refs before
    // ANY account/transaction/review/question locks, then use the normal exact resolvers under
    // the same global parent order. Stale markers remain candidates, never proof of ownership.
    const repairRuns = refs
      .filter((ref) => ref.kind === "repair")
      .map((ref) => ref.revision.toLowerCase())
      .filter((id) => idSchema.safeParse(id).success);
    if (repairRuns.length) {
      const related = await tx
        .select()
        .from(financeReviewCases)
        .where(
          and(
            eq(financeReviewCases.userId, userId),
            eq(financeReviewCases.status, "open"),
            inArray(sql<string>`${financeReviewCases.evidence}->>'maintenanceRunId'`, repairRuns),
          ),
        );
      const contextual = related.length
        ? await tx
            .select()
            .from(financeContextualQuestions)
            .where(
              and(
                eq(financeContextualQuestions.userId, userId),
                eq(financeContextualQuestions.state, "open"),
                inArray(
                  financeContextualQuestions.reviewCaseId,
                  related.map((row) => row.id),
                ),
              ),
            )
        : [];
      const candidates = [
        ...related.flatMap((row) =>
          row.humanAction.state === "open" ? [row.humanAction.request.work] : [],
        ),
        ...contextual.map((row) => ({
          id: row.id,
          domain: "finances",
          kind: "question",
          revision: row.workRevision.toString(),
          actionRevision: row.actionRevision.toString(),
        })),
      ];
      for (const candidate of candidates) {
        const parsed = financeHumanWorkRefSchema.safeParse(candidate);
        if (
          parsed.success &&
          parsed.data.kind === "question" &&
          !refs.some(
            (ref) =>
              ref.id === parsed.data.id &&
              ref.revision === parsed.data.revision &&
              ref.actionRevision === parsed.data.actionRevision,
          )
        )
          refs.push(parsed.data);
      }
    }
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
    const manualLocked = await lockContextualQuestions(tx, userId, [
      ...new Set(manual.map((q) => q.id)),
    ]);
    const results: NotificationResolution[] = [];
    for (const ref of refs) {
      const contextual = manualLocked.get(ref.id.toLowerCase());
      const result =
        ref.kind === "repair"
          ? await resolveRunAttention(tx, userId, ref)
          : ref.kind === "approval"
            ? await resolveSmsApproval(userId, ref, tx)
            : contextual
              ? (await exactContextualAnswer(tx, userId, contextual.question, ref))
                ? { state: "resolved" as const }
                : contextualResolution(contextual, ref)
              : await resolveMaintenanceReviewQuestion(userId, ref, tx);
      // The SMS answer port also returns a private prompt. Notification resolution is strict
      // and must expose only its own contract; keep the answer-port shape unchanged.
      results.push(result.state === "current" ? { state: "current", value: result.value } : result);
    }
    const currentQuestionRuns = new Set<string>();
    for (const [index, ref] of refs.entries()) {
      if (ref.kind !== "question" || results[index]?.state !== "current") continue;
      const caseId =
        manual.find((q) => q.id === ref.id.toLowerCase())?.reviewCaseId ?? ref.id.toLowerCase();
      const lineage = reviews.find((review) => review.id === caseId)?.evidence.maintenanceRunId;
      if (typeof lineage === "string") currentQuestionRuns.add(lineage);
    }
    return results
      .map((result, index) =>
        refs[index]?.kind === "repair" &&
        result.state === "current" &&
        currentQuestionRuns.has(refs[index]?.revision.toLowerCase() ?? "")
          ? { state: "resolved" as const }
          : result,
      )
      .slice(0, requested.length);
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
