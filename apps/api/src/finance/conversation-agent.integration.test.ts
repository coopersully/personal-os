import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import {
  accessTokens,
  auditEvents,
  createDatabaseClient,
  financeAccounts,
  financeConversationMessages,
  financeTransactions,
  migrateDatabase,
  nativePushEvents,
  users,
} from "@personal-os/database";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { eq } from "drizzle-orm";
import type { Principal } from "../types.js";
import { createFinanceAttentionService } from "./attention-service.js";
import { createFinanceConversationService } from "./conversation-persistence.js";

describe.sequential("authorized Finance agent cards", () => {
  let container: StartedPostgreSqlContainer;
  let database: ReturnType<typeof createDatabaseClient>;
  const now = () => new Date("2026-11-12T17:00:00Z");
  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:17.5-alpine").start();
    database = createDatabaseClient(container.getConnectionUri());
    await migrateDatabase(database.db, resolve("packages/database/migrations"));
  }, 120000);
  afterAll(async () => {
    await database?.close();
    await container?.stop();
  });
  async function fixture() {
    const userId = randomUUID(),
      actorId = randomUUID(),
      authorizationConnectionId = randomUUID();
    await database.db.insert(users).values({
      id: userId,
      displayName: "Synthetic owner",
      email: `${userId}@example.com`,
      passwordHash: "unused",
    });
    await database.db.insert(accessTokens).values({
      id: actorId,
      userId,
      authorizationConnectionId,
      name: "Synthetic assistant",
      tokenHash: randomUUID(),
      scopes: ["finances:read", "finances:write", "finances:maintain"],
    });
    const [account] = await database.db
      .insert(financeAccounts)
      .values({ userId, provider: "manual", institution: "Synthetic Bank", name: "Checking" })
      .returning();
    if (!account) throw new Error("fixture");
    const [transaction] = await database.db
      .insert(financeTransactions)
      .values({
        userId,
        accountId: account.id,
        merchant: "Synthetic Market",
        amount: 2500,
        direction: "expense",
        transactionDate: "2026-11-11",
        needsReview: true,
      })
      .returning();
    if (!transaction) throw new Error("fixture");
    const principal: Principal = {
      userId,
      actorId,
      authorizationConnectionId,
      actorType: "agent",
      scopes: new Set(["finances:read", "finances:write", "finances:maintain"]),
    };
    const context = { principal, requestId: randomUUID() };
    const input = {
      text: "This $25 purchase needs a category. Review it here.",
      idempotencyKey: "review",
      recordRefs: [{ kind: "transaction" as const, id: transaction.id }],
    };
    return { context, input, transaction };
  }
  const service = () => createFinanceConversationService({ db: database.db, now });
  it("publishes one attributed card and push without financial execution, host mutation or human impersonation", async () => {
    const f = await fixture();
    const first = await service().publishAgentCard(f.context, f.input);
    expect(first).toMatchObject({
      authorKind: "agent",
      runId: null,
      sourceMessageIds: [],
      text: f.input.text,
    });
    expect(await service().publishAgentCard(f.context, f.input)).toEqual(first);
    expect(
      (await service().getAgentHistory(f.context, { limit: 10 })).messages.map((m) => m.id),
    ).toEqual([first.id]);
    expect(
      await database.db
        .select()
        .from(nativePushEvents)
        .where(eq(nativePushEvents.userId, f.context.principal.userId)),
    ).toHaveLength(1);
    expect(
      await database.db.select().from(auditEvents).where(eq(auditEvents.entityId, first.id)),
    ).toEqual([
      expect.objectContaining({
        actorType: "agent",
        actorId: f.context.principal.actorId,
        action: "finance_conversation_card.published",
      }),
    ]);
    expect(
      (
        await database.db.query.financeTransactions.findFirst({
          where: eq(financeTransactions.id, f.transaction.id),
        })
      )?.needsReview,
    ).toBe(true);
    await expect(
      service().publishAgentCard(f.context, { ...f.input, text: "Different intent" }),
    ).rejects.toMatchObject({ code: "conflict" });
  });
  it("counts a published starting-policy decision once and accepts the same preview after publishing", async () => {
    const f = await fixture();
    const attention = createFinanceAttentionService({ db: database.db, now });
    const preview = await attention.previewBudgetStart(f.context, {
      firstMonth: "2026-11",
      expectedPolicyRevision: 0,
      idempotencyKey: "start",
    });
    const input = {
      text: "Start budgeting in November and retain older history?",
      idempotencyKey: "start-card",
      recordRefs: [{ kind: "budget_start_preview" as const, id: preview.id }],
    };
    await service().publishAgentCard(f.context, input);
    await service().publishAgentCard(f.context, input);
    expect(await attention.getAttentionSnapshot(f.context.principal.userId)).toMatchObject({
      activeDecisionCount: 1,
    });
    const human = {
      ...f.context,
      principal: {
        ...f.context.principal,
        actorId: f.context.principal.userId,
        actorType: "user" as const,
      },
    };
    await attention.applyBudgetStart(human, {
      previewId: preview.id,
      fingerprint: preview.fingerprint,
    });
    expect(await attention.getAttentionSnapshot(f.context.principal.userId)).toMatchObject({
      activeDecisionCount: 0,
    });
  });
  it("deduplicates concurrent delivery and keeps retries stable across token rotation in the same connection", async () => {
    const f = await fixture();
    const [first, replay] = await Promise.all([
      service().publishAgentCard(f.context, f.input),
      service().publishAgentCard(f.context, f.input),
    ]);
    expect(replay.id).toBe(first.id);
    const replacement = randomUUID();
    await database.db.insert(accessTokens).values({
      id: replacement,
      userId: f.context.principal.userId,
      authorizationConnectionId: f.context.principal.authorizationConnectionId,
      name: "Rotated synthetic assistant",
      tokenHash: randomUUID(),
      scopes: [...f.context.principal.scopes],
    });
    expect(
      (
        await service().publishAgentCard(
          { ...f.context, principal: { ...f.context.principal, actorId: replacement } },
          f.input,
        )
      ).id,
    ).toBe(first.id);
    expect(
      await database.db
        .select()
        .from(nativePushEvents)
        .where(eq(nativePushEvents.userId, f.context.principal.userId)),
    ).toHaveLength(1);
  });
  it("rejects stale permission snapshots and connection substitution, while read access alone cannot publish", async () => {
    const f = await fixture();
    await expect(
      service().publishAgentCard(
        {
          ...f.context,
          principal: { ...f.context.principal, authorizationConnectionId: randomUUID() },
        },
        f.input,
      ),
    ).rejects.toMatchObject({ code: "forbidden" });
    await database.db
      .update(accessTokens)
      .set({ scopes: ["finances:read"] })
      .where(eq(accessTokens.id, f.context.principal.actorId));
    expect((await service().getAgentHistory(f.context, {})).messages).toEqual([]);
    await expect(service().publishAgentCard(f.context, f.input)).rejects.toMatchObject({
      code: "forbidden",
    });
    await expect(
      service().publishAgentCard(f.context, { ...f.input, text: "x".repeat(1201) }),
    ).rejects.toBeDefined();
    await expect(service().getAgentHistory(f.context, { limit: 101 })).rejects.toBeDefined();
  });
  it("rejects foreign references, spoofed authors and revoked grants before writing", async () => {
    const f = await fixture(),
      other = await fixture();
    await expect(service().publishAgentCard(f.context, other.input)).rejects.toMatchObject({
      code: "not_found",
    });
    await expect(
      service().publishAgentCard(f.context, { ...f.input, authorKind: "user" }),
    ).rejects.toBeDefined();
    await database.db
      .update(accessTokens)
      .set({ revokedAt: now() })
      .where(eq(accessTokens.id, f.context.principal.actorId));
    await expect(service().publishAgentCard(f.context, f.input)).rejects.toMatchObject({
      code: "forbidden",
    });
    await expect(service().getAgentHistory(f.context, {})).rejects.toMatchObject({
      code: "forbidden",
    });
    expect(
      await database.db
        .select()
        .from(financeConversationMessages)
        .where(eq(financeConversationMessages.userId, f.context.principal.userId)),
    ).toHaveLength(0);
  });
});
