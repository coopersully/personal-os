import { Hono } from "hono";
import type { createTextingService } from "../texting-service.js";
import type { AppEnv } from "../types.js";
import { registerTextingRoutes } from "./texting.js";

describe("texting routes", () => {
  it("maps human setup, scoped conversation, send, and authenticated webhooks", async () => {
    const texting = {
      checkVerification: vi.fn(async () => ({ id: "connection" })),
      conversation: vi.fn(async () => ({ messages: [] })),
      disconnect: vi.fn(async () => undefined),
      getConnection: vi.fn(async () => ({ id: null })),
      inbound: vi.fn(async () => undefined),
      send: vi.fn(async () => ({ id: "message" })),
      startVerification: vi.fn(async () => ({ id: "11111111-1111-4111-8111-111111111111" })),
      updateStatus: vi.fn(async () => undefined),
    } as unknown as ReturnType<typeof createTextingService>;
    const app = new Hono<AppEnv>();
    app.use("*", async (context, next) => {
      context.set("requestId", "request");
      context.set("principal", {
        actorId: "user",
        actorType: "user",
        scopes: new Set(["texting:read", "texting:write"]),
        userId: "22222222-2222-4222-8222-222222222222",
      });
      await next();
    });
    const validateWebhook = vi.fn(() => true);
    registerTextingRoutes({ app, texting, validateWebhook });

    expect((await app.request("/v1/texting")).status).toBe(200);
    expect(
      (
        await app.request("/v1/texting/verification", {
          body: JSON.stringify({
            consentAccepted: true,
            country: "US",
            phoneNumber: "+12125550123",
          }),
          headers: { "content-type": "application/json" },
          method: "POST",
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await app.request("/v1/texting/verification/11111111-1111-4111-8111-111111111111/check", {
          body: JSON.stringify({ code: "123456" }),
          headers: { "content-type": "application/json" },
          method: "POST",
        })
      ).status,
    ).toBe(200);
    expect(
      (await app.request("/v1/texting/conversation?timeZone=America%2FNew_York&limit=10")).status,
    ).toBe(200);
    expect((await app.request("/v1/texting/conversation?limit=10")).status).toBe(200);
    expect(
      (
        await app.request("/v1/texting/messages?timeZone=UTC", {
          body: JSON.stringify({ body: "Hi", conversationReceipt: "receipt" }),
          headers: { "content-type": "application/json" },
          method: "POST",
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await app.request("/v1/texting/messages", {
          body: JSON.stringify({ body: "Hi", conversationReceipt: "receipt" }),
          headers: { "content-type": "application/json" },
          method: "POST",
        })
      ).status,
    ).toBe(201);
    expect((await app.request("/v1/texting", { method: "DELETE" })).status).toBe(204);
    const formHeaders = {
      "content-type": "application/x-www-form-urlencoded",
      "x-twilio-signature": "signature",
    };
    expect(
      (
        await app.request("/v1/webhooks/twilio/inbound", {
          body: "From=%2B12125550123&MessageSid=SM1&Body=Hi",
          headers: formHeaders,
          method: "POST",
        })
      ).status,
    ).toBe(204);
    expect(
      (
        await app.request("/v1/webhooks/twilio/message-status", {
          body: "MessageSid=SM1&MessageStatus=delivered",
          headers: formHeaders,
          method: "POST",
        })
      ).status,
    ).toBe(204);
    expect(texting.inbound).toHaveBeenCalled();
    expect(texting.updateStatus).toHaveBeenCalled();

    validateWebhook.mockReturnValueOnce(false);
    expect(
      (
        await app.request("/v1/webhooks/twilio/inbound", {
          body: "MessageSid=SM2",
          headers: formHeaders,
          method: "POST",
        })
      ).status,
    ).toBe(403);
    validateWebhook.mockReturnValueOnce(false);
    expect(
      (
        await app.request("/v1/webhooks/twilio/inbound", {
          body: "MessageSid=SM3",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          method: "POST",
        })
      ).status,
    ).toBe(403);

    const validationCalls = validateWebhook.mock.calls.length;
    expect(
      (
        await app.request("/v1/webhooks/twilio/inbound", {
          body: "MessageSid=SM4",
          headers: { ...formHeaders, "content-length": "20000" },
          method: "POST",
        })
      ).status,
    ).toBe(413);
    expect(
      (
        await app.request("/v1/webhooks/twilio/inbound", {
          body: `Body=${"x".repeat(17_000)}`,
          headers: formHeaders,
          method: "POST",
        })
      ).status,
    ).toBe(413);
    expect(validateWebhook).toHaveBeenCalledTimes(validationCalls);
  });
});
