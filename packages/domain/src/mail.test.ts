import { legacyMailDraftSchema } from "./mail.js";

describe("Mail domain", () => {
  it("projects historical drafts without recovery or provider authority", () => {
    const draft = legacyMailDraftSchema.parse({
      accountId: "22222222-2222-4222-8222-222222222222",
      body: "Unsent body",
      cc: [],
      createdAt: "2026-08-25T12:00:00.000Z",
      deliveryState: "delivery_unknown",
      id: "11111111-1111-4111-8111-111111111111",
      subject: "Historical draft",
      threadId: null,
      to: ["person@example.com"],
      updatedAt: "2026-08-25T12:00:00.000Z",
    });

    expect(draft).not.toHaveProperty("sendClaimToken");
    expect(draft).not.toHaveProperty("sendClaimedAt");
    expect(draft).not.toHaveProperty("providerId");
    expect(draft.to).toEqual(["person@example.com"]);
  });
});
