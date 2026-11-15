import {
  type KnowledgePreferenceKey,
  type KnowledgePreferenceSelection,
  type KnowledgeSelectionInteraction,
  knowledgePreferenceClaimKey,
  knowledgePreferenceContent,
  knowledgePreferenceSelectionSchema,
  knowledgeSelectionInputSchema,
} from "@personal-os/domain";
import { useQuery } from "@tanstack/react-query";
import { useId, useRef, useState } from "react";
import { api } from "@/api";
import { QueryFeedback } from "@/components/async-state";
import { useConfirmAction } from "@/components/confirm-action";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { SettingsSection } from "../settings/settings-layout";
import { type MemoryActions, memoryErrorStatus, useMemoryWriteKey } from "./actions";
import { memoryLabel, preferenceLabels } from "./presentation";

const defaults = { "presentation.detail": "concise", "presentation.format": "prose" } as const;
const keys = ["presentation.detail", "presentation.format"] as const;

function preferenceSelection(key: KnowledgePreferenceKey, value: string) {
  return knowledgePreferenceSelectionSchema.parse({ key, value });
}

export function LearningSettings({
  queryKey,
  epoch,
  actions,
  onChanged,
}: {
  queryKey: readonly unknown[];
  epoch: number | undefined;
  actions: MemoryActions;
  onChanged: () => void;
}) {
  const id = useId();
  const toggleInput = useMemoryWriteKey();
  const resetInput = useMemoryWriteKey();
  const settings = useQuery({
    queryKey: [...queryKey, "learning"],
    queryFn: ({ signal }) => {
      signal.throwIfAborted();
      return actions.read(() => api.getKnowledgeSettings());
    },
    retry: false,
  });
  const { confirm, confirmation } = useConfirmAction();

  function toggle(automaticPreferenceAcceptance: boolean) {
    if (!settings.data) return;
    const expectedRevision = settings.data.revision;
    void actions.run({
      pending: "Updating learning settings…",
      failure: "Couldn’t confirm the learning setting was saved. Check the current setting.",
      request: () =>
        api.updateKnowledgeSettings(
          toggleInput({
            automaticPreferenceAcceptance,
            expectedRevision,
            mutationKey: crypto.randomUUID(),
          }),
        ),
      complete: (value) => {
        onChanged();
        return {
          message: value.automaticPreferenceAcceptance
            ? "Automatic learning enabled."
            : "Automatic learning disabled.",
        };
      },
      recover: (error) => {
        void settings.refetch();
        return memoryErrorStatus(error) === 409
          ? "Learning settings changed. Review the current switch before trying again."
          : undefined;
      },
    });
  }

  function reset(key: KnowledgePreferenceKey) {
    if (epoch === undefined) return;
    confirm({
      intent: "default",
      title: `Reset learning for ${preferenceLabels[key].toLowerCase()}?`,
      description: "Future selections can build fresh learning evidence for this preference.",
      actionLabel: "Reset learning",
      onConfirm: () =>
        void actions.run({
          pending: "Resetting learning…",
          failure: "Couldn’t confirm the learning reset.",
          request: () =>
            api.resetKnowledgeLearning(
              resetInput({
                claimKey: knowledgePreferenceClaimKey(key),
                expectedEpoch: epoch,
                mutationKey: crypto.randomUUID(),
              }),
            ),
          complete: () => {
            onChanged();
            return { message: "Learning reset." };
          },
          recover: (error) => {
            if (memoryErrorStatus(error) !== 409) return undefined;
            onChanged();
            return "Memory changed. Review the current settings before trying again.";
          },
        }),
    });
  }

  return (
    <SettingsSection title="Preference Learning">
      <div className="flex min-w-0 flex-col gap-4">
        <QueryFeedback query={settings} title="Couldn’t load learning settings." />
        <Field orientation="horizontal" className="min-w-0 justify-between gap-4">
          <div className="min-w-0">
            <FieldLabel htmlFor={`${id}-learning`}>Automatically accept preferences</FieldLabel>
            <p id={`${id}-rule`} className="text-sm text-muted-foreground">
              nohmi can learn response detail and format after matching selections on three
              different days within 30 days.
            </p>
          </div>
          {settings.data ? (
            <Switch
              id={`${id}-learning`}
              aria-describedby={`${id}-rule`}
              checked={settings.data.automaticPreferenceAcceptance}
              onCheckedChange={toggle}
              disabled={actions.busy}
            />
          ) : settings.isPending ? (
            <Spinner aria-label="Loading learning settings" />
          ) : null}
        </Field>
        {settings.isError && !settings.data ? (
          <Button variant="secondary" className="w-fit" onClick={() => void settings.refetch()}>
            Retry learning settings
          </Button>
        ) : null}
        <div className="flex flex-wrap gap-2">
          {keys.map((key) => (
            <Button
              key={key}
              variant="secondary"
              size="sm"
              className="h-auto whitespace-normal"
              disabled={actions.busy || epoch === undefined}
              onClick={() => reset(key)}
            >
              Reset {preferenceLabels[key].toLowerCase()} learning
            </Button>
          ))}
        </div>
        {confirmation}
      </div>
    </SettingsSection>
  );
}

export function PreferenceSelection({
  actions,
  onChanged,
}: {
  actions: MemoryActions;
  onChanged: () => void;
}) {
  const id = useId();
  const [key, setKey] = useState<KnowledgePreferenceKey>("presentation.detail");
  const [value, setValue] = useState<string>(defaults[key]);
  const interaction = useRef<{
    selection: KnowledgePreferenceSelection;
    receipt: KnowledgeSelectionInteraction;
  } | null>(null);
  const rememberCommand = useRef<{
    selection: KnowledgePreferenceSelection;
    mutationKey: string;
  } | null>(null);
  const values = key === "presentation.detail" ? ["concise", "detailed"] : ["prose", "bullets"];

  function useThisTime() {
    const selection = preferenceSelection(key, value);
    void actions.run({
      pending: "Recording your choice…",
      failure: "Couldn’t confirm this choice. You can retry the same selection.",
      request: async (isCurrent) => {
        const retained = interaction.current;
        if (retained?.selection.key !== key || retained.selection.value !== value) {
          const receipt = await api.issueKnowledgeSelectionInteraction();
          if (!isCurrent()) return;
          interaction.current = { selection, receipt };
        }
        const sourceEventId = interaction.current?.receipt.sourceEventId;
        if (!sourceEventId || !isCurrent()) return;
        return api.recordKnowledgeSelection(
          knowledgeSelectionInputSchema.parse({ ...selection, sourceEventId }),
        );
      },
      complete: (result) => {
        interaction.current = null;
        if (!result) return;
        onChanged();
        return {
          message: "Choice available for 24 hours.",
          description: "Authorized agents can use this choice as context.",
        };
      },
      recover: (error) => {
        if (![404, 409].includes(memoryErrorStatus(error) ?? 0)) return undefined;
        interaction.current = null;
        return "This selection expired or changed. Choose “Use this time” to start a new selection.";
      },
    });
  }

  function remember() {
    const selection = preferenceSelection(key, value);
    const prior = rememberCommand.current;
    const mutationKey =
      prior?.selection.key === key && prior.selection.value === value
        ? prior.mutationKey
        : crypto.randomUUID();
    rememberCommand.current = { selection, mutationKey };
    void actions.run({
      pending: "Saving your preference…",
      failure: "Couldn’t confirm the preference was saved. You can retry the same preference.",
      request: () =>
        api.saveKnowledge({
          content: knowledgePreferenceContent(selection),
          mutationKey,
          scope: { workspace: null },
          sensitivity: "standard",
          purposes: ["planning", "review", "communication"],
          evidence: [
            { type: "statement", wording: `${preferenceLabels[key]}. ${memoryLabel(value)}.` },
          ],
          relatedRecordIds: [],
        }),
      complete: (result) => {
        rememberCommand.current = null;
        onChanged();
        return {
          message:
            result.outcome === "readable"
              ? "Preference remembered."
              : result.outcome === "pending_owner_review"
                ? "Preference saved for review."
                : "This preference is unavailable.",
        };
      },
    });
  }

  return (
    <SettingsSection title="Response Preferences">
      <div className="flex min-w-0 flex-col gap-4">
        <FieldGroup className="grid gap-3 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor={`${id}-preference`}>Preference</FieldLabel>
            <NativeSelect
              id={`${id}-preference`}
              value={key}
              disabled={actions.busy}
              className="w-full"
              onChange={(event) => {
                const next = event.target.value as KnowledgePreferenceKey;
                setKey(next);
                setValue(defaults[next]);
              }}
            >
              {keys.map((option) => (
                <NativeSelectOption key={option} value={option}>
                  {preferenceLabels[option]}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>
          <Field>
            <FieldLabel htmlFor={`${id}-choice`}>Choice</FieldLabel>
            <NativeSelect
              id={`${id}-choice`}
              value={value}
              disabled={actions.busy}
              className="w-full"
              onChange={(event) => setValue(event.target.value)}
            >
              {values.map((option) => (
                <NativeSelectOption key={option} value={option}>
                  {memoryLabel(option)}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>
        </FieldGroup>
        <p className="text-sm text-muted-foreground">
          Use this time makes the choice available for 24 hours and can count toward learning.
          Remember this preference saves it immediately as stated memory.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" disabled={actions.busy} onClick={useThisTime}>
            Use this time
          </Button>
          <Button className="h-auto whitespace-normal" disabled={actions.busy} onClick={remember}>
            Remember this preference
          </Button>
        </div>
      </div>
    </SettingsSection>
  );
}
