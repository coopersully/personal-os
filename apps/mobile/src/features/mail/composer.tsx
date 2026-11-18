import type { MailDraft } from "@personal-os/domain";
import { useRef, useState } from "react";
import { Modal, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { toast } from "sonner-native";
import { EnumChoice } from "../../components/forms/enum-choice";
import {
  Action,
  Actions,
  Field,
  FormBody,
  Section,
  SectionNote,
} from "../../components/forms/form-rows";
import { SettingsAccentProvider } from "../../components/settings-accent";
import { SheetHeader } from "../../components/sheet-header";
import { spacing, useTheme } from "../../theme";
import { confirm } from "../tasks/ui";
import { useMail, useMailAccounts } from "./data";
import {
  type ComposeStart,
  type DraftForm,
  draftInput,
  draftStage,
  formFromDraft,
  saveProblem,
  sendProblem,
} from "./draft-logic";
import { type SendResult, sendUnconfirmed, type UnconfirmedSave, useDraftWrites } from "./drafts";

const same = (a: DraftForm, b: DraftForm) =>
  a.accountId === b.accountId &&
  a.to === b.to &&
  a.cc === b.cc &&
  a.subject === b.subject &&
  a.body === b.body;

/**
 * Writes, reviews and sends one message. Sending takes two deliberate steps: the draft is saved,
 * then shown back exactly as the API holds it, and only Send message on that review sends it.
 * A send the API cannot confirm locks the message until the person has checked what happened.
 */
export function MailComposer({ start, close }: { start: ComposeStart; close: () => void }) {
  const t = useTheme();
  const accounts = useMailAccounts().data ?? [];
  const writes = useDraftWrites();
  // The form this composer opened with; a parent re-rendering never moves the baseline.
  const [opened] = useState(start.form);
  const [form, setForm] = useState(opened);
  const [draft, setDraft] = useState<MailDraft | null>(start.draft ?? null);
  // What the API last confirmed, so Close knows whether anything typed would be lost.
  const [saved, setSaved] = useState(start.draft ? start.form : null);
  const [reviewing, setReviewing] = useState(false);
  // Delivery is not known: set by an unconfirmed send, cleared only by a check or a record.
  // It starts from what this device remembers, so reopening a draft cannot skip the check.
  const { owner } = useMail();
  const [unknown, setUnknown] = useState(
    () => !!start.draft && sendUnconfirmed(owner, start.draft.id),
  );
  const unconfirmed = useRef<UnconfirmedSave | undefined>(undefined);
  const stage = draft ? draftStage(draft) : "editable";
  const locked = unknown || stage !== "editable";
  const dirty = !locked && !same(form, saved ?? opened);
  const edit = (change: Partial<DraftForm>) => setForm((current) => ({ ...current, ...change }));

  const adopt = (record: MailDraft) => {
    const next = formFromDraft(record);
    setDraft(record);
    setForm(next);
    setSaved(next);
  };
  const save = async () => {
    const result = await writes.save(draftInput(form), draft, unconfirmed.current);
    if (!result) return null;
    unconfirmed.current = result.ok ? undefined : (result.unconfirmed ?? unconfirmed.current);
    if (!result.ok) return null;
    adopt(result.draft);
    return result.draft;
  };
  const settle = (result: SendResult | undefined) => {
    if (!result) return;
    setReviewing(false);
    if (result.state === "sent" || result.state === "gone") return close();
    if (result.draft) adopt(result.draft);
    setUnknown(result.state === "unknown");
  };
  const leave = () => {
    if (writes.pending) return;
    if (dirty)
      confirm("Discard changes?", "What you typed since the last save will be lost.", close, true);
    else close();
  };

  // A review or a locked message shows the saved record, sender included, not the form.
  const shown = draft && (reviewing || locked) ? formFromDraft(draft) : form;
  const account = accounts.find((candidate) => candidate.accountId === shown.accountId);
  const from = account ? (account.email ?? account.label) : "This account is not connected";
  const line = (label: string, value: string) => (
    <View style={{ paddingHorizontal: spacing.lg, paddingVertical: spacing.md, gap: 2 }}>
      <Text style={{ color: t.secondary, fontSize: 13 }}>{label}</Text>
      <Text selectable style={{ color: t.ink, fontSize: 17, lineHeight: 23 }}>
        {value}
      </Text>
    </View>
  );
  return (
    <Modal visible animationType="slide" presentationStyle="fullScreen" onRequestClose={leave}>
      <SettingsAccentProvider workspace="mail">
        <SafeAreaView style={{ flex: 1, backgroundColor: t.canvas }}>
          <SheetHeader
            title={reviewing ? "Review message" : start.title}
            label={dirty ? "Cancel" : "Close"}
            disabled={writes.pending}
            onClose={leave}
          />
          <FormBody>
            {reviewing || locked ? (
              <>
                <Section>
                  {line("From", from)}
                  {line("To", shown.to || "No recipients")}
                  {!!shown.cc && line("Cc", shown.cc)}
                  {line("Subject", shown.subject || "No subject")}
                  {line("Message", shown.body || "No message text")}
                </Section>
                {locked ? (
                  <>
                    <Section>
                      <SectionNote warning>
                        {stage === "sending" && !unknown
                          ? "This message is being sent."
                          : "nohmi doesn’t know whether this message was sent. Look in Sent mail in your mail app before doing anything else."}
                      </SectionNote>
                    </Section>
                    <Actions>
                      <Action
                        label="Check again"
                        disabled={writes.pending || !draft}
                        onPress={() => draft && void writes.check(draft).then(settle)}
                      />
                      {stage === "editable" && draft && (
                        // The record reads unsent but another send cannot be made safe. Deleting
                        // the draft sends nothing and is the one way out that never can.
                        <Action
                          label="Discard draft"
                          destructive
                          disabled={writes.pending}
                          onPress={() =>
                            confirm(
                              "Discard this message?",
                              "It may already have been sent. Discarding deletes the draft from nohmi and can’t be undone. It does not unsend anything.",
                              () =>
                                void writes.discard(draft).then((gone) => {
                                  if (gone) close();
                                }),
                              true,
                            )
                          }
                        />
                      )}
                      {stage === "review" && draft && (
                        <>
                          <Action
                            label="It was not sent"
                            disabled={writes.pending}
                            onPress={() => void writes.reconcile(draft, "not_sent").then(settle)}
                          />
                          <Action
                            label="It was sent"
                            disabled={writes.pending}
                            onPress={() => void writes.reconcile(draft, "sent").then(settle)}
                          />
                        </>
                      )}
                    </Actions>
                  </>
                ) : (
                  <Actions>
                    <Action
                      label="Keep editing"
                      disabled={writes.pending}
                      onPress={() => setReviewing(false)}
                    />
                    <Action
                      label="Send message"
                      disabled={writes.pending || !draft}
                      onPress={() => draft && void writes.send(draft).then(settle)}
                    />
                  </Actions>
                )}
              </>
            ) : (
              <>
                <Section>
                  {accounts.length > 1 && !form.threadId ? (
                    <EnumChoice
                      label="From"
                      icon="mail"
                      value={form.accountId}
                      options={accounts.map((candidate) => ({
                        value: candidate.accountId,
                        label: candidate.email ?? candidate.label,
                      }))}
                      disabled={writes.pending}
                      onChange={(accountId) => edit({ accountId })}
                    />
                  ) : (
                    line("From", from)
                  )}
                  <Field
                    label="To"
                    compact={false}
                    value={form.to}
                    onChangeText={(to) => edit({ to })}
                    placeholder="name@example.com"
                    keyboardType="email-address"
                    autoCapitalize="none"
                    autoCorrect={false}
                    editable={!writes.pending}
                  />
                  <Field
                    label="Cc"
                    compact={false}
                    value={form.cc}
                    onChangeText={(cc) => edit({ cc })}
                    keyboardType="email-address"
                    autoCapitalize="none"
                    autoCorrect={false}
                    editable={!writes.pending}
                  />
                  <Field
                    label="Subject"
                    compact={false}
                    value={form.subject}
                    onChangeText={(subject) => edit({ subject })}
                    maxLength={998}
                    editable={!writes.pending}
                  />
                </Section>
                <Section>
                  <Field
                    label="Message"
                    compact={false}
                    multiline
                    scrollEnabled={false}
                    value={form.body}
                    onChangeText={(body) => edit({ body })}
                    editable={!writes.pending}
                    style={{ minHeight: 200 }}
                  />
                </Section>
                <Actions>
                  {draft && (
                    <Action
                      label="Discard draft"
                      destructive
                      disabled={writes.pending}
                      onPress={() =>
                        confirm(
                          "Discard this draft?",
                          "The draft is deleted. This can’t be undone.",
                          () =>
                            void writes.discard(draft).then((gone) => {
                              if (gone) close();
                            }),
                          true,
                        )
                      }
                    />
                  )}
                  <Action
                    label="Save draft"
                    disabled={writes.pending}
                    onPress={() => {
                      const problem = saveProblem(form);
                      if (problem) toast.error(problem);
                      else void save();
                    }}
                  />
                  <Action
                    label="Review and send"
                    disabled={writes.pending}
                    onPress={() => {
                      const problem = sendProblem(form);
                      if (problem) return void toast.error(problem);
                      // Review shows the saved record, so what is confirmed is what is sent.
                      if (draft && !dirty) return setReviewing(true);
                      void save().then((record) => {
                        if (record) setReviewing(true);
                      });
                    }}
                  />
                </Actions>
              </>
            )}
          </FormBody>
        </SafeAreaView>
      </SettingsAccentProvider>
    </Modal>
  );
}
