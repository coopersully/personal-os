import type { AgentAccountDirectory } from "@personal-os/domain";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api.js";
import { sameSession, usePreferenceSession } from "../workspace-settings/account-save-session";

export function useAgentAccountDirectory(enabled = true) {
  const cache = useQueryClient();
  const session = usePreferenceSession(cache);
  return useQuery({
    queryKey: ["agent-accounts", session.owner, session.epoch],
    enabled: enabled && !!session.owner,
    queryFn: async () => {
      const result = await api.listAgentAccounts();
      if (!sameSession(cache, session)) throw new Error("Your account session changed.");
      return result;
    },
  });
}

export function boundAgentAccountIds(directory: AgentAccountDirectory) {
  return new Set(
    directory.connections.flatMap((connection) =>
      connection.agentAccountId ? [connection.agentAccountId] : [],
    ),
  );
}
