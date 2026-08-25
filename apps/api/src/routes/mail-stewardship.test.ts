import { Hono } from "hono";
import { vi } from "vitest";
import { errorResponse } from "../errors.js";
import type { AppEnv, Principal } from "../types.js";
import { registerMailStewardshipRoutes } from "./mail-stewardship.js";

const id = "11111111-1111-4111-8111-111111111111";

function testApp(scopes: Array<"mail:read" | "mail:write">) {
  const app = new Hono<AppEnv>();
  const principal: Principal = {
    actorId: id,
    actorType: "user",
    scopes: new Set(scopes),
    userId: id,
  };
  app.use("*", async (context, next) => {
    context.set("principal", principal);
    context.set("requestId", "mail-route-test");
    await next();
  });
  const maintenance = {
    getRun: vi.fn(async () => ({ id, domain: "mail", status: "completed" })),
    maintain: vi.fn(async () => ({
      run: { id, domain: "mail", status: "completed_with_questions" },
      summary: "One question remains.",
      verification: { blockers: [], checkedAt: "2026-08-25T16:00:00.000Z", status: "questions" },
    })),
  };
  const stewardship = {
    answerQuestion: vi.fn(async () => ({ id, status: "answered", version: 2 })),
    createFeedback: vi.fn(),
    createObligation: vi.fn(),
    getReview: vi.fn(),
    getStatus: vi.fn(async () => ({ domain: "mail", state: "needs_input" })),
    getThreadStewardship: vi.fn(),
    previewResponseBrief: vi.fn(),
    setDisposition: vi.fn(),
    updateObligation: vi.fn(),
  };
  registerMailStewardshipRoutes({
    app,
    maintenance: maintenance as never,
    mutationContext: (context) => ({
      principal: context.get("principal"),
      requestId: context.get("requestId"),
    }),
    stewardship: stewardship as never,
  });
  app.onError((error, context) => errorResponse(error, context));
  return { app, maintenance, stewardship };
}

describe("Mail stewardship routes", () => {
  it("dispatches one maintenance intent and returns the honest API result", async () => {
    const { app, maintenance } = testApp(["mail:read", "mail:write"]);
    const response = await app.request("/v1/mail/maintenance", {
      body: JSON.stringify({ scope: { type: "all_outstanding" } }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      run: { domain: "mail", status: "completed_with_questions" },
      verification: { status: "questions" },
    });
    expect(maintenance.maintain).toHaveBeenCalledOnce();
  });

  it("requires mail:write for surgical mutations and mail:read for status", async () => {
    const { app, stewardship } = testApp(["mail:read"]);

    expect((await app.request("/v1/mail/status")).status).toBe(200);
    const answer = await app.request(`/v1/mail/questions/${id}/answer`, {
      body: JSON.stringify({ answer: "reference", expectedVersion: 1, generalize: false }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });

    expect(answer.status).toBe(403);
    expect(stewardship.answerQuestion).not.toHaveBeenCalled();
  });
});
