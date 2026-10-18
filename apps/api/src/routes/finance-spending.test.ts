import type { AccessScope } from "@personal-os/domain";
import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { errorResponse } from "../errors.js";
import type { AppEnv } from "../types.js";
import { registerFinanceSpendingRoute } from "./finance-spending.js";

function setup() {
  const app = new Hono<AppEnv>();
  let scopes = new Set<AccessScope>(["finances:read"]);
  const readSpending = vi.fn(async () => ({ schemaVersion: 1 }));
  app.use("*", async (c, next) => {
    c.set("principal", { actorId: "owner", actorType: "user", userId: "owner", scopes });
    await next();
  });
  app.onError(errorResponse);
  registerFinanceSpendingRoute({ app, spending: { readSpending } as never });
  return {
    app,
    readSpending,
    deny: () => {
      scopes = new Set();
    },
  };
}
const url = "/v1/finances/spending?from=2026-03-07&through=2026-03-09&timezone=America%2FNew_York";
describe("Spending read route", () => {
  it("uses only authenticated owner, preserves all/no/uncategorized filters, never caches", async () => {
    const { app, readSpending } = setup();
    const response = await app.request(
      `${url}&userId=foreign&accountIdsSelection=none&categoryIdsSelection=selected&categoryIds=uncategorized`,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(readSpending).toHaveBeenCalledWith(
      "owner",
      expect.objectContaining({
        scope: expect.objectContaining({ accountIds: [], categoryIds: [null] }),
      }),
    );
    await app.request(url);
    expect(readSpending).toHaveBeenLastCalledWith(
      "owner",
      expect.objectContaining({
        scope: expect.objectContaining({ accountIds: null, categoryIds: null }),
      }),
    );
  });
  it("denies missing read scope before loading any evidence", async () => {
    const { app, readSpending, deny } = setup();
    deny();
    expect((await app.request(url)).status).toBe(403);
    expect(readSpending).not.toHaveBeenCalled();
  });
  it("rejects malformed booleans, dates/timezones and selection modes", async () => {
    const { app, readSpending } = setup();
    for (const suffix of [
      "&includePending=yes",
      "&accountIdsSelection=oops",
      "&timezone=bad",
      "&through=2026-02-30",
    ]) {
      const requestUrl = new URL(url, "http://localhost");
      for (const [key, value] of new URLSearchParams(suffix.slice(1)))
        requestUrl.searchParams.set(key, value);
      expect((await app.request(requestUrl.pathname + requestUrl.search)).status).toBe(400);
    }
    expect(readSpending).not.toHaveBeenCalled();
  });
});
