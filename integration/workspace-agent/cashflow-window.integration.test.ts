import {
  financeAccounts,
  financeCashBalanceBases,
  financeRecurringScheduleVersions,
} from "@personal-os/database";
import { eq } from "drizzle-orm";
import { createMcpWorkspaceFixture, type WorkspaceFixture } from "./fixture.js";

describe("qualified Cash flow read intent through authenticated MCP", () => {
  let f: WorkspaceFixture;
  beforeAll(async () => {
    f = await createMcpWorkspaceFixture();
  }, 120_000);
  afterAll(async () => {
    await f?.close();
  });
  it("preserves explicit account scope, unknown qualification and owner isolation without recording human statements", async () => {
    const [owned] = await f.db
      .insert(financeAccounts)
      .values({
        userId: f.owner.id,
        provider: "manual",
        institution: "Manual",
        name: "Owner-only cash",
        currencyCode: "USD",
      })
      .returning();
    const [foreign] = await f.db
      .insert(financeAccounts)
      .values({
        userId: f.otherOwner.id,
        provider: "manual",
        institution: "Manual",
        name: "Foreign cash sentinel",
        currencyCode: "USD",
      })
      .returning();
    if (!owned || !foreign) throw new Error("Cash-flow fixtures were not created.");
    const { client } = await f.connectAgent(["finances:read"]);
    const window = {
      from: "2026-10-01",
      to: "2026-10-31",
      accountIds: [owned.id, foreign.id],
      selectedIncomeStreamId: null,
    };
    const response = await client.callTool({ name: "get_finance_cashflow", arguments: { window } });
    expect(response.isError, JSON.stringify(response)).not.toBe(true);
    const data = (
      response.structuredContent as {
        data: {
          qualifiedCashflow: { projection: { status: string } };
          rawCashflowContext: {
            cashflowSources: { accounts: Array<{ id: string }> };
            balanceStatementSources: { coverage: { complete: boolean; truncated: boolean } };
          };
        };
      }
    ).data;
    expect(data.qualifiedCashflow.projection.status).toBe("unavailable");
    expect(data.rawCashflowContext.cashflowSources.accounts.map(({ id }) => id)).toEqual([
      owned.id,
    ]);
    expect(data.rawCashflowContext.balanceStatementSources.coverage).toMatchObject({
      complete: true,
      truncated: false,
    });
    expect(JSON.stringify(data)).not.toContain(foreign.id);
    expect(JSON.stringify(data)).not.toContain("Foreign cash sentinel");
    const empty = await client.callTool({
      name: "get_finance_cashflow",
      arguments: { window: { ...window, accountIds: [] } },
    });
    expect(empty.isError, JSON.stringify(empty)).not.toBe(true);
    expect(empty.structuredContent).toMatchObject({
      data: {
        rawCashflowContext: {
          recurringSchedules: [],
          balanceBases: [],
          cashflowSources: { accounts: [], transactions: [] },
          balanceStatementSources: { accounts: [], transactions: [] },
        },
      },
    });
    const invalid = await client.callTool({
      name: "get_finance_cashflow",
      arguments: { window: { ...window, from: "2026-11-01" } },
    });
    expect(invalid.isError).toBe(true);
    expect(
      await f.db
        .select()
        .from(financeRecurringScheduleVersions)
        .where(eq(financeRecurringScheduleVersions.userId, f.owner.id)),
    ).toEqual([]);
    expect(
      await f.db
        .select()
        .from(financeCashBalanceBases)
        .where(eq(financeCashBalanceBases.userId, f.owner.id)),
    ).toEqual([]);
  });
});
