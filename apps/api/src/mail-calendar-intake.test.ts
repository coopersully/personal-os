import type { MailAttachment } from "@personal-os/domain";
import {
  isCalendarCommitmentAttachment,
  mailCommitmentSourceFingerprint,
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
});
