import { defaultNotificationPreferences, type NotificationStatus } from "@personal-os/domain";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api";
import { QueryFeedback } from "@/components/async-state";
import { MutationFeedback } from "@/components/mutation-feedback";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Item, ItemContent, ItemDescription, ItemGroup, ItemTitle } from "@/components/ui/item";
import { useFeedbackMutation } from "@/lib/use-feedback-mutation";
import { SettingsSection } from "../settings/settings-layout";

/** Mount only with both Finance and Texting access, matching the notification status API. */
export function FinanceNotificationPreferences({ canEdit = true }: { canEdit?: boolean }) {
  const cache = useQueryClient();
  const query = useQuery({
    queryKey: ["notification-status"],
    queryFn: () => api.getNotificationStatus(),
  });
  const override = query.data?.preferences.find((row) => row.scope === "finances");
  const reset = useFeedbackMutation({
    feedback: { action: "use global Finance notification preferences", safeToRetry: false },
    mutationFn: (expectedRevision: number) =>
      api.resetFinanceNotificationPreferences({ expectedRevision }),
    onSuccess: async () => {
      cache.setQueryData<NotificationStatus>(["notification-status"], (current) =>
        current
          ? {
              ...current,
              preferences: current.preferences.filter((row) => row.scope !== "finances"),
              effective:
                current.preferences.find((row) => row.scope === "global")?.preferences ??
                defaultNotificationPreferences,
            }
          : current,
      );
      await cache.invalidateQueries({ queryKey: ["notification-status"] });
    },
  });
  return (
    <SettingsSection
      title="Finance text notifications"
      description="SMS preferences for Finance reviews. Delivery also depends on Texting consent and readiness."
    >
      <QueryFeedback query={query} title="Couldn’t load Finance notification preferences." />
      {query.isPending ? <p>Loading notification preferences…</p> : null}
      {query.data ? <FinanceNotificationPreferenceSummary status={query.data} /> : null}
      <MutationFeedback feedback={reset.feedback} />
      {reset.isError ? (
        <Button
          type="button"
          variant="secondary"
          disabled={query.isFetching}
          onClick={async () => {
            const latest = await query.refetch();
            if (!latest.isError) reset.reset();
          }}
        >
          Reload notification preferences
        </Button>
      ) : null}
      {override && canEdit ? (
        <Button
          type="button"
          variant="secondary"
          disabled={reset.isPending}
          onClick={() => reset.mutate(override.revision)}
        >
          {reset.isPending ? "Resetting…" : "Use global notification preferences"}
        </Button>
      ) : null}
    </SettingsSection>
  );
}

function minuteLabel(minute: number) {
  return `${Math.floor(minute / 60)
    .toString()
    .padStart(2, "0")}:${(minute % 60).toString().padStart(2, "0")}`;
}

export function FinanceNotificationPreferenceSummary({ status }: { status: NotificationStatus }) {
  const override = status.preferences.find((row) => row.scope === "finances");
  const global = status.preferences.find((row) => row.scope === "global")?.preferences;
  const source = override ? "Overridden for Finances" : "Inherited from global preferences";
  const ceiling = (global ?? defaultNotificationPreferences).detail === "minimal";
  const { effective } = status;
  const rows = [
    ["Notifications", effective.enabled ? "Enabled" : "Disabled"],
    [
      "Quiet hours",
      effective.quietMode === "any_time"
        ? "No quiet hours"
        : `${minuteLabel(effective.quietStartMinute)}–${minuteLabel(effective.quietEndMinute)} (${status.timeZone})`,
    ],
    [
      "Reminder interval",
      effective.reminderDays === null ? "No reminders" : `Every ${effective.reminderDays} days`,
    ],
    ["Message detail", effective.detail === "minimal" ? "Minimal" : "Context"],
  ];
  return (
    <div className="flex flex-col gap-4">
      <Badge variant="secondary">{source}</Badge>
      {!global ? (
        <p className="text-sm text-muted-foreground">
          Global preferences use the default settings.
        </p>
      ) : null}
      {status.capability === "unavailable" ? (
        <p role="status">Finance text notifications are unavailable on this deployment.</p>
      ) : null}
      <ItemGroup>
        {rows.map(([label, value]) => (
          <Item key={label} variant="secondary">
            <ItemContent>
              <ItemTitle>{label}</ItemTitle>
              <ItemDescription>{value}</ItemDescription>
            </ItemContent>
          </Item>
        ))}
      </ItemGroup>
      {ceiling ? (
        <p className="text-sm text-muted-foreground">
          Global preferences limit message detail to Minimal, including Finance overrides.
        </p>
      ) : null}
    </div>
  );
}
