import type { Database } from "@personal-os/database";
import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { errorResponse } from "../errors.js";
import type { AppEnv, Principal } from "../types.js";
import { registerWorkspaceSearchRoutes } from "./workspace-search.js";

const search = vi.hoisted(() => vi.fn());
vi.mock("../workspace-search/service.js", () => ({
  createWorkspaceSearchService: () => ({ search }),
}));
const content = {
  items: [
    {
      id: "message",
      kind: "Mail",
      title: "Board packet",
      preview: "Agenda",
      href: "/mail?thread=message",
      state: null,
    },
  ],
  nextOffset: null,
  coverage: "synced",
};
function testApp() {
  const app = new Hono<AppEnv>();
  const principal: Principal = {
    actorId: "reader",
    actorType: "user",
    userId: "reader",
    scopes: new Set(["mail:read"]),
  };
  app.use("*", async (context, next) => {
    context.set("principal", principal);
    context.set("requestId", "search-route-request");
    await next();
  });
  const workItems = { list: vi.fn(), searchItems: vi.fn() };
  registerWorkspaceSearchRoutes({
    app,
    db: {} as Database,
    workItems,
    mutationContext: (context) => ({
      principal: context.get("principal"),
      requestId: context.get("requestId"),
    }),
  });
  app.onError((error, context) => errorResponse(error, context));
  return { app, workItems, principal };
}
beforeEach(() => {
  search.mockReset().mockResolvedValue(content);
});
describe("workspace search projection admission", () => {
  it("returns content without invoking unavailable review sources or claiming partial coverage", async () => {
    const { app, workItems } = testApp();
    workItems.searchItems.mockRejectedValue(new Error("Slow review source unavailable"));
    const response = await app.request("/v1/workspaces/mail/search?q=board&kind=content");
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual(content);
    expect(workItems.searchItems).not.toHaveBeenCalled();
    expect(search).toHaveBeenCalledExactlyOnceWith(
      "reader",
      "mail",
      expect.objectContaining({ kind: "content", q: "board" }),
      [],
    );
  });

  it.each([
    "all",
    "reviews",
  ] as const)("keeps successful sources and reports unavailable review sources for %s search", async (kind) => {
    const { app, workItems, principal } = testApp();
    const reviews = [{ id: "mail-rule:rule", title: "Review rule" }];
    workItems.searchItems.mockResolvedValue({
      items: reviews,
      unavailableSources: ["mailQuestions"],
    });
    const response = await app.request(`/v1/workspaces/mail/search?q=board&kind=${kind}`);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ...content, unavailable: ["reviews"] });
    expect(workItems.searchItems).toHaveBeenCalledExactlyOnceWith(
      principal,
      "mail",
      "search-route-request",
    );
    expect(search).toHaveBeenCalledExactlyOnceWith(
      "reader",
      "mail",
      expect.objectContaining({ kind }),
      reviews,
    );
  });

  it.each([
    "all",
    "reviews",
  ] as const)("keeps %s search available after a review projection failure", async (kind) => {
    const { app, workItems } = testApp();
    workItems.searchItems.mockRejectedValue(new Error("Review projection failed"));
    const response = await app.request(`/v1/workspaces/mail/search?q=board&kind=${kind}`);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ...content, unavailable: ["reviews"] });
    expect(workItems.searchItems).toHaveBeenCalledOnce();
    expect(search).toHaveBeenCalledWith("reader", "mail", expect.objectContaining({ kind }), []);
  });
});

it("waits for superseded SQL and drops an aborted waiting query before searching the latest text", async () => {
  const { app } = testApp();
  let finish!: () => void;
  let started!: () => void;
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  const pending = new Promise<void>((resolve) => {
    finish = resolve;
  });
  search.mockImplementationOnce(async () => {
    started();
    await pending;
    return content;
  });
  const oldController = new AbortController();
  const first = app.request("/v1/workspaces/mail/search?q=old&kind=content", {
    signal: oldController.signal,
  });
  await ready;
  oldController.abort();
  const staleController = new AbortController();
  const stale = app.request("/v1/workspaces/mail/search?q=stale&kind=content", {
    signal: staleController.signal,
  });
  staleController.abort();
  await stale;
  const latest = app.request("/v1/workspaces/mail/search?q=latest&kind=content");
  expect(search).toHaveBeenCalledTimes(1);
  finish();
  await first;
  const response = await latest;
  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toEqual(content);
  expect(search.mock.calls.map((call) => call[2].q)).toEqual(["old", "latest"]);
});

it("finishes active review SQL before admitting a replacement and skips abandoned content SQL", async () => {
  const { app, workItems } = testApp();
  let finish!: () => void;
  let started!: () => void;
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  const pending = new Promise<void>((resolve) => {
    finish = resolve;
  });
  workItems.searchItems.mockImplementationOnce(async () => {
    started();
    await pending;
    return { items: [], unavailableSources: [] };
  });
  const controller = new AbortController();
  const abandoned = app.request("/v1/workspaces/mail/search?q=old&kind=all", {
    signal: controller.signal,
  });
  await ready;
  controller.abort();
  const latest = app.request("/v1/workspaces/mail/search?q=latest&kind=content");
  expect(search).not.toHaveBeenCalled();
  finish();
  await abandoned;
  expect((await latest).status).toBe(200);
  expect(search).toHaveBeenCalledExactlyOnceWith(
    "reader",
    "mail",
    expect.objectContaining({ q: "latest" }),
    [],
  );
});
