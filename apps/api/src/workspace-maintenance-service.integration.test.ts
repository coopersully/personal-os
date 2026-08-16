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

  it("commits each step once by stable name and idempotency key", async () => {
    const service = createWorkspaceMaintenanceService({
      db: database.db,
      now: () => new Date("2026-08-15T13:00:00.000Z"),
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
      result: { inspected: 3 },
      runId: run.id,
      step: "preflight",
    };

    await service.completeStep(input);
    await service.completeStep(input);
    await expect(
      service.completeStep({ ...input, idempotencyKey: "calendar:preflight:v2" }),
    ).rejects.toMatchObject({ code: "conflict" });
    await expect(service.completeStep({ ...input, step: "synchronize" })).rejects.toMatchObject({
      code: "conflict",
    });

    await expect(
      database.pool.query(
        `SELECT step_name, status, attempt_count, idempotency_key, safe_result
         FROM workspace_maintenance_steps
         WHERE run_id = $1`,
        [run.id],
      ),
    ).resolves.toMatchObject({
      rows: [
        {
          attempt_count: 1,
          idempotency_key: "calendar:preflight:v1",
          safe_result: { inspected: 3 },
          status: "completed",
          step_name: "preflight",
        },
      ],
    });
  });

  it("settles only the current unexpired claim and frees terminal history from the open slot", async () => {
    const service = createWorkspaceMaintenanceService({
      db: database.db,
      now: () => new Date("2026-08-15T14:00:00.000Z"),
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
      now: () => new Date("2026-08-15T15:00:00.000Z"),
    });
    const run = await service.createOrResume(
      userId,
      "goals",
      { type: "all_outstanding" },
      "rules:v1",
    );
    const firstClaim = await service.claim(run.id);
    if (!firstClaim) throw new Error("Maintenance run was not claimed.");
    await service.failStep({
      claimId: firstClaim.claimId,
      code: "temporarily_unavailable",
      recoverable: true,
      runId: run.id,
      safeMessage: "The dependency is temporarily unavailable.",
      step: "synchronize",
    });

    const recovered = await service.createOrResume(
      userId,
      "goals",
      { type: "all_outstanding" },
      "rules:v1",
    );
    expect(recovered).toMatchObject({ id: run.id, status: "failed_recoverable" });
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

    await expect(service.claim(run.id)).resolves.toBeNull();
    await expect(
      database.pool.query(
        `SELECT status, attempt_count, safe_error
         FROM workspace_maintenance_steps
         WHERE run_id = $1 AND step_name = 'synchronize'`,
        [run.id],
      ),
    ).resolves.toMatchObject({
      rows: [
        {
          attempt_count: 2,
          safe_error: {
            code: "invalid_rulebook",
            message: "The current rulebook cannot be executed.",
          },
          status: "failed_terminal",
        },
      ],
    });
  });
});
