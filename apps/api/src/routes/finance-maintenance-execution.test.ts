import { Hono } from "hono";
import { errorResponse } from "../errors.js";
import type { AppEnv, Principal } from "../types.js";
import { registerFinanceMaintenanceExecutionRoutes } from "./finance-maintenance-execution.js";

it("rejects query/body authority injection before delegating with the actual principal", async () => {
  const app = new Hono<AppEnv>();
  const id = "11111111-1111-4111-8111-111111111111";
  let principal: Principal = {
    userId: id,
    actorId: id,
    actorType: "agent",
    scopes: new Set(["finances:maintain"]),
  };
  const execution = {
    readMaintenanceExecutionAuthorization: vi.fn(async () => ({
      state: "unavailable" as const,
      reason: "binding_unavailable" as const,
    })),
    refreshMaintenanceExecutionAuthorization: vi.fn(async () => ({
      state: "pending" as const,
      operationId: id,
      reason: "active_claim" as const,
      retryAt: null,
    })),
  };
  app.use("*", async (c, next) => {
    c.set("principal", principal);
    c.set("requestId", "execution-test");
    await next();
  });
  app.onError(errorResponse);
  registerFinanceMaintenanceExecutionRoutes({ app, execution });
  const root = `/v1/finances/maintenance/runs/${id}/execution-authorization`;
  const response = await app.request(root);
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(execution.readMaintenanceExecutionAuthorization).toHaveBeenCalledWith(principal, id);
  expect((await app.request(`${root}?ownerId=${id}`)).status).toBe(400);
  const input = {
    operationId: id,
    candidateId: id,
    candidateRevision: `sha256:${"a".repeat(64)}`,
    expectedCurrentActorId: id,
    expectedBindingRevision: "1",
    expectedRunUpdatedAt: "2026-10-18T00:00:00.000Z",
  };
  const post = (body: unknown) =>
    app.request(`${root}/refresh`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  expect((await post({ ...input, currentActorId: id })).status).toBe(400);
  expect(execution.refreshMaintenanceExecutionAuthorization).not.toHaveBeenCalled();
  expect((await post(input)).status).toBe(200);
  expect(execution.refreshMaintenanceExecutionAuthorization).toHaveBeenCalledWith(
    principal,
    id,
    input,
  );
  principal = { ...principal, scopes: new Set() };
  expect((await app.request(root)).status).toBe(403);
  expect(execution.readMaintenanceExecutionAuthorization).toHaveBeenCalledTimes(1);
});
