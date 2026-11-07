import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useFocusEffect } from "expo-router";
import { useCallback } from "react";
import { AppState } from "react-native";
import { useAuth } from "../auth/context";
import { periodScope, upcomingScope } from "./presentation";

export function useFinance() {
  const { session, state } = useAuth();
  return { api: session.api(), owner: state.user?.id, timezone: state.user?.planningTimezone };
}
export function useFinanceRead<T>(
  key: readonly unknown[],
  read: (api: ReturnType<typeof useFinance>["api"]) => Promise<T>,
  enabled = true,
) {
  const { api, owner } = useFinance();
  const queryKey = ["finances", owner, ...key];
  const query = useQuery({
    queryKey,
    meta: { scopedReadFeedback: true },
    queryFn: () => read(api),
    enabled: Boolean(owner) && enabled,
  });
  return { ...query, feedbackKey: JSON.stringify(queryKey) };
}
export function useSpending(period: "week" | "month") {
  const { timezone } = useFinance();
  const scope = timezone ? periodScope(period, timezone) : null;
  const query = useFinanceRead(
    ["spending", scope],
    (api) => {
      if (!scope) throw new Error("Your account timezone is unavailable.");
      return api.getFinanceSpending({ scope, grouping: "auto", includeUncategorized: true });
    },
    !!scope,
  );
  return { ...query, scope };
}

export function useUpcoming() {
  const { timezone } = useFinance();
  const scope = timezone ? upcomingScope(timezone) : null;
  return useFinanceRead(
    ["upcoming", scope],
    (api) => {
      if (!scope) throw new Error("Your account timezone is unavailable.");
      return api.listFinanceRecurringOccurrences(scope);
    },
    !!scope,
  );
}

/** Native tabs remain mounted; revalidate their owner-scoped records on return. */
export function useFinanceRefresh() {
  const { owner } = useFinance();
  const client = useQueryClient();
  useFocusEffect(
    useCallback(() => {
      if (!owner) return;
      const refresh = () => void client.invalidateQueries({ queryKey: ["finances", owner] });
      refresh();
      const listener = AppState.addEventListener("change", (state) => {
        if (state === "active") refresh();
      });
      return () => listener.remove();
    }, [client, owner]),
  );
}
