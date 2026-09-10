import type { MailAttachment } from "@personal-os/domain";
import {
  boundFlatMailAttachments,
  calendarAttachmentProjectionOverflow,
  MAIL_CALENDAR_PROJECTION_OVERFLOW,
  MAX_MAIL_ATTACHMENT_METADATA_LENGTH,
  MAX_MAIL_CALENDAR_PARTS_PER_MESSAGE,
  MAX_MAIL_MIME_PARTS_PER_MESSAGE,
  redactedProjectionOverflowPartId,
} from "./mail-attachments.js";

function attachment(index: number, contentType = "application/octet-stream"): MailAttachment {
  const partId = `INBOX:888:9:${String(index)}`;
  return {
    contentType,
    filename: `part-${String(index)}`,
    id: partId,
    providerAttachmentId: null,
    providerPartId: partId,
    size: 1,
  };
}

describe("Mail attachment projection bounds", () => {
  it("preserves bounded provider-native attachment identities", () => {
    expect(boundFlatMailAttachments([attachment(3, "text/calendar")], "overflow")).toEqual([
      attachment(3, "text/calendar"),
    ]);
  });

  it.each([
    {
      attachments: Array.from({ length: MAX_MAIL_MIME_PARTS_PER_MESSAGE + 1 }, (_, index) =>
        attachment(index),
      ),
      name: "part count",
    },
    {
      attachments: Array.from({ length: MAX_MAIL_CALENDAR_PARTS_PER_MESSAGE + 1 }, (_, index) =>
        attachment(index, "text/calendar"),
      ),
      name: "calendar part count",
    },
    {
      attachments: [
        {
          ...attachment(0, "text/calendar"),
          filename: "x".repeat(MAX_MAIL_ATTACHMENT_METADATA_LENGTH + 1),
        },
      ],
      name: "metadata length",
    },
  ])("collapses excessive $name to one redacted marker", ({ attachments }) => {
    expect(boundFlatMailAttachments(attachments, "INBOX:888:9:projection-overflow")).toEqual([
      calendarAttachmentProjectionOverflow("INBOX:888:9:projection-overflow"),
    ]);
    expect(
      JSON.stringify(boundFlatMailAttachments(attachments, "INBOX:888:9:projection-overflow")),
    ).not.toContain("x".repeat(MAX_MAIL_ATTACHMENT_METADATA_LENGTH + 1));
  });

  it("uses one explicit non-executable projection issue", () => {
    expect(calendarAttachmentProjectionOverflow("provider-native:overflow")).toMatchObject({
      contentType: "application/x-ilo-calendar-projection-overflow",
      projectionIssue: MAIL_CALENDAR_PROJECTION_OVERFLOW,
      providerPartId: "provider-native:overflow",
      size: 0,
    });
  });

  it("derives stable overflow identity without retaining provider metadata", () => {
    const source = `${"attacker-controlled-mailbox".repeat(100)}:888:9`;
    const identity = redactedProjectionOverflowPartId(source);
    expect(identity).toMatch(/^projection-overflow:[0-9a-f]{64}$/);
    expect(identity).toBe(redactedProjectionOverflowPartId(source));
    expect(identity).not.toContain("attacker");
  });
});
