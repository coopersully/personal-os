import { approveFinanceBudgetInputSchema } from "@personal-os/domain";
import { createMcpWorkspaceFixture, type WorkspaceFixture } from "./fixture.js";
import { connectHumanFinanceClient } from "./human-finance.js";

describe("Finance policy definitions through MCP", () => {
  let f: WorkspaceFixture;
  beforeAll(async () => {
    f = await createMcpWorkspaceFixture();
  }, 120_000);
  afterAll(async () => {
    await f?.close();
  });
  it("executes the full definition, proposal and preview lifecycle without claiming automatic execution", async () => {
    await f.setBypass(true);
    const { client } = await f.connectAgent([
      "finances:read",
      "finances:write",
      "finances:execute",
    ]);
    async function call(name: string, args: Record<string, unknown> = {}) {
      const r = await client.callTool({ name, arguments: args });
      expect(r.isError, JSON.stringify(r)).not.toBe(true);
      const body = r.structuredContent as {
        data?: Record<string, unknown>;
        result?: Record<string, unknown>;
      };
      return (body.data ?? body.result) as Record<string, unknown>;
    }
    const profile = await call("update_financial_profile", {
      changes: { expectedMonthlyTakeHome: 1000 },
      expectedVersion: 0,
      idempotencyKey: crypto.randomUUID(),
    });
    let budget = await call("create_finance_budget", {
      name: "Policy plan",
      effectiveFrom: "2026-10",
      resources: [{ amount: 1000, key: "income", kind: "income" }],
      allocations: [{ amount: 1000, key: "buffer", kind: "buffer" }],
      assumptions: ["Fixture"],
      rationale: "Retain buffer",
      idempotencyKey: crypto.randomUUID(),
    });
    const approval = {
      budgetVersionId: budget.id,
      expectedVersion: budget.version,
      expectedProfileVersionId: profile.id,
      idempotencyKey: crypto.randomUUID(),
    };
    await f.setBypass(false);
    for (const approvalSource of ["agent_self_approval", "user_instruction"]) {
      expect(
        (
          await client.callTool({
            name: "approve_finance_budget",
            arguments: { ...approval, approvalSource },
          })
        ).isError,
      ).toBe(true);
    }
    const human = await connectHumanFinanceClient(f);
    budget = (
      await human.approveFinanceBudget(
        approveFinanceBudgetInputSchema.parse({
          ...approval,
          approvalSource: "user_instruction",
        }),
      )
    ).data as unknown as Record<string, unknown>;
    expect(budget).toMatchObject({ status: "active", approvedAt: expect.any(String) });
    await f.setBypass(true);
    const profileRef = { id: profile.id, revision: String(profile.version) },
      budgetRef = { id: budget.id, revision: String(budget.version) };
    const period = { from: "2026-10-01", through: "2026-10-31", timezone: "America/New_York" };
    const terms = {
      currency: "USD",
      period,
      rollover: "none",
      accounting: "gross_positive_allocation_deltas",
      usageScope: "user_month_all_policy_versions",
      perChangeCapCents: 1000,
      monthlyCapCents: 2000,
      expiresAt: "2026-11-01T04:00:00Z",
      baseline: budgetRef,
      directions: [{ allocationKey: "buffer", direction: "both" }],
      protections: [],
    };
    const expectedProfile = profileRef,
      expectedLatestBudget = budgetRef;
    await call("designate_finance_budget_baseline", {
      planId: budget.planId,
      period,
      budget: budgetRef,
      expectedProfile,
      expectedLatestBudget,
      idempotencyKey: crypto.randomUUID(),
    });
    const policy = await call("create_finance_budget_policy", {
      planId: budget.planId,
      terms,
      expectedProfile,
      expectedLatestBudget,
      idempotencyKey: crypto.randomUUID(),
    });
    expect(policy).toMatchObject({ state: "draft", executionAvailable: false });
    expect(await call("get_finance_budget_policy", { policyId: policy.id })).toMatchObject({
      id: policy.id,
    });
    const version = policy.latestVersion as { id: string; version: number };
    const expected = {
      userId: f.owner.id,
      planId: budget.planId,
      policy: { id: version.id, revision: String(version.version) },
      policyLifecycleRevision: policy.lifecycleRevision,
      profile: profileRef,
      baseline: budgetRef,
      activeBudget: budgetRef,
      latestBudget: budgetRef,
      positionRevision: null,
      usageRevision: null,
    };
    const candidate = {
      userId: f.owner.id,
      planId: budget.planId,
      revision: { id: crypto.randomUUID(), revision: "1" },
      month: "2026-10",
      resources: [{ key: "income", kind: "income", sourceId: null, amountCents: 100000 }],
      allocations: [{ key: "buffer", kind: "buffer", targetId: null, amountCents: 100000 }],
    };
    await call("preview_finance_budget_policy", { policyId: policy.id, expected, candidate });
    const reader = await f.connectAgent(["finances:read"], { readOnly: true });
    await f.setBypass(false);
    const readPreview = await reader.client.callTool({
      name: "preview_finance_budget_policy",
      arguments: { policyId: policy.id, expected, candidate },
    });
    expect(readPreview.isError, JSON.stringify(readPreview)).not.toBe(true);
    expect(readPreview.structuredContent).toMatchObject({
      result: {
        executionAvailable: false,
        kind: expect.stringMatching(/^(denied|hypothetical_preview)$/),
      },
    });
    await f.setBypass(true);
    const proposal = await call("create_finance_budget_revision_proposal", {
      policyId: policy.id,
      expected,
      candidate,
      idempotencyKey: crypto.randomUUID(),
    });
    expect(
      await call("get_finance_budget_revision_proposal", { proposalId: proposal.id }),
    ).toMatchObject({ state: "inactive" });
    const preview = await call("save_finance_budget_policy_preview", {
      proposalId: proposal.id,
      expected,
      expectedProposalRevision: proposal.lifecycleRevision,
      expiresAt: "2026-10-11T15:05:00Z",
      idempotencyKey: crypto.randomUUID(),
    });
    expect(
      await call("get_finance_budget_policy_preview", {
        proposalId: proposal.id,
        previewId: preview.id,
      }),
    ).toMatchObject({ id: preview.id });
    expect(
      await call("withdraw_finance_budget_revision_proposal", {
        proposalId: proposal.id,
        expectedLifecycleRevision: proposal.lifecycleRevision,
        idempotencyKey: crypto.randomUUID(),
      }),
    ).toMatchObject({ state: "withdrawn" });
    const revised = await call("revise_finance_budget_policy", {
      policyId: policy.id,
      terms,
      expectedProfile,
      expectedLatestBudget,
      expectedLifecycleRevision: policy.lifecycleRevision,
      expectedLatestVersion: version.version,
      idempotencyKey: crypto.randomUUID(),
    });
    expect(
      await call("disable_finance_budget_policy", {
        policyId: policy.id,
        expectedLifecycleRevision: revised.lifecycleRevision,
        idempotencyKey: crypto.randomUUID(),
      }),
    ).toMatchObject({ state: "disabled" });
  });
});
