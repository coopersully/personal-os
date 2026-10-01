import type { AccountSetupWorkspace, User } from "@personal-os/domain";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../api.js";
import { MutationFeedback } from "../../components/mutation-feedback.js";
import { Button } from "../../components/ui/button.js";
import { Checkbox } from "../../components/ui/checkbox.js";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "../../components/ui/field.js";
import { useFeedbackMutation } from "../../lib/use-feedback-mutation.js";
import { workspaceOptions } from "../setup/workspace-options.js";
import { SettingsBento, SettingsSection } from "./settings-layout.js";

/** Preferences use the existing account record without restarting onboarding. */
export function SetupSettings({ user }: { user: User }) {
  const cache = useQueryClient();
  const [selected, setSelected] = useState<AccountSetupWorkspace[]>(user.setup.selectedWorkspaces);
  const save = useFeedbackMutation({
    feedback: {
      action: "save setup preferences",
      safeToRetry: true,
      success: "Setup preferences saved.",
    },
    mutationFn: () =>
      api.updateAccountSetup({ action: "preferences", selectedWorkspaces: selected }),
    onSuccess: (next) => cache.setQueryData(["me"], next),
  });
  return (
    <SettingsBento>
      <div className="flex flex-col gap-4">
        <SettingsSection
          title="Guided setup"
          description="Revisit your workspace choices and connected accounts, one step at a time."
        >
          <Button asChild variant="outline">
            <Link to="/setup?replay=1">View setup experience</Link>
          </Button>
        </SettingsSection>
        <SettingsSection
          title="Account verification"
          description={
            user.emailVerified
              ? "Your email address is verified."
              : "Verify your email before connecting provider accounts."
          }
        >
          <Button asChild variant="outline">
            <Link to="/settings?section=profile">Manage account</Link>
          </Button>
        </SettingsSection>
      </div>
      <div className="flex flex-col gap-4">
        <SettingsSection
          title="Workspaces to set up"
          description="Choose the areas to include in guided setup. All workspaces remain available."
        >
          <form
            className="flex flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              save.mutate();
            }}
          >
            <FieldGroup>
              {workspaceOptions.map(({ value: id, label, description }) => (
                <Field orientation="horizontal" key={id}>
                  <Checkbox
                    id={`setup-${id}`}
                    disabled={save.isPending}
                    checked={selected.includes(id)}
                    onCheckedChange={(checked) =>
                      setSelected((current) =>
                        checked === true
                          ? [...current, id]
                          : current.filter((value) => value !== id),
                      )
                    }
                  />
                  <FieldContent>
                    <FieldLabel htmlFor={`setup-${id}`}>{label}</FieldLabel>
                    <FieldDescription>{description}</FieldDescription>
                  </FieldContent>
                </Field>
              ))}
            </FieldGroup>
            <MutationFeedback feedback={save.feedback} />
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? "Saving…" : "Save setup preferences"}
            </Button>
          </form>
        </SettingsSection>
        <SettingsSection
          title="Sources and access"
          description="Connect calendars, mail, and financial accounts, then choose agent access."
        >
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline">
              <Link to="/settings?section=connections">Google and Apple accounts</Link>
            </Button>
            <Button asChild variant="outline">
              <Link to="/finances/accounts">Financial accounts</Link>
            </Button>
            <Button asChild variant="outline">
              <Link to="/settings?section=agent-connections">Connected agents</Link>
            </Button>
          </div>
        </SettingsSection>
      </div>
    </SettingsBento>
  );
}
