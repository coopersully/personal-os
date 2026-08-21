import { createHash } from "node:crypto";
import type {
  ApplyFinanceCategorizationsInput,
  FinanceCategorizationApplyResult,
  FinanceCategorizationProposalPage,
  FinanceMaintenanceRun,
  FinanceStatus,
  MaintenanceScope,
} from "@personal-os/domain";
import { AppError } from "./errors.js";
import type { FinanceSyncBatchResult } from "./finance-service.js";
import type { Principal } from "./types.js";
import type { WorkspaceMaintenanceService } from "./workspace-maintenance-service.js";

export const financeMaintenanceSteps = [
  "preflight",
  "synchronize",
  "reconcile",
  "categorize",
  "questions",
  "budget",
  "health",
  "verify",
] as const;

/** The candidate-first turn graph used by durable Finance maintenance. */
export const financeCandidateMaintenanceSteps = [
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

type FinanceMaintenanceStep = (typeof financeMaintenanceSteps)[number];
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
    items: Array<{
      actionKind: string;
      disposition: "prepared" | "question";
      evidence: Record<string, unknown>;
      expectedRevision: string | null;
      fingerprint: string;
      privatePayload: Record<string, unknown>;
      safeChanges: Array<Record<string, unknown>>;
      sourceRefs: Array<Record<string, unknown>>;
    }>;
    runId: string;
    userId: string;
  }) => Promise<{
    candidateId: string;
    fingerprints: string[];
    prepared: number;
    questions: number;
    revision: string;
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
  summarizeMaintenanceEffectsForRun?: (
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
  finances: FinanceMaintenanceOperations;
  maintenance: WorkspaceMaintenanceService;
  now: () => Date;
  status: FinanceStatusReader;
};

export type FinanceMaintenanceDispatchBatchResult = {
  attempted: number;
  claimed: number;
  runs: FinanceMaintenanceRun[];
};

type CategorizeCheckpoint = {
  applied: number;
  cursor: string;
  step: "categorize";
};

type ReconcileCheckpoint = {
  cursor: string;
  phase: "legacy_transfer_repair";
  repaired: number;
  step: "reconcile";
};

class FinanceRulebookChangedError extends Error {
  public constructor(public readonly currentRulebookVersion: string) {
    super("The Finance rulebook changed while maintenance was running.");
    this.name = "FinanceRulebookChangedError";
  }
}

function categorizeCheckpoint(value: unknown): CategorizeCheckpoint | null {
  if (value === null || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  return record.step === "categorize" &&
    typeof record.cursor === "string" &&
    typeof record.applied === "number"
    ? { applied: record.applied, cursor: record.cursor, step: "categorize" }
    : null;
}

function reconcileCheckpoint(value: unknown): ReconcileCheckpoint | null {
  if (value === null || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  return record.step === "reconcile" &&
    record.phase === "legacy_transfer_repair" &&
    typeof record.cursor === "string" &&
    typeof record.repaired === "number"
    ? {
        cursor: record.cursor,
        phase: "legacy_transfer_repair",
        repaired: record.repaired,
        step: "reconcile",
      }
    : null;
}

function completedStep(value: unknown): FinanceMaintenanceStep | null {
  if (value === null || typeof value !== "object") return null;
  const step = (value as Record<string, unknown>).completedStep;
  return typeof step === "string" &&
    financeMaintenanceSteps.includes(step as FinanceMaintenanceStep)
    ? (step as FinanceMaintenanceStep)
    : null;
}

function mutationContext(
  run: Pick<FinanceMaintenanceRun, "id" | "rulebookVersion" | "userId">,
  step: FinanceMaintenanceStep,
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

function candidateFingerprint(value: unknown) {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

function preparedCandidateItems(page: FinanceCategorizationProposalPage) {
  return page.items.map((proposal) => {
    const sourceRefs = [proposal.source] as Array<Record<string, unknown>>;
    if (!isEligibleOneOff(proposal)) {
      return {
        actionKind: "question",
        disposition: "question" as const,
        evidence: { confidence: proposal.confidence, rationale: proposal.rationale },
        expectedRevision: proposal.transaction.updatedAt,
        fingerprint: candidateFingerprint({
          kind: "question",
          revision: proposal.transaction.updatedAt,
          transactionId: proposal.transaction.id,
        }),
        privatePayload: { proposal },
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
          learnMerchant: "never",
          rationale: proposal.rationale,
          transactionId: proposal.transaction.id,
        },
      ],
    };
    return {
      actionKind: "categorization",
      disposition: "prepared" as const,
      evidence: { confidence: proposal.confidence, rationale: proposal.rationale },
      expectedRevision: proposal.transaction.updatedAt,
      fingerprint: candidateFingerprint({ actionKind: "categorization", input }),
      privatePayload: { input, rationale: proposal.rationale },
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

export function createFinanceMaintenanceService({ finances, maintenance, now, status }: Options) {
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
    const reconciliation = records.find((record) => record.step === "reconcile")?.result as
      | { transfers?: number }
      | undefined;
    const categorization = records.find((record) => record.step === "categorize")?.result as
      | { applied?: number }
      | undefined;
    const questions = records.find((record) => record.step === "questions")?.result as
      | { created?: number; total?: number }
      | undefined;
    const health = records.find((record) => record.step === "health")?.result as
      | {
          applicability?: "applied" | "not_run" | "skipped_scoped";
          confidence?: FinanceStatus["details"]["health"]["confidence"];
          refreshed?: boolean;
        }
      | undefined;
    const durableEffects = finances.summarizeMaintenanceEffectsForRun
      ? await finances.summarizeMaintenanceEffectsForRun(run.userId, run.id)
      : null;
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
        categorizations: durableEffects?.categorizations ?? categorization?.applied ?? 0,
        transfers: durableEffects?.transfers ?? reconciliation?.transfers ?? 0,
      },
      asOf: now().toISOString(),
      health: reportedHealth,
      questions: {
        created:
          questions === undefined
            ? (durableEffects?.questionStepCreations ?? durableEffects?.questions ?? 0)
            : (questions.created ?? 0),
        total: questions?.total ?? verificationStatus.details.review.total,
      },
      verification: {
        duplicateActions: durableEffects?.duplicateActions ?? 0,
        freshness: verificationStatus.freshness.state,
        state: verificationStatus.state,
      },
    };
  }

  async function dispatchRun(runId: string): Promise<FinanceMaintenanceRun | null> {
    const claim = await maintenance.claim(runId);
    if (!claim) return null;
    const { claimId } = claim;
    const run = claim.run;
    const categorizationContinuation = categorizeCheckpoint(run.checkpoint);
    const reconciliationContinuation = reconcileCheckpoint(run.checkpoint);
    const lastCompleted = completedStep(run.checkpoint);
    let startIndex = categorizationContinuation
      ? financeMaintenanceSteps.indexOf("categorize")
      : reconciliationContinuation
        ? financeMaintenanceSteps.indexOf("reconcile")
        : lastCompleted
          ? financeMaintenanceSteps.indexOf(lastCompleted) + 1
          : 0;
    let categorizationApplied = categorizationContinuation?.applied ?? 0;
    let heuristicTransfersRepaired = reconciliationContinuation?.repaired ?? 0;

    try {
      const recoveredEffects = finances.summarizeMaintenanceEffectsForRun
        ? await finances.summarizeMaintenanceEffectsForRun(run.userId, runId)
        : null;
      heuristicTransfersRepaired = Math.max(
        heuristicTransfersRepaired,
        recoveredEffects?.heuristicTransfersRepaired ?? 0,
      );
      if (lastCompleted === "verify") {
        const observed = await assertCurrentRulebook(run);
        if (observed.freshness.blockers.length === 0 && observed.freshness.state !== "current") {
          return maintenance.releaseForRetry({
            claimId,
            code: "finance_source_not_current",
            runId,
            safeMessage: "Finance source freshness must recover before verification can settle.",
          });
        }
        const result = await resultFor(run, observed);
        return maintenance.settle({
          claimId,
          result,
          runId,
          status:
            observed.freshness.blockers.length > 0 || observed.state === "blocked"
              ? "blocked"
              : result.questions.total > 0
                ? "completed_with_questions"
                : "completed",
        });
      }
      for (; startIndex < financeMaintenanceSteps.length; startIndex += 1) {
        const step = financeMaintenanceSteps[startIndex];
        if (!step) break;
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
          await maintenance.renewClaim({ claimId, runId });
          const synchronized = await finances.syncDueAccountsForUser(
            run.userId,
            run.scope,
            mutationContext(run, step, claimId),
            async () => {
              await maintenance.renewClaim({ claimId, runId });
            },
          );
          await maintenance.renewClaim({ claimId, runId });
          const observed = await currentStatus(run.userId, run.scope);
          if (observed.freshness.blockers.length > 0 || observed.state === "blocked") {
            return maintenance.settle({
              claimId,
              result: await resultFor(run, observed),
              runId,
              status: "blocked",
            });
          }
          if (
            synchronized.failed > 0 ||
            synchronized.skipped > 0 ||
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
          await maintenance.renewClaim({ claimId, runId });
          const repair = await finances.repairHeuristicTransfersForUser(
            run.userId,
            run.scope,
            reconciliationContinuation?.cursor,
            mutationContext(run, step, claimId),
            async () => {
              await maintenance.renewClaim({ claimId, runId });
            },
          );
          heuristicTransfersRepaired += repair.repaired;
          if (repair.nextCursor) {
            await maintenance.checkpointAndRelease({
              checkpoint: {
                cursor: repair.nextCursor,
                phase: "legacy_transfer_repair",
                repaired: heuristicTransfersRepaired,
                step,
              },
              claimId,
              runId,
            });
            return maintenance.getOwnedRun(run.userId, runId);
          }
          const reconciled = await finances.reconcileTransfersForUser(
            run.userId,
            run.scope,
            mutationContext(run, step, claimId),
            async () => {
              await maintenance.renewClaim({ claimId, runId });
            },
          );
          await maintenance.completeStep({
            claimId,
            idempotencyKey,
            result: { heuristicTransfersRepaired, ...reconciled },
            runId,
            step,
          });
          continue;
        }
        if (step === "categorize") {
          await maintenance.renewClaim({ claimId, runId });
          const page = await finances.proposeOutstandingCategorizations(
            run.userId,
            run.scope,
            categorizationContinuation?.cursor,
            async () => {
              await maintenance.renewClaim({ claimId, runId });
            },
          );
          // Candidate-aware Finance maintenance never mutates semantic ledger
          // rows before the connected-agent challenge.  Legacy fixtures that
          // do not provide the candidate store retain their historical path.
          if (finances.prepareMaintenanceCandidate) {
            if (page.nextCursor) {
              throw new AppError(
                "conflict",
                "Finance candidate preparation must finish one bounded page before challenge.",
              );
            }
            await assertCurrentRulebook(run);
            const candidate = await finances.prepareMaintenanceCandidate({
              items: preparedCandidateItems(page),
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
          const eligible = page.items.filter(isEligibleOneOff).slice(0, 50);
          if (eligible.length > 0) {
            await assertCurrentRulebook(run);
            const decisions = (proposals: typeof eligible): ApplyFinanceCategorizationsInput => ({
              decisions: proposals.map((proposal) => ({
                categoryId: proposal.suggestedCategory.id,
                confidence: proposal.confidence,
                expectedTransactionUpdatedAt: proposal.transaction.updatedAt,
                learnMerchant: "never" as const,
                rationale: proposal.rationale,
                transactionId: proposal.transaction.id,
              })),
            });
            const ruleProposals = eligible.filter(
              (proposal) => proposal.suggestionBasis === "merchant_rule",
            );
            const oneOffProposals = eligible.filter(
              (proposal) => proposal.suggestionBasis === "transaction_evidence",
            );
            await maintenance.renewClaim({ claimId, runId });
            const ruleResults =
              ruleProposals.length > 0
                ? await finances.applyApprovedRules(
                    decisions(ruleProposals),
                    mutationContext(run, step, claimId),
                  )
                : [];
            await maintenance.renewClaim({ claimId, runId });
            const oneOffResults =
              oneOffProposals.length > 0
                ? await finances.applyApprovedOneOffs(
                    decisions(oneOffProposals),
                    mutationContext(run, step, claimId),
                  )
                : [];
            const results = [...ruleResults, ...oneOffResults];
            const failed = results.find((result) => result.status === "failed");
            if (failed?.error) {
              throw new AppError(
                failed.error.code === "invalid_request" || failed.error.code === "forbidden"
                  ? "invalid_request"
                  : "conflict",
                failed.error.message,
              );
            }
            categorizationApplied += results.filter((result) => result.applied).length;
          }
          if (page.nextCursor) {
            await maintenance.checkpointAndRelease({
              checkpoint: { applied: categorizationApplied, cursor: page.nextCursor, step },
              claimId,
              runId,
            });
            return maintenance.getOwnedRun(run.userId, runId);
          }
          await maintenance.completeStep({
            claimId,
            idempotencyKey,
            result: { applied: categorizationApplied, inspected: page.items.length },
            runId,
            step,
          });
          continue;
        }
        if (step === "questions") {
          if (finances.prepareMaintenanceCandidate) {
            const candidateStep = await maintenance.listStepRecords(runId);
            const candidate = candidateStep.find((record) => record.step === "categorize")
              ?.result as { questions?: number } | undefined;
            await maintenance.completeStep({
              claimId,
              idempotencyKey,
              result: { created: 0, total: candidate?.questions ?? 0 },
              runId,
              step,
            });
            continue;
          }
          await assertCurrentRulebook(run);
          const refreshed = await finances.refreshMaintenanceQuestionsForUser(
            run.userId,
            run.scope,
            mutationContext(run, step, claimId),
            async () => {
              await maintenance.renewClaim({ claimId, runId });
            },
          );
          const questionEffects = finances.summarizeMaintenanceEffectsForRun
            ? await finances.summarizeMaintenanceEffectsForRun(run.userId, run.id)
            : null;
          await maintenance.completeStep({
            claimId,
            idempotencyKey,
            result: {
              ...refreshed,
              created: questionEffects?.questionStepCreations ?? refreshed.created,
            },
            runId,
            step,
          });
          continue;
        }
        if (step === "budget") {
          await assertCurrentRulebook(run);
          await maintenance.renewClaim({ claimId, runId });
          await maintenance.completeStep({
            claimId,
            idempotencyKey,
            result: { prepared: false, reason: "budget_proposals_not_shipped" },
            runId,
            step,
          });
          continue;
        }
        if (step === "health") {
          if (finances.prepareMaintenanceCandidate) {
            const observed = await assertCurrentRulebook(run);
            await maintenance.completeStep({
              claimId,
              idempotencyKey,
              result: {
                applicability: "not_run",
                confidence: observed.details.health.confidence,
                refreshed: false,
              },
              runId,
              step,
            });
            continue;
          }
          await assertCurrentRulebook(run);
          const refreshed = await finances.refreshCashflowForUser(
            run.userId,
            run.scope,
            mutationContext(run, step, claimId),
            async () => {
              await maintenance.renewClaim({ claimId, runId });
            },
          );
          await maintenance.renewClaim({ claimId, runId });
          const observed = await currentStatus(run.userId, run.scope);
          await maintenance.completeStep({
            claimId,
            idempotencyKey,
            result: {
              applicability: run.scope.type === "all_outstanding" ? "applied" : "skipped_scoped",
              confidence: observed.details.health.confidence,
              ...refreshed,
            },
            runId,
            step,
          });
          continue;
        }
        await assertCurrentRulebook(run);
        await maintenance.renewClaim({ claimId, runId });
        const observed = await currentStatus(run.userId, run.scope);
        if (observed.freshness.blockers.length > 0 || observed.state === "blocked") {
          return maintenance.settle({
            claimId,
            result: await resultFor(run, observed),
            runId,
            status: "blocked",
          });
        }
        if (observed.freshness.state !== "current") {
          throw new AppError("conflict", "Finance source freshness must recover before verify.");
        }
        await maintenance.completeStep({
          claimId,
          idempotencyKey,
          result: { state: observed.state },
          runId,
          step,
        });
        const result = await resultFor(run, observed);
        const questionCount = result.questions.total;
        return maintenance.settle({
          claimId,
          result,
          runId,
          status: questionCount > 0 ? "completed_with_questions" : "completed",
        });
      }
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
      const step =
        financeMaintenanceSteps[Math.min(startIndex, financeMaintenanceSteps.length - 1)] ??
        "preflight";
      const terminal =
        error instanceof AppError &&
        ["forbidden", "invalid_request", "not_found"].includes(error.code);
      await maintenance.failStep({
        claimId,
        code: errorCode(error),
        recoverable: !terminal,
        runId,
        safeMessage: safeErrorMessage(error),
        step,
      });
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
