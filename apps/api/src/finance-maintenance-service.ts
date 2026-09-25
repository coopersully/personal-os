import {
  type ApplyFinanceCategorizationsInput,
  type FinanceCategorizationApplyResult,
  type FinanceCategorizationProposalPage,
  type FinanceMaintenanceCandidateItemDraft,
  type FinanceMaintenanceRun,
  type FinancePositionEvidence,
  type FinancePositionEvidenceCheckpoint,
  type FinancePositionReadScope,
  type FinanceStatus,
  financePositionEvidenceCheckpointSchema,
  financePositionFactNames,
  type MaintenanceScope,
} from "@personal-os/domain";
import { AppError } from "./errors.js";
import { financeCandidateActionFingerprint } from "./finance-action-identity.js";
import type { FinanceSyncBatchResult } from "./finance-service.js";
import type { Principal } from "./types.js";
import type { WorkspaceMaintenanceService } from "./workspace-maintenance-service.js";

export const financeMaintenanceSteps = [
  "preflight",
  "synchronize",
  "reconcile",
  "prepare",
  "questions",
  "budget_and_health_projection",
  "challenge_prepare",
  "challenge_resolve",
  "commit_or_queue_review",
  "health_refresh",
  "verify",
  "period_review",
] as const;

/** The candidate-first turn graph used by durable Finance maintenance. */
export const financeCandidateMaintenanceSteps = financeMaintenanceSteps;

type FinanceCandidateMaintenanceStep = (typeof financeCandidateMaintenanceSteps)[number];

type MutationContext = {
  maintenance: {
    idempotencyKey: string;
    policy: "approved_rule";
    rulebookVersion: string;
    runId: string;
  };
  maintenanceClaim: { claimId: string; runId: string };
  principal: Principal;
  requestId: string;
};

export type FinanceMaintenanceOperations = {
  backfillTransactionAllocations?: (limit?: number) => Promise<{
    claimed: boolean;
    complete: boolean;
    inserted: number;
    processed: number;
  }>;
  applyApprovedRules: (
    input: ApplyFinanceCategorizationsInput,
    context: MutationContext,
  ) => Promise<FinanceCategorizationApplyResult[]>;
  applyApprovedOneOffs: (
    input: ApplyFinanceCategorizationsInput,
    context: MutationContext,
  ) => Promise<FinanceCategorizationApplyResult[]>;
  proposeOutstandingCategorizations: (
    userId: string,
    scope: MaintenanceScope,
    cursor?: string,
    onProgress?: () => Promise<void>,
  ) => Promise<FinanceCategorizationProposalPage>;
  prepareMaintenanceCandidate?: (input: {
    items: FinanceMaintenanceCandidateItemDraft[];
    runId: string;
    userId: string;
  }) => Promise<{
    candidateId: string;
    fingerprints: string[];
    prepared: number;
    questions: number;
    revision: string;
  }>;
  beginMaintenanceCandidatePreparation: (input: { runId: string; userId: string }) => Promise<{
    candidateId: string;
    complete: boolean;
    cursor: string | null;
    nextOrdinal: number;
  }>;
  appendMaintenanceCandidatePage: (input: {
    cursor: string | null;
    discoveryRevision: string;
    items: FinanceMaintenanceCandidateItemDraft[];
    nextCursor: string | null;
    runId: string;
    userId: string;
  }) => Promise<{
    candidateId: string;
    nextOrdinal: number;
    status: "appended" | "replayed" | "superseded";
  }>;
  finalizeMaintenanceCandidatePreparation: (input: { runId: string; userId: string }) => Promise<{
    candidateId: string;
    fingerprints: string[];
    prepared: number;
    questions: number;
    revision: string;
  }>;
  getMaintenanceCandidateQuestionContexts: (
    userId: string,
    transactionIds: string[],
  ) => Promise<
    Record<
      string,
      {
        reviewCaseId: string;
        reviewReason: string;
        underlyingAction: "reimbursement" | "transaction";
        why: string;
      }
    >
  >;
  projectMaintenanceCandidateQuestionsForUser: (input: {
    candidateId: string;
    candidateRevision: string;
    context: MutationContext;
    runId: string;
    userId: string;
  }) => Promise<{
    created: number;
    rebuild?: true;
    successorRunId?: string | null;
    total: number;
  }>;
  repairHeuristicTransfersForUser: (
    userId: string,
    scope: MaintenanceScope,
    cursor: string | undefined,
    context: MutationContext,
    onProgress?: () => Promise<void>,
  ) => Promise<{
    complete: boolean;
    inspected: number;
    nextCursor: string | null;
    repaired: number;
  }>;
  reconcileTransfersForUser: (
    userId: string,
    scope: MaintenanceScope,
    context?: MutationContext,
    onProgress?: () => Promise<void>,
  ) => Promise<{ paired: number; transfers: number }>;
  reconcileExactTransfersForUser: (
    userId: string,
    scope: MaintenanceScope,
    context?: MutationContext,
    onProgress?: () => Promise<void>,
  ) => Promise<{ paired: number; transfers: number }>;
  refreshCashflowForUser: (
    userId: string,
    scope: MaintenanceScope,
    context?: MutationContext,
    onProgress?: () => Promise<void>,
  ) => Promise<{ refreshed: boolean }>;
  refreshMaintenanceQuestionsForUser: (
    userId: string,
    scope: MaintenanceScope,
    context?: MutationContext,
    onProgress?: () => Promise<void>,
  ) => Promise<{ created: number; total: number }>;
  syncDueAccountsForUser: (
    userId: string,
    scope: MaintenanceScope,
    context?: MutationContext,
    onProgress?: () => Promise<void>,
  ) => Promise<FinanceSyncBatchResult>;
  summarizeMaintenanceEffectsForRun: (
    userId: string,
    runId: string,
  ) => Promise<{
    categorizations: number;
    duplicateActions: number;
    heuristicTransfersRepaired?: number;
    questionStepCreations?: number;
    questions?: number;
    transfers: number;
  }>;
};

type FinanceStatusReader = {
  getFinanceStatus: (userId: string, scope: MaintenanceScope) => Promise<FinanceStatus>;
};

type Options = {
  actions: {
    settleFinanceMaintenanceCandidate: (
      candidateId: string,
      expectedRevision: string,
      context: { principal: Principal; requestId: string },
    ) => Promise<unknown>;
  };
  challenge: {
    prepare: (userId: string, runId: string, candidateId: string) => Promise<{ id: string }>;
    resolve: (
      userId: string,
      runId: string,
    ) => Promise<{
      candidateId: string;
      candidateRevision: string | undefined;
      questions: number;
      submittingAgentId?: string | null;
    }>;
  };
  finances: FinanceMaintenanceOperations;
  maintenance: WorkspaceMaintenanceService;
  now: () => Date;
  periodReviews: {
    createForRun: (
      userId: string,
      runId: string,
      position: FinancePositionEvidenceCheckpoint,
    ) => Promise<{ id: string; status: string }>;
  };
  position: {
    readPosition: (
      userId: string,
      scope: FinancePositionReadScope,
    ) => Promise<FinancePositionEvidence>;
  };
  status: FinanceStatusReader;
};

export type FinanceMaintenanceDispatchBatchResult = {
  attempted: number;
  claimed: number;
  runs: FinanceMaintenanceRun[];
};

class FinanceRulebookChangedError extends Error {
  public constructor(public readonly currentRulebookVersion: string) {
    super("The Finance rulebook changed while maintenance was running.");
    this.name = "FinanceRulebookChangedError";
  }
}

function mutationContext(
  run: Pick<FinanceMaintenanceRun, "id" | "rulebookVersion" | "userId">,
  step: FinanceCandidateMaintenanceStep,
  claimId: string,
): MutationContext {
  return {
    maintenance: {
      idempotencyKey: `finances:${run.rulebookVersion}:${step}`,
      policy: "approved_rule",
      rulebookVersion: run.rulebookVersion,
      runId: run.id,
    },
    maintenanceClaim: { claimId, runId: run.id },
    principal: {
      actorId: run.userId,
      actorType: "agent",
      scopes: new Set(["finances:read", "finances:write"]),
      userId: run.userId,
    },
    requestId: `maintenance:${run.id}:${step}`,
  };
}

function isEligibleOneOff(
  proposal: FinanceCategorizationProposalPage["items"][number],
): proposal is FinanceCategorizationProposalPage["items"][number] & {
  suggestedCategory: NonNullable<
    FinanceCategorizationProposalPage["items"][number]["suggestedCategory"]
  >;
} {
  return (
    proposal.meetsPolicyThreshold &&
    proposal.suggestedCategory !== null &&
    !proposal.transaction.pending &&
    proposal.transaction.reconciliationStatus !== "candidate" &&
    proposal.transaction.direction !== "transfer"
  );
}

function candidateFingerprint(actionKind: string, input: Record<string, unknown>) {
  return financeCandidateActionFingerprint(actionKind, input);
}

function preparedCandidateItems(
  page: FinanceCategorizationProposalPage,
  questionContexts: Record<
    string,
    {
      reviewCaseId: string;
      reviewReason: string;
      underlyingAction: "reimbursement" | "transaction";
      why: string;
    }
  > = {},
) {
  return page.items.map((proposal) => {
    const sourceRefs = [proposal.source];
    if (!isEligibleOneOff(proposal)) {
      const context = questionContexts[proposal.transaction.id];
      return {
        actionKind: "question" as const,
        disposition: "question" as const,
        evidence: { confidence: proposal.confidence, rationale: proposal.rationale },
        expectedRevision: proposal.transaction.updatedAt,
        fingerprint: candidateFingerprint("question", {
          kind: "question",
          revision: proposal.transaction.updatedAt,
          transactionId: proposal.transaction.id,
        }),
        assumptions: [],
        privatePayload: {
          asOf: proposal.transaction.updatedAt,
          choices: [],
          expectedAnswer: [
            {
              name: "answer",
              nullable: false,
              required: true,
              type:
                context?.underlyingAction === "reimbursement"
                  ? ("object" as const)
                  : ("string" as const),
            },
          ],
          prompt:
            context?.underlyingAction === "reimbursement"
              ? `Is ${proposal.transaction.merchant} personal or reimbursable?`
              : `How should ${proposal.transaction.merchant} be recorded?`,
          transactionId: proposal.transaction.id,
          reviewCaseId: context?.reviewCaseId ?? null,
          reviewReason: context?.reviewReason ?? null,
          underlyingAction: context?.underlyingAction ?? ("categorization" as const),
          why: context?.why ?? proposal.rationale,
        },
        safeChanges: [
          {
            entityId: proposal.transaction.id,
            entityType: "finance_transaction",
            summary: `Answer the Finance question for ${proposal.transaction.merchant}.`,
          },
        ],
        sourceRefs,
      };
    }
    const input = {
      decisions: [
        {
          categoryId: proposal.suggestedCategory.id,
          confidence: proposal.confidence,
          expectedTransactionUpdatedAt: proposal.transaction.updatedAt,
          learnMerchant: "never" as const,
          rationale: proposal.rationale,
          transactionId: proposal.transaction.id,
        },
      ],
    };
    return {
      actionKind: "categorization" as const,
      disposition: "prepared" as const,
      evidence: { confidence: proposal.confidence, rationale: proposal.rationale },
      expectedRevision: proposal.transaction.updatedAt,
      fingerprint: candidateFingerprint("categorization", input),
      assumptions: [],
      privatePayload: { actionKind: "categorization" as const, input },
      safeChanges: [
        {
          entityId: proposal.transaction.id,
          entityType: "finance_transaction",
          summary: `Categorize ${proposal.transaction.merchant} as ${proposal.suggestedCategory.name}.`,
        },
      ],
      sourceRefs,
    };
  });
}

function errorCode(error: unknown): string {
  return error instanceof AppError ? error.code : "finance_maintenance_failed";
}

function safeErrorMessage(error: unknown): string {
  if (error instanceof AppError) return error.message;
  return "Finance maintenance could not finish this step.";
}

function finalDayOfMonth(month: string): string {
  const year = Number(month.slice(0, 4));
  const monthNumber = Number(month.slice(5, 7));
  return new Date(Date.UTC(year, monthNumber, 0)).toISOString().slice(0, 10);
}

function positionScopeFor(
  scope: MaintenanceScope,
  observed: FinanceStatus,
): FinancePositionReadScope | null {
  if (scope.type === "target") return null;
  if (scope.type === "window") {
    return { from: scope.start, through: scope.end };
  }
  const month = observed.details.budget.month;
  return {
    from: `${month}-01`,
    through: finalDayOfMonth(month),
  };
}

function checkpointForPosition(
  position: FinancePositionEvidence,
): FinancePositionEvidenceCheckpoint {
  return financePositionEvidenceCheckpointSchema.parse({
    revision: position.revision,
    scope: position.scope,
    facts: Object.fromEntries(
      financePositionFactNames.map((name) => [
        name,
        { quality: position[name].quality, reasons: position[name].reasons },
      ]),
    ),
  });
}

function positionCheckpointFromRecords(
  records: Awaited<ReturnType<WorkspaceMaintenanceService["listStepRecords"]>>,
): FinancePositionEvidenceCheckpoint {
  const projection = records.find(
    (record) => record.step === "budget_and_health_projection" && record.status === "completed",
  )?.result as { position?: unknown } | undefined;
  const parsed = financePositionEvidenceCheckpointSchema.safeParse(projection?.position);
  if (!parsed.success)
    throw new AppError("conflict", "Canonical Finance position evidence is missing.");
  return parsed.data;
}

function positionReplayBlock(
  records: Awaited<ReturnType<WorkspaceMaintenanceService["listStepRecords"]>>,
): { code: string; position?: unknown } | null {
  const projectionRecord = records.find(
    (record) => record.step === "budget_and_health_projection" && record.status === "completed",
  );
  if (!projectionRecord) return null;
  const projection = projectionRecord.result as { position?: unknown } | null;
  const parsed = financePositionEvidenceCheckpointSchema.safeParse(projection?.position);
  if (parsed.success) {
    return financePositionFactNames.some(
      (name) => parsed.data.facts[name].quality === "unavailable",
    )
      ? { code: "finance_position_evidence_unavailable", position: parsed.data }
      : null;
  }
  const unavailable = projection?.position as
    | { quality?: unknown; reason?: unknown; scope?: unknown }
    | undefined;
  if (unavailable?.quality === "unavailable" && unavailable.reason === "unsupported_scope") {
    return { code: "finance_position_scope_unsupported", position: unavailable };
  }
  return { code: "finance_position_evidence_missing" };
}

export function createFinanceMaintenanceService({
  actions,
  challenge,
  finances,
  maintenance,
  now,
  periodReviews,
  position,
  status,
}: Options) {
  async function currentStatus(userId: string, scope: MaintenanceScope) {
    return status.getFinanceStatus(userId, scope);
  }

  async function assertCurrentRulebook(run: FinanceMaintenanceRun): Promise<FinanceStatus> {
    const observed = await currentStatus(run.userId, run.scope);
    if (observed.details.rulebookVersion !== run.rulebookVersion) {
      throw new FinanceRulebookChangedError(observed.details.rulebookVersion);
    }
    return observed;
  }

  async function resultFor(run: FinanceMaintenanceRun, verificationStatus: FinanceStatus) {
    const records = await maintenance.listStepRecords(run.id);
    const resolution = records.find((record) => record.step === "challenge_resolve")?.result as
      | {
          questionReviewsCreated?: number;
          questionReviewsTotal?: number;
          questions: number;
        }
      | undefined;
    const questions = records.find((record) => record.step === "questions")?.result as
      | { created?: number; total?: number }
      | undefined;
    const health = records.find((record) => record.step === "health_refresh")?.result as
      | {
          applicability?: "applied" | "not_run" | "skipped_scoped";
          confidence?: FinanceStatus["details"]["health"]["confidence"];
          refreshed?: boolean;
        }
      | undefined;
    const durableEffects = await finances.summarizeMaintenanceEffectsForRun(run.userId, run.id);
    const reportedHealth = health?.applicability
      ? {
          applicability: health.applicability,
          confidence: health.confidence ?? verificationStatus.details.health.confidence,
          refreshed: health.refreshed ?? false,
        }
      : {
          applicability: "not_run" as const,
          confidence: "insufficient" as const,
          refreshed: false,
        };
    return {
      applied: {
        categorizations: durableEffects.categorizations,
        transfers: durableEffects.transfers,
      },
      asOf: now().toISOString(),
      health: reportedHealth,
      questions: {
        created:
          resolution?.questionReviewsCreated ??
          (questions === undefined
            ? (durableEffects?.questionStepCreations ?? durableEffects?.questions ?? 0)
            : (questions.created ?? 0)),
        total: verificationStatus.details.review.total,
      },
      verification: {
        duplicateActions: durableEffects.duplicateActions,
        freshness: verificationStatus.freshness.state,
        state: verificationStatus.state,
      },
    };
  }

  async function dispatchRun(runId: string): Promise<FinanceMaintenanceRun | null> {
    const claim = await maintenance.claim(runId);
    if (!claim) return null;
    const { claimId, run } = claim;
    const records = await maintenance.listStepRecords(runId);
    const prepared = records.find((record) => record.step === "prepare")?.result as
      | { candidateId: string; questions: number; revision: string }
      | undefined;
    const checkpoint = run.checkpoint as Record<string, unknown> | null;
    const releaseAtChallenge = async (candidate: NonNullable<typeof prepared>) =>
      maintenance.checkpointAndRelease({
        checkpoint: {
          candidateId: candidate.candidateId,
          revision: candidate.revision,
          phase: "challenge",
        },
        claimId,
        runId,
        status: "awaiting_agent_challenge",
      });
    let currentStep: (typeof financeCandidateMaintenanceSteps)[number] = "prepare";
    try {
      const requiredCapabilities = [
        finances.beginMaintenanceCandidatePreparation,
        finances.appendMaintenanceCandidatePage,
        finances.finalizeMaintenanceCandidatePreparation,
        finances.getMaintenanceCandidateQuestionContexts,
        finances.projectMaintenanceCandidateQuestionsForUser,
        finances.reconcileExactTransfersForUser,
        finances.summarizeMaintenanceEffectsForRun,
        finances.refreshCashflowForUser,
        status.getFinanceStatus,
        challenge?.prepare,
        challenge?.resolve,
        actions?.settleFinanceMaintenanceCandidate,
        periodReviews?.createForRun,
        position?.readPosition,
      ];
      if (requiredCapabilities.some((capability) => typeof capability !== "function")) {
        throw new AppError(
          "invalid_request",
          "A required Finance maintenance capability is unavailable.",
        );
      }
      await assertCurrentRulebook(run);
      const completed = new Set(
        records.filter((record) => record.status === "completed").map((record) => record.step),
      );
      const replayBlock = positionReplayBlock(records);
      if (replayBlock) {
        return maintenance.settle({
          claimId,
          result: replayBlock,
          runId,
          status: "blocked",
        });
      }
      if (checkpoint?.phase === "challenge" && prepared) return releaseAtChallenge(prepared);
      if (
        checkpoint?.phase === "health_refresh" ||
        completed.has("commit_or_queue_review") ||
        completed.has("health_refresh")
      ) {
        const questionResolution = records.find(
          (record) => record.step === "challenge_resolve" && record.status === "completed",
        )?.result as
          | { candidateId: string; candidateRevision?: string; questions: number }
          | undefined;
        if (questionResolution && questionResolution.questions > 0) {
          if (!questionResolution.candidateRevision)
            throw new AppError("conflict", "The challenged Finance candidate is unavailable.");
          const replayedQuestions = await finances.projectMaintenanceCandidateQuestionsForUser({
            candidateId: questionResolution.candidateId,
            candidateRevision: questionResolution.candidateRevision,
            context: mutationContext(run, "challenge_resolve", claimId),
            runId,
            userId: run.userId,
          });
          if (replayedQuestions.rebuild)
            return maintenance.getOwnedRun(run.userId, replayedQuestions.successorRunId ?? runId);
        }
        if (!completed.has("health_refresh")) {
          currentStep = "health_refresh";
          await assertCurrentRulebook(run);
          const refreshed = await finances.refreshCashflowForUser(
            run.userId,
            run.scope,
            mutationContext(run, "health_refresh", claimId),
            async () => maintenance.renewClaim({ claimId, runId }).then(() => undefined),
          );
          await maintenance.completeStep({
            claimId,
            idempotencyKey: `finances:${run.rulebookVersion}:health_refresh`,
            result: {
              ...refreshed,
              applicability: run.scope.type === "all_outstanding" ? "applied" : "skipped_scoped",
              confidence: (await assertCurrentRulebook(run)).details.health.confidence,
            },
            runId,
            step: "health_refresh",
          });
          completed.add("health_refresh");
        }
        const observed = await assertCurrentRulebook(run);
        currentStep = "verify";
        if (observed.freshness.blockers.length || observed.state === "blocked")
          return maintenance.settle({
            claimId,
            result: await resultFor(run, observed),
            runId,
            status: "blocked",
          });
        if (observed.freshness.state !== "current") {
          if (completed.has("verify")) {
            return maintenance.releaseForRetry({
              claimId,
              code: "finance_source_not_current",
              runId,
              safeMessage: "Finance source freshness must recover before verification can settle.",
            });
          }
          throw new AppError("conflict", "Finance source freshness must recover before verify.");
        }
        if (!completed.has("verify")) {
          const positionCheckpoint = positionCheckpointFromRecords(records);
          await maintenance.completeStep({
            claimId,
            idempotencyKey: `finances:${run.rulebookVersion}:verify`,
            result: { position: positionCheckpoint, state: observed.state },
            runId,
            step: "verify",
          });
          completed.add("verify");
        }
        if (!completed.has("period_review")) {
          currentStep = "period_review";
          const positionCheckpoint = positionCheckpointFromRecords(records);
          const periodReview = await periodReviews.createForRun(
            run.userId,
            runId,
            positionCheckpoint,
          );
          await maintenance.completeStep({
            claimId,
            idempotencyKey: `finances:${run.rulebookVersion}:period_review`,
            result: { id: periodReview.id, status: periodReview.status },
            runId,
            step: "period_review",
          });
        }
        const result = await resultFor(run, observed);
        return maintenance.settle({
          claimId,
          result,
          runId,
          status: result.questions.total > 0 ? "completed_with_questions" : "completed",
        });
      }
      for (const step of financeCandidateMaintenanceSteps) {
        if (completed.has(step) && step !== "challenge_resolve") continue;
        currentStep = step;
        const idempotencyKey = `finances:${run.rulebookVersion}:${step}`;
        if (step === "preflight") {
          const allocationBackfill = finances.backfillTransactionAllocations
            ? await finances.backfillTransactionAllocations(100)
            : null;
          const observed = await assertCurrentRulebook(run);
          await maintenance.completeStep({
            claimId,
            idempotencyKey,
            result: {
              allocationBackfill,
              asOf: observed.asOf,
              freshness: observed.freshness.state,
            },
            runId,
            step,
          });
          continue;
        }
        if (step === "synchronize") {
          await assertCurrentRulebook(run);
          const synchronized = await finances.syncDueAccountsForUser(
            run.userId,
            run.scope,
            mutationContext(run, step, claimId),
            async () => maintenance.renewClaim({ claimId, runId }).then(() => undefined),
          );
          const observed = await currentStatus(run.userId, run.scope);
          if (observed.freshness.blockers.length || observed.state === "blocked") {
            return maintenance.settle({
              claimId,
              result: await resultFor(run, observed),
              runId,
              status: "blocked",
            });
          }
          if (
            synchronized.failed ||
            synchronized.skipped ||
            observed.freshness.state !== "current"
          ) {
            throw new AppError(
              "conflict",
              "Finance synchronization is incomplete and will be retried.",
            );
          }
          await maintenance.completeStep({
            claimId,
            idempotencyKey,
            result: synchronized,
            runId,
            step,
          });
          continue;
        }
        if (step === "reconcile") {
          await assertCurrentRulebook(run);
          const reconciled = await finances.reconcileExactTransfersForUser(
            run.userId,
            run.scope,
            mutationContext(run, step, claimId),
            async () => maintenance.renewClaim({ claimId, runId }).then(() => undefined),
          );
          await maintenance.completeStep({
            claimId,
            idempotencyKey,
            result: reconciled,
            runId,
            step,
          });
          continue;
        }
        if (step === "prepare") {
          await assertCurrentRulebook(run);
          const preparation = await finances.beginMaintenanceCandidatePreparation({
            runId,
            userId: run.userId,
          });
          if (preparation.complete) {
            const candidate = await finances.finalizeMaintenanceCandidatePreparation({
              runId,
              userId: run.userId,
            });
            await maintenance.completeStep({
              claimId,
              idempotencyKey,
              result: {
                candidateId: candidate.candidateId,
                prepared: candidate.prepared,
                questions: candidate.questions,
                revision: candidate.revision,
              },
              runId,
              step,
            });
            continue;
          }
          const page = await finances.proposeOutstandingCategorizations(
            run.userId,
            run.scope,
            preparation.cursor ?? undefined,
            async () => maintenance.renewClaim({ claimId, runId }).then(() => undefined),
          );
          const questionContexts = await finances.getMaintenanceCandidateQuestionContexts(
            run.userId,
            page.items.map((item) => item.transaction.id),
          );
          const items = preparedCandidateItems(page, questionContexts);
          const appended = await finances.appendMaintenanceCandidatePage({
            cursor: preparation.cursor,
            discoveryRevision: candidateFingerprint("candidate_page", {
              items: page.items.map((item) => [
                item.source,
                item.transaction.id,
                item.transaction.updatedAt,
              ]),
            }),
            items,
            nextCursor: page.nextCursor,
            runId,
            userId: run.userId,
          });
          if (appended.status === "superseded") {
            return maintenance.checkpointAndRelease({
              checkpoint: { phase: "prepare", restarted: true },
              claimId,
              runId,
            });
          }
          if (page.nextCursor) {
            return maintenance.checkpointAndRelease({
              checkpoint: {
                candidateId: appended.candidateId,
                cursor: page.nextCursor,
                nextOrdinal: appended.nextOrdinal,
                phase: "prepare",
              },
              claimId,
              runId,
            });
          }
          const candidate = await finances.finalizeMaintenanceCandidatePreparation({
            runId,
            userId: run.userId,
          });
          await maintenance.completeStep({
            claimId,
            idempotencyKey,
            result: {
              candidateId: candidate.candidateId,
              prepared: candidate.prepared,
              questions: candidate.questions,
              revision: candidate.revision,
            },
            runId,
            step,
          });
          continue;
        }
        if (step === "questions") {
          await assertCurrentRulebook(run);
          const candidate = (await maintenance.listStepRecords(runId)).find(
            (record) => record.step === "prepare",
          )?.result as { questions?: number } | undefined;
          await maintenance.completeStep({
            claimId,
            idempotencyKey,
            result: { created: 0, total: candidate?.questions ?? 0 },
            runId,
            step,
          });
          continue;
        }
        if (step === "budget_and_health_projection") {
          const observed = await assertCurrentRulebook(run);
          const readScope = positionScopeFor(run.scope, observed);
          if (!readScope) {
            const unavailable = {
              quality: "unavailable" as const,
              reason: "unsupported_scope" as const,
              scope: run.scope,
            };
            await maintenance.completeStep({
              claimId,
              idempotencyKey,
              result: { position: unavailable },
              runId,
              step,
            });
            return maintenance.settle({
              claimId,
              result: { code: "finance_position_scope_unsupported", position: unavailable },
              runId,
              status: "blocked",
            });
          }
          const evidence = await position.readPosition(run.userId, readScope);
          const positionCheckpoint = checkpointForPosition(evidence);
          await maintenance.completeStep({
            claimId,
            idempotencyKey,
            result: { position: positionCheckpoint },
            runId,
            step,
          });
          if (
            financePositionFactNames.some(
              (name) => positionCheckpoint.facts[name].quality === "unavailable",
            )
          ) {
            return maintenance.settle({
              claimId,
              result: {
                code: "finance_position_evidence_unavailable",
                position: positionCheckpoint,
              },
              runId,
              status: "blocked",
            });
          }
          continue;
        }
        if (step === "challenge_prepare") {
          await assertCurrentRulebook(run);
          const candidate = (await maintenance.listStepRecords(runId)).find(
            (record) => record.step === "prepare",
          )?.result as NonNullable<typeof prepared> | undefined;
          if (!candidate)
            throw new AppError("conflict", "Finance candidate preparation is missing.");
          const preparedChallenge = await challenge.prepare(
            run.userId,
            runId,
            candidate.candidateId,
          );
          await maintenance.completeStep({
            claimId,
            idempotencyKey,
            result: {
              candidateId: candidate.candidateId,
              challengeId: preparedChallenge.id,
              revision: candidate.revision,
            },
            runId,
            step,
          });
          return releaseAtChallenge(candidate);
        }
        if (step === "challenge_resolve") {
          await assertCurrentRulebook(run);
          const resolution = completed.has("challenge_resolve")
            ? (records.find((record) => record.step === "challenge_resolve")?.result as Awaited<
                ReturnType<Options["challenge"]["resolve"]>
              >)
            : await challenge.resolve(run.userId, runId);
          if (!resolution.candidateRevision)
            throw new AppError("conflict", "The challenged Finance candidate is unavailable.");
          const projectedQuestions =
            resolution.questions > 0
              ? await finances.projectMaintenanceCandidateQuestionsForUser({
                  candidateId: resolution.candidateId,
                  candidateRevision: resolution.candidateRevision,
                  context: mutationContext(run, step, claimId),
                  runId,
                  userId: run.userId,
                })
              : { created: 0, total: 0 };
          if (projectedQuestions.rebuild)
            return maintenance.getOwnedRun(run.userId, projectedQuestions.successorRunId ?? runId);
          if (!completed.has("challenge_resolve")) {
            await maintenance.completeStep({
              claimId,
              idempotencyKey,
              result: {
                ...resolution,
                questionReviewsCreated: projectedQuestions.created,
                questionReviewsTotal: projectedQuestions.total,
              },
              runId,
              step,
            });
          }
          if (resolution.questions > 0) {
            await maintenance.completeStep({
              claimId,
              idempotencyKey: `finances:${run.rulebookVersion}:commit_or_queue_review`,
              result: { applied: false, questions: resolution.questions },
              runId,
              step: "commit_or_queue_review",
            });
            return maintenance.checkpointAndRelease({
              checkpoint: { candidateId: resolution.candidateId, phase: "health_refresh" },
              claimId,
              runId,
            });
          }
          await maintenance.checkpointAndRelease({
            checkpoint: {
              candidateId: resolution.candidateId,
              phase: "challenge",
              revision: resolution.candidateRevision,
            },
            claimId,
            runId,
            status: "awaiting_agent_challenge",
          });
          await actions.settleFinanceMaintenanceCandidate(
            resolution.candidateId,
            resolution.candidateRevision,
            {
              principal: {
                actorId: resolution.submittingAgentId ?? "finance-maintenance-agent",
                actorType: "agent",
                scopes: new Set(["finances:maintain", "finances:write"]),
                userId: run.userId,
              },
              requestId: `finance-maintenance-settle:${runId}`,
            },
          );
          return maintenance.getOwnedRun(run.userId, runId);
        }
        return maintenance.getOwnedRun(run.userId, runId);
      }
      if (prepared) return releaseAtChallenge(prepared);
      return maintenance.getOwnedRun(run.userId, runId);
    } catch (error) {
      if (error instanceof FinanceRulebookChangedError) {
        return maintenance.settle({
          claimId,
          result: { code: "finance_rulebook_changed", message: error.message },
          runId,
          status: "failed_terminal",
        });
      }
      try {
        await maintenance.failStep({
          claimId,
          code: errorCode(error),
          recoverable: !(
            error instanceof AppError &&
            ["forbidden", "invalid_request", "not_found"].includes(error.code)
          ),
          runId,
          safeMessage: safeErrorMessage(error),
          step: currentStep,
        });
      } catch {
        // A failed error-recording write must not abort the remaining maintenance batch.
      }
      return maintenance.getOwnedRun(run.userId, runId);
    }
  }

  return {
    async dispatchDue(limit: number): Promise<FinanceMaintenanceDispatchBatchResult> {
      const boundedLimit = Math.max(1, Math.min(5, Math.trunc(limit)));
      const due = await maintenance.listDueRunIds("finances", boundedLimit);
      const runs: FinanceMaintenanceRun[] = [];
      for (const runId of due) {
        const run = await dispatchRun(runId);
        if (run) runs.push(run);
      }
      return { attempted: due.length, claimed: runs.length, runs };
    },
    dispatchRun,
    getRun(userId: string, runId: string) {
      return maintenance.getOwnedRun(userId, runId);
    },
    async startOrResume(userId: string, scope: MaintenanceScope): Promise<FinanceMaintenanceRun> {
      const observed = await currentStatus(userId, scope);
      const run = await maintenance.createOrResume(
        userId,
        "finances",
        scope,
        observed.details.rulebookVersion,
      );
      if (
        run.status === "blocked" &&
        observed.state !== "blocked" &&
        observed.freshness.blockers.length === 0
      ) {
        return maintenance.requeue({
          expectedRulebookVersion: run.rulebookVersion,
          expectedStatus: "blocked",
          runId: run.id,
        });
      }
      return run;
    },
  };
}

export type FinanceMaintenanceService = ReturnType<typeof createFinanceMaintenanceService>;
