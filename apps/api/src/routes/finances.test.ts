import { Hono } from "hono";
import type { createFinanceService } from "../finance-service.js";
import type { AppEnv } from "../types.js";
import { registerFinanceRoutes } from "./finances.js";

const id = "11111111-1111-4111-8111-111111111111";

describe("finance routes", () => {
  it("keeps setup and proposals readable while account, budget, and sync administration stay human-only", async () => {
    const app = new Hono<AppEnv>();
    const finances = {
      createAccount: vi.fn(),
      createBudget: vi.fn(),
      deleteAccount: vi.fn(),
      getGuidedSetupContext: vi.fn(async () => ({ ready: true })),
      proposeCategorizations: vi.fn(async () => ({ items: [], nextCursor: null })),
      syncPlaidAccount: vi.fn(),
    };
    app.use("*", async (context, next) => {
      context.set("principal", {
        actorId: id,
        actorType: "agent",
        scopes: new Set(["finances:read", "finances:write"]),
        userId: id,
      });
      context.set("requestId", "request-1");
      await next();
    });
    app.onError((error, context) =>
      context.json({ error: error instanceof Error ? error.message : "unknown" }, 403),
    );
    registerFinanceRoutes({
      app,
      finances: finances as unknown as ReturnType<typeof createFinanceService>,
      mutationContext: (context) => ({
        principal: context.get("principal"),
        requestId: context.get("requestId"),
      }),
    });
    const json = {
      body: "{}",
      headers: { "content-type": "application/json" },
      method: "POST",
    };

    expect((await app.request("/v1/finances/guided-setup")).status).toBe(200);
    expect((await app.request("/v1/finances/categorizations/propose")).status).toBe(200);
    const humanOnlyResponses = await Promise.all([
      app.request("/v1/finances/accounts", json),
      app.request(`/v1/finances/accounts/${id}`, { method: "DELETE" }),
      app.request("/v1/finances/budgets", json),
      app.request(`/v1/finances/accounts/${id}/sync`, json),
    ]);
    for (const response of humanOnlyResponses) {
      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toMatchObject({
        error: expect.stringContaining("interactive user session"),
      });
    }
    expect(finances.getGuidedSetupContext).toHaveBeenCalledWith(id);
    expect(finances.proposeCategorizations).toHaveBeenCalledWith(
      id,
      expect.objectContaining({ limit: 50, review: "all" }),
    );
    expect(finances.createAccount).not.toHaveBeenCalled();
    expect(finances.deleteAccount).not.toHaveBeenCalled();
    expect(finances.createBudget).not.toHaveBeenCalled();
    expect(finances.syncPlaidAccount).not.toHaveBeenCalled();
  });
});
