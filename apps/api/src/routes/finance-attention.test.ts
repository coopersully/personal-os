import type { AccessScope } from "@personal-os/domain";
import { Hono } from "hono";
import { errorResponse } from "../errors.js";
import type { AppEnv } from "../types.js";
import { registerFinanceAttentionRoutes } from "./finance-attention.js";

const id = "10000000-0000-4000-8000-000000000001";
function setup(scopes: AccessScope[] = ["finances:read", "finances:write", "finances:maintain"]) {
  const app = new Hono<AppEnv>();
  const principal = {
    actorId: id,
    actorType: "user" as const,
    userId: id,
    scopes: new Set(scopes),
  };
  app.use("*", async (c, next) => {
    c.set("principal", principal);
    c.set("requestId", "attention-test");
    await next();
  });
  app.onError(errorResponse);
  const attention = {
    getAttentionSnapshot: vi.fn(async () => ({ complete: true })),
    getBudgetStart: vi.fn(async () => null),
    previewBudgetStart: vi.fn(async () => ({ id })),
    getBudgetStartPreview: vi.fn(async () => ({ id })),
    applyBudgetStart: vi.fn(async () => ({ revision: 1 })),
  };
  const opening = {
    readOpeningPosition: vi.fn(async () => ({ qualified: false })),
    confirmOpeningStatement: vi.fn(async () => ({ id })),
  };
  const refresh = {
    prepareEvidenceRefresh: vi.fn(async () => ({ id, status: "accepted" })),
    getEvidenceRefresh: vi.fn(async () => ({ id, status: "blocked" })),
  };
  registerFinanceAttentionRoutes({
    app,
    attention: attention as never,
    opening: opening as never,
    refresh: refresh as never,
  });
  return { app, attention, opening, refresh, principal };
}
describe("Finance attention API", () => {
  it("reads the canonical projection with private cache policy", async () => {
    const f = setup(["finances:read"]);
    const r = await f.app.request("/v1/finances/attention");
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(f.attention.getAttentionSnapshot).toHaveBeenCalledWith(id);
    expect((await f.app.request("/v1/finances/opening-position?month=2026-11")).status).toBe(200);
    expect(f.opening.readOpeningPosition).toHaveBeenCalledWith(id, "2026-11");
  });
  it("denies missing scopes and malformed months before reaching a service", async () => {
    expect((await setup([]).app.request("/v1/finances/attention")).status).toBe(403);
    const f = setup();
    expect((await f.app.request("/v1/finances/opening-position?month=2026-99")).status).toBe(400);
    expect(f.opening.readOpeningPosition).not.toHaveBeenCalled();
  });
  it("requires maintain and write for durable source refresh", async () => {
    const input = {
      sourceRefs: [{ accountId: id, expectedAccountRevision: "1" }],
      period: "2026-11",
      idempotencyKey: "request",
    };
    for (const scopes of [
      ["finances:read"],
      ["finances:read", "finances:write"],
    ] as AccessScope[][]) {
      const f = setup(scopes);
      expect(
        (
          await f.app.request("/v1/finances/evidence-refresh", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(input),
          })
        ).status,
      ).toBe(403);
      expect(f.refresh.prepareEvidenceRefresh).not.toHaveBeenCalled();
    }
    const f = setup();
    expect(
      (
        await f.app.request("/v1/finances/evidence-refresh", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        })
      ).status,
    ).toBe(202);
    expect(f.refresh.prepareEvidenceRefresh).toHaveBeenCalledWith(
      { principal: f.principal, requestId: "attention-test" },
      input,
    );
  });
});
