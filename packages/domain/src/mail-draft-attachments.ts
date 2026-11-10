import { z } from "zod";
import { idSchema } from "./common.js";
export const MAIL_ATTACHMENT_LIMIT = 10 * 1024 * 1024;
export const MAIL_ATTACHMENT_COUNT = 10;
export const mailDraftAttachmentSchema = z.object({
  id: z.string().min(1).max(1024),
  filename: z
    .string()
    .min(1)
    .max(255)
    .refine(
      (name) => !/[\\/\p{Cc}]/u.test(name) && name !== "." && name !== "..",
      "Use a plain filename.",
    ),
  contentType: z
    .string()
    .max(200)
    .regex(/^[\w!#$&^.+-]+\/[\w!#$&^.+-]+$/),
  size: z.number().int().min(0).max(MAIL_ATTACHMENT_LIMIT),
});
export type MailDraftAttachment = z.infer<typeof mailDraftAttachmentSchema>;
export const mailDraftAttachmentInputSchema = mailDraftAttachmentSchema
  .extend({
    data: z
      .string()
      .max(Math.ceil(MAIL_ATTACHMENT_LIMIT / 3) * 4)
      .regex(/^[A-Za-z0-9+/]*={0,2}$/)
      .refine((data) => data.length % 4 === 0, "Invalid base64 content.")
      .optional(),
    source: z.object({ messageId: idSchema, attachmentId: z.string().min(1).max(1024) }).optional(),
  })
  .refine(
    (file) => file.data === undefined || file.source === undefined,
    "Choose one attachment source.",
  );
export type MailDraftAttachmentInput = z.infer<typeof mailDraftAttachmentInputSchema>;
export type StoredMailDraftAttachment = MailDraftAttachment & { data: string };
export const mailDraftAttachmentsInputSchema = z
  .array(mailDraftAttachmentInputSchema)
  .max(MAIL_ATTACHMENT_COUNT)
  .refine(
    (files) => new Set(files.map((f) => f.id)).size === files.length,
    "Attachment IDs must be unique.",
  )
  .refine(
    (files) => files.reduce((sum, f) => sum + f.size, 0) <= MAIL_ATTACHMENT_LIMIT,
    "Attachments must total 10 MB or less.",
  );
