import {
  createMailDraftInputSchema,
  legacyMailDraftSchema,
  mailDraftSchema,
  mailSetupAccountSchema,
  sendMailDraftInputSchema,
} from "./mail.js";

const accountId = "22222222-2222-4222-8222-222222222222";
const draftId = "11111111-1111-4111-8111-111111111111";
const now = "2026-08-28T12:00:00.000Z";

describe("Mail domain", () => {
  it("projects historical drafts without recovery or provider authority", () => {
    const draft = legacyMailDraftSchema.parse({
      accountId: "22222222-2222-4222-8222-222222222222",
      body: "Unsent body",
      cc: [],
      createdAt: "2026-08-25T12:00:00.000Z",
      deliveryState: "delivery_unknown",
      id: "11111111-1111-4111-8111-111111111111",
      providerId: "provider-draft-1",
      sendClaimToken: "claim-1",
      sendClaimedAt: "2026-08-25T12:00:00.000Z",
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

  it("accepts incomplete durable drafts without inventing unsupported fields", () => {
    const input = createMailDraftInputSchema.parse({
      accountId,
      attachments: [{ name: "unsafe.txt" }],
      bcc: [{ address: "hidden@example.com", name: null }],
      body: "",
      cc: [],
      subject: "",
      to: [],
    });

    expect(input).toEqual({ accountId, body: "", cc: [], subject: "", to: [] });
    expect(input).not.toHaveProperty("attachments");
    expect(input).not.toHaveProperty("bcc");
  });

  it("requires an exact saved revision to send a draft", () => {
    expect(
      sendMailDraftInputSchema.parse({
        confirmedUpdatedAt: now,
        draftId,
      }),
    ).toEqual({ confirmedUpdatedAt: now, draftId });
  });

  it("exposes editable and uncertain draft states without claim authority", () => {
    const draft = mailDraftSchema.parse({
      accountId,
      body: "Prepared response",
      cc: [],
      createdAt: now,
      id: draftId,
      reconciliationState: "sent_mail_review_required",
      sendClaimId: "33333333-3333-4333-8333-333333333333",
      sendClaimedAt: now,
      sendStatus: "reconcile",
      sentAt: null,
      subject: "Follow up",
      threadId: null,
      to: [{ address: "person@example.com", name: null }],
      updatedAt: now,
    });

    expect(draft).not.toHaveProperty("sendClaimId");
    expect(draft.reconciliationState).toBe("sent_mail_review_required");
  });

  it("projects provider delivery capability separately from Mail health", () => {
    const account = mailSetupAccountSchema.parse({
      accountId,
      automation: {
        failedCount: 0,
        inProgressCount: 0,
        lastCompletedAt: null,
        pendingCount: 0,
        reconciliationCount: 0,
      },
      automaticRuleExecution: true,
      email: "person@example.com",
      health: {
        message: null,
        nextSyncAt: now,
        recovery: null,
        state: "ready",
      },
      label: "Personal",
      lastSyncAttemptAt: now,
      lastSyncedAt: now,
      mailboxes: [],
      nextSyncAt: now,
      provider: "google",
      sendCapability: "reconnect",
      syncError: null,
      syncStatus: "idle",
    });

    expect(account.health.state).toBe("ready");
    expect(account.sendCapability).toBe("reconnect");
  });
});
