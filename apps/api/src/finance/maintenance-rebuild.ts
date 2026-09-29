import {
  type Database,
  financeAgentActionReviews,
  financeMaintenanceCandidates,
  financePeriodReviews,
  financeReviewCases,
  workspaceMaintenanceRuns,
  workspaceMaintenanceSteps,
} from "@personal-os/database";
import { and, eq, inArray, ne, sql } from "drizzle-orm";

type FinanceWriteExecutor = Parameters<Parameters<Database["transaction"]>[0]>[0];

const activeStatuses = [
  "queued",
  "running",
  "awaiting_agent_challenge",
  "awaiting_approval",
  "blocked",
  "failed_recoverable",
] as const;

const lineageStatuses = [...activeStatuses, "completed_with_questions"] as const;

export type FinanceMaintenanceLineage = {
  candidateId: string;
  candidateRevision: string;
  runId: string;
};

export function financeMaintenanceLineage(
  evidence: Record<string, unknown>,
): FinanceMaintenanceLineage | null {
  return typeof evidence.candidateId === "string" &&
    typeof evidence.candidateRevision === "string" &&
    typeof evidence.maintenanceRunId === "string"
    ? {
        candidateId: evidence.candidateId,
        candidateRevision: evidence.candidateRevision,
        runId: evidence.maintenanceRunId,
      }
    : null;
}

export async function lockFinanceMaintenanceLineage(
  tx: FinanceWriteExecutor,
  userId: string,
  lineage: FinanceMaintenanceLineage,
) {
  const [run] = await tx
    .select()
    .from(workspaceMaintenanceRuns)
    .where(
      and(
        eq(workspaceMaintenanceRuns.id, lineage.runId),
        eq(workspaceMaintenanceRuns.userId, userId),
        eq(workspaceMaintenanceRuns.domain, "finances"),
        inArray(workspaceMaintenanceRuns.status, [...lineageStatuses]),
      ),
    )
    .for("update")
    .limit(1);
  if (!run) return null;
  const [candidate] = await tx
    .select({ id: financeMaintenanceCandidates.id })
    .from(financeMaintenanceCandidates)
    .where(
      and(
        eq(financeMaintenanceCandidates.id, lineage.candidateId),
        eq(financeMaintenanceCandidates.runId, lineage.runId),
        eq(financeMaintenanceCandidates.userId, userId),
        eq(financeMaintenanceCandidates.revision, lineage.candidateRevision),
        eq(financeMaintenanceCandidates.state, "challenged"),
      ),
    )
    .limit(1);
  return candidate ? run : null;
}

export async function lockActiveFinanceMaintenanceRun(
  tx: FinanceWriteExecutor,
  userId: string,
  excludeRunId: string,
) {
  const [run] = await tx
    .select()
    .from(workspaceMaintenanceRuns)
    .where(
      and(
        eq(workspaceMaintenanceRuns.userId, userId),
        eq(workspaceMaintenanceRuns.domain, "finances"),
        ne(workspaceMaintenanceRuns.id, excludeRunId),
        inArray(workspaceMaintenanceRuns.status, [...activeStatuses]),
      ),
    )
    .for("update")
    .limit(1);
  return run ?? null;
}

async function retireIncompatibleActiveRun(
  tx: FinanceWriteExecutor,
  userId: string,
  runId: string,
  now: Date,
) {
  await tx
    .update(financeMaintenanceCandidates)
    .set({ state: "superseded", updatedAt: now })
    .where(
      and(
        eq(financeMaintenanceCandidates.runId, runId),
        eq(financeMaintenanceCandidates.userId, userId),
        inArray(financeMaintenanceCandidates.state, [
          "preparing",
          "ready_for_challenge",
          "challenged",
          "awaiting_approval",
          "committing",
        ]),
      ),
    );
  await tx
    .update(financeAgentActionReviews)
    .set({ status: "superseded", updatedAt: now })
    .where(
      and(
        eq(financeAgentActionReviews.userId, userId),
        eq(financeAgentActionReviews.maintenanceRunId, runId),
        eq(financeAgentActionReviews.status, "pending"),
      ),
    );
  await tx
    .update(financeReviewCases)
    .set({
      resolution: {
        rationale: "A broader Finance maintenance successor will rebuild this work.",
        type: "dismiss",
      },
      resolvedAt: now,
      status: "resolved",
      updatedAt: now,
    })
    .where(
      and(
        eq(financeReviewCases.userId, userId),
        inArray(financeReviewCases.status, ["open", "deferred"]),
        sql`${financeReviewCases.evidence}->>'maintenanceRunId' = ${runId}`,
      ),
    );
  await tx
    .update(workspaceMaintenanceRuns)
    .set({
      checkpoint: null,
      lastSafeError: null,
      leaseClaimId: null,
      leaseExpiresAt: null,
      retryAt: null,
      settledResult: {
        reason: "broader_finance_successor_required",
        recovery: "superseded_by_successor",
      },
      status: "failed_terminal",
      updatedAt: now,
    })
    .where(eq(workspaceMaintenanceRuns.id, runId));
}

export async function supersedeFinanceMaintenanceLineage(
  tx: FinanceWriteExecutor,
  userId: string,
  lineage: FinanceMaintenanceLineage,
  now: Date,
  preserveReviewId?: string,
) {
  const run = await lockFinanceMaintenanceLineage(tx, userId, lineage);
  if (!run) return { rebuilt: false as const, successorRunId: null };
  await tx
    .update(financeReviewCases)
    .set({
      resolution: {
        rationale: "The Finance maintenance candidate changed and will be rebuilt.",
        type: "dismiss",
      },
      resolvedAt: now,
      status: "resolved",
      updatedAt: now,
    })
    .where(
      and(
        eq(financeReviewCases.userId, userId),
        inArray(financeReviewCases.status, ["open", "deferred"]),
        sql`${financeReviewCases.evidence}->>'candidateId' = ${lineage.candidateId}`,
        sql`${financeReviewCases.evidence}->>'candidateRevision' = ${lineage.candidateRevision}`,
        ...(preserveReviewId ? [ne(financeReviewCases.id, preserveReviewId)] : []),
      ),
    );
  await tx
    .update(financeMaintenanceCandidates)
    .set({ state: "superseded", updatedAt: now })
    .where(eq(financeMaintenanceCandidates.id, lineage.candidateId));
  const [periodReview] = await tx
    .select({ id: financePeriodReviews.id })
    .from(financePeriodReviews)
    .where(eq(financePeriodReviews.runId, lineage.runId))
    .limit(1);
  if (!periodReview && run.status !== "completed_with_questions") {
    await tx
      .delete(workspaceMaintenanceSteps)
      .where(eq(workspaceMaintenanceSteps.runId, lineage.runId));
    await tx
      .update(workspaceMaintenanceRuns)
      .set({
        checkpoint: {
          candidateId: lineage.candidateId,
          phase: "prepare",
          reason: "candidate_drift",
        },
        lastSafeError: null,
        leaseClaimId: null,
        leaseExpiresAt: null,
        retryAt: null,
        status: "queued",
        updatedAt: now,
      })
      .where(eq(workspaceMaintenanceRuns.id, lineage.runId));
    return { rebuilt: true as const, successorRunId: null };
  }
  if (run.status !== "completed_with_questions") {
    await tx
      .update(workspaceMaintenanceRuns)
      .set({
        checkpoint: null,
        lastSafeError: null,
        leaseClaimId: null,
        leaseExpiresAt: null,
        retryAt: null,
        settledResult: {
          reason: "candidate_drift_after_period_review",
          recovery: "superseded_by_successor",
        },
        status: "failed_terminal",
        updatedAt: now,
      })
      .where(eq(workspaceMaintenanceRuns.id, lineage.runId));
  }
  let successorScope = run.scope;
  let successorRulebookVersion = run.rulebookVersion;
  const existingActive = await lockActiveFinanceMaintenanceRun(tx, userId, lineage.runId);
  if (existingActive) {
    if (
      existingActive.scope.type === "all_outstanding" &&
      existingActive.rulebookVersion === run.rulebookVersion
    ) {
      return { rebuilt: true as const, successorRunId: existingActive.id };
    }
    await retireIncompatibleActiveRun(tx, userId, existingActive.id, now);
    successorScope = { type: "all_outstanding" };
    successorRulebookVersion = existingActive.rulebookVersion;
  }
  let [successor] = await tx
    .insert(workspaceMaintenanceRuns)
    .values({
      domain: run.domain,
      rulebookVersion: successorRulebookVersion,
      scope: successorScope,
      status: "queued",
      userId,
    })
    .onConflictDoNothing()
    .returning({ id: workspaceMaintenanceRuns.id });
  if (successor) return { rebuilt: true as const, successorRunId: successor.id };
  const concurrent = await lockActiveFinanceMaintenanceRun(tx, userId, lineage.runId);
  if (!concurrent) throw new Error("The successor Finance maintenance run was not created.");
  if (
    concurrent.scope.type === "all_outstanding" &&
    concurrent.rulebookVersion === run.rulebookVersion
  ) {
    return { rebuilt: true as const, successorRunId: concurrent.id };
  }
  await retireIncompatibleActiveRun(tx, userId, concurrent.id, now);
  [successor] = await tx
    .insert(workspaceMaintenanceRuns)
    .values({
      domain: "finances",
      rulebookVersion: concurrent.rulebookVersion,
      scope: { type: "all_outstanding" },
      status: "queued",
      userId,
    })
    .returning({ id: workspaceMaintenanceRuns.id });
  if (!successor) throw new Error("The successor Finance maintenance run was not created.");
  return { rebuilt: true as const, successorRunId: successor.id };
}
