import type { MailReview, MaintenanceRun } from "@personal-os/domain";
import { AppError } from "./errors.js";
import { assessMail, type MailAssessmentSnapshot } from "./mail-assessment.js";
import { createMailMaintenanceService } from "./mail-maintenance-service.js";
import { MAIL_PLAYBOOK } from "./mail-playbook.js";

const now = new Date("2026-08-25T16:00:00.000Z");
const userId = "10000000-0000-4000-8000-000000000001";
const runId = "20000000-0000-4000-8000-000000000001";

function snapshot(overrides: Partial<MailAssessmentSnapshot> = {}): MailAssessmentSnapshot {
  return {
    effectCounts: { failed: 0, pending: 0, reconcile: 0 },
    now: now.toISOString(),
    profileId: null,
    profileVersion: null,
    rulebookVersion: "rules-v1",
    sourceFreshness: "current",
    threads: [],
    ...overrides,
  };
}

function run(overrides: Partial<MaintenanceRun> = {}): MaintenanceRun {
  return {
    checkpoint: null,
    createdAt: now.toISOString(),
    domain: "mail",
    id: runId,
    lastSafeError: null,
    leaseExpiresAt: now.toISOString(),
    retryAt: null,
    rulebookVersion: "mail-maintenance-v1:1.0.0",
    scope: { type: "all_outstanding" },
    settledResult: null,
    sourceSnapshot: null,
    status: "running",
    updatedAt: now.toISOString(),
    userId,
    ...overrides,
  } as unknown as MaintenanceRun;
}

function harness(
  snapshots: MailAssessmentSnapshot[],
  options?: {
    claim?: boolean;
    records?: Array<{
      idempotencyKey: string;
      result: unknown;
      status: "completed" | "failed_recoverable";
      step: string;
    }>;
    refreshError?: unknown;
  },
) {
  const activeRun = run();
  let snapshotIndex = 0;
  const workspace = {
    claim: vi
      .fn()
      .mockResolvedValue(options?.claim === false ? null : { claimId: "claim-1", run: activeRun }),
    completeStep: vi.fn().mockResolvedValue(undefined),
    createOrResume: vi.fn().mockResolvedValue(activeRun),
    failStep: vi.fn().mockImplementation(async ({ code }: { code: string }) => {
      activeRun.lastSafeError = { code, message: code };
      activeRun.status = "failed_recoverable";
      return activeRun;
    }),
    getOwnedRun: vi.fn().mockImplementation(async () => activeRun),
    listDueRunIds: vi.fn().mockResolvedValue([runId]),
    listStepRecords: vi.fn().mockResolvedValue(options?.records ?? []),
    renewClaim: vi.fn().mockResolvedValue(activeRun),
    settle: vi.fn().mockImplementation(async ({ status }: { status: MaintenanceRun["status"] }) => {
      activeRun.status = status;
      return activeRun;
    }),
  };
  const stewardship = {
    createReview: vi
      .fn()
      .mockImplementation(async (_owner: string, source: MailAssessmentSnapshot) => {
        const assessment = assessMail(source, MAIL_PLAYBOOK);
        return {
          createdAt: now.toISOString(),
          effectCounts: source.effectCounts,
          evidenceCutoff: source.now,
          health: assessment.health,
          id: "30000000-0000-4000-8000-000000000001",
          ledgerFingerprint: assessment.ledgerFingerprint,
          nextMaintenanceAt: now.toISOString(),
          obligationCounts: assessment.obligationCounts,
          openQuestionCount: assessment.openQuestionCount,
          playbookVersion: MAIL_PLAYBOOK.version,
          profileVersion: source.profileVersion,
          rulebookVersion: source.rulebookVersion,
          sourceFreshness: source.sourceFreshness,
          state: assessment.proposedSettlement,
        } satisfies MailReview;
      }),
    reconcileAssessment: vi
      .fn()
      .mockResolvedValue({ dispositions: 0, obligations: 0, questions: 0 }),
    snapshot: vi.fn().mockImplementation(async () => {
      const value = snapshots[Math.min(snapshotIndex, snapshots.length - 1)];
      snapshotIndex += 1;
      return value;
    }),
  };
  const service = createMailMaintenanceService({
    dispatchApprovedRules: async () => ({ dispatched: 0 }),
    now: () => now,
    refreshSources: async () => {
      if (options?.refreshError) throw options.refreshError;
      return { enqueued: 0, readiness: "current" as const };
    },
    stewardship: stewardship as unknown as Parameters<
      typeof createMailMaintenanceService
    >[0]["stewardship"],
    workspace: workspace as unknown as Parameters<
      typeof createMailMaintenanceService
    >[0]["workspace"],
  });
  return { activeRun, service, stewardship, workspace };
}

describe("Mail maintenance orchestration edges", () => {
  it("returns the settled run when another worker already owns it", async () => {
    const { activeRun, service } = harness([snapshot()], { claim: false });
    activeRun.settledResult = {
      summary: "Already settled safely.",
      verification: null,
    };
    await expect(
      service.maintain(userId, { scope: { type: "all_outstanding" } }),
    ).resolves.toMatchObject({ summary: "Already settled safely.", verification: null });
    await expect(service.getRun(userId, runId)).resolves.toBe(activeRun);
  });

  it("omits a due run that another worker claims first", async () => {
    const { service } = harness([snapshot()], { claim: false });
    await expect(service.runDue(1)).resolves.toEqual([]);
    await expect(service.dispatchDue(1)).resolves.toEqual([]);
  });

  it("returns successfully settled due runs from both bounded dispatch entry points", async () => {
    const first = harness([snapshot()]);
    await expect(first.service.runDue(1)).resolves.toEqual([
      expect.objectContaining({ run: expect.objectContaining({ status: "completed" }) }),
    ]);

    const second = harness([snapshot()]);
    await expect(second.service.dispatchDue(1)).resolves.toEqual([
      expect.objectContaining({ run: expect.objectContaining({ status: "completed" }) }),
    ]);
  });

  it("fails recoverably while provider effects remain pending", async () => {
    const pending = snapshot({ effectCounts: { failed: 0, pending: 1, reconcile: 0 } });
    const { service, workspace } = harness([pending]);
    await expect(
      service.maintain(userId, { scope: { type: "all_outstanding" } }),
    ).resolves.toMatchObject({
      run: {
        lastSafeError: { code: "mail_effects_pending" },
        status: "failed_recoverable",
      },
      summary: "Mail maintenance is waiting for provider effects to settle.",
    });
    expect(workspace.failStep).toHaveBeenCalledWith(
      expect.objectContaining({ code: "mail_effects_pending", recoverable: true }),
    );
  });

  it("fails recoverably when evidence changes between publication and verification", async () => {
    const first = snapshot();
    const changed = snapshot({ rulebookVersion: "rules-v2" });
    const { service, workspace } = harness([first, first, changed]);
    await expect(
      service.maintain(userId, { scope: { type: "all_outstanding" } }),
    ).resolves.toMatchObject({
      run: {
        lastSafeError: { code: "mail_snapshot_changed" },
        status: "failed_recoverable",
      },
      summary: "Mail changed during maintenance and will be reviewed again.",
    });
    expect(workspace.failStep).toHaveBeenCalledWith(
      expect.objectContaining({ code: "mail_snapshot_changed", recoverable: true }),
    );
  });

  it("rebases a previously failed verification on current evidence", async () => {
    const original = snapshot();
    const changed = snapshot({ rulebookVersion: "rules-v2" });
    const originalAssessment = assessMail(original, MAIL_PLAYBOOK);
    const originalReview = {
      createdAt: now.toISOString(),
      effectCounts: original.effectCounts,
      evidenceCutoff: original.now,
      health: originalAssessment.health,
      id: "30000000-0000-4000-8000-000000000001",
      ledgerFingerprint: originalAssessment.ledgerFingerprint,
      nextMaintenanceAt: now.toISOString(),
      obligationCounts: originalAssessment.obligationCounts,
      openQuestionCount: originalAssessment.openQuestionCount,
      playbookVersion: MAIL_PLAYBOOK.version,
      profileVersion: original.profileVersion,
      rulebookVersion: original.rulebookVersion,
      sourceFreshness: original.sourceFreshness,
      state: originalAssessment.proposedSettlement,
    } satisfies MailReview;
    const completed = (step: string, result: unknown) => ({
      idempotencyKey: `mail:${step}:v1`,
      result,
      status: "completed" as const,
      step,
    });
    const { service, stewardship, workspace } = harness([changed, changed, changed], {
      records: [
        completed("refresh_sources", { enqueued: 0, readiness: "current" }),
        completed("snapshot", { snapshot: original }),
        completed("assess", { assessment: originalAssessment }),
        completed("reconcile_ledger", { dispositions: 0, obligations: 0, questions: 0 }),
        completed("dispatch_approved_rules", { dispatched: 0 }),
        completed("publish_review", {
          assessment: originalAssessment,
          review: originalReview,
          snapshot: original,
        }),
        {
          idempotencyKey: "mail:verify:v1",
          result: null,
          status: "failed_recoverable",
          step: "verify",
        },
      ],
    });

    await expect(
      service.maintain(userId, { scope: { type: "all_outstanding" } }),
    ).resolves.toMatchObject({ run: { status: "completed" }, verification: { status: "passed" } });
    expect(stewardship.reconcileAssessment).toHaveBeenCalledWith(
      userId,
      changed,
      expect.objectContaining({ ledgerFingerprint: expect.any(String) }),
    );
    expect(workspace.completeStep).toHaveBeenCalledTimes(1);
  });

  it("settles a resumed run from its persisted completed verification", async () => {
    const source = snapshot();
    const assessment = assessMail(source, MAIL_PLAYBOOK);
    const review = {
      createdAt: now.toISOString(),
      effectCounts: source.effectCounts,
      evidenceCutoff: source.now,
      health: assessment.health,
      id: "30000000-0000-4000-8000-000000000001",
      ledgerFingerprint: assessment.ledgerFingerprint,
      nextMaintenanceAt: now.toISOString(),
      obligationCounts: assessment.obligationCounts,
      openQuestionCount: assessment.openQuestionCount,
      playbookVersion: MAIL_PLAYBOOK.version,
      profileVersion: source.profileVersion,
      rulebookVersion: source.rulebookVersion,
      sourceFreshness: source.sourceFreshness,
      state: assessment.proposedSettlement,
    } satisfies MailReview;
    const completed = (step: string, result: unknown) => ({
      idempotencyKey: `mail:${step}:v1`,
      result,
      status: "completed" as const,
      step,
    });
    const verification = {
      blockers: [],
      checkedAt: now.toISOString(),
      status: "passed" as const,
    };
    const { service, workspace } = harness([source], {
      records: [
        completed("refresh_sources", { enqueued: 0, readiness: "current" }),
        completed("snapshot", { snapshot: source }),
        completed("assess", { assessment }),
        completed("reconcile_ledger", { dispositions: 0, obligations: 0, questions: 0 }),
        completed("dispatch_approved_rules", { dispatched: 0 }),
        completed("publish_review", { assessment, review, snapshot: source }),
        completed("verify", {
          ledgerFingerprint: assessment.ledgerFingerprint,
          reviewId: review.id,
          verification,
        }),
      ],
    });

    await expect(
      service.maintain(userId, { scope: { type: "all_outstanding" } }),
    ).resolves.toMatchObject({ run: { status: "completed" }, verification });
    expect(workspace.completeStep).not.toHaveBeenCalled();
    expect(workspace.failStep).not.toHaveBeenCalled();
  });

  it.each([
    [
      new AppError("invalid_request", "Unsafe request."),
      "invalid_request",
      false,
      "Unsafe request.",
    ],
    [
      new Error("private failure"),
      "mail_maintenance_temporary_failure",
      true,
      "Mail maintenance encountered a temporary internal failure.",
    ],
  ])("classifies maintenance failures without leaking internals", async (error, code, recoverable, summary) => {
    const { service, workspace } = harness([snapshot()], { refreshError: error });
    await expect(
      service.maintain(userId, { scope: { type: "all_outstanding" } }),
    ).resolves.toMatchObject({ summary });
    expect(workspace.failStep).toHaveBeenCalledWith(
      expect.objectContaining({ code, recoverable, safeMessage: summary, step: "refresh_sources" }),
    );
  });
});
