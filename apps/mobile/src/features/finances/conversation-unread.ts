import { financeConversationUnreadSchema } from "@personal-os/domain";
import { useQuery } from "@tanstack/react-query";
import { useFinance } from "./data";

export const conversationUnreadKey = (owner: string | undefined) =>
  ["finances", owner, "conversation-unread"] as const;

/**
 * Unread agent messages in the Finance conversation. Undefined means unknown: a failed or
 * malformed read leaves the indicator absent, it never becomes "nothing unread".
 */
export function useConversationUnread() {
  const { api, owner } = useFinance();
  const query = useQuery({
    queryKey: conversationUnreadKey(owner),
    // A background poll. Its failure removes the indicator instead of raising a notice.
    meta: { scopedReadFeedback: true },
    queryFn: async () =>
      financeConversationUnreadSchema.parse(await api.getFinanceConversationUnread()),
    enabled: !!owner,
    retry: false,
    staleTime: 30_000,
    refetchInterval: 30_000,
  });
  if (query.isError || !query.data) return undefined;
  return {
    count: BigInt(query.data.unreadCount),
    readThrough: BigInt(query.data.readThroughSequence),
  };
}

export function unreadMessages(count: bigint) {
  return `${count > 99n ? "99+" : count} unread ${count === 1n ? "message" : "messages"}`;
}

/** The Assistant tab's badge, or nothing when no message is known to be unread. */
export function useAssistantBadge() {
  const unread = useConversationUnread();
  if (!unread || unread.count <= 0n) return undefined;
  return {
    value: unread.count > 99n ? "99+" : String(unread.count),
    label: unreadMessages(unread.count),
  };
}
