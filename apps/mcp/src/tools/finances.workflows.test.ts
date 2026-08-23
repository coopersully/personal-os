import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { PersonalOsApiClient } from "@personal-os/api-client";
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
});
