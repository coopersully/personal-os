import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import {
  createDatabaseClient,
  type DatabaseClient,
  financeAccounts,
  financeConversationBatches,
  financeConversationBatchMessages,
  financeConversationMessages,
  financeConversationReadCursors,
  financeReviewCases,
  financeTransactions,
  migrateDatabase,
  users,
  workspaceMaintenanceRuns,
} from "@personal-os/database";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { eq } from "drizzle-orm";
import { createFinanceConversationUnreadService } from "./conversation-unread-service.js";

/** Authored only: execution requires Lead's exclusive PostgreSQL slot. */
describe.sequential("human conversation unread snapshot", () => {
  let database: DatabaseClient;
  let container: StartedPostgreSqlContainer;
  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:17.5-alpine").start();
    database = createDatabaseClient(container.getConnectionUri());
    await migrateDatabase(database.db, resolve(process.cwd(), "packages/database/migrations"));
  }, 120_000);
  afterAll(async () => {
    try {
      await database?.close();
    } finally {
      await container?.stop();
    }
  });
  it("isolates owners, defaults missing cursors, ignores ACKs and preserves unread history after case deletion", async () => {
    const owner = randomUUID(),
      foreign = randomUUID();
    await database.db.insert(users).values(
      [owner, foreign].map((id) => ({
        id,
        email: `${id}@example.com`,
        displayName: "Unread",
        passwordHash: "unused",
      })),
    );
    const unread = createFinanceConversationUnreadService({ db: database.db });
    expect(await unread.readUnread(owner)).toEqual({
      unreadCount: "0",
      readThroughSequence: "0",
      latestAgentSequence: "0",
    });
    const [account] = await database.db
      .insert(financeAccounts)
      .values({ userId: owner, provider: "manual", institution: "Manual", name: "Cash" })
      .returning();
    if (!account) throw new Error("account");
    const [transaction] = await database.db
      .insert(financeTransactions)
      .values({
        userId: owner,
        accountId: account.id,
        merchant: "Example",
        amount: 1200,
        direction: "expense",
        transactionDate: "2026-10-18",
      })
      .returning();
    if (!transaction) throw new Error("transaction");
    const [review] = await database.db
      .insert(financeReviewCases)
      .values({ userId: owner, transactionId: transaction.id })
      .returning();
    if (!review) throw new Error("review");
    const high = 9007199254740994n;
    const [userMessage] = await database.db
      .insert(financeConversationMessages)
      .values({
        userId: owner,
        sequence: high + 1n,
        authorKind: "user",
        text: "Owner note",
        idempotencyKey: randomUUID(),
        createdAt: new Date(),
      })
      .returning();
    if (!userMessage) throw new Error("message");
    await database.db.insert(financeConversationMessages).values([
      {
        userId: owner,
        sequence: 2n,
        authorKind: "agent",
        text: "Earlier agent reply",
        idempotencyKey: randomUUID(),
        createdAt: new Date(),
      },
      {
        userId: owner,
        sequence: high,
        authorKind: "agent",
        text: "Retained question",
        idempotencyKey: randomUUID(),
        createdAt: new Date(),
        caseId: review.id,
        caseOwnerId: owner,
        recordRefs: [{ kind: "review_case", id: review.id }],
      },
      {
        userId: foreign,
        sequence: high + 2n,
        authorKind: "agent",
        text: "Foreign history",
        idempotencyKey: randomUUID(),
        createdAt: new Date(),
      },
    ]);
    expect(await unread.readUnread(owner)).toEqual({
      unreadCount: "2",
      readThroughSequence: "0",
      latestAgentSequence: high.toString(),
    });
    await database.db
      .insert(financeConversationReadCursors)
      .values({ userId: owner, readThroughSequence: 2n, updatedAt: new Date() });
    const expected = {
      unreadCount: "1",
      readThroughSequence: "2",
      latestAgentSequence: high.toString(),
    };
    expect(await unread.readUnread(owner)).toEqual(expected);
    const [run] = await database.db
      .insert(workspaceMaintenanceRuns)
      .values({
        userId: owner,
        domain: "finances",
        scope: { type: "all_outstanding" },
        rulebookVersion: "unread-test",
      })
      .returning();
    if (!run) throw new Error("run");
    await database.db.insert(financeConversationBatches).values({
      userId: owner,
      runId: run.id,
      cursorKey: randomUUID(),
      cutoffSequence: high + 1n,
      capturedAt: new Date(),
    });
    const at = new Date();
    await database.db.insert(financeConversationBatchMessages).values({
      userId: owner,
      runId: run.id,
      messageId: userMessage.id,
      deliveredAt: at,
      acknowledgedAt: at,
    });
    expect(await unread.readUnread(owner)).toEqual(expected);
    await database.db.delete(financeReviewCases).where(eq(financeReviewCases.id, review.id));
    expect(await unread.readUnread(owner)).toEqual(expected);
    await database.db
      .update(financeConversationReadCursors)
      .set({ readThroughSequence: high, updatedAt: new Date() })
      .where(eq(financeConversationReadCursors.userId, owner));
    expect(await unread.readUnread(owner)).toEqual({
      unreadCount: "0",
      readThroughSequence: high.toString(),
      latestAgentSequence: high.toString(),
    });
    expect(await unread.readUnread(foreign)).toEqual({
      unreadCount: "1",
      readThroughSequence: "0",
      latestAgentSequence: (high + 2n).toString(),
    });
  });
});
