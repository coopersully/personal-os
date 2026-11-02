import { createApiClient } from "../client.js";

function fixture() {
  const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async () => Response.json({}));
  const api = createApiClient({
    baseUrl: "https://example.test",
    token: "test-agent-token",
    fetch,
  });
  return { api, fetch };
}

describe("agent account API client", () => {
  it("reads the directory and nullable own identity using authenticated GET requests", async () => {
    const { api, fetch } = fixture();
    const directory = { accounts: [], connections: [] };
    fetch
      .mockResolvedValueOnce(Response.json(directory))
      .mockResolvedValueOnce(Response.json(null));
    expect(await api.listAgentAccounts()).toEqual(directory);
    expect(await api.getCurrentAgentAccount()).toBeNull();
    for (const [index, path] of ["/v1/agent-accounts", "/v1/agent-accounts/current"].entries()) {
      expect(fetch.mock.calls[index]?.[0]).toBe(`https://example.test${path}`);
      const init = fetch.mock.calls[index]?.[1];
      expect(init?.method ?? "GET").toBe("GET");
      expect(init?.body).toBeUndefined();
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer test-agent-token");
    }
  });

  it("POSTs registration with an empty default or only the declared platform", async () => {
    const { api, fetch } = fixture();
    await api.registerCurrentAgentAccount();
    await api.registerCurrentAgentAccount({ platform: "codex" });
    for (const [index, input] of [{}, { platform: "codex" }].entries()) {
      expect(fetch.mock.calls[index]?.[0]).toBe("https://example.test/v1/agent-accounts/current");
      expect(fetch.mock.calls[index]?.[1]).toMatchObject({
        method: "POST",
        body: JSON.stringify(input),
      });
    }
  });

  it("encodes account and connection IDs as path segments and preserves PATCH/PUT bodies", async () => {
    const { api, fetch } = fixture();
    const id = "account/with ?#%";
    const update = {
      displayName: "Work assistant",
      accountLabel: null,
      platform: "claude" as const,
    };
    await api.updateAgentAccount(id, update);
    expect(fetch.mock.calls[0]?.[0]).toBe(
      "https://example.test/v1/agent-accounts/account%2Fwith%20%3F%23%25",
    );
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({
      method: "PATCH",
      body: JSON.stringify(update),
    });
    for (const agentAccountId of ["target-account", null]) {
      const input = { agentAccountId, platform: "other" as const };
      await api.linkAgentAccountConnection(id, input);
      expect(fetch.mock.lastCall?.[0]).toBe(
        "https://example.test/v1/agent-accounts/connections/account%2Fwith%20%3F%23%25",
      );
      expect(fetch.mock.lastCall?.[1]).toMatchObject({
        method: "PUT",
        body: JSON.stringify(input),
      });
    }
  });

  it("returns the server identity unchanged and preserves authorization failures", async () => {
    const { api, fetch } = fixture();
    const identity = {
      id: "server-owned",
      identitySource: "user_confirmed",
      avatarSeed: "stable-seed",
    };
    fetch.mockResolvedValueOnce(Response.json(identity));
    expect(await api.registerCurrentAgentAccount()).toEqual(identity);
    fetch.mockResolvedValueOnce(
      Response.json(
        { error: { code: "forbidden", message: "Human access required." } },
        { status: 403 },
      ),
    );
    await expect(
      api.linkAgentAccountConnection("connection", { agentAccountId: "account" }),
    ).rejects.toMatchObject({ status: 403, code: "forbidden", message: "Human access required." });
  });
});
