import {
  financeAlerts,
  financeIncomeStreams,
  financeRecurringObligations,
} from "@personal-os/database";
import { eq } from "drizzle-orm";
import { createMcpWorkspaceFixture, type WorkspaceFixture } from "./fixture.js";

describe("Finance planning and recurring workflows through MCP", () => {
  let f: WorkspaceFixture;
  beforeAll(async () => {
    f = await createMcpWorkspaceFixture();
  }, 120_000);
  afterAll(async () => {
    await f?.close();
  });
  it("saves profile and budget assumptions and manages bucket and merchant-rule lifecycles", async () => {
    await f.setBypass(true);
    const { client } = await f.connectAgent([
      "finances:read",
      "finances:write",
      "finances:execute",
    ]);
    async function call(name: string, args: Record<string, unknown> = {}) {
      const response = await client.callTool({ name, arguments: args });
      expect(response.isError, JSON.stringify(response)).not.toBe(true);
      const content = response.structuredContent as {
        data?: Record<string, unknown>;
        result?: Record<string, unknown>;
      };
      return (content.data ?? content.result)!;
    }
    await call("update_finance_profile", {
      employer: "Fixture employer",
      employmentType: "full_time",
      expectedNetPay: 2000,
      payFrequency: "monthly",
      effectiveDate: "2026-10-01",
    });
    expect(await call("get_finance_profile")).toMatchObject({
      employer: "Fixture employer",
      expectedNetPay: 2000,
    });
    const category = await call("create_finance_category", { name: "Planning food" });
    await call("set_finance_budget_plan", {
      month: "2026-10",
      allocations: [{ categoryId: category.id, limit: 100 }],
      rationale: "Fixture expected income covers food",
      assumptions: ["Income stated in profile"],
    });
    expect(
      JSON.stringify(await call("get_finance_category_budget_status", { month: "2026-10" })),
    ).toContain("Planning food");
    const scenario = await call("compare_finance_scenarios", {
      asOf: "2026-10-11",
      horizonMonths: 3,
      baseline: { label: "Baseline", startingCash: 100, monthlyIncome: 2000 },
      alternatives: [
        {
          label: "Higher reserve",
          startingCash: 100,
          monthlyIncome: 2000,
          monthlyReserveContribution: 100,
        },
      ],
    });
    expect(scenario).toMatchObject({
      baseline: { monthlyCashFlow: 2000 },
      alternatives: [{ label: "Higher reserve", monthlyCashFlow: 1900 }],
    });
    await call("manage_finance_budget_bucket", {
      operation: "create",
      name: "Fixture essentials",
      idempotencyKey: crypto.randomUUID(),
    });
    const taxonomy = (await call("list_finance_budget_buckets")).taxonomy as {
      version: number;
      buckets: Array<{ id: string; name: string }>;
    };
    const bucket = taxonomy.buckets.find((item) => item.name === "Fixture essentials")!;
    await call("manage_finance_budget_bucket", {
      operation: "update",
      bucketId: bucket.id,
      expectedVersion: taxonomy.version,
      categoryIds: [category.id],
      name: "Fixture essentials revised",
      idempotencyKey: crypto.randomUUID(),
    });
    expect(JSON.stringify(await call("list_finance_budget_buckets"))).toContain(
      "Fixture essentials revised",
    );
    const rule = await call("manage_finance_rule", {
      operation: "create",
      merchant: "Fixture market",
      category: "Planning food",
      idempotencyKey: crypto.randomUUID(),
    });
    await call("manage_finance_rule", {
      operation: "update",
      ruleId: rule.id,
      merchant: "Fixture market corrected",
      idempotencyKey: crypto.randomUUID(),
    });
    expect(JSON.stringify(await call("list_finance_rules"))).toContain("fixture market corrected");
    await call("manage_finance_rule", {
      operation: "remove",
      ruleId: rule.id,
      idempotencyKey: crypto.randomUUID(),
    });
    expect(JSON.stringify(await call("list_finance_rules"))).not.toContain(String(rule.id));
    const setup = await call("setup_finances", { operation: "start" });
    expect(setup).toMatchObject({ stage: "collecting_profile", sessionId: expect.any(String) });
    expect(
      await call("setup_finances", { operation: "resume", sessionId: setup.sessionId }),
    ).toMatchObject({ sessionId: setup.sessionId });
  });
  it("reviews inferred income, recurring obligations and alerts and applies lifecycle changes", async () => {
    await f.setBypass(true);
    const [income] = await f.db
      .insert(financeIncomeStreams)
      .values({
        userId: f.owner.id,
        payer: "Fixture payer",
        displayName: "Fixture income",
        cadence: "monthly",
        expectedAmount: 10000,
        amountTolerance: 0,
        confidence: 9000,
        source: "inferred",
      })
      .returning();
    const [obligation] = await f.db
      .insert(financeRecurringObligations)
      .values({
        userId: f.owner.id,
        merchant: "Fixture subscription",
        displayName: "Fixture subscription",
        kind: "subscription",
        cadence: "monthly",
        expectedAmount: 500,
        amountTolerance: 0,
        confidence: 9000,
        source: "inferred",
      })
      .returning();
    const [alert] = await f.db
      .insert(financeAlerts)
      .values({
        userId: f.owner.id,
        incomeStreamId: income!.id,
        type: "income_changed",
        severity: "info",
        title: "Fixture change",
        body: "Review the inferred amount",
      })
      .returning();
    const { client } = await f.connectAgent([
      "finances:read",
      "finances:write",
      "finances:execute",
    ]);
    const calls: Array<[string, Record<string, unknown>]> = [
      ["update_finance_income_stream", { id: income!.id, status: "active" }],
      ["update_finance_recurring_obligation", { id: obligation!.id, status: "active" }],
      ["resolve_finance_alert", { id: alert!.id, action: "resolve" }],
      ...["pause", "resume", "cancel"].map((operation): [string, Record<string, unknown>] => [
        "manage_finance_recurring_item",
        {
          itemId: obligation!.id,
          itemType: "obligation",
          operation,
          idempotencyKey: crypto.randomUUID(),
        },
      ]),
    ];
    for (const [name, args] of calls) {
      const response = await client.callTool({ name, arguments: args });
      expect(response.isError, JSON.stringify(response)).not.toBe(true);
    }
    expect(
      await f.db.query.financeIncomeStreams.findFirst({
        where: eq(financeIncomeStreams.id, income!.id),
      }),
    ).toMatchObject({ status: "active" });
    expect(
      await f.db.query.financeRecurringObligations.findFirst({
        where: eq(financeRecurringObligations.id, obligation!.id),
      }),
    ).toMatchObject({ status: "cancelled" });
    expect(
      await f.db.query.financeAlerts.findFirst({ where: eq(financeAlerts.id, alert!.id) }),
    ).toMatchObject({ status: "resolved" });
    const refreshed = await client.callTool({ name: "refresh_finance_insights", arguments: {} });
    expect(refreshed.isError, JSON.stringify(refreshed)).not.toBe(true);
  });
});
