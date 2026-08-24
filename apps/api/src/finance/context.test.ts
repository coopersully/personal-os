import { resolve } from "node:path";
import {
  createDatabaseClient,
  type Database,
  type DatabaseClient,
  financeAgentSettings,
  migrateDatabase,
  users,
} from "@personal-os/database";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { eq, sql } from "drizzle-orm";
import type { Principal } from "../types.js";
import {
  executeFinanceIdempotently,
  loadFinanceAuthorization,
  requireFinanceMutation,
} from "./context.js";

describe.sequential("trusted Finance mutation context", () => {
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
        displayName: "Finance context",
        email: "finance-context@example.com",
        passwordHash: "unused",
      })
      .returning();
    if (!user) throw new Error("Fixture user was not created.");
    userId = user.id;
    await database.db.insert(financeAgentSettings).values({ reviewBypassEnabled: true, userId });
  }, 120_000);

  afterAll(async () => {
    await database.close();
    await container.stop();
  });

  it("allows a fully scoped bypass agent and preserves its identity", async () => {
    const principal: Principal = {
      actorId: "finance-agent",
      actorType: "agent",
      scopes: new Set(["finances:read", "finances:write"]),
      userId,
    };
    await expect(
      loadFinanceAuthorization({ db: database.db, principal, requestId: "request-1" }),
    ).resolves.toMatchObject({
      actorId: "finance-agent",
      actorType: "agent",
      bypassEnabled: true,
      canMutate: true,
      canSelfApprove: true,
      requestId: "request-1",
      userId,
    });
  });

  it("replays the first result and rejects reuse for different work", async () => {
    const principal: Principal = {
      actorId: "finance-agent",
      actorType: "agent",
      scopes: new Set(["finances:write"]),
      userId,
    };
    const context = await loadFinanceAuthorization({
      db: database.db,
      principal,
      requestId: "request-2",
    });
    const mutate = vi.fn(async () => ({ id: "created-once" }));
    const operation = {
      idempotencyKey: "key-1",
      operation: "create_finance_goal",
      payload: { name: "Reserve" },
    };

    await expect(
      executeFinanceIdempotently(database.db, context, operation, mutate),
    ).resolves.toEqual({ id: "created-once" });
    await expect(
      executeFinanceIdempotently(database.db, context, operation, mutate),
    ).resolves.toEqual({ id: "created-once" });
    expect(mutate).toHaveBeenCalledOnce();

    await expect(
      executeFinanceIdempotently(
        database.db,
        context,
        { ...operation, operation: "remove_finance_goal" },
        mutate,
      ),
    ).rejects.toMatchObject({ code: "invalid_request" });
    await expect(
      executeFinanceIdempotently(
        database.db,
        context,
        { ...operation, payload: { name: "Different reserve" } },
        mutate,
      ),
    ).rejects.toMatchObject({ code: "invalid_request" });
  });

  it("bounds a unique-claim retry to one additional transaction attempt", async () => {
    const retryResult = { retried: true };
    const transaction = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error("claim collision"), { code: "23505" }))
      .mockResolvedValueOnce(retryResult);
    const retryDatabase = { transaction } as unknown as Database;
    const context = {
      actorId: userId,
      actorType: "user" as const,
      bypassEnabled: false,
      canMutate: true,
      canSelfApprove: false,
      requestId: "bounded-retry",
      userId,
    };

    await expect(
      executeFinanceIdempotently(
        retryDatabase,
        context,
        {
          idempotencyKey: "bounded-retry",
          operation: "finance.retry",
          payload: { test: true },
        },
        async () => ({ unexpected: true }),
      ),
    ).resolves.toEqual(retryResult);
    expect(transaction).toHaveBeenCalledTimes(2);
  });

  it("rejects missing scope, records failures, and coalesces concurrent retries", async () => {
    const readOnly = await loadFinanceAuthorization({
      db: database.db,
      principal: {
        actorId: "read-only-agent",
        actorType: "agent",
        scopes: new Set(["finances:read"]),
        userId,
      },
      requestId: "read-only",
    });
    expect(() => requireFinanceMutation(readOnly)).toThrow("finances:write");
    const userContext = await loadFinanceAuthorization({
      db: database.db,
      principal: {
        actorId: userId,
        actorType: "user",
        scopes: new Set(["finances:write"]),
        userId,
      },
      requestId: "user-context",
    });
    expect(userContext).toMatchObject({ canMutate: true, canSelfApprove: false });
    expect(() =>
      requireFinanceMutation(userContext, { approvalSource: "agent_self_approval" }),
    ).toThrow("self-approval");

    const failed = {
      idempotencyKey: "failed-operation",
      operation: "finance.failure",
      payload: { test: true },
    };
    await expect(
      executeFinanceIdempotently(database.db, userContext, failed, async () => {
        throw "non-error failure";
      }),
    ).rejects.toBe("non-error failure");
    await expect(
      executeFinanceIdempotently(database.db, userContext, failed, async () => ({ ok: true })),
    ).rejects.toThrow("previously failed");

    const runningOperation = {
      idempotencyKey: "running-operation",
      operation: "finance.running",
      payload: { test: true },
    };
    const concurrentMutate = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
      return { ok: true };
    });
    await expect(
      Promise.all([
        executeFinanceIdempotently(database.db, userContext, runningOperation, concurrentMutate),
        executeFinanceIdempotently(database.db, userContext, runningOperation, concurrentMutate),
      ]),
    ).resolves.toEqual([{ ok: true }, { ok: true }]);
    expect(concurrentMutate).toHaveBeenCalledOnce();
  });

  it("rolls back mutation work and reclaims an expired started record", async () => {
    const userContext = await loadFinanceAuthorization({
      db: database.db,
      principal: {
        actorId: userId,
        actorType: "user",
        scopes: new Set(["finances:write"]),
        userId,
      },
      requestId: "transactional-idempotency",
    });
    const rollbackOperation = {
      idempotencyKey: "rollback-operation",
      operation: "finance.rollback",
      payload: { test: true },
    };
    await expect(
      executeFinanceIdempotently(database.db, userContext, rollbackOperation, async (tx) => {
        await tx
          .update(financeAgentSettings)
          .set({ reviewBypassEnabled: false })
          .where(eq(financeAgentSettings.userId, userId));
        throw new Error("rollback fixture");
      }),
    ).rejects.toThrow("rollback fixture");
    await expect(
      database.db.query.financeAgentSettings.findFirst({
        where: eq(financeAgentSettings.userId, userId),
      }),
    ).resolves.toMatchObject({ reviewBypassEnabled: true });

    await database.db.execute(sql`
      insert into finance_mutation_records
        (user_id, idempotency_key, operation, request_hash, actor_type, actor_id, status, lease_expires_at)
      values
        (${userId}, 'expired-operation', 'finance.expired',
         'sha256:b4765fb84de668511c997d65df15a1ad68aa92b593cdaef898392c7337eb680a',
         'user', ${userId}, 'started', ${new Date("2026-08-23T19:00:00Z")})
    `);
    await expect(
      executeFinanceIdempotently(
        database.db,
        userContext,
        {
          idempotencyKey: "expired-operation",
          operation: "finance.expired",
          payload: { test: true },
        },
        async () => ({ reclaimed: true }),
      ),
    ).resolves.toEqual({ reclaimed: true });

    await database.db.execute(sql`
      insert into finance_mutation_records
        (user_id, idempotency_key, operation, request_hash, actor_type, actor_id, status, lease_expires_at)
      values
        (${userId}, 'expired-failure', 'finance.expired',
         'sha256:b4765fb84de668511c997d65df15a1ad68aa92b593cdaef898392c7337eb680a',
         'user', ${userId}, 'started', ${new Date("2026-08-23T19:00:00Z")})
    `);
    await expect(
      executeFinanceIdempotently(
        database.db,
        userContext,
        {
          idempotencyKey: "expired-failure",
          operation: "finance.expired",
          payload: { test: true },
        },
        async () => {
          throw new Error("reclaimed failure");
        },
      ),
    ).rejects.toThrow("reclaimed failure");

    for (const [idempotencyKey, leaseExpiresAt] of [
      ["active-explicit-lease", new Date("2999-08-23T19:00:00Z")],
      ["active-legacy-lease", null],
    ] as const) {
      await database.db.execute(sql`
        insert into finance_mutation_records
          (user_id, idempotency_key, operation, request_hash, actor_type, actor_id, status, lease_expires_at)
        values
          (${userId}, ${idempotencyKey}, 'finance.expired',
           'sha256:b4765fb84de668511c997d65df15a1ad68aa92b593cdaef898392c7337eb680a',
           'user', ${userId}, 'started', ${leaseExpiresAt})
      `);
      await expect(
        executeFinanceIdempotently(
          database.db,
          userContext,
          {
            idempotencyKey,
            operation: "finance.expired",
            payload: { test: true },
          },
          async () => ({ unexpected: true }),
        ),
      ).rejects.toThrow("already in progress");
    }
  });
});
