import { Hono } from "hono";
import type { createAutomationHostService } from "../automation-host-service.js";
import { errorResponse } from "../errors.js";
import type { AppEnv, Principal } from "../types.js";
import { registerAutomationHostRoutes } from "./automation-hosts.js";

const id = "11111111-1111-4111-8111-111111111111";
function fixture(scopes: Principal["scopes"]) {
  const app = new Hono<AppEnv>();
  const methods = [
    "list",
    "connections",
    "pendingAnswers",
    "bindAnswer",
    "create",
    "bind",
    "observe",
    "revoke",
    "update",
    "cancel",
    "saveFireToken",
    "continuations",
  ] as const;
  const hosts = Object.fromEntries(
    methods.map((name) => [name, vi.fn(async () => ({ ok: true }))]),
  ) as unknown as ReturnType<typeof createAutomationHostService>;
  app.use("*", async (c, next) => {
    c.set("principal", { userId: id, actorId: id, actorType: "agent", scopes });
    await next();
  });
  app.onError((error, c) => errorResponse(error, c));
  registerAutomationHostRoutes({ app, hosts });
  return { app, hosts };
}
it("allows a narrow maintenance grant only to read its continuations and report host observations", async () => {
  const { app, hosts } = fixture(new Set(["finances:maintain"]));
  expect((await app.request(`/v1/automation-hosts/${id}/continuations`)).status).toBe(200);
  expect(
    (
      await app.request(`/v1/automation-hosts/${id}/observe`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      })
    ).status,
  ).toBe(200);
  for (const path of ["", "/answers", "/connections"])
    expect((await app.request(`/v1/automation-hosts${path}`)).status).toBe(403);
  expect(
    (await app.request(`/v1/automation-hosts/${id}/bind`, { method: "POST", body: "{}" })).status,
  ).toBe(403);
  expect(hosts.bind).not.toHaveBeenCalled();
});
it("rejects malformed identifiers and JSON before host mutation and forwards explicit setup commands", async () => {
  const { app, hosts } = fixture(new Set(["finances:read", "finances:write"]));
  expect(
    (await app.request("/v1/automation-hosts/bad/cancel", { method: "POST", body: "{}" })).status,
  ).toBe(400);
  expect((await app.request("/v1/automation-hosts", { method: "POST", body: "{" })).status).toBe(
    400,
  );
  expect(hosts.cancel).not.toHaveBeenCalled();
  expect(hosts.create).not.toHaveBeenCalled();
  const input = { expectedVersion: 2, expectedState: "setup_pending" };
  expect(
    (
      await app.request(`/v1/automation-hosts/${id}/cancel`, {
        method: "POST",
        body: JSON.stringify(input),
      })
    ).status,
  ).toBe(200);
  expect(hosts.cancel).toHaveBeenCalledWith(expect.objectContaining({ userId: id }), id, input);
  expect(
    (await app.request(`/v1/automation-hosts/${id}/observe`, { method: "POST", body: "{}" }))
      .status,
  ).toBe(403);
});

it("passes validated continuation cursors and rejects malformed cursor reads before invoking the owner service", async () => {
  const { app, hosts } = fixture(new Set(["finances:read", "finances:write", "finances:maintain"]));
  expect((await app.request(`/v1/automation-hosts/${id}/continuations?cursor=${id}`)).status).toBe(
    200,
  );
  expect(hosts.continuations).toHaveBeenCalledWith(expect.any(Object), id, id);
  expect((await app.request(`/v1/automation-hosts/answers?cursor=${id}`)).status).toBe(200);
  expect(hosts.pendingAnswers).toHaveBeenCalledWith(expect.any(Object), id);
  expect((await app.request(`/v1/automation-hosts/answers?cursor=invalid`)).status).toBe(400);
  expect(hosts.pendingAnswers).toHaveBeenCalledTimes(1);
  expect(
    (await app.request(`/v1/automation-hosts/${id}/continuations?cursor=invalid`)).status,
  ).toBe(400);
  expect(hosts.continuations).toHaveBeenCalledTimes(1);
});
