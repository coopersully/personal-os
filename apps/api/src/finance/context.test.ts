import { resolve } from "node:path";
import {
  createDatabaseClient,
  type Database,
  type DatabaseClient,
  executionPolicySettings,
  financeMutationRecords,
  migrateDatabase,
  users,
} from "@personal-os/database";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { eq, sql } from "drizzle-orm";
import type { Principal } from "../types.js";
import {
  executeFinanceAdmittedMutation,
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
    await database.db.insert(executionPolicySettings).values({ reviewBypassEnabled: true, userId });
  }, 120_000);

  afterAll(async () => {
    await database.close();
    await container.stop();
  });

  it("allows scoped bookkeeping without conferring budget self-approval", async () => {
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
      canSelfApprove: false,
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
      requireUserAdmission: true,
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

  it("admits supplied-transaction work once and replays before preparing again", async () => {
    const principal: Principal = {
      actorId: userId,
      actorType: "user",
      scopes: new Set(["finances:write"]),
      userId,
    };
    const context = await loadFinanceAuthorization({
      db: database.db,
      principal,
      requestId: "admitted-first",
    });
    const operation = {
      idempotencyKey: "admitted-replay",
      operation: "finance.answer-contextual-question.v1",
      payload: { answer: "Groceries", questionId: "question-1" },
      sourceKind: "app" as const,
    };
    const prepare = vi.fn(
      async (executor: Parameters<typeof executeFinanceAdmittedMutation>[0]) => {
        await expect(
          executor.query.financeMutationRecords.findFirst({
            where: eq(financeMutationRecords.idempotencyKey, operation.idempotencyKey),
          }),
        ).resolves.toBeUndefined();
        return {
          prepared: { questionId: "question-1" },
          state: "admitted" as const,
        };
      },
    );
    const mutate = vi.fn(async () => ({
      operationId: operation.idempotencyKey,
      state: "accepted",
    }));

    await expect(
      database.db.transaction((tx) =>
        executeFinanceAdmittedMutation(tx, context, operation, prepare, mutate),
      ),
    ).resolves.toEqual({ operationId: "admitted-replay", state: "accepted" });

    const retryContext = await loadFinanceAuthorization({
      db: database.db,
      principal,
      requestId: "admitted-retry",
    });
    await expect(
      database.db.transaction((tx) =>
        executeFinanceAdmittedMutation(tx, retryContext, operation, prepare, mutate),
      ),
    ).resolves.toEqual({ operationId: "admitted-replay", state: "accepted" });
    expect(prepare).toHaveBeenCalledOnce();
    expect(mutate).toHaveBeenCalledOnce();
    await expect(
      database.db.query.financeMutationRecords.findFirst({
        where: eq(financeMutationRecords.idempotencyKey, operation.idempotencyKey),
      }),
    ).resolves.toMatchObject({
      actorId: userId,
      actorType: "user",
      operation: operation.operation,
      status: "completed",
    });
  });

  it("fails closed for failed or started admitted-mutation receipts", async () => {
    const context = await loadFinanceAuthorization({
      db: database.db,
      principal: {
        actorId: userId,
        actorType: "user",
        scopes: new Set(["finances:write"]),
        userId,
      },
      requestId: "admitted-terminal-receipts",
    });
    const prepare = async () => ({ prepared: {}, state: "admitted" as const });
    const mutate = async () => ({ state: "accepted" });

    for (const status of ["failed", "started"] as const) {
      const idempotencyKey = `admitted-${status}`;
      const operation = {
        idempotencyKey,
        operation: "finance.answer-contextual-question.v1",
        payload: { answer: "Groceries", questionId: idempotencyKey },
        sourceKind: "app" as const,
      };
      await database.db.transaction((tx) =>
        executeFinanceAdmittedMutation(tx, context, operation, prepare, mutate),
      );
      await database.db
        .update(financeMutationRecords)
        .set({
          completedAt: null,
          leaseExpiresAt: new Date("2020-01-01T00:00:00Z"),
          response: null,
          status,
        })
        .where(eq(financeMutationRecords.idempotencyKey, idempotencyKey));

      await expect(
        database.db.transaction((tx) =>
          executeFinanceAdmittedMutation(tx, context, operation, prepare, mutate),
        ),
      ).rejects.toThrow(status === "failed" ? "previously failed" : "already in progress");
    }
  });

  it("leaves no receipt when preparation is unavailable or contended", async () => {
    const context = await loadFinanceAuthorization({
      db: database.db,
      principal: {
        actorId: userId,
        actorType: "user",
        scopes: new Set(["finances:write"]),
        userId,
      },
      requestId: "admitted-without-receipt",
    });
    const mutate = vi.fn(async () => ({ state: "accepted" }));
    const unavailableOperation = {
      idempotencyKey: "admitted-unavailable",
      operation: "finance.answer-contextual-question.v1",
      payload: { questionId: "missing" },
      sourceKind: "app" as const,
    };
    await expect(
      database.db.transaction((tx) =>
        executeFinanceAdmittedMutation(
          tx,
          context,
          unavailableOperation,
          async () => ({
            result: {
              reasonCode: "producer_not_registered",
              retryable: false,
              state: "unavailable",
            },
            state: "unavailable",
          }),
          mutate,
        ),
      ),
    ).resolves.toEqual({
      reasonCode: "producer_not_registered",
      retryable: false,
      state: "unavailable",
    });
    expect(mutate).not.toHaveBeenCalled();
    await expect(
      database.db.query.financeMutationRecords.findFirst({
        where: eq(financeMutationRecords.idempotencyKey, unavailableOperation.idempotencyKey),
      }),
    ).resolves.toBeUndefined();

    const contendedOperation = {
      ...unavailableOperation,
      idempotencyKey: "admitted-contended",
      payload: { questionId: "locked" },
    };
    await expect(
      database.db.transaction((tx) =>
        executeFinanceAdmittedMutation(
          tx,
          context,
          contendedOperation,
          async () => {
            throw Object.assign(new Error("The Finance work is busy."), { code: "conflict" });
          },
          mutate,
        ),
      ),
    ).rejects.toMatchObject({ code: "conflict" });
    await expect(
      database.db.query.financeMutationRecords.findFirst({
        where: eq(financeMutationRecords.idempotencyKey, contendedOperation.idempotencyKey),
      }),
    ).resolves.toBeUndefined();
  });

  it("binds admitted receipt equality to the canonical request and actor", async () => {
    const context = await loadFinanceAuthorization({
      db: database.db,
      principal: {
        actorId: userId,
        actorType: "user",
        scopes: new Set(["finances:write"]),
        userId,
      },
      requestId: "admitted-canonical",
    });
    const operation = {
      idempotencyKey: "admitted-canonical",
      operation: "finance.answer-contextual-question.v1",
      payload: { answer: "Groceries", questionId: "question-canonical" },
      sourceKind: "app" as const,
    };
    const prepare = vi.fn(async () => ({ prepared: {}, state: "admitted" as const }));
    const mutate = vi.fn(async () => ({ state: "accepted" }));
    await database.db.transaction((tx) =>
      executeFinanceAdmittedMutation(tx, context, operation, prepare, mutate),
    );

    const changedActor = { ...context, actorId: "another-user-session" };
    for (const [candidateContext, candidateOperation] of [
      [changedActor, operation],
      [context, { ...operation, payload: { ...operation.payload, answer: "Transit" } }],
      [context, { ...operation, sourceKind: "agent" as const }],
    ] as const) {
      await expect(
        database.db.transaction((tx) =>
          executeFinanceAdmittedMutation(tx, candidateContext, candidateOperation, prepare, mutate),
        ),
      ).rejects.toMatchObject({ code: "invalid_request" });
    }
    await database.db
      .update(financeMutationRecords)
      .set({ actorId: "tampered-actor" })
      .where(eq(financeMutationRecords.idempotencyKey, operation.idempotencyKey));
    await expect(
      database.db.transaction((tx) =>
        executeFinanceAdmittedMutation(tx, context, operation, prepare, mutate),
      ),
    ).rejects.toMatchObject({ code: "invalid_request" });
    expect(prepare).toHaveBeenCalledOnce();
    expect(mutate).toHaveBeenCalledOnce();
  });

  it("rejects unscoped or missing owners before admitted preparation", async () => {
    const prepare = vi.fn(async () => ({ prepared: {}, state: "admitted" as const }));
    const mutate = vi.fn(async () => ({ state: "accepted" }));
    const operation = {
      idempotencyKey: "admitted-owner-check",
      operation: "finance.answer-contextual-question.v1",
      payload: { questionId: "question-owner-check" },
      sourceKind: "app" as const,
    };
    const readOnlyContext = await loadFinanceAuthorization({
      db: database.db,
      principal: {
        actorId: userId,
        actorType: "user",
        scopes: new Set(["finances:read"]),
        userId,
      },
      requestId: "admitted-read-only",
    });
    await expect(
      database.db.transaction((tx) =>
        executeFinanceAdmittedMutation(tx, readOnlyContext, operation, prepare, mutate),
      ),
    ).rejects.toMatchObject({ code: "forbidden" });

    const missingUserId = "00000000-0000-4000-8000-000000000098";
    await expect(
      database.db.transaction((tx) =>
        executeFinanceAdmittedMutation(
          tx,
          {
            ...readOnlyContext,
            actorId: missingUserId,
            canMutate: true,
            userId: missingUserId,
          },
          { ...operation, idempotencyKey: "admitted-missing-owner" },
          prepare,
          mutate,
        ),
      ),
    ).rejects.toMatchObject({ code: "not_found" });
    expect(prepare).not.toHaveBeenCalled();
    expect(mutate).not.toHaveBeenCalled();
  });

  it("rolls back admitted receipts and domain writes on supplied-transaction failure", async () => {
    const context = await loadFinanceAuthorization({
      db: database.db,
      principal: {
        actorId: userId,
        actorType: "user",
        scopes: new Set(["finances:write"]),
        userId,
      },
      requestId: "admitted-rollback",
    });
    const operation = {
      idempotencyKey: "admitted-rollback",
      operation: "finance.answer-contextual-question.v1",
      payload: { answer: "Groceries", questionId: "question-rollback" },
      sourceKind: "app" as const,
    };

    await expect(
      database.db.transaction((tx) =>
        executeFinanceAdmittedMutation(
          tx,
          context,
          operation,
          async () => ({ prepared: {}, state: "admitted" }),
          async (executor) => {
            await executor
              .update(executionPolicySettings)
              .set({ reviewBypassEnabled: false })
              .where(eq(executionPolicySettings.userId, userId));
            throw new Error("admitted mutation failed");
          },
        ),
      ),
    ).rejects.toThrow("admitted mutation failed");
    await expect(
      database.db.query.financeMutationRecords.findFirst({
        where: eq(financeMutationRecords.idempotencyKey, operation.idempotencyKey),
      }),
    ).resolves.toBeUndefined();
    await expect(
      database.db.query.executionPolicySettings.findFirst({
        where: eq(executionPolicySettings.userId, userId),
      }),
    ).resolves.toMatchObject({ reviewBypassEnabled: true });
  });

  it("admits the owner before receipt work without changing the receipt hash", async () => {
    const missingUserId = "00000000-0000-4000-8000-000000000099";
    const missingContext = {
      actorId: missingUserId,
      actorType: "user" as const,
      bypassEnabled: false,
      canMutate: true,
      canSelfApprove: false,
      requestId: "missing-owner",
      userId: missingUserId,
    };
    const mutate = vi.fn(async () => ({ unexpected: true }));
    await expect(
      executeFinanceIdempotently(
        database.db,
        missingContext,
        {
          idempotencyKey: "missing-owner",
          operation: "finance.owner-admission",
          payload: {},
          requireUserAdmission: true,
        },
        mutate,
      ),
    ).rejects.toMatchObject({ code: "not_found" });
    expect(mutate).not.toHaveBeenCalled();

    const ownerContext = await loadFinanceAuthorization({
      db: database.db,
      principal: {
        actorId: userId,
        actorType: "user",
        scopes: new Set(["finances:write"]),
        userId,
      },
      requestId: "owner-admission",
    });
    const operation = {
      idempotencyKey: "admission-hash",
      operation: "finance.owner-admission",
      payload: { stable: true },
      requireUserAdmission: true,
    };
    const admittedMutation = vi.fn(async () => ({ admitted: true }));
    await expect(
      executeFinanceIdempotently(database.db, ownerContext, operation, admittedMutation),
    ).resolves.toEqual({ admitted: true });
    await expect(
      executeFinanceIdempotently(
        database.db,
        ownerContext,
        { ...operation, requireUserAdmission: false },
        admittedMutation,
      ),
    ).resolves.toEqual({ admitted: true });
    expect(admittedMutation).toHaveBeenCalledOnce();
  });

  it("holds shared semantic locks before running an idempotent mutation", async () => {
    const context = await loadFinanceAuthorization({
      db: database.db,
      principal: {
        actorId: userId,
        actorType: "user",
        scopes: new Set(["finances:write"]),
        userId,
      },
      requestId: "ordered-locks",
    });
    const lockIdentity = `finance-budget-buckets:${userId}`;

    await expect(
      executeFinanceIdempotently(
        database.db,
        context,
        {
          idempotencyKey: "ordered-locks",
          lockIdentities: [lockIdentity, lockIdentity],
          operation: "finance.bucket-lock-order",
          payload: {},
        },
        async () => {
          const competing = await database.pool.query<{ acquired: boolean }>(
            "select pg_try_advisory_xact_lock(hashtextextended($1, 0)) as acquired",
            [lockIdentity],
          );
          expect(competing.rows[0]?.acquired).toBe(false);
          return { ordered: true };
        },
      ),
    ).resolves.toEqual({ ordered: true });
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
      requireUserAdmission: true,
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
          .update(executionPolicySettings)
          .set({ reviewBypassEnabled: false })
          .where(eq(executionPolicySettings.userId, userId));
        throw new Error("rollback fixture");
      }),
    ).rejects.toThrow("rollback fixture");
    await expect(
      database.db.query.executionPolicySettings.findFirst({
        where: eq(executionPolicySettings.userId, userId),
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
          requireUserAdmission: true,
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
          requireUserAdmission: true,
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
