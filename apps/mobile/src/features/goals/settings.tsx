import {
  createGoalInputSchema,
  createMotiveInputSchema,
  type Goal,
  type Motive,
  updateGoalInputSchema,
  updateMotiveInputSchema,
} from "@personal-os/domain";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { useRef, useState } from "react";
import { Switch, Text, View } from "react-native";
import { toast } from "sonner-native";
import { editorDismissOptions } from "../../components/editor-header";
import { FloatingAdd, FormSave } from "../../components/forms/form-save";
import { PlanningPicker } from "../../components/forms/planning-picker";
import { useDirtyDismiss } from "../../components/forms/use-dirty-dismiss";
import { Icon } from "../../components/icons";
import { RecordRow } from "../../components/record-row";
import { Screen } from "../../components/screen";
import { useTheme } from "../../theme";
import { useAuth } from "../auth/context";
import { SettingsViewSwitcher } from "../settings/view-switcher";
import { Action, confirmDelete, Field, ReadState } from "./controls";
import { goalChanges, motiveChanges, personalDraft } from "./logic";
export function GoalsSettingsScreen() {
  const { state } = useAuth();
  return <GoalsHome key={state.user?.id} />;
}
function GoalsHome() {
  const t = useTheme();
  const { state, session } = useAuth();
  const key = ["personal-goals", state.user?.id];
  const api = session.api();
  const goals = useQuery({
    queryKey: [...key, "goals"],
    queryFn: () => api.listGoals(),
    enabled: !!state.user,
  });
  const motives = useQuery({
    queryKey: [...key, "motives"],
    queryFn: () => api.listMotives(),
    enabled: !!state.user,
  });
  const [tab, setTab] = useState("goals");
  return (
    <View style={{ flex: 1 }}>
      <Screen
        onRefresh={async () => {
          await Promise.all([
            goals.refetch({ throwOnError: true }),
            motives.refetch({ throwOnError: true }),
          ]);
        }}
      >
        <Stack.Screen options={{ title: "Goals & Motives" }} />
        <SettingsViewSwitcher
          value={tab}
          options={[
            { label: "Goals", value: "goals", icon: "target" },
            { label: "Completed", value: "completed", icon: "history" },
            { label: "Motives", value: "motives", icon: "star" },
          ]}
          onChange={setTab}
        />

        <ReadState
          pending={tab === "motives" ? motives.isPending : goals.isPending}
          error={tab === "motives" ? motives.isError : goals.isError}
          retry={() => void (tab === "motives" ? motives.refetch() : goals.refetch())}
        />
        {tab === "motives"
          ? motives.data?.map((record) => (
              <RecordRow
                leading={<Icon name="target" color={t.secondary} />}
                key={record.id}
                title={record.title}
                subtitle={record.detail ?? undefined}
                subtitleLines={2}
                value={record.isActive ? "Active" : "Paused"}
                onPress={() =>
                  router.push({
                    pathname: "/settings/goals/edit",
                    params: { kind: "motive", id: record.id },
                  })
                }
              />
            ))
          : goals.data
              ?.filter((g) =>
                tab === "completed" ? g.status === "completed" : g.status !== "completed",
              )
              .map((record) => (
                <RecordRow
                  leading={<Icon name="target" color={t.secondary} />}
                  key={record.id}
                  title={record.title}
                  subtitle={record.description ?? undefined}
                  subtitleLines={2}
                  value={`${record.progress}%`}
                  onPress={() =>
                    router.push({
                      pathname: "/settings/goals/edit",
                      params: { kind: "goal", id: record.id },
                    })
                  }
                />
              ))}
        {(tab === "motives"
          ? motives.isSuccess && motives.data.length === 0
          : goals.isSuccess &&
            goals.data.filter((g) =>
              tab === "completed" ? g.status === "completed" : g.status !== "completed",
            ).length === 0) && (
          <Text style={{ color: t.ink }}>
            No {tab === "completed" ? "completed outcomes" : tab} yet.
          </Text>
        )}
      </Screen>
      <FloatingAdd
        label={`Add ${tab === "motives" ? "motive" : "goal"}`}
        onPress={() =>
          router.push({
            pathname: "/settings/goals/edit",
            params: { kind: tab === "motives" ? "motive" : "goal" },
          })
        }
      />
    </View>
  );
}
export function GoalEditorScreen() {
  const { kind: rawKind, id } = useLocalSearchParams<{ kind?: string; id?: string }>();
  const kind = rawKind === "motive" ? "motive" : "goal";
  const { state, session } = useAuth();
  const client = useQueryClient();
  const key = ["personal-goals", state.user?.id];
  const records = useQuery({
    queryKey: [...key, kind === "goal" ? "goals" : "motives"],
    queryFn: async () =>
      kind === "goal" ? session.api().listGoals() : session.api().listMotives(),
    enabled: !!state.user && !!id,
  });
  if (id && !records.data)
    return (
      <Screen>
        <ReadState
          pending={records.isPending}
          error={records.isError}
          retry={() => void records.refetch()}
        />
      </Screen>
    );
  const record = records.data?.find((record) => record.id === id);
  if (id && !record)
    return (
      <Screen>
        <Text>Record unavailable.</Text>
      </Screen>
    );
  return (
    <PersonalEditor
      key={`${state.user?.id}:${kind}:${id}`}
      kind={kind}
      record={record}
      close={() => router.back()}
      refresh={() => client.invalidateQueries({ queryKey: key })}
    />
  );
}
function PersonalEditor({
  kind,
  record: openedRecord,
  close,
  refresh,
}: {
  kind: "goal" | "motive";
  record?: Goal | Motive;
  close: () => void;
  refresh: () => Promise<void>;
}) {
  const t = useTheme();
  const { session, state } = useAuth();
  // Keep the reviewed snapshot aligned with this draft for the whole editing session.
  // Query refreshes must never turn untouched fields into outgoing patches.
  const [record] = useState(() => (openedRecord ? { ...openedRecord } : undefined));
  const [draft, setDraft] = useState(() => personalDraft(record));
  const [pending, setPending] = useState(false);
  const lock = useRef(false);
  const dirty = JSON.stringify(draft) !== JSON.stringify(personalDraft(record));
  const permitDismiss = useDirtyDismiss(dirty, pending);
  const change = (patch: Partial<typeof draft>) => setDraft({ ...draft, ...patch });
  const run = async (remove = false) => {
    if (lock.current) return;
    lock.current = true;
    setPending(true);
    const id = toast.loading(remove ? "Deleting…" : "Saving…");
    try {
      const api = session.api();
      if (remove && record) {
        if (kind === "goal") await api.deleteGoal(record.id);
        else await api.deleteMotive(record.id);
      } else if (kind === "goal") {
        if (record)
          await api.updateGoal(
            record.id,
            updateGoalInputSchema.parse(goalChanges(draft, record as Goal)),
          );
        else {
          await api.createGoal(createGoalInputSchema.parse(goalChanges(draft)));
        }
      } else if (record)
        await api.updateMotive(
          record.id,
          updateMotiveInputSchema.parse(motiveChanges(draft, record as Motive)),
        );
      else await api.createMotive(createMotiveInputSchema.parse(motiveChanges(draft)));
      toast.success(remove ? "Record deleted" : "Changes saved", { id });
      void refresh();
      permitDismiss();
      close();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to save changes", { id });
    } finally {
      lock.current = false;
      setPending(false);
    }
  };
  return (
    <View style={{ flex: 1 }}>
      <Stack.Screen
        options={{
          title: record ? `Edit ${kind}` : `New ${kind}`,
          gestureEnabled: !dirty,
          ...editorDismissOptions({
            label: dirty ? "Cancel" : "Close",
            disabled: pending,
            onPress: close,
          }),
        }}
      />
      <Screen>
        <Field
          label="Title"
          value={draft.title}
          onChange={(title) => change({ title })}
          placeholder={kind === "goal" ? "Learn to swim" : "Make time for family"}
        />
        <Field
          label={kind === "goal" ? "Description" : "Detail"}
          value={draft.detail}
          onChange={(detail) => change({ detail })}
          multiline
        />
        {kind === "goal" && (
          <>
            <PlanningPicker
              mode="date"
              optional
              timeZone={state.user?.planningTimezone ?? "UTC"}
              label="Target date"
              value={draft.targetDate}
              onChange={(targetDate) => change({ targetDate })}
            />
            {record && (
              <Field
                label="Progress (%)"
                value={draft.progress}
                onChange={(progress) => change({ progress })}
              />
            )}
          </>
        )}
        {record && (
          <>
            <Text style={{ color: t.ink }}>Active</Text>
            <Switch
              accessibilityLabel="Active"
              value={draft.active}
              onValueChange={(active) => change({ active })}
            />
          </>
        )}
        {record && (
          <Action
            disabled={pending}
            onPress={() => confirmDelete(record.title, () => void run(true))}
          >
            Delete {kind}
          </Action>
        )}
      </Screen>
      <FormSave disabled={!dirty || pending} onPress={() => void run()} />
    </View>
  );
}
