import { ReorderHandle } from "@/components/reorder-handle";
import {
  defaultRitualReminderTime,
  type RitualDefinition,
  type RitualState,
  type RitualStep,
  ritualDefinitionInputSchema,
} from "@personal-os/domain";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Reorder, useDragControls } from "motion/react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { api } from "../../api.js";
import { useConfirmAction } from "../../components/confirm-action.js";
import { DataViewLoading, DataViewRecovery } from "@/components/data-view-state";
import { ChevronRightIcon, PlusIcon, ActivityIcon } from "../../components/icons.js";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "../../components/settings-field.js";
import { SettingsRecordAction } from "../../components/settings-record.js";
import { Button } from "../../components/ui/button.js";
import { Card, CardContent } from "../../components/ui/card.js";
import { DependentSetting } from "../../components/dependent-setting.js";
import { Switch } from "../../components/ui/switch.js";
import { RitualSkyPreview } from "./ritual-sky-preview.js";
import { RitualSettingsProgress } from "./ritual-settings-progress.js";
import { Checkbox } from "../../components/ui/checkbox.js";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "../../components/ui/dialog.js";
import { Input } from "../../components/ui/input.js";
import { ItemGroup } from "../../components/ui/item.js";
import { NativeSelect, NativeSelectOption } from "../../components/ui/native-select.js";
import { Textarea } from "../../components/ui/textarea.js";
import { classifyMutationError } from "../../lib/feedback.js";
import { useSettingsError } from "../../lib/settings-feedback.js";
import { isDesktop } from "../desktop/bridge.js";
import {
  enableRitualPresentation,
  ritualDeviceId,
  showRitualPreview,
} from "../desktop/ritual-bridge.js";
import { ProfileRow, ProfileSection } from "../settings/profile-rows.js";
import { settingsPath } from "../settings/settings-routes.js";
import { SettingsBento, SettingsSection } from "../settings/settings-layout.js";
import { RitualDataAction } from "./ritual-data-action.js";
import { RitualHistory } from "./ritual-history.js";
import { RitualLocal } from "./ritual-local.js";
import { makeRitualPreview, RitualPreview } from "./ritual-preview.js";

const responseTypes: { value: RitualStep["kind"]; label: string }[] = [
  { value: "checkbox", label: "Checkbox" },
  { value: "short_text", label: "Short entry" },
  { value: "time", label: "Time entry" },
  { value: "date", label: "Date entry" },
  { value: "number", label: "Number entry" },
  { value: "multiple_choice", label: "Multiple choice" },
];
export function RitualSettings({ timeZone, view = "morning", content = "all" }: { timeZone: string; content?: "all" | "checklist"; view?: "overview" | "morning" | "night" | "history" }) {
  const query = useQuery({ queryKey: ["rituals"], queryFn: api.listRituals });
  // History owns its own collection query; a definitions failure must not block it.
  if (view === "history") return <RitualHistory />;
  if (query.isPending) return <DataViewLoading label="Loading ritual settings" />;
  if (!query.data)
    return <DataViewRecovery query={query} title="Couldn’t load ritual settings." unavailableLabel="Ritual settings unavailable" />;
  return (
    <div className="settings-stack">
      <DataViewRecovery query={query} title="Couldn’t refresh ritual settings." unavailableLabel="Ritual settings unavailable" />
      {view === "overview" ? (
        <>
          {(["morning", "night"] as const).map((kind) => <RitualForm key={kind} kind={kind} content="schedule" definition={query.data.rituals.find((d) => d.kind === kind)} timeZone={timeZone} />)}
          <ProfileSection title="History"><ProfileRow label="Ritual History" icon={<span className="settings-subsection__icon"><ActivityIcon /></span>} to={settingsPath("ritual-history")} /></ProfileSection>
          <div className="flex justify-end"><RitualDataAction /></div>
        </>
      ) : view === "morning" || view === "night" ? (
        <RitualForm key={view} kind={view} content={content} definition={query.data.rituals.find((d) => d.kind === view)} timeZone={timeZone} />
      ) : null}

    </div>
  );
}
function initialDraft(
  kind: "morning" | "night",
  definition: RitualDefinition | undefined,
  timeZone: string,
) {
  return {
    kind,
    title:
      definition?.title === "Good night"
        ? "Good evening"
        : (definition?.title ?? `Good ${kind === "morning" ? "morning" : "evening"}`),
    enabled: definition?.enabled ?? false,
    reminderTime: defaultRitualReminderTime(definition ?? { kind }),
    time: definition?.time ?? (kind === "morning" ? "06:00" : "21:00"),
    timeZone,
    steps: definition?.steps ?? [
      { id: crypto.randomUUID(), label: "Brush your teeth", kind: "checkbox" as const },
      { id: crypto.randomUUID(), label: "Journal", kind: "short_text" as const },
    ],
  };
}
function RitualForm({
  kind,
  content,
  definition,
  timeZone,
}: {
  kind: "morning" | "night";
  content: "all" | "schedule" | "checklist";
  definition?: RitualDefinition | undefined;
  timeZone: string;
}) {
  const cache = useQueryClient();
  const label = kind === "morning" ? "Morning" : "Evening";
  const [draft, setDraft] = useState(() => initialDraft(kind, definition, timeZone));
  const revision = useRef(definition?.revision ?? 0);
  const saved = useRef(JSON.stringify(draft));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<RitualState | null>(null);
  const [opening, setOpening] = useState(false);
  const [actionError, setActionError] = useState("");
  useSettingsError(error, error);
  useSettingsError(actionError, actionError);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const previousDefinitionId = useRef(definition?.id);
  useEffect(() => {
    if (previousDefinitionId.current && !definition) {
      const reset = initialDraft(kind, undefined, timeZone);
      revision.current = 0;
      saved.current = JSON.stringify(reset);
      setDraft(reset);
      setError("");
      setPreview(null);
    }
    if (!busy && definition && definition.revision > revision.current) {
      const remote = initialDraft(kind, definition, timeZone);
      const base = JSON.parse(saved.current) as typeof draft;
      const local = draftRef.current;
      const rebased = { ...remote };
      // Keep edited fields; adopt remote updates to everything still untouched locally.
      for (const key of [
        "title",
        "enabled",
        "time",
        "reminderTime",
        "timeZone",
        "steps",
      ] as const) {
        if (JSON.stringify(local[key]) !== JSON.stringify(base[key])) {
          Object.assign(rebased, { [key]: local[key] });
        }
      }
      revision.current = definition.revision;
      saved.current = JSON.stringify(remote);
      setDraft(rebased);
    }
    if (!busy) {
      const base = JSON.parse(saved.current) as typeof draft;
      if (base.timeZone !== timeZone) {
        const local = draftRef.current;
        saved.current = JSON.stringify({ ...base, timeZone });
        setDraft({ ...local, timeZone });
      }
    }
    previousDefinitionId.current = definition?.id;
  }, [definition, kind, timeZone, busy]);
  const serialized = JSON.stringify(draft);
  const dirty = serialized !== saved.current;
  const input = ritualDefinitionInputSchema.safeParse({
    ...draft,
    requestId: crypto.randomUUID(),
    deviceId: ritualDeviceId(),
    expectedRevision: revision.current,
  });
  useEffect(() => {
    if (!dirty || busy || error) return;
    const value = ritualDefinitionInputSchema.safeParse({
      ...JSON.parse(serialized),
      requestId: crypto.randomUUID(),
      deviceId: ritualDeviceId(),
      expectedRevision: revision.current,
    });
    if (!value.success) return;
    const timer = setTimeout(() => {
      setBusy(true);
      void api
        .saveRitual(value.data)
        .then((result) => {
          revision.current = result.revision;
          saved.current = serialized;
          cache.setQueryData<{ rituals: RitualDefinition[] }>(["rituals"], (old) => ({
            rituals: [...(old?.rituals ?? []).filter((item) => item.kind !== kind), result],
          }));
          void cache.invalidateQueries({ queryKey: ["rituals"] });
        })
        .catch(async (e: unknown) => {
          setError(
            classifyMutationError(e, {
              action: "save ritual settings",
              form: true,
              safeToRetry: false,
            }).message,
          );
          if (typeof e === "object" && e !== null && "status" in e && e.status === 409) {
            try {
              const latest = await api.listRituals();
              cache.setQueryData(["rituals"], latest);
              setError(
                "This ritual changed elsewhere. Your edits are preserved. Retry saving to apply them",
              );
            } catch {
              setError(
                "Unable to refresh changed settings. Your edits are preserved. Retry saving to reconnect",
              );
            }
          }
        })
        .finally(() => setBusy(false));
    }, 500);
    return () => clearTimeout(timer);
  }, [serialized, dirty, busy, error, cache, kind]);
  async function retrySaving() {
    setBusy(true);
    try {
      const latest = await api.listRituals();
      cache.setQueryData(["rituals"], latest);
      setError("");
    } catch (e) {
      setError(
        classifyMutationError(e, { action: "refresh ritual settings", safeToRetry: true }).message,
      );
    } finally {
      setBusy(false);
    }
  }
  function patch(value: Partial<typeof draft>) {
    setError("");
    setDraft((old) => ({ ...old, ...value }));
  }
  function update(id: string, value: Partial<RitualStep>) {
    patch({ steps: draft.steps.map((step) => (step.id === id ? { ...step, ...value } : step)) });
  }
  function move(index: number, offset: number) {
    const steps = [...draft.steps];
    [steps[index], steps[index + offset]] = [steps[index + offset]!, steps[index]!];
    patch({ steps });
  }
  const previewDefinition: RitualDefinition = {
    ...draft,
    id: definition?.id ?? `preview-${kind}`,
    revision: revision.current || 1,
    enabledAt: definition?.enabledAt ?? new Date().toISOString(),
  };
  async function show() {
    setOpening(true);
    setActionError("");
    try {
      const state = await makeRitualPreview(previewDefinition);
      if (isDesktop()) await showRitualPreview(state);
      else setPreview(state);
    } catch (e) {
      setActionError(
        classifyMutationError(e, { action: "show this ritual", safeToRetry: true }).message,
      );
    } finally {
      setOpening(false);
    }
  }
  async function automatic(enabled: boolean) {
    setActionError("");
    try {
      await enableRitualPresentation(enabled);
      await cache.invalidateQueries({ queryKey: ["ritual-local"] });
      toast.success(enabled ? "Automatic rituals enabled" : "Automatic rituals paused");
    } catch (e) {
      setActionError(
        classifyMutationError(e, {
          action: enabled ? "enable automatic rituals" : "pause automatic rituals",
          safeToRetry: true,
        }).message,
      );
    }
  }
  return (
    <SettingsBento>
      {content !== "checklist" ? <div className="flex flex-col gap-4">
        <SettingsSection layout="rows" title={`${label} Ritual`} headerAside={<RitualSkyPreview kind={kind} disabled={!input.success || busy || dirty || opening} onPreview={() => void show()} />} headerContent={content === "schedule" ? <RitualSettingsProgress definition={definition ?? previewDefinition} /> : null} description={kind === "morning" ? "Start your day with intention. At your chosen time, the ritual covers your screen and guides you through your steps before you continue. You can snooze or skip when needed." : "Wind down and prepare for tomorrow. At your chosen time, the ritual covers your screen for a moment of reflection and your evening steps. You can snooze or skip when needed."}>
          <FieldGroup>
            <Field orientation="horizontal">
              <Switch
                id={`${kind}-enabled`}
                checked={draft.enabled}
                onCheckedChange={(v) => patch({ enabled: v === true })}
              />
              <FieldLabel htmlFor={`${kind}-enabled`}>
                Enable {label.toLowerCase()} ritual
              </FieldLabel>
            </Field>
            <DependentSetting enabled={draft.enabled} reason={`Turn on Enable ${label.toLowerCase()} ritual to change its schedule and reminder time.`}>
            <Field>
              <FieldLabel htmlFor={`${kind}-time`}>Available from</FieldLabel>
              <Input
                id={`${kind}-time`}
                type="time"
                disabled={!draft.enabled}
                value={draft.time}
                onChange={(e) => patch({ time: e.target.value })}
              />
              <FieldDescription>Stays available until you complete or skip it</FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor={`${kind}-reminder-time`}>{label} reminder time</FieldLabel>
              <Input
                id={`${kind}-reminder-time`}
                type="time"
                disabled={!draft.enabled}
                value={draft.reminderTime}
                onChange={(event) => patch({ reminderTime: event.target.value })}
              />
              <FieldDescription>Default for optional steps you choose to do later</FieldDescription>
            </Field>
            </DependentSetting>
          </FieldGroup>
          {content === "schedule" ? <div className="settings-divider-before"><ProfileRow label="Steps" value={`${draft.steps.length} steps`} to={settingsPath(kind === "morning" ? "ritual-morning" : "ritual-evening")} /></div> : null}
        </SettingsSection>
        <div className="flex justify-end gap-2">
            <RitualDataAction kind={kind} disabled={busy || dirty || opening} />

        </div>
        <div className="flex flex-col items-start gap-3 empty:hidden">
            {isDesktop() ? (
              <>
                <RitualLocal />
                <div className="flex min-w-0 flex-col items-start gap-2">
                  <Button
                    asChild={!dirty && !busy}
                    disabled={dirty || busy}
                    variant="ghost"
                    size="sm"
                  >
                    {dirty || busy ? (
                      "Background settings"
                    ) : (
                      <a href="/settings?page=desktop">Background settings</a>
                    )}
                  </Button>
                  {dirty || busy ? (
                    <p className="text-sm text-muted-foreground">
                      Save routine changes before leaving this page.
                    </p>
                  ) : null}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" onClick={() => void automatic(true)}>
                    Enable
                  </Button>
                  <Button variant="ghost" onClick={() => void automatic(false)}>
                    Pause
                  </Button>
                </div>
              </>
            ) : null}
            {error ? (
              <Button variant="ghost" onClick={() => void retrySaving()}>
                Retry saving
              </Button>
            ) : null}
            {dirty && !input.success ? (
              <p>Complete each ritual step with a label and valid answer options to save.</p>
            ) : null}
          </div>
      </div> : null}
      {content !== "schedule" ? <SettingsSection
        layout="rows"
        title="Steps"
        action={
          <SettingsRecordAction
            label="Add step"
            disabled={draft.steps.length >= 20}
            onClick={() =>
              patch({
                steps: [...draft.steps, { id: crypto.randomUUID(), label: "", kind: "checkbox" }],
              })
            }
          >
            <PlusIcon />
          </SettingsRecordAction>
        }
      >
        <div className="flex flex-col gap-5">
          <Reorder.Group
            as="div"
            axis="y"
            values={draft.steps}
            onReorder={(steps) => patch({ steps })}
          >
            <ItemGroup className="gap-0">
              {draft.steps.map((step, index) => (
                <SortableStep
                  key={step.id}
                  step={step}
                  index={index}
                  count={draft.steps.length}
                  remove={() => patch({ steps: draft.steps.filter((s) => s.id !== step.id) })}
                  move={(offset) => move(index, offset)}
                >
                  <FieldGroup>
                    <Field>
                      <FieldLabel htmlFor={`${kind}-${step.id}`}>Prompt</FieldLabel>
                      <Input
                        id={`${kind}-${step.id}`}
                        value={step.label}
                        maxLength={240}
                        onChange={(e) => update(step.id, { label: e.target.value })}
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor={`${kind}-${step.id}-type`}>Response type</FieldLabel>
                      <NativeSelect
                        id={`${kind}-${step.id}-type`}
                        value={step.kind}
                        onChange={(e) => {
                          const nextKind = e.target.value as RitualStep["kind"];
                          update(step.id, {
                            kind: nextKind,
                            options:
                              nextKind === "multiple_choice"
                                ? (step.options ?? ["Yes", "No"])
                                : undefined,
                          });
                        }}
                      >
                        {responseTypes.map((type) => (
                          <NativeSelectOption key={type.value} value={type.value}>
                            {type.label}
                          </NativeSelectOption>
                        ))}
                      </NativeSelect>
                    </Field>
                    <Field>
                      <FieldLabel htmlFor={`${kind}-${step.id}-requirement`}>
                        Required
                      </FieldLabel>
                      <Switch
                        id={`${kind}-${step.id}-requirement`}
                        checked={!step.optional}
                        onCheckedChange={(required) => update(step.id, { optional: !required })}
                      />
                    </Field>
                    <StepDays
                      id={`${kind}-${step.id}`}
                      days={step.days}
                      onChange={(days) => update(step.id, { days })}
                    />
                    {step.kind === "multiple_choice" ? (
                      <Field>
                        <FieldLabel htmlFor={`${kind}-${step.id}-options`}>Choices</FieldLabel>
                        <Textarea
                          id={`${kind}-${step.id}-options`}
                          value={step.options?.join("\n") ?? ""}
                          onChange={(e) => update(step.id, { options: e.target.value.split("\n") })}
                        />
                        <FieldDescription>
                          One choice per line, between 2 and 12 choices
                        </FieldDescription>
                      </Field>
                    ) : null}
                  </FieldGroup>
                </SortableStep>
              ))}
            </ItemGroup>
          </Reorder.Group>
        </div>
      </SettingsSection> : null}
      {content === "checklist" && error ? <Button variant="secondary" onClick={() => void retrySaving()}>Retry saving</Button> : null}
      {preview ? <RitualPreview state={preview} onClose={() => setPreview(null)} /> : null}
    </SettingsBento>
  );
}

function SortableStep({
  step,
  index,
  count,
  move,
  remove,
  children,
}: {
  step: RitualStep;
  index: number;
  count: number;
  move: (offset: number) => void;
  children: ReactNode;
  remove: () => void;
}) {
  const controls = useDragControls();
  const [open, setOpen] = useState(!step.label);
  const [dragging, setDragging] = useState(false);
  const { confirm, confirmation } = useConfirmAction();
  return (
    <Reorder.Item
      as="div"
      role="listitem"
      value={step}
      dragListener={false}
      dragControls={controls}
      data-dragging={dragging || undefined}
      onDragStart={() => setDragging(true)}
      onDragEnd={() => setDragging(false)}
      className="ritual-step-row settings-inline-row relative flex min-h-12 items-center gap-2 px-4 py-2"
    >
      <Dialog open={open} onOpenChange={setOpen}>
              <ReorderHandle controls={controls} label={`Reorder step ${index + 1}`}
                onMove={move} canMoveUp={index > 0} canMoveDown={index < count - 1} />
          <DialogTrigger asChild>
            <Button variant="ghost" aria-label={`Edit step ${index + 1}`}
              className="ritual-step-trigger h-auto min-h-12 min-w-0 flex-1 justify-between gap-8 rounded-none px-0 py-2 text-left">
              <span className="min-w-0">
                <span className="block truncate font-medium">{step.label || `New step ${index + 1}`}</span>
                <span className="block truncate text-xs font-normal text-muted-foreground">
                  {`${responseTypes.find((type) => type.value === step.kind)?.label ?? step.kind} · ${step.optional ? "Optional" : "Required"} · ${!step.days || step.days.length === 7 ? "Every day" : step.days.map((day) => dayNames[day]?.slice(0, 3)).join(", ")}`}
                </span>
              </span>
              <ChevronRightIcon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
            </Button>
          </DialogTrigger>
          <DialogContent showCloseButton={false} className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>Edit Step {index + 1}</DialogTitle>
              <DialogDescription>
                Changes save automatically. Close to return to your routine.
              </DialogDescription>
            </DialogHeader>
            <div className="settings-panel ritual-step-editor">{children}</div>
            <DialogFooter>
              <Button variant="destructive" disabled={count === 1} onClick={() => confirm({
                title: "Delete step?",
                description: "This removes the step from this routine. Past ritual entries are kept.",
                actionLabel: "Delete step",
                onConfirm: remove,
              })}>Delete</Button>
              <DialogClose asChild>
                <Button type="button">Done</Button>
              </DialogClose>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        {confirmation}
      </Reorder.Item>
  );
}

const weekdays = [1, 2, 3, 4, 5];
const weekends = [0, 6];
const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
function StepDays({
  id,
  days,
  onChange,
}: {
  id: string;
  days: number[] | undefined;
  onChange: (days: number[] | undefined) => void;
}) {
  const [custom, setCustom] = useState(false);
  const selected = days?.slice().sort().join(",");
  const mode = custom
    ? "custom"
    : !days || days.length === 7
      ? "daily"
      : selected === weekdays.join(",")
        ? "weekdays"
        : selected === weekends.join(",")
          ? "weekends"
          : "custom";
  return (
    <Field>
      <FieldLabel htmlFor={`${id}-days`}>Include on</FieldLabel>
      <NativeSelect
        id={`${id}-days`}
        value={mode}
        onChange={(event) => {
          const mode = event.target.value;
          setCustom(mode === "custom");
          onChange(
            mode === "daily"
              ? undefined
              : mode === "weekdays"
                ? weekdays
                : mode === "weekends"
                  ? weekends
                  : (days ?? weekdays),
          );
        }}
      >
        <NativeSelectOption value="daily">Every day</NativeSelectOption>
        <NativeSelectOption value="weekdays">Weekdays</NativeSelectOption>
        <NativeSelectOption value="weekends">Weekends</NativeSelectOption>
        <NativeSelectOption value="custom">Custom days</NativeSelectOption>
      </NativeSelect>
      {mode === "custom" ? (
        <fieldset className="flex flex-wrap gap-3" aria-label="Days of the week">
          {[1, 2, 3, 4, 5, 6, 0].map((day) => (
            <Field key={day} orientation="horizontal" className="w-auto">
              <Checkbox
                id={`${id}-day-${day}`}
                checked={days?.includes(day) ?? true}
                disabled={days?.length === 1 && days.includes(day)}
                onCheckedChange={(checked) =>
                  onChange(
                    checked
                      ? [...(days ?? []), day].sort()
                      : days?.filter((value) => value !== day),
                  )
                }
              />
              <FieldLabel htmlFor={`${id}-day-${day}`}>{dayNames[day]}</FieldLabel>
            </Field>
          ))}
        </fieldset>
      ) : null}
    </Field>
  );
}
