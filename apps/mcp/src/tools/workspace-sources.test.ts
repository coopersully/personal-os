import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { McpServer } from "@modelcontextprotocol/server";
import { createApiClient } from "@personal-os/api-client";
import { registerWorkspaceSourceTools } from "./workspace-sources.js";

it("preserves saved changes and pending continuation through workspace source synchronization", async () => {
  const payload = { changed: 25, pending: true, nextSyncAt: "2026-10-29T18:00:00.000Z" };
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockResolvedValue(Response.json({ result: payload }));
  const api = createApiClient({
    baseUrl: "https://api.example.test",
    token: "scoped-token",
    fetch,
  });
  const server = new McpServer({ name: "source-sync", version: "1" });
  registerWorkspaceSourceTools(server, api);
  const client = new Client({ name: "source-client", version: "1" });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(st), client.connect(ct)]);
  try {
    const accountId = "11111111-1111-4111-8111-111111111111";
    const output = await client.callTool({
      name: "sync_workspace_source",
      arguments: { accountId },
    });
    expect(output.isError).not.toBe(true);
    expect(output.structuredContent).toEqual({ result: payload });
    expect(output.content).toEqual([{ type: "text", text: JSON.stringify(payload, null, 2) }]);
    expect(fetch.mock.calls[0]?.[0]).toBe(
      `https://api.example.test/v1/connectors/${accountId}/sync`,
    );
    const tools = await client.listTools();
    expect(
      tools.tools.find((tool) => tool.name === "sync_workspace_source")?.description,
    ).toContain("not completion");
  } finally {
    await client.close();
    await server.close();
  }
});
