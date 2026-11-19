import { ApiClientError } from "@personal-os/api-client";
import type { MailStewardshipQuestion } from "@personal-os/domain";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";
import { toast } from "sonner-native";
import { Action, Actions } from "../../components/forms/form-rows";
import { InlineOptions } from "../../components/forms/inline-options";
import { SettingsAccentProvider } from "../../components/settings-accent";
import { storedLabel } from "../../product/labels";
import { spacing, useTheme } from "../../theme";
import { useAuth } from "../auth/context";
import { useMail, useMailStewardship } from "./data";
import { answerFailure, evidenceSummary } from "./logic";

const day = (value: string) =>
  new Date(value).toLocaleDateString([], { month: "short", day: "numeric" });

/**
 * What the steward recorded about one conversation: how it is filed and why, what is still
 * owed, and the questions it could not settle alone. Questions can be answered here; the
 * disposition and obligations are read-only on iPhone. It renders nothing until there is
 * something to show, so a conversation the steward has not looked at reads as before.
 */
export function ThreadStewardship({ threadId }: { threadId: string }) {
  const t = useTheme();
  const { api, owner } = useMail();
  const { session } = useAuth();
  const client = useQueryClient();
  const found = useMailStewardship(threadId);
  // The option chosen for each question, kept until its answer is confirmed.
  const [chosen, setChosen] = useState<Record<string, string>>({});
  const [sending, setSending] = useState(false);
  const busy = useRef(false);
  const { failedAt } = found;
  useEffect(() => {
    // The conversation stays readable without this, so the failure is a toast and nothing more.
    if (failedAt)
      toast.error("Couldn’t load what nohmi found in this conversation.", {
        id: `mail-stewardship-${threadId}`,
      });
  }, [failedAt, threadId]);

  /** The chosen option, while the question still offers it; a choice it dropped is no choice. */
  const choice = (question: MailStewardshipQuestion) =>
    question.options.find((option) => option.value === chosen[question.id])?.value;
  const forget = (id: string) => setChosen(({ [id]: _, ...rest }) => rest);

  async function send(question: MailStewardshipQuestion) {
    const answer = choice(question);
    if (!answer || busy.current) return;
    busy.current = true;
    setSending(true);
    const epoch = session.epoch();
    const current = () => session.epoch() === epoch;
    const id = `mail-answer-${question.id}`;
    toast.loading("Sending answer…", { id });
    try {
      await api.answerMailQuestion(question.id, {
        answer,
        expectedVersion: question.version,
        generalize: false,
      });
      if (current()) toast.success("Answer sent", { id });
    } catch (error) {
      // An unknown outcome is never sent again here: the read below shows what was recorded.
      if (current()) toast.error(answerFailure(error), { id });
      // A question that changed or went away is chosen afresh, never answered from memory.
      if (error instanceof ApiClientError && (error.status === 409 || error.status === 404))
        forget(question.id);
    }
    if (current()) {
      void client.invalidateQueries({ queryKey: ["mail", owner, "attention"] });
      // Sending stays off until the question is read again, so an answered one is not re-sent.
      // The toast above already answered for this action, so this read reports nothing itself.
      await found.reread();
    } else toast.dismiss(id);
    busy.current = false;
    setSending(false);
  }

  const data = found.data;
  if (!data) return null;
  const obligations = data.obligations.filter((obligation) => obligation.state === "open");
  const questions = data.questions.filter((question) => question.status === "open");
  if (!data.disposition && !obligations.length && !questions.length) return null;
  const title = { color: t.ink, fontSize: 16, fontWeight: "600" as const };
  const detail = { color: t.secondary, fontSize: 15, lineHeight: 21 };
  return (
    <SettingsAccentProvider workspace="mail">
      <View style={{ gap: spacing.md }}>
        <Text accessibilityRole="header" style={{ color: t.ink, fontSize: 17, fontWeight: "700" }}>
          What nohmi found
        </Text>
        {data.disposition && (
          <View style={{ gap: 4 }}>
            <Text style={title}>{storedLabel(data.disposition.disposition)}</Text>
            <Text style={detail}>{data.disposition.rationale}</Text>
          </View>
        )}
        {obligations.map((obligation) => (
          <View key={obligation.id} style={{ gap: 4 }}>
            <Text style={title}>
              {storedLabel(obligation.kind)}
              {obligation.dueAt ? ` · Due ${day(obligation.dueAt)}` : ""}
            </Text>
            <Text style={detail}>{obligation.rationale}</Text>
          </View>
        ))}
        {questions.map((question) => (
          <View key={question.id} style={{ gap: 4 }}>
            <Text style={title}>{question.reason}</Text>
            <Text style={detail}>Based on {evidenceSummary(question.evidence)}</Text>
            {question.options.length > 0 && (
              <>
                <InlineOptions
                  value={choice(question) ?? null}
                  options={question.options}
                  onChange={(value) =>
                    setChosen((current) => ({ ...current, [question.id]: value }))
                  }
                />
                <Actions inset={false}>
                  <Action
                    label="Send answer"
                    disabled={sending || !choice(question)}
                    onPress={() => void send(question)}
                  />
                </Actions>
              </>
            )}
          </View>
        ))}
        <View style={{ height: 0.5, backgroundColor: t.line }} />
      </View>
    </SettingsAccentProvider>
  );
}
