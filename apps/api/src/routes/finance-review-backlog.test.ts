import type { AccessScope } from "@personal-os/domain";
import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { errorResponse } from "../errors.js";
import type { AppEnv } from "../types.js";
import { registerFinanceReviewBacklogRoutes } from "./finance-review-backlog.js";

const id = "10000000-0000-4000-8000-000000000001";
function setup(scopes: AccessScope[] = ["finances:read", "finances:write"]) {
  const app = new Hono<AppEnv>();
  const principal = {
    actorId: "owner",
    actorType: "user" as const,
    userId: "owner",
    scopes: new Set(scopes),
  };
  app.use("*", async (c, next) => {
    c.set("principal", principal);
    c.set("requestId", "request-1");
    await next();
  });
  app.onError(errorResponse);
  const backlog = {
    assess: vi.fn(async () => ({ complete: true })),
    list: vi.fn(async () => ({ items: [], nextCursor: null })),
  };
  const batches = {
    approveForContinuation: vi.fn(async () => ({ id, state: "pending" })),
    getContinuation: vi.fn(async () => ({ id, state: "pending" })),
    cancelContinuation: vi.fn(async () => ({ id, state: "cancelled" })),
    previewUndo: vi.fn(async () => ({ id })),
    getUndo: vi.fn(async () => ({ id })),
    executeUndo: vi.fn(async () => ({ id })),
    list: vi.fn(async () => []),
    get: vi.fn(async () => ({ id })),
    preview: vi.fn(async () => ({ id })),
    qualify: vi.fn(async () => ({ advisoryOnly: true, items: [] })),
    execute: vi.fn(async () => ({ id })),
  };
  registerFinanceReviewBacklogRoutes({ app, backlog: backlog as never, batches: batches as never });
  return { app, backlog, batches, principal };
}
describe("Finance backlog routes", () => {
  it("persists approval before returning accepted and reads or cancels only the authenticated batch", async () => {
    const { app, batches, principal } = setup();
    const fingerprint = `sha256:${"a".repeat(64)}`;
    const request = (body: unknown) => ({
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    expect(
      (await app.request(`/v1/finances/review-batches/${id}/approval`, request({ fingerprint })))
        .status,
    ).toBe(202);
    expect(batches.approveForContinuation).toHaveBeenCalledWith(
      id,
      { fingerprint },
      { principal, requestId: "request-1" },
    );
    expect(batches.execute).not.toHaveBeenCalled();
    expect(
      (
        await app.request(
          `/v1/finances/review-batches/${id}/approval`,
          request({ fingerprint, approvedBy: id }),
        )
      ).status,
    ).toBe(400);
    expect(
      (await app.request(`/v1/finances/review-batches/${id}/approval`)).headers.get(
        "cache-control",
      ),
    ).toBe("no-store");
    expect(
      (await app.request(`/v1/finances/review-batches/${id}/approval/cancel`, request({}))).status,
    ).toBe(200);
    const denied = setup(["finances:read"]);
    expect(
      (
        await denied.app.request(
          `/v1/finances/review-batches/${id}/approval`,
          request({ fingerprint }),
        )
      ).status,
    ).toBe(403);
  });
  it("keeps corrections private and passes exact bounded acceptance to the execution owner", async () => {
    const { app, batches, principal } = setup();
    const preview = { batchId: id, outcomeIndexes: [0, 2], idempotencyKey: "undo" };
    const post = (body: unknown) => ({
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    expect((await app.request("/v1/finances/review-batch-corrections", post(preview))).status).toBe(
      201,
    );
    expect(batches.previewUndo).toHaveBeenCalledWith(preview, {
      principal,
      requestId: "request-1",
    });
    const read = await app.request(`/v1/finances/review-batch-corrections/${id}`);
    expect(read.headers.get("cache-control")).toBe("no-store");
    const acceptance = { fingerprint: `sha256:${"a".repeat(64)}`, limit: 2 };
    expect(
      (await app.request(`/v1/finances/review-batch-corrections/${id}/execute`, post(acceptance)))
        .status,
    ).toBe(200);
    expect(batches.executeUndo).toHaveBeenCalledWith(
      id,
      acceptance,
      expect.objectContaining({ principal }),
    );
    expect(
      (
        await app.request(
          `/v1/finances/review-batch-corrections/${id}/execute`,
          post({ ...acceptance, limit: 11 }),
        )
      ).status,
    ).toBe(400);
    const denied = setup(["finances:read"]);
    expect(
      (await denied.app.request("/v1/finances/review-batch-corrections", post(preview))).status,
    ).toBe(403);
    expect(
      (
        await denied.app.request(
          `/v1/finances/review-batch-corrections/${id}/execute`,
          post(acceptance),
        )
      ).status,
    ).toBe(403);
    expect(denied.batches.executeUndo).not.toHaveBeenCalled();
  });
  it("qualifies bounded work under read authority without creating a preview or executing", async () => {
    const { app, batches, principal } = setup(["finances:read"]);
    const input = {
      decisions: [
        {
          kind: "categorization",
          transactionId: id,
          categoryId: id,
          expectedTransactionUpdatedAt: "2026-10-24T00:00:00.000Z",
          expectedTransactionRevision: "1",
          confidence: 1,
          rationale: "Inspect",
          evidence: "Not itself proof",
          learnMerchant: "never",
        },
      ],
    };
    const response = await app.request("/v1/finances/review-batches/qualification", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(batches.qualify).toHaveBeenCalledWith(input, { principal, requestId: "request-1" });
    expect(batches.preview).not.toHaveBeenCalled();
    expect(batches.execute).not.toHaveBeenCalled();
    for (const invalid of [
      { ...input, verified: true },
      { decisions: Array(26).fill(input.decisions[0]) },
      { decisions: Array(2).fill(input.decisions[0]) },
    ]) {
      expect(
        (
          await app.request("/v1/finances/review-batches/qualification", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(invalid),
          })
        ).status,
      ).toBe(400);
    }
    const denied = setup([]);
    expect(
      (
        await denied.app.request("/v1/finances/review-batches/qualification", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(input),
        })
      ).status,
    ).toBe(403);
    expect(denied.batches.qualify).not.toHaveBeenCalled();
  });
  it("uses authenticated ownership and never caches historical evidence", async () => {
    const { app, backlog, batches, principal } = setup();
    const response = await app.request("/v1/finances/review-backlog");
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(backlog.assess).toHaveBeenCalledWith("owner");
    await app.request("/v1/finances/review-backlog/items?group=roundups&limit=3");
    expect(backlog.list).toHaveBeenCalledWith("owner", { group: "roundups", limit: 3 });
    await app.request("/v1/finances/review-batches?limit=5");
    expect(batches.list).toHaveBeenCalledWith({ principal, requestId: "request-1" }, { limit: 5 });
    expect((await app.request(`/v1/finances/review-batches/${id}`)).status).toBe(200);
  });
  it("rejects missing scope and invalid input before calling services", async () => {
    const denied = setup([]);
    expect((await denied.app.request("/v1/finances/review-backlog")).status).toBe(403);
    expect(denied.backlog.assess).not.toHaveBeenCalled();
    const { app, backlog, batches } = setup();
    expect((await app.request("/v1/finances/review-backlog/items?limit=101")).status).toBe(400);
    expect((await app.request("/v1/finances/review-backlog/items?userId=other")).status).toBe(400);
    expect(backlog.list).not.toHaveBeenCalled();
    expect((await app.request("/v1/finances/review-batches/not-id")).status).toBe(400);
    expect(batches.get).not.toHaveBeenCalled();
  });
  it("passes an exact bounded manifest to durable preview and execution", async () => {
    const { app, batches, principal } = setup();
    const input = {
      idempotencyKey: "batch-1",
      decisions: [
        {
          kind: "categorization",
          transactionId: id,
          categoryId: id,
          expectedTransactionUpdatedAt: "2026-10-24T00:00:00.000Z",
          expectedTransactionRevision: "1",
          confidence: 0.95,
          rationale: "Receipt verified",
          evidence: "Synthetic receipt",
          learnMerchant: "never",
        },
      ],
    };
    const preview = await app.request("/v1/finances/review-batches", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
    expect(preview.status).toBe(201);
    expect(batches.preview).toHaveBeenCalledWith(input, { principal, requestId: "request-1" });
    const execution = { fingerprint: `sha256:${"a".repeat(64)}`, limit: 10 };
    const response = await app.request(`/v1/finances/review-batches/${id}/execute`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(execution),
    });
    expect(response.status).toBe(200);
    expect(batches.execute).toHaveBeenCalledWith(id, execution, {
      signal: expect.any(AbortSignal),
      principal,
      requestId: "request-1",
    });
    const invalid = await app.request(`/v1/finances/review-batches/${id}/execute`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...execution, limit: 11 }),
    });
    expect(invalid.status).toBe(400);
    expect(batches.execute).toHaveBeenCalledTimes(1);
  });
});
