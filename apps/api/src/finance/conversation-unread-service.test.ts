import type { Database } from "@personal-os/database";
import { createFinanceConversationUnreadService } from "./conversation-unread-service.js";

it("returns one database snapshot without converting bigint strings to numbers", async () => {
  const row = {
    unreadCount: "1",
    readThroughSequence: "9007199254740993",
    latestAgentSequence: "9007199254740994",
  };
  const execute = vi.fn(async () => ({ rows: [row] }));
  const service = createFinanceConversationUnreadService({
    db: { execute } as unknown as Database,
  });
  expect(await service.readUnread("11111111-1111-4111-8111-111111111111")).toEqual(row);
  expect(execute).toHaveBeenCalledTimes(1);
  await expect(service.readUnread("not-an-owner-id")).rejects.toThrow();
  expect(execute).toHaveBeenCalledTimes(1);
});
