import { useQuery } from "@tanstack/react-query";
import { api } from "../../api.js";

type Tokens = Awaited<ReturnType<typeof api.listAccessTokens>>;
type Clients = Awaited<ReturnType<typeof api.listOAuthClients>>;

/** Match Connected agents: connected OAuth hosts plus used, unexpired local credentials. */
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
  const connectors = useQuery({ enabled, queryKey: ["connectors"], queryFn: api.listConnectors });
  const bookmarks = useQuery({
    enabled,
    queryKey: ["x-bookmarks", "account"],
    queryFn: api.getXBookmarkAccount,
  });
  const tokens = useQuery({ enabled, queryKey: ["tokens"], queryFn: api.listAccessTokens });
  const clients = useQuery({ enabled, queryKey: ["oauth-clients"], queryFn: api.listOAuthClients });
  return {
    connections:
      enabled && connectors.isSuccess && bookmarks.isSuccess
        ? connectors.data.length + (bookmarks.data ? 1 : 0)
        : undefined,
    "agent-connections":
      enabled && tokens.isSuccess && clients.isSuccess
        ? connectedAgentCount(tokens.data, clients.data, Date.now())
        : undefined,
  };
}
