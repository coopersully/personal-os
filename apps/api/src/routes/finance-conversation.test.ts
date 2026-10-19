import type { AccessScope } from "@personal-os/domain";
import { Hono } from "hono";
import { AppError, errorResponse } from "../errors.js";
import type { createFinanceConversationService } from "../finance/conversation-persistence.js";
import type { AppEnv, Principal } from "../types.js";
import { registerFinanceConversationRoutes } from "./finance-conversation.js";

const ownerId = "11111111-1111-4111-8111-111111111111";
const runId = "22222222-2222-4222-8222-222222222222";
function fixture() {
  const app = new Hono<AppEnv>();
  let principal: Principal = {
    userId: ownerId,
    actorId: ownerId,
    actorType: "user",
    scopes: new Set<AccessScope>(["finances:read", "finances:write", "finances:maintain"]),
  };
  const service = {
    getReadiness: vi.fn(async () => ({ canSend: false })),
    getHostReadiness: vi.fn(async () => ({ canSend: true })),
    messageContext: vi.fn(async () => ({ targetMessageId: runId, messages: [] })),
    history: vi.fn(async () => ({ messages: [], nextCursor: null })),
    send: vi.fn(async () => ({ id: runId })),
    markRendered: vi.fn(async () => ({ readThroughSequence: "1" })),
    pageBatch: vi.fn(async () => ({ messages: [], nextCursor: null })),
    acknowledgeBatch: vi.fn(async () => ({ acknowledgedMessageIds: [] })),
    reply: vi.fn(async () => ({ id: runId })),
    issueChallenge: vi.fn(async () => ({ challengeId: runId })),
    advanceChallenge: vi.fn(async () => ({ verified: false })),
  };
  app.use("*", async (context, next) => {
    context.set("principal", principal);
    context.set("requestId", "conversation-route");
    await next();
  });
  app.onError(errorResponse);
  registerFinanceConversationRoutes({
    app,
    conversation: service as unknown as ReturnType<typeof createFinanceConversationService>,
  });
  return {
    app,
    service,
    setPrincipal: (next: Principal) => {
      principal = next;
    },
    principal,
  };
}
const post = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

describe("Finance conversation leaf routes", () => {
  it("uses authenticated owner identity, prevents private caching and rejects foreign-owner overrides", async () => {
    const f = fixture();
    const response = await f.app.request(
      "/v1/finances/conversation/messages?after=9007199254740993&limit=1",
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(f.service.history).toHaveBeenCalledWith(ownerId, "9007199254740993", 1);
    expect((await f.app.request("/v1/finances/conversation/messages?userId=foreign")).status).toBe(
      400,
    );
    expect(f.service.history).toHaveBeenCalledTimes(1);
  });
  it("prohibits agent live history scans and owner send impersonation, while forwarding only a run-bound batch", async () => {
    const f = fixture();
    const agent: Principal = { ...f.principal, actorId: runId, actorType: "agent" };
    f.setPrincipal(agent);
    expect((await f.app.request("/v1/finances/conversation/messages")).status).toBe(403);
    expect(
      (
        await f.app.request(
          "/v1/finances/conversation/messages",
          post({ text: "hello", idempotencyKey: "send" }),
        )
      ).status,
    ).toBe(403);
    expect(f.service.history).not.toHaveBeenCalled();
    expect(f.service.send).not.toHaveBeenCalled();
    expect(
      (
        await f.app.request(
          `/v1/finances/conversation/batches/${runId}?cursor=signed.cursor&limit=2`,
        )
      ).status,
    ).toBe(200);
    expect(f.service.pageBatch).toHaveBeenCalledWith(agent, runId, "signed.cursor", 2);
  });
  it("rejects authority self-report and requires read/write/maintenance scopes independently", async () => {
    const f = fixture();
    expect(
      (
        await f.app.request(
          `/v1/finances/conversation/challenges/${runId}/exchange`,
          post({ kind: "respond", challengeId: runId, response: "ready", verified: true }),
        )
      ).status,
    ).toBe(400);
    expect(f.service.advanceChallenge).not.toHaveBeenCalled();
    f.setPrincipal({ ...f.principal, scopes: new Set(["finances:read"]) });
    expect(
      (
        await f.app.request(
          "/v1/finances/conversation/messages",
          post({ text: "hello", idempotencyKey: "send" }),
        )
      ).status,
    ).toBe(403);
    expect((await f.app.request(`/v1/finances/conversation/batches/${runId}`)).status).toBe(403);
    expect((await f.app.request("/v1/finances/conversation/readiness")).status).toBe(200);
  });
  it("validates immutable reply sources, exact acknowledgment IDs and bounded rendered sequence before calling services", async () => {
    const f = fixture();
    expect(
      (
        await f.app.request(
          `/v1/finances/conversation/batches/${runId}/replies`,
          post({ text: "reply", idempotencyKey: "r", sourceMessageIds: [] }),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await f.app.request(
          `/v1/finances/conversation/batches/${runId}/acknowledgments`,
          post({ messageIds: ["foreign-invalid"] }),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await f.app.request(
          "/v1/finances/conversation/rendered",
          post({ throughSequence: "9223372036854775808" }),
        )
      ).status,
    ).toBe(400);
    expect(f.service.reply).not.toHaveBeenCalled();
    expect(f.service.acknowledgeBatch).not.toHaveBeenCalled();
    expect(f.service.markRendered).not.toHaveBeenCalled();
  });
});

it("reads only the selected host proof for the human owner", async () => {
  const f = fixture();
  const response = await f.app.request(`/v1/finances/conversation/hosts/${runId}/readiness`);
  expect(response.status).toBe(200);
  expect(f.service.getHostReadiness).toHaveBeenCalledWith(ownerId, runId);
  f.setPrincipal({ ...f.principal, actorType: "agent", actorId: runId });
  expect((await f.app.request(`/v1/finances/conversation/hosts/${runId}/readiness`)).status).toBe(
    403,
  );
  expect(f.service.getHostReadiness).toHaveBeenCalledTimes(1);
});

it("binds exact source context to authenticated human owner, rejects overrides and blocks agents", async () => {
  const f = fixture();
  const path = `/v1/finances/conversation/messages/${runId}/context`;
  const response = await f.app.request(path);
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(f.service.messageContext).toHaveBeenCalledWith(ownerId, runId);
  expect((await f.app.request(`${path}?userId=foreign`)).status).toBe(400);
  f.setPrincipal({ ...f.principal, actorType: "agent", actorId: runId });
  expect((await f.app.request(path)).status).toBe(403);
  expect(f.service.messageContext).toHaveBeenCalledTimes(1);
  f.setPrincipal({ ...f.principal, scopes: new Set() });
  expect((await f.app.request(path)).status).toBe(403);
});

it("returns the same not-found response for unavailable owner source IDs", async () => {
  const f = fixture();
  f.service.messageContext.mockRejectedValue(
    new AppError("not_found", "The Finance source message was not found."),
  );
  const response = await f.app.request(`/v1/finances/conversation/messages/${runId}/context`);
  expect(response.status).toBe(404);
  expect(await response.text()).toContain("The Finance source message was not found.");
});
