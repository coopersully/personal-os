import { defaultNotificationPreferences } from "@personal-os/domain";
import { Hono } from "hono";
import { errorResponse } from "../errors.js";
import type { createNotificationService } from "../notification-service.js";
import type { AppEnv, Principal } from "../types.js";
import { registerNotificationRoutes } from "./notifications.js";

it("maps bounded notification operations and rejects authority and input expansion", async () => {
  const principal: Principal = {
    userId: "11111111-1111-4111-8111-111111111111",
    actorId: "human",
    actorType: "user",
    scopes: new Set(["texting:read", "texting:write", "finances:read"]),
  };
  const status = { capability: "unavailable", reason: "producer_not_registered" };
  const notifications = {
    status: vi.fn(async () => status),
    savePreferences: vi.fn(async () => ({})),
    publish: vi.fn(async () => status),
    drain: vi.fn(async () => status),
  } as unknown as ReturnType<typeof createNotificationService>;
  const app = new Hono<AppEnv>();
  app.onError(errorResponse);
  app.use("*", async (context, next) => {
    context.set("principal", principal);
    context.set("requestId", "test");
    await next();
  });
  registerNotificationRoutes({ app, notifications });
  const json = (method: string, body: unknown) => ({
    method,
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
  expect(await (await app.request("/v1/texting/notifications")).json()).toEqual(status);
  const input = { expectedRevision: null, preferences: defaultNotificationPreferences };
  expect(
    (await app.request("/v1/texting/notifications/preferences/global", json("PATCH", input)))
      .status,
  ).toBe(200);
  expect(notifications.savePreferences).toHaveBeenCalledWith(principal, "global", input);
  expect(
    (await app.request("/v1/texting/notifications/preferences/foreign", json("PATCH", input)))
      .status,
  ).toBe(400);
  for (const path of ["intents", "drain"]) {
    expect((await app.request(`/v1/texting/notifications/${path}`, json("POST", {}))).status).toBe(
      404,
    );
  }
  expect(notifications.publish).not.toHaveBeenCalled();
  expect(notifications.drain).not.toHaveBeenCalled();
  principal.actorType = "agent";
  expect(
    (await app.request("/v1/texting/notifications/preferences/global", json("PATCH", input)))
      .status,
  ).toBe(403);
  principal.scopes = new Set(["texting:read", "texting:write"]);
  expect((await app.request("/v1/texting/notifications")).status).toBe(403);
  principal.scopes = new Set(["texting:read", "finances:read"]);
  expect(
    (await app.request("/v1/texting/notifications/preferences/global", json("PATCH", input)))
      .status,
  ).toBe(403);
});
