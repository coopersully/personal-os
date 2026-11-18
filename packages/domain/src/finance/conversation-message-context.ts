import { z } from "zod";
import { idSchema } from "../common.js";
import { financeConversationMessageSchema } from "./conversation.js";

/** Bounded owner-only source lookup, separate from agent batches and rendered cursors. */
export const financeConversationMessageContextSchema = z
  .object({
    targetMessageId: idSchema,
    messages: z.array(financeConversationMessageSchema).min(1).max(21),
  })
  .strict();
export type FinanceConversationMessageContext = z.infer<
  typeof financeConversationMessageContextSchema
>;
