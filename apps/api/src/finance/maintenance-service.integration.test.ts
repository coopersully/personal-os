import { resolve } from "node:path";
import {
  createDatabaseClient,
  type DatabaseClient,
  financeAccounts,
  financeCategories,
  financeTransactions,
  migrateDatabase,
  users,
} from "@personal-os/database";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import type { Principal } from "../types.js";
import { loadFinanceAuthorization } from "./context.js";
import { createInboxService } from "./inbox-service.js";
import { createMaintenanceService } from "./maintenance-service.js";

describe.sequential("caller-driven Finance maintenance", () => {
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
      })
      .returning();
    if (!user) throw new Error("Fixture user was not created.");
    userId = user.id;
  }, 120_000);

  afterAll(async () => {
    await database.close();
    await container.stop();
  });

  it("advances synchronously through reasoning and audit to settlement", async () => {
    const now = () => new Date("2026-08-23T20:00:00Z");
    const inbox = createInboxService({ db: database.db, now });
    const service = createMaintenanceService({ db: database.db, inbox, now });
    const [account] = await database.db
      .insert(financeAccounts)
      .values({ institution: "Bank", name: "Checking", provider: "manual", userId })
      .returning();
    const [category] = await database.db
      .insert(financeCategories)
      .values({ group: "Food", name: "Groceries", slug: "groceries", userId })
      .returning();
    if (!account || !category) throw new Error("Fixtures failed.");
    await database.db.insert(financeTransactions).values({
      accountId: account.id,
      amount: 4200,
      direction: "expense",
      merchant: "Local market",
      transactionDate: "2026-08-22",
      userId,
    });
    const principal: Principal = {
      actorId: "agent",
      actorType: "agent",
      scopes: new Set(["finances:write"]),
      userId,
    };
    const context = await loadFinanceAuthorization({
      db: database.db,
      principal,
      requestId: "maintenance",
    });

    const started = await service.maintainFinances(
      { operation: "start", scope: { type: "all_outstanding" } },
      context,
    );
    expect(started.data.stage).toBe("agent_reasoning");
    expect(started.data.reasoningBatch).toHaveLength(1);
    expect(started.nextAction?.tool).toBe("maintain_finances");

    const item = started.data.reasoningBatch[0];
    if (!item) throw new Error("Reasoning item missing.");
    const reasoned = await service.maintainFinances(
      {
        expectedVersion: started.data.version,
        idempotencyKey: "judgments-1",
        judgments: [
          {
            categoryId: category.id,
            confidence: 0.99,
            meaning: "Routine grocery purchase",
            rationale: "Merchant and amount fit groceries.",
            transactionId: item.transactionId,
            type: "classify_transaction",
          },
        ],
        operation: "submit_judgments",
        runId: started.data.runId,
      },
      context,
    );
    expect(reasoned.data.stage).toBe("agent_audit");

    const settled = await service.maintainFinances(
      {
        expectedVersion: reasoned.data.version,
        findings: [],
        idempotencyKey: "audit-1",
        operation: "submit_audit",
        runId: reasoned.data.runId,
      },
      context,
    );
    expect(settled).toMatchObject({ data: { stage: "settled" }, outcome: "completed" });
  });
});
