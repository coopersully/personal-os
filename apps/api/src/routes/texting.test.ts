import { createHmac } from "node:crypto";
import { get } from "node:http";
import { serve } from "@hono/node-server";
import { createTwilioConnector } from "@personal-os/connectors";
import { textingConsentVersion } from "@personal-os/domain";
import { Hono } from "hono";
import { errorResponse } from "../errors.js";
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
    app.onError(errorResponse);
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
    registerTextingRoutes({
      app,
      texting,
      apiBaseUrl: "https://api.example.test",
      validateWebhook,
    });

    expect((await app.request("/v1/texting")).status).toBe(200);
    expect(
      (
        await app.request("/v1/texting/verification", {
          body: JSON.stringify({
            consentAccepted: true,
            consentVersion: textingConsentVersion,
            country: "US",
            phoneNumber: "+12125550123",
          }),
          headers: { "content-type": "application/json" },
          method: "POST",
        })
      ).status,
    ).toBe(201);
    for (const consentVersion of [undefined, "2026-09-12"]) {
      const response = await app.request("/v1/texting/verification", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          consentAccepted: true,
          consentVersion,
          country: "US",
          phoneNumber: "+12125550123",
        }),
      });
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({
        error: {
          code: "invalid_request",
          details: [
            { path: ["consentVersion"], message: expect.stringContaining("Refresh nohmi") },
          ],
        },
      });
    }
    expect(texting.startVerification).toHaveBeenCalledOnce();
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

describe("Twilio public URL signatures behind the gateway", () => {
  const origin = "https://api.example.test";
  const authToken = "synthetic-webhook-test-token";
  const connector = createTwilioConnector({
    accountSid: `AC${"0".repeat(32)}`,
    authToken,
    messagingServiceSid: `MG${"0".repeat(32)}`,
    verifyServiceSid: `VA${"0".repeat(32)}`,
  });
  const sign = (url: string, parameters: Record<string, string>) =>
    createHmac("sha1", authToken)
      .update(
        url +
          Object.keys(parameters)
            .sort()
            .map((key) => key + parameters[key])
            .join(""),
      )
      .digest("base64");

  it("observes HTTP at the real Node adapter despite the gateway HTTPS header", async () => {
    const app = new Hono();
    app.get("/probe", (context) => context.text(context.req.url));
    const server = serve({ fetch: app.fetch, hostname: "127.0.0.1", port: 0 });
    try {
      if (!server.listening)
        await new Promise<void>((resolve) => server.once("listening", resolve));
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Missing test listener");
      const observedUrl = await new Promise<string>((resolve, reject) => {
        get(
          `http://127.0.0.1:${address.port}/probe?raw=a%2fb`,
          {
            headers: { host: "api.example.test", "x-forwarded-proto": "https" },
          },
          (response) => {
            let body = "";
            response.setEncoding("utf8");
            response.on("data", (chunk) => {
              body += chunk;
            });
            response.on("end", () => resolve(body));
            response.on("error", reject);
          },
        ).on("error", reject);
      });
      expect(observedUrl).toBe("http://api.example.test/probe?raw=a%2fb");
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  it.each([
    "inbound",
    "message-status",
  ])("authenticates public HTTPS %s without trusting forwarding headers", async (route) => {
    const app = new Hono<AppEnv>();
    const inbound = vi.fn(async () => undefined);
    const updateStatus = vi.fn(async () => undefined);
    const texting = { inbound, updateStatus } as unknown as ReturnType<typeof createTextingService>;
    registerTextingRoutes({
      app,
      texting,
      apiBaseUrl: origin,
      validateWebhook: connector.validateWebhook,
    });
    const path = `/v1/webhooks/twilio/${route}?token=a%2fb&space=a+b&repeat=1&repeat=2`;
    const parameters = {
      MessageSid: "SMsynthetic",
      From: "+12125550123",
      Body: "STOP",
      MessageStatus: "delivered",
    };
    const request = (signedUrl: string, body = parameters) =>
      app.request(`http://api.example.test${path}`, {
        method: "POST",
        headers: {
          host: "api.example.test",
          "x-forwarded-proto": "https",
          "x-forwarded-host": "attacker.example.test",
          forwarded: "host=attacker.example.test;proto=https",
          "content-type": "application/x-www-form-urlencoded",
          "x-twilio-signature": sign(signedUrl, parameters),
        },
        body: new URLSearchParams(body).toString(),
      });
    expect((await request(`${origin}${path}`)).status).toBe(204);
    const handler = route === "inbound" ? inbound : updateStatus;
    expect(handler).toHaveBeenCalledExactlyOnceWith(parameters);
    for (const forgedUrl of [
      `http://api.example.test${path}`,
      `https://attacker.example.test${path}`,
      `${origin}${path.replace("a%2fb", "a%2Fb")}`,
      `${origin}${path.replace(route, "other")}`,
    ]) {
      expect((await request(forgedUrl)).status).toBe(403);
    }
    expect((await request(`${origin}${path}`, { ...parameters, Body: "START" })).status).toBe(403);
    expect(handler).toHaveBeenCalledTimes(1);
  });
});
