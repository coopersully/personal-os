import { Hono } from "hono";
import { errorResponse } from "../errors.js";
import type { AppEnv } from "../types.js";
import { registerKnowledgeRoutes } from "./knowledge.js";

it("redacts invalid service output and preserves request validation errors", async () => {
  const id = "11111111-1111-4111-8111-111111111111";
  const app = new Hono<AppEnv>();
  app.use("*", async (context, next) => {
    context.set("principal", { actorId: id, actorType: "user", scopes: new Set(), userId: id });
    context.set("requestId", "memory-receipt-test");
    await next();
  });
  app.onError(errorResponse);
  const create = vi.fn(async () => ({
    outcome: "pending_owner_review" as const,
    receiptId: id,
    recordId: id,
    privateContent: "synthetic private value",
  }));
  const search = vi.fn(async () => ({
    schemaVersion: 1 as const,
    items: [],
    state: "available" as const,
    epoch: 1,
    nextCursor: null,
  }));
  type Routes = Parameters<typeof registerKnowledgeRoutes>[0];
  registerKnowledgeRoutes({
    app,
    knowledge: { create, get: vi.fn() },
    lifecycle: {} as Routes["lifecycle"],
    search: { search, history: vi.fn() },
    context: {} as Routes["context"],
    export: {} as Routes["export"],
  });
  function save(body: unknown) {
    return app.request("/v1/knowledge", { method: "POST", body: JSON.stringify(body) });
  }

  const privateSearch = await app.request("/v1/knowledge/search", {
    method: "POST",
    body: JSON.stringify({ purpose: "planning", text: "synthetic private search" }),
  });
  expect(privateSearch.status).toBe(200);
  expect(search).toHaveBeenCalledWith(expect.anything(), {
    purpose: "planning",
    text: "synthetic private search",
  });
  expect(
    (
      await app.request("/v1/knowledge/search", {
        method: "POST",
        body: JSON.stringify({ purpose: "planning", unknown: true }),
      })
    ).status,
  ).toBe(400);
  const invalidInput = await save({ privateContent: true });
  expect(invalidInput.status).toBe(400);
  expect(await invalidInput.json()).toMatchObject({ error: { code: "invalid_request" } });
  expect(create).not.toHaveBeenCalled();

  const response = await save({
    mutationKey: id,
    scope: { workspace: null },
    purposes: ["planning"],
    content: {
      kind: "fact",
      value: { subject: "owner", predicate: "note", value: { type: "string", value: "sample" } },
    },
  });
  expect(create).toHaveBeenCalledOnce();
  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({
    error: {
      code: "internal_error",
      message: "An unexpected error occurred.",
      requestId: "memory-receipt-test",
    },
  });
});

it("removed_learning_and_forgetting_routes_are_gone", async () => {
  const id = "11111111-1111-4111-8111-111111111111";
  const app = new Hono<AppEnv>();
  app.use("*", async (context, next) => {
    context.set("principal", { actorId: id, actorType: "user", scopes: new Set(), userId: id });
    context.set("requestId", "removed-learning-routes-test");
    await next();
  });
  app.onError(errorResponse);
  type Routes = Parameters<typeof registerKnowledgeRoutes>[0];
  registerKnowledgeRoutes({
    app,
    knowledge: {} as Routes["knowledge"],
    lifecycle: {} as Routes["lifecycle"],
    search: {} as Routes["search"],
    context: {} as Routes["context"],
    export: {} as Routes["export"],
  });
  const body = JSON.stringify({});
  for (const [method, path] of [
    ["GET", "/v1/knowledge/settings"],
    ["POST", "/v1/knowledge/selections"],
    ["POST", "/v1/knowledge/selection-interactions"],
    ["POST", "/v1/knowledge/learning-reset"],
    ["POST", "/v1/knowledge/forget"],
    ["GET", "/v1/knowledge/operations"],
    ["GET", `/v1/knowledge/operations/${id}`],
    ["POST", `/v1/knowledge/operations/${id}/retry`],
    ["POST", `/v1/knowledge/${id}/forget-preview`],
  ] as const) {
    const response = await app.request(path, { method, ...(method === "POST" ? { body } : {}) });
    expect(response.status, `${method} ${path}`).toBe(404);
  }
});
