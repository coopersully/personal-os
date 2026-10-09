import type { ExecutionPolicySettings } from "@personal-os/domain";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
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

import { SettingsSaveRecovery } from "../workspace-settings/save-recovery";

const queryKey = ["execution-policy"] as const;

export function ExecutionPolicySettingsCard() {
  const queryClient = useQueryClient();
  const [recovery, setRecovery] = useState<{
    attempted: boolean;
    reviewed?: ExecutionPolicySettings;
  }>();
  const settings = useQuery({ queryFn: api.getExecutionPolicySettings, queryKey });
  const update = useFeedbackMutation<
    ExecutionPolicySettings,
    Error,
    { reviewBypassEnabled: boolean; expectedVersion: number },
    { previous: ExecutionPolicySettings | undefined }
  >({
    feedback: { action: "save agent review policy", safeToRetry: false, form: false },
    mutationFn: ({ reviewBypassEnabled, expectedVersion }) => {
      if (!settings.data) throw new Error("Execution policy is unavailable.");
      return api.updateExecutionPolicySettings({
        expectedVersion,
        reviewBypassEnabled,
      });
    },
    onError: (_error, attempt, context) => {
      setRecovery({ attempted: attempt.reviewBypassEnabled });
      if (context?.previous) queryClient.setQueryData(queryKey, context.previous);
    },
    onMutate: async ({ reviewBypassEnabled }) => {
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<ExecutionPolicySettings>(queryKey);
      if (previous) queryClient.setQueryData(queryKey, { ...previous, reviewBypassEnabled });
      return { previous };
    },
    onSuccess: (saved) => {
      setRecovery(undefined);
      queryClient.setQueryData(queryKey, saved);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey }),
  });

  const unavailable = settings.isPending || update.isPending || !settings.data || !!recovery;
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
              setRecovery({ attempted: recovery.attempted });
              const latest = await settings.refetch();
              if (!latest.isError && latest.data)
                setRecovery({ attempted: recovery.attempted, reviewed: latest.data });
            }}
            onAccept={() => {
              setRecovery(undefined);
              update.reset();
            }}
            onReapply={() => {
              if (recovery.reviewed)
                update.mutate({
                  reviewBypassEnabled: recovery.attempted,
                  expectedVersion: recovery.reviewed.version,
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
              if (settings.data)
                update.mutate({
                  reviewBypassEnabled: enabled,
                  expectedVersion: settings.data.version,
                });
            }}
          />
        </Field>
      </CardContent>
    </Card>
  );
}
