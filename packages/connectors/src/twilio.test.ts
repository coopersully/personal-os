import { describe, expect, it, vi } from "vitest";

const twilioMocks = vi.hoisted(() => ({
  checkVerification: vi.fn(),
  createMessage: vi.fn(),
  factory: vi.fn(),
  service: vi.fn(),
  validateRequest: vi.fn(),
}));

vi.mock("twilio", () => ({
  default: Object.assign(twilioMocks.factory, { validateRequest: twilioMocks.validateRequest }),
}));

import { createTwilioConnector, estimateTwilioSegments } from "./twilio.js";

describe("Twilio SMS estimation", () => {
  it("accounts for GSM, extension, concatenation, and Unicode units", () => {
    expect(estimateTwilioSegments("hello")).toEqual({ encoding: "GSM-7", segments: 1, units: 5 });
    expect(estimateTwilioSegments("^".repeat(81))).toEqual({
      encoding: "GSM-7",
      segments: 2,
      units: 162,
    });
    expect(estimateTwilioSegments("🙂".repeat(36))).toEqual({
      encoding: "UCS-2",
      segments: 2,
      units: 72,
    });
    expect(estimateTwilioSegments("é🙂")).toEqual({
      encoding: "UCS-2",
      segments: 1,
      units: 3,
    });
  });

  it("includes a delivery callback only when one is provided", async () => {
    twilioMocks.service.mockReturnValue({
      verificationChecks: { create: twilioMocks.checkVerification },
    });
    twilioMocks.factory.mockReturnValue({
      messages: { create: twilioMocks.createMessage },
      verify: { v2: { services: twilioMocks.service } },
    });
    twilioMocks.createMessage.mockResolvedValue({ sid: "SM1", status: "queued" });
    const connector = createTwilioConnector({
      accountSid: "AC1",
      authToken: "secret",
      messagingServiceSid: "MG1",
      verifyServiceSid: "VA1",
    });

    await connector.sendMessage({
      body: "Hello",
      statusCallback: "https://example.com/status",
      to: "+15555550100",
    });
    await connector.sendMessage({ body: "Hello again", to: "+15555550100" });

    expect(twilioMocks.createMessage).toHaveBeenNthCalledWith(1, {
      body: "Hello",
      messagingServiceSid: "MG1",
      statusCallback: "https://example.com/status",
      to: "+15555550100",
    });
    expect(twilioMocks.createMessage).toHaveBeenNthCalledWith(2, {
      body: "Hello again",
      messagingServiceSid: "MG1",
      to: "+15555550100",
    });
  });

  it("maps every provider verification state to the bounded result", async () => {
    twilioMocks.service.mockReturnValue({
      verificationChecks: { create: twilioMocks.checkVerification },
    });
    twilioMocks.factory.mockReturnValue({
      messages: { create: twilioMocks.createMessage },
      verify: { v2: { services: twilioMocks.service } },
    });
    const connector = createTwilioConnector({
      accountSid: "AC1",
      authToken: "secret",
      messagingServiceSid: "MG1",
      verifyServiceSid: "VA1",
    });

    twilioMocks.checkVerification
      .mockResolvedValueOnce({ status: "approved" })
      .mockResolvedValueOnce({ status: "pending" })
      .mockResolvedValueOnce({ status: "canceled" });
    await expect(connector.checkVerification("VE1", "123456")).resolves.toBe("approved");
    await expect(connector.checkVerification("VE1", "123456")).resolves.toBe("pending");
    await expect(connector.checkVerification("VE1", "123456")).resolves.toBe("failed");
  });
});
