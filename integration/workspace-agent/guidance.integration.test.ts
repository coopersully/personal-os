import { domainProfileApprovals } from "@personal-os/database";
import { eq } from "drizzle-orm";
import { createMcpWorkspaceFixture, type WorkspaceFixture } from "./fixture.js";

describe("Finance guidance approval provenance", () => {
  let f: WorkspaceFixture;
  beforeAll(async () => {
    f = await createMcpWorkspaceFixture();
  }, 120_000);
  afterAll(async () => {
    await f?.close();
  });
  it("activates exact sourced guidance without recording a human approval", async () => {
    await f.setBypass(true);
    const { client, api, credential } = await f.connectAgent([
      "finances:read",
      "finances:write",
      "finances:execute",
    ]);
    const account = await api.createFinanceAccount({
      name: "Guidance cash",
      institution: "Manual",
      provider: "manual",
      balance: 100,
    });
    const input = {
      domain: "finances",
      status: "active",
      categories: [],
      instructions: ["Preserve buffer"],
      objective: "Maintain finances",
      preferences: {},
      sourceContexts: [
        { sourceId: account.id, sourceLabel: account.name, purpose: "Cash buffer", notes: null },
      ],
      summary: "Established fixture guidance",
    };
    await f.setBypass(false);
    expect((await client.callTool({ name: "save_domain_profile", arguments: input })).isError).toBe(
      true,
    );
    await f.setBypass(true);
    const saved = await client.callTool({ name: "save_domain_profile", arguments: input });
    expect(saved.isError, JSON.stringify(saved)).not.toBe(true);
    expect(
      await f.db.query.domainProfileApprovals.findFirst({
        where: eq(domainProfileApprovals.userId, f.owner.id),
      }),
    ).toMatchObject({
      approvalSource: "agent_self_approval",
      approvedByAgentId: credential.id,
      approvedByUserId: null,
    });
    const read = await client.callTool({
      name: "get_domain_profile",
      arguments: { domain: "finances" },
    });
    expect(read.structuredContent).toMatchObject({ result: { status: "active" } });
    const approval = { source: "agent_self_approval", agentId: credential.id, userId: null };
    const status = await api.getAssistantSetupStatus();
    expect(status.domains.find((domain) => domain.domain === "finances")).toMatchObject({
      approvedProfileApproval: approval,
    });
    const setup = await client.callTool({
      name: "get_ilo_setup",
      arguments: { domain: "finances" },
    });
    expect(setup.structuredContent).toMatchObject({ result: { profile: { approval } } });
    expect(JSON.stringify(setup)).not.toContain("Signed-in approval is active");
    const guided = await client.callTool({ name: "get_finance_guided_setup", arguments: {} });
    expect(guided.structuredContent).toMatchObject({
      result: { context: { guidance: { approval } } },
    });
    expect(JSON.stringify(guided)).not.toContain("activation requires a signed-in person");
  });
});
