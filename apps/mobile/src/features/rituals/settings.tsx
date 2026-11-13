import { ApiClientError } from "@personal-os/api-client";
import {
  type RitualDefinition,
  type RitualDefinitionInput,
  type RitualOccurrence,
  type RitualStep,
  ritualDefinitionInputSchema,
} from "@personal-os/domain";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { randomUUID } from "expo-crypto";
import { File, Paths } from "expo-file-system";
import { router, Stack, useLocalSearchParams, usePreventRemove } from "expo-router";
import * as SecureStore from "expo-secure-store";
import { useEffect, useRef, useState } from "react";
import { Alert, Share, View } from "react-native";
import { toast } from "sonner-native";
import { editorDismissOptions } from "../../components/editor-header";
import { EnumChoice } from "../../components/forms/enum-choice";
import { SectionItem, SectionNote } from "../../components/forms/form-rows";
import { FormSave } from "../../components/forms/form-save";
import { PlanningPicker } from "../../components/forms/planning-picker";
import { useDirtyDismiss } from "../../components/forms/use-dirty-dismiss";
import { Icon } from "../../components/icons";
import { RecordRow } from "../../components/record-row";
import { Screen } from "../../components/screen";
import { useTheme } from "../../theme";
import { useAuth } from "../auth/context";
import { Action, Field, ReadState, Section, ToggleRow } from "../goals/controls";
import { useSettingsRefresh } from "../settings/data";
import { SettingsActionRow, SettingsRow } from "../settings/settings-row";
import { DaySelection } from "./day-selection";

let devicePromise: Promise<string> | undefined;
function deviceId() {
  if (!devicePromise)
    devicePromise = (async () => {
      const stored = await SecureStore.getItemAsync("ritual-settings-device");
      if (stored) return stored;
      const id = randomUUID();
      await SecureStore.setItemAsync("ritual-settings-device", id);
      return id;
    })().catch((error) => {
      devicePromise = undefined;
      throw error;
    });
  return devicePromise;
}
function initialDraft(kind: "morning" | "night", definition?: RitualDefinition) {
  return {
    kind,
    title: definition?.title ?? (kind === "morning" ? "Morning" : "Evening"),
    enabled: definition?.enabled ?? false,
    time: definition?.time ?? (kind === "morning" ? "08:00" : "20:00"),
    reminderTime: definition?.reminderTime ?? "",
    steps: definition?.steps ?? [
      { id: randomUUID(), label: "Check in", kind: "checkbox" as const },
    ],
  };
}
export function RitualsSettingsScreen() {
  const { state } = useAuth();
  return <RitualHome key={state.user?.id} />;
}
function RitualHome() {
  const _t = useTheme();
  const { state, session } = useAuth();
  const api = session.api();
  const client = useQueryClient();
  const key = ["personal-rituals", state.user?.id];
  const definitions = useQuery({
    queryKey: [...key, "definitions"],
    queryFn: () => api.listRituals(),
    enabled: !!state.user,
  });
  const { refresh: refreshDefinitions } = useSettingsRefresh(
    [[...key, "definitions"]],
    [() => definitions.refetch({ throwOnError: true })],
    "Rituals refreshed",
  );
  const [pending, setPending] = useState(false);
  const [confirmKind, setConfirmKind] = useState<"morning" | "night" | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const refresh = async () => {
    await client.invalidateQueries({ queryKey: key });
  };
  const actionLock = useRef(false);
  const action = async (remove?: "morning" | "night") => {
    if (actionLock.current) return;
    actionLock.current = true;
    setPending(true);
    const id = toast.loading(remove ? "Deleting ritual data…" : "Preparing export…");
    try {
      if (remove) {
        await api.deleteRitualData(remove);
        setConfirmKind(null);
        setConfirmation("");
        void refresh();
        toast.success("Ritual data deleted", { id });
      } else {
        const data = await api.exportRitualData();
        const file = new File(Paths.cache, `nohmi-rituals-${randomUUID()}.json`);
        file.write(JSON.stringify(data, null, 2));
        try {
          const result = await Share.share({ title: "nohmi ritual data", url: file.uri });
          toast.dismiss(id);
          if (result.action === Share.sharedAction) toast.success("Export shared");
        } finally {
          file.delete();
        }
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Action failed", { id });
    } finally {
      setPending(false);
      actionLock.current = false;
    }
  };
  return (
    <Screen onRefresh={refreshDefinitions}>
      <Stack.Screen options={{ title: "Rituals" }} />
      <ReadState
        pending={definitions.isPending}
        error={definitions.isError}
        retry={() => void definitions.refetch()}
      />
      {definitions.data && (
        <Section title="Rituals">
          {(["morning", "night"] as const).map((kind) => {
            const definition = definitions.data.rituals.find((d) => d.kind === kind);
            return (
              <SettingsRow
                icon="clock"
                key={kind}
                label={kind === "morning" ? "Morning" : "Evening"}
                value={
                  definition
                    ? `${new Intl.DateTimeFormat(undefined, { timeZone: "UTC", hour: "numeric", minute: "2-digit" }).format(new Date(`2000-01-01T${definition.time}:00Z`))} · ${definition.enabled ? "Enabled" : "Disabled"}`
                    : "Not configured"
                }
                onPress={() =>
                  router.push({ pathname: "/settings/rituals/edit", params: { kind } })
                }
              />
            );
          })}
        </Section>
      )}
      <Section title="Records">
        <SettingsRow
          icon="history"
          label="History"
          onPress={() => router.push("/settings/rituals/history")}
        />
        <SettingsActionRow
          icon="send"
          label="Export ritual data"
          disabled={pending}
          onPress={() => void action()}
        />
      </Section>
      <Section title="Delete data">
        {(["morning", "night"] as const).map((kind) => (
          <Action
            key={kind}
            destructive
            disabled={pending}
            onPress={() => {
              setConfirmation("");
              setConfirmKind(kind);
            }}
          >
            Delete {kind === "morning" ? "Morning" : "Evening"} data
          </Action>
        ))}
      </Section>
      {confirmKind && (
        <Section title="Confirm deletion">
          <SectionNote>
            This permanently deletes the definition, answers and history. Type{" "}
            {confirmKind === "morning" ? "Morning" : "Evening"} to confirm.
          </SectionNote>
          <Field label="Ritual name" value={confirmation} onChange={setConfirmation} />
          <Action
            destructive
            disabled={
              pending || confirmation !== (confirmKind === "morning" ? "Morning" : "Evening")
            }
            onPress={() =>
              Alert.alert("Permanently delete ritual data?", "This cannot be undone.", [
                { text: "Cancel", style: "cancel" },
                { text: "Delete", style: "destructive", onPress: () => void action(confirmKind) },
              ])
            }
          >
            Permanently delete data
          </Action>
          <Action disabled={pending} onPress={() => setConfirmKind(null)}>
            Cancel deletion
          </Action>
        </Section>
      )}
    </Screen>
  );
}
export function RitualEditorScreen() {
  const { kind: rawKind } = useLocalSearchParams<{ kind?: string }>();
  const kind = rawKind === "night" ? "night" : "morning";
  const { state, session } = useAuth();
  const client = useQueryClient();
  const key = ["personal-rituals", state.user?.id];
  const definitions = useQuery({
    queryKey: [...key, "definitions"],
    queryFn: () => session.api().listRituals(),
    enabled: !!state.user,
  });
  if (!definitions.data)
    return (
      <Screen>
        <ReadState
          pending={definitions.isPending}
          error={definitions.isError}
          retry={() => void definitions.refetch()}
        />
      </Screen>
    );
  return (
    <RitualEditor
      key={`${state.user?.id}:${kind}`}
      kind={kind}
      definition={definitions.data.rituals.find((d) => d.kind === kind)}
      close={() => router.back()}
      refresh={() => client.invalidateQueries({ queryKey: key })}
    />
  );
}
export function RitualHistoryScreen() {
  const { state } = useAuth();
  return <RitualHistory key={state.user?.id} close={() => router.back()} />;
}
function RitualEditor({
  kind,
  definition,
  close,
  refresh,
}: {
  kind: "morning" | "night";
  definition?: RitualDefinition;
  close: () => void;
  refresh: () => Promise<void>;
}) {
  const { state, session } = useAuth();
  const [baseline] = useState(() => initialDraft(kind, definition));
  const [draft, setDraft] = useState(baseline);
  const [revision, setRevision] = useState(definition?.revision ?? 0);
  const [pending, setPending] = useState(false);
  const [conflict, setConflict] = useState(false);
  const lock = useRef(false);
  const request = useRef<{ serialized: string; input: RitualDefinitionInput } | null>(null);
  const dirty = JSON.stringify(draft) !== JSON.stringify(baseline);
  const t = useTheme();
  const permitDismiss = useDirtyDismiss(dirty, pending);
  const change = (patch: Partial<typeof draft>) => {
    if (lock.current) return;
    setDraft((current) => ({ ...current, ...patch }));
  };
  const stepChange = (index: number, patch: Partial<RitualStep>) => {
    if (lock.current) return;
    setDraft((current) => ({
      ...current,
      steps: current.steps.map((step, i) => (i === index ? { ...step, ...patch } : step)),
    }));
  };
  const moveStep = (stepId: string, offset: -1 | 1) => {
    if (lock.current) return;
    setDraft((current) => {
      const index = current.steps.findIndex((step) => step.id === stepId);
      const target = index + offset;
      const step = current.steps[index],
        neighbor = current.steps[target];
      if (!step || !neighbor) return current;
      const steps = [...current.steps];
      steps[index] = neighbor;
      steps[target] = step;
      return { ...current, steps };
    });
  };
  const save = async () => {
    if (lock.current) return;
    lock.current = true;
    setPending(true);
    const id = toast.loading(conflict ? "Loading latest revision…" : "Saving ritual…");
    try {
      if (conflict) {
        const latest = await session.api().listRituals();
        setRevision(latest.rituals.find((d) => d.kind === kind)?.revision ?? 0);
        setConflict(false);
        request.current = null;
        toast.dismiss(id);
        toast("Latest revision loaded. Review your draft before saving.");
        return;
      }
      const serialized = JSON.stringify({
        ...draft,
        revision,
        timeZone: state.user?.planningTimezone,
      });
      if (request.current?.serialized !== serialized) {
        request.current = {
          serialized,
          input: ritualDefinitionInputSchema.parse({
            ...draft,
            reminderTime: draft.reminderTime || undefined,
            timeZone: state.user?.planningTimezone,
            expectedRevision: revision,
            requestId: randomUUID(),
            deviceId: await deviceId(),
          }),
        };
      }
      await session.api().saveRitual(request.current.input);
      toast.success("Ritual saved", { id });
      void refresh();
      permitDismiss();
      close();
    } catch (error) {
      if (error instanceof ApiClientError && error.status === 409) setConflict(true);
      toast.error(error instanceof Error ? error.message : "Unable to save ritual", { id });
    } finally {
      setPending(false);
      lock.current = false;
    }
  };
  return (
    <View style={{ flex: 1, backgroundColor: t.canvas }}>
      <Stack.Screen
        options={{
          title: kind === "morning" ? "Morning ritual" : "Evening ritual",
          gestureEnabled: !dirty,
          ...editorDismissOptions({
            label: dirty ? "Cancel" : "Close",
            disabled: pending,
            onPress: close,
          }),
        }}
      />
      <Screen>
        <Section title="Identity">
          <Field
            disabled={pending}
            label="Title"
            value={draft.title}
            onChange={(title) => change({ title })}
          />
        </Section>
        <Section title="State">
          <ToggleRow
            label="Enabled"
            value={draft.enabled}
            onChange={(enabled) => change({ enabled })}
            disabled={pending}
          />
        </Section>
        <Section title="Planning">
          <PlanningPicker
            disabled={pending}
            mode="time"
            timeZone={state.user?.planningTimezone ?? "UTC"}
            label="Time"
            value={draft.time}
            onChange={(time) => change({ time })}
          />
          <PlanningPicker
            disabled={pending}
            mode="time"
            optional
            timeZone={state.user?.planningTimezone ?? "UTC"}
            label="Reminder time (optional)"
            value={draft.reminderTime}
            onChange={(reminderTime) => change({ reminderTime })}
          />
          <SectionNote>
            Uses your Profile timezone:{" "}
            {state.user?.planningTimezone ?? "Set a timezone in Profile"}
          </SectionNote>
        </Section>
        {draft.steps.map((step, index) => (
          <Section key={step.id} title={`Step ${index + 1}`}>
            <Field
              disabled={pending}
              label={`Step ${index + 1}`}
              value={step.label}
              onChange={(label) => stepChange(index, { label })}
            />
            <EnumChoice
              disabled={pending}
              label="Step type"
              value={step.kind}
              options={["checkbox", "short_text", "time", "date", "number", "multiple_choice"].map(
                (value) => ({
                  label: value
                    .split("_")
                    .map((word) => word[0]?.toUpperCase() + word.slice(1))
                    .join(" "),
                  value,
                }),
              )}
              onChange={(value) => stepChange(index, { kind: value as RitualStep["kind"] })}
            />
            <ToggleRow
              label={`Step ${index + 1} optional`}
              value={step.optional ?? false}
              onChange={(optional) => stepChange(index, { optional })}
              disabled={pending}
            />
            <DaySelection
              disabled={pending}
              label={`Step ${index + 1} days`}
              value={step.days}
              onChange={(days) => stepChange(index, { days })}
            />
            {step.kind === "multiple_choice" && (
              <Field
                disabled={pending}
                label={`Step ${index + 1} options (one per line)`}
                multiline
                value={step.options?.join("\n") ?? ""}
                onChange={(value) => stepChange(index, { options: value.split("\n") })}
              />
            )}
            <Action disabled={pending || index === 0} onPress={() => moveStep(step.id, -1)}>
              Move step {index + 1} up
            </Action>
            <Action
              disabled={pending || index === draft.steps.length - 1}
              onPress={() => moveStep(step.id, 1)}
            >
              Move step {index + 1} down
            </Action>
            <Action
              destructive
              disabled={pending}
              onPress={() => change({ steps: draft.steps.filter((_, i) => i !== index) })}
            >
              Remove step
            </Action>
          </Section>
        ))}
        <Section>
          <SettingsActionRow
            icon="add"
            label="Add step"
            disabled={pending || draft.steps.length >= 20}
            onPress={() =>
              change({
                steps: [...draft.steps, { id: randomUUID(), label: "", kind: "checkbox" }],
              })
            }
          />
          {conflict && (
            <Action disabled={pending} onPress={() => void save()}>
              Load latest revision and keep draft
            </Action>
          )}
        </Section>
        <View style={{ height: 90 }} />
      </Screen>
      <FormSave
        disabled={pending || !dirty || conflict || !state.user?.planningTimezone}
        onPress={() => void save()}
      />
    </View>
  );
}
function RitualHistory({ close }: { close: () => void }) {
  const t = useTheme();
  const { state, session } = useAuth();
  const [kind, setKind] = useState("all");
  const [status, setStatus] = useState("all");
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [sort, setSort] = useState<"newest" | "oldest">("newest");
  const [selectedDetail, setDetail] = useState<RitualOccurrence | null>(null);
  const filters = {
    kind: kind === "all" ? undefined : kind,
    status: status === "all" ? undefined : (status as RitualOccurrence["status"]),
    search,
    dateFrom,
    dateTo,
    sort,
  };
  const history = useInfiniteQuery({
    queryKey: ["personal-rituals", state.user?.id, "history", filters],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => session.api().listRitualHistory(pageParam, filters),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    enabled: !!state.user,
  });
  const denied =
    history.error instanceof ApiClientError &&
    (history.error.status === 401 || history.error.status === 403);
  // Native events can outlive their row. Keep denial latched through retry, then accept only
  // selections from the currently authorized page objects rather than a queued old snapshot.
  const denialLatch = useRef(false);
  if (denied) denialLatch.current = true;
  else if (history.isSuccess && history.isFetchedAfterMount && history.data)
    denialLatch.current = false;
  const selectionBoundary = useRef<{ blocked: boolean; items: RitualOccurrence[] }>({
    blocked: true,
    items: [],
  });
  selectionBoundary.current = {
    blocked: denialLatch.current,
    items: history.data?.pages.flatMap((page) => page.items) ?? [],
  };
  const selectDetail = (item: RitualOccurrence) => {
    const current = selectionBoundary.current;
    if (current.blocked || !current.items.includes(item)) return;
    setDetail(item);
  };
  const detail = denialLatch.current ? null : selectedDetail;
  useEffect(() => {
    if (denied) setDetail(null);
  }, [denied]);
  usePreventRemove(!!detail, () => setDetail(null));
  const { refresh: refreshHistory } = useSettingsRefresh(
    [["personal-rituals", state.user?.id, "history", filters]],
    [() => history.refetch({ throwOnError: true })],
    "Ritual history refreshed",
  );
  const _t = useTheme();
  return (
    <Screen onRefresh={refreshHistory}>
      <Stack.Screen
        options={{
          title: detail ? "Ritual history details" : "Ritual history",
          ...editorDismissOptions({
            label: "Back",
            onPress: () => (detail ? setDetail(null) : close()),
          }),
        }}
      />
      {detail ? (
        <>
          <Section title="Occurrence">
            <SectionNote ink>
              {detail.definition.title} · {detail.scheduledLocalDate} · {detail.status}
            </SectionNote>
            <SectionNote>
              Timezone: {detail.timeZone}; revision {detail.definitionRevision}; due {detail.dueAt},
              expires {detail.expiresAt}; settled {detail.settledAt ?? "Not settled"}; snoozed until{" "}
              {detail.snoozedUntil ?? "None"}
            </SectionNote>
          </Section>
          <Section title="Steps">
            {detail.definition.steps.map((step) => (
              <SectionNote ink key={step.id}>
                {step.label} ({step.kind}
                {step.optional ? ", optional" : ""})
              </SectionNote>
            ))}
          </Section>
          {(detail.responses.length > 0 ||
            detail.actions.length > 0 ||
            !!detail.optionalFollowUp) && (
            <Section title="Activity">
              {detail.responses.map((response) => (
                <SectionNote ink key={response.id}>
                  {detail.definition.steps.find((s) => s.id === response.stepId)?.label ??
                    response.stepId}
                  : {String(response.value)} · {response.submitted ? "Submitted" : "Draft"} ·
                  observed {response.observedAt} · recorded {response.recordedAt}
                </SectionNote>
              ))}
              {detail.actions.map((action) => (
                <SectionNote ink key={action.id}>
                  {action.kind} · {action.outcome} · count {action.count} · observed{" "}
                  {action.observedAt} · recorded {action.recordedAt}
                </SectionNote>
              ))}
              {detail.optionalFollowUp && (
                <SectionNote ink>
                  Optional follow-up due {detail.optionalFollowUp.dueAt}:{" "}
                  {detail.optionalFollowUp.stepIds.join(", ")}
                </SectionNote>
              )}
            </Section>
          )}
        </>
      ) : (
        <>
          <Section title="Filters">
            <EnumChoice
              label="Ritual"
              value={kind}
              options={[
                { label: "All Rituals", value: "all" },
                { label: "Morning", value: "morning" },
                { label: "Evening", value: "night" },
              ]}
              onChange={setKind}
            />
            <EnumChoice
              label="Status"
              value={status}
              options={[
                "all",
                "pending",
                "completed",
                "skipped",
                "missed",
                "cancelled_configuration",
              ].map((value) => ({
                value,
                label: value
                  .split("_")
                  .map((word) => word[0]?.toUpperCase() + word.slice(1))
                  .join(" "),
              }))}
              onChange={setStatus}
            />
            <Field label="Search history" value={search} onChange={setSearch} />
            <PlanningPicker
              mode="date"
              optional
              timeZone={state.user?.planningTimezone ?? "UTC"}
              label="From date"
              value={dateFrom}
              onChange={setDateFrom}
            />
            <PlanningPicker
              label="To date"
              mode="date"
              optional
              timeZone={state.user?.planningTimezone ?? "UTC"}
              value={dateTo}
              onChange={setDateTo}
            />
            <EnumChoice
              label="Order"
              value={sort}
              options={[
                { label: "Newest First", value: "newest" },
                { label: "Oldest First", value: "oldest" },
              ]}
              onChange={(value) => setSort(value as "newest" | "oldest")}
            />
          </Section>
          <ReadState
            pending={history.isPending}
            error={history.isError}
            retry={() => void history.refetch()}
          />
          {history.data && (
            <Section title="History">
              {history.data.pages
                .flatMap((page) => page.items)
                .map((item) => (
                  <SectionItem key={item.id}>
                    <RecordRow
                      leading={<Icon name="clock" color={t.secondary} />}
                      title={item.definition.title}
                      subtitle={`${item.scheduledLocalDate} · ${item.status}`}
                      onPress={() => selectDetail(item)}
                    />
                  </SectionItem>
                ))}
              {history.isSuccess && history.data.pages.every((p) => !p.items.length) && (
                <SectionNote>No matching history.</SectionNote>
              )}
              {history.hasNextPage && (
                <Action
                  disabled={history.isFetchingNextPage}
                  onPress={() => void history.fetchNextPage()}
                >
                  Load more history
                </Action>
              )}
            </Section>
          )}
        </>
      )}
    </Screen>
  );
}
