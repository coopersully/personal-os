import { useQuery } from "@tanstack/react-query";
import { api } from "../../api.js";

import { boundAgentAccountIds, useAgentAccountDirectory } from "./agent-account-query";

type Tokens = Awaited<ReturnType<typeof api.listAccessTokens>>;
type Clients = Awaited<ReturnType<typeof api.listOAuthClients>>;

/** Credential connection count; never use this as the shared agent-account count. */
export function connectedAgentCount(
  tokens: ReadonlyArray<Pick<Tokens[number], "lastUsedAt" | "revokedAt" | "expiresAt">>,
  clients: ReadonlyArray<Pick<Clients[number], "id">>,
  now: number,
) {
  return (
    clients.length +
    tokens.filter(
      (token) =>
        token.lastUsedAt !== null &&
        token.revokedAt === null &&
        (token.expiresAt === null || new Date(token.expiresAt).getTime() > now),
    ).length
  );
}

export function useSettingsSidebarCounts(enabled: boolean) {
  const goals = useQuery({ enabled, queryKey: ["goals"], queryFn: api.listGoals });
  const motives = useQuery({ enabled, queryKey: ["motives"], queryFn: api.listMotives });
  const connectors = useQuery({ enabled, queryKey: ["connectors"], queryFn: api.listConnectors });
  const bookmarks = useQuery({
    enabled,
    queryKey: ["x-bookmarks", "account"],
    queryFn: api.getXBookmarkAccount,
  });
  const agents = useAgentAccountDirectory(enabled);
  return {
    goals:
      enabled && goals.isSuccess && motives.isSuccess
        ? goals.data.length + motives.data.length
        : undefined,
    motives: enabled && motives.isSuccess ? motives.data.length : undefined,
    connections:
      enabled && connectors.isSuccess && bookmarks.isSuccess
        ? connectors.data.length + (bookmarks.data ? 1 : 0)
        : undefined,
    "agent-connections":
      enabled && agents.isSuccess ? boundAgentAccountIds(agents.data).size : undefined,
  };
}
