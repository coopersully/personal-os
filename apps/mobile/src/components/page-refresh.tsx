import { useContext, useEffect, useRef, useState } from "react";
import { RefreshControl } from "react-native";
import { toast } from "sonner-native";
import { useTheme } from "../theme";

import { RefreshClient, RefreshScope } from "./refresh-context";

export { RefreshClient, RefreshScope } from "./refresh-context";
/** Refresh server reads only; never reset local form state or replay a mutation. */
export function usePageRefresh(scope?: readonly string[], custom?: () => Promise<unknown>) {
  const client = useContext(RefreshClient);
  const inherited = useContext(RefreshScope);
  const roots = scope ?? inherited;
  const busy = useRef(false);
  const live = useRef(true);
  const [refreshing, setRefreshing] = useState(false);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  const refresh = async () => {
    if (busy.current) return;
    busy.current = true;
    setRefreshing(true);
    try {
      if (custom) {
        await custom();
        return;
      }
      const queries =
        client?.getQueryCache().findAll({
          type: "active",
          predicate: (query) => roots.includes(String(query.queryKey[0])),
        }) ?? [];
      if (!queries.length) return;
      await client?.refetchQueries(
        { type: "active", predicate: (query) => queries.includes(query) },
        { throwOnError: true },
      );
    } catch {
      if (live.current) toast.error("Couldn’t refresh. Pull down to try again.");
    } finally {
      busy.current = false;
      if (live.current) setRefreshing(false);
    }
  };
  return { refreshing, refresh, enabled: !!client || !!custom };
}
export function PageRefreshControl({
  scope,
  onRefresh,
  offset = 0,
}: {
  scope?: readonly string[];
  onRefresh?: () => Promise<unknown>;
  offset?: number;
}) {
  const t = useTheme();
  const refresh = usePageRefresh(scope, onRefresh);
  return (
    <RefreshControl
      enabled={refresh.enabled}
      refreshing={refresh.refreshing}
      onRefresh={() => void refresh.refresh()}
      progressViewOffset={offset}
      tintColor={t.ink}
    />
  );
}
