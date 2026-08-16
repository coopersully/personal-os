import { Hono } from "hono";
import type { FinanceMaintenanceService } from "../finance-maintenance-service.js";
import type { createFinanceService } from "../finance-service.js";
import type { FinanceStatusService } from "../finance-status-service.js";
import type { AppEnv } from "../types.js";
import { registerFinanceRoutes } from "./finances.js";

const id = "11111111-1111-4111-8111-111111111111";

describe("finance routes", () => {
  it("returns read-only Finance status for a parsed maintenance scope", async () => {
    const app = new Hono<AppEnv>();
    const getFinanceStatus = vi.fn(async () => ({ domain: "finances" }));
    app.use("*", async (context, next) => {
      context.set("principal", {
        actorId: id,
        actorType: "agent",
        scopes: new Set(["finances:read"]),
        userId: id,
      });
      context.set("requestId", "request-status");
      await next();
    });
    registerFinanceRoutes({
      app,
      financeMaintenance: {} as FinanceMaintenanceService,
      financeStatus: { getFinanceStatus } as unknown as FinanceStatusService,
      finances: {} as ReturnType<typeof createFinanceService>,
      mutationContext: (context) => ({
        principal: context.get("principal"),
        requestId: context.get("requestId"),
      }),
    });

    const response = await app.request("/v1/finances/status?start=2026-08-01&end=2026-08-15");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: { domain: "finances" } });
    expect(getFinanceStatus).toHaveBeenCalledWith(id, {
      type: "window",
      start: "2026-08-01",
      end: "2026-08-15",
    });
  });

  it("keeps setup and owned attention agent-accessible while consequential Finance mutations stay human-only", async () => {
    const app = new Hono<AppEnv>();
    const finances = {
      createAccount: vi.fn(),
      createBudget: vi.fn(),
      createTransaction: vi.fn(),
      deleteAccount: vi.fn(),
      getGuidedSetupContext: vi.fn(async () => ({ ready: true })),
      mergeMerchants: vi.fn(),
      proposeCategorizations: vi.fn(async () => ({ items: [], nextCursor: null })),
      resolveAlert: vi.fn(),
      resolveReview: vi.fn(),
      syncPlaidAccount: vi.fn(),
      updateMerchant: vi.fn(),
      updateRecurringObligation: vi.fn(),
      upsertAttentionItem: vi.fn(async () => ({ id })),
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
      financeMaintenance: {} as FinanceMaintenanceService,
      financeStatus: { getFinanceStatus: vi.fn() } as unknown as FinanceStatusService,
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
    expect(
      (
        await app.request(`/v1/finances/transactions/${id}/attention`, {
          body: JSON.stringify({
            summary: "Review this transaction.",
            title: "Finance review",
          }),
          headers: { "content-type": "application/json" },
          method: "PUT",
        })
      ).status,
    ).toBe(200);
    const humanOnlyResponses = await Promise.all([
      app.request("/v1/finances/accounts", json),
      app.request(`/v1/finances/accounts/${id}`, { method: "DELETE" }),
      app.request("/v1/finances/budgets", json),
      app.request(`/v1/finances/accounts/${id}/sync`, json),
      app.request(`/v1/finances/recurring/${id}`, { ...json, method: "PATCH" }),
      app.request(`/v1/finances/alerts/${id}`, json),
      app.request(`/v1/finances/merchants/${id}`, { ...json, method: "PATCH" }),
      app.request("/v1/finances/merchants/merge", json),
      app.request("/v1/finances/categorizations/apply", json),
      app.request(`/v1/finances/review/${id}`, json),
      app.request("/v1/finances/transactions", json),
      app.request(`/v1/finances/transactions/${id}`, { ...json, method: "PATCH" }),
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
    expect(finances.upsertAttentionItem).toHaveBeenCalledWith(
      id,
      expect.objectContaining({ importance: "high", kind: "important" }),
      expect.objectContaining({ requestId: "request-1" }),
    );
    expect(finances.createAccount).not.toHaveBeenCalled();
    expect(finances.deleteAccount).not.toHaveBeenCalled();
    expect(finances.createBudget).not.toHaveBeenCalled();
    expect(finances.syncPlaidAccount).not.toHaveBeenCalled();
    expect(finances.updateRecurringObligation).not.toHaveBeenCalled();
    expect(finances.resolveAlert).not.toHaveBeenCalled();
    expect(finances.updateMerchant).not.toHaveBeenCalled();
    expect(finances.mergeMerchants).not.toHaveBeenCalled();
    expect(finances.resolveReview).not.toHaveBeenCalled();
    expect(finances.createTransaction).not.toHaveBeenCalled();
  });

  it("keeps POST proposal compatibility on the Finance read scope", async () => {
    const app = new Hono<AppEnv>();
    const finances = {
      listTransactions: vi.fn(async () => ({ items: [], nextCursor: null })),
      proposeCategorizations: vi.fn(async () => ({ items: [], nextCursor: "opaque-next" })),
    };
    app.use("*", async (context, next) => {
      context.set("principal", {
        actorId: id,
        actorType: "agent",
        scopes: new Set(["finances:read"]),
        userId: id,
      });
      context.set("requestId", "request-read-only");
      await next();
    });
    registerFinanceRoutes({
      app,
      financeMaintenance: {} as FinanceMaintenanceService,
      financeStatus: { getFinanceStatus: vi.fn() } as unknown as FinanceStatusService,
      finances: finances as unknown as ReturnType<typeof createFinanceService>,
      mutationContext: (context) => ({
        principal: context.get("principal"),
        requestId: context.get("requestId"),
      }),
    });

    const response = await app.request("/v1/finances/categorizations/propose?cursor=opaque", {
      method: "POST",
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      nextCursor: "opaque-next",
      proposals: [],
    });
    expect(finances.proposeCategorizations).toHaveBeenCalledWith(
      id,
      expect.objectContaining({ cursor: "opaque" }),
    );
    expect((await app.request("/v1/finances/transactions?pending=false")).status).toBe(200);
    expect(finances.listTransactions).toHaveBeenCalledWith(
      id,
      expect.objectContaining({ pending: false }),
    );
    expect((await app.request("/v1/finances/categorizations/propose")).status).toBe(200);
    expect(finances.proposeCategorizations).toHaveBeenLastCalledWith(
      id,
      expect.objectContaining({ limit: 50, review: "all" }),
    );
  });

  it("allows a scoped agent to start and read its durable Finance maintenance run", async () => {
    const app = new Hono<AppEnv>();
    const run = { id, scope: { type: "all_outstanding" }, status: "queued", userId: id };
    const financeMaintenance = {
      dispatchRun: vi.fn(async () => ({ ...run, status: "completed" })),
      getRun: vi.fn(async () => ({ ...run, status: "completed" })),
      startOrResume: vi.fn(async () => run),
    };
    app.use("*", async (context, next) => {
      context.set("principal", {
        actorId: id,
        actorType: "agent",
        scopes: new Set(["finances:read", "finances:write"]),
        userId: id,
      });
      context.set("requestId", "request-maintenance");
      await next();
    });
    registerFinanceRoutes({
      app,
      financeMaintenance: financeMaintenance as unknown as FinanceMaintenanceService,
      financeStatus: { getFinanceStatus: vi.fn() } as unknown as FinanceStatusService,
      finances: {} as ReturnType<typeof createFinanceService>,
      mutationContext: (context) => ({
        principal: context.get("principal"),
        requestId: context.get("requestId"),
      }),
    });

    const started = await app.request("/v1/finances/maintenance", { method: "POST" });
    expect(started.status).toBe(202);
    await expect(started.json()).resolves.toEqual({ run });
    expect(financeMaintenance.startOrResume).toHaveBeenCalledWith(id, {
      type: "all_outstanding",
    });
    expect(financeMaintenance.dispatchRun).not.toHaveBeenCalled();

    const read = await app.request(`/v1/finances/maintenance/${id}`);
    expect(read.status).toBe(200);
    await expect(read.json()).resolves.toEqual({ run: { ...run, status: "completed" } });
    expect(financeMaintenance.getRun).toHaveBeenCalledWith(id, id);
  });
});
