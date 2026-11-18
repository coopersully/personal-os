import { ApiClientError } from "@personal-os/api-client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../api.js";
import { QueryFeedback } from "../../components/async-state.js";
import {
  ResponsiveDialog as Dialog,
  ResponsiveDialogContent as DialogContent,
  ResponsiveDialogDescription as DialogDescription,
  ResponsiveDialogFooter as DialogFooter,
  ResponsiveDialogHeader as DialogHeader,
  ResponsiveDialogTitle as DialogTitle,
} from "../../components/responsive-dialog.js";
import { SettingsControlsContext } from "../../components/settings-controls-context.js";
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
import { ProfileRow } from "../settings/profile-rows.js";
import { SettingsSection } from "../settings/settings-layout.js";

export function TextingAgentSettings({ userId }: { userId: string }) {
  const mount = useId();
  const client = useQueryClient();
  const queryKey = ["texting-agent-settings", userId, mount];
  const query = useQuery({ queryKey, queryFn: () => api.getTextingAgentStatus() });
  const [open, setOpen] = useState(false);
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
    <SettingsSection layout="rows" title="Agent">
      <QueryFeedback query={query} title="Couldn’t load automatic replies." />
      {query.data &&
        !(query.error instanceof ApiClientError && [401, 403].includes(query.error.status)) && (
          <>
            <ProfileRow
              label="Automatic replies"
              description="Let your Claude agent reply to your texts."
              value={query.data.enabled ? "On" : "Off"}
              onClick={() => setOpen(true)}
            />
            <ProfileRow
              label="Messages"
              description="Your conversation with your agent."
              to="/messages"
            />
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Automatic replies</DialogTitle>
                  <DialogDescription>
                    Use your Claude subscription to reply across your workspaces. SMS charges are
                    separate.
                  </DialogDescription>
                </DialogHeader>
                <SettingsControlsContext.Provider value={false}>
                  <FieldGroup>
                    {query.data.routines.length ? (
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
                          <NativeSelectOption value="">
                            Choose an existing routine
                          </NativeSelectOption>
                          {query.data.routines.map((item) => (
                            <NativeSelectOption value={item.id} key={item.id}>
                              {item.label}
                            </NativeSelectOption>
                          ))}
                        </NativeSelect>
                      </Field>
                    ) : (
                      <Field>
                        <FieldLabel>Connect a Claude routine</FieldLabel>
                        <FieldDescription>
                          Add an API trigger to your routine in Automations, then allow Texting
                          access on its nohmi connection.
                        </FieldDescription>
                        <Button variant="secondary" asChild>
                          <Link to="/finances/automations">Automations</Link>
                        </Button>
                      </Field>
                    )}
                    <details className="min-w-0">
                      <summary className="cursor-pointer text-sm font-medium">
                        Routine instructions
                      </summary>
                      <p className="mt-3 max-h-60 overflow-y-auto whitespace-pre-wrap text-sm text-muted-foreground">
                        {query.data.instructions}
                      </p>
                    </details>
                    {query.data.routines.length > 0 && (
                      <Field orientation="horizontal">
                        <Switch
                          id="texting-agent-billing"
                          checked={confirmed}
                          onCheckedChange={(checked) => setConfirmed(checked === true)}
                        />
                        <div className="min-w-0 flex-1">
                          <FieldLabel htmlFor="texting-agent-billing">Setup confirmed</FieldLabel>
                          <FieldDescription>
                            I added the routine instructions and turned off paid extra usage in
                            Claude.
                          </FieldDescription>
                        </div>
                      </Field>
                    )}
                    <FieldDescription>
                      Replies pause when your Claude allowance runs out. nohmi never uses a paid
                      model fallback.
                    </FieldDescription>
                  </FieldGroup>
                </SettingsControlsContext.Provider>
                <DialogFooter>
                  {query.data.enabled ? (
                    <Button
                      variant="outline"
                      disabled={save.isPending}
                      onClick={() => save.mutate(null)}
                    >
                      Turn off
                    </Button>
                  ) : (
                    <Button variant="outline" onClick={() => setOpen(false)}>
                      Cancel
                    </Button>
                  )}
                  {query.data.routines.length > 0 && (
                    <Button
                      disabled={!routine || !confirmed || save.isPending}
                      onClick={() => save.mutate(routine)}
                    >
                      Enable automatic replies
                    </Button>
                  )}
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </>
        )}
    </SettingsSection>
  );
}
