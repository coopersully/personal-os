import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { createDatabaseClient, type DatabaseClient, migrateDatabase } from "@personal-os/database";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { sql } from "drizzle-orm";
import type { Principal } from "../types.js";
import { createFinanceBatchApprovalService } from "./batch-approval-service.js";

describe.sequential("bounded Finance approval transactions", () => {
  let container: StartedPostgreSqlContainer;
  let database: DatabaseClient;
  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:17.5-alpine").start();
    database = createDatabaseClient(container.getConnectionUri());
    await migrateDatabase(database.db, resolve(process.cwd(), "packages/database/migrations"));
  }, 120_000);
  afterAll(async () => {
    await database?.close();
    await container?.stop();
  });
  const userId = randomUUID();
  const principal: Principal = {
    actorType: "user",
    actorId: userId,
    userId,
    scopes: new Set(["finances:read", "finances:write"]),
  };
  const context = { principal, requestId: "limits" };
  const service = (sleeps: number) =>
    createFinanceBatchApprovalService({
      db: database.db,
      now: () => new Date("2026-11-12T16:00:00Z"),
      limits: { transactionMs: 300, statementMs: 250, lockMs: 100 },
      authorize: async () => {},
      // Several short statements: only the whole-transaction limit can stop this work.
      find: async (tx) => {
        for (let step = 0; step < sleeps; step++) await tx.execute(sql`select pg_sleep(0.1)`);
        return { id: randomUUID(), fingerprint: `sha256:${"a".repeat(64)}` };
      },
      execute: async () => {
        throw new Error("Never executes.");
      },
    });
  const sessionTimeouts = async () => {
    // Hold every pooled connection at once so each one reports its own session value.
    const pool = database.pool;
    const clients = await Promise.all(Array.from({ length: 4 }, () => pool.connect()));
    try {
      return await Promise.all(
        clients.map(async (client) => {
          const result = await client.query<{ timeout: string }>(
            "select current_setting('transaction_timeout') as timeout",
          );
          return result.rows[0]?.timeout;
        }),
      );
    } finally {
      for (const client of clients) client.release();
    }
  };

  it("cancels a transaction that outlives its limit with a typed, recoverable error", async () => {
    const started = performance.now();
    await expect(service(8).getContinuation(randomUUID(), context)).rejects.toMatchObject({
      code: "service_unavailable",
    });
    // Cancelled near the 300ms limit, not after the full 800ms of work.
    expect(performance.now() - started).toBeLessThan(700);
    // The terminated connection was discarded; the pool still serves requests.
    expect(await service(0).getContinuation(randomUUID(), context)).toBeNull();
  }, 20_000);

  it("leaves no transaction limit behind on pooled connections", async () => {
    expect(await service(1).getContinuation(randomUUID(), context)).toBeNull();
    expect(new Set(await sessionTimeouts())).toEqual(new Set(["0"]));
  }, 20_000);
});
