import { replyDeliveryState } from "./texting-sms-admission.js";

describe("SMS reply delivery policy", () => {
  it("admits only explicit submitted states and fails closed on an unknown future status", () => {
    for (const status of ["accepted", "sending", "sent", "delivered"])
      expect(replyDeliveryState({ status, providerMessageSid: null })).toBe("eligible");
    expect(replyDeliveryState({ status: "queued", providerMessageSid: "SM123" })).toBe("eligible");
    expect(replyDeliveryState({ status: "queued", providerMessageSid: null })).toBe("waiting");
    expect(replyDeliveryState({ status: "unknown", providerMessageSid: "SM123" })).toBe("waiting");
    expect(replyDeliveryState({ status: "future_status", providerMessageSid: "SM123" })).toBe(
      "waiting",
    );
    for (const status of ["failed", "undelivered"])
      expect(replyDeliveryState({ status, providerMessageSid: "SM123" })).toBe("terminal");
  });
});
