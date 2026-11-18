import type { AccessScope } from "@personal-os/domain";
import { Hono } from "hono";
import { errorResponse } from "../errors.js";
import type { AppEnv } from "../types.js";
import { registerFinanceBaselineQualificationRoutes } from "./finance-baseline-qualification.js";

it("uses the authenticated owner for reads and rejects preparation without write scope", async () => {
  const userId = crypto.randomUUID();
  const scopes = new Set<AccessScope>(["finances:read"]);
  const getQualification = vi.fn(async () => ({
    state: "unavailable",
    reason: "qualification_required",
    qualificationRequired: true,
    candidates: [],
  }));
  const prepare = vi.fn();
  const app = new Hono<AppEnv>();
  app.onError(errorResponse);
  app.use("*", async (c, next) => {
    c.set("principal", { actorType: "user", actorId: userId, userId, scopes });
    c.set("requestId", "qualification-route");
    await next();
  });
  registerFinanceBaselineQualificationRoutes({
    app,
    service: { getQualification, prepare } as never,
    financeContext: vi.fn() as never,
  });
  const response = await app.request("/v1/finances/budget-baselines/qualification?month=2026-09");
  expect(response.status).toBe(200);
  expect(getQualification).toHaveBeenCalledWith(userId, "2026-09");
  expect(response.headers.get("cache-control")).toBe("no-store");
  const rejected = await app.request("/v1/finances/budget-baselines/qualification/prepare", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  expect(rejected.status).toBe(403);
  expect(prepare).not.toHaveBeenCalled();
});
