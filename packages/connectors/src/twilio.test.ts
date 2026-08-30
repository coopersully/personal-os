import { estimateTwilioSegments } from "./twilio.js";

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
});
