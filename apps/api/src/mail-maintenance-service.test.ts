import type { MailReview, MaintenanceRun } from "@personal-os/domain";
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

function harness(snapshots: MailAssessmentSnapshot[], options?: { claim?: boolean }) {
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
    listStepRecords: vi.fn().mockResolvedValue([]),
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
    refreshSources: async () => ({ enqueued: 0, readiness: "current" }),
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
});
