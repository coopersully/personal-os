import type { MailRule, MailSetupAccount } from "@personal-os/domain";
import { useQueryClient } from "@tanstack/react-query";
import { BrandMark } from "@/components/brand-marks";
import { DataViewEmpty } from "@/components/data-view-state";
import { ChevronRightIcon, PauseIcon } from "@/components/icons";
import { MutationFeedback } from "@/components/mutation-feedback";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/settings-field";
import { SettingsRecordAction } from "@/components/settings-record";
import { Badge } from "@/components/ui/badge";
import { useFeedbackMutation } from "@/lib/use-feedback-mutation";
import { api } from "../../api.js";
import { ConnectionHealthBadge } from "../connections/health";
import { ProfileRow } from "./profile-rows";
import { SettingsSection } from "./settings-layout";

export function MailConfiguration({
  accounts,
  rules,
  onReview,
}: {
  accounts?: MailSetupAccount[];
  rules?: MailRule[];
  onReview?: (id: string) => void;
}) {
  const cache = useQueryClient();
  const pause = useFeedbackMutation({
    feedback: { action: "pause mail rule", safeToRetry: false, form: false },
    mutationFn: (rule: MailRule) =>
      api.updateMailRule(rule.id, { enabled: false, expectedVersion: rule.version }),
    onSuccess: async () => {
      await Promise.all([
        cache.invalidateQueries({ queryKey: ["mail-rules"] }),
        cache.invalidateQueries({ queryKey: ["mail-setup-context"] }),
        cache.invalidateQueries({ queryKey: ["agent-access-work-items"] }),
      ]);
    },
  });
  return (
    <>
      {accounts ? (
        <SettingsSection layout="rows" title="Accounts & sync">
          {accounts.map((account) => (
            <ProfileRow
              key={account.accountId}
              label={account.label}
              icon={
                <BrandMark
                  brand={account.provider === "icloud" ? "apple" : account.provider}
                  className="size-4"
                />
              }
              description={account.email}
              value={<ConnectionHealthBadge health={account.health} />}
              to="/settings?page=connections"
              ariaLabel={`Manage ${account.label}`}
            />
          ))}
          {!accounts.length ? (
            <DataViewEmpty
              title="No Mail accounts"
              description="Connect an account to bring your mail into nohmi."
            />
          ) : null}
          <ProfileRow label="Manage accounts" to="/settings?page=connections" />
        </SettingsSection>
      ) : null}
      {rules ? (
        <SettingsSection layout="rows" title="Rules">
          <MutationFeedback feedback={pause.feedback} />
          <FieldGroup>
            {rules.map((rule) => (
              <Field
                key={rule.id}
                orientation="horizontal"
                data-settings-variant={!rule.enabled ? "inactive" : "default"}
              >
                <FieldContent>
                  <FieldLabel>{rule.name}</FieldLabel>
                  <FieldDescription
                    className="max-w-[52ch] truncate"
                    title={`${rule.condition.field} ${rule.condition.operator.replaceAll("_", " ")} “${rule.condition.value}”`}
                  >
                    {rule.condition.field} {rule.condition.operator.replaceAll("_", " ")} “
                    {rule.condition.value}” ·{" "}
                    {rule.actions
                      .map(
                        (action) =>
                          `${action.type.replaceAll("_", " ")}${action.afterDays ? ` after ${action.afterDays} days` : " immediately"}`,
                      )
                      .join("; ")}
                  </FieldDescription>
                </FieldContent>
                <div
                  data-settings-row-actions=""
                  className="flex shrink-0 items-center justify-end gap-2"
                >
                  <Badge variant="secondary">{rule.enabled ? "Active" : "Needs review"}</Badge>
                  {rule.enabled ? (
                    <SettingsRecordAction
                      label={`Pause ${rule.name}`}
                      disabled={pause.isPending}
                      onClick={() => pause.mutate(rule)}
                    >
                      <PauseIcon />
                    </SettingsRecordAction>
                  ) : null}
                  {onReview ? (
                    <SettingsRecordAction
                      label={`Review ${rule.name}`}
                      onClick={() => onReview(rule.id)}
                    >
                      <ChevronRightIcon />
                    </SettingsRecordAction>
                  ) : null}
                </div>
              </Field>
            ))}
          </FieldGroup>
          {!rules.length ? (
            <DataViewEmpty
              title="No rules configured"
              description="Proposed rules will appear here for review."
            />
          ) : null}
        </SettingsSection>
      ) : null}
    </>
  );
}
