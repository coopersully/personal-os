import { z } from "zod";
import { idSchema, isoDateTimeSchema } from "./common.js";
export const desktopActivityQuerySchema = z.object({
  cursor: z
    .string()
    .regex(/^\d{1,19}$/)
    .optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export const desktopActivitySchema = z.object({
  id: z.string(),
  kind: z.literal("mail_received"),
  accountId: idSchema,
  threadId: idSchema,
  receivedAt: isoDateTimeSchema,
  subject: z.string(),
  sender: z.string(),
});
export const desktopActivityPageSchema = z.object({
  events: z.array(desktopActivitySchema),
  cursor: z.string(),
  hasMore: z.boolean(),
});
export type DesktopActivityPage = z.infer<typeof desktopActivityPageSchema>;
