import type { FinanceSpendingScope } from "@personal-os/domain";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useFocusEffect } from "expo-router";
import { useCallback } from "react";
import { AppState } from "react-native";
import { useAuth } from "../auth/context";
import { upcomingScope } from "./presentation";
import { spendingRange, spendingToday } from "./spending-math";

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
/**
 * This month's spending on the fixed basis Overview and Budget state beside their figures: your
 * share, pending included, refunds subtracted. The Spending screen applies the saved preferences.
 */
export function useMonthSpending() {
  const { timezone } = useFinance();
  const scope: FinanceSpendingScope | null = timezone
    ? {
        ...spendingRange("month", spendingToday(timezone), "monday"),
        timezone,
        accountIds: null,
        categoryIds: null,
        basis: "personal_cost",
        includePending: true,
        subtractRefunds: true,
      }
    : null;
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
