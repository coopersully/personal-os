import {
  createMailRuleInputSchema,
  type MailRule,
  type MailRuleAction,
  type MailRuleCondition,
} from "@personal-os/domain";
import { router, Stack } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { editorDismissOptions } from "../../components/editor-header";
import { FormSave } from "../../components/forms/form-save";
import { SectionNote } from "../../components/forms/section-content";
import { useDirtyDismiss } from "../../components/forms/use-dirty-dismiss";
import { Choice, Field, FormBody, Section, State, ToggleRow } from "../tasks/ui";
import { useSettingsAction, useSettingsListPublisher, useSettingsResource } from "./data";
import { mailRuleActionWords, mailRuleFieldWords } from "./mail-rule-preview";

const fields = (["any", "sender", "subject", "snippet"] as const).map((value) => ({
  value,
  label: mailRuleFieldWords[value],
}));
const operators: { value: MailRuleCondition["operator"]; label: string }[] = [
  { value: "contains", label: "Contains" },
  { value: "equals", label: "Is exactly" },
  { value: "ends_with", label: "Ends with" },
];
/** A label needs a mailbox owned by exactly one selected account, so it is not offered here. */
const actions = (["archive", "mark_read", "star", "trash"] as const).map((value) => ({
  value,
  label: mailRuleActionWords[value],
}));

/** A rule is always created off; turning it on happens from its own previewed scope. */
export function MailRuleEditorScreen() {
  const rules = useSettingsResource("mail-rules", (api) => api.listMailRules());
  const guidance = useSettingsResource("guidance-mail", (api) => api.getDomainProfile("mail"));
  const accounts = useSettingsResource(
    "mail-accounts",
    async (api) => (await api.getMailSetupContext()).accounts,
  );
  const action = useSettingsAction();
  const publish = useSettingsListPublisher<MailRule>("mail-rules");
  const [name, setName] = useState("");
  const [field, setField] = useState<MailRuleCondition["field"]>("sender");
  const [operator, setOperator] = useState<MailRuleCondition["operator"]>("contains");
  const [text, setText] = useState("");
  const [type, setType] = useState<MailRuleAction["type"]>("archive");
  const [chosen, setChosen] = useState<string[] | null>(null);
  // One account is the only possible scope; several are an explicit choice.
  const sourceIds =
    chosen ?? (accounts.data?.length === 1 ? accounts.data.map((entry) => entry.accountId) : []);
  const dirty = !!name.trim() || !!text.trim() || chosen !== null;
  const permitDismiss = useDirtyDismiss(dirty, action.pending);
  const ready =
    !!name.trim() && !!text.trim() && sourceIds.length > 0 && guidance.data !== undefined;
  const create = () => {
    const input = createMailRuleInputSchema.safeParse({
      name,
      condition: { field, operator, value: text },
      actions: [{ type }],
      profileId: guidance.data?.id ?? null,
      sourceIds,
    });
    if (!input.success) return;
    const listed = !!rules.data;
    void action
      .run(
        async (api) => {
          const created = await api.createMailRule(input.data);
          await publish((records) => [
            ...records.filter((record) => record.id !== created.id),
            created,
          ]);
          // Without a loaded list the published record would stand in for every other rule.
          if (!listed) void rules.refetch();
        },
        "Mail rule created",
        "Creating rule…",
      )
      .then((result) => {
        if (!result.ok) return;
        permitDismiss();
        router.back();
      });
  };
  return (
    <View style={{ flex: 1 }}>
      <Stack.Screen
        options={{
          title: "New Mail rule",
          ...editorDismissOptions({
            label: dirty ? "Cancel" : "Close",
            disabled: action.pending,
            onPress: () => router.back(),
          }),
        }}
      />
      <FormBody>
        <Section>
          <Field
            label="Rule name"
            icon="mail"
            value={name}
            onChangeText={setName}
            maxLength={120}
            editable={!action.pending}
            placeholder="Newsletters"
          />
        </Section>
        <Section title="When">
          <Choice
            label="Look in"
            value={field}
            options={fields}
            disabled={action.pending}
            onChange={(value) => setField(value as MailRuleCondition["field"])}
          />
          <Choice
            label="Match"
            value={operator}
            options={operators}
            disabled={action.pending}
            onChange={(value) => setOperator(value as MailRuleCondition["operator"])}
          />
          <Field
            label="Text"
            value={text}
            onChangeText={setText}
            maxLength={500}
            autoCapitalize="none"
            autoCorrect={false}
            editable={!action.pending}
            placeholder="news@example.com"
          />
        </Section>
        <Section title="Then">
          <Choice
            label="Action"
            value={type}
            options={actions}
            disabled={action.pending}
            onChange={(value) => setType(value as MailRuleAction["type"])}
          />
        </Section>
        <Section title="Accounts">
          {accounts.data?.map((account) => (
            <ToggleRow
              key={account.accountId}
              label={account.email ?? account.label}
              value={sourceIds.includes(account.accountId)}
              disabled={action.pending}
              onChange={(on) =>
                setChosen(
                  on
                    ? [...sourceIds, account.accountId]
                    : sourceIds.filter((id) => id !== account.accountId),
                )
              }
            />
          ))}
          {!accounts.data && (
            <State
              loading={accounts.isPending}
              retry={accounts.isError ? () => void accounts.refetch() : undefined}
            />
          )}
          {accounts.data?.length === 0 && <State empty="No Mail accounts connected." />}
          {guidance.data === undefined ? (
            <State
              loading={guidance.isPending}
              retry={guidance.isError ? () => void guidance.refetch() : undefined}
            />
          ) : (
            <SectionNote>
              {guidance.data === null
                ? "The rule is saved off. Set up Mail guidance first if you want to turn this rule on."
                : guidance.data.status === "active"
                  ? "The rule is saved off. It can be turned on for Google accounts described in your Mail guidance."
                  : "The rule is saved off. It can be turned on once Mail guidance is active."}
            </SectionNote>
          )}
        </Section>
      </FormBody>
      <FormSave
        label="Create rule"
        icon="add"
        workspace="mail"
        disabled={!ready || action.pending}
        onPress={create}
      />
    </View>
  );
}
