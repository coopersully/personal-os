import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { McpServer } from "@modelcontextprotocol/server";
import { createApiClient } from "@personal-os/api-client";
import type { AccessScope } from "@personal-os/domain";
import { createIloToolSurface } from "../tool-surface.js";
import { registerFinanceManagementTools } from "./finances-management.js";

const redundantAccountId = "11111111-1111-4111-8111-111111111111";
const keepAccountId = "22222222-2222-4222-8222-222222222222";
const revision = "a".repeat(64);
const previewName = "get_finance_account_duplicate_preview";
const resolveName = "resolve_finance_account_duplicate";
const fullScopes: AccessScope[] = ["finances:read", "finances:write", "finances:execute"];
async function connect(scopes: AccessScope[] = fullScopes, readOnly = false) {
  const fetch = vi.fn<typeof globalThis.fetch>();
  const api = createApiClient({
    baseUrl: "https://api.example.test",
    token: "scoped-token",
    fetch,
  });
  const server = new McpServer({ name: "duplicate-test", version: "1" });
  const surface = createIloToolSurface(server, {
    appBaseUrl: "https://example.test",
    includeCompatibility: false,
    readOnly,
    scopes: new Set(scopes),
  });
  registerFinanceManagementTools(surface, api);
  const client = new Client({ name: "registered-client", version: "1" });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(st), client.connect(ct)]);
  return {
    fetch,
    client,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}

it("forwards exact duplicate comparison and resolution through the typed HTTP client with metadata", async () => {
  const session = await connect();
  const preview = {
    outcome: "completed",
    data: {
      revision,
      keptAccount: { id: keepAccountId, accountMask: "1234" },
      redundantAccount: { id: redundantAccountId },
      overlappingTransactionCount: 4,
      uniqueRedundantTransactionCount: 2,
    },
  };
  const resolved = {
    outcome: "completed",
    data: {
      id: redundantAccountId,
      includeInPlanning: false,
      synchronization: { failureCode: "finance_account_disconnected" },
    },
  };
  try {
    session.fetch.mockResolvedValueOnce(Response.json(preview));
    const comparison = await session.client.callTool({
      name: previewName,
      arguments: { redundantAccountId, keepAccountId },
    });
    expect(comparison.isError).not.toBe(true);
    expect(comparison.structuredContent).toMatchObject({
      result: preview,
      _ilo: { domain: "finances", policy: "preview", readOnly: true, stage: "prepare" },
    });
    expect(comparison.content).toEqual([{ type: "text", text: JSON.stringify(preview, null, 2) }]);
    const input = { keepAccountId, revision, idempotencyKey: "reviewed-duplicate" };
    for (let i = 0; i < 2; i++) {
      session.fetch.mockResolvedValueOnce(Response.json(resolved));
      const result = await session.client.callTool({
        name: resolveName,
        arguments: { redundantAccountId, ...input },
      });
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toMatchObject({
        result: resolved,
        _ilo: { domain: "finances", policy: "approved_rule", readOnly: false, stage: "commit" },
      });
      expect(result.content).toEqual([{ type: "text", text: JSON.stringify(resolved, null, 2) }]);
    }
    expect(session.fetch.mock.calls[0]?.[0]).toBe(
      `https://api.example.test/v1/finances/accounts/${redundantAccountId}/duplicate-preview?keepAccountId=${keepAccountId}`,
    );
    for (const [url, init] of session.fetch.mock.calls.slice(1)) {
      expect(url).toBe(
        `https://api.example.test/v1/finances/accounts/${redundantAccountId}/resolve-duplicate`,
      );
      expect(init).toMatchObject({ method: "POST", body: JSON.stringify(input) });
    }
    for (const [, init] of session.fetch.mock.calls)
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer scoped-token");
  } finally {
    await session.close();
  }
});

it.each([
  403, 409,
])("preserves API authorization and stale revision recovery errors (%s)", async (status) => {
  const session = await connect();
  try {
    const error = {
      code: status === 403 ? "forbidden" : "conflict",
      message: "Review the current account pair",
      details: { recovery: "reload_preview" },
      requestId: "duplicate-error",
    };
    session.fetch.mockResolvedValueOnce(Response.json({ error }, { status }));
    const output = await session.client.callTool({
      name: resolveName,
      arguments: {
        redundantAccountId,
        keepAccountId,
        revision,
        idempotencyKey: "reviewed-duplicate",
      },
    });
    expect(output.isError).toBe(true);
    expect(output.structuredContent).toMatchObject({ error: { ...error, status } });
    const text = output.content
      .filter((item) => item.type === "text")
      .map((item) => item.text)
      .join("\n");
    expect(JSON.parse(text)).toEqual({ error: { ...error, status } });
  } finally {
    await session.close();
  }
});

it("rejects invalid identifiers, missing preview revisions, and missing retry keys before HTTP", async () => {
  const session = await connect();
  try {
    for (const arguments_ of [
      { redundantAccountId: "invalid", keepAccountId, revision, idempotencyKey: "key" },
      { redundantAccountId, keepAccountId, idempotencyKey: "key" },
      { redundantAccountId, keepAccountId, revision },
    ]) {
      expect(
        (await session.client.callTool({ name: resolveName, arguments: arguments_ })).isError,
      ).toBe(true);
    }
    expect(session.fetch).not.toHaveBeenCalled();
  } finally {
    await session.close();
  }
});

it.each([
  { scopes: [], readOnly: false, preview: false, resolve: false },
  { scopes: ["finances:read"], readOnly: false, preview: true, resolve: false },
  { scopes: ["finances:write"], readOnly: false, preview: false, resolve: false },
  {
    scopes: ["finances:write", "finances:execute"],
    readOnly: false,
    preview: false,
    resolve: true,
  },
  { scopes: fullScopes, readOnly: true, preview: true, resolve: false },
  { scopes: fullScopes, readOnly: false, preview: true, resolve: true },
])("keeps discovery least privileged: %j", async ({ scopes, readOnly, preview, resolve }) => {
  const session = await connect(scopes as AccessScope[], readOnly);
  try {
    const { tools } = await session.client.listTools();
    expect(tools.some((tool) => tool.name === previewName)).toBe(preview);
    expect(tools.some((tool) => tool.name === resolveName)).toBe(resolve);
    if (preview)
      expect(tools.find((tool) => tool.name === previewName)?.annotations).toEqual({
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      });
    if (resolve)
      expect(tools.find((tool) => tool.name === resolveName)?.annotations).toEqual({
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      });
    if (!resolve)
      await expect(
        session.client.callTool({
          name: resolveName,
          arguments: { redundantAccountId, keepAccountId, revision, idempotencyKey: "hidden" },
        }),
      ).rejects.toThrow();
    expect(session.fetch).not.toHaveBeenCalled();
  } finally {
    await session.close();
  }
});
