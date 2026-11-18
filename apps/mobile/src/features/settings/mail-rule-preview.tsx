import { ApiClientError } from "@personal-os/api-client";
import type {
  MailRule,
  MailRuleAction,
  MailRuleCondition,
  MailRulePreview as MailRuleScope,
} from "@personal-os/domain";
import { useState } from "react";
import { toast } from "sonner-native";
import { SectionNote } from "../../components/forms/section-content";
import { mailWriteRejected } from "../mail/logic";
import { confirm, Section } from "../tasks/ui";
import { useSettingsAction, useSettingsListPublisher, useSettingsResource } from "./data";
import { SettingsActionRow, SettingsDetailRow } from "./settings-row";

export const mailRuleFieldWords: Record<MailRuleCondition["field"], string> = {
  any: "Sender, subject or preview",
  sender: "Sender",
  subject: "Subject",
  snippet: "Preview text",
};
export const mailRuleOperatorWords: Record<MailRuleCondition["operator"], string> = {
  contains: "contains",
  equals: "is exactly",
  ends_with: "ends with",
};
export const mailRuleActionWords: Record<MailRuleAction["type"], string> = {
  add_label: "Add a label",
  archive: "Archive",
  mark_read: "Mark as read",
  star: "Star",
  trash: "Move to Trash",
};
export function mailRuleConditionSummary(condition: MailRuleCondition) {
  return `${mailRuleFieldWords[condition.field]} ${mailRuleOperatorWords[condition.operator]} “${condition.value}”`;
}
export function mailRuleActionsSummary(actions: readonly MailRuleAction[]) {
  return actions
    .map(
      (action) =>
        `${mailRuleActionWords[action.type]} ${
          action.afterDays === 0
            ? "right away"
            : `after ${action.afterDays} ${action.afterDays === 1 ? "day" : "days"}`
        }`,
    )
    .join("; ");
}
const conversations = (count: number, kind = "") =>
  `${count} ${kind}${count === 1 ? "conversation" : "conversations"}`;

/**
 * A rule's scope is shown before it can be turned on. Activation sends exactly the preview on
 * screen, and a preview of another rule version is never shown or sent.
 */
export function MailRulePreview({ rule }: { rule: MailRule }) {
  const rules = useSettingsResource("mail-rules", (api) => api.listMailRules());
  const action = useSettingsAction();
  const publish = useSettingsListPublisher<MailRule>("mail-rules");
  const [previewed, setPreviewed] = useState<MailRuleScope | null>(null);
  const scope = previewed?.ruleVersion === rule.version ? previewed : null;
  const preview = () =>
    void action
      .run((api) => api.previewSavedMailRule(rule.id), "Preview ready", "Checking matches…")
      .then((result) => {
        if (!result.ok) return;
        setPreviewed(result.value);
        // The rule changed since this screen read it; show the version the preview describes.
        if (result.value.ruleVersion !== rule.version) void rules.refetch();
      });
  const turnOn = (reviewed: MailRuleScope) => {
    let id: ReturnType<typeof toast.loading> | undefined;
    void action
      .run(async (api) => {
        id = toast.loading("Turning on…");
        try {
          const accepted = await api.activateMailRule(rule.id, {
            expectedCandidateIds: reviewed.candidates.map((candidate) => candidate.id),
            expectedPreviewFingerprint: reviewed.fingerprint,
            expectedPreviewedAt: reviewed.previewedAt,
            expectedVersion: rule.version,
          });
          return { accepted: accepted.rule };
        } catch (error) {
          return { error };
        }
      })
      .then(async (result) => {
        if (!result.ok) {
          // The session changed underneath the request, so its outcome belongs to nobody here.
          if (id !== undefined) toast.dismiss(id);
          return;
        }
        const { accepted, error } = result.value;
        if (accepted?.enabled) {
          await publish((records) =>
            records.map((current) =>
              current.id === accepted.id && current.version <= accepted.version
                ? accepted
                : current,
            ),
          );
          setPreviewed(null);
          toast.success("Mail rule turned on", { id });
          return;
        }
        const conflict = error instanceof ApiClientError && error.status === 409;
        if (error instanceof ApiClientError && mailWriteRejected(error) && !conflict) {
          toast.error(error.message, { id });
          return;
        }
        // A changed rule needs a new preview. An unknown outcome is never resent; either way the
        // rule is read again so its real state is shown.
        setPreviewed(null);
        void rules.refetch();
        toast.error(
          conflict
            ? "This rule or its matches changed. Preview it again."
            : "Couldn’t confirm the rule was turned on. Check its status before trying again.",
          { id },
        );
      });
  };
  return (
    <>
      <Section title="Preview">
        {!rule.enabled && !scope && (
          <SectionNote>Preview this rule to see what it matches before turning it on.</SectionNote>
        )}
        {scope && (
          <>
            <SettingsDetailRow label="Matches" value={String(scope.matchedCount)} />
            <SettingsDetailRow
              label="Checked"
              value={conversations(scope.scannedCount, "recent ")}
            />
            {scope.window.truncated && (
              <SectionNote>
                {`Only the ${scope.window.limit} most recent conversations were checked. Older mail is not shown.`}
              </SectionNote>
            )}
          </>
        )}
        <SettingsActionRow
          icon="search"
          label="Preview"
          disabled={action.pending}
          onPress={preview}
        />
        {scope && !rule.enabled && (
          <SettingsActionRow
            icon="check"
            label={`Turn on ${rule.name}`}
            disabled={action.pending}
            onPress={() =>
              confirm(
                "Turn on Mail rule?",
                `${rule.name} will apply to the ${conversations(scope.candidates.length)} in this preview and to new matching mail.`,
                () => turnOn(scope),
              )
            }
          />
        )}
      </Section>
      {scope && (
        <Section title="Matching conversations">
          {scope.candidates.map((candidate) => (
            <SettingsDetailRow
              key={candidate.id}
              label={candidate.subject || "(No subject)"}
              value={candidate.from.name || candidate.from.address}
            />
          ))}
          {scope.candidates.length === 0 && (
            <SectionNote>No recent conversations match. New matching mail still would.</SectionNote>
          )}
        </Section>
      )}
    </>
  );
}
