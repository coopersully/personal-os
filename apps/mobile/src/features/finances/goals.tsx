import { ApiClientError } from "@personal-os/api-client";
import type { FinanceGoal } from "@personal-os/domain";
import { useQueryClient } from "@tanstack/react-query";
import { randomUUID } from "expo-crypto";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Alert } from "react-native";
import { toast } from "sonner-native";
import { editorActionsOptions } from "../../components/editor-header";
import { Action, Actions } from "../../components/forms/form-rows";
import type { RowAction } from "../../components/row-action-button";
import { SettingsAccentProvider } from "../../components/settings-accent";
import { useTheme } from "../../theme";
import { useFinance, useFinanceRead } from "./data";
import {
  confirmedProgress,
  goalDate,
  goalPriorities,
  goalStatusLabel,
  goalSummary,
  goalTarget,
} from "./goal-progress";
import { confirmedRejection, localToday } from "./mutations";
import { formatMoney } from "./presentation";
import { Card, Copy, FinanceRow, FinanceScreen, Metric, ReadState, Section } from "./ui";

function useGoals() {
  const { owner, timezone } = useFinance();
  const query = useFinanceRead(["goals"], (api) => api.listFinanceGoals());
  return { query, owner, today: timezone ? localToday(timezone) : undefined };
}

/** Plan › Wealth: every goal that has not been removed, and the command that adds one. */
export function FinanceGoals() {
  const { query, owner, today } = useGoals();
  const goals = query.data?.data.filter((goal) => goal.status !== "removed") ?? [];
  return (
    <Section title="Goals">
      <SettingsAccentProvider workspace="finances">
        <Actions inset={false}>
          <Action
            label="Add"
            accessibilityLabel="Add goal"
            onPress={() => router.push("/finance-goal-edit")}
          />
        </Actions>
      </SettingsAccentProvider>
      <ReadState query={query}>
        {goals.length ? (
          <Card rows>
            {goals.map((goal) => {
              const progress = confirmedProgress(goal, owner, today);
              return (
                <FinanceRow
                  key={goal.id}
                  title={goal.name}
                  subtitle={goalSummary(goal, progress)}
                  value={progress?.percent == null ? undefined : `${progress.percent}%`}
                  icon="target"
                  onPress={() =>
                    router.push({ pathname: "/finance-goal", params: { id: goal.id } })
                  }
                />
              );
            })}
          </Card>
        ) : (
          <Card>
            <Copy secondary>No goals yet.</Copy>
          </Card>
        )}
      </ReadState>
    </Section>
  );
}

type Lifecycle = "pause" | "resume" | "complete" | "remove";
const lifecycleCopy: Record<Lifecycle, { loading: string; done: string; verb: string }> = {
  pause: { loading: "Pausing goal…", done: "Goal paused", verb: "pause" },
  resume: { loading: "Resuming goal…", done: "Goal resumed", verb: "resume" },
  complete: { loading: "Completing goal…", done: "Goal marked complete", verb: "complete" },
  remove: { loading: "Removing goal…", done: "Goal removed", verb: "remove" },
};

/** Top-right goal actions: edit, confirm progress, pause or resume, complete and remove. */
function GoalActions({ goal }: { goal: FinanceGoal }) {
  const t = useTheme();
  const { api, owner } = useFinance();
  const client = useQueryClient();
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  // An unconfirmed change keeps its key, so trying the same change again cannot act twice.
  const attempt = useRef<{ payload: string; key: string } | null>(null);
  const active = useRef(owner);
  useEffect(() => {
    active.current = owner;
    return () => {
      active.current = undefined;
    };
  }, [owner]);

  async function change(operation: Lifecycle) {
    if (!owner || busy.current) return;
    busy.current = true;
    setPending(true);
    const copy = lifecycleCopy[operation];
    const id = toast.loading(copy.loading);
    const input = { operation, goalId: goal.id, expectedVersion: goal.version };
    const payload = JSON.stringify(input);
    if (attempt.current?.payload !== payload) attempt.current = { payload, key: randomUUID() };
    const refresh = () => client.invalidateQueries({ queryKey: ["finances", owner] });
    try {
      const result = await api.manageFinanceGoal({ ...input, idempotencyKey: attempt.current.key });
      if (active.current !== owner) return void toast.dismiss(id);
      attempt.current = null;
      if (result.outcome !== "completed") {
        // The shown goal may be stale: the next attempt needs its latest version.
        await refresh();
        if (active.current !== owner) return void toast.dismiss(id);
        if (result.outcome === "failed") toast.error(result.communication.headline, { id });
        else toast.info(result.communication.headline, { id });
        return;
      }
      if (operation === "remove") {
        toast.success(copy.done, { id });
        // A removed goal has no page to stay on.
        router.back();
        void refresh();
        return;
      }
      // The actions stay disabled until the new version is on screen, so a second press
      // cannot send the version this change just replaced.
      await refresh();
      if (active.current !== owner) return void toast.dismiss(id);
      toast.success(copy.done, { id });
    } catch (error) {
      if (confirmedRejection(error)) attempt.current = null;
      // Rejected or unknown, the shown goal may be stale: re-read it before the next attempt.
      await refresh();
      if (active.current !== owner) return void toast.dismiss(id);
      toast.error(
        error instanceof ApiClientError && error.status === 409
          ? "This goal changed elsewhere. Review the latest version before trying again."
          : confirmedRejection(error)
            ? `Couldn’t ${copy.verb} this goal. Nothing was changed.`
            : `Couldn’t confirm the goal was changed. Check its status before trying again.`,
        { id },
      );
    } finally {
      busy.current = false;
      if (active.current === owner) setPending(false);
    }
  }

  const actions: RowAction[] = [
    {
      id: "edit",
      label: "Edit goal",
      icon: "edit",
      disabled: pending,
      onPress: () => router.push({ pathname: "/finance-goal-edit", params: { id: goal.id } }),
    },
    {
      id: "progress",
      label: "Confirm progress",
      icon: "target",
      disabled: pending,
      onPress: () => router.push({ pathname: "/finance-goal-progress", params: { id: goal.id } }),
    },
  ];
  if (goal.status === "active")
    actions.push({
      id: "pause",
      label: "Pause goal",
      icon: "clock",
      disabled: pending,
      onPress: () => void change("pause"),
    });
  if (goal.status === "paused")
    actions.push({
      id: "resume",
      label: "Resume goal",
      icon: "refresh",
      disabled: pending,
      onPress: () => void change("resume"),
    });
  if (goal.status !== "completed")
    actions.push({
      id: "complete",
      label: "Mark complete",
      icon: "check",
      disabled: pending,
      onPress: () =>
        Alert.alert(
          `Mark ${goal.name} complete?`,
          "Its target and recorded amount stay as they are. Progress is confirmed for one version of a goal, so it will need confirming again afterwards.",
          [
            { text: "Cancel", style: "cancel" },
            { text: "Mark complete", onPress: () => void change("complete") },
          ],
        ),
    });
  actions.push({
    id: "remove",
    label: "Remove goal",
    icon: "trash",
    destructive: true,
    disabled: pending,
    onPress: () =>
      Alert.alert(
        `Remove ${goal.name}?`,
        "It leaves your goals. Budget versions that already allocate to it keep their record.",
        [
          { text: "Keep goal", style: "cancel" },
          { text: "Remove goal", style: "destructive", onPress: () => void change("remove") },
        ],
      ),
  });
  return <Stack.Screen options={editorActionsOptions("Goal actions", actions, t)} />;
}

/** One goal: its confirmed progress, target, deadline, priority and status. */
export function FinanceGoalScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { query, owner, today } = useGoals();
  const goal = query.data?.data.find((item) => item.id === id && item.status !== "removed");
  const progress = goal ? confirmedProgress(goal, owner, today) : null;
  return (
    <>
      <Stack.Screen options={{ title: "goal" }} />
      <ReadState query={query}>
        {goal ? (
          <FinanceScreen title={goal.name}>
            <GoalActions goal={goal} />
            {progress ? (
              <Metric
                label="Confirmed progress"
                value={formatMoney(progress.amount, progress.currency)}
                hint={`${progress.percent == null ? "" : `${progress.percent}% of ${goalTarget(goal, progress)} · `}${progress.byAgent ? "Recorded by your agent" : "Your statement"} as of ${goalDate(progress.asOf)}`}
              />
            ) : (
              <Card>
                <Copy>Progress not confirmed</Copy>
                <Copy secondary>
                  Progress is your own statement of where this goal stands, and it applies to one
                  version of the goal. Use Confirm progress in the actions menu to record it.
                </Copy>
              </Card>
            )}
            <Card rows>
              <FinanceRow
                centered
                title="Target"
                value={goalTarget(goal, progress)}
                icon="target"
              />
              <FinanceRow
                centered
                title="Deadline"
                value={goal.deadline ? goalDate(goal.deadline) : "None"}
                icon="calendar"
              />
              <FinanceRow
                centered
                title="Priority"
                value={goalPriorities.find((item) => item.value === goal.priority)?.label}
                icon="star"
              />
              <FinanceRow
                centered
                title="Status"
                value={goalStatusLabel(goal.status)}
                icon="info"
              />
            </Card>
          </FinanceScreen>
        ) : (
          <FinanceScreen title="Goal">
            <Copy secondary>This goal is unavailable.</Copy>
          </FinanceScreen>
        )}
      </ReadState>
    </>
  );
}
