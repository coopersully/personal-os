import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { McpServer } from "@modelcontextprotocol/server";
import { createApiClient } from "@personal-os/api-client";
import { canDiscoverTool, personalOsToolCatalog } from "../tool-catalog.js";
import { registerWorkspaceNotificationTools } from "./workspace-notifications.js";

it("requires both scopes and exposes exact inspection through the public API without a sender or status fallback", async () => {
  const definition = personalOsToolCatalog.get_notification_attempt;
  expect(definition.requiredScopes).toEqual(["texting:read", "finances:read"]);
  expect(definition.readOnly).toBe(true);
  expect(canDiscoverTool(definition, new Set(["texting:read"]), true)).toBe(false);
  expect(canDiscoverTool(definition, new Set(["finances:read"]), true)).toBe(false);
  expect(canDiscoverTool(definition, new Set(["texting:read", "finances:read"]), true)).toBe(true);
  const payload = {
    id: "11111111-1111-4111-8111-111111111111",
    recovery: "inspect_delivery_do_not_resend",
  };
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(Response.json(payload));
  const api = createApiClient({
    baseUrl: "https://api.example.test",
    token: "inspection-token",
    fetch,
  });
  const server = new McpServer({ name: "notification-read", version: "1" });
  registerWorkspaceNotificationTools(server, api);
  const client = new Client({ name: "notification-reader", version: "1" });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(st), client.connect(ct)]);
  try {
    const result = await client.callTool({
      name: "get_notification_attempt",
      arguments: { attemptId: payload.id },
    });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toEqual({ result: payload });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]?.[0]).toBe(
      `https://api.example.test/v1/texting/notifications/attempts/${payload.id}`,
    );
    const denied = await client.callTool({
      name: "get_notification_attempt",
      arguments: { attemptId: payload.id, ownerId: "foreign" },
    });
    expect(denied.isError).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
  } finally {
    await client.close();
    await server.close();
  }
});
