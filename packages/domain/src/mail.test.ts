import {
  createMailDraftInputSchema,
  mailDraftSchema,
  mailSetupAccountSchema,
  mailSummaryQuerySchema,
  mailThreadSchema,
  mailThreadSummarySchema,
  sendMailDraftInputSchema,
} from "./mail.js";

const accountId = "22222222-2222-4222-8222-222222222222";
const draftId = "11111111-1111-4111-8111-111111111111";
const now = "2026-08-28T12:00:00.000Z";

describe("Mail thread summaries", () => {
  const thread = {
    accountId,
    bodyText: "private body",
    from: { address: "maya@example.com", name: "Maya" },
    id: draftId,
    mailboxIds: [accountId],
    messageCount: 2,
    provider: "google",
    receivedAt: now,
    remoteThreadId: "provider-thread",
    snippet: "Preview",
    starred: false,
    subject: "Board packet",
    to: [{ address: "me@example.com", name: null }],
    unread: true,
    updatedAt: now,
  };

  it("strips body text, recipients and the provider thread identifier", () => {
    const summary = mailThreadSummarySchema.parse(thread);

    expect(summary).toEqual({
      accountId,
      from: thread.from,
      id: draftId,
      mailboxIds: [accountId],
      messageCount: 2,
      provider: "google",
      receivedAt: now,
      snippet: "Preview",
      starred: false,
      subject: "Board packet",
      unread: true,
      updatedAt: now,
    });
  });

  it("leaves the full thread contract used by the web client unchanged", () => {
    expect(mailThreadSchema.parse(thread)).toEqual(thread);
    for (const field of ["bodyText", "remoteThreadId", "to"]) {
      const { [field]: _omitted, ...partial } = thread as Record<string, unknown>;
      expect(mailThreadSchema.safeParse(partial).success).toBe(false);
    }
  });

  it("requires both cursor fields together and keeps the list filters", () => {
    expect(mailSummaryQuerySchema.parse({ mailboxRole: "inbox", unread: "true" })).toEqual({
      limit: 100,
      mailboxRole: "inbox",
      unread: true,
    });
    expect(
      mailSummaryQuerySchema.parse({ beforeId: draftId, beforeReceivedAt: now, limit: "50" }),
    ).toEqual({ beforeId: draftId, beforeReceivedAt: now, limit: 50 });
    expect(mailSummaryQuerySchema.safeParse({ beforeId: draftId }).success).toBe(false);
    expect(mailSummaryQuerySchema.safeParse({ beforeReceivedAt: now }).success).toBe(false);
  });
});

describe("Mail domain", () => {
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
