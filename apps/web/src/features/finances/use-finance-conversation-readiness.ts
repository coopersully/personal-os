import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api.js";
import { sameSession, usePreferenceSession } from "../workspace-settings/account-save-session.js";

/** Both Finance surfaces read the same owner-bound effective readiness. Never a grant. */
export function useFinanceConversationReadiness(scheduleId?: string) {
  const client = useQueryClient();
  const session = usePreferenceSession(client);
  return useQuery({
    queryKey: scheduleId
      ? ["finance-conversation-host-readiness", scheduleId, session.owner, session.epoch]
      : ["finance-conversation-readiness", session.owner, session.epoch],
    enabled: Boolean(session.owner),
    queryFn: async () => {
      const result = scheduleId
        ? await api.getFinanceConversationHostReadiness(scheduleId)
        : await api.getFinanceConversationReadiness();
      if (!sameSession(client, session)) throw new Error("Your account session changed.");
      return result;
    },
    refetchInterval: 30_000,
  });
}
