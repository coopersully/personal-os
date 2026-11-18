import {
  type Database,
  financeMaintenanceCandidates,
  financeMaintenanceExecutionBindings,
  workspaceMaintenanceRuns,
} from "@personal-os/database";
import { FINANCE_CONVERSATION_PROTOCOL_VERSION } from "@personal-os/domain";
import { and, eq, ne, sql } from "drizzle-orm";
import { AppError } from "../errors.js";
import type { FinanceExecutionFence } from "./execution-binding.js";
import { requireFinanceExecutionGuard } from "./execution-owner-guard.js";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
export type FinanceDerivedCompletionClaim = {
  claimId: string;
  financeExecution: FinanceExecutionFence;
};
/** Internal scheduler capability. It cannot authorize or replay an economic action. */
export async function assertFinanceDerivedCompletionClaim(
  tx: Transaction,
  userId: string,
  runId: string,
  claim: FinanceDerivedCompletionClaim,
) {
  requireFinanceExecutionGuard(tx, userId);
  const [current] = await tx
    .select({ id: workspaceMaintenanceRuns.id })
    .from(workspaceMaintenanceRuns)
    .where(
      and(
        eq(workspaceMaintenanceRuns.userId, userId),
        eq(workspaceMaintenanceRuns.id, runId),
        eq(workspaceMaintenanceRuns.domain, "finances"),
        eq(workspaceMaintenanceRuns.status, "running"),
        eq(workspaceMaintenanceRuns.leaseClaimId, claim.claimId),
        sql`${workspaceMaintenanceRuns.leaseExpiresAt}>clock_timestamp()`,
      ),
    )
    .for("update");
  if (!current)
    throw new AppError(
      "conflict",
      "The exact derived-completion scheduler claim expired or changed.",
    );
  const [binding] = await tx
    .select({ id: financeMaintenanceExecutionBindings.id })
    .from(financeMaintenanceExecutionBindings)
    .innerJoin(
      financeMaintenanceCandidates,
      and(
        eq(financeMaintenanceCandidates.id, financeMaintenanceExecutionBindings.candidateId),
        eq(financeMaintenanceCandidates.userId, userId),
        eq(
          financeMaintenanceCandidates.revision,
          financeMaintenanceExecutionBindings.candidateRevision,
        ),
        ne(financeMaintenanceCandidates.state, "superseded"),
      ),
    )
    .where(
      and(
        eq(financeMaintenanceExecutionBindings.userId, userId),
        eq(financeMaintenanceExecutionBindings.runId, runId),
        eq(
          financeMaintenanceExecutionBindings.protocolVersion,
          FINANCE_CONVERSATION_PROTOCOL_VERSION,
        ),
        eq(
          financeMaintenanceExecutionBindings.currentActorId,
          claim.financeExecution.currentActorId,
        ),
        eq(
          financeMaintenanceExecutionBindings.bindingRevision,
          BigInt(claim.financeExecution.bindingRevision),
        ),
      ),
    );
  if (!binding) throw new AppError("conflict", "The derived-completion execution fence changed.");
}
