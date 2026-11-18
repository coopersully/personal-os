import { z } from "zod";
import { financeConversationSequenceSchema } from "./conversation.js";

/** Human rendered state only; host delivery/acknowledgment never marks history read. */
export const financeConversationUnreadSchema = z.strictObject({
  unreadCount: financeConversationSequenceSchema,
  readThroughSequence: financeConversationSequenceSchema,
  latestAgentSequence: financeConversationSequenceSchema,
});
export type FinanceConversationUnread = z.infer<typeof financeConversationUnreadSchema>;
