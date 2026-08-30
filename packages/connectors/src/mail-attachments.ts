import { createHash } from "node:crypto";
import {
  calendarAttachmentProjectionOverflow,
  MAIL_CALENDAR_PROJECTION_OVERFLOW,
  MAX_MAIL_CALENDAR_PARTS_PER_MESSAGE,
  type MailAttachment,
} from "@personal-os/domain";

export const MAX_MAIL_ATTACHMENT_METADATA_LENGTH = 1_024;
// Bound traversal and projected JSON before provider MIME material reaches a database write.
export const MAX_MAIL_MIME_DEPTH = 24;
export const MAX_MAIL_MIME_PARTS_PER_MESSAGE = 256;
// iCloud does not expose Gmail-style attachment retrieval locators. Cap the raw
// RFC822 slice before parsing so a single message cannot make sync buffer an
// unbounded MIME tree or attachment body set.
export const MAX_MAIL_SOURCE_BYTES = 10 * 1_024 * 1_024;

export {
  calendarAttachmentProjectionOverflow,
  MAIL_CALENDAR_PROJECTION_OVERFLOW,
  MAX_MAIL_CALENDAR_PARTS_PER_MESSAGE,
};

export function redactedProjectionOverflowPartId(sourceIdentity: string): string {
  return `projection-overflow:${createHash("sha256").update(sourceIdentity).digest("hex")}`;
}

export function isCalendarMimeType(value: string): boolean {
  const [contentType = ""] = value.toLowerCase().split(";");
  return ["application/ics", "text/calendar", "text/x-vcalendar"].includes(contentType.trim());
}

export function mailAttachmentMetadataIsBounded(...values: Array<string | null | undefined>) {
  return values.every((value) => (value?.length ?? 0) <= MAX_MAIL_ATTACHMENT_METADATA_LENGTH);
}

export function boundFlatMailAttachments(
  attachments: ReadonlyArray<MailAttachment>,
  overflowPartId: string,
): MailAttachment[] {
  if (attachments.length > MAX_MAIL_MIME_PARTS_PER_MESSAGE) {
    return [calendarAttachmentProjectionOverflow(overflowPartId)];
  }
  let calendarParts = 0;
  for (const attachment of attachments) {
    if (
      !mailAttachmentMetadataIsBounded(
        attachment.contentType,
        attachment.filename,
        attachment.id,
        attachment.providerAttachmentId,
        attachment.providerPartId,
      )
    ) {
      return [calendarAttachmentProjectionOverflow(overflowPartId)];
    }
    if (
      isCalendarMimeType(attachment.contentType) &&
      ++calendarParts > MAX_MAIL_CALENDAR_PARTS_PER_MESSAGE
    ) {
      return [calendarAttachmentProjectionOverflow(overflowPartId)];
    }
  }
  return [...attachments];
}
