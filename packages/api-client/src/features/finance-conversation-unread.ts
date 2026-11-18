import type { FinanceConversationUnread } from "@personal-os/domain";
import type { FinanceRequest } from "./finances.js";

export function createFinanceConversationUnreadApi(request: FinanceRequest) {
  return {
    getFinanceConversationUnread(): Promise<FinanceConversationUnread> {
      return request("/v1/finances/conversation/unread");
    },
  };
}
