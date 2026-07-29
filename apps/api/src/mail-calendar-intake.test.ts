import { type MailAttachment, mailCalendarCommitmentIntakeSchema } from "@personal-os/domain";
import {
  calendarCommitmentAttachmentCandidates,
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
    expect(
      isCalendarCommitmentAttachment({
        ...calendarAttachment,
        contentType: "application/x-ilo-calendar-projection-overflow",
        projectionIssue: "calendar_attachment_projection_overflow",
      }),
    ).toBe(true);
  });

  it("collapses untrusted intake fanout to one redacted overflow candidate", () => {
    const oversized = Array.from({ length: 17 }, (_, index) => ({
      ...calendarAttachment,
      filename: `attacker-${String(index)}.ics`,
      id: `part-${String(index)}`,
    }));
    expect(
      calendarCommitmentAttachmentCandidates(oversized, "message-1:projection-overflow"),
    ).toEqual([
      {
        contentType: "application/x-ilo-calendar-projection-overflow",
        filename: "",
        id: "message-1:projection-overflow",
        projectionIssue: "calendar_attachment_projection_overflow",
        providerAttachmentId: null,
        providerPartId: "message-1:projection-overflow",
        size: 0,
      },
    ]);
    expect(
      JSON.stringify(
        calendarCommitmentAttachmentCandidates(oversized, "message-1:projection-overflow"),
      ),
    ).not.toContain("attacker-");
    expect(
      calendarCommitmentAttachmentCandidates(
        [
          {
            ...calendarAttachment,
            contentType: "application/x-ilo-calendar-projection-overflow",
            id: "attacker-controlled-id",
            projectionIssue: "calendar_attachment_projection_overflow",
            providerPartId: "attacker-controlled-part",
          },
        ],
        "canonical-overflow-id",
      ),
    ).toEqual([
      expect.objectContaining({
        id: "canonical-overflow-id",
        providerPartId: "canonical-overflow-id",
      }),
    ]);
  });

  it("records one redacted preview intake and audit for excessive calendar parts", async () => {
    const intakeWrites: Array<Record<string, unknown>> = [];
    const auditWrites: Array<Record<string, unknown>> = [];
    const transaction = {
      execute: vi.fn(async () => undefined),
      insert: vi.fn(() => ({
        values: vi.fn((value: Record<string, unknown>) => {
          if ("remotePartId" in value) {
            intakeWrites.push(value);
            return {
              returning: vi.fn(async () => [
                {
                  ...value,
                  createdAt: new Date("2026-07-29T12:00:00.000Z"),
                  id: "intake-1",
                  updatedAt: new Date("2026-07-29T12:00:00.000Z"),
                },
              ]),
            };
          }
          auditWrites.push(value);
          return Promise.resolve();
        }),
      })),
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({ for: vi.fn(async () => []) })),
        })),
      })),
    };
    const attachments = Array.from({ length: 17 }, (_, index) => ({
      ...calendarAttachment,
      filename: `attacker-${String(index)}.ics`,
      id: `part-${String(index)}`,
    }));
    const input = {
      accountId: "account-1",
      message: {
        attachments,
        bodyText: "Calendar attachments",
        cc: [],
        from: { address: "organizer@example.com", name: null },
        id: "message-row-1",
        providerMailboxIds: ["INBOX"],
        providerRevision: "history-1",
        receivedAt: new Date("2026-07-29T12:00:00.000Z"),
        remoteMessageId: "message-1",
        threadId: "thread-1",
        to: [],
      } as never,
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
        remoteThreadId: "remote-thread-1",
        updatedAt: new Date("2026-07-29T12:00:00.000Z"),
        userId: "user-1",
      } as never,
    };
    await expect(
      recordMailCalendarCommitmentIntakes(transaction as never, {
        ...input,
        message: {
          ...input.message,
          attachments: [{ ...calendarAttachment, providerPartId: null }],
          remoteMessageId: "message-with-id-fallback",
        } as never,
      }),
    ).resolves.toBe(1);
    await expect(recordMailCalendarCommitmentIntakes(transaction as never, input)).resolves.toBe(1);
    expect(intakeWrites).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          evidenceKind: "calendar_attachment_metadata",
          remoteMessageId: "message-with-id-fallback",
          remotePartId: "part-1",
        }),
        expect.objectContaining({
          attachment: expect.objectContaining({
            filename: "",
            projectionIssue: "calendar_attachment_projection_overflow",
          }),
          authority: "provider_projected_unverified",
          evidenceKind: "calendar_attachment_projection_overflow",
          remotePartId: expect.stringMatching(/^projection-overflow:[0-9a-f]{64}$/),
          status: "preview_only",
        }),
      ]),
    );
    expect(auditWrites).toHaveLength(2);
    expect(JSON.stringify({ auditWrites, intakeWrites })).not.toContain("attacker-");
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
