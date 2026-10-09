import type { ExecutionPolicySettings } from "@personal-os/domain";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { api } from "../../api.js";
import { QueryFeedback } from "../../components/async-state.js";
import { MutationFeedback } from "../../components/mutation-feedback.js";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../components/ui/card.js";
import { Field, FieldContent, FieldDescription, FieldLabel } from "../../components/ui/field.js";
import { Switch } from "../../components/ui/switch.js";
import { useFeedbackMutation } from "../../lib/use-feedback-mutation.js";
import {
  type PreferenceSession,
  sameSession,
  usePreferenceSession,
} from "../workspace-settings/account-save-session";
import { SettingsSaveRecovery } from "../workspace-settings/save-recovery";

const queryKey = ["execution-policy"] as const;

export function ExecutionPolicySettingsCard() {
  const queryClient = useQueryClient();
  const session = usePreferenceSession(queryClient);
  return (
    <SessionExecutionPolicySettingsCard
      key={`${session.owner}:${session.epoch}`}
      session={session}
    />
  );
}

function SessionExecutionPolicySettingsCard({ session }: { session: PreferenceSession }) {
  const queryClient = useQueryClient();
  const current = () => sameSession(queryClient, session);
  const refreshSequence = useRef(0);
  const [recovery, setRecovery] = useState<{
    attempted: boolean;
    reviewed?: ExecutionPolicySettings;
  }>();
  const settings = useQuery({
    queryKey,
    enabled: !!session.owner,
    queryFn: async () => {
      if (!current()) throw new Error("Load your account before reading policy.");
      const saved = await api.getExecutionPolicySettings();
      if (!current()) throw new Error("Your account session changed.");
      return saved;
    },
  });
  const update = useFeedbackMutation<
    ExecutionPolicySettings,
    Error,
    { reviewBypassEnabled: boolean; expectedVersion: number; session: PreferenceSession },
    { previous: ExecutionPolicySettings | undefined }
  >({
    feedback: { action: "save agent review policy", safeToRetry: false, form: false },
    mutationFn: ({ reviewBypassEnabled, expectedVersion, session: started }) => {
      if (!sameSession(queryClient, started)) throw new Error("Your account session changed.");
      if (!settings.data) throw new Error("Execution policy is unavailable.");
      return api.updateExecutionPolicySettings({
        expectedVersion,
        reviewBypassEnabled,
      });
    },
    onError: (_error, attempt, context) => {
      if (!sameSession(queryClient, attempt.session)) return;
      setRecovery({ attempted: attempt.reviewBypassEnabled });
      if (context?.previous) queryClient.setQueryData(queryKey, context.previous);
    },
    onMutate: async ({ reviewBypassEnabled, session: started }) => {
      if (!sameSession(queryClient, started)) throw new Error("Your account session changed.");
      await queryClient.cancelQueries({ queryKey });
      if (!sameSession(queryClient, started)) throw new Error("Your account session changed.");
      const previous = queryClient.getQueryData<ExecutionPolicySettings>(queryKey);
      if (previous) queryClient.setQueryData(queryKey, { ...previous, reviewBypassEnabled });
      return { previous };
    },
    onSuccess: (saved, attempt) => {
      if (!sameSession(queryClient, attempt.session)) return;
      setRecovery(undefined);
      queryClient.setQueryData(queryKey, saved);
    },
    onSettled: (_data, _error, attempt) =>
      sameSession(queryClient, attempt.session)
        ? queryClient.invalidateQueries({ queryKey })
        : undefined,
  });

  const unavailable =
    !current() || settings.isPending || update.isPending || !settings.data || !!recovery;
  return (
    <Card className="settings-section">
      <CardHeader>
        <CardTitle>Agent review policy</CardTitle>
        <CardDescription>
          One account setting controls eligible agent work across every workspace and channel.
        </CardDescription>
      </CardHeader>
      <CardContent className="settings-section__body">
        <QueryFeedback query={settings} title="Couldn’t load agent review policy." />
        {!recovery ? <MutationFeedback feedback={update.feedback} /> : null}
        {recovery ? (
          <SettingsSaveRecovery
            outcome={
              update.feedback?.kind === "conflict"
                ? "conflict"
                : update.feedback?.kind === "uncertain"
                  ? "uncertain"
                  : "rejected"
            }
            title="Agent review policy change has not been confirmed."
            pending={settings.isFetching || update.isPending}
            reviewed={!!recovery.reviewed}
            rows={[
              {
                label: "Apply eligible work without waiting in Review",
                attempted: recovery.attempted ? "Enabled" : "Disabled",
                current: recovery.reviewed?.reviewBypassEnabled ? "Enabled" : "Disabled",
              },
            ]}
            onRefresh={async () => {
              if (!current()) return;
              const sequence = ++refreshSequence.current;
              setRecovery({ attempted: recovery.attempted });
              const latest = await settings.refetch();
              if (
                sequence === refreshSequence.current &&
                current() &&
                !latest.isError &&
                latest.data
              )
                setRecovery({ attempted: recovery.attempted, reviewed: latest.data });
            }}
            onAccept={() => {
              if (!current()) return;
              setRecovery(undefined);
              update.reset();
            }}
            onReapply={() => {
              if (current() && recovery.reviewed)
                update.mutate({
                  reviewBypassEnabled: recovery.attempted,
                  expectedVersion: recovery.reviewed.version,
                  session,
                });
            }}
          />
        ) : null}
        <Field data-disabled={unavailable} orientation="horizontal">
          <FieldContent>
            <FieldLabel htmlFor="global-review-bypass">
              Apply eligible work without waiting in Review
            </FieldLabel>
            <FieldDescription>
              The account default is off: eligible work waits in Review. Currently this applies to
              reversible, policy-authorized Finance changes. Permissions, questions, and explicit
              approval requirements still apply.
            </FieldDescription>
          </FieldContent>
          <Switch
            checked={settings.data?.reviewBypassEnabled ?? false}
            disabled={unavailable}
            id="global-review-bypass"
            onCheckedChange={(enabled) => {
              if (current() && settings.data)
                update.mutate({
                  reviewBypassEnabled: enabled,
                  expectedVersion: settings.data.version,
                  session,
                });
            }}
          />
        </Field>
      </CardContent>
    </Card>
  );
}
