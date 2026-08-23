import { resolve } from "node:path";
import {
  createDatabaseClient,
  type DatabaseClient,
  financeAgentSettings,
  migrateDatabase,
  users,
} from "@personal-os/database";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
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
  });

  it("rejects missing scope and distinguishes in-progress from failed retries", async () => {
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

    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const runningOperation = {
      idempotencyKey: "running-operation",
      operation: "finance.running",
      payload: { test: true },
    };
    const running = executeFinanceIdempotently(
      database.db,
      userContext,
      runningOperation,
      async () => {
        await gate;
        return { ok: true };
      },
    );
    await vi.waitFor(async () => {
      await expect(
        executeFinanceIdempotently(database.db, userContext, runningOperation, async () => ({
          ok: false,
        })),
      ).rejects.toThrow("already in progress");
    });
    release?.();
    await expect(running).resolves.toEqual({ ok: true });
  });
});
