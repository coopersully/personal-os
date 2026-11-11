import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { errorResponse } from "../errors.js";
import type { createNativePushService } from "../native-push-service.js";
import type { AppEnv, Principal } from "../types.js";
import { registerNativePushRoutes } from "./native-push.js";

it("validates device identity and installation-bound private event resolution", async () => {
  const installationId = randomUUID(),
    eventId = randomUUID();
  const principal: Principal = {
    actorType: "user",
    actorId: randomUUID(),
    userId: randomUUID(),
    sessionId: randomUUID(),
    scopes: new Set(),
  };
  const service = {
    register: vi.fn(async () => ({ audience: "private", installationId })),
    disable: vi.fn(async () => ({ disabled: true })),
    resolve: vi.fn(async () => ({ audience: "private", destination: "finance_chat" })),
  };
  const app = new Hono<AppEnv>();
  app.onError(errorResponse);
  app.use("*", async (context, next) => {
    context.set("principal", principal);
    await next();
  });
  registerNativePushRoutes(app, service as unknown as ReturnType<typeof createNativePushService>);
  const body = {
    installationId,
    token: "ab".repeat(32),
    environment: "production",
    financeEnabled: true,
  };
  const register = await app.request(`/v1/native-push/devices/${installationId}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  expect(register.status).toBe(200);
  expect(register.headers.get("cache-control")).toBe("no-store");
  expect(service.register).toHaveBeenCalledWith(principal, body);
  const wrong = await app.request(`/v1/native-push/devices/${randomUUID()}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  expect(wrong.status).toBe(400);
  expect(
    (await app.request(`/v1/native-push/devices/${installationId}`, { method: "DELETE" })).status,
  ).toBe(200);
  expect(service.disable).toHaveBeenCalledWith(principal, installationId);
  expect(
    (await app.request(`/v1/native-push/events/${eventId}?installationId=${installationId}`))
      .status,
  ).toBe(200);
  expect(service.resolve).toHaveBeenCalledWith(principal, eventId, installationId);
  expect((await app.request(`/v1/native-push/events/${eventId}`)).status).toBe(400);
  expect((await app.request("/v1/native-push/events/bad?installationId=bad")).status).toBe(400);
});
