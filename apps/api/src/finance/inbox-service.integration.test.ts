import { resolve } from "node:path";
import {
  createDatabaseClient,
  type DatabaseClient,
  financeAccounts,
  financeEconomicEvents,
  financeTransactions,
  migrateDatabase,
  users,
} from "@personal-os/database";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import type { Principal } from "../types.js";
import { loadFinanceAuthorization } from "./context.js";
import { createInboxService } from "./inbox-service.js";

describe.sequential("transaction-backed Finance Inbox", () => {
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
      .values({ displayName: "Inbox", email: "inbox@example.com", passwordHash: "unused" })
      .returning();
    if (!user) throw new Error("Fixture user was not created.");
    userId = user.id;
  }, 120_000);

  afterAll(async () => {
    await database.close();
    await container.stop();
  });

  it("deduplicates repeated findings and returns one next question after an answer", async () => {
    const service = createInboxService({
      db: database.db,
      now: () => new Date("2026-08-23T20:00:00Z"),
    });
    const [account] = await database.db
      .insert(financeAccounts)
      .values({ institution: "Bank", name: "Checking", provider: "manual", userId })
      .returning();
    if (!account) throw new Error("Account was not created.");
    const transactions = await database.db
      .insert(financeTransactions)
      .values([
        {
          accountId: account.id,
          amount: 50000,
          direction: "expense",
          merchant: "Large",
          transactionDate: "2026-08-22",
          userId,
        },
        {
          accountId: account.id,
          amount: 1000,
          direction: "expense",
          merchant: "Small",
          transactionDate: "2026-08-21",
          userId,
        },
      ])
      .returning();
    const events = await database.db
      .insert(financeEconomicEvents)
      .values([
        { kind: "purchase", stableKey: "event:large", userId },
        { kind: "purchase", stableKey: "event:small", userId },
      ])
      .returning();
    if (!transactions[0] || !transactions[1] || !events[0] || !events[1])
      throw new Error("Fixtures failed.");

    const first = await service.upsertFinanceReview({
      economicEventId: events[0].id,
      evidence: { merchant: "Large" },
      impactAmount: 500,
      reason: "unusual_amount",
      transactionId: transactions[0].id,
      userId,
    });
    const repeated = await service.upsertFinanceReview({
      economicEventId: events[0].id,
      evidence: { merchant: "Large", repeated: true },
      impactAmount: 500,
      reason: "unusual_amount",
      transactionId: transactions[0].id,
      userId,
    });
    expect(repeated.id).toBe(first.id);
    await service.upsertFinanceReview({
      economicEventId: events[1].id,
      evidence: { merchant: "Small" },
      impactAmount: 10,
      reason: "merchant_identity",
      transactionId: transactions[1].id,
      userId,
    });
    const inbox = await service.getFinanceInbox(userId);
    expect(inbox.communication.nextQuestion?.id).toBe(first.id);
    expect(inbox.remainingWork.count).toBe(2);

    const principal: Principal = {
      actorId: "agent",
      actorType: "agent",
      scopes: new Set(["finances:write"]),
      userId,
    };
    const context = await loadFinanceAuthorization({
      db: database.db,
      principal,
      requestId: "answer",
    });
    const answered = await service.answerFinanceReview(
      first.id,
      {
        answer: "This purchase is legitimate.",
        idempotencyKey: "answer-1",
        resolution: { rationale: "User confirmed it.", type: "dismiss" },
      },
      context,
    );
    expect(answered.communication.nextQuestion?.id).not.toBe(first.id);
    expect(answered.remainingWork.count).toBe(1);
    expect(answered.changes).toHaveLength(1);
  });
});
