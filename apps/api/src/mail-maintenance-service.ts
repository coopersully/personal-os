import type {
  MailMaintenanceDispatchResult,
  MailReview,
  MaintenanceRun,
  MaintenanceScope,
  MaintenanceVerification,
} from "@personal-os/domain";
import { AppError } from "./errors.js";
import { assessMail, type MailAssessment, type MailAssessmentSnapshot } from "./mail-assessment.js";
import { MAIL_PLAYBOOK } from "./mail-playbook.js";
import type { MailStewardshipService } from "./mail-stewardship-service.js";
import type {
  WorkspaceMaintenanceService,
  WorkspaceMaintenanceStepRecord,
} from "./workspace-maintenance-service.js";

export const MAIL_MAINTENANCE_STEPS = [
  ["refresh_sources", "mail:refresh-sources:v1"],
  ["snapshot", "mail:snapshot:v1"],
  ["assess", "mail:assess:v1"],
  ["reconcile_ledger", "mail:reconcile-ledger:v1"],
  ["dispatch_approved_rules", "mail:dispatch-approved-rules:v1"],
  ["publish_review", "mail:publish-review:v1"],
  ["verify", "mail:verify:v1"],
] as const;

type RefreshSourcesResult = {
  enqueued: number;
  readiness: "current" | "pending" | "unavailable";
};
type DispatchRulesResult = {
  dispatched: number;
  failed?: number;
  pending?: number;
  reconcile?: number;
};
type Options = {
  dispatchApprovedRules: (userId: string) => Promise<DispatchRulesResult>;
  now: () => Date;
  refreshSources: (userId: string) => Promise<RefreshSourcesResult>;
  stewardship: MailStewardshipService;
  workspace: WorkspaceMaintenanceService;
};
type MaintenanceRequest = { scope: MaintenanceScope };
type SnapshotStepResult = { snapshot: MailAssessmentSnapshot };
type AssessmentStepResult = { assessment: MailAssessment };
type ReviewStepResult = {
  assessment: MailAssessment;
  review: MailReview;
  snapshot: MailAssessmentSnapshot;
};

const maintenanceRulebookVersion = `mail-maintenance-v1:${MAIL_PLAYBOOK.version}`;

function completedResult<T>(
  records: Map<string, WorkspaceMaintenanceStepRecord>,
  step: string,
): T | null {
  const record = records.get(step);
  return record?.status === "completed" ? (record.result as T) : null;
}

function safeError(error: unknown) {
  if (error instanceof AppError) {
    return {
      code: error.code,
      recoverable: error.code !== "invalid_request" && error.code !== "internal_error",
      safeMessage: error.message,
    };
  }
  return {
    code: "mail_maintenance_temporary_failure",
    recoverable: true,
    safeMessage: "Mail maintenance encountered a temporary internal failure.",
  };
}

function resultForRun(run: MaintenanceRun, fallbackSummary: string): MailMaintenanceDispatchResult {
  const settled = run.settledResult as {
    summary?: string;
    verification?: MaintenanceVerification | null;
  } | null;
  return {
    run,
    summary: settled?.summary ?? fallbackSummary,
    verification: settled?.verification ?? null,
  };
}

export function createMailMaintenanceService({
  dispatchApprovedRules,
  now,
  refreshSources,
  stewardship,
  workspace,
}: Options) {
  async function execute(
    runId: string,
    expectedUserId?: string,
  ): Promise<MailMaintenanceDispatchResult | null> {
    const claim = await workspace.claim(runId);
    if (!claim) {
      if (!expectedUserId) return null;
      const run = await workspace.getOwnedRun(expectedUserId, runId);
      return resultForRun(run, "Mail maintenance is already being handled.");
    }
    const { claimId } = claim;
    const userId = claim.run.userId;
    const scope = claim.run.scope;
    const records = new Map(
      (await workspace.listStepRecords(runId)).map((record) => [record.step, record]),
    );
    let currentStep: (typeof MAIL_MAINTENANCE_STEPS)[number][0] = MAIL_MAINTENANCE_STEPS[0][0];

    async function complete(step: string, idempotencyKey: string, result: unknown) {
      await workspace.completeStep({ claimId, idempotencyKey, result, runId, step });
      records.set(step, { idempotencyKey, result, status: "completed", step });
    }

    try {
      for (const [step, idempotencyKey] of MAIL_MAINTENANCE_STEPS) {
        currentStep = step;
        if (completedResult(records, step)) continue;
        await workspace.renewClaim({ claimId, runId });

        if (step === "refresh_sources") {
          const refreshed = await refreshSources(userId);
          await complete(step, idempotencyKey, refreshed);
          continue;
        }
        if (step === "snapshot") {
          const snapshot = await stewardship.snapshot(userId, scope);
          await complete(step, idempotencyKey, { snapshot } satisfies SnapshotStepResult);
          continue;
        }
        const snapshotResult = completedResult<SnapshotStepResult>(records, "snapshot");
        if (!snapshotResult)
          throw new AppError("internal_error", "Mail snapshot evidence is missing.");

        if (step === "assess") {
          const assessment = assessMail(snapshotResult.snapshot, MAIL_PLAYBOOK);
          await complete(step, idempotencyKey, { assessment } satisfies AssessmentStepResult);
          continue;
        }
        const assessmentResult = completedResult<AssessmentStepResult>(records, "assess");
        if (!assessmentResult) {
          throw new AppError("internal_error", "Mail assessment evidence is missing.");
        }

        if (step === "reconcile_ledger") {
          const reconciled = await stewardship.reconcileAssessment(
            userId,
            snapshotResult.snapshot,
            assessmentResult.assessment,
          );
          await complete(step, idempotencyKey, reconciled);
          continue;
        }
        if (step === "dispatch_approved_rules") {
          const dispatched = await dispatchApprovedRules(userId);
          await complete(step, idempotencyKey, dispatched);
          continue;
        }
        if (step === "publish_review") {
          const publishSnapshot = await stewardship.snapshot(userId, scope);
          const publishAssessment = assessMail(publishSnapshot, MAIL_PLAYBOOK);
          const review = await stewardship.createReview(userId, publishSnapshot, publishAssessment);
          await complete(step, idempotencyKey, {
            assessment: publishAssessment,
            review,
            snapshot: publishSnapshot,
          } satisfies ReviewStepResult);
          continue;
        }
        const reviewResult = completedResult<ReviewStepResult>(records, "publish_review");
        if (!reviewResult) throw new AppError("internal_error", "Mail review evidence is missing.");

        let review = reviewResult.review;
        let verificationSnapshot = await stewardship.snapshot(userId, scope);
        let verificationAssessment = assessMail(verificationSnapshot, MAIL_PLAYBOOK);
        if (
          verificationAssessment.ledgerFingerprint !== review.ledgerFingerprint &&
          records.get("verify")?.status === "failed_recoverable"
        ) {
          await stewardship.reconcileAssessment(
            userId,
            verificationSnapshot,
            verificationAssessment,
          );
          const rebasedSnapshot = await stewardship.snapshot(userId, scope);
          const rebasedAssessment = assessMail(rebasedSnapshot, MAIL_PLAYBOOK);
          review = await stewardship.createReview(userId, rebasedSnapshot, rebasedAssessment);
          verificationSnapshot = await stewardship.snapshot(userId, scope);
          verificationAssessment = assessMail(verificationSnapshot, MAIL_PLAYBOOK);
        }
        if (verificationAssessment.ledgerFingerprint !== review.ledgerFingerprint) {
          await workspace.failStep({
            claimId,
            code: "mail_snapshot_changed",
            recoverable: true,
            runId,
            safeMessage: "Mail evidence changed while the review was being verified.",
            step,
          });
          const run = await workspace.getOwnedRun(userId, runId);
          return resultForRun(run, "Mail changed during maintenance and will be reviewed again.");
        }
        const verification: MaintenanceVerification = {
          blockers: verificationAssessment.blockers.map((code) => ({
            code,
            message: "Mail evidence or provider effects prevent settlement.",
            recovery: "Refresh Mail sources or reconcile the reported effect.",
          })),
          checkedAt: now().toISOString(),
          status:
            verificationAssessment.blockers.length > 0
              ? "blocked"
              : verificationAssessment.openQuestionCount > 0
                ? "questions"
                : verificationSnapshot.effectCounts.pending > 0
                  ? "failed"
                  : "passed",
        };
        const pendingEffects = verificationSnapshot.effectCounts.pending;
        if (pendingEffects > 0) {
          await workspace.failStep({
            claimId,
            code: "mail_effects_pending",
            recoverable: true,
            runId,
            safeMessage: "Mail provider effects are still pending.",
            step,
          });
          const run = await workspace.getOwnedRun(userId, runId);
          return resultForRun(run, "Mail maintenance is waiting for provider effects to settle.");
        }
        await complete(step, idempotencyKey, {
          ledgerFingerprint: verificationAssessment.ledgerFingerprint,
          reviewId: review.id,
          verification,
        });
        const settlement =
          verification.status === "blocked"
            ? "blocked"
            : verification.status === "questions"
              ? "completed_with_questions"
              : "completed";
        const questionCount = verificationAssessment.openQuestionCount;
        const summary =
          settlement === "completed"
            ? "Mail maintenance completed with current evidence and no outstanding questions or effects."
            : settlement === "completed_with_questions"
              ? `Mail maintenance completed with ${questionCount} question${questionCount === 1 ? "" : "s"} for the user.`
              : "Mail maintenance is blocked by source or provider-effect evidence.";
        const run = await workspace.settle({
          claimId,
          result: { reviewId: review.id, summary, verification },
          runId,
          status: settlement,
        });
        return { run, summary, verification };
      }
      throw new AppError("internal_error", "Mail maintenance ended without verification.");
    } catch (error) {
      const failure = safeError(error);
      await workspace.failStep({
        claimId,
        code: failure.code,
        recoverable: failure.recoverable,
        runId,
        safeMessage: failure.safeMessage,
        step: currentStep,
      });
      const run = await workspace.getOwnedRun(userId, runId);
      return resultForRun(run, failure.safeMessage);
    }
  }

  return {
    async maintain(
      userId: string,
      request: MaintenanceRequest,
    ): Promise<MailMaintenanceDispatchResult> {
      const run = await workspace.createOrResume(
        userId,
        "mail",
        request.scope,
        maintenanceRulebookVersion,
      );
      const result = await execute(run.id, userId);
      if (!result) {
        throw new AppError("conflict", "Mail maintenance could not read its current run.");
      }
      return result;
    },

    async getRun(userId: string, runId: string): Promise<MaintenanceRun> {
      return workspace.getOwnedRun(userId, runId);
    },

    async runDue(limit: number): Promise<MailMaintenanceDispatchResult[]> {
      const runIds = await workspace.listDueRunIds("mail", limit);
      const results: MailMaintenanceDispatchResult[] = [];
      for (const runId of runIds) {
        const result = await execute(runId);
        if (result) results.push(result);
      }
      return results;
    },

    async dispatchDue(limit: number): Promise<MailMaintenanceDispatchResult[]> {
      const runIds = await workspace.listDueRunIds("mail", limit);
      const results: MailMaintenanceDispatchResult[] = [];
      for (const runId of runIds) {
        const result = await execute(runId);
        if (result) results.push(result);
      }
      return results;
    },
  };
}

export type MailMaintenanceService = ReturnType<typeof createMailMaintenanceService>;
