import { type MailAttachment, mailCalendarCommitmentIntakeSchema } from "@personal-os/domain";
import {
  isCalendarCommitmentAttachment,
  mailCommitmentSourceFingerprint,
  reconcileMissingMailCalendarCommitmentMessages,
  recordMailCalendarCommitmentIntakes,
} from "./mail-calendar-intake.js";

describe("Mail-to-Calendar intake evidence", () => {
  const calendarAttachment: MailAttachment = {
    contentType: "text/calendar; method=REQUEST",
    filename: "invite.ics",
    id: "part-1",
    size: 100,
  };

  it("recognizes only structured calendar attachment metadata", () => {
    expect(isCalendarCommitmentAttachment(calendarAttachment)).toBe(true);
    expect(
      isCalendarCommitmentAttachment({
        ...calendarAttachment,
        contentType: "application/ics",
      }),
    ).toBe(true);
    expect(
      isCalendarCommitmentAttachment({
        ...calendarAttachment,
        contentType: "text/plain",
      }),
    ).toBe(false);
    expect(
      isCalendarCommitmentAttachment({
        ...calendarAttachment,
        contentType: "application/pdf",
      }),
    ).toBe(false);
  });

  it("binds the handoff revision to exact cached message material", () => {
    const message = {
      attachments: [calendarAttachment],
      bodyText: "BEGIN:VCALENDAR",
      cc: [],
      from: { address: "organizer@example.com", name: null },
      providerMailboxIds: ["INBOX"],
      providerRevision: "history-1",
      receivedAt: new Date("2026-07-29T12:00:00.000Z"),
      remoteMessageId: "message-1",
      to: [{ address: "person@example.com", name: null }],
    };
    const first = mailCommitmentSourceFingerprint(message);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(mailCommitmentSourceFingerprint({ ...message })).toBe(first);
    expect(mailCommitmentSourceFingerprint({ ...message, bodyText: "changed" })).not.toBe(first);
    expect(
      mailCommitmentSourceFingerprint({
        ...message,
        attachments: [{ ...calendarAttachment, size: 101 }],
      }),
    ).not.toBe(first);
  });

  it("keeps unverified intake out of executable lifecycle states", () => {
    const intake = {
      accountId: "11111111-1111-4111-8111-111111111111",
      attachment: calendarAttachment,
      authority: "provider_projected_unverified",
      createdAt: "2026-07-29T12:00:00.000Z",
      evidenceKind: "calendar_attachment_metadata",
      id: "22222222-2222-4222-8222-222222222222",
      idempotencyKey: "a".repeat(64),
      providerAccountAddressHintHash: "b".repeat(64),
      remoteMessageId: "message-1",
      remotePartId: "part-1",
      remoteThreadId: "thread-1",
      sourceFingerprint: "c".repeat(64),
      sourceMessageId: null,
      sourceMessageMailboxIds: ["INBOX"],
      sourceMessageRevision: "history-1",
      sourceThreadId: null,
      sourceThreadRevision: "2026-07-29T12:00:00.000Z",
      status: "preview_only",
    };
    expect(mailCalendarCommitmentIntakeSchema.safeParse(intake).success).toBe(true);
    expect(
      mailCalendarCommitmentIntakeSchema.safeParse({ ...intake, status: "succeeded" }).success,
    ).toBe(false);
    expect(
      mailCalendarCommitmentIntakeSchema.safeParse({
        ...intake,
        authority: "server_verified",
        status: "pending",
      }).success,
    ).toBe(true);
  });

  it("rejects missing-message reconciliation across user or account topology", async () => {
    const input = {
      accountId: "account-1",
      observedRemoteMessageIds: new Set<string>(),
      principal: {
        actorId: "connector-1",
        actorType: "connector" as const,
        userId: "user-1",
      },
      reconciledAt: new Date("2026-07-29T12:00:00.000Z"),
      requestId: "request-1",
      thread: {
        accountId: "account-1",
        userId: "user-1",
      },
    };
    await expect(
      reconcileMissingMailCalendarCommitmentMessages({} as never, {
        ...input,
        thread: { ...input.thread, userId: "user-2" } as never,
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      reconcileMissingMailCalendarCommitmentMessages({} as never, {
        ...input,
        thread: { ...input.thread, accountId: "account-2" } as never,
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
  });

  it("rejects intake recording across user, account, or message topology", async () => {
    const input = {
      accountId: "account-1",
      message: { threadId: "thread-1" },
      principal: {
        actorId: "connector-1",
        actorType: "connector" as const,
        userId: "user-1",
      },
      providerAccountAddressHint: null,
      recordedAt: new Date("2026-07-29T12:00:00.000Z"),
      requestId: "request-1",
      thread: {
        accountId: "account-1",
        id: "thread-1",
        userId: "user-1",
      },
    };
    await expect(
      recordMailCalendarCommitmentIntakes({} as never, {
        ...input,
        message: input.message as never,
        thread: { ...input.thread, userId: "user-2" } as never,
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      recordMailCalendarCommitmentIntakes({} as never, {
        ...input,
        message: input.message as never,
        thread: { ...input.thread, accountId: "account-2" } as never,
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      recordMailCalendarCommitmentIntakes({} as never, {
        ...input,
        message: { threadId: "thread-2" } as never,
        thread: input.thread as never,
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
  });
});
