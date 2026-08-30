import { createHmac } from "node:crypto";
import { issueConversationReceipt, verifyConversationReceipt } from "./texting-security.js";
import { formatTextLocalTime } from "./texting-time.js";

describe("texting receipts and time", () => {
  const value = {
    actorId: "agent",
    connectionId: "connection",
    consentEpoch: 3,
    exp: Date.parse("2026-08-28T16:05:00Z"),
    revision: 2,
    timeZone: "America/New_York",
    userId: "user",
  };
  const expected = {
    actorId: "agent",
    connectionId: "connection",
    consentEpoch: 3,
    revision: 2,
    timeZone: "America/New_York",
    userId: "user",
  };
  it("binds fresh receipts to actor, revision, user, and timezone", () => {
    const receipt = issueConversationReceipt(value, "secret");
    expect(() =>
      verifyConversationReceipt(receipt, expected, "secret", new Date("2026-08-28T16:00:00Z")),
    ).not.toThrow();
    for (const invalid of ["bad", `${receipt}x`])
      expect(() =>
        verifyConversationReceipt(invalid, expected, "secret", new Date("2026-08-28T16:00:00Z")),
      ).toThrow();
    expect(() =>
      verifyConversationReceipt(
        receipt,
        { ...expected, actorId: "other" },
        "secret",
        new Date("2026-08-28T16:00:00Z"),
      ),
    ).toThrow();
    const invalidPayload = Buffer.from("not-json").toString("base64url");
    const invalidJsonReceipt = `${invalidPayload}.${createHmac("sha256", "secret").update(invalidPayload).digest("base64url")}`;
    expect(() =>
      verifyConversationReceipt(
        invalidJsonReceipt,
        expected,
        "secret",
        new Date("2026-08-28T16:00:00Z"),
      ),
    ).toThrow();
    expect(() =>
      verifyConversationReceipt(receipt, expected, "secret", new Date("2026-08-28T16:06:00Z")),
    ).toThrow();
    expect(formatTextLocalTime(new Date("2026-08-28T16:00:00Z"), "America/New_York")).toContain(
      "12:00:00 PM GMT-04:00",
    );
  });
});
