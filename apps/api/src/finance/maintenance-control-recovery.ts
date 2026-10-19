import { createHash } from "node:crypto";
import {
  accessTokens,
  type Database,
  financeAgentActionReviews,
  financeLedgerChallenges,
  financeMaintenanceCandidateItems,
  financeMaintenanceCandidates,
  financeMaintenanceExecutionBindings,
  financeMutationRecords,
  workspaceMaintenanceRuns,
  workspaceMaintenanceSteps,
} from "@personal-os/database";
import {
  FINANCE_CONVERSATION_PROTOCOL_VERSION,
  type FinanceMaintenanceControlInput,
  financeConversationEffectReceiptSchema,
} from "@personal-os/domain";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { AppError } from "../errors.js";
import { requireWorkspaceExecution } from "../workspace-execution.js";
import { financeCandidateEffectKey } from "./candidate-effect-receipt.js";
import { requireFinanceEffectMessageProof } from "./conversation-causality.js";
import {
  financeExecutionDecisionTime,
  withFinanceExecutionOwner,
} from "./execution-owner-guard.js";

/** Server-only control mode of the existing run/claim. Never invokes an economic writer. */
export function createFinanceMaintenanceControlRecovery({ db }: { db: Database }) {
  return {
    async resumeFinanceMaintenanceControl(
      input: FinanceMaintenanceControlInput,
      claimId: string,
    ): Promise<{ state: "continue" | "released" | "reconciliation_required"; reason?: string }> {
      const [owner] = await db
        .select({ userId: workspaceMaintenanceRuns.userId })
        .from(workspaceMaintenanceRuns)
        .where(eq(workspaceMaintenanceRuns.id, input.runId));
      if (!owner) throw new AppError("not_found", "The canonical maintenance run is unavailable.");
      return withFinanceExecutionOwner(db, owner.userId, { runIds: [input.runId] }, async (tx) => {
        const [run] = await tx
          .select()
          .from(workspaceMaintenanceRuns)
          .where(
            and(
              eq(workspaceMaintenanceRuns.id, input.runId),
              eq(workspaceMaintenanceRuns.userId, owner.userId),
              eq(workspaceMaintenanceRuns.domain, "finances"),
            ),
          )
          .for("update");
        const at = await financeExecutionDecisionTime(tx);
        if (
          run?.status !== "running" ||
          run.leaseClaimId !== claimId ||
          !run.leaseExpiresAt ||
          run.leaseExpiresAt <= at
        )
          throw new AppError("conflict", "Control recovery requires its exact live server claim.");
        const [candidate] = await tx
          .select()
          .from(financeMaintenanceCandidates)
          .where(
            and(
              eq(financeMaintenanceCandidates.id, input.candidateId),
              eq(financeMaintenanceCandidates.userId, owner.userId),
              eq(financeMaintenanceCandidates.runId, run.id),
            ),
          )
          .for("update");
        if (!candidate || candidate.revision !== input.candidateRevision)
          throw new AppError("conflict", "The control candidate changed.");
        const [binding] = await tx
          .select()
          .from(financeMaintenanceExecutionBindings)
          .where(
            and(
              eq(financeMaintenanceExecutionBindings.userId, owner.userId),
              eq(financeMaintenanceExecutionBindings.candidateId, candidate.id),
              eq(financeMaintenanceExecutionBindings.candidateRevision, candidate.revision),
            ),
          )
          .for("share");
        if (input.kind === "prepared_without_binding") {
          if (binding)
            throw new AppError(
              "conflict",
              "Prepared control cannot invent or ignore an execution binding.",
            );
          return { state: "continue" };
        }
        if (!binding || binding.bindingRevision.toString() !== input.expectedBindingRevision)
          throw new AppError("conflict", "The control execution fence changed.");
        if (binding.protocolVersion !== FINANCE_CONVERSATION_PROTOCOL_VERSION)
          return { state: "reconciliation_required", reason: "protocol_version_changed" };
        const release = async (
          status: "awaiting_agent_challenge" | "awaiting_approval" | "queued",
          checkpoint: Record<string, unknown>,
        ) => {
          const [changed] = await tx
            .update(workspaceMaintenanceRuns)
            .set({
              status,
              checkpoint,
              leaseClaimId: null,
              leaseExpiresAt: null,
              updatedAt: await financeExecutionDecisionTime(tx),
            })
            .where(
              and(
                eq(workspaceMaintenanceRuns.id, run.id),
                eq(workspaceMaintenanceRuns.userId, owner.userId),
                eq(workspaceMaintenanceRuns.status, "running"),
                eq(workspaceMaintenanceRuns.leaseClaimId, claimId),
                sql`${workspaceMaintenanceRuns.leaseExpiresAt}>clock_timestamp()`,
              ),
            )
            .returning({ id: workspaceMaintenanceRuns.id });
          if (!changed) throw new AppError("conflict", "The control claim expired before release.");
        };
        const [receipt] = await tx
          .select()
          .from(financeMutationRecords)
          .where(
            and(
              eq(financeMutationRecords.userId, owner.userId),
              eq(
                financeMutationRecords.idempotencyKey,
                financeCandidateEffectKey(candidate.id, candidate.revision),
              ),
              eq(financeMutationRecords.operation, "commit_finance_candidate_effect_v1"),
              eq(financeMutationRecords.status, "completed"),
            ),
          );
        const parsed = financeConversationEffectReceiptSchema.safeParse(
          receipt?.response?.financeEffectReceipt,
        );
        if (
          candidate.state === "committed" &&
          parsed.success &&
          parsed.data.id === receipt?.id &&
          parsed.data.actor.id === receipt.actorId &&
          parsed.data.actor.type === receipt.actorType &&
          parsed.data.requestId === `finance-candidate-effect:${receipt.id}` &&
          parsed.data.authorizationConnectionId === run.authorizationConnectionId &&
          parsed.data.automationScheduleId === run.automationScheduleId &&
          parsed.data.runId === run.id &&
          parsed.data.candidateId === candidate.id &&
          parsed.data.candidateRevision === candidate.revision
        ) {
          return { state: "continue", reason: "committed_derived_completion" };
        }
        if (candidate.state === "committing" || receipt || candidate.state === "committed")
          return { state: "reconciliation_required", reason: "economic_reconciliation_required" };
        const committedItems = await tx
          .select({ id: financeMaintenanceCandidateItems.id })
          .from(financeMaintenanceCandidateItems)
          .where(
            and(
              eq(financeMaintenanceCandidateItems.candidateId, candidate.id),
              eq(financeMaintenanceCandidateItems.disposition, "committed"),
            ),
          )
          .limit(1);
        if (committedItems.length)
          return { state: "reconciliation_required", reason: "economic_reconciliation_required" };
        const [token] = await tx
          .select()
          .from(accessTokens)
          .where(
            and(eq(accessTokens.userId, owner.userId), eq(accessTokens.id, binding.currentActorId)),
          );
        if (token) {
          try {
            const principal = {
              userId: owner.userId,
              actorId: token.id,
              actorType: "agent" as const,
              authorizationConnectionId: token.authorizationConnectionId,
              scopes: new Set(token.scopes),
            };
            const authorityAt = await financeExecutionDecisionTime(tx);
            await requireWorkspaceExecution(tx, principal, "finances", authorityAt);
            await requireFinanceEffectMessageProof(tx, run, principal, authorityAt);
            return { state: "continue" };
          } catch (error) {
            if (!(error instanceof AppError) || !["forbidden", "conflict"].includes(error.code))
              throw error;
          }
        }
        if (candidate.state === "awaiting_approval") {
          const [review] = await tx
            .select({
              id: financeAgentActionReviews.id,
              payload: financeAgentActionReviews.privatePayload,
              fingerprint: financeAgentActionReviews.fingerprint,
            })
            .from(financeAgentActionReviews)
            .where(
              and(
                eq(financeAgentActionReviews.userId, owner.userId),
                eq(financeAgentActionReviews.maintenanceRunId, run.id),
                eq(financeAgentActionReviews.actionKind, "maintenance_turn"),
                eq(financeAgentActionReviews.expectedRevision, candidate.revision),
                eq(financeAgentActionReviews.status, "pending"),
              ),
            )
            .limit(1);
          const prepared = await tx
            .select({ fingerprint: financeMaintenanceCandidateItems.fingerprint })
            .from(financeMaintenanceCandidateItems)
            .where(
              and(
                eq(financeMaintenanceCandidateItems.candidateId, candidate.id),
                eq(financeMaintenanceCandidateItems.disposition, "prepared"),
              ),
            )
            .orderBy(asc(financeMaintenanceCandidateItems.ordinal));
          const itemFingerprints = prepared.map((item) => item.fingerprint);
          const payload = review?.payload as
            | {
                candidateId?: string;
                expectedRevision?: string;
                runId?: string;
                itemFingerprints?: string[];
              }
            | undefined;
          const expectedFingerprint = `sha256:${createHash("sha256")
            .update(
              JSON.stringify({
                candidateId: candidate.id,
                expectedRevision: candidate.revision,
                items: itemFingerprints,
              }),
            )
            .digest("hex")}`;
          if (
            !review ||
            payload?.candidateId !== candidate.id ||
            payload.runId !== run.id ||
            payload.expectedRevision !== candidate.revision ||
            JSON.stringify(payload.itemFingerprints) !== JSON.stringify(itemFingerprints) ||
            review.fingerprint !== expectedFingerprint
          )
            return { state: "reconciliation_required", reason: "control_evidence_missing" };
          await release("awaiting_approval", {
            candidateId: candidate.id,
            revision: candidate.revision,
            phase: "approval",
          });
          return { state: "released" };
        }
        const [challenge] = await tx
          .select()
          .from(financeLedgerChallenges)
          .where(
            and(
              eq(financeLedgerChallenges.userId, owner.userId),
              eq(financeLedgerChallenges.runId, run.id),
              eq(financeLedgerChallenges.candidateId, candidate.id),
              eq(financeLedgerChallenges.candidateRevision, candidate.revision),
              inArray(financeLedgerChallenges.state, ["submitted", "resolved"]),
            ),
          );
        if (candidate.state !== "challenged" || !challenge?.submittingAgentId)
          return { state: "reconciliation_required", reason: "control_evidence_missing" };
        const [step] = await tx
          .select()
          .from(workspaceMaintenanceSteps)
          .where(
            and(
              eq(workspaceMaintenanceSteps.runId, run.id),
              eq(workspaceMaintenanceSteps.stepName, "challenge_resolve"),
              eq(workspaceMaintenanceSteps.status, "completed"),
            ),
          );
        const saved = step?.safeResult as
          | { candidateId?: string; candidateRevision?: string; questions?: number }
          | undefined;
        if (saved?.candidateId !== candidate.id || saved.candidateRevision !== candidate.revision)
          return { state: "continue", reason: "control_only_challenge_resolve" };
        await release("awaiting_agent_challenge", {
          candidateId: candidate.id,
          revision: candidate.revision,
          phase: "challenge",
        });
        return { state: "released" };
      });
    },
  };
}
