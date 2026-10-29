import { createHash } from "node:crypto";
import {
  accessTokens,
  type Database,
  financeMaintenanceCandidates,
  financeMaintenanceExecutionBindings,
  financeMaintenanceExecutionReceipts,
  financeMutationRecords,
  workspaceMaintenanceRuns,
} from "@personal-os/database";
import {
  FINANCE_CONVERSATION_PROTOCOL_VERSION,
  type FinanceMaintenanceExecutionObservation,
  type FinanceMaintenanceExecutionRefreshResult,
  financeMaintenanceExecutionRefreshResultSchema,
  refreshFinanceMaintenanceExecutionInputSchema,
} from "@personal-os/domain";
import { and, eq, isNull, ne } from "drizzle-orm";
import { AppError } from "../errors.js";
import { stableFinanceActionInput } from "../finance-action-identity.js";
import { readOAuthActorLineage } from "../oauth-actor-lineage.js";
import type { Principal } from "../types.js";
import { requireWorkspaceExecution } from "../workspace-execution.js";
import { executeFinanceAdmittedMutation, loadFinanceAuthorization } from "./context.js";
import { requireFinanceEffectMessageProof } from "./conversation-causality.js";
import {
  financeExecutionDecisionTime,
  withFinanceExecutionOwner,
} from "./execution-owner-guard.js";

type PreparedRefresh = {
  result: FinanceMaintenanceExecutionRefreshResult | null;
  binding: typeof financeMaintenanceExecutionBindings.$inferSelect | null;
};

export function createFinanceMaintenanceExecutionService({ db }: { db: Database }) {
  return {
    async readMaintenanceExecutionAuthorization(
      principal: Principal,
      runId: string,
    ): Promise<FinanceMaintenanceExecutionObservation> {
      if (principal.actorType !== "agent" || !principal.scopes.has("finances:maintain"))
        throw new AppError("forbidden", "Use the original authenticated Finance host.");
      return withFinanceExecutionOwner(
        db,
        principal.userId,
        {
          actorIds: [principal.actorId],
          runIds: [runId],
          connectionIds: principal.authorizationConnectionId
            ? [principal.authorizationConnectionId]
            : [],
        },
        async (tx) => {
          const at = await financeExecutionDecisionTime(tx);
          const [run] = await tx
            .select()
            .from(workspaceMaintenanceRuns)
            .where(
              and(
                eq(workspaceMaintenanceRuns.userId, principal.userId),
                eq(workspaceMaintenanceRuns.id, runId),
                eq(workspaceMaintenanceRuns.domain, "finances"),
              ),
            )
            .for("share");
          const [caller] = await tx
            .select({ audience: accessTokens.audience, clientId: accessTokens.clientId })
            .from(accessTokens)
            .where(
              and(
                eq(accessTokens.userId, principal.userId),
                eq(accessTokens.id, principal.actorId),
              ),
            );
          if (!run || !caller?.audience || !caller.clientId)
            throw new AppError("forbidden", "Canonical original-host authorization is required.");
          await requireWorkspaceExecution(tx, principal, "finances", at);
          await requireFinanceEffectMessageProof(tx, run, principal, at);
          const [binding] = await tx
            .select()
            .from(financeMaintenanceExecutionBindings)
            .innerJoin(
              financeMaintenanceCandidates,
              and(
                eq(
                  financeMaintenanceCandidates.id,
                  financeMaintenanceExecutionBindings.candidateId,
                ),
                eq(financeMaintenanceCandidates.userId, financeMaintenanceExecutionBindings.userId),
                eq(
                  financeMaintenanceCandidates.revision,
                  financeMaintenanceExecutionBindings.candidateRevision,
                ),
              ),
            )
            .where(
              and(
                eq(financeMaintenanceExecutionBindings.userId, principal.userId),
                eq(financeMaintenanceExecutionBindings.runId, runId),
                ne(financeMaintenanceCandidates.state, "superseded"),
              ),
            );
          if (!binding) return { state: "unavailable", reason: "binding_unavailable" };
          const saved = binding.finance_maintenance_execution_bindings;
          if (saved.protocolVersion !== FINANCE_CONVERSATION_PROTOCOL_VERSION)
            throw new AppError("forbidden", "The original candidate protocol version changed.");
          const lineage = await readOAuthActorLineage(tx, {
            ownerId: principal.userId,
            ancestorActorId: saved.currentActorId,
            currentActorId: principal.actorId,
            audience: caller.audience,
          });
          if (!lineage)
            throw new AppError(
              "forbidden",
              "This actor has no canonical lineage from the saved execution authorization.",
            );
          return {
            state: "available",
            runId,
            candidateId: saved.candidateId,
            candidateRevision: saved.candidateRevision,
            currentActorId: saved.currentActorId,
            bindingRevision: saved.bindingRevision.toString(),
            runUpdatedAt: run.updatedAt.toISOString(),
            status: run.status,
            leaseExpiresAt: run.leaseExpiresAt?.toISOString() ?? null,
          };
        },
      );
    },
    async refreshMaintenanceExecutionAuthorization(
      principal: Principal,
      runId: string,
      raw: unknown,
    ): Promise<FinanceMaintenanceExecutionRefreshResult> {
      const input = refreshFinanceMaintenanceExecutionInputSchema.parse(raw);
      if (principal.actorType !== "agent" || !principal.scopes.has("finances:maintain"))
        throw new AppError("forbidden", "Use the original authenticated maintenance host.");
      return withFinanceExecutionOwner(
        db,
        principal.userId,
        {
          actorIds: [principal.actorId, input.expectedCurrentActorId],
          runIds: [runId],
          connectionIds: principal.authorizationConnectionId
            ? [principal.authorizationConnectionId]
            : [],
        },
        async (tx) => {
          const at = await financeExecutionDecisionTime(tx);
          const [caller] = await tx
            .select({
              clientId: accessTokens.clientId,
              audience: accessTokens.audience,
              connectionId: accessTokens.authorizationConnectionId,
            })
            .from(accessTokens)
            .where(
              and(
                eq(accessTokens.userId, principal.userId),
                eq(accessTokens.id, principal.actorId),
              ),
            );
          const [run] = await tx
            .select()
            .from(workspaceMaintenanceRuns)
            .where(
              and(
                eq(workspaceMaintenanceRuns.userId, principal.userId),
                eq(workspaceMaintenanceRuns.id, runId),
                eq(workspaceMaintenanceRuns.domain, "finances"),
              ),
            )
            .for("update");
          if (!caller?.clientId || !caller.audience || !run)
            throw new AppError(
              "forbidden",
              "Canonical OAuth maintenance authorization is required.",
            );
          await requireWorkspaceExecution(tx, principal, "finances", at);
          await requireFinanceEffectMessageProof(tx, run, principal, at);
          const audience = caller.audience;
          const payload = { ...input, runId, caller };
          const authority = await loadFinanceAuthorization({
            db: tx,
            principal,
            requestId: input.operationId,
          });
          return executeFinanceAdmittedMutation<
            PreparedRefresh,
            FinanceMaintenanceExecutionRefreshResult
          >(
            tx,
            authority,
            {
              idempotencyKey: input.operationId,
              operation: "refresh_finance_maintenance_execution_v1",
              payload,
              sourceKind: "agent",
            },
            async () => {
              const pending = (
                reason: "active_claim" | "control_progression",
              ): FinanceMaintenanceExecutionRefreshResult => ({
                state: "pending",
                operationId: input.operationId,
                reason,
                retryAt: run.leaseExpiresAt?.toISOString() ?? null,
              });
              if (run.leaseClaimId || run.leaseExpiresAt)
                return {
                  state: "admitted",
                  prepared: {
                    result: pending(
                      run.status === "running" && run.leaseExpiresAt && run.leaseExpiresAt > at
                        ? "active_claim"
                        : "control_progression",
                    ),
                    binding: null,
                  },
                };
              const [binding] = await tx
                .select()
                .from(financeMaintenanceExecutionBindings)
                .where(
                  and(
                    eq(financeMaintenanceExecutionBindings.userId, principal.userId),
                    eq(financeMaintenanceExecutionBindings.runId, runId),
                    eq(financeMaintenanceExecutionBindings.candidateId, input.candidateId),
                    eq(
                      financeMaintenanceExecutionBindings.candidateRevision,
                      input.candidateRevision,
                    ),
                  ),
                )
                .for("update");
              const blocked = (
                reason: "binding_unavailable" | "lineage_unproven" | "terminal_or_superseded",
              ): FinanceMaintenanceExecutionRefreshResult => ({
                state: "blocked",
                operationId: input.operationId,
                reason,
              });
              if (!binding)
                return {
                  state: "admitted",
                  prepared: { result: blocked("binding_unavailable"), binding: null },
                };
              if (binding.protocolVersion !== FINANCE_CONVERSATION_PROTOCOL_VERSION)
                throw new AppError("forbidden", "The original candidate protocol version changed.");
              const [candidate] = await tx
                .select()
                .from(financeMaintenanceCandidates)
                .where(
                  and(
                    eq(financeMaintenanceCandidates.userId, principal.userId),
                    eq(financeMaintenanceCandidates.id, input.candidateId),
                    eq(financeMaintenanceCandidates.runId, runId),
                  ),
                )
                .for("update");
              const checkpoint = run.checkpoint as {
                candidateId?: string;
                revision?: string;
                phase?: string;
              } | null;
              if (
                !candidate ||
                candidate.revision !== input.candidateRevision ||
                !["challenged", "awaiting_approval"].includes(candidate.state) ||
                !["awaiting_agent_challenge", "awaiting_approval"].includes(run.status)
              )
                return {
                  state: "admitted",
                  prepared: { result: blocked("terminal_or_superseded"), binding: null },
                };
              if (
                binding.currentActorId !== input.expectedCurrentActorId ||
                binding.bindingRevision.toString() !== input.expectedBindingRevision ||
                run.updatedAt.toISOString() !== input.expectedRunUpdatedAt ||
                checkpoint?.candidateId !== candidate.id ||
                checkpoint.revision !== candidate.revision ||
                checkpoint.phase !== (run.status === "awaiting_approval" ? "approval" : "challenge")
              )
                throw new AppError(
                  "conflict",
                  "Read the current candidate execution state before a NEW refresh operation.",
                );
              if (
                binding.authorizationConnectionId !== caller.connectionId ||
                binding.automationScheduleId !== run.automationScheduleId ||
                binding.authorizationConnectionId !== run.authorizationConnectionId
              )
                throw new AppError(
                  "forbidden",
                  "Execution refresh cannot replace the original host binding.",
                );
              const lineage = await readOAuthActorLineage(tx, {
                ownerId: principal.userId,
                ancestorActorId: binding.currentActorId,
                currentActorId: principal.actorId,
                audience,
              });
              if (!lineage || lineage.actorIds.length < 2)
                return {
                  state: "admitted",
                  prepared: { result: blocked("lineage_unproven"), binding: null },
                };
              return { state: "admitted", prepared: { result: null, binding } };
            },
            async (_executor, prepared) => {
              if (prepared.result) return prepared.result;
              const binding = prepared.binding;
              if (!binding)
                throw new AppError("internal_error", "The execution binding was not admitted.");
              const committedAt = await financeExecutionDecisionTime(tx);
              await requireWorkspaceExecution(tx, principal, "finances", committedAt);
              await requireFinanceEffectMessageProof(tx, run, principal, committedAt);
              const [command] = await tx
                .select({ id: financeMutationRecords.id })
                .from(financeMutationRecords)
                .where(
                  and(
                    eq(financeMutationRecords.userId, principal.userId),
                    eq(financeMutationRecords.idempotencyKey, input.operationId),
                    eq(
                      financeMutationRecords.operation,
                      "refresh_finance_maintenance_execution_v1",
                    ),
                    eq(financeMutationRecords.actorId, principal.actorId),
                    eq(financeMutationRecords.status, "started"),
                  ),
                );
              if (!command)
                throw new AppError(
                  "internal_error",
                  "The canonical execution refresh command was not admitted.",
                );
              await tx.insert(financeMaintenanceExecutionReceipts).values({
                id: command.id,
                userId: principal.userId,
                bindingId: binding.id,
                fromActorId: binding.currentActorId,
                toActorId: principal.actorId,
                fromRevision: binding.bindingRevision,
                toRevision: binding.bindingRevision + 1n,
                fingerprint: createHash("sha256")
                  .update(stableFinanceActionInput(payload))
                  .digest("hex"),
                createdAt: committedAt,
              });
              const [changed] = await tx
                .update(financeMaintenanceExecutionBindings)
                .set({
                  currentActorId: principal.actorId,
                  bindingRevision: binding.bindingRevision + 1n,
                  updatedAt: committedAt,
                })
                .where(
                  and(
                    eq(financeMaintenanceExecutionBindings.id, binding.id),
                    eq(financeMaintenanceExecutionBindings.userId, principal.userId),
                    eq(financeMaintenanceExecutionBindings.currentActorId, binding.currentActorId),
                    eq(
                      financeMaintenanceExecutionBindings.bindingRevision,
                      binding.bindingRevision,
                    ),
                  ),
                )
                .returning();
              if (!changed)
                throw new AppError("conflict", "The execution binding changed before refresh.");
              const [updatedRun] = await tx
                .update(workspaceMaintenanceRuns)
                .set({ updatedAt: committedAt })
                .where(
                  and(
                    eq(workspaceMaintenanceRuns.id, run.id),
                    eq(workspaceMaintenanceRuns.userId, principal.userId),
                    isNull(workspaceMaintenanceRuns.leaseClaimId),
                    isNull(workspaceMaintenanceRuns.leaseExpiresAt),
                  ),
                )
                .returning({ id: workspaceMaintenanceRuns.id });
              if (!updatedRun)
                throw new AppError(
                  "conflict",
                  "A running lease cannot be changed by execution refresh.",
                );
              return financeMaintenanceExecutionRefreshResultSchema.parse({
                state: "refreshed",
                operationId: input.operationId,
                bindingId: binding.id,
                bindingRevision: changed.bindingRevision.toString(),
                currentActorId: principal.actorId,
              });
            },
          );
        },
      );
    },
  };
}
