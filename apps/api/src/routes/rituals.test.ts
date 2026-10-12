import { Hono } from "hono";
import { AppError } from "../errors.js";
import type { createRitualService } from "../ritual-service.js";
import type { AppEnv, Principal } from "../types.js";
import { registerRitualRoutes } from "./rituals.js";

it("requires explicit read grants and interactive write approval", async () => {
  let principal: Principal = {
    userId: crypto.randomUUID(),
    actorId: "test",
    actorType: "agent",
    scopes: new Set(),
  };
  const current = vi.fn().mockResolvedValue({ current: null });
  const app = new Hono<AppEnv>();
  app.use("*", async (c, next) => {
    c.set("principal", principal);
    await next();
  });
  app.onError((e, c) => c.json({ error: e.message }, e instanceof AppError ? e.status : 500));
  registerRitualRoutes({
    app,
    rituals: { current } as unknown as ReturnType<typeof createRitualService>,
    mutationContext: () => ({ principal, requestId: "test" }),
  });
  expect((await app.request("/v1/rituals/current")).status).toBe(403);
  principal = { ...principal, scopes: new Set(["tracking:write"]) };
  expect((await app.request("/v1/rituals/current")).status).toBe(403);
  principal = { ...principal, scopes: new Set(["tracking:read", "tracking:write"]) };
  expect((await app.request("/v1/rituals/current")).status).toBe(200);
  expect((await app.request("/v1/rituals/morning", { method: "PUT", body: "{}" })).status).toBe(
    403,
  );
  expect((await app.request("/v1/rituals/export")).status).toBe(403);
  principal = { ...principal, actorType: "user", scopes: new Set(["tracking:read"]) };
  expect((await app.request("/v1/rituals/morning", { method: "PUT", body: "{}" })).status).toBe(
    403,
  );
});
