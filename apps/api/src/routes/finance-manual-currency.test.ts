import type { CreateFinanceAccountInput } from "@personal-os/domain";
import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { errorResponse } from "../errors.js";
import type { FinanceMaintenanceService } from "../finance-maintenance-service.js";
import type { createFinanceService } from "../finance-service.js";
import type { FinanceStatusService } from "../finance-status-service.js";
import type { AppEnv } from "../types.js";
import { registerFinanceRoutes } from "./finances.js";

const owner = "11111111-1111-4111-8111-111111111111";
function fixture() {
  const app = new Hono<AppEnv>();
  app.use("*", async (c, next) => {
    c.set("principal", {
      actorId: owner,
      userId: owner,
      actorType: "user",
      scopes: new Set(["finances:write"]),
    });
    c.set("requestId", "manual-currency");
    await next();
  });
  app.onError(errorResponse);
  const createAccount = vi.fn(async (input: CreateFinanceAccountInput) => ({
    ...input,
    id: owner,
    currencyCode: input.currencyCode ?? null,
  }));
  registerFinanceRoutes({
    app,
    finances: { createAccount } as unknown as ReturnType<typeof createFinanceService>,
    financeMaintenance: {} as FinanceMaintenanceService,
    financeStatus: {} as FinanceStatusService,
    mutationContext: (c) => ({ principal: c.get("principal"), requestId: c.get("requestId") }),
  });
  return { app, createAccount };
}
describe("manual account currency HTTP boundary", () => {
  it.each([
    "USD",
    "EUR",
    null,
    undefined,
  ])("passes explicit %s and unknown unchanged to canonical writer", async (currencyCode) => {
    const { app, createAccount } = fixture();
    const response = await app.request("/v1/finances/accounts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Travel cash",
        institution: "Personal records",
        ...(currencyCode === undefined ? {} : { currencyCode }),
      }),
    });
    expect(response.status).toBe(201);
    expect((await response.json()).account.currencyCode).toBe(currencyCode ?? null);
    expect(createAccount.mock.calls[0]?.[0].currencyCode ?? null).toBe(currencyCode ?? null);
  });
  it.each([
    "usd",
    "US",
    "$",
  ])("rejects malformed %s before canonical writer", async (currencyCode) => {
    const { app, createAccount } = fixture();
    const response = await app.request("/v1/finances/accounts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Travel cash", institution: "Personal records", currencyCode }),
    });
    expect(response.status).toBe(400);
    expect(createAccount).not.toHaveBeenCalled();
  });
});
