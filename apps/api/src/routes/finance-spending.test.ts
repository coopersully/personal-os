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

it("revalidates exact references for authenticated owner and rejects concurrent row changes", async () => {
  const { buildFinanceSpendingDashboard } = await import("../finance/spending-service.js");
  const timestamp = "2026-03-10T12:00:00.000Z";
  const query = {
    scope: {
      from: "2026-03-07",
      through: "2026-03-09",
      timezone: "America/New_York",
      accountIds: null,
      categoryIds: null,
      basis: "personal_cost" as const,
      includePending: true,
      subtractRefunds: true,
    },
    grouping: "categories" as const,
    includeUncategorized: true,
  };
  const dashboard = buildFinanceSpendingDashboard(
    {
      userId: "owner",
      asOf: timestamp,
      coverage: "unknown",
      accounts: [
        {
          id: "cash",
          userId: "owner",
          currencyCode: "USD",
          includeInPlanning: true,
          kind: "cash",
          ownershipType: "individual",
          ownershipShareBps: 10000,
        },
      ],
      transactions: [
        {
          id: "purchase",
          userId: "owner",
          accountId: "cash",
          amount: 123,
          category: null,
          categoryId: null,
          currencyCode: "USD",
          direction: "expense",
          providerDirection: null,
          pending: false,
          pendingTransactionId: null,
          providerTransactionId: null,
          reconciliationStatus: "not_applicable",
          transactionDate: "2026-03-08",
          transferGroupId: null,
        },
      ],
      allocations: [],
      relationships: [],
      matches: [],
      reimbursements: [],
    },
    query,
    {
      accounts: [{ id: "cash", label: "Cash" }],
      categories: [],
      buckets: [],
      transactions: [
        {
          id: "purchase",
          accountId: "cash",
          merchant: "Store",
          date: "2026-03-08",
          pending: false,
          updatedAt: timestamp,
        },
      ],
      source: { freshness: "unknown", lastSyncedAt: null, reasons: [] },
    },
  );
  const app = new Hono<AppEnv>();
  let scopes = new Set<AccessScope>(["finances:read"]);
  app.use("*", async (c, next) => {
    c.set("principal", { actorId: "owner", actorType: "user", userId: "owner", scopes });
    await next();
  });
  app.onError(errorResponse);
  const readSpending = vi.fn(async () => dashboard);
  const readTransaction = vi.fn(async () => ({
    data: { id: "purchase", accountId: "cash", updatedAt: timestamp },
  }));
  registerFinanceSpendingRoute({
    app,
    spending: { readSpending } as never,
    readTransaction: readTransaction as never,
  });
  const filter = {
    query,
    referenceRevision: dashboard.referenceRevision,
    groupId: null,
    from: query.scope.from,
    through: query.scope.through,
  };
  const request = () =>
    app.request("/v1/finances/spending/transactions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ filter, limit: 1 }),
    });
  const result = await request();
  expect(result.status).toBe(200);
  expect(result.headers.get("cache-control")).toBe("no-store");
  expect(await result.json()).toMatchObject({
    netCents: 123,
    totalTransactions: 1,
    contributions: [{ transactionId: "purchase", netCents: 123 }],
  });
  expect(readTransaction).toHaveBeenCalledWith("owner", "purchase");
  readTransaction.mockResolvedValueOnce({
    data: { id: "purchase", accountId: "cash", updatedAt: "2026-03-11T12:00:00.000Z" },
  });
  expect((await request()).status).toBe(409);
  scopes = new Set();
  expect((await request()).status).toBe(403);
  expect(readSpending).toHaveBeenCalledTimes(2);
});
