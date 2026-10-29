import { accessTokens } from "@personal-os/database";
import { eq } from "drizzle-orm";
import { createMcpWorkspaceFixture, type WorkspaceFixture } from "./fixture.js";

describe("workspace execution authorization", () => {
  let f: WorkspaceFixture;
  beforeAll(async () => {
    f = await createMcpWorkspaceFixture();
  }, 120_000);
  afterAll(async () => {
    await f?.close();
  });
  it("allows an explicitly granted agent to create a Finance account with bypass on", async () => {
    await f.setBypass(true);
    const agent = await f.connectAgent(["finances:read", "finances:write", "finances:execute"]);
    const account = await agent.api.createFinanceAccount({
      name: "Manual cash",
      institution: "Cash",
      provider: "manual",
      balance: 100,
    });
    expect(account.name).toBe("Manual cash");
    expect((await agent.api.listFinanceAccounts()).accounts.map((item) => item.id)).toContain(
      account.id,
    );
  });
  it("preserves denial with bypass off and without a new execution grant", async () => {
    await f.setBypass(false);
    const agent = await f.connectAgent(["finances:read", "finances:write", "finances:execute"]);
    const input = { name: "Denied", institution: "Cash", provider: "manual" as const, balance: 0 };
    await expect(agent.api.createFinanceAccount(input)).rejects.toMatchObject({ status: 403 });
    await f.setBypass(true);
    const oldGrant = await f.connectAgent(["finances:read", "finances:write"]);
    await expect(oldGrant.api.createFinanceAccount(input)).rejects.toMatchObject({ status: 403 });
    expect((await oldGrant.client.listTools()).tools.map((tool) => tool.name)).not.toContain(
      "start_finance_account_connection",
    );
  });
});

describe("OAuth-bound MCP authority", () => {
  let f: WorkspaceFixture;
  beforeAll(async () => {
    f = await createMcpWorkspaceFixture();
  }, 120_000);
  afterAll(async () => {
    await f?.close();
  });
  it("enforces audience-bound authority behind the trusted MCP header while preserving personal tokens", async () => {
    const personal = await f.connectAgent(["reminders:read"]);
    const bound = await f.connectAgent(["reminders:read"]);
    const audience = `${f.config.apiBaseUrl}/mcp`;
    await f.db
      .update(accessTokens)
      .set({ audience })
      .where(eq(accessTokens.id, bound.credential.id));
    const request = (token: string, resource?: string, key?: string) =>
      f.app.request("/v1/assistant/context", {
        headers: {
          authorization: `Bearer ${token}`,
          ...(resource ? { "x-personal-os-mcp-resource": resource } : {}),
          ...(key ? { "x-personal-os-mcp-key": key } : {}),
        },
      });
    expect((await request(personal.credential.token)).status).toBe(200);
    expect(
      (await request(bound.credential.token, audience, f.config.mcpInternalSecret)).status,
    ).toBe(200);
    expect(
      (await request(bound.credential.token, `${audience}/other`, f.config.mcpInternalSecret))
        .status,
    ).toBe(401);
    expect((await request(bound.credential.token, audience)).status).toBe(401);
    expect((await request(bound.credential.token, audience, "spoofed-key")).status).toBe(401);
  });
  it("executes through real OAuth authentication, expires and refreshes the same connection", async () => {
    await f.setBypass(true);
    const agent = await f.connectAgent(
      ["finances:read", "finances:write", "finances:execute", "finances:maintain"],
      { credentialKind: "oauth" },
    );
    const response = await agent.client.callTool({
      name: "create_finance_account",
      arguments: { name: "OAuth cash", institution: "Fixture", provider: "manual", balance: 50 },
    });
    expect(response.isError, JSON.stringify(response)).not.toBe(true);
    const before = await agent.api.listAutomationHostConnections();
    expect(before).toHaveLength(1);
    f.advanceTime(61 * 60_000);
    await expect(agent.api.listFinanceAccounts()).rejects.toMatchObject({ status: 401 });
    const refreshed = await agent.refresh();
    expect(await refreshed.listAutomationHostConnections()).toEqual(before);
    expect((await refreshed.listFinanceAccounts()).accounts).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "OAuth cash" })]),
    );
  });
});
