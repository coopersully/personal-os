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
import type { PoolClient } from "pg";
import { createWorkspaceMaintenanceService } from "./workspace-maintenance-service.js";

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
  type Outcome = { ok: true } | { error: unknown };

  async function readyConnections() {
    const acquired: PoolClient[] = [];
    try {
      const blocker = await database.pool.connect();
      acquired.push(blocker);
      const observer = await database.pool.connect();
      acquired.push(observer);
      const worker = await database.pool.connect();
      acquired.push(worker);
      const pids = await Promise.all(
        acquired.map(async (client) => {
          const result = await client.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
          const pid = result.rows[0]?.pid;
          if (pid === undefined) throw new Error("Missing PostgreSQL backend PID");
          return pid;
        }),
      );
      const [blockerPid, observerPid, workerPid] = pids;
      if (blockerPid === undefined || observerPid === undefined || workerPid === undefined)
        throw new Error("Missing lock-readiness connection");
      // Hold the observer separately so polling cannot compete for the service's
      // warmed connection. No socket setup belongs in the lock-observation budget.
      worker.release();
      acquired.pop();
      return { blocker, observer, blockerPid, observerPid, workerPid };
    } catch (error) {
      for (const client of acquired) client.release();
      throw error;
    }
  }

  async function waitForRowLock(
    connections: Awaited<ReturnType<typeof readyConnections>>,
    pending: Promise<Outcome>,
  ) {
    const { blockerPid, observerPid, workerPid, observer } = connections;
    const state: { outcome?: Outcome } = {};
    void pending.then((outcome) => {
      state.outcome = outcome;
    });
    const deadline = Date.now() + 3000;
    let activity: unknown = [];
    while (Date.now() < deadline) {
      const result = await observer.query<{
        pid: number;
        blocking_pids: number[];
      }>(
        `SELECT pid, state, wait_event_type, wait_event, pg_blocking_pids(pid) AS blocking_pids,
                query FROM pg_stat_activity WHERE pid = ANY($1::int[])`,
        [[blockerPid, observerPid, workerPid]],
      );
      activity = result.rows;
      if (state.outcome !== undefined) break;
      if (
        result.rows.some((row) => row.pid === workerPid && row.blocking_pids.includes(blockerPid))
      )
        return;
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
    const outcome = state.outcome;
    throw new Error(
      `Row-lock readiness failed: ${JSON.stringify({
        blockerPid,
        observerPid,
        workerPid,
        outcome:
          outcome === undefined
            ? "pending"
            : "error" in outcome
              ? String(outcome.error)
              : "completed before lock observation",
        pool: {
          total: database.pool.totalCount,
          idle: database.pool.idleCount,
          waiting: database.pool.waitingCount,
        },
        activity,
      })}`,
      { cause: outcome && "error" in outcome ? outcome.error : undefined },
    );
  }

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
  it("reports an early claim rejection with backend diagnostics instead of a lock-wait assertion", async () => {
    const f = await fixture();
    const service = createWorkspaceMaintenanceService({ db: database.db, now: () => new Date() });
    const connections = await readyConnections();
    const { blocker, observer } = connections;
    let pending: Promise<Outcome> | undefined;
    try {
      await blocker.query("BEGIN");
      await blocker.query(
        "UPDATE workspace_maintenance_runs SET updated_at=updated_at WHERE id=$1",
        [f.run.id],
      );
      // A wrong claim fails the predicate before waiting on the locked row.
      pending = service.renewClaim({ runId: f.run.id, claimId: randomUUID() }).then(
        () => ({ ok: true }),
        (error) => ({ error }),
      );
      const failure: unknown = await waitForRowLock(connections, pending).catch((error) => error);
      expect(failure).toMatchObject({ cause: { code: "conflict" } });
      if (!(failure instanceof Error)) throw new Error("Missing lock-readiness diagnostic");
      expect(failure.message).toContain(`"blockerPid":${connections.blockerPid}`);
      expect(failure.message).toContain(`"workerPid":${connections.workerPid}`);
      expect(failure.message).toContain('"blocking_pids"');
      expect(failure.message).toContain('"wait_event"');
      expect(failure.message).toContain("claim is no longer current");
    } finally {
      try {
        await blocker.query("ROLLBACK");
      } finally {
        blocker.release();
        observer.release();
        await pending;
      }
    }
  });
  it.each([
    "completeStep",
    "settle",
    "releaseForRetry",
    "checkpointAndRelease",
    "renewClaim",
  ] as const)("rejects %s when an actual row-lock wait crosses expiry", async (method) => {
    const f = await fixture();
    const service = createWorkspaceMaintenanceService({ db: database.db, now: () => new Date() });
    const connections = await readyConnections();
    const { blocker, observer } = connections;
    let pending: Promise<Outcome> | undefined;
    try {
      await blocker.query("BEGIN");
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
      await waitForRowLock(connections, pending);
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
      try {
        await blocker.query("ROLLBACK");
      } finally {
        blocker.release();
        observer.release();
        await pending;
      }
    }
  });
  it("renews for the full unchanged duration measured after an actual valid row-lock wait", async () => {
    const f = await fixture();
    const service = createWorkspaceMaintenanceService({ db: database.db, now: () => new Date() });
    const connections = await readyConnections();
    const { blocker, observer } = connections;
    let pending: Promise<Outcome> | undefined;
    try {
      await blocker.query("BEGIN");
      await blocker.query(
        "UPDATE workspace_maintenance_runs SET updated_at=updated_at WHERE id=$1",
        [f.run.id],
      );
      pending = service.renewClaim({ runId: f.run.id, claimId: f.claimId }).then(
        () => ({ ok: true }),
        (error) => ({ error }),
      );
      await waitForRowLock(connections, pending);
      await blocker.query("SELECT pg_sleep(0.02)");
      const releasedAt = (await blocker.query("SELECT clock_timestamp() AS at")).rows[0]?.at;
      await blocker.query("COMMIT");
      expect(await pending).toEqual({ ok: true });
      // Transaction-start NOW()+duration falls before this bound after the observed lock wait.
      const stored = await database.pool.query(
        "SELECT lease_expires_at >= $2::timestamptz + interval '120 seconds' AS full_duration, lease_claim_id FROM workspace_maintenance_runs WHERE id=$1",
        [f.run.id, releasedAt],
      );
      expect(stored.rows[0]).toMatchObject({ full_duration: true, lease_claim_id: f.claimId });
    } finally {
      try {
        await blocker.query("ROLLBACK");
      } finally {
        blocker.release();
        observer.release();
        await pending;
      }
    }
  });
});
