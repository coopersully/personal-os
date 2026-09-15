import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import {
  createDatabaseClient,
  type DatabaseClient,
  financeAccounts,
  financeLedgerChallenges,
  financeMaintenanceCandidates,
  financeMaintenanceRuns,
  financePeriodReviews,
  financeSetupSessions,
  migrateDatabase,
  users,
  workspaceMaintenanceRuns,
  workspaceMaintenanceSteps,
} from "@personal-os/database";
import type { FinanceStatus } from "@personal-os/domain";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { eq, sql } from "drizzle-orm";
import type { FinanceMaintenanceService } from "../finance-maintenance-service.js";
import type { FinanceStatusService } from "../finance-status-service.js";
import type { Principal } from "../types.js";
import { createFinanceMaintenanceIntentService } from "./maintenance-intent-service.js";
import { legacyMaintenanceScope } from "./maintenance-service.js";

function required<T>(value: T | null | undefined): T {
  if (value == null) throw new Error("Missing fixture value");
  return value;
}

const now = () => new Date("2026-09-15T12:00:00Z");

describe("historical scope conversion", () => {
  it("preserves exact account/date boundaries and blocks ambiguous scopes", () => {
    const id = randomUUID();
    expect(
      legacyMaintenanceScope({ type: "accounts", accountIds: [id] }, "2026-09-15").scope,
    ).toEqual({ type: "target", entityType: "finance_account", id });
    expect(
      legacyMaintenanceScope({ type: "accounts", accountIds: [id, randomUUID()] }, "2026-09-15")
        .scope,
    ).toBeNull();
    expect(
      legacyMaintenanceScope({ type: "since", from: "2026-09-01" }, "2026-09-15"),
    ).toMatchObject({
      scope: { type: "window", start: "2026-09-01", end: "2026-09-15" },
      throughDate: "2026-09-15",
    });
    expect(
      legacyMaintenanceScope({ type: "since", from: "2026-10-01" }, "2026-09-15").scope,
    ).toBeNull();
    expect(legacyMaintenanceScope({ type: "unknown" }, "2026-09-15").scope).toBeNull();
  });
});

describe.sequential("canonical Finance intent and historical adoption", () => {
  let container: StartedPostgreSqlContainer;
  let database: DatabaseClient;
  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:17.5-alpine")
      .withDatabase("personal_os")
      .withUsername("personal_os")
      .withPassword("personal_os")
      .start();
    database = createDatabaseClient(container.getConnectionUri());
    await migrateDatabase(database.db, resolve(process.cwd(), "packages/database/migrations"));
  }, 120000);
  afterAll(async () => {
    await database?.close();
    await container?.stop();
  });
  async function fixture() {
    const [user] = await database.db
      .insert(users)
      .values({
        displayName: "Recovery",
        email: `${randomUUID()}@example.com`,
        passwordHash: "unused",
      })
      .returning();
    if (!user) throw new Error("Missing user");
    const principal: Principal = {
      userId: user.id,
      actorId: "test-agent",
      actorType: "agent",
      scopes: new Set(["finances:maintain"]),
    };
    const dispatchRun = vi.fn(async () => null);
    const recoverHandoff = vi.fn(async () => ({ recovered: false }));
    const getFinanceStatus = vi.fn(
      async () =>
        ({
          details: { rulebookVersion: "test-v1" },
          state: "maintained",
          freshness: { blockers: [] },
        }) as unknown as FinanceStatus,
    );
    const service = createFinanceMaintenanceIntentService({
      db: database.db,
      now,
      maintenance: { dispatchRun } as unknown as FinanceMaintenanceService,
      recoverHandoff,
      status: { getFinanceStatus } as unknown as FinanceStatusService,
    });
    return { userId: user.id, principal, service, dispatchRun, recoverHandoff, getFinanceStatus };
  }
  async function legacy(
    userId: string,
    scope: Record<string, unknown>,
    stage: "agent_audit" | "settled" = "agent_audit",
  ) {
    const [run] = await database.db
      .insert(financeMaintenanceRuns)
      .values({ userId, scope, stage })
      .returning();
    if (!run) throw new Error("Missing old run");
    return run;
  }
  it("starts/resumes one canonical run, exposes durable progress and denies read-only callers", async () => {
    const f = await fixture();
    const [left, right] = await Promise.all([
      f.service.maintainFinances(
        { operation: "start", scope: { type: "all_outstanding" } },
        f.principal,
      ),
      f.service.maintainFinances(
        { operation: "start", scope: { type: "all_outstanding" } },
        f.principal,
      ),
    ]);
    expect(left.data.run?.id).toBe(right.data.run?.id);
    expect(left).toMatchObject({
      outcome: "work_remaining",
      data: { run: { status: "queued" }, nextAction: { tool: "maintain_finances" } },
    });
    expect(await f.service.history(f.userId, { limit: 10 })).toMatchObject({
      items: [expect.objectContaining({ run: { ...left.data.run } })],
      nextCursor: null,
    });
    await expect(
      f.service.maintainFinances(
        { operation: "resume", runId: required(left.data.run).id },
        { ...f.principal, scopes: new Set(["finances:read"]) },
      ),
    ).rejects.toThrow("finances:maintain");
    const other = await fixture();
    await expect(other.service.getRun(other.userId, required(left.data.run).id)).rejects.toThrow(
      "not found",
    );
  });
  it("adopts an in-flight account once and preserves the old scope/stage without replay", async () => {
    const f = await fixture();
    const [account] = await database.db
      .insert(financeAccounts)
      .values({ userId: f.userId, name: "Checking", institution: "Fixture", provider: "manual" })
      .returning();
    const old = await legacy(f.userId, { type: "accounts", accountIds: [required(account).id] });
    const [a, b] = await Promise.all([
      f.service.maintainFinances({ operation: "resume", runId: old.id }, f.principal),
      f.service.maintainFinances({ operation: "resume", runId: old.id }, f.principal),
    ]);
    expect(a.data.run?.id).toBe(b.data.run?.id);
    expect(a.data).toMatchObject({
      recovery: { state: "adopted", originalScope: old.scope },
      run: { scope: { type: "target", entityType: "finance_account", id: required(account).id } },
    });
    const saved = await database.db.query.financeMaintenanceRuns.findFirst({
      where: eq(financeMaintenanceRuns.id, old.id),
    });
    expect(saved).toMatchObject({
      stage: "superseded",
      scope: old.scope,
      canonicalRunId: required(a.data.run).id,
      recovery: { originalStage: "agent_audit" },
    });
  });
  it("freezes since cutoff and durably blocks multiple accounts without widening", async () => {
    const f = await fixture();
    const accounts = await database.db
      .insert(financeAccounts)
      .values(
        ["One", "Two"].map((name) => ({
          userId: f.userId,
          name,
          institution: "Fixture",
          provider: "manual" as const,
        })),
      )
      .returning();
    const old = await legacy(f.userId, { type: "accounts", accountIds: accounts.map((a) => a.id) });
    const a = await f.service.maintainFinances({ operation: "resume", runId: old.id }, f.principal);
    const b = await f.service.maintainFinances({ operation: "resume", runId: old.id }, f.principal);
    expect(b.data).toEqual(a.data);
    expect(a).toMatchObject({
      outcome: "user_input_required",
      data: {
        run: null,
        recovery: {
          state: "blocked",
          originalScope: old.scope,
          reason: expect.stringContaining("each account"),
        },
      },
    });
    expect(f.dispatchRun).not.toHaveBeenCalled();
    const since = await legacy(f.userId, { type: "since", from: "2026-09-01" });
    const adopted = await f.service.maintainFinances(
      { operation: "resume", runId: since.id },
      f.principal,
    );
    expect(adopted.data).toMatchObject({
      run: { scope: { type: "window", start: "2026-09-01", end: "2026-09-15" } },
      recovery: { throughDate: "2026-09-15" },
    });
  });
  it("never adopts a legacy terminal stage as canonical completion", async () => {
    const f = await fixture();
    const old = await legacy(f.userId, { type: "all_outstanding" }, "settled");
    expect(
      await f.service.maintainFinances({ operation: "resume", runId: old.id }, f.principal),
    ).toMatchObject({
      outcome: "user_input_required",
      data: { run: null, recovery: { state: "historical" } },
    });
    expect(f.dispatchRun).not.toHaveBeenCalled();
    expect(
      await database.db
        .select()
        .from(financePeriodReviews)
        .where(eq(financePeriodReviews.userId, f.userId)),
    ).toHaveLength(0);
  });
  it("pages canonical and unverified history chronologically without leaking another user", async () => {
    const f = await fixture();
    const other = await fixture();
    const old = await legacy(f.userId, { type: "all_outstanding" }, "settled");
    await database.db
      .update(financeMaintenanceRuns)
      .set({ createdAt: new Date("2026-08-01T00:00:00Z") })
      .where(eq(financeMaintenanceRuns.id, old.id));
    const started = await f.service.maintainFinances(
      { operation: "start", scope: { type: "all_outstanding" } },
      f.principal,
    );
    const first = await f.service.history(f.userId, { limit: 1 });
    expect(first.items[0]?.run?.id).toBe(required(started.data.run).id);
    const second = await f.service.history(f.userId, {
      limit: 1,
      cursor: required(first.nextCursor),
    });
    expect(second).toMatchObject({
      items: [
        {
          run: null,
          recovery: { legacyRunId: old.id, originalStage: "settled", state: "historical" },
        },
      ],
      nextCursor: null,
    });
    expect(await f.service.getRun(f.userId, old.id)).toMatchObject({
      run: null,
      recovery: { legacyRunId: old.id, state: "historical" },
    });
    await expect(other.service.history(other.userId, { limit: 1, cursor: old.id })).rejects.toThrow(
      "not found",
    );
  });
  it("does not attach a narrow canonical scope to full setup", async () => {
    const f = await fixture();
    const [session] = await database.db
      .insert(financeSetupSessions)
      .values({ userId: f.userId, status: "initial_maintenance" })
      .returning();
    await f.service.maintainFinances(
      { operation: "start", scope: { type: "window", start: "2026-09-01", end: "2026-09-15" } },
      f.principal,
    );
    expect(
      await database.db.query.financeSetupSessions.findFirst({
        where: eq(financeSetupSessions.id, required(session).id),
      }),
    ).toMatchObject({ canonicalMaintenanceRunId: null, status: "initial_maintenance" });
  });
  it("reattaches setup to a fresh full run after questions without changing an active linkage", async () => {
    const f = await fixture();
    const [session] = await database.db
      .insert(financeSetupSessions)
      .values({ userId: f.userId, status: "initial_maintenance" })
      .returning();
    const first = await f.service.maintainFinances(
      { operation: "start", scope: { type: "all_outstanding" } },
      f.principal,
    );
    await database.db
      .update(workspaceMaintenanceRuns)
      .set({ status: "completed_with_questions" })
      .where(eq(workspaceMaintenanceRuns.id, required(first.data.run).id));
    const second = await f.service.maintainFinances(
      { operation: "start", scope: { type: "all_outstanding" } },
      f.principal,
    );
    expect(second.data.run?.id).not.toBe(first.data.run?.id);
    expect(
      await database.db.query.financeSetupSessions.findFirst({
        where: eq(financeSetupSessions.id, required(session).id),
      }),
    ).toMatchObject({
      canonicalMaintenanceRunId: required(second.data.run).id,
      status: "initial_maintenance",
    });
    await f.service.maintainFinances(
      { operation: "resume", runId: required(first.data.run).id },
      f.principal,
    );
    expect(
      await database.db.query.financeSetupSessions.findFirst({
        where: eq(financeSetupSessions.id, required(session).id),
      }),
    ).toMatchObject({ canonicalMaintenanceRunId: required(second.data.run).id });
  });
  it("settles setup only after its exact full canonical run verifies and publishes a review", async () => {
    const f = await fixture();
    const [session] = await database.db
      .insert(financeSetupSessions)
      .values({ userId: f.userId, status: "initial_maintenance" })
      .returning();
    const started = await f.service.maintainFinances(
      { operation: "start", scope: { type: "all_outstanding" } },
      f.principal,
    );
    const runId = required(started.data.run).id;
    expect(
      await database.db.query.financeSetupSessions.findFirst({
        where: eq(financeSetupSessions.id, required(session).id),
      }),
    ).toMatchObject({ canonicalMaintenanceRunId: runId, status: "initial_maintenance" });
    await database.db
      .update(workspaceMaintenanceRuns)
      .set({ status: "completed_with_questions" })
      .where(eq(workspaceMaintenanceRuns.id, runId));
    await f.service.maintainFinances({ operation: "resume", runId }, f.principal);
    expect(
      await database.db.query.financeSetupSessions.findFirst({
        where: eq(financeSetupSessions.id, required(session).id),
      }),
    ).toMatchObject({ status: "initial_maintenance" });
    await database.db
      .update(workspaceMaintenanceRuns)
      .set({ status: "completed" })
      .where(eq(workspaceMaintenanceRuns.id, runId));
    await f.service.recoverAcceptedWork();
    expect(
      await database.db.query.financeSetupSessions.findFirst({
        where: eq(financeSetupSessions.id, required(session).id),
      }),
    ).toMatchObject({ status: "initial_maintenance" });
    const [review] = await database.db
      .insert(financePeriodReviews)
      .values({
        userId: f.userId,
        runId,
        periodStart: "2026-09-01",
        periodEnd: "2026-09-30",
        cutoff: now(),
        status: "completed",
        report: {},
        sourceIds: [],
      })
      .returning();
    await database.db.insert(workspaceMaintenanceSteps).values([
      {
        runId,
        stepName: "verify",
        attemptClaimId: randomUUID(),
        status: "completed" as const,
        idempotencyKey: "verify",
        safeResult: { state: "clean" },
      },
      {
        runId,
        stepName: "period_review",
        attemptClaimId: randomUUID(),
        status: "completed" as const,
        idempotencyKey: "review",
        safeResult: { id: required(review).id },
      },
    ]);
    await f.service.recoverAcceptedWork();
    const settled = await database.db.query.financeSetupSessions.findFirst({
      where: eq(financeSetupSessions.id, required(session).id),
    });
    expect(settled).toMatchObject({ canonicalMaintenanceRunId: runId, status: "settled" });
    await f.service.recoverAcceptedWork();
    expect(
      (
        await database.db.query.financeSetupSessions.findFirst({
          where: eq(financeSetupSessions.id, required(session).id),
        })
      )?.version,
    ).toBe(settled?.version);
  });
  async function acceptedFixture(state: "prepared" | "resolved", updatedAt: string) {
    const f = await fixture();
    const started = await f.service.maintainFinances(
      { operation: "start", scope: { type: "all_outstanding" } },
      f.principal,
    );
    const runId = required(started.data.run).id;
    const revision = `sha256:${"a".repeat(64)}`;
    const [candidate] = await database.db
      .insert(financeMaintenanceCandidates)
      .values({
        userId: f.userId,
        runId,
        revision,
        state: state === "prepared" ? "ready_for_challenge" : "challenged",
      })
      .returning();
    const candidateId = required(candidate).id;
    const [challenge] = await database.db
      .insert(financeLedgerChallenges)
      .values({
        userId: f.userId,
        runId,
        candidateId,
        candidateRevision: revision,
        rubricVersion: "finance-ledger-challenge-v1",
        cutoff: now(),
        state,
        submittingAgentId: state === "resolved" ? "test-agent" : null,
      })
      .returning();
    await database.db
      .update(workspaceMaintenanceRuns)
      .set({
        status: "awaiting_agent_challenge",
        checkpoint: { phase: "challenge", candidateId, revision },
        updatedAt: sql`${updatedAt}::timestamptz`,
      })
      .where(eq(workspaceMaintenanceRuns.id, runId));
    if (state === "resolved")
      await database.db.insert(workspaceMaintenanceSteps).values({
        runId,
        stepName: "challenge_resolve",
        status: "completed",
        idempotencyKey: `resolve:${runId}`,
        attemptClaimId: randomUUID(),
        safeResult: { candidateId, candidateRevision: revision, questions: 0 },
      });
    f.recoverHandoff.mockClear();
    return { ...f, runId, candidateId, revision, challengeId: required(challenge).id };
  }
  it("returns only the prepared challenge for the current candidate and checkpoint", async () => {
    const f = await acceptedFixture("prepared", "2026-08-01T00:00:00.123456Z");
    expect(await f.service.getRun(f.userId, f.runId)).toMatchObject({
      challengeId: f.challengeId,
      nextAction: {
        tool: "get_finance_ledger_challenge",
        arguments: { challengeId: f.challengeId },
      },
    });
    await database.db
      .update(financeMaintenanceCandidates)
      .set({ revision: "changed" })
      .where(eq(financeMaintenanceCandidates.id, f.candidateId));
    expect(await f.service.getRun(f.userId, f.runId)).toMatchObject({
      challengeId: null,
      nextAction: null,
    });
    await database.db
      .update(financeMaintenanceCandidates)
      .set({ revision: f.revision, state: "superseded" })
      .where(eq(financeMaintenanceCandidates.id, f.candidateId));
    expect(await f.service.getRun(f.userId, f.runId)).toMatchObject({ challengeId: null });
  });
  it("isolates and rotates failed accepted handoffs so later work is reached", async () => {
    const prepared = await acceptedFixture("prepared", "2026-07-01T00:00:00Z");
    const failed = await acceptedFixture("resolved", "2026-08-01T00:00:00.123456Z");
    const later = await acceptedFixture("resolved", "2026-08-01T00:00:00.123457Z");
    prepared.recoverHandoff.mockRejectedValueOnce(new Error("temporary failure"));
    expect(await prepared.service.recoverAcceptedWork(1)).toMatchObject({ failedRecoveries: 1 });
    expect(prepared.recoverHandoff).toHaveBeenNthCalledWith(1, failed.userId, failed.runId);
    expect(
      await database.db.query.workspaceMaintenanceRuns.findFirst({
        where: eq(workspaceMaintenanceRuns.id, failed.runId),
      }),
    ).toMatchObject({ lastSafeError: { code: "finance_handoff_recovery_failed" } });
    expect(await prepared.service.recoverAcceptedWork(1)).toMatchObject({ failedRecoveries: 0 });
    expect(prepared.recoverHandoff).toHaveBeenNthCalledWith(2, later.userId, later.runId);
  });
  it("resumes a blocked canonical run only after its evidence blocker is repaired", async () => {
    const f = await fixture();
    const started = await f.service.maintainFinances(
      { operation: "start", scope: { type: "all_outstanding" } },
      f.principal,
    );
    const runId = required(started.data.run).id;
    await database.db
      .update(workspaceMaintenanceRuns)
      .set({ status: "blocked" })
      .where(eq(workspaceMaintenanceRuns.id, runId));
    f.getFinanceStatus.mockResolvedValueOnce({
      details: { rulebookVersion: "test-v1" },
      state: "blocked",
      freshness: { blockers: [{}] },
    } as unknown as FinanceStatus);
    expect(
      await f.service.maintainFinances({ operation: "resume", runId }, f.principal),
    ).toMatchObject({ data: { run: { id: runId, status: "blocked" } } });
    expect(
      await f.service.maintainFinances({ operation: "resume", runId }, f.principal),
    ).toMatchObject({ data: { run: { id: runId, status: "queued" } } });
  });
});
