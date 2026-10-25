import {
  type Database,
  financeAgentActionReviews,
  financeMaintenanceCandidates,
  financeMaintenanceExecutionBindings,
  financeTransactionRelationships,
  financeTransactionRevisions,
  type workspaceMaintenanceRuns,
  workspaceMaintenanceSteps,
} from "@personal-os/database";
import { and, eq, ne, sql } from "drizzle-orm";
import { postgresConversationBatchStore } from "./conversation-service.js";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

/** Caller holds the owner's execution and maintenance locks plus the run's row lock. */
export async function canRecoverFinancePreflight(
  tx: Transaction,
  run: typeof workspaceMaintenanceRuns.$inferSelect,
): Promise<boolean> {
  const checkpoint = run.checkpoint as { completedStep?: unknown } | null;
  if (
    run.status !== "blocked" ||
    run.sourceSnapshot !== null ||
    checkpoint?.completedStep !== "preflight"
  )
    return false;
  const steps = await tx
    .select()
    .from(workspaceMaintenanceSteps)
    .where(eq(workspaceMaintenanceSteps.runId, run.id));
  if (steps.length !== 1 || steps[0]?.stepName !== "preflight" || steps[0]?.status !== "completed")
    return false;
  const [candidate] = await tx
    .select({ id: financeMaintenanceCandidates.id })
    .from(financeMaintenanceCandidates)
    .where(eq(financeMaintenanceCandidates.runId, run.id))
    .limit(1);
  const [binding] = await tx
    .select({ runId: financeMaintenanceExecutionBindings.runId })
    .from(financeMaintenanceExecutionBindings)
    .where(eq(financeMaintenanceExecutionBindings.runId, run.id))
    .limit(1);
  const [action] = await tx
    .select({ id: financeAgentActionReviews.id })
    .from(financeAgentActionReviews)
    .where(
      and(
        eq(financeAgentActionReviews.maintenanceRunId, run.id),
        ne(financeAgentActionReviews.actionKind, "question"),
      ),
    )
    .limit(1);
  const [revision] = await tx
    .select({ id: financeTransactionRevisions.id })
    .from(financeTransactionRevisions)
    .where(
      and(
        eq(financeTransactionRevisions.userId, run.userId),
        sql`${financeTransactionRevisions.provenance}->>'maintenanceRunId' = ${run.id}`,
      ),
    )
    .limit(1);
  const [relationship] = await tx
    .select({ id: financeTransactionRelationships.id })
    .from(financeTransactionRelationships)
    .where(
      and(
        eq(financeTransactionRelationships.userId, run.userId),
        sql`${financeTransactionRelationships.provenance}->>'maintenanceRunId' = ${run.id}`,
      ),
    )
    .limit(1);
  const batch = await postgresConversationBatchStore.findBatch(tx, run.userId, run.id);
  return !candidate && !binding && !action && !revision && !relationship && !batch;
}
