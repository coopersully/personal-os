import { type AgentAccount, accessScopeSchema } from "@personal-os/domain";
import { Hono } from "hono";
import { createAgentAccountService } from "../agent-account-service.js";
import { AppError, errorResponse } from "../errors.js";
import type { AppEnv, Principal } from "../types.js";
import { registerAgentAccountRoutes } from "./agent-accounts.js";

const id = "11111111-1111-4111-8111-111111111111";
const connectionId = "22222222-2222-4222-8222-222222222222";
const account: AgentAccount = {
  id,
  userId: "33333333-3333-4333-8333-333333333333",
  platform: "codex",
  displayName: "Amber Finch 1111",
  accountLabel: null,
  avatarSeed: id,
  avatarVersion: 1,
  identitySource: "connection",
  createdAt: "2026-10-24T12:00:00.000Z",
  updatedAt: "2026-10-24T12:00:00.000Z",
};
type Accounts = ReturnType<typeof createAgentAccountService>;

function fixture(actorType: Principal["actorType"] = "agent") {
  const principal: Principal = {
    actorId: id,
    actorType,
    userId: account.userId,
    authorizationConnectionId: connectionId,
    scopes: new Set(),
  };
  const accounts = {
    current: vi.fn<Accounts["current"]>(async () => account),
    register: vi.fn<Accounts["register"]>(async () => account),
    list: vi.fn<Accounts["list"]>(async () => ({ accounts: [account], connections: [] })),
    update: vi.fn<Accounts["update"]>(async () => account),
    link: vi.fn<Accounts["link"]>(async () => ({
      ...account,
      identitySource: "user_confirmed",
    })),
  };
  const app = new Hono<AppEnv>();
  app.use("*", async (c, next) => {
    c.set("principal", principal);
    c.set("requestId", "agent-accounts-route-test");
    await next();
  });
  app.onError(errorResponse);
  registerAgentAccountRoutes({ app, accounts });
  return { app, accounts, principal };
}

describe("agent account routes", () => {
  it("lets an agent with no workspace scopes read and register only through its own principal", async () => {
    const { app, accounts, principal } = fixture();
    accounts.current.mockResolvedValueOnce(null);
    const absent = await app.request("/v1/agent-accounts/current");
    expect(absent.status).toBe(200);
    expect(await absent.json()).toBeNull();
    expect(accounts.current).toHaveBeenCalledWith(principal);
    for (const input of [{}, { platform: "codex" }]) {
      const response = await app.request("/v1/agent-accounts/current", {
        method: "POST",
        body: JSON.stringify(input),
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual(account);
      expect(accounts.register).toHaveBeenLastCalledWith(principal, input);
    }
    expect(await (await app.request("/v1/agent-accounts/current")).json()).toEqual(account);
    expect(accounts.list).not.toHaveBeenCalled();
  });

  it("allows a human to read the directory, update an account, and link or unlink a connection", async () => {
    const { app, accounts, principal } = fixture("user");
    const directory = await app.request("/v1/agent-accounts");
    expect(directory.status).toBe(200);
    expect(await directory.json()).toEqual({ accounts: [account], connections: [] });
    expect(accounts.list).toHaveBeenCalledWith(principal);
    const input = { displayName: "Work assistant", accountLabel: null, platform: "claude" };
    const updated = await app.request(`/v1/agent-accounts/${id}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    });
    expect(updated.status).toBe(200);
    expect(await updated.json()).toEqual(account);
    expect(accounts.update).toHaveBeenCalledWith(principal, id, input);
    for (const agentAccountId of [id, null]) {
      const link = { agentAccountId, platform: "codex" };
      const response = await app.request(`/v1/agent-accounts/connections/${connectionId}`, {
        method: "PUT",
        body: JSON.stringify(link),
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ ...account, identitySource: "user_confirmed" });
      expect(accounts.link).toHaveBeenLastCalledWith(principal, connectionId, link);
    }
  });

  it("rejects agents from every human-only route even with every scope", async () => {
    const { app, accounts, principal } = fixture();
    principal.scopes = new Set(accessScopeSchema.options);
    for (const [path, method] of [
      ["/v1/agent-accounts", "GET"],
      [`/v1/agent-accounts/${id}`, "PATCH"],
      [`/v1/agent-accounts/connections/${connectionId}`, "PUT"],
    ] as const) {
      const response = await app.request(path, { method });
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ error: { code: "forbidden" } });
    }
    expect(accounts.list).not.toHaveBeenCalled();
    expect(accounts.update).not.toHaveBeenCalled();
    expect(accounts.link).not.toHaveBeenCalled();
  });

  it.each([
    "user",
    "agent",
  ] as const)("enforces the service's own-connection guard over HTTP for %s", async (actorType) => {
    const { app, accounts, principal } = fixture(actorType);
    if (actorType === "agent") delete principal.authorizationConnectionId;
    // These guards must reject before persistence is touched.
    const db = {} as Parameters<typeof createAgentAccountService>[0]["db"];
    const service = createAgentAccountService({ db });
    accounts.current.mockImplementation(service.current);
    accounts.register.mockImplementation(service.register);
    for (const method of ["GET", "POST"]) {
      const response = await app.request("/v1/agent-accounts/current", {
        method,
        ...(method === "POST" ? { body: "{}" } : {}),
      });
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ error: { code: "forbidden" } });
    }
  });

  it("rejects malformed route IDs and JSON before calling the service", async () => {
    const { app, accounts } = fixture("user");
    for (const [path, method, body] of [
      ["/v1/agent-accounts/not-a-uuid", "PATCH", "{}"],
      ["/v1/agent-accounts/connections/not-a-uuid", "PUT", "{}"],
      [`/v1/agent-accounts/${id}`, "PATCH", "{"],
      [`/v1/agent-accounts/connections/${connectionId}`, "PUT", "{"],
      ["/v1/agent-accounts/current", "POST", "{"],
    ] as const) {
      expect((await app.request(path, { method, body })).status).toBe(400);
    }
    expect(accounts.update).not.toHaveBeenCalled();
    expect(accounts.link).not.toHaveBeenCalled();
    expect(accounts.register).not.toHaveBeenCalled();
  });

  it("preserves owner-service errors through the HTTP error contract", async () => {
    const { app, accounts } = fixture("user");
    accounts.link.mockRejectedValueOnce(new AppError("not_found", "Connection not found."));
    const response = await app.request(`/v1/agent-accounts/connections/${connectionId}`, {
      method: "PUT",
      body: JSON.stringify({ agentAccountId: id }),
    });
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({
      error: { code: "not_found", message: "Connection not found." },
    });
  });
});
