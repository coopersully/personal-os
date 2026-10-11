import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import {
  createDatabaseClient,
  type DatabaseClient,
  financeAccounts,
  financeTransactions,
  migrateDatabase,
  users,
} from "@personal-os/database";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { createFinanceContextualQuestionService } from "./finance/contextual-question-service.js";
import { createFinanceNotificationDispatcher } from "./finance-notification-runtime.js";
import type { Principal } from "./types.js";

describe.sequential("bounded automatic Finance discovery", () => {
  let container: StartedPostgreSqlContainer;
  let database: DatabaseClient;
  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:17.5-alpine").start();
    database = createDatabaseClient(container.getConnectionUri());
    await migrateDatabase(database.db, resolve(process.cwd(), "packages/database/migrations"));
  }, 120000);
  afterAll(async () => {
    await database?.close();
    await container?.stop();
  });
  it("honors disable and shutdown, scans bounded pages across owners, and repairs publication failure on rediscovery", async () => {
    const ids: string[] = [];
    const producer = createFinanceContextualQuestionService({ db: database.db });
    for (let owner = 0; owner < 2; owner++) {
      const userId = randomUUID();
      await database.db.insert(users).values({
        id: userId,
        email: `${userId}@example.com`,
        displayName: "Discovery",
        passwordHash: "unused",
      });
      const [account] = await database.db
        .insert(financeAccounts)
        .values({ userId, name: "Cash", institution: "Cash", provider: "manual" })
        .returning();
      if (!account) throw new Error("account");
      const principal: Principal = {
        userId,
        actorId: userId,
        actorType: "user",
        scopes: new Set(["finances:read", "finances:write"]),
      };
      for (let i = 0; i < 16; i++) {
        const [transaction] = await database.db
          .insert(financeTransactions)
          .values({
            userId,
            accountId: account.id,
            merchant: "Lunch",
            transactionDate: "2026-10-09",
            direction: "expense",
            amount: 1200,
          })
          .returning();
        if (!transaction) throw new Error("transaction");
        const question = await producer.createQuestion(
          transaction.id,
          { operationId: randomUUID() },
          { principal, requestId: "discovery" },
        );
        if (question.state !== "available") throw new Error("question");
        ids.push(question.question.work.id);
      }
    }
    let enabled = false;
    const publish = vi.fn(async () => ({}) as never),
      drain = vi.fn(async () => ({}) as never);
    const run = createFinanceNotificationDispatcher({
      db: database.db,
      enabled: () => enabled,
      notifications: { publish, drain },
    });
    expect(await run()).toEqual({ processed: 0, failed: 0 });
    enabled = true;
    expect(await run(() => false)).toEqual({ processed: 0, failed: 0 });
    expect(publish).not.toHaveBeenCalled();
    expect(await run()).toEqual({ processed: 25, failed: 0 });
    expect(await run()).toEqual({ processed: 7, failed: 0 });
    const discovered = publish.mock.calls.flatMap((call) =>
      (call as unknown as [Principal, { work: { id: string }[] }])[1].work.map((item) => item.id),
    );
    expect(new Set(discovered)).toEqual(new Set(ids));
    expect(drain).toHaveBeenCalledTimes(3);
    publish.mockRejectedValueOnce(new Error("publication unavailable"));
    expect((await run()).failed).toBe(1);
    await run();
    await run();
    expect(publish.mock.calls.length).toBeGreaterThan(3);
  });
});
