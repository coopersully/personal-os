import type { MailRule, MailSetupAccount } from "@personal-os/domain";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ChevronRightIcon, PauseIcon } from "@/components/icons";
import { MutationFeedback } from "@/components/mutation-feedback";
import { SettingsRecord, SettingsRecordAction } from "@/components/settings-record";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ItemGroup } from "@/components/ui/item";
import { useFeedbackMutation } from "@/lib/use-feedback-mutation";
import { api } from "../../api.js";
import { ConnectionHealthBadge, ConnectionHealthDescription } from "../connections/health";
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
        <SettingsSection
          title="Accounts & sync"
          action={
            <Button asChild variant="ghost" size="sm">
              <Link to="/settings?section=connections">Manage accounts</Link>
            </Button>
          }
        >
          <ItemGroup>
            {accounts.map((account) => (
              <SettingsRecord
                key={account.accountId}
                title={account.label}
                description={account.email}
                metadata={<ConnectionHealthBadge health={account.health} />}
                actions={
                  <SettingsRecordAction asChild label={`Manage ${account.label}`}>
                    <Link to="/settings?section=connections">
                      <ChevronRightIcon />
                    </Link>
                  </SettingsRecordAction>
                }
              >
                <ConnectionHealthDescription
                  health={account.health}
                  lastSyncedAt={account.lastSyncedAt}
                />
              </SettingsRecord>
            ))}
          </ItemGroup>
          {!accounts.length ? (
            <p className="text-sm text-muted-foreground">No Mail accounts connected.</p>
          ) : null}
        </SettingsSection>
      ) : null}
      {rules ? (
        <SettingsSection
          title="Rules"
          description="Inspect what each rule does. Enabling a rule requires reviewing its current sample."
        >
          <MutationFeedback feedback={pause.feedback} />
          <ItemGroup>
            {rules.map((rule) => (
              <SettingsRecord
                key={rule.id}
                title={rule.name}
                description={`${rule.condition.field} ${rule.condition.operator.replaceAll("_", " ")} “${rule.condition.value}”`}
                metadata={
                  <Badge variant="secondary">{rule.enabled ? "Active" : "Needs review"}</Badge>
                }
                actions={
                  <>
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
                        onClick={() => onReview?.(rule.id)}
                      >
                        <ChevronRightIcon />
                      </SettingsRecordAction>
                    ) : null}
                  </>
                }
              >
                <p className="text-sm text-muted-foreground">
                  {rule.actions
                    .map(
                      (action) =>
                        `${action.type.replaceAll("_", " ")}${action.afterDays ? ` after ${action.afterDays} days` : " immediately"}`,
                    )
                    .join("; ")}
                </p>
              </SettingsRecord>
            ))}
          </ItemGroup>
          {!rules.length ? (
            <p className="text-sm text-muted-foreground">
              No rules configured. Proposed rules will appear here for review.
            </p>
          ) : null}
        </SettingsSection>
      ) : null}
    </>
  );
}
