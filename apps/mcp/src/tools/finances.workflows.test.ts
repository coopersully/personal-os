import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { McpServer } from "@modelcontextprotocol/server";
import type { PersonalOsApiClient } from "@personal-os/api-client";
import { financeCapabilityManifest } from "@personal-os/domain";
import { registerFinanceTools } from "./finances.js";

const id = "11111111-1111-4111-8111-111111111111";
const base = {
  changes: [],
  communication: { headline: "One answer needed.", optionalDetails: [], requiredDisclosures: [] },
  outcome: "user_input_required" as const,
  remainingWork: { categories: ["collecting_profile"], count: 1 },
  schemaVersion: 1 as const,
};

describe("Finance MCP workflows", () => {
  it("forwards account filters to the typed API and returns planning disclosures", async () => {
    const listFinanceAccounts = vi.fn(async () => ({
      accounts: [],
      accountSemantics: {
        excludedAccountIds: [],
        possibleDuplicateGroups: [],
        trustworthy: false,
        unresolvedOwnershipAccountIds: [id],
      },
      totals: { cash: 0, debt: 0, investments: 0, netWorth: 0, otherAssets: 0 },
    }));
    const server = new McpServer({ name: "finance-accounts-test", version: "1" });
    registerFinanceTools(server, { listFinanceAccounts } as unknown as PersonalOsApiClient);
    const client = new Client({ name: "test", version: "1" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const response = await client.callTool({
      arguments: { includeExcluded: false, kind: "investment", query: "IRA" },
      name: "list_finance_accounts",
    });
    expect(listFinanceAccounts).toHaveBeenCalledWith({
      includeExcluded: false,
      kind: "investment",
      query: "IRA",
    });
    expect(response.structuredContent).toMatchObject({
      data: {
        accountSemantics: { unresolvedOwnershipAccountIds: [id] },
        totals: { investments: 0 },
      },
    });
  });

  it("routes natural setup intent and returns one concise question without queue state", async () => {
    const api = {
      setupFinances: vi.fn(async () => ({
        ...base,
        communication: {
          ...base.communication,
          nextQuestion: {
            answerType: "location",
            id: "profile:location",
            prompt: "Where do you live for tax and cost-of-living purposes?",
          },
        },
        data: {
          budgetVersionId: null,
          maintenanceRunId: null,
          question: null,
          sessionId: id,
          stage: "collecting_profile",
          version: 1,
        },
      })),
    } as unknown as PersonalOsApiClient;
    const server = new McpServer({ name: "finance-test", version: "1" });
    registerFinanceTools(server, api);
    const client = new Client({ name: "test", version: "1" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const tools = await client.listTools();
    const setup = tools.tools.find((tool) => tool.name === "setup_finances");
    expect(setup?.description).toContain("when the user asks to set up");
    expect(setup?.description).toContain("Do not ask the user to name a tool");
    const maintenance = tools.tools.find((tool) => tool.name === "maintain_finances");
    expect(maintenance?.description).toContain("never queues an automation");
    expect(tools.tools.map((tool) => tool.name)).not.toContain("get_finance_review_queue");
    expect(tools.tools.map((tool) => tool.name)).not.toContain("apply_finance_categorizations");
    expect(tools.tools.map((tool) => tool.name).toSorted()).toEqual(
      financeCapabilityManifest.map((capability) => capability.mcpTool).toSorted(),
    );
    expect(tools.tools.find((tool) => tool.name === "sync_finance_accounts")?.inputSchema).toEqual(
      expect.not.objectContaining({ required: expect.arrayContaining(["idempotencyKey"]) }),
    );
    for (const toolName of [
      "update_finance_transaction",
      "import_finance_transactions",
      "update_finance_merchant",
      "merge_finance_merchants",
      "manage_finance_rule",
      "manage_finance_recurring_item",
    ]) {
      const tool = tools.tools.find((candidate) => candidate.name === toolName);
      const variants = tool?.inputSchema.oneOf ?? tool?.inputSchema.anyOf ?? [tool?.inputSchema];
      expect(variants).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ required: expect.arrayContaining(["idempotencyKey"]) }),
        ]),
      );
    }

    const called = await client.callTool({
      name: "setup_finances",
      arguments: { operation: "start" },
    });
    expect(called.structuredContent).toMatchObject({
      communication: { nextQuestion: { id: "profile:location" } },
      outcome: "user_input_required",
    });
    expect(called.content).toEqual([
      expect.objectContaining({ text: expect.stringContaining("Where do you live") }),
    ]);
  });

  it("projects an unresolved receipt review as a person-directed question", async () => {
    const question = "What did you buy or pay for at Amazon?";
    const api = {
      reviewFinanceReceipt: vi.fn(async () => ({
        evidence: {
          confidence: 0,
          matches: [],
          nextAction: "ask_person",
          question,
          status: "no_match",
        },
        transaction: { id, merchant: "Amazon" },
      })),
    } as unknown as PersonalOsApiClient;
    const server = new McpServer({ name: "finance-receipt-test", version: "1" });
    registerFinanceTools(server, api);
    const client = new Client({ name: "test", version: "1" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const response = await client.callTool({
      arguments: { id, searchMail: true, windowDays: 7 },
      name: "review_finance_receipt",
    });

    expect(response.structuredContent).toMatchObject({
      communication: { nextQuestion: { prompt: question } },
      outcome: "user_input_required",
    });
    expect(response.content).toEqual([
      expect.objectContaining({ text: expect.stringContaining(question) }),
    ]);
  });
});
