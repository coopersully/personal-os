import {
  financeReimbursements,
  financeReviewCases,
  financeTransactions,
} from "@personal-os/database";
import { eq } from "drizzle-orm";
import { createMcpWorkspaceFixture, type WorkspaceFixture } from "./fixture.js";

describe("Finance ledger and goal workflows through MCP", () => {
  let f: WorkspaceFixture;
  beforeAll(async () => {
    f = await createMcpWorkspaceFixture();
  }, 120_000);
  afterAll(async () => {
    await f?.close();
  });
  it("resolves a review, records a mixed allocation, and creates then cancels its reimbursement", async () => {
    await f.setBypass(true);
    const { client, api } = await f.connectAgent([
      "finances:read",
      "finances:write",
      "finances:execute",
    ]);
    const account = await api.createFinanceAccount({
      name: "Allocation fixture",
      institution: "Manual",
      provider: "manual",
      balance: 100,
    });
    const category = await api.createFinanceCategory({ name: "Mixed fixture food" });
    const [row] = await f.db
      .insert(financeTransactions)
      .values({
        userId: f.owner.id,
        accountId: account.id,
        amount: 2000,
        direction: "expense",
        merchant: "Fixture shared meal",
        transactionDate: "2026-10-11",
      })
      .returning();
    const [review] = await f.db
      .insert(financeReviewCases)
      .values({
        userId: f.owner.id,
        transactionId: row!.id,
        reason: "unknown_merchant",
        rationale: "Explain the fixture receipt",
      })
      .returning();
    async function call(name: string, args: Record<string, unknown>) {
      const response = await client.callTool({ name, arguments: args });
      expect(response.isError, JSON.stringify(response)).not.toBe(true);
      const content = response.structuredContent as {
        data?: Record<string, unknown>;
        result?: Record<string, unknown>;
      };
      return (content.data ?? content.result)!;
    }
    await call("answer_finance_review", {
      reviewId: review!.id,
      answer: "The fixture receipt describes a meal",
      resolution: {
        type: "classify_transaction",
        categoryId: category.id,
        meaning: "Meal expense",
      },
      idempotencyKey: crypto.randomUUID(),
    });
    expect(
      await f.db.query.financeReviewCases.findFirst({
        where: eq(financeReviewCases.id, review!.id),
      }),
    ).toMatchObject({ status: "resolved" });
    const current = await call("get_finance_transaction", { transactionId: row!.id });
    await call("set_finance_transaction_breakdown", {
      id: row!.id,
      expectedTransactionUpdatedAt: current.updatedAt,
      rationale: "The receipt identifies personal and reimbursable portions",
      allocations: [
        { amount: 8, categoryId: category.id, rationale: "Personal meal", treatment: "personal" },
        {
          amount: 12,
          categoryId: category.id,
          rationale: "Agreed repayment",
          treatment: "reimbursable",
        },
      ],
    });
    const listing = await call("list_finance_transactions", { accountId: account.id });
    const transaction = (
      listing.items as Array<{
        id: string;
        updatedAt: string;
        allocations: Array<{ id: string; treatment: string }>;
      }>
    )[0]!;
    const allocation = transaction.allocations.find((item) => item.treatment === "reimbursable")!;
    const evidence = {
      sourceRefs: [
        {
          accountId: account.id,
          provider: "local",
          remoteId: row!.id,
          revision: transaction.updatedAt,
          sourceType: "finance_transaction",
        },
      ],
      summary: "Fixture agreement to reimburse the meal portion",
    };
    await call("reconcile_finance_reimbursement", {
      operation: "create",
      allocationId: allocation.id,
      expectedAmount: 12,
      payer: "Fixture payer",
      dueDate: "2026-10-20",
      evidence,
      rationale: "The fixture payer agreed to reimburse this amount",
    });
    const listed = await call("list_finance_reimbursements", {});
    const reimbursement = (
      listed.reimbursements as Array<{ id: string; allocationId: string; revision: number }>
    ).find((item) => item.allocationId === allocation.id)!;
    await call("reconcile_finance_reimbursement", {
      operation: "cancel",
      reimbursementId: reimbursement.id,
      expectedRevision: reimbursement.revision,
      evidence,
      rationale: "The fixture reimbursement was waived",
    });
    expect(
      await f.db.query.financeReimbursements.findFirst({
        where: eq(financeReimbursements.id, reimbursement.id),
      }),
    ).toMatchObject({ status: "cancelled" });
  });
  it("imports CSV idempotently, corrects merchant identities and links ledger duplicates", async () => {
    await f.setBypass(true);
    const { client, api } = await f.connectAgent([
      "finances:read",
      "finances:write",
      "finances:execute",
    ]);
    const account = await api.createFinanceAccount({
      name: "CSV fixture",
      institution: "PayPal",
      provider: "paypal",
      balance: 0,
    });
    async function call(name: string, args: Record<string, unknown>) {
      const response = await client.callTool({ name, arguments: args });
      expect(response.isError, JSON.stringify(response)).not.toBe(true);
      return response.structuredContent as { data: Record<string, unknown> };
    }
    const input = {
      accountId: account.id,
      provider: "paypal",
      csv: "Date,Name,Amount,Transaction ID\n10/10/2026,Merchant Alpha,4.25,fixture-import-1\n10/10/2026,Merchant Beta,4.25,fixture-import-2",
      idempotencyKey: crypto.randomUUID(),
    };
    expect(await call("import_finance_transactions", input)).toMatchObject({
      data: { imported: 2, skipped: 0 },
    });
    await call("import_finance_transactions", input);
    const rows = await f.db
      .select()
      .from(financeTransactions)
      .where(eq(financeTransactions.accountId, account.id));
    expect(rows).toHaveLength(2);
    const receipt = await call("review_finance_receipt", { id: rows[0]!.id, searchMail: false });
    expect(JSON.stringify(receipt)).toContain("not_requested");
    const category = await api.createFinanceCategory({ name: "Imported fixture category" });
    const proposed = await call("apply_finance_categorizations", {
      decisions: [
        {
          transactionId: rows[0]!.id,
          categoryId: category.id,
          confidence: 1,
          expectedTransactionUpdatedAt: rows[0]!.updatedAt.toISOString(),
          rationale: "Fixture imported receipt identifies the category",
          learnMerchant: "never",
        },
      ],
    });
    expect(proposed).toMatchObject({
      result: { status: "needs_input", question: { id: expect.any(String) } },
    });
    const question = (proposed as unknown as { result: { question: { id: string } } }).result
      .question;
    for (const name of ["answer_finance_question", "resolve_finance_review"]) {
      const answer = await call(name, {
        id: question.id,
        answer: "The fixture has no additional receipt evidence.",
      });
      expect(answer).toMatchObject({ result: { status: "needs_input" } });
    }
    expect(
      await f.db.query.financeTransactions.findFirst({
        where: eq(financeTransactions.id, rows[0]!.id),
      }),
    ).toMatchObject({ categoryId: null, categorySource: null });
    const merchants = await api.listFinanceMerchants();
    const alpha = merchants.find((item) => item.displayName === "Merchant Alpha")!;
    const beta = merchants.find((item) => item.displayName === "Merchant Beta")!;
    await call("update_finance_merchant", {
      merchantId: alpha.id,
      displayName: "Fixture merchant renamed",
      idempotencyKey: crypto.randomUUID(),
    });
    await call("merge_finance_merchants", {
      sourceMerchantId: beta.id,
      targetMerchantId: alpha.id,
      rationale: "The fixture receipts identify one merchant",
      idempotencyKey: crypto.randomUUID(),
    });
    expect((await api.listFinanceMerchants()).find((item) => item.id === beta.id)).toBeUndefined();
    await call("link_finance_transactions", {
      transactionIds: rows.map((row) => row.id),
      relationship: "duplicate",
      rationale: "The fixture export duplicated one receipt",
      idempotencyKey: crypto.randomUUID(),
    });
    expect(
      await f.db.query.financeTransactions.findMany({
        where: eq(financeTransactions.accountId, account.id),
      }),
    ).toEqual(
      expect.arrayContaining([expect.objectContaining({ reconciliationStatus: "matched" })]),
    );
  });
  it("persists account corrections, classifications, splits and audited removal", async () => {
    await f.setBypass(true);
    const { client } = await f.connectAgent([
      "finances:read",
      "finances:write",
      "finances:execute",
    ]);
    async function call(name: string, args: Record<string, unknown>) {
      const response = await client.callTool({ name, arguments: args });
      expect(response.isError, JSON.stringify(response)).not.toBe(true);
      const content = response.structuredContent as {
        data?: Record<string, unknown>;
        result?: Record<string, unknown>;
      };
      return (content.data ?? content.result)!;
    }
    const account = await call("create_finance_account", {
      name: "Ledger fixture",
      institution: "Manual",
      provider: "manual",
      balance: 100,
    });
    const corrected = await call("update_finance_account", {
      accountId: account.id,
      expectedUpdatedAt: account.updatedAt,
      name: "Corrected fixture",
      idempotencyKey: crypto.randomUUID(),
    });
    expect(JSON.stringify(corrected)).toContain("Corrected fixture");
    const food = await call("create_finance_category", { name: "Fixture food" });
    const supplies = await call("create_finance_category", { name: "Fixture supplies" });
    await call("add_finance_transaction", {
      accountId: account.id,
      merchant: "Fixture store",
      amount: 20,
      direction: "expense",
      date: "2026-10-11",
    });
    const rows = await f.db
      .select()
      .from(financeTransactions)
      .where(eq(financeTransactions.accountId, String(account.id)));
    expect(rows).toHaveLength(1);
    const transactionId = rows[0]!.id;
    const noteInput = {
      transactionId,
      notes: "Receipt checked",
      idempotencyKey: crypto.randomUUID(),
    };
    await f.setBypass(false);
    expect(
      (await client.callTool({ name: "update_finance_transaction", arguments: noteInput })).isError,
    ).toBe(true);
    await f.setBypass(true);
    await call("update_finance_transaction", {
      ...noteInput,
      idempotencyKey: crypto.randomUUID(),
    });
    const beforeClear = await call("get_finance_transaction", { transactionId });
    const missingRevision = await client.callTool({
      name: "update_finance_transaction",
      arguments: { transactionId, category: null, idempotencyKey: crypto.randomUUID() },
    });
    expect(missingRevision.isError, JSON.stringify(missingRevision)).toBe(true);
    const staleClear = await client.callTool({
      name: "update_finance_transaction",
      arguments: {
        transactionId,
        category: null,
        expectedTransactionUpdatedAt: rows[0]!.updatedAt.toISOString(),
        idempotencyKey: crypto.randomUUID(),
      },
    });
    expect(staleClear.isError, JSON.stringify(staleClear)).toBe(true);
    await call("update_finance_transaction", {
      transactionId,
      category: null,
      expectedTransactionUpdatedAt: beforeClear.updatedAt,
      idempotencyKey: crypto.randomUUID(),
    });
    await call("classify_finance_transactions", {
      classifications: [
        {
          transactionId,
          categoryId: food.id,
          confidence: 1,
          meaning: "Groceries",
          rationale: "Fixture receipt identifies groceries",
        },
      ],
      idempotencyKey: crypto.randomUUID(),
    });
    const classified = await call("get_finance_transaction", { transactionId });
    expect(JSON.stringify(classified)).toContain("Receipt checked");
    expect(classified.version).toBeGreaterThan(1);
    await call("update_finance_transaction", {
      transactionId,
      category: "Fixture food",
      confidence: 1,
      rationale: "The fixture receipt identifies groceries",
      expectedTransactionUpdatedAt: classified.updatedAt,
      learnMerchant: false,
      idempotencyKey: crypto.randomUUID(),
    });
    expect(
      await f.db.query.financeTransactions.findFirst({
        where: eq(financeTransactions.id, transactionId),
      }),
    ).toMatchObject({ categorySource: "agent", category: "Fixture food" });
    const staleSplit = await client.callTool({
      name: "split_finance_transaction",
      arguments: {
        transactionId,
        expectedVersion: classified.version,
        parts: [
          { amount: 12, categoryId: food.id, meaning: "Food", notes: null },
          { amount: 8, categoryId: supplies.id, meaning: "Supplies", notes: null },
        ],
        idempotencyKey: crypto.randomUUID(),
      },
    });
    expect(staleSplit.isError, JSON.stringify(staleSplit)).toBe(true);
    const current = await call("get_finance_transaction", { transactionId });
    const split = await call("split_finance_transaction", {
      transactionId,
      expectedVersion: current.version,
      parts: [
        { amount: 12, categoryId: food.id, meaning: "Food", notes: null },
        { amount: 8, categoryId: supplies.id, meaning: "Supplies", notes: null },
      ],
      idempotencyKey: crypto.randomUUID(),
    });
    expect(JSON.stringify(split)).toContain("Fixture");
    await call("add_finance_transaction", {
      accountId: account.id,
      merchant: "Mistaken entry",
      amount: 1,
      direction: "expense",
      date: "2026-10-11",
    });
    const mistaken = await f.db.query.financeTransactions.findFirst({
      where: eq(financeTransactions.merchant, "Mistaken entry"),
    });
    const page = await call("list_finance_transactions", {
      accountId: account.id,
      limit: 1,
      sortBy: "amount",
      sortDirection: "asc",
    });
    expect(page).toMatchObject({
      items: [expect.objectContaining({ id: mistaken!.id, amount: 1 })],
    });
    await call("remove_finance_transaction", {
      transactionId: mistaken!.id,
      idempotencyKey: crypto.randomUUID(),
    });
    expect(
      await f.db.query.financeTransactions.findFirst({
        where: eq(financeTransactions.id, mistaken!.id),
      }),
    ).toBeUndefined();
  });
  it("creates, updates, pauses, resumes, completes and removes versioned goals", async () => {
    const { client } = await f.connectAgent(["finances:read", "finances:write"]);
    async function call(args: Record<string, unknown>) {
      const response = await client.callTool({
        name: "manage_finance_goal",
        arguments: { ...args, idempotencyKey: crypto.randomUUID() },
      });
      expect(response.isError, JSON.stringify(response)).not.toBe(true);
      return (response.structuredContent as { data: { id: string; version: number; name: string } })
        .data;
    }
    let goal = await call({
      operation: "create",
      name: "Fixture reserve",
      targetAmount: 100,
      deadline: null,
      priority: "medium",
    });
    goal = await call({
      operation: "update",
      goalId: goal.id,
      expectedVersion: goal.version,
      changes: { name: "Updated reserve", targetAmount: 200 },
    });
    expect(goal.name).toBe("Updated reserve");
    for (const operation of ["pause", "resume", "complete", "remove"]) {
      goal = await call({ operation, goalId: goal.id, expectedVersion: goal.version });
    }
    const listed = await client.callTool({ name: "list_finance_goals", arguments: {} });
    expect(listed.isError).not.toBe(true);
    expect(listed.structuredContent).toMatchObject({
      data: [expect.objectContaining({ id: goal.id, status: "removed" })],
    });
  });
});
