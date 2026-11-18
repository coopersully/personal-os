import { ApiClientError } from "@personal-os/api-client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api } from "../../api.js";

/** The session key is a renderer mount identity, never a credential. */
export function useFinanceConversationUnread(ownerId: string, sessionKey: string) {
  const client = useQueryClient();
  const identity = `${ownerId}:${sessionKey}`;
  const [deniedIdentity, setDeniedIdentity] = useState<string>();
  const query = useQuery({
    queryKey: ["finance-conversation-unread", ownerId, sessionKey],
    queryFn: () => api.getFinanceConversationUnread(),
    enabled: deniedIdentity !== identity,
    retry: false,
    refetchInterval: 30_000,
  });
  const denied = query.error instanceof ApiClientError && [401, 403].includes(query.error.status);
  useEffect(() => {
    if (!denied) return;
    setDeniedIdentity(identity);
    client.removeQueries({ queryKey: ["finance-conversation-unread", ownerId] });
  }, [client, denied, identity, ownerId]);
  return denied || deniedIdentity === identity ? undefined : query.data;
}
