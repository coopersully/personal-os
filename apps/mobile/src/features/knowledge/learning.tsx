import {
  type KnowledgePreferenceKey,
  type KnowledgePreferenceSelection,
  type KnowledgeSelectionInteraction,
  knowledgePreferenceClaimKey,
  knowledgePreferenceContent,
  knowledgePreferenceKeySchema,
  knowledgePreferenceSelectionSchema,
  knowledgeSelectionInputSchema,
} from "@personal-os/domain";
import { Stack } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { Alert, View } from "react-native";
import { toast } from "sonner-native";
import { editorDismissOptions } from "../../components/editor-header";
import { Section, ToggleRow } from "../goals/controls";
import { SettingsActionRow } from "../settings/settings-row";
import {
  type Feedback,
  type MemoryAccess,
  type MemoryApi,
  readMemory,
  statusOf,
  useMemoryCommands,
  useMemoryResource,
  useMutationKey,
} from "./authority";
import { MemoryBody, MemoryChoice, MemoryReadState, MemoryText } from "./controls";
import { memoryLabel, preferenceLabels } from "./presentation";

const choices = {
  "presentation.detail": ["concise", "detailed"],
  "presentation.format": ["prose", "bullets"],
} as const;
const preferenceKeys = knowledgePreferenceKeySchema.options;

export function MemoryLearning({
  api,
  access,
  close,
  retain,
  changed,
}: {
  api: MemoryApi;
  access: MemoryAccess;
  close: () => void;
  retain: (id: string, feedback: Feedback) => void;
  changed: () => void;
}) {
  const [key, setKey] = useState<KnowledgePreferenceKey>("presentation.detail");
  const [value, setValue] = useState<KnowledgePreferenceSelection["value"]>("concise");
  const commands = useMemoryCommands(access.capture, access.recover);
  const toggleKey = useMutationKey();
  const resetKey = useMutationKey();
  const rememberKey = useMutationKey();
  const interaction = useRef<{
    selection: KnowledgePreferenceSelection;
    receipt: KnowledgeSelectionInteraction;
  }>(null);
  const load = useCallback(
    (signal: AbortSignal) =>
      readMemory(
        access,
        signal,
        async () => {
          const [settings, list] = await Promise.all([
            api.getKnowledgeSettings(),
            api.searchKnowledge({ purpose: "planning", limit: 1 }),
          ]);
          return { settings, epoch: list.epoch };
        },
        { epoch: (result) => result.epoch },
      ),
    [access, api],
  );
  const settings = useMemoryResource(load);

  function toggle(automaticPreferenceAcceptance: boolean) {
    if (!settings.value) return;
    const body = {
      automaticPreferenceAcceptance,
      expectedRevision: settings.value.settings.revision,
    };
    void commands.run({
      loading: "Updating learning settings…",
      failure: "Couldn’t confirm the setting was saved. You can retry the same choice.",
      request: () => api.updateKnowledgeSettings({ ...body, mutationKey: toggleKey(body) }),
      complete: (result) => {
        changed();
        return {
          message: result.automaticPreferenceAcceptance
            ? "Automatic learning enabled."
            : "Automatic learning disabled.",
        };
      },
      rejected: (error) => {
        if (statusOf(error) !== 409) return;
        void settings.reload().catch(() => {});
        return "Learning settings changed. Review the current switch.";
      },
      retain,
    });
  }

  function reset(preference: KnowledgePreferenceKey) {
    if (!settings.value) return;
    const body = {
      claimKey: knowledgePreferenceClaimKey(preference),
      expectedEpoch: settings.value.epoch,
    };
    Alert.alert(
      `Reset ${preferenceLabels[preference].toLowerCase()} learning?`,
      "Future selections can build new evidence for this preference.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Reset learning",
          onPress: () =>
            void commands.run({
              loading: "Resetting learning…",
              failure: "Couldn’t confirm the reset. You can retry.",
              request: () => api.resetKnowledgeLearning({ ...body, mutationKey: resetKey(body) }),
              complete: () => {
                changed();
                return { message: "Learning reset." };
              },
              rejected: (error) => {
                if (statusOf(error) !== 409) return;
                void settings.reload().catch(() => {});
                return "Memory changed. Review the current settings.";
              },
              retain,
            }),
        },
      ],
    );
  }

  function select(remember: boolean) {
    const selection = knowledgePreferenceSelectionSchema.parse({ key, value });
    if (remember) {
      void commands.run({
        loading: "Saving your preference…",
        failure: "Couldn’t confirm the preference was saved. You can retry.",
        request: () =>
          api.saveKnowledge({
            content: knowledgePreferenceContent(selection),
            mutationKey: rememberKey(selection),
            scope: { workspace: null },
            sensitivity: "standard",
            purposes: ["planning", "review", "communication"],
            evidence: [
              { type: "statement", wording: `${preferenceLabels[key]}. ${memoryLabel(value)}.` },
            ],
            relatedRecordIds: [],
          }),
        complete: (result) => {
          changed();
          return {
            message:
              result.outcome === "readable"
                ? "Preference saved."
                : result.outcome === "pending_owner_review"
                  ? "Preference saved for review."
                  : "This preference is unavailable.",
          };
        },
        retain,
      });
      return;
    }
    void commands.run({
      loading: "Recording your choice…",
      failure: "Couldn’t confirm this choice. You can retry the same selection.",
      request: async (current) => {
        let retained = interaction.current;
        if (retained?.selection.key !== key || retained.selection.value !== value) {
          const receipt = await api.issueKnowledgeSelectionInteraction();
          if (!current()) return;
          retained = { selection, receipt };
          interaction.current = retained;
        }
        return api.recordKnowledgeSelection(
          knowledgeSelectionInputSchema.parse({
            ...selection,
            sourceEventId: retained.receipt.sourceEventId,
          }),
        );
      },
      complete: (result) => {
        interaction.current = null;
        if (!result) return;
        changed();
        return {
          message: "Choice available for 24 hours.",
          description: "Authorized agents can use this choice as context.",
        };
      },
      rejected: (error) => {
        if (![404, 409].includes(statusOf(error) ?? 0)) return;
        interaction.current = null;
        return "This selection expired or changed. Choose “Use this time” again.";
      },
      retain,
    });
  }

  return (
    <MemoryBody>
      <Stack.Screen options={editorDismissOptions({ label: "Close", onPress: close })} />
      <Section title="Preference learning">
        <View style={{ padding: 16 }}>
          <MemoryText>
            nohmi can learn response detail and format after matching selections on three different
            days within 30 days.
          </MemoryText>
        </View>
        <MemoryReadState
          {...settings}
          label="learning settings"
          retry={() =>
            void settings.reload().catch(() => toast.error("Couldn’t load learning settings."))
          }
        />
        {settings.value && (
          <ToggleRow
            label="Automatically accept preferences"
            value={settings.value.settings.automaticPreferenceAcceptance}
            onChange={toggle}
            disabled={commands.busy}
          />
        )}
        {preferenceKeys.map((preference) => (
          <SettingsActionRow
            key={preference}
            label={`Reset ${preferenceLabels[preference].toLowerCase()} learning`}
            onPress={() => reset(preference)}
            disabled={commands.busy || !settings.value}
          />
        ))}
      </Section>
      <Section title="Choose a preference">
        <MemoryChoice
          label="Preference"
          value={key}
          choices={preferenceKeys}
          labels={preferenceLabels}
          onChange={(next) => {
            setKey(next);
            setValue(choices[next][0]);
          }}
          disabled={commands.busy}
        />
        <MemoryChoice
          label="Choice"
          value={value}
          choices={choices[key]}
          onChange={setValue}
          disabled={commands.busy}
        />
        <SettingsActionRow
          label="Use this time"
          onPress={() => select(false)}
          disabled={commands.busy}
        />
        <SettingsActionRow
          label="Remember this preference"
          onPress={() => select(true)}
          disabled={commands.busy}
        />
      </Section>
      <SettingsActionRow label="Back to memory" onPress={close} />
    </MemoryBody>
  );
}
