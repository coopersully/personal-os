import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useFocusEffect } from "expo-router";
import { useCallback, useRef } from "react";
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
    staleTime: 30_000,
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
  return { ...query, scope, configurationMissing: !timezone };
}

export function useUpcoming() {
  const { timezone } = useFinance();
  const scope = timezone ? upcomingScope(timezone) : null;
  const query = useFinanceRead(
    ["upcoming", scope],
    (api) => {
      if (!scope) throw new Error("Your account timezone is unavailable.");
      return api.listFinanceRecurringOccurrences(scope);
    },
    !!scope,
  );
  return { ...query, configurationMissing: !timezone };
}

/** Native tabs remain mounted; revalidate their owner-scoped records on return. */
export function useFinanceRefresh(keys: readonly string[]) {
  const { owner } = useFinance();
  const client = useQueryClient();
  useFocusEffect(
    useCallback(() => {
      if (!owner) return;
      const refresh = () => {
        for (const key of keys)
          void client.refetchQueries({
            queryKey: ["finances", owner, key],
            type: "active",
            stale: true,
          });
      };
      refresh();
      const listener = AppState.addEventListener("change", (state) => {
        if (state === "active") refresh();
      });
      return () => listener.remove();
    }, [client, owner, keys]),
  );
}

/** Poll saved work only while its screen is focused and the app is foregrounded. */
export function useFinancePoll(enabled: boolean, reads: Array<() => Promise<unknown>>) {
  const { owner } = useFinance();
  const currentReads = useRef(reads);
  currentReads.current = reads;
  useFocusEffect(
    useCallback(() => {
      if (!enabled || !owner) return;
      let foreground = AppState.currentState === "active";
      const refresh = () => {
        if (foreground) for (const read of currentReads.current) void read();
      };
      const timer = setInterval(refresh, 5_000);
      const listener = AppState.addEventListener("change", (state) => {
        foreground = state === "active";
        if (foreground) refresh();
      });
      return () => {
        clearInterval(timer);
        listener.remove();
      };
    }, [enabled, owner]),
  );
}
