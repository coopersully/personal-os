import {
  accessTokens,
  type Database,
  financeMaintenanceExecutionBindings,
  type workspaceMaintenanceRuns,
} from "@personal-os/database";
import { FINANCE_CONVERSATION_PROTOCOL_VERSION } from "@personal-os/domain";
import { and, eq } from "drizzle-orm";
import { AppError } from "../errors.js";
import { readOAuthActorLineage } from "../oauth-actor-lineage.js";
import type { Principal } from "../types.js";
import { requireWorkspaceExecution } from "../workspace-execution.js";
import {
  loadFinanceEffectPrincipal,
  requireFinanceEffectMessageProof,
} from "./conversation-causality.js";
import {
  financeExecutionDecisionTime,
  requireFinanceExecutionGuard,
} from "./execution-owner-guard.js";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
export type FinanceExecutionFence = { bindingRevision: string; currentActorId: string };
export async function initializeFinanceExecutionBinding(
  tx: Transaction,
  input: {
    run: typeof workspaceMaintenanceRuns.$inferSelect;
    candidateId: string;
    candidateRevision: string;
    submittedFromRevision: string;
    fingerprint: string;
    principal: Principal;
    at: Date;
  },
) {
  const { run, principal } = input;
  requireFinanceExecutionGuard(tx, run.userId);
  if (!run.automationScheduleId || !run.authorizationConnectionId) return;
  if (
    principal.userId !== run.userId ||
    principal.actorType !== "agent" ||
    principal.authorizationConnectionId !== run.authorizationConnectionId
  )
    throw new AppError(
      "forbidden",
      "Only the actual submitting host can initialize execution attribution.",
    );
  await tx
    .insert(financeMaintenanceExecutionBindings)
    .values({
      userId: run.userId,
      runId: run.id,
      candidateId: input.candidateId,
      candidateRevision: input.candidateRevision,
      submittedFromRevision: input.submittedFromRevision,
      submissionFingerprint: input.fingerprint,
      originalActorId: principal.actorId,
      currentActorId: principal.actorId,
      bindingRevision: 1n,
      automationScheduleId: run.automationScheduleId,
      authorizationConnectionId: run.authorizationConnectionId,
      protocolVersion: FINANCE_CONVERSATION_PROTOCOL_VERSION,
      createdAt: input.at,
      updatedAt: input.at,
    })
    .onConflictDoNothing();
  const [binding] = await tx
    .select()
    .from(financeMaintenanceExecutionBindings)
    .where(
      and(
        eq(financeMaintenanceExecutionBindings.userId, run.userId),
        eq(financeMaintenanceExecutionBindings.candidateId, input.candidateId),
        eq(financeMaintenanceExecutionBindings.candidateRevision, input.candidateRevision),
      ),
    );
  if (
    !binding ||
    binding.runId !== run.id ||
    binding.originalActorId !== principal.actorId ||
    binding.submissionFingerprint !== input.fingerprint ||
    binding.submittedFromRevision !== input.submittedFromRevision ||
    binding.protocolVersion !== FINANCE_CONVERSATION_PROTOCOL_VERSION
  )
    throw new AppError(
      "conflict",
      "The execution binding already has different original submission evidence.",
    );
}
export async function loadCandidateExecutionPrincipal(
  tx: Transaction,
  run: typeof workspaceMaintenanceRuns.$inferSelect,
  candidateId: string,
  candidateRevision: string,
  supplied: Principal,
  options: {
    fence?: FinanceExecutionFence | undefined;
    humanApproval?: Principal | undefined;
    serverHandoff?: boolean | undefined;
    requireExecution: boolean;
    receiptOnly?: boolean;
    successorReceiptRead?: boolean;
  },
) {
  requireFinanceExecutionGuard(tx, run.userId);
  const at = await financeExecutionDecisionTime(tx);
  // Only the canonical approve-each path supplies this authenticated owner principal.
  // Exact approval replaces standing bypass consent, never the agent's live grant.
  const exactHuman =
    options.humanApproval?.actorType === "user" &&
    options.humanApproval.userId === run.userId &&
    options.humanApproval.actorId === run.userId;
  const requirePolicy = options.requireExecution && !exactHuman;
  if (!run.authorizationConnectionId && !run.automationScheduleId)
    return loadFinanceEffectPrincipal(tx, run, supplied, at, requirePolicy);
  const [binding] = await tx
    .select()
    .from(financeMaintenanceExecutionBindings)
    .where(
      and(
        eq(financeMaintenanceExecutionBindings.userId, run.userId),
        eq(financeMaintenanceExecutionBindings.runId, run.id),
        eq(financeMaintenanceExecutionBindings.candidateId, candidateId),
        eq(financeMaintenanceExecutionBindings.candidateRevision, candidateRevision),
      ),
    )
    .for("share");
  async function loadBoundPrincipal(principal: Principal, executionPolicy: boolean) {
    const decisionTime = await financeExecutionDecisionTime(tx);
    const current = await loadFinanceEffectPrincipal(tx, run, principal, decisionTime, false);
    if (
      !(["finances:maintain", "finances:write", "finances:execute"] as const).every((scope) =>
        current.scopes.has(scope),
      )
    )
      throw new AppError(
        "forbidden",
        "The bound Finance execution grant requires maintain, write and execute access.",
      );
    // A bound run requires its current original-host proof even when it captured no messages.
    await requireFinanceEffectMessageProof(tx, run, current, decisionTime);
    if (binding && current.actorId !== binding.originalActorId) {
      const [token] = await tx
        .select({ audience: accessTokens.audience })
        .from(accessTokens)
        .where(and(eq(accessTokens.userId, run.userId), eq(accessTokens.id, current.actorId)));
      if (
        !token?.audience ||
        !(await readOAuthActorLineage(tx, {
          ownerId: run.userId,
          ancestorActorId: binding.originalActorId,
          currentActorId: current.actorId,
          audience: token.audience,
        }))
      )
        throw new AppError(
          "forbidden",
          "The bound Finance execution actor has no canonical original-actor lineage.",
        );
    }
    if (executionPolicy) await requireWorkspaceExecution(tx, current, "finances", decisionTime);
    return current;
  }
  // No historical binding backfill; original-host authority still applies to a bound run.
  if (!binding) return loadBoundPrincipal(supplied, requirePolicy);
  if (
    binding.protocolVersion !== FINANCE_CONVERSATION_PROTOCOL_VERSION ||
    binding.automationScheduleId !== run.automationScheduleId ||
    binding.authorizationConnectionId !== run.authorizationConnectionId
  )
    throw new AppError("forbidden", "The original candidate host or protocol version changed.");
  if (
    options.receiptOnly &&
    options.successorReceiptRead &&
    supplied.actorType === "agent" &&
    supplied.actorId !== binding.currentActorId
  ) {
    const current = await loadBoundPrincipal(supplied, true);
    const [token] = await tx
      .select({ audience: accessTokens.audience, clientId: accessTokens.clientId })
      .from(accessTokens)
      .where(and(eq(accessTokens.userId, run.userId), eq(accessTokens.id, current.actorId)));
    if (
      !token?.audience ||
      !token.clientId ||
      !(await readOAuthActorLineage(tx, {
        ownerId: run.userId,
        ancestorActorId: binding.currentActorId,
        currentActorId: current.actorId,
        audience: token.audience,
      }))
    )
      throw new AppError(
        "forbidden",
        "Canonical original-actor lineage is required for receipt inspection.",
      );
    return current;
  }
  if (options.fence) {
    if (
      options.fence.bindingRevision !== binding.bindingRevision.toString() ||
      options.fence.currentActorId !== binding.currentActorId
    )
      throw new AppError("conflict", "The maintenance execution fence is stale.");
  } else if (
    !exactHuman &&
    !options.receiptOnly &&
    !options.serverHandoff &&
    !(binding.bindingRevision === 1n && supplied.actorId === binding.currentActorId)
  )
    throw new AppError("conflict", "The current candidate execution fence is required.");
  if (!exactHuman && !options.serverHandoff && supplied.actorId !== binding.currentActorId)
    throw new AppError("forbidden", "An old actor cannot execute the refreshed candidate.");
  if (!options.receiptOnly && (run.leaseClaimId || run.leaseExpiresAt))
    throw new AppError(
      "conflict",
      "Unleased candidate settlement cannot steal an active or expired claim.",
    );
  return loadBoundPrincipal(
    {
      ...supplied,
      actorId: binding.currentActorId,
      actorType: "agent",
      authorizationConnectionId: binding.authorizationConnectionId,
    },
    requirePolicy,
  );
}
