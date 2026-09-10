import { createAccessTokenInputSchema } from "./auth.js";
import {
  normalizeTextingPhoneNumber,
  sendTextMessageInputSchema,
  textConversationQuerySchema,
} from "./texting.js";

describe("texting contracts", () => {
  it("normalizes US and Canadian NANP numbers", () => {
    expect(normalizeTextingPhoneNumber({ country: "US", phoneNumber: "(212) 555-0123" })).toEqual({
      country: "US",
      e164: "+12125550123",
      lastFour: "0123",
    });
    expect(normalizeTextingPhoneNumber({ country: "CA", phoneNumber: "+1 416 555 0123" })).toEqual({
      country: "CA",
      e164: "+14165550123",
      lastFour: "0123",
    });
    expect(() =>
      normalizeTextingPhoneNumber({ country: "US", phoneNumber: "+44 20 7183 8750" }),
    ).toThrow("US or Canadian");
  });

  it("requires read scope with texting write scope", () => {
    expect(() =>
      createAccessTokenInputSchema.parse({ name: "SMS agent", scopes: ["texting:write"] }),
    ).toThrow("texting:read");
  });

  it("bounds conversation and send inputs", () => {
    expect(textConversationQuerySchema.parse({})).toEqual({ limit: 100 });
    expect(() =>
      textConversationQuerySchema.parse({ afterCursor: "a", beforeCursor: "b" }),
    ).toThrow();
    expect(
      sendTextMessageInputSchema.parse({ body: "Done.", conversationReceipt: "receipt" }),
    ).toMatchObject({ body: "Done.", contentKind: "concise" });
    expect(() =>
      sendTextMessageInputSchema.parse({
        body: "Done.",
        conversationReceipt: "receipt",
        seriesTotal: 4,
      }),
    ).toThrow();
  });
});
