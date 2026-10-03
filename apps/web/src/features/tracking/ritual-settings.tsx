import {
  type RitualDefinition,
  type RitualState,
  type RitualStep,
  ritualDefinitionInputSchema,
} from "@personal-os/domain";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Reorder, useDragControls } from "motion/react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { api } from "../../api.js";
import { QueryFeedback } from "../../components/async-state.js";
import { MenuIcon, PlusIcon, TrashIcon } from "../../components/icons.js";
import { SegmentedControl, SegmentedControlItem } from "../../components/segmented-control.js";
import { SettingsRecordAction, SettingsRecordContent } from "../../components/settings-record.js";
import { Button } from "../../components/ui/button.js";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../components/ui/card.js";
import { Checkbox } from "../../components/ui/checkbox.js";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "../../components/ui/field.js";
import { Input } from "../../components/ui/input.js";
import { Item, ItemGroup } from "../../components/ui/item.js";
import { NativeSelect, NativeSelectOption } from "../../components/ui/native-select.js";
import { Spinner } from "../../components/ui/spinner.js";
import { Textarea } from "../../components/ui/textarea.js";
import { classifyMutationError } from "../../lib/feedback.js";
import { isDesktop } from "../desktop/bridge.js";
import {
  enableRitualPresentation,
  ritualDeviceId,
  showRitualPreview,
} from "../desktop/ritual-bridge.js";
import { SettingsBento, SettingsSection } from "../settings/settings-layout.js";
import { RitualHistory } from "./ritual-history.js";
import { RitualLocal } from "./ritual-local.js";
import { makeRitualPreview, RitualPreview } from "./ritual-preview.js";

const kinds = ["morning", "night"] as const;
const responseTypes: { value: RitualStep["kind"]; label: string }[] = [
  { value: "checkbox", label: "Checkbox" },
  { value: "short_text", label: "Short entry" },
  { value: "time", label: "Time entry" },
  { value: "date", label: "Date entry" },
  { value: "number", label: "Number entry" },
  { value: "multiple_choice", label: "Multiple choice" },
];
export function RitualSettings({ timeZone }: { timeZone: string }) {
  const query = useQuery({ queryKey: ["rituals"], queryFn: api.listRituals });
  const [selected, setSelected] = useState<"morning" | "night" | "history">("morning");
  if (query.isPending) return <p>Loading rituals…</p>;
  if (query.isError && !query.data)
    return (
      <Card>
        <CardContent>
          <QueryFeedback query={query} title="Couldn’t load ritual settings." />
          <Button onClick={() => void query.refetch()}>Retry</Button>
        </CardContent>
      </Card>
    );
  return (
    <div className="settings-stack">
      <QueryFeedback query={query} title="Couldn’t refresh ritual settings." staleOnly />
      <SettingsSection
        title="Ritual view"
        description="Configure your daily routines or review their history."
      >
        <SegmentedControl
          aria-label="Choose ritual"
          value={selected}
          onValueChange={(value) => {
            if (value === "morning" || value === "night" || value === "history") setSelected(value);
          }}
        >
          <SegmentedControlItem value="morning">Morning</SegmentedControlItem>
          <SegmentedControlItem value="night">Evening</SegmentedControlItem>
          <SegmentedControlItem value="history">History and data</SegmentedControlItem>
        </SegmentedControl>
      </SettingsSection>
      {kinds.map((kind) => (
        <div key={kind} hidden={selected !== kind}>
          <RitualForm
            kind={kind}
            definition={query.data.rituals.find((d) => d.kind === kind)}
            timeZone={query.data.rituals[0]?.timeZone ?? timeZone}
          />
        </div>
      ))}
      {selected === "history" ? (
        <Card>
          <CardHeader>
            <CardTitle>History and data</CardTitle>
          </CardHeader>
          <CardContent>
            <RitualHistory />
          </CardContent>
        </Card>
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
    time: definition?.time ?? (kind === "morning" ? "06:00" : "21:00"),
    timeZone: definition?.timeZone ?? timeZone,
    steps: definition?.steps ?? [
      { id: crypto.randomUUID(), label: "Brush your teeth", kind: "checkbox" as const },
      { id: crypto.randomUUID(), label: "Journal", kind: "short_text" as const },
    ],
  };
}
function RitualForm({
  kind,
  definition,
  timeZone,
}: {
  kind: "morning" | "night";
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
  const [message, setMessage] = useState("");
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
      for (const key of ["title", "enabled", "time", "timeZone", "steps"] as const) {
        if (JSON.stringify(local[key]) !== JSON.stringify(base[key])) {
          Object.assign(rebased, { [key]: local[key] });
        }
      }
      revision.current = definition.revision;
      saved.current = JSON.stringify(remote);
      setDraft(rebased);
    }
    if (!busy && !definition) {
      const base = JSON.parse(saved.current) as typeof draft;
      if (base.timeZone !== timeZone) {
        const local = draftRef.current;
        saved.current = JSON.stringify({ ...base, timeZone });
        if (local.timeZone === base.timeZone) setDraft({ ...local, timeZone });
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
    setMessage("");
    try {
      const state = await makeRitualPreview(previewDefinition);
      if (isDesktop()) await showRitualPreview(state);
      else setPreview(state);
    } catch (e) {
      setMessage(
        classifyMutationError(e, { action: "show this ritual", safeToRetry: true }).message,
      );
    } finally {
      setOpening(false);
    }
  }
  async function automatic(enabled: boolean) {
    try {
      await enableRitualPresentation(enabled);
      await cache.invalidateQueries({ queryKey: ["ritual-local"] });
      setMessage(enabled ? "Automatic rituals enabled" : "Automatic rituals paused");
    } catch (e) {
      setMessage(
        classifyMutationError(e, {
          action: enabled ? "enable automatic rituals" : "pause automatic rituals",
          safeToRetry: true,
        }).message,
      );
    }
  }
  return (
    <SettingsBento>
      <div className="flex flex-col gap-4">
        <Card>
          <CardHeader>
            <CardTitle>{label} ritual</CardTitle>
            <CardDescription>Set the start of your daily routine</CardDescription>
          </CardHeader>
          <CardContent>
            <FieldGroup>
              <Field orientation="horizontal">
                <Checkbox
                  id={`${kind}-enabled`}
                  checked={draft.enabled}
                  onCheckedChange={(v) => patch({ enabled: v === true })}
                />
                <FieldLabel htmlFor={`${kind}-enabled`}>
                  Enable {label.toLowerCase()} ritual
                </FieldLabel>
              </Field>
              <Field>
                <FieldLabel htmlFor={`${kind}-time`}>Available from</FieldLabel>
                <Input
                  id={`${kind}-time`}
                  type="time"
                  value={draft.time}
                  onChange={(e) => patch({ time: e.target.value })}
                />
                <FieldDescription>Stays available until you complete or skip it</FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor={`${kind}-zone`}>Time zone</FieldLabel>
                <Input
                  id={`${kind}-zone`}
                  value={draft.timeZone}
                  onChange={(e) => patch({ timeZone: e.target.value })}
                />
                <FieldDescription>
                  Applies to both rituals from the next scheduled time
                </FieldDescription>
              </Field>
            </FieldGroup>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>{isDesktop() ? "This Mac" : "Show ritual"}</CardTitle>
            <CardDescription>
              Replay the full experience anytime, including after completion
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <Button
              variant="outline"
              disabled={!input.success || busy || dirty || opening}
              onClick={() => void show()}
            >
              {opening ? <Spinner /> : null}Show {label.toLowerCase()} ritual
            </Button>
            {isDesktop() ? (
              <>
                <RitualLocal />
                <div className="flex gap-2">
                  <Button variant="outline" onClick={() => void automatic(true)}>
                    Enable
                  </Button>
                  <Button variant="ghost" onClick={() => void automatic(false)}>
                    Pause
                  </Button>
                </div>
              </>
            ) : null}
            {message ? <p role="status">{message}</p> : null}
            {busy || dirty ? (
              <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
                <Spinner className="size-3" />
                {dirty && !input.success ? "Finish the fields to save" : "Saving"}
              </p>
            ) : null}
            {error ? (
              <>
                <p role="alert">{error}</p>
                <Button variant="ghost" onClick={() => void retrySaving()}>
                  Retry saving
                </Button>
              </>
            ) : null}
            {dirty && !input.success ? (
              <p>Complete each ritual step with a label and valid answer options to save.</p>
            ) : null}
          </CardContent>
        </Card>
      </div>
      <Card className="settings-bento__main">
        <CardHeader>
          <CardTitle>Checklist</CardTitle>
          <CardAction>
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
          </CardAction>
          <CardDescription>Add the things you want to do or track, in order</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <Reorder.Group
            as="div"
            axis="y"
            values={draft.steps}
            onReorder={(steps) => patch({ steps })}
          >
            <ItemGroup>
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
        </CardContent>
      </Card>
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
  return (
    <Item variant="secondary" className="settings-record" asChild>
      <Reorder.Item
        as="div"
        role="listitem"
        value={step}
        dragListener={false}
        dragControls={controls}
        className="relative cursor-grab items-start active:cursor-grabbing"
        onPointerDown={(event) => {
          if (
            !(event.target instanceof Element) ||
            event.target.closest(
              "input,textarea,select,label,button,a,[role=combobox],[role=radio],[role=checkbox],[contenteditable=true]",
            )
          )
            return;
          controls.start(event);
        }}
      >
        <SettingsRecordContent
          title={`Step ${index + 1}`}
          actions={
            <SettingsRecordAction label="Remove step" disabled={count === 1} onClick={remove}>
              <TrashIcon />
            </SettingsRecordAction>
          }
          leading={
            <Button
              variant="ghost"
              size="icon-sm"
              className="cursor-grab touch-none active:cursor-grabbing"
              aria-label={`Reorder step ${index + 1}`}
              aria-description="Drag to reorder or use the up and down arrow keys"
              onPointerDown={(event) => controls.start(event)}
              onKeyDown={(event) => {
                const offset = event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : 0;
                if (offset) {
                  event.preventDefault();
                  if (index + offset >= 0 && index + offset < count) move(offset);
                }
              }}
            >
              <MenuIcon />
            </Button>
          }
        >
          {children}
        </SettingsRecordContent>
      </Reorder.Item>
    </Item>
  );
}
