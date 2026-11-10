import {
  MAIL_ATTACHMENT_LIMIT,
  type MailDraftAttachmentInput,
  mailDraftAttachmentSchema,
  mailDraftAttachmentsInputSchema,
  type StoredMailDraftAttachment,
} from "@personal-os/domain";
import { AppError } from "../errors.js";

type Download = (
  messageId: string,
  attachmentId: string,
  signal?: AbortSignal,
) => Promise<{ filename: string; contentType: string; data: string; size: number }>;
/** Resolve bytes before the draft commit; a failed copy never saves a partial attachment list. */
export async function resolveDraftAttachments(
  input: MailDraftAttachmentInput[] | undefined,
  existing: StoredMailDraftAttachment[],
  download: Download,
  signal?: AbortSignal,
): Promise<StoredMailDraftAttachment[]> {
  if (input === undefined) return existing;
  const files = mailDraftAttachmentsInputSchema.parse(input);
  const resolved: StoredMailDraftAttachment[] = [];
  let total = 0;
  const deadline = AbortSignal.any([AbortSignal.timeout(25_000), ...(signal ? [signal] : [])]);
  for (const file of files) {
    deadline.throwIfAborted();
    const previous = existing.find((item) => item.id === file.id);
    let stored: StoredMailDraftAttachment;
    if (previous) stored = previous;
    else if (file.source) {
      const content = await download(file.source.messageId, file.source.attachmentId, deadline);
      stored = {
        ...content,
        id: file.id,
        contentType: (content.contentType.split(";")[0] ?? "").trim() || "application/octet-stream",
      };
    } else if (file.data !== undefined) {
      const bytes = Buffer.from(file.data, "base64");
      if (bytes.length !== file.size || bytes.toString("base64") !== file.data)
        throw new AppError("invalid_request", "The attachment content or size is invalid.");
      stored = {
        id: file.id,
        filename: file.filename,
        contentType: file.contentType,
        size: bytes.length,
        data: file.data,
      };
    } else
      throw new AppError(
        "invalid_request",
        "This attachment is not part of your saved draft. Add it again.",
      );
    mailDraftAttachmentSchema.parse(stored);
    const bytes = Buffer.from(stored.data, "base64");
    if (bytes.length !== stored.size || bytes.toString("base64") !== stored.data)
      throw new AppError("invalid_request", "The attachment content or size is invalid.");
    total += stored.size;
    if (total > MAIL_ATTACHMENT_LIMIT)
      throw new AppError("invalid_request", "Attachments must total 10 MB or less.");
    resolved.push(stored);
  }
  return resolved;
}
