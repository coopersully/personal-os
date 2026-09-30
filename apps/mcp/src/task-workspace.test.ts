import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { ApiClientError, type PersonalOsApiClient } from "@personal-os/api-client";
import type { AccessScope } from "@personal-os/domain";
import { createPersonalOsMcpServer } from "./server.js";
import { availableToolNames, iloToolCatalog } from "./tool-catalog.js";

describe("read-only task workspace MCP adapter", () => {
  it("requires both read scopes for mixed discovery, preserving single-domain tools", () => {
    const tasks = availableToolNames(new Set(["tasks:read"]), true);
    expect(tasks).toContain("list_tasks");
    expect(tasks).not.toContain("list_task_workspace");
    const reminders = availableToolNames(new Set(["reminders:read"]), true);
    expect(reminders).toContain("list_reminders");
    expect(reminders).not.toContain("list_task_workspace");
    expect(availableToolNames(new Set(["tasks:read", "reminders:read"]), true)).toContain(
      "list_task_workspace",
    );
    expect((iloToolCatalog as Record<string, unknown>).list_task_workspace).toMatchObject({
      readOnly: true,
      policy: "read_only",
      requiredScopes: ["tasks:read", "reminders:read"],
    });
  });

  it("exposes the global page and shared output metadata through the typed MCP protocol", async () => {
    const listTaskWorkspace = vi.fn().mockResolvedValue({ items: [], nextCursor: null, total: 42 });
    const scopes = new Set<AccessScope>(["tasks:read", "reminders:read"]);
    const server = createPersonalOsMcpServer({
      api: { listTaskWorkspace } as unknown as PersonalOsApiClient,
      readOnly: true,
      scopes,
      timeZone: "UTC",
    });
    const client = new Client({ name: "workspace-test", version: "1" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    try {
      const tools = await client.listTools();
      const tool = tools.tools.find((item) => item.name === "list_task_workspace");
      expect(tool?.annotations).toMatchObject({
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
        readOnlyHint: true,
      });
      const result = await client.callTool({
        name: "list_task_workspace",
        arguments: { view: "upcoming", sort: "priority", limit: 10 },
      });
      expect(result.structuredContent).toMatchObject({
        result: { items: [], nextCursor: null, total: 42 },
        _ilo: { domain: "tasks", policy: "read_only", readOnly: true },
      });
      expect(listTaskWorkspace).toHaveBeenCalledWith(
        expect.objectContaining({ view: "upcoming", sort: "priority", limit: 10 }),
      );
      listTaskWorkspace.mockRejectedValueOnce(
        new ApiClientError({
          status: 403,
          code: "forbidden",
          message: "Missing scope",
          requestId: "request-1",
        }),
      );
      const denied = await client.callTool({ name: "list_task_workspace", arguments: {} });
      expect(denied.isError).toBe(true);
      expect(denied.structuredContent).toMatchObject({ error: { code: "forbidden", status: 403 } });
    } finally {
      await client.close();
      await server.close();
    }
  });
});
