import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { ApiClientError, type PersonalOsApiClient } from "@personal-os/api-client";
import type { AccessScope, AgentAccount } from "@personal-os/domain";
import { createPersonalOsMcpServer } from "../server.js";
import { availableToolNames } from "../tool-catalog.js";

const account: AgentAccount = {
  id: "11111111-1111-4111-8111-111111111111",
  userId: "22222222-2222-4222-8222-222222222222",
  platform: "codex",
  displayName: "Amber Finch 1111",
  accountLabel: null,
  avatarSeed: "11111111-1111-4111-8111-111111111111",
  avatarVersion: 1,
  identitySource: "connection",
  createdAt: "2026-10-24T12:00:00.000Z",
  updatedAt: "2026-10-24T12:00:00.000Z",
};

async function connect(options: { readOnly?: boolean; scopes?: AccessScope[] } = {}) {
  const api = {
    getCurrentAgentAccount: vi.fn<() => Promise<AgentAccount | null>>(async () => account),
    registerCurrentAgentAccount: vi.fn(async () => account),
  };
  const server = createPersonalOsMcpServer({
    api: api as unknown as PersonalOsApiClient,
    readOnly: options.readOnly ?? false,
    scopes: new Set(options.scopes ?? []),
    timeZone: "UTC",
  });
  const client = new Client({ name: "agent-account-test", version: "1" });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(st), client.connect(ct)]);
  return {
    api,
    client,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}

describe("shared agent account MCP tools", () => {
  it.each<AccessScope[]>([
    [],
    ["mail:read"],
    ["finances:maintain"],
    ["tasks:read"],
  ])("exposes own identity with baseline authority (%j)", async (...scopes) => {
    const { client, close } = await connect({ scopes });
    try {
      const { tools } = await client.listTools();
      expect(tools.map((tool) => tool.name).sort()).toEqual(
        availableToolNames(new Set(scopes), false).sort(),
      );
      for (const name of ["get_agent_account", "register_agent_account"]) {
        expect(tools.find((tool) => tool.name === name)).toMatchObject({
          annotations: {
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: false,
            readOnlyHint: name === "get_agent_account",
          },
          inputSchema: { additionalProperties: false },
          outputSchema: { type: "object" },
          _meta: { "ilo/domain": "assistant" },
        });
      }
    } finally {
      await close();
    }
  });

  it("reads null and preserves both connection and user-confirmed identities verbatim", async () => {
    const { api, client, close } = await connect();
    try {
      for (const identity of [
        null,
        account,
        { ...account, identitySource: "user_confirmed" as const },
      ]) {
        api.getCurrentAgentAccount.mockResolvedValueOnce(identity);
        const result = await client.callTool({ name: "get_agent_account", arguments: {} });
        expect(result.isError).not.toBe(true);
        expect(result.structuredContent).toMatchObject({
          result: identity,
          _ilo: { domain: "assistant", policy: "read_only", readOnly: true, stage: "inspect" },
        });
        expect(result.content).toEqual([{ type: "text", text: JSON.stringify(identity, null, 2) }]);
      }
      expect(api.getCurrentAgentAccount).toHaveBeenCalledWith();
      expect(api.registerCurrentAgentAccount).not.toHaveBeenCalled();
    } finally {
      await close();
    }
  });

  it("delegates registration and reuse to the authenticated API with only the optional platform", async () => {
    const { api, client, close } = await connect();
    try {
      for (const input of [
        {},
        { platform: "claude" },
        { platform: "codex" },
        { platform: "other" },
        { platform: "unknown" },
        {},
      ]) {
        const result = await client.callTool({ name: "register_agent_account", arguments: input });
        expect(result.isError).not.toBe(true);
        expect(result.structuredContent).toMatchObject({
          result: account,
          _ilo: { domain: "assistant", readOnly: false, stage: "commit" },
        });
        expect(api.registerCurrentAgentAccount).toHaveBeenLastCalledWith(input);
      }
      expect(api.getCurrentAgentAccount).not.toHaveBeenCalled();
    } finally {
      await close();
    }
  });

  it("rejects account selection, credentials, scope escalation, and unsupported platforms before API calls", async () => {
    const { api, client, close } = await connect();
    try {
      for (const name of ["get_agent_account", "register_agent_account"]) {
        for (const input of [
          { agentAccountId: account.id },
          { accountId: account.id },
          { providerAccountId: "guessed" },
          { token: "credential" },
          { scopes: ["finances:execute"] },
          { platform: "unsupported" },
        ]) {
          expect((await client.callTool({ name, arguments: input })).isError).toBe(true);
        }
      }
      expect(api.getCurrentAgentAccount).not.toHaveBeenCalled();
      expect(api.registerCurrentAgentAccount).not.toHaveBeenCalled();
    } finally {
      await close();
    }
  });

  it("removes registration from discovery and execution on the read-only surface", async () => {
    const { api, client, close } = await connect({ readOnly: true });
    try {
      const names = (await client.listTools()).tools.map((tool) => tool.name);
      expect(names).toContain("get_agent_account");
      expect(names).not.toContain("register_agent_account");
      await expect(
        client.callTool({ name: "register_agent_account", arguments: {} }),
      ).rejects.toThrow("Tool register_agent_account not found");
      expect(api.registerCurrentAgentAccount).not.toHaveBeenCalled();
    } finally {
      await close();
    }
  });

  it.each([
    "get_agent_account",
    "register_agent_account",
  ])("preserves API denial for %s", async (name) => {
    const { api, client, close } = await connect();
    try {
      const error = {
        status: 403,
        code: "forbidden",
        message: "An authenticated agent connection is required.",
        details: { reason: "agent_connection_required" },
        requestId: "agent-account-denied",
      };
      api.getCurrentAgentAccount.mockRejectedValueOnce(new ApiClientError(error));
      api.registerCurrentAgentAccount.mockRejectedValueOnce(new ApiClientError(error));
      const result = await client.callTool({ name, arguments: {} });
      expect(result.isError).toBe(true);
      expect(result.structuredContent).toMatchObject({ error });
    } finally {
      await close();
    }
  });
});
