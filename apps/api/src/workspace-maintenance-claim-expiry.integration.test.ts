import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import {
  createDatabaseClient,
  type DatabaseClient,
  migrateDatabase,
  users,
  workspaceMaintenanceRuns,
} from "@personal-os/database";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { createWorkspaceMaintenanceService } from "./workspace-maintenance-service.js";

/** Authored for the exclusive Lead PG slot; not executed by the implementation worker. */
describe.sequential("workspace maintenance post-lock expiry", () => {
  let container: StartedPostgreSqlContainer;
  let database: DatabaseClient;
  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:17.5-alpine").start();
    database = createDatabaseClient(container.getConnectionUri());
    await migrateDatabase(database.db, resolve(process.cwd(), "packages/database/migrations"));
  }, 120000);
  afterAll(async () => {
    try {
      await database?.close();
    } finally {
      await container?.stop();
    }
  });
  async function fixture() {
    const userId = randomUUID();
    const claimId = randomUUID();
    await database.db.insert(users).values({
      id: userId,
      email: `${userId}@example.com`,
      displayName: "Claim expiry",
      passwordHash: "unused",
    });
    const [run] = await database.db
      .insert(workspaceMaintenanceRuns)
      .values({
        userId,
        domain: "finances",
        scope: { type: "all_outstanding" },
        rulebookVersion: "expiry",
        status: "running",
        leaseClaimId: claimId,
        leaseExpiresAt: new Date(Date.now() + 60000),
      })
      .returning();
    if (!run) throw new Error("run");
    return { userId, run, claimId };
  }
  it.each([
    "completeStep",
    "settle",
    "releaseForRetry",
    "checkpointAndRelease",
    "renewClaim",
  ] as const)("rejects %s when an actual row-lock wait crosses expiry", async (method) => {
    const f = await fixture();
    const service = createWorkspaceMaintenanceService({ db: database.db, now: () => new Date() });
    const blocker = await database.pool.connect();
    let pending: Promise<unknown> | undefined;
    try {
      await blocker.query("BEGIN");
      const pid = (await blocker.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0]
        ?.pid;
      await blocker.query(
        "UPDATE workspace_maintenance_runs SET lease_expires_at=clock_timestamp()+interval '5 seconds' WHERE id=$1",
        [f.run.id],
      );
      const operations = {
        completeStep: () =>
          service.completeStep({
            runId: f.run.id,
            claimId: f.claimId,
            step: "verify",
            idempotencyKey: randomUUID(),
            result: { verified: true },
          }),
        settle: () =>
          service.settle({ runId: f.run.id, claimId: f.claimId, status: "completed", result: {} }),
        releaseForRetry: () =>
          service.releaseForRetry({
            runId: f.run.id,
            claimId: f.claimId,
            code: "retry",
            safeMessage: "Retry",
          }),
        checkpointAndRelease: () =>
          service.checkpointAndRelease({
            runId: f.run.id,
            claimId: f.claimId,
            checkpoint: { phase: "challenge" },
            status: "awaiting_agent_challenge",
          }),
        renewClaim: () => service.renewClaim({ runId: f.run.id, claimId: f.claimId }),
      };
      pending = operations[method]().then(
        () => ({ ok: true }),
        (error) => ({ error }),
      );
      let waiting = false;
      const deadline = Date.now() + 3000;
      while (Date.now() < deadline) {
        const blocked = await database.pool.query(
          "SELECT 1 FROM pg_stat_activity WHERE $1::int=ANY(pg_blocking_pids(pid))",
          [pid],
        );
        waiting = (blocked.rowCount ?? 0) > 0;
        if (waiting) break;
        await new Promise((resolve) => setTimeout(resolve, 1));
      }
      expect(waiting).toBe(true);
      // Set a deadline AFTER the waiting transaction's NOW(), then cross it while holding its row.
      await blocker.query(
        "UPDATE workspace_maintenance_runs SET lease_expires_at=clock_timestamp()+interval '1 millisecond' WHERE id=$1",
        [f.run.id],
      );
      await blocker.query("SELECT pg_sleep(0.02)");
      expect(
        (
          await blocker.query(
            "SELECT lease_expires_at<=clock_timestamp() AS expired FROM workspace_maintenance_runs WHERE id=$1",
            [f.run.id],
          )
        ).rows[0]?.expired,
      ).toBe(true);
      await blocker.query("COMMIT");
      expect(await pending).toMatchObject({ error: { code: "conflict" } });
      const run = await service.getOwnedRun(f.userId, f.run.id);
      expect(run.status).toBe("running");
      const stored = await database.pool.query(
        "SELECT lease_claim_id FROM workspace_maintenance_runs WHERE id=$1",
        [f.run.id],
      );
      expect(stored.rows[0]?.lease_claim_id).toBe(f.claimId);
    } finally {
      await blocker.query("ROLLBACK");
      blocker.release();
      await pending;
    }
  });
  it("renews for the full unchanged duration measured after an actual valid row-lock wait", async () => {
    const f = await fixture();
    const service = createWorkspaceMaintenanceService({ db: database.db, now: () => new Date() });
    const blocker = await database.pool.connect();
    let pending: Promise<unknown> | undefined;
    try {
      await blocker.query("BEGIN");
      const pid = (await blocker.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0]
        ?.pid;
      await blocker.query(
        "UPDATE workspace_maintenance_runs SET updated_at=updated_at WHERE id=$1",
        [f.run.id],
      );
      pending = service.renewClaim({ runId: f.run.id, claimId: f.claimId });
      let waiting = false;
      const deadline = Date.now() + 3000;
      while (Date.now() < deadline) {
        const rows = await database.pool.query(
          "SELECT 1 FROM pg_stat_activity WHERE $1::int=ANY(pg_blocking_pids(pid))",
          [pid],
        );
        if ((rows.rowCount ?? 0) > 0) {
          waiting = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 1));
      }
      expect(waiting).toBe(true);
      await blocker.query("SELECT pg_sleep(0.02)");
      const releasedAt = (await blocker.query("SELECT clock_timestamp() AS at")).rows[0]?.at;
      await blocker.query("COMMIT");
      await pending;
      // Transaction-start NOW()+duration falls before this bound after the observed lock wait.
      const stored = await database.pool.query(
        "SELECT lease_expires_at >= $2::timestamptz + interval '120 seconds' AS full_duration, lease_claim_id FROM workspace_maintenance_runs WHERE id=$1",
        [f.run.id, releasedAt],
      );
      expect(stored.rows[0]).toMatchObject({ full_duration: true, lease_claim_id: f.claimId });
    } finally {
      await blocker.query("ROLLBACK");
      blocker.release();
      await pending;
    }
  });
});
