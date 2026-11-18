import { createFinanceConversationUnreadApi } from "./finance-conversation-unread.js";
import type { FinanceRequest } from "./finances.js";

it("keeps unread state owner-derived with exact decimal strings", async () => {
  const result = {
    unreadCount: "1",
    readThroughSequence: "9007199254740993",
    latestAgentSequence: "9007199254740994",
  };
  const request = vi.fn(async () => result) as unknown as FinanceRequest;
  expect(await createFinanceConversationUnreadApi(request).getFinanceConversationUnread()).toEqual(
    result,
  );
  expect(request).toHaveBeenCalledWith("/v1/finances/conversation/unread");
});
