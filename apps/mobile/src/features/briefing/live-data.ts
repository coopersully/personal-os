import { localDateAt, localDateTimeToUtc } from "@personal-os/domain";
import { useQuery } from "@tanstack/react-query";
import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { toast } from "sonner-native";
import { useAuth } from "../auth/context";
import { upcomingScope } from "../finances/presentation";

export function useTodayData() {
  const { session, state } = useAuth();
  const api = session.api();
  const owner = state.user?.id;
  const timezone = state.user?.planningTimezone;
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);
  const range = timezone ? upcomingScope(timezone, now) : null;
  const start = timezone
    ? localDateTimeToUtc(localDateAt(now, timezone), 0, timezone).toISOString()
    : undefined;
  const common = {
    enabled: !!owner && !!timezone,
    staleTime: 30_000,
    refetchInterval: 60_000,
    meta: { scopedReadFeedback: true },
  };
  const tasks = useQuery({
    ...common,
    queryKey: ["today", owner, "tasks", range?.from],
    queryFn: () => api.listTaskWorkspace({ view: "today", status: "open", sort: "auto", limit: 3 }),
  });
  const overdue = useQuery({
    ...common,
    queryKey: ["today", owner, "overdue", range?.from],
    queryFn: () =>
      api.listTaskWorkspace({ view: "today", status: "open", due: "overdue", limit: 1 }),
  });
  const nextTasks = useQuery({
    ...common,
    queryKey: ["today", owner, "upcoming", range?.from],
    queryFn: () =>
      api.listTaskWorkspace({ view: "upcoming", status: "open", sort: "date", limit: 3 }),
  });
  const reviews = useQuery({
    ...common,
    queryKey: ["finances", owner, "attention"],
    queryFn: () => api.getFinanceAttention(),
  });
  const budgets = useQuery({
    ...common,
    queryKey: ["finances", owner, "budget-status", range?.from.slice(0, 7)],
    queryFn: () => api.getFinanceBudgetStatus(range?.from.slice(0, 7)),
  });
  const upcoming = useQuery({
    ...common,
    queryKey: ["finances", owner, "upcoming", range],
    queryFn: () => {
      if (!range) throw new Error("Timezone missing");
      return api.listFinanceRecurringOccurrences(range);
    },
  });
  const activity = useQuery({
    ...common,
    queryKey: ["today", owner, "agent-activity", start],
    queryFn: () =>
      api.listFinanceActivity({ actor: "agent", type: "financial_action", from: start, limit: 30 }),
  });
  const reads = [tasks, overdue, nextTasks, reviews, budgets, upcoming, activity];
  const latest = useRef(reads);
  latest.current = reads;
  const refetch = useCallback(async () => {
    setNow(new Date());
    return Promise.all(latest.current.map((query) => query.refetch()));
  }, []);
  useFocusEffect(
    useCallback(() => {
      if (!owner || !timezone) return;
      void refetch();
      const listener = AppState.addEventListener("change", (status) => {
        if (status === "active") void refetch();
      });
      return () => listener.remove();
    }, [owner, timezone, refetch]),
  );
  const failed = reads.some((query) => query.isError);
  const feedback = useRef<"manual" | "error" | "success" | null>(null);
  const feedbackId = `today-read-${owner}`;
  const feedbackOwner = useRef(owner);
  feedbackOwner.current = owner;
  const feedbackGeneration = useRef(0);
  const refresh = async () => {
    if (feedback.current === "manual") return;
    const generation = feedbackGeneration.current;
    feedback.current = "manual";
    toast.loading("Refreshing Today…", { id: feedbackId });
    const results = await refetch();
    if (feedbackOwner.current !== owner || feedbackGeneration.current !== generation) return;
    if (results.some((result) => result.isError)) {
      feedback.current = "error";
      toast.error("Some of Today couldn’t refresh. Try again when your connection is available.", {
        id: feedbackId,
        action: { label: "Retry", onClick: () => void refreshRef.current() },
      });
    } else {
      feedback.current = "success";
      toast.success("Today refreshed", { id: feedbackId });
    }
  };
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  useEffect(() => {
    if (feedback.current === "manual") return;
    if (failed && feedback.current !== "error") {
      feedback.current = "error";
      toast.error("Some of Today couldn’t refresh.", {
        id: feedbackId,
        action: { label: "Retry", onClick: () => void refreshRef.current() },
      });
    } else if (!failed && feedback.current === "error") {
      feedback.current = null;
      toast.dismiss(feedbackId);
    }
  }, [failed, feedbackId]);
  useEffect(
    () => () => {
      feedbackGeneration.current++;
      feedback.current = null;
      toast.dismiss(feedbackId);
    },
    [feedbackId],
  );
  return {
    owner,
    timezone,
    now,
    range,
    start,
    tasks,
    overdue,
    nextTasks,
    reviews,
    budgets,
    upcoming,
    activity,
    failed,
    loading: reads.some((query) => query.isPending),
    refreshing: reads.some((query) => query.isFetching),
    updatedAt: Math.min(...reads.map((query) => query.dataUpdatedAt)),
    refresh,
  };
}
