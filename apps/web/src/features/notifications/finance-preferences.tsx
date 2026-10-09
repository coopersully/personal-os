import { defaultNotificationPreferences, type NotificationStatus } from "@personal-os/domain";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "@/api";
import { QueryFeedback } from "@/components/async-state";
import { MutationFeedback } from "@/components/mutation-feedback";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Item, ItemContent, ItemDescription, ItemGroup, ItemTitle } from "@/components/ui/item";
import { useFeedbackMutation } from "@/lib/use-feedback-mutation";
import { SettingsSection } from "../settings/settings-layout";
import {
  type PreferenceSession,
  sameSession,
  usePreferenceSession,
} from "../workspace-settings/account-save-session";
import { SettingsSaveRecovery } from "../workspace-settings/save-recovery";

/** Mount only with both Finance and Texting access, matching the notification status API. */
export function FinanceNotificationPreferences({ canEdit = true }: { canEdit?: boolean }) {
  const cache = useQueryClient();
  const session = usePreferenceSession(cache);
  return (
    <SessionFinanceNotificationPreferences
      key={`${session.owner}:${session.epoch}`}
      session={session}
      canEdit={canEdit}
    />
  );
}

function SessionFinanceNotificationPreferences({
  session,
  canEdit,
}: {
  session: PreferenceSession;
  canEdit: boolean;
}) {
  const cache = useQueryClient();
  const current = () => sameSession(cache, session);
  const [recovery, setRecovery] = useState<{ reviewed?: NotificationStatus }>();
  const query = useQuery({
    queryKey: ["notification-status"],
    enabled: !!session.owner,
    queryFn: async () => {
      if (!current()) throw new Error("Load your account before reading notification preferences.");
      const status = await api.getNotificationStatus();
      if (!current()) throw new Error("Your account session changed.");
      return status;
    },
  });
  const override = query.data?.preferences.find((row) => row.scope === "finances");
  const reset = useFeedbackMutation({
    feedback: { action: "use global Finance notification preferences", safeToRetry: false },
    mutationFn: ({
      expectedRevision,
      session: started,
    }: {
      expectedRevision: number;
      session: PreferenceSession;
    }) => {
      if (!sameSession(cache, started)) throw new Error("Your account session changed.");
      return api.resetFinanceNotificationPreferences({ expectedRevision });
    },
    onError: (_error, attempt) => {
      if (sameSession(cache, attempt.session)) setRecovery({});
    },
    onSuccess: async (_saved, attempt) => {
      if (!sameSession(cache, attempt.session)) return;
      setRecovery(undefined);
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
      description="Reset removes the Finance override and uses global preferences, or product defaults when global is unconfigured. The global message-detail limit still applies. Delivery depends on Texting consent and readiness."
    >
      <QueryFeedback query={query} title="Couldn’t load Finance notification preferences." />
      {query.isPending ? <p>Loading notification preferences…</p> : null}
      {query.data && !recovery?.reviewed ? (
        <FinanceNotificationPreferenceSummary status={query.data} />
      ) : null}
      {!recovery ? <MutationFeedback feedback={reset.feedback} /> : null}
      {recovery ? (
        <>
          {recovery.reviewed ? (
            <FinanceNotificationPreferenceSummary status={recovery.reviewed} />
          ) : null}
          <SettingsSaveRecovery
            outcome={
              reset.feedback?.kind === "conflict"
                ? "conflict"
                : reset.feedback?.kind === "uncertain"
                  ? "uncertain"
                  : "rejected"
            }
            title="Finance notification reset has not been confirmed."
            pending={query.isFetching || reset.isPending || !canEdit}
            reviewed={!!recovery.reviewed}
            rows={[
              {
                label: "Finance notification source",
                attempted: "Use global preferences (product defaults when global is unconfigured)",
                current: recovery.reviewed?.preferences.some((row) => row.scope === "finances")
                  ? "Finance override — values shown above"
                  : "Already using global preferences",
              },
            ]}
            onRefresh={async () => {
              if (!current()) return;
              setRecovery({});
              const latest = await query.refetch();
              if (current() && !latest.isError && latest.data)
                setRecovery({ reviewed: latest.data });
            }}
            onAccept={() => {
              if (!current()) return;
              setRecovery(undefined);
              reset.reset();
            }}
            onReapply={() => {
              if (!current()) return;
              const latestOverride = recovery.reviewed?.preferences.find(
                (row) => row.scope === "finances",
              );
              if (latestOverride)
                reset.mutate({ expectedRevision: latestOverride.revision, session });
              else {
                setRecovery(undefined);
                reset.reset();
              }
            }}
          />
        </>
      ) : null}
      {override && canEdit ? (
        <Button
          type="button"
          variant="secondary"
          disabled={!current() || reset.isPending || !!recovery}
          onClick={() => {
            if (current()) reset.mutate({ expectedRevision: override.revision, session });
          }}
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
