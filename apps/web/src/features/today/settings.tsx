import { defaultTodayPreferences, type TodayPreferences } from "@personal-os/domain";
import { Link } from "react-router-dom";
import { ChoiceCardGroup } from "@/components/choice-card-group";
import { CloudIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { SettingsSection } from "@/features/settings/settings-layout";
import {
  preferenceValueLabel,
  SettingsSaveRecovery,
} from "@/features/workspace-settings/save-recovery";
import { SettingsFeedbackContext, useSettingsError } from "@/lib/settings-feedback";
import { useSaveTodayPreferences, useTodayPreferences } from "./preferences";

export function TodaySettingsPage() {
  return (
    <SettingsFeedbackContext.Provider value={true}>
      <TodaySettingsContent />
    </SettingsFeedbackContext.Provider>
  );
}
function TodaySettingsContent() {
  const query = useTodayPreferences();
  const save = useSaveTodayPreferences();
  useSettingsError(query.error, "Could not load Today preferences.", query.refetch);
  const preferences = query.data?.preferences ?? defaultTodayPreferences;
  const disabled = !query.data || !!save.recovery;
  const toggles = [
    [
      "showSpending",
      "Spending",
      "See posted spending for this week or month, using your Finance account selection.",
    ],
    ["showRitual", "Current ritual", "Keep your current ritual within reach."],
    ["showPet", "Desktop pet", "Show quick access when your desktop pet is enabled."],
    [
      "includeUndated",
      "Undated commitments",
      "Include tasks and reminders without a date in To take care of.",
    ],
  ] as const;
  return (
    <div className="settings-page">
      <header className="settings-page__heading">
        <div>
          <h1>Today at a Glance settings</h1>
          <p>Make Today feel like your day.</p>
        </div>
        <Button variant="outline" asChild>
          <Link to="/today">Back to Today</Link>
        </Button>
      </header>
      <div className="settings-panel">
        <SettingsSection
          title="Background"
          description="Choose a quiet default, today's weather, or a map of your current location."
        >
          <ChoiceCardGroup
            aria-label="Background"
            value={preferences.background}
            disabled={disabled}
            onValueChange={(background) => save.mutate({ background })}
            options={[
              {
                value: "default",
                label: "Default",
                preview: <span className="block h-20 w-32 rounded bg-muted" />,
              },
              {
                value: "weather",
                label: "Weather",
                preview: (
                  <span
                    className="today-weather-preview flex h-20 w-32 items-center justify-center rounded"
                    aria-hidden="true"
                  >
                    <CloudIcon className="size-8" />
                  </span>
                ),
              },
              {
                value: "map",
                label: "Map",
                preview: (
                  <span className="today-map-preview h-20 w-32 rounded" aria-hidden="true">
                    {["north", "northeast", "east", "south", "southwest", "west"].map(
                      (direction) => (
                        <span key={direction} />
                      ),
                    )}
                  </span>
                ),
              },
            ]}
          />
          <p className="text-sm text-muted-foreground">
            Weather and map backgrounds fall back to Default when unavailable. Your choice stays
            saved.
          </p>
        </SettingsSection>
        <SettingsSection
          title="Cards and commitments"
          description="Your timeline and this week's commitments always stay visible."
        >
          {toggles.map(([key, label, description]) => (
            <div key={key} className="flex items-center justify-between gap-4 py-3">
              <div>
                <label htmlFor={`today-${key}`} className="font-medium">
                  {label}
                </label>
                <p className="text-sm text-muted-foreground">{description}</p>
              </div>
              <Switch
                id={`today-${key}`}
                disabled={disabled}
                checked={preferences[key]}
                onCheckedChange={(value) =>
                  save.mutate({ [key]: value } as Partial<TodayPreferences>)
                }
              />
            </div>
          ))}
          <ChoiceCardGroup
            aria-label="Spending period"
            value={preferences.spendingWindow}
            disabled={disabled || !preferences.showSpending}
            onValueChange={(spendingWindow) => save.mutate({ spendingWindow })}
            options={[
              { value: "week", label: "This week" },
              { value: "month", label: "This month" },
            ]}
          />
        </SettingsSection>
        {save.recovery ? (
          <SettingsSaveRecovery
            title="Review your Today preferences"
            outcome={save.recovery.outcome}
            reviewed={!!save.recovery.reviewed}
            pending={query.isFetching || save.isWorkspacePending}
            rows={Object.entries(save.recovery.attempted).map(([key, value]) => ({
              label: key,
              attempted: preferenceValueLabel(value, key),
              current: preferenceValueLabel(
                (save.recovery?.reviewed?.preferences as Record<string, unknown> | undefined)?.[
                  key
                ],
                key,
              ),
            }))}
            onRefresh={() => void save.refreshRecovery()}
            onAccept={save.acceptLatest}
            onReapply={save.reapplyReviewed}
          />
        ) : null}
      </div>
    </div>
  );
}
