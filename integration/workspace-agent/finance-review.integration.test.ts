import {
  auditEvents,
  financeAccounts,
  financeClassificationDecisions,
  financeMerchants,
  financeReviewCases,
  financeTransactions,
} from "@personal-os/database";
import { eq, sql } from "drizzle-orm";
import { createMcpWorkspaceFixture, type WorkspaceFixture } from "./fixture.js";

describe("Finance deliberate review execution", () => {
  let f: WorkspaceFixture;
  beforeAll(async () => {
    f = await createMcpWorkspaceFixture();
  }, 120_000);
  afterAll(async () => {
    await f?.close();
  });
  it("queues, approves and dismisses exact ledger proposals through MCP", async () => {
    await f.setBypass(true);
    const { client, api, credential } = await f.connectAgent([
      "finances:read",
      "finances:write",
      "finances:execute",
    ]);
    const account = await api.createFinanceAccount({
      name: "Queued cash",
      institution: "Fixture",
      provider: "manual",
      balance: 100,
    });
    const call = async (name: string, args: Record<string, unknown>) => {
      const response = await client.callTool({ name, arguments: args });
      expect(response.isError, JSON.stringify(response)).not.toBe(true);
      return response.structuredContent;
    };
    await f.setBypass(false);
    await call("add_finance_transaction", {
      accountId: account.id,
      amount: 12,
      date: "2026-10-11",
      direction: "expense",
      merchant: "Approval fixture",
    });
    const queued = await api.listFinanceActionReviews();
    expect(queued).toHaveLength(1);
    const reviewId = queued[0]!.id;
    expect(
      (await client.callTool({ name: "approve_finance_action_review", arguments: { reviewId } }))
        .isError,
    ).toBe(true);
    await f.setBypass(true);
    await call("approve_finance_action_review", { reviewId });
    const transactions = await f.db
      .select()
      .from(financeTransactions)
      .where(eq(financeTransactions.accountId, account.id));
    expect(transactions).toHaveLength(1);
    expect(transactions[0]).toMatchObject({ merchant: "Approval fixture", amount: 1200 });
    await call("get_finance_transaction", { transactionId: transactions[0]!.id });
    expect(
      await call("create_finance_attention_item", {
        transactionId: transactions[0]!.id,
        title: "Fixture purchase",
        summary: "Check the persisted ledger evidence",
      }),
    ).toMatchObject({ result: { relatedEntityId: transactions[0]!.id } });
    await f.setBypass(false);
    await call("add_finance_transaction", {
      accountId: account.id,
      amount: 14,
      date: "2026-10-11",
      direction: "expense",
      merchant: "Dismissal fixture",
    });
    const pending = (await api.listFinanceActionReviews()).find(
      (item) => item.status === "pending",
    );
    expect(pending).toBeDefined();
    await f.setBypass(true);
    await call("dismiss_finance_action_review", { reviewId: pending!.id });
    await call("dismiss_finance_action_review", { reviewId: pending!.id });
    const decisionAudit = await f.db.query.auditEvents.findMany({
      where: eq(auditEvents.entityId, pending!.id),
    });
    expect(
      decisionAudit.filter((event) => event.action === "finance.action_review_dismissed"),
    ).toEqual([expect.objectContaining({ actorType: "agent", actorId: credential.id })]);
    expect(
      await f.db
        .select()
        .from(financeTransactions)
        .where(eq(financeTransactions.accountId, account.id)),
    ).toHaveLength(1);
  });
  it("retains an ambiguous transfer when scoped execution supplies only asserted confidence", async () => {
    await f.setBypass(true);
    const { client, api } = await f.connectAgent([
      "finances:read",
      "finances:write",
      "finances:execute",
    ]);
    const account = await api.createFinanceAccount({
      name: "Review cash",
      institution: "Fixture",
      provider: "manual",
      balance: 100,
    });
    const category = await api.createFinanceCategory({ name: "Transfers" });
    const [transaction] = await f.db
      .insert(financeTransactions)
      .values({
        userId: f.owner.id,
        accountId: account.id,
        merchant: "Transfer to savings",
        amount: 1000,
        direction: "expense",
        transactionDate: "2026-10-11",
        reconciliationStatus: "candidate",
      })
      .returning();
    if (!transaction) throw Error("Missing fixture");
    const [review] = await f.db
      .insert(financeReviewCases)
      .values({
        userId: f.owner.id,
        transactionId: transaction.id,
        reason: "possible_transfer",
        rationale: "Matching owned bank evidence",
        suggestedCategoryId: category.id,
      })
      .returning();
    if (!review) throw Error("Missing fixture");
    const args = {
      reviewId: review.id,
      action: "confirm_transfer",
      expectedTransactionUpdatedAt: transaction.updatedAt.toISOString(),
      confidence: 1,
      rationale: "The matching owned savings statement identifies this exact transfer.",
      learnMerchant: "never",
    };
    await f.setBypass(false);
    expect(
      (await client.callTool({ name: "resolve_finance_transaction_review", arguments: args }))
        .isError,
    ).toBe(true);
    await f.setBypass(true);
    const result = await client.callTool({
      name: "resolve_finance_transaction_review",
      arguments: args,
    });
    expect(result.isError, JSON.stringify(result)).toBe(true);
    expect(
      await f.db.query.financeTransactions.findFirst({
        where: eq(financeTransactions.id, transaction.id),
      }),
    ).toMatchObject({ direction: "expense", reconciliationStatus: "candidate", categoryId: null });
    expect(
      await f.db.query.financeReviewCases.findFirst({
        where: eq(financeReviewCases.id, review.id),
      }),
    ).toMatchObject({ status: "open" });
    expect(
      await f.db.query.auditEvents.findMany({ where: eq(auditEvents.entityId, transaction.id) }),
    ).toEqual([]);
  });
  it("applies only the current server-evidenced category under execution authority", async () => {
    await f.setBypass(true);
    const { client, api, credential } = await f.connectAgent([
      "finances:read",
      "finances:write",
      "finances:execute",
    ]);
    const account = await api.createFinanceAccount({
      name: "Evidence cash",
      institution: "Fixture",
      provider: "manual",
      balance: 100,
    });
    const category = await api.createFinanceCategory({ name: "Evidence category" });
    const [merchant] = await f.db
      .insert(financeMerchants)
      .values({
        userId: f.owner.id,
        displayName: "Narrow supplier",
        normalizedName: "narrow supplier",
      })
      .returning();
    const rows = await f.db
      .insert(financeTransactions)
      .values(
        [1, 2, 3].map((amount) => ({
          userId: f.owner.id,
          accountId: account.id,
          merchantId: merchant!.id,
          merchant: "Narrow supplier",
          amount: amount * 100,
          direction: "expense" as const,
          transactionDate: "2026-10-11",
        })),
      )
      .returning();
    await f.db.insert(financeClassificationDecisions).values(
      rows.slice(0, 2).map((row) => ({
        userId: f.owner.id,
        transactionId: row.id,
        merchantId: merchant!.id,
        categoryId: category.id,
        categoryName: category.name,
        source: "user" as const,
        confidence: 10000,
        outcome: "confirmed" as const,
      })),
    );
    const [review] = await f.db
      .insert(financeReviewCases)
      .values({
        userId: f.owner.id,
        transactionId: rows[2]!.id,
        reason: "low_confidence",
        suggestedCategoryId: category.id,
        rationale: "Inspect durable confirmations",
      })
      .returning();
    const proposalResponse = await client.callTool({
      name: "propose_finance_categorizations",
      arguments: { limit: 50, review: "needs_review" },
    });
    expect(proposalResponse.isError, JSON.stringify(proposalResponse)).not.toBe(true);
    const proposal = (
      proposalResponse.structuredContent as {
        result: {
          items: Array<{
            transaction: { id: string; updatedAt: string };
            confidence: number;
            meetsPolicyThreshold: boolean;
          }>;
        };
      }
    ).result.items.find((item) => item.transaction.id === rows[2]!.id)!;
    expect(proposal.meetsPolicyThreshold).toBe(true);
    const args = {
      reviewId: review!.id,
      action: "recategorize",
      categoryId: category.id,
      confidence: proposal.confidence,
      expectedTransactionUpdatedAt: proposal.transaction.updatedAt,
      learnMerchant: "never",
      rationale: "Two persisted owner confirmations",
    };
    expect(
      (
        await client.callTool({
          name: "resolve_finance_transaction_review",
          arguments: { ...args, confidence: 1 },
        })
      ).isError,
    ).toBe(true);
    const result = await client.callTool({
      name: "resolve_finance_transaction_review",
      arguments: args,
    });
    expect(result.isError, JSON.stringify(result)).not.toBe(true);
    expect(result.structuredContent).toMatchObject({ result: { applied: true } });
    expect(
      await f.db.query.financeTransactions.findFirst({
        where: eq(financeTransactions.id, rows[2]!.id),
      }),
    ).toMatchObject({ categoryId: category.id, categorySource: "agent" });
    expect(
      await f.db.query.auditEvents.findMany({ where: eq(auditEvents.entityId, rows[2]!.id) }),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          actorType: "agent",
          actorId: credential.id,
          action: "finance.transaction_categorized",
        }),
      ]),
    );
    const history = await client.callTool({
      name: "get_finance_review_history_item",
      arguments: { reviewId: review!.id },
    });
    expect(history.isError, JSON.stringify(history)).not.toBe(true);
    expect(
      (await client.callTool({ name: "resolve_finance_transaction_review", arguments: args }))
        .isError,
    ).toBe(true);
  });
  it("creates a contextual question through MCP with agent provenance", async () => {
    await f.setBypass(true);
    const { client, api, credential } = await f.connectAgent([
      "finances:read",
      "finances:write",
      "finances:execute",
    ]);
    const account = await api.createFinanceAccount({
      name: "Context cash",
      institution: "Fixture",
      provider: "manual",
      balance: 100,
    });
    const [transaction] = await f.db
      .insert(financeTransactions)
      .values({
        userId: f.owner.id,
        accountId: account.id,
        merchant: "Unknown purpose",
        amount: 1200,
        direction: "expense",
        transactionDate: "2026-10-11",
      })
      .returning();
    const response = await client.callTool({
      name: "create_finance_contextual_question",
      arguments: { transactionId: transaction!.id, operationId: crypto.randomUUID() },
    });
    expect(response.isError, JSON.stringify(response)).not.toBe(true);
    const value = (
      response.structuredContent as {
        result: { state: string; question: { id: string; work: unknown } };
      }
    ).result;
    expect(value.state).toBe("available");
    expect(
      await f.db.query.auditEvents.findMany({ where: eq(auditEvents.entityId, value.question.id) }),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          actorType: "agent",
          actorId: credential.id,
          action: "finance.contextual_question.created",
        }),
      ]),
    );

    const loaded = await client.callTool({
      name: "get_finance_contextual_question",
      arguments: { questionId: value.question.id },
    });
    expect(loaded.isError, JSON.stringify(loaded)).not.toBe(true);
    const answered = await client.callTool({
      name: "answer_finance_contextual_question",
      arguments: {
        operationId: crypto.randomUUID(),
        work: value.question.work,
        text: "Fixture statement identifies a lunch purchase",
        source: { kind: "agent", messageId: null },
      },
    });
    expect(answered.isError, JSON.stringify(answered)).not.toBe(true);
    expect(answered.structuredContent).toMatchObject({ result: { state: "accepted" } });
  });
  it.each([
    "delete",
    "disconnect",
  ])("rechecks execution after queued account %s acquires its admission locks", async (operation) => {
    await f.setBypass(true);
    const agent = await f.connectAgent(["finances:read", "finances:write", "finances:execute"]);
    const account = await agent.api.createFinanceAccount({
      name: "Lock fixture",
      institution: "Fixture",
      provider: "manual",
      balance: 0,
    });
    let release!: () => void;
    let ready!: () => void;
    const held = new Promise<void>((r) => {
      release = r;
    });
    const acquired = new Promise<void>((r) => {
      ready = r;
    });
    const lock = f.db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`finance-provider-topology:${f.owner.id}`},0))`,
      );
      ready();
      await held;
    });
    await acquired;
    const deletion = agent.client.callTool({
      name: `${operation}_finance_account`,
      arguments: {
        accountId: account.id,
        ...(operation === "disconnect" ? { idempotencyKey: crypto.randomUUID() } : {}),
      },
    });
    try {
      let waiting = false;
      for (let attempt = 0; attempt < 100; attempt++) {
        const rows = await f.db.execute(
          sql`select pid from pg_stat_activity where wait_event_type='Lock' and query like '%pg_advisory_xact_lock%' and pid <> pg_backend_pid()`,
        );
        if (rows.rows.length) {
          waiting = true;
          break;
        }
        await new Promise((r) => setTimeout(r, 20));
      }
      expect(waiting).toBe(true);
      await agent.revoke();
    } finally {
      release();
      await lock;
    }
    expect((await deletion).isError).toBe(true);
    expect(
      await f.db.query.financeAccounts.findFirst({ where: eq(financeAccounts.id, account.id) }),
    ).toBeDefined();
  });
});
