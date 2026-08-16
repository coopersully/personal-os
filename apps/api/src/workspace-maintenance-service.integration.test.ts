import { resolve } from "node:path";
import {
  createDatabaseClient,
  type DatabaseClient,
  migrateDatabase,
  users,
} from "@personal-os/database";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { createWorkspaceMaintenanceService } from "./workspace-maintenance-service.js";

describe.sequential("workspace maintenance service", () => {
  let container: StartedPostgreSqlContainer;
  let database: DatabaseClient;
  let userId: string;

  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:17.5-alpine")
      .withDatabase("personal_os")
      .withUsername("personal_os")
      .withPassword("personal_os")
      .start();
    database = createDatabaseClient(container.getConnectionUri());
    await migrateDatabase(database.db, resolve(process.cwd(), "packages/database/migrations"));
    const [user] = await database.db
      .insert(users)
      .values({
        displayName: "Maintenance",
        email: "maintenance@example.com",
        passwordHash: "unused",
        planningTimezone: "UTC",
      })
      .returning();
    if (!user) throw new Error("Fixture user was not created.");
    userId = user.id;
  }, 120_000);

  afterAll(async () => {
    await database.close();
    await container.stop();
  });

  it("resumes one compatible open run per user and domain and reports typed conflicts", async () => {
    const serviceOne = createWorkspaceMaintenanceService({
      db: database.db,
      now: () => new Date("2026-08-15T12:00:00.000Z"),
    });
    const serviceTwo = createWorkspaceMaintenanceService({
      db: database.db,
      now: () => new Date("2026-08-15T12:01:00.000Z"),
    });

    const [first, second] = await Promise.all([
      serviceOne.createOrResume(userId, "finances", { type: "all_outstanding" }, "rules:v1"),
      serviceTwo.createOrResume(userId, "finances", { type: "all_outstanding" }, "rules:v1"),
    ]);
    expect(second.id).toBe(first.id);
    expect(first).toMatchObject({
      domain: "finances",
      leaseExpiresAt: null,
      rulebookVersion: "rules:v1",
      scope: { type: "all_outstanding" },
      status: "queued",
      userId,
    });

    const targetId = "11111111-1111-4111-8111-111111111111";
    await database.pool.query(
      `UPDATE workspace_maintenance_runs
       SET scope = jsonb_build_object(
         'id', $2::text,
         'type', 'target',
         'entityType', 'finance_transaction'
       )
       WHERE id = $1`,
      [first.id, targetId],
    );
    await expect(
      serviceOne.createOrResume(
        userId,
        "finances",
        { id: targetId, entityType: "finance_transaction", type: "target" },
        "rules:v1",
      ),
    ).resolves.toMatchObject({ id: first.id, scope: { type: "target", id: targetId } });

    await expect(
      serviceOne.createOrResume(
        userId,
        "finances",
        { type: "window", start: "2026-08-01", end: "2026-08-31" },
        "rules:v1",
      ),
    ).rejects.toMatchObject({ code: "conflict" });
    await expect(
      serviceOne.createOrResume(userId, "finances", { type: "all_outstanding" }, "rules:v2"),
    ).rejects.toMatchObject({ code: "conflict" });
  });

  it("uses a two-minute PostgreSQL-time lease across skewed service clocks", async () => {
    const slowClockWorker = createWorkspaceMaintenanceService({
      db: database.db,
      now: () => new Date("2000-01-01T00:00:00.000Z"),
    });
    const fastClockWorker = createWorkspaceMaintenanceService({
      db: database.db,
      now: () => new Date("2100-01-01T00:00:00.000Z"),
    });
    const run = await slowClockWorker.createOrResume(
      userId,
      "mail",
      { type: "all_outstanding" },
      "rules:v1",
    );

    const firstClaim = await slowClockWorker.claim(run.id);
    expect(firstClaim).not.toBeNull();
    await expect(fastClockWorker.claim(run.id)).resolves.toBeNull();
    const lease = await database.pool.query<{ remaining_ms: number }>(
      `SELECT EXTRACT(EPOCH FROM (lease_expires_at - NOW())) * 1000 AS remaining_ms
       FROM workspace_maintenance_runs
       WHERE id = $1`,
      [run.id],
    );
    const remainingMs = Number(lease.rows[0]?.remaining_ms);
    expect(remainingMs).toBeGreaterThan(110_000);
    expect(remainingMs).toBeLessThanOrEqual(120_000);

    await database.pool.query(
      `UPDATE workspace_maintenance_runs
       SET lease_expires_at = NOW() - INTERVAL '1 second'
       WHERE id = $1`,
      [run.id],
    );
    const recoveredClaim = await fastClockWorker.claim(run.id);
    expect(recoveredClaim).not.toBeNull();
    expect(recoveredClaim?.claimId).not.toBe(firstClaim?.claimId);

    await expect(
      slowClockWorker.completeStep({
        claimId: firstClaim?.claimId ?? "",
        idempotencyKey: "mail:preflight:v1",
        result: { completed: true },
        runId: run.id,
        step: "preflight",
      }),
    ).rejects.toMatchObject({ code: "conflict" });
    await expect(
      slowClockWorker.settle({
        claimId: firstClaim?.claimId ?? "",
        result: { completed: true },
        runId: run.id,
        status: "completed",
      }),
    ).rejects.toMatchObject({ code: "conflict" });
  });

  it("renews only the current unexpired claim using PostgreSQL time", async () => {
    const service = createWorkspaceMaintenanceService({
      db: database.db,
      now: () => new Date("2100-01-01T00:00:00.000Z"),
    });
    const owner = await database.db
      .insert(users)
      .values({
        displayName: "Lease renewal owner",
        email: `lease-renewal-${crypto.randomUUID()}@example.com`,
        passwordHash: "unused",
        planningTimezone: "UTC",
      })
      .returning({ id: users.id });
    const ownerId = owner[0]?.id;
    if (!ownerId) throw new Error("Lease renewal fixture user was not created.");
    const run = await service.createOrResume(
      ownerId,
      "finances",
      { type: "all_outstanding" },
      "rules:v1",
    );
    const claim = await service.claim(run.id);
    if (!claim) throw new Error("Lease renewal fixture was not claimed.");

    await database.pool.query(
      `UPDATE workspace_maintenance_runs
       SET lease_expires_at = NOW() + INTERVAL '10 seconds'
       WHERE id = $1`,
      [run.id],
    );
    const renewed = await service.renewClaim({ claimId: claim.claimId, runId: run.id });
    expect(renewed.status).toBe("running");
    const lease = await database.pool.query<{ remaining_ms: string }>(
      `SELECT EXTRACT(EPOCH FROM (lease_expires_at - NOW())) * 1000 AS remaining_ms
       FROM workspace_maintenance_runs
       WHERE id = $1`,
      [run.id],
    );
    expect(Number(lease.rows[0]?.remaining_ms)).toBeGreaterThan(110_000);

    await expect(
      service.renewClaim({ claimId: crypto.randomUUID(), runId: run.id }),
    ).rejects.toMatchObject({ code: "conflict" });
    await database.pool.query(
      `UPDATE workspace_maintenance_runs
       SET lease_expires_at = NOW() - INTERVAL '1 second'
       WHERE id = $1`,
      [run.id],
    );
    await expect(
      service.renewClaim({ claimId: claim.claimId, runId: run.id }),
    ).rejects.toMatchObject({ code: "conflict" });
  });

  it("lists due work and durably releases a partial checkpoint for another runtime", async () => {
    const firstRuntime = createWorkspaceMaintenanceService({
      db: database.db,
      now: () => new Date("2026-08-15T12:00:00.000Z"),
    });
    const secondRuntime = createWorkspaceMaintenanceService({
      db: database.db,
      now: () => new Date("2026-08-15T12:00:01.000Z"),
    });
    const owner = await database.db
      .insert(users)
      .values({
        displayName: "Continuation owner",
        email: `continuation-${crypto.randomUUID()}@example.com`,
        passwordHash: "unused",
        planningTimezone: "UTC",
      })
      .returning({ id: users.id });
    const ownerId = owner[0]?.id;
    if (!ownerId) throw new Error("Continuation fixture user was not created.");
    const run = await firstRuntime.createOrResume(
      ownerId,
      "finances",
      { type: "all_outstanding" },
      "rules:v1",
    );

    await expect(firstRuntime.listDueRunIds("finances", 5)).resolves.toContain(run.id);
    const claim = await firstRuntime.claim(run.id);
    if (!claim) throw new Error("Continuation fixture run was not claimed.");
    await expect(secondRuntime.listDueRunIds("finances", 5)).resolves.not.toContain(run.id);
    await firstRuntime.checkpointAndRelease({
      checkpoint: { cursor: "opaque-next", step: "categorize" },
      claimId: claim.claimId,
      runId: run.id,
    });

    await expect(secondRuntime.listDueRunIds("finances", 5)).resolves.toContain(run.id);
    const resumedClaim = await secondRuntime.claim(run.id);
    expect(resumedClaim?.run.checkpoint).toEqual({ cursor: "opaque-next", step: "categorize" });
    await expect(secondRuntime.getOwnedRun(ownerId, run.id)).resolves.toMatchObject({ id: run.id });
    await expect(secondRuntime.getOwnedRun(userId, run.id)).rejects.toMatchObject({
      code: "not_found",
    });
  });

  it("commits each step once by stable name and idempotency key", async () => {
    const service = createWorkspaceMaintenanceService({
      db: database.db,
      now: () => new Date("2100-01-01T00:00:00.000Z"),
    });
    const run = await service.createOrResume(
      userId,
      "calendar",
      { type: "all_outstanding" },
      "rules:v1",
    );
    const claim = await service.claim(run.id);
    if (!claim) throw new Error("Maintenance run was not claimed.");
    const input = {
      claimId: claim.claimId,
      idempotencyKey: "calendar:preflight:v1",
      result: {
        inspected: 3,
        groups: { pending: 1, completed: 2 },
        ids: ["one", "two"],
      },
      runId: run.id,
      step: "preflight",
    };

    await service.completeStep(input);
    await service.completeStep({
      ...input,
      result: {
        ids: ["one", "two"],
        groups: { completed: 2, pending: 1 },
        inspected: 3,
      },
    });
    await expect(
      service.completeStep({
        ...input,
        result: {
          ids: ["two", "one"],
          groups: { completed: 2, pending: 1 },
          inspected: 3,
        },
      }),
    ).rejects.toMatchObject({ code: "conflict" });
    await expect(
      service.completeStep({ ...input, idempotencyKey: "calendar:preflight:v2" }),
    ).rejects.toMatchObject({ code: "conflict" });
    await expect(service.completeStep({ ...input, step: "synchronize" })).rejects.toMatchObject({
      code: "conflict",
    });

    await expect(
      database.pool.query(
        `SELECT step_name, status, attempt_count, idempotency_key, safe_result,
                attempt_claim_id,
                ABS(EXTRACT(EPOCH FROM (updated_at - NOW()))) AS updated_age_seconds
         FROM workspace_maintenance_steps
         WHERE run_id = $1`,
        [run.id],
      ),
    ).resolves.toMatchObject({
      rows: [
        {
          attempt_count: 1,
          attempt_claim_id: claim.claimId,
          idempotency_key: "calendar:preflight:v1",
          safe_result: {
            groups: { completed: 2, pending: 1 },
            ids: ["one", "two"],
            inspected: 3,
          },
          status: "completed",
          step_name: "preflight",
        },
      ],
    });
    const completedTimestamps = await database.pool.query<{
      run_age_seconds: string;
      step_age_seconds: string;
    }>(
      `SELECT
         ABS(EXTRACT(EPOCH FROM (runs.updated_at - NOW()))) AS run_age_seconds,
         ABS(EXTRACT(EPOCH FROM (steps.updated_at - NOW()))) AS step_age_seconds
       FROM workspace_maintenance_runs AS runs
       JOIN workspace_maintenance_steps AS steps ON steps.run_id = runs.id
       WHERE runs.id = $1`,
      [run.id],
    );
    expect(Number(completedTimestamps.rows[0]?.run_age_seconds)).toBeLessThan(5);
    expect(Number(completedTimestamps.rows[0]?.step_age_seconds)).toBeLessThan(5);

    await database.pool.query(
      `UPDATE workspace_maintenance_runs
       SET lease_expires_at = NOW() - INTERVAL '1 second'
       WHERE id = $1`,
      [run.id],
    );
    const retryClaim = await service.claim(run.id);
    if (!retryClaim) throw new Error("Maintenance run was not reclaimed.");
    await expect(
      service.failStep({
        claimId: retryClaim.claimId,
        code: "late_failure",
        recoverable: false,
        runId: run.id,
        safeMessage: "A completed step cannot be replaced.",
        step: "preflight",
      }),
    ).rejects.toMatchObject({ code: "conflict" });
  });

  it("settles only the current unexpired claim and frees terminal history from the open slot", async () => {
    const service = createWorkspaceMaintenanceService({
      db: database.db,
      now: () => new Date("2100-01-01T00:00:00.000Z"),
    });
    const run = await service.createOrResume(
      userId,
      "tasks",
      { type: "all_outstanding" },
      "rules:v1",
    );
    const claim = await service.claim(run.id);
    if (!claim) throw new Error("Maintenance run was not claimed.");
    const completed = await service.settle({
      claimId: claim.claimId,
      result: { completedSteps: 1 },
      runId: run.id,
      status: "completed",
    });
    expect(completed).toMatchObject({
      id: run.id,
      leaseExpiresAt: null,
      settledResult: { completedSteps: 1 },
      status: "completed",
    });
    const settledTimestamp = await database.pool.query<{ age_seconds: string }>(
      `SELECT ABS(EXTRACT(EPOCH FROM (updated_at - NOW()))) AS age_seconds
       FROM workspace_maintenance_runs WHERE id = $1`,
      [run.id],
    );
    expect(Number(settledTimestamp.rows[0]?.age_seconds)).toBeLessThan(5);
    await expect(
      service.settle({
        claimId: claim.claimId,
        result: {},
        runId: run.id,
        status: "completed",
      }),
    ).rejects.toMatchObject({ code: "conflict" });

    const next = await service.createOrResume(
      userId,
      "tasks",
      { type: "all_outstanding" },
      "rules:v1",
    );
    expect(next.id).not.toBe(run.id);
  });

  it("persists recoverable and terminal step failures with fenced recovery", async () => {
    const service = createWorkspaceMaintenanceService({
      db: database.db,
      now: () => new Date("2100-01-01T00:00:00.000Z"),
    });
    const run = await service.createOrResume(
      userId,
      "goals",
      { type: "all_outstanding" },
      "rules:v1",
    );
    const firstClaim = await service.claim(run.id);
    if (!firstClaim) throw new Error("Maintenance run was not claimed.");
    const firstFailure = {
      claimId: firstClaim.claimId,
      code: "temporarily_unavailable",
      recoverable: true,
      runId: run.id,
      safeMessage: "The dependency is temporarily unavailable.",
      step: "synchronize",
    } as const;
    await service.failStep(firstFailure);
    await service.failStep(firstFailure);
    await expect(
      service.failStep({ ...firstFailure, safeMessage: "Different failure content." }),
    ).rejects.toMatchObject({ code: "conflict" });
    await expect(service.failStep({ ...firstFailure, recoverable: false })).rejects.toMatchObject({
      code: "conflict",
    });

    const recovered = await service.createOrResume(
      userId,
      "goals",
      { type: "all_outstanding" },
      "rules:v1",
    );
    expect(recovered).toMatchObject({
      id: run.id,
      retryAt: expect.any(String),
      status: "failed_recoverable",
    });
    await expect(service.claim(run.id)).resolves.toBeNull();
    const firstFailureState = await database.pool.query<{
      attempt_claim_id: string;
      attempt_count: number;
      run_age_seconds: string;
      step_age_seconds: string;
      retry_remaining_seconds: string;
    }>(
      `SELECT steps.attempt_claim_id, steps.attempt_count,
              ABS(EXTRACT(EPOCH FROM (runs.updated_at - NOW()))) AS run_age_seconds,
              ABS(EXTRACT(EPOCH FROM (steps.updated_at - NOW()))) AS step_age_seconds,
              EXTRACT(EPOCH FROM (runs.retry_at - NOW())) AS retry_remaining_seconds
       FROM workspace_maintenance_runs AS runs
       JOIN workspace_maintenance_steps AS steps ON steps.run_id = runs.id
       WHERE runs.id = $1 AND steps.step_name = 'synchronize'`,
      [run.id],
    );
    expect(firstFailureState.rows[0]).toMatchObject({
      attempt_claim_id: firstClaim.claimId,
      attempt_count: 1,
    });
    expect(Number(firstFailureState.rows[0]?.retry_remaining_seconds)).toBeGreaterThan(50);
    expect(Number(firstFailureState.rows[0]?.retry_remaining_seconds)).toBeLessThanOrEqual(60);
    expect(Number(firstFailureState.rows[0]?.run_age_seconds)).toBeLessThan(5);
    expect(Number(firstFailureState.rows[0]?.step_age_seconds)).toBeLessThan(5);

    await database.pool.query(
      `UPDATE workspace_maintenance_runs SET retry_at = NOW() - INTERVAL '1 second' WHERE id = $1`,
      [run.id],
    );
    const secondClaim = await service.claim(run.id);
    if (!secondClaim) throw new Error("Recoverable maintenance run was not reclaimed.");
    await service.failStep({
      claimId: secondClaim.claimId,
      code: "invalid_rulebook",
      recoverable: false,
      runId: run.id,
      safeMessage: "The current rulebook cannot be executed.",
      step: "synchronize",
    });
    await service.failStep({
      claimId: secondClaim.claimId,
      code: "invalid_rulebook",
      recoverable: false,
      runId: run.id,
      safeMessage: "The current rulebook cannot be executed.",
      step: "synchronize",
    });

    await expect(service.claim(run.id)).resolves.toBeNull();
    await expect(
      database.pool.query(
        `SELECT status, attempt_count, attempt_claim_id, safe_error
         FROM workspace_maintenance_steps
         WHERE run_id = $1 AND step_name = 'synchronize'`,
        [run.id],
      ),
    ).resolves.toMatchObject({
      rows: [
        {
          attempt_count: 2,
          attempt_claim_id: secondClaim.claimId,
          safe_error: {
            code: "invalid_rulebook",
            message: "The current rulebook cannot be executed.",
          },
          status: "failed_terminal",
        },
      ],
    });

    const successAfterRetryRun = await service.createOrResume(
      userId,
      "goals",
      { type: "all_outstanding" },
      "rules:v1",
    );
    expect(successAfterRetryRun.id).not.toBe(run.id);
    const failedClaim = await service.claim(successAfterRetryRun.id);
    if (!failedClaim) throw new Error("Retry-success run was not claimed.");
    await service.failStep({
      claimId: failedClaim.claimId,
      code: "temporarily_unavailable",
      recoverable: true,
      runId: successAfterRetryRun.id,
      safeMessage: "The dependency is temporarily unavailable.",
      step: "synchronize",
    });
    await database.pool.query(
      `UPDATE workspace_maintenance_runs SET retry_at = NOW() - INTERVAL '1 second' WHERE id = $1`,
      [successAfterRetryRun.id],
    );
    const successfulClaim = await service.claim(successAfterRetryRun.id);
    if (!successfulClaim) throw new Error("Due retry-success run was not reclaimed.");
    await service.completeStep({
      claimId: successfulClaim.claimId,
      idempotencyKey: "goals:synchronize:v1",
      result: { synchronized: true },
      runId: successAfterRetryRun.id,
      step: "synchronize",
    });
    await expect(
      database.pool.query(
        `SELECT status, attempt_count, attempt_claim_id, idempotency_key, safe_error, safe_result
         FROM workspace_maintenance_steps
         WHERE run_id = $1 AND step_name = 'synchronize'`,
        [successAfterRetryRun.id],
      ),
    ).resolves.toMatchObject({
      rows: [
        {
          attempt_claim_id: successfulClaim.claimId,
          attempt_count: 2,
          idempotency_key: "goals:synchronize:v1",
          safe_error: null,
          safe_result: { synchronized: true },
          status: "completed",
        },
      ],
    });
  });

  it("authoritatively requeues blocked and approval runs with optimistic evidence", async () => {
    const service = createWorkspaceMaintenanceService({
      db: database.db,
      now: () => new Date("2100-01-01T00:00:00.000Z"),
    });
    const run = await service.createOrResume(
      userId,
      "reminders",
      { type: "all_outstanding" },
      "rules:v1",
    );
    const blockedClaim = await service.claim(run.id);
    if (!blockedClaim) throw new Error("Maintenance run was not claimed.");
    await service.settle({
      claimId: blockedClaim.claimId,
      result: { blocker: "authorization" },
      runId: run.id,
      status: "blocked",
    });

    await expect(
      service.requeue({
        expectedRulebookVersion: "rules:v1",
        expectedStatus: "awaiting_approval",
        runId: run.id,
      }),
    ).rejects.toMatchObject({ code: "conflict" });
    await expect(
      service.requeue({
        expectedRulebookVersion: "rules:v2",
        expectedStatus: "blocked",
        runId: run.id,
      }),
    ).rejects.toMatchObject({ code: "conflict" });
    const queuedFromBlocked = await service.requeue({
      expectedRulebookVersion: "rules:v1",
      expectedStatus: "blocked",
      runId: run.id,
    });
    expect(queuedFromBlocked).toMatchObject({
      id: run.id,
      lastSafeError: null,
      retryAt: null,
      settledResult: null,
      status: "queued",
    });
    await expect(
      service.requeue({
        expectedRulebookVersion: "rules:v1",
        expectedStatus: "blocked",
        runId: run.id,
      }),
    ).rejects.toMatchObject({ code: "conflict" });
    await expect(
      service.requeue({
        expectedRulebookVersion: "rules:v1",
        expectedStatus: "queued" as never,
        runId: run.id,
      }),
    ).rejects.toMatchObject({ code: "invalid_request" });
    const requeueTimestamp = await database.pool.query<{ age_seconds: string }>(
      `SELECT ABS(EXTRACT(EPOCH FROM (updated_at - NOW()))) AS age_seconds
       FROM workspace_maintenance_runs WHERE id = $1`,
      [run.id],
    );
    expect(Number(requeueTimestamp.rows[0]?.age_seconds)).toBeLessThan(5);

    const approvalClaim = await service.claim(run.id);
    if (!approvalClaim) throw new Error("Requeued maintenance run was not claimable.");
    await service.settle({
      claimId: approvalClaim.claimId,
      result: { approvalId: "approval-1" },
      runId: run.id,
      status: "awaiting_approval",
    });
    const queuedFromApproval = await service.requeue({
      expectedRulebookVersion: "rules:v1",
      expectedStatus: "awaiting_approval",
      runId: run.id,
    });
    expect(queuedFromApproval).toMatchObject({ id: run.id, status: "queued" });
    const recoverableClaim = await service.claim(run.id);
    if (!recoverableClaim) throw new Error("Approval-requeued run was not claimable.");
    const recoverable = await service.settle({
      claimId: recoverableClaim.claimId,
      result: { retryReason: "provider unavailable" },
      runId: run.id,
      status: "failed_recoverable",
    });
    expect(recoverable).toMatchObject({
      id: run.id,
      retryAt: expect.any(String),
      status: "failed_recoverable",
    });
    await expect(service.claim(run.id)).resolves.toBeNull();
  });
});
