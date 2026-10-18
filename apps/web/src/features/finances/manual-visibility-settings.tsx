import type { FinancesWorkspacePreferences } from "@personal-os/domain";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useId } from "react";
import { QueryFeedback } from "@/components/async-state";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { SettingsFeedbackContext } from "@/lib/settings-feedback";
import {
  useSaveWorkspacePreferences,
  useWorkspacePreferences,
} from "../workspace-settings/preferences";
import { WorkspacePreferenceRecovery } from "../workspace-settings/save-recovery";

export function FinanceManualVisibilitySettings() {
  return (
    <SettingsFeedbackContext.Provider value={true}>
      <ManualVisibilitySettings />
    </SettingsFeedbackContext.Provider>
  );
}
function ManualVisibilitySettings() {
  const id = useId();
  const cache = useQueryClient();
  const preferences = useWorkspacePreferences("finances");
  const save = useSaveWorkspacePreferences("finances");
  // Shared recovery can also save a new revision; refresh the server projection after either path.
  useEffect(() => {
    if (preferences.isSuccess && preferences.data?.revision !== undefined)
      void cache.invalidateQueries({ queryKey: ["finance-onboarding"] });
  }, [cache, preferences.isSuccess, preferences.data?.revision]);
  return (
    <section aria-label="Manual Finance tools" className="grid gap-3">
      <QueryFeedback query={preferences} title="Couldn’t load manual tool preferences." />
      <Field>
        <FieldLabel htmlFor={id}>Manual creation and imports</FieldLabel>
        <FieldDescription>
          Auto shows manual tools until an agent is registered. Account linking and record
          corrections remain available.
        </FieldDescription>
        <NativeSelect
          id={id}
          value={preferences.data?.preferences.financeManualVisibility ?? "auto"}
          disabled={!preferences.isSuccess || save.isWorkspacePending || !!save.recovery}
          onChange={(event) =>
            save.mutate({
              financeManualVisibility: event.target
                .value as FinancesWorkspacePreferences["financeManualVisibility"],
            })
          }
        >
          <NativeSelectOption value="auto">Auto</NativeSelectOption>
          <NativeSelectOption value="show">Show</NativeSelectOption>
          <NativeSelectOption value="hide">Hide</NativeSelectOption>
        </NativeSelect>
      </Field>
      <WorkspacePreferenceRecovery
        workspace="finances"
        formatValue={(value, key) =>
          key === "financeManualVisibility"
            ? ({ auto: "Auto", show: "Show", hide: "Hide" }[String(value)] ?? "Unavailable")
            : String(value)
        }
      />
    </section>
  );
}
