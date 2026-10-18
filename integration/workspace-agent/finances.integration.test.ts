import { auditEvents, financeBudgetVersions } from "@personal-os/database";
import { approveFinanceBudgetInputSchema } from "@personal-os/domain";
import { eq } from "drizzle-orm";
import { createMcpWorkspaceFixture, type WorkspaceFixture } from "./fixture.js";
import { connectHumanFinanceClient } from "./human-finance.js";

describe("Finance MCP execution", () => {
  let f: WorkspaceFixture;
  beforeAll(async () => {
    f = await createMcpWorkspaceFixture();
  }, 120_000);
  afterAll(async () => {
    await f?.close();
  });
  it.each([
    ["get_finance_configuration", {}],
    ["get_finance_budget_pace", { period: "month" }],
    ["get_finance_position", { from: "2026-10-01", through: "2026-10-11" }],
    ["list_finance_review_history", {}],
    ["list_finance_budget_policies", { limit: 50 }],
    ["list_finance_questions", {}],
    ["list_finance_action_reviews", {}],
  ])("executes %s with real queries", async (name, args) => {
    const { client } = await f.connectAgent(["finances:read"]);
    const response = await client.callTool({
      name: name as string,
      arguments: args as Record<string, unknown>,
    });
    expect(response.isError, JSON.stringify(response)).not.toBe(true);
    expect((response.structuredContent as { result?: unknown } | undefined)?.result).toBeDefined();
  });
  it("creates a category and manual account, then disconnects and deletes the account", async () => {
    await f.setBypass(true);
    const { client, api } = await f.connectAgent([
      "finances:read",
      "finances:write",
      "finances:execute",
    ]);
    const call = async (name: string, args: Record<string, unknown>) => {
      const response = await client.callTool({ name, arguments: args });
      expect(response.isError, JSON.stringify(response)).not.toBe(true);
      return (response.structuredContent as { result?: unknown } | undefined)?.result as Record<
        string,
        unknown
      >;
    };
    await call("create_finance_category", { name: "Agent category" });
    expect((await api.getFinanceCategories()).some((item) => item.name === "Agent category")).toBe(
      true,
    );
    const account = await call("create_finance_account", {
      name: "Agent cash",
      institution: "Cash",
      provider: "manual",
      balance: 200,
    });
    expect((await api.listFinanceAccounts()).accounts.some((item) => item.id === account.id)).toBe(
      true,
    );
    await call("disconnect_finance_account", {
      accountId: account.id,
      idempotencyKey: crypto.randomUUID(),
    });
    await call("delete_finance_account", { accountId: account.id });
    expect((await api.listFinanceAccounts()).accounts.some((item) => item.id === account.id)).toBe(
      false,
    );
  });
});

describe("Finance activation through MCP", () => {
  let f: WorkspaceFixture;
  beforeAll(async () => {
    f = await createMcpWorkspaceFixture();
  }, 120_000);
  afterAll(async () => {
    await f?.close();
  });
  it("keeps agent proposals inactive until exact human approval and preserves both actor identities", async () => {
    await f.setBypass(true);
    const { client } = await f.connectAgent([
      "finances:read",
      "finances:write",
      "finances:execute",
    ]);
    async function call(name: string, args: Record<string, unknown>) {
      const r = await client.callTool({ name, arguments: args });
      expect(r.isError, JSON.stringify(r)).not.toBe(true);
      return r.structuredContent as { data: Record<string, unknown> };
    }
    const profile = await call("update_financial_profile", {
      changes: { expectedMonthlyTakeHome: 1000, householdSize: 1, incomeStability: "stable" },
      expectedVersion: 0,
      idempotencyKey: crypto.randomUUID(),
    });
    const budget = await call("create_finance_budget", {
      name: "Fixture plan",
      effectiveFrom: "2026-10",
      resources: [{ amount: 1000, key: "income", kind: "income" }],
      allocations: [{ amount: 1000, key: "buffer", kind: "buffer" }],
      assumptions: ["Fixture income"],
      rationale: "Retain a buffer",
      idempotencyKey: crypto.randomUUID(),
    });
    const input = {
      budgetVersionId: budget.data.id,
      expectedVersion: budget.data.version,
      expectedProfileVersionId: profile.data.id,
      idempotencyKey: crypto.randomUUID(),
    };
    expect(
      (
        await client.callTool({
          name: "approve_finance_budget",
          arguments: { ...input, approvalSource: "user_instruction" },
        })
      ).isError,
    ).toBe(true);
    expect(
      (
        await client.callTool({
          name: "approve_finance_budget",
          arguments: { ...input, approvalSource: "agent_self_approval" },
        })
      ).isError,
    ).toBe(true);
    expect(
      await f.db.query.financeBudgetVersions.findFirst({
        where: eq(financeBudgetVersions.id, String(budget.data.id)),
      }),
    ).toMatchObject({ status: "proposed", approvedAt: null, approvedByActorType: null });
    const human = await connectHumanFinanceClient(f);
    const approved = await human.approveFinanceBudget(
      approveFinanceBudgetInputSchema.parse({
        ...input,
        approvalSource: "user_instruction",
      }),
    );
    expect(approved.data).toMatchObject({ status: "active" });
    expect(
      await f.db.query.financeBudgetVersions.findFirst({
        where: eq(financeBudgetVersions.id, String(budget.data.id)),
      }),
    ).toMatchObject({
      status: "active",
      approvedByActorType: "user",
      approvedByActorId: f.owner.id,
      createdByActorType: "agent",
    });
    expect(
      await f.db
        .select()
        .from(auditEvents)
        .where(eq(auditEvents.entityId, String(budget.data.id))),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          actorType: "user",
          actorId: f.owner.id,
          action: "finance.budget.user_instruction_approved",
          after: expect.objectContaining({ approvalSource: "user_instruction" }),
        }),
      ]),
    );
    const revised = await call("revise_finance_budget", {
      planId: budget.data.planId,
      expectedVersion: approved.data.version,
      name: "Revised fixture plan",
      effectiveFrom: "2026-11",
      resources: [{ amount: 1000, key: "income", kind: "income" }],
      allocations: [{ amount: 1000, key: "buffer", kind: "buffer" }],
      assumptions: ["Fixture income continues"],
      rationale: "Keep next month's reserve explicit",
      idempotencyKey: crypto.randomUUID(),
    });
    expect(revised.data).toMatchObject({ version: 2, status: "proposed" });
  });
});
