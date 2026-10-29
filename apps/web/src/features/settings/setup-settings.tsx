import type { AccountSetupWorkspace, User } from "@personal-os/domain";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../../api.js";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "../../components/settings-field.js";
import { Button } from "../../components/ui/button.js";
import { Switch } from "../../components/ui/switch.js";
import { useFeedbackMutation } from "../../lib/use-feedback-mutation.js";
import { workspaceOptions } from "../setup/workspace-options.js";
import { ProfileRow } from "./profile-rows.js";
import { SettingsBento, SettingsSection } from "./settings-layout.js";

/** Preferences use the existing account record without restarting onboarding. */
export function SetupSettings({ user }: { user: User }) {
  const cache = useQueryClient();
  const [selected, setSelected] = useState<AccountSetupWorkspace[]>(user.setup.selectedWorkspaces);
  const save = useFeedbackMutation({
    feedback: {
      action: "save setup preferences",
      safeToRetry: true,
    },
    mutationFn: (selectedWorkspaces: AccountSetupWorkspace[]) =>
      api.updateAccountSetup({ action: "preferences", selectedWorkspaces }),
    onSuccess: (next) => cache.setQueryData(["me"], next),
  });
  return (
    <SettingsBento>
      <div className="flex flex-col gap-4">
        <SettingsSection
          layout="rows"
          title="Guided setup"
          description="Revisit your workspace choices and connected accounts, one step at a time."
        >
          <ProfileRow label="View setup experience" to="/setup?replay=1" />
        </SettingsSection>
        <SettingsSection
          layout="rows"
          title="Account verification"
          description={
            user.emailVerified
              ? "Your email address is verified."
              : "Verify your email before connecting provider accounts."
          }
        >
          <ProfileRow
            label="Manage account"
            to="/settings?page=profile"
            value={user.emailVerified ? "Verified" : "Verification needed"}
          />
        </SettingsSection>
      </div>
      <div className="flex flex-col gap-4">
        <SettingsSection
          layout="rows"
          title="Workspaces to set up"
          description="Choose the areas to include in guided setup. All workspaces remain available."
        >
          <FieldGroup>
            {workspaceOptions.map(({ value: id, label, description }) => (
              <Field orientation="horizontal" key={id}>
                <Switch
                  id={`setup-${id}`}
                  disabled={save.isPending}
                  checked={selected.includes(id)}
                  onCheckedChange={(checked) => {
                    const next =
                      checked === true
                        ? [...selected, id]
                        : selected.filter((value) => value !== id);
                    setSelected(next);
                    save.mutate(next);
                  }}
                />
                <FieldContent>
                  <FieldLabel htmlFor={`setup-${id}`}>{label}</FieldLabel>
                  <FieldDescription>{description}</FieldDescription>
                </FieldContent>
              </Field>
            ))}
          </FieldGroup>
          {save.isError ? (
            <div className="px-4 py-2">
              <Button variant="secondary" onClick={() => save.mutate(selected)}>
                Retry saving choices
              </Button>
            </div>
          ) : null}
        </SettingsSection>
        <SettingsSection
          layout="rows"
          title="Sources and access"
          description="Connect calendars, mail, and financial accounts, then choose agent access."
        >
          <div className="flex flex-col">
            <ProfileRow label="Google and Apple accounts" to="/settings?page=connections" />
            <ProfileRow label="Financial accounts" to="/finances/accounts" />
            <ProfileRow
              label="Connected agents"
              to="/settings?page=connections&subpage=agent-connections"
            />
          </div>
        </SettingsSection>
      </div>
    </SettingsBento>
  );
}
