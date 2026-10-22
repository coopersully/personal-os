import { Hono } from "hono";
import { errorResponse } from "../errors.js";
import type { AppEnv, Principal } from "../types.js";
import { registerActiveReminderRoutes } from "./active-reminders.js";

it("admits user sessions, validates bodies and rejects agents before reading private candidates", async () => {
  let principal: Principal = {
    actorId: "11111111-1111-4111-8111-111111111111",
    userId: "11111111-1111-4111-8111-111111111111",
    actorType: "user",
    scopes: new Set(),
  };
  const preferences = { defaultActiveReminder: false, revision: 0 };
  const service = {
    getPreferences: vi.fn(async () => preferences),
    savePreferences: vi.fn(async () => ({ defaultActiveReminder: true, revision: 1 })),
    listCandidates: vi.fn(async () => ({
      generatedAt: "2026-10-22T12:00:00Z",
      items: [],
      nextCursor: null,
    })),
  };
  const app = new Hono<AppEnv>();
  app.onError(errorResponse);
  app.use("*", async (c, next) => {
    c.set("principal", principal);
    c.set("requestId", "test");
    await next();
  });
  registerActiveReminderRoutes({ app, activeReminders: service });
  expect((await app.request("/v1/active-reminders/preferences")).status).toBe(200);
  expect((await app.request("/v1/desktop/active-reminders?limit=101")).status).toBe(400);
  expect((await app.request("/v1/desktop/active-reminders?limit=100")).status).toBe(200);
  const patch = (body: unknown) => ({
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  expect(
    (
      await app.request(
        "/v1/active-reminders/preferences",
        patch({ defaultActiveReminder: true, expectedRevision: 0 }),
      )
    ).status,
  ).toBe(200);
  expect(service.savePreferences).toHaveBeenCalledWith(
    principal.userId,
    { defaultActiveReminder: true, expectedRevision: 0 },
    { principal, requestId: "test" },
  );
  expect(
    (await app.request("/v1/active-reminders/preferences", patch({ defaultActiveReminder: true })))
      .status,
  ).toBe(400);
  principal = { ...principal, actorType: "agent" };
  service.getPreferences.mockClear();
  service.listCandidates.mockClear();
  expect((await app.request("/v1/active-reminders/preferences")).status).toBe(403);
  expect((await app.request("/v1/desktop/active-reminders")).status).toBe(403);
  expect(service.getPreferences).not.toHaveBeenCalled();
  expect(service.listCandidates).not.toHaveBeenCalled();
});
