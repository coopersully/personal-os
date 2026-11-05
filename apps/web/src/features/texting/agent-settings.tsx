import { ApiClientError } from "@personal-os/api-client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../api.js";
import { QueryFeedback } from "../../components/async-state.js";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "../../components/settings-field.js";
import { Button } from "../../components/ui/button.js";
import { NativeSelect, NativeSelectOption } from "../../components/ui/native-select.js";
import { Switch } from "../../components/ui/switch.js";
import { useFeedbackMutation } from "../../lib/use-feedback-mutation.js";
import { SettingsSection } from "../settings/settings-layout.js";

export function TextingAgentSettings({ userId }: { userId: string }) {
  const mount = useId();
  const client = useQueryClient();
  const queryKey = ["texting-agent-settings", userId, mount];
  const query = useQuery({ queryKey, queryFn: () => api.getTextingAgentStatus() });
  const [selected, setSelected] = useState<string | undefined>();
  const [confirmed, setConfirmed] = useState(false);
  const save = useFeedbackMutation({
    feedback: { action: "save automatic replies", safeToRetry: true },
    mutationFn: (scheduleId: string | null) =>
      api.configureTextingAgent({
        scheduleId,
        ...(scheduleId ? { subscriptionOnlyConfirmed: confirmed } : {}),
      }),
    onSuccess: (result) => {
      client.setQueryData(queryKey, result);
      void client.invalidateQueries({ queryKey: ["texting-agent", userId] });
      setConfirmed(false);
    },
  });
  const routine = selected ?? query.data?.scheduleId ?? "";
  return (
    <SettingsSection layout="rows" title="Automatic replies">
      <QueryFeedback query={query} title="Couldn’t load automatic replies." />
      {query.data &&
        !(query.error instanceof ApiClientError && [401, 403].includes(query.error.status)) && (
          <FieldGroup>
            <FieldDescription>
              Text your agent about any authorized workspace. Each request starts a fresh Claude
              session using your subscription allowance. SMS charges are separate.
            </FieldDescription>
            <Field>
              <FieldLabel htmlFor="texting-agent-routine">Claude routine</FieldLabel>
              <NativeSelect
                id="texting-agent-routine"
                value={routine}
                onChange={(event) => {
                  setSelected(event.target.value);
                  setConfirmed(false);
                }}
              >
                <NativeSelectOption value="">Choose an existing routine</NativeSelectOption>
                {query.data.routines.map((item) => (
                  <NativeSelectOption value={item.id} key={item.id}>
                    {item.label}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </Field>
            {!query.data.routines.length && (
              <FieldDescription>
                Register a Claude routine with an API trigger in{" "}
                <Link className="underline" to="/finances/automations">
                  Automations
                </Link>
                , then return here. Its nohmi connection also needs Texting read, write and
                execution access.
              </FieldDescription>
            )}
            <details>
              <summary className="cursor-pointer text-sm">
                Instructions to add to your Claude routine
              </summary>
              <p className="mt-3 whitespace-pre-wrap text-sm text-muted-foreground">
                {query.data.instructions}
              </p>
            </details>
            <Field orientation="horizontal">
              <Switch
                id="texting-agent-billing"
                checked={confirmed}
                onCheckedChange={(checked) => setConfirmed(checked === true)}
              />
              <FieldLabel htmlFor="texting-agent-billing">
                I added these routine instructions and disabled paid extra usage in Claude.
              </FieldLabel>
            </Field>
            <FieldDescription>
              nohmi never falls back to a paid model API. Claude controls your subscription limits
              and billing settings; requests may wait when your allowance runs out.
            </FieldDescription>
            <Field orientation="horizontal">
              <Button
                disabled={!routine || !confirmed || save.isPending}
                onClick={() => save.mutate(routine)}
              >
                Enable automatic replies
              </Button>
              {query.data.enabled && (
                <Button
                  variant="outline"
                  disabled={save.isPending}
                  onClick={() => save.mutate(null)}
                >
                  Turn off
                </Button>
              )}
              <Button variant="ghost" asChild>
                <Link to="/messages">View messages</Link>
              </Button>
            </Field>
          </FieldGroup>
        )}
    </SettingsSection>
  );
}
