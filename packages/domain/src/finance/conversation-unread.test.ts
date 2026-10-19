import { financeConversationUnreadSchema } from "./conversation-unread.js";

it("preserves exact bigint strings and rejects numbers, noncanonical decimals and owner overrides", () => {
  const result = {
    unreadCount: "2",
    readThroughSequence: "9007199254740993",
    latestAgentSequence: "9223372036854775807",
  };
  expect(financeConversationUnreadSchema.parse(result)).toEqual(result);
  for (const value of ["-1", "01", "1.5", "9223372036854775808", 2])
    expect(
      financeConversationUnreadSchema.safeParse({ ...result, unreadCount: value }).success,
    ).toBe(false);
  expect(financeConversationUnreadSchema.safeParse({ ...result, userId: "foreign" }).success).toBe(
    false,
  );
});
