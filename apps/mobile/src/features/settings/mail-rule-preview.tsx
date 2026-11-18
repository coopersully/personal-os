import { ApiClientError } from "@personal-os/api-client";
import type {
  MailRule,
  MailRuleAction,
  MailRuleCondition,
  MailRulePreview as MailRuleScope,
} from "@personal-os/domain";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner-native";
import { SectionNote } from "../../components/forms/section-content";
import { holdReadFeedback } from "../../components/read-feedback-scope";
import { useAuth } from "../auth/context";
import { mailWriteRejected } from "../mail/logic";
import { confirm, Section } from "../tasks/ui";
import { type SettingsApi, useSettingsAction, useSettingsListPublisher } from "./data";
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
 * One toast per rule action, with the outcome classified here: only a definitive rejection is
 * reported as one. A timeout, lost connection or server fault leaves the outcome unknown.
 */
export function useMailRuleAction() {
  const action = useSettingsAction();
  const run = async <T,>(loading: string, work: (api: SettingsApi) => Promise<T>) => {
    let id: ReturnType<typeof toast.loading> | undefined;
    const result = await action.run(async (api) => {
      id = toast.loading(loading);
      try {
        return { ok: true as const, value: await work(api) };
      } catch (error) {
        return {
          ok: false as const,
          rejection: error instanceof ApiClientError && mailWriteRejected(error) ? error : null,
        };
      }
    });
    if (!result.ok) {
      // The session changed underneath the request, so its outcome belongs to nobody here.
      if (id !== undefined) toast.dismiss(id);
      return null;
    }
    return { ...result.value, id };
  };
  return { pending: action.pending, run };
}
/** Read the rules again without a second toast; the action that asked already reported. */
export function useMailRulesReread() {
  const client = useQueryClient();
  const { state, session } = useAuth();
  return async () => {
    const queryKey = ["settings", state.user?.id, session.epoch(), "mail-rules"];
    const release = holdReadFeedback(client.getQueryCache().findAll({ queryKey, exact: true }));
    try {
      await client.refetchQueries({ queryKey, exact: true });
    } finally {
      release();
    }
  };
}

/**
 * Turns a rule off. Like every rule action, only a definitive rejection is reported as one; after
 * an unknown outcome or a conflict the rule is read again, and the change is never sent twice.
 */
export function useMailRuleDisable() {
  const action = useMailRuleAction();
  const reread = useMailRulesReread();
  const publish = useSettingsListPublisher<MailRule>("mail-rules");
  const disable = async (rule: MailRule) => {
    const result = await action.run("Disabling rule…", (api) =>
      api.updateMailRule(rule.id, { enabled: false, expectedVersion: rule.version }),
    );
    if (!result) return;
    if (result.ok) {
      const accepted = result.value;
      const published = await publish((records) =>
        records.map((current) =>
          current.id === rule.id && current.version <= accepted.version ? accepted : current,
        ),
      );
      // The session can change while the list is published; the next person hears nothing.
      if (published) toast.success("Mail rule disabled", { id: result.id });
      else if (result.id !== undefined) toast.dismiss(result.id);
      return;
    }
    const { rejection } = result;
    if (rejection && rejection.status !== 409) {
      toast.error(rejection.message, { id: result.id });
      return;
    }
    void reread();
    toast.error(
      rejection
        ? "This rule changed elsewhere. Check it before trying again."
        : "Couldn’t confirm the rule was disabled. Check its status before trying again.",
      { id: result.id },
    );
  };
  return { pending: action.pending, disable };
}

/**
 * A rule's scope is shown before it can be turned on. Activation sends exactly the preview on
 * screen, and a preview of another rule version is never shown or sent.
 */
export function MailRulePreview({ rule }: { rule: MailRule }) {
  const action = useMailRuleAction();
  const reread = useMailRulesReread();
  const publish = useSettingsListPublisher<MailRule>("mail-rules");
  const [previewed, setPreviewed] = useState<MailRuleScope | null>(null);
  const scope = previewed?.ruleVersion === rule.version ? previewed : null;
  const preview = async () => {
    const result = await action.run("Checking matches…", (api) =>
      api.previewSavedMailRule(rule.id),
    );
    if (!result) return;
    if (!result.ok) {
      toast.error(result.rejection?.message ?? "Couldn’t load the preview. Try again.", {
        id: result.id,
      });
      return;
    }
    setPreviewed(result.value);
    // The rule changed since this screen read it; show the version the preview describes.
    if (result.value.ruleVersion !== rule.version) void reread();
    toast.success("Preview ready", { id: result.id });
  };
  const turnOn = async (reviewed: MailRuleScope) => {
    const result = await action.run("Turning on…", (api) =>
      api.activateMailRule(rule.id, {
        expectedCandidateIds: reviewed.candidates.map((candidate) => candidate.id),
        expectedPreviewFingerprint: reviewed.fingerprint,
        expectedPreviewedAt: reviewed.previewedAt,
        expectedVersion: rule.version,
      }),
    );
    if (!result) return;
    const accepted = result.ok ? result.value.rule : undefined;
    if (accepted?.enabled) {
      await publish((records) =>
        records.map((current) =>
          current.id === accepted.id && current.version <= accepted.version ? accepted : current,
        ),
      );
      setPreviewed(null);
      toast.success("Mail rule turned on", { id: result.id });
      return;
    }
    const rejection = result.ok ? null : result.rejection;
    if (rejection && rejection.status !== 409) {
      toast.error(rejection.message, { id: result.id });
      return;
    }
    // A changed rule needs a new preview. An unknown outcome is never resent; either way the
    // rule is read again so its real state is shown.
    setPreviewed(null);
    void reread();
    toast.error(
      rejection
        ? "This rule or its matches changed. Preview it again."
        : "Couldn’t confirm the rule was turned on. Check its status before trying again.",
      { id: result.id },
    );
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
          onPress={() => void preview()}
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
                () => void turnOn(scope),
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
