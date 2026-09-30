import type { ExecutionPolicySettings } from "@personal-os/domain";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api.js";
import { InlineError } from "../../components/async-state.js";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../components/ui/card.js";
import { Field, FieldContent, FieldDescription, FieldLabel } from "../../components/ui/field.js";
import { Switch } from "../../components/ui/switch.js";

const queryKey = ["execution-policy"] as const;

export function ExecutionPolicySettingsCard() {
  const queryClient = useQueryClient();
  const settings = useQuery({ queryFn: api.getExecutionPolicySettings, queryKey });
  const update = useMutation<
    ExecutionPolicySettings,
    Error,
    boolean,
    { previous: ExecutionPolicySettings | undefined }
  >({
    mutationFn: (reviewBypassEnabled) => {
      if (!settings.data) throw new Error("Execution policy is unavailable.");
      return api.updateExecutionPolicySettings({
        expectedVersion: settings.data.version,
        reviewBypassEnabled,
      });
    },
    onError: (_error, _enabled, context) => {
      if (context?.previous) queryClient.setQueryData(queryKey, context.previous);
    },
    onMutate: async (reviewBypassEnabled) => {
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<ExecutionPolicySettings>(queryKey);
      if (previous) queryClient.setQueryData(queryKey, { ...previous, reviewBypassEnabled });
      return { previous };
    },
    onSuccess: (saved) => queryClient.setQueryData(queryKey, saved),
    onSettled: () => queryClient.invalidateQueries({ queryKey }),
  });

  const unavailable = settings.isPending || update.isPending || !settings.data;
  return (
    <Card className="settings-section">
      <CardHeader>
        <CardTitle>Agent review policy</CardTitle>
        <CardDescription>
          One account setting controls eligible agent work across every workspace and channel.
        </CardDescription>
      </CardHeader>
      <CardContent className="settings-section__body">
        {settings.error || update.error ? (
          <InlineError error={settings.error ?? update.error ?? new Error("Unknown error")} />
        ) : null}
        <Field data-disabled={unavailable} orientation="horizontal">
          <FieldContent>
            <FieldLabel htmlFor="global-review-bypass">
              Apply eligible work without waiting in Review
            </FieldLabel>
            <FieldDescription>
              Currently this applies to reversible, policy-authorized Finance changes. Permissions,
              questions, and explicit approval requirements still apply.
            </FieldDescription>
          </FieldContent>
          <Switch
            checked={settings.data?.reviewBypassEnabled ?? false}
            disabled={unavailable}
            id="global-review-bypass"
            onCheckedChange={(enabled) => update.mutate(enabled)}
          />
        </Field>
      </CardContent>
    </Card>
  );
}
