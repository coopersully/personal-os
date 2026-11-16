import type { FinanceAnswer, FinanceContextualQuestion } from "@personal-os/domain";
import { randomUUID } from "expo-crypto";
import { router } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { TextInput } from "react-native";
import { toast } from "sonner-native";
import { Action, Actions } from "../../components/forms/form-rows";
import { SettingsAccentProvider } from "../../components/settings-accent";
import { useTheme } from "../../theme";
import { useFinance, useFinanceRead } from "./data";
import { confirmedRejection } from "./mutations";
import { formatLocalDate, formatMoney } from "./presentation";
import { Card, Copy, FinanceRow, FinanceScreen, ReadState } from "./ui";

/** A question nohmi asked about one transaction, answered here rather than in chat. */
export function ContextualQuestionReference({ id }: { id: string }) {
  const query = useFinanceRead(["chat-case", "contextual_question", id], (api) =>
    api.getFinanceContextualQuestion(id),
  );
  const question = query.data?.state === "available" ? query.data.question : null;
  return (
    <FinanceScreen title="Finance question">
      <ReadState query={query}>
        {question ? (
          <ContextAnswer question={question} reload={() => void query.refetch()} />
        ) : (
          <Copy>Reference unavailable.</Copy>
        )}
      </ReadState>
    </FinanceScreen>
  );
}

function ContextAnswer({
  question,
  reload,
}: {
  question: FinanceContextualQuestion;
  reload: () => void;
}) {
  const t = useTheme();
  const { api, owner } = useFinance();
  const [text, setText] = useState("");
  const [pending, setPending] = useState(false);
  // The server refused this revision of the question; a reload may still report it open.
  const [refused, setRefused] = useState(false);
  // An answer whose outcome is unknown may already be recorded; until that is settled the
  // text stays as sent, so an edit cannot become a second recorded answer.
  const [unconfirmed, setUnconfirmed] = useState(false);
  // One answer is one operation: the same text is always resent under the same id.
  const command = useRef<FinanceAnswer | null>(null);
  const busy = useRef(false);
  const active = useRef(true);
  const currentOwner = useRef(owner);
  currentOwner.current = owner;
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const current = () => active.current && currentOwner.current === owner;
  const answer = text.trim();

  async function save() {
    if (busy.current || !answer) return;
    if (command.current?.text !== answer)
      command.current = {
        operationId: randomUUID(),
        work: question.work,
        text: answer,
        source: { kind: "app", messageId: null },
      };
    busy.current = true;
    setPending(true);
    const id = toast.loading("Saving context…");
    const unconfirmedMessage =
      "Couldn’t confirm the answer. Send it again; the same answer is never recorded twice.";
    try {
      const outcome = await api.answerFinanceContextualQuestion(command.current);
      if (!current()) return void toast.dismiss(id);
      setUnconfirmed(outcome.state === "pending" || outcome.state === "uncertain");
      if (outcome.state === "accepted" || outcome.state === "applied") {
        toast.success("Context saved", { id });
        reload();
      } else if (outcome.state === "blocked") {
        setRefused(true);
        toast.error(
          "Nothing was saved. This transaction changed, so this question can no longer accept context.",
          { id },
        );
        reload();
      } else if (outcome.state === "pending" || outcome.state === "uncertain")
        toast.error(unconfirmedMessage, { id });
      else {
        command.current = null;
        toast.error(
          outcome.state === "unavailable"
            ? "Nothing was saved. This question is unavailable."
            : "Couldn’t save this answer. Nothing was saved; your draft is still here.",
          { id },
        );
      }
    } catch (error) {
      if (!current()) return void toast.dismiss(id);
      if (confirmedRejection(error)) {
        // A rejected operation id cannot be reused; the next send is a new operation.
        command.current = null;
        setUnconfirmed(false);
        toast.error("Couldn’t save this answer. Nothing was saved; your draft is still here.", {
          id,
        });
      } else {
        setUnconfirmed(true);
        toast.error(unconfirmedMessage, { id });
      }
    } finally {
      busy.current = false;
      if (active.current) setPending(false);
    }
  }

  const { transaction } = question;
  return (
    <>
      <Copy>{question.prompt}</Copy>
      <Card rows>
        <FinanceRow
          centered
          title={transaction.merchant}
          subtitle={formatLocalDate(transaction.date)}
          value={formatMoney(transaction.amountCents / 100, transaction.currencyCode)}
          icon="receipt"
        />
        <FinanceRow
          title="View transaction"
          onPress={() =>
            router.push({
              pathname: "/finance-transaction",
              params: { id: question.transactionId },
            })
          }
        />
      </Card>
      {question.status === "answered" ? (
        <Copy secondary>Answered. The financial review stays open.</Copy>
      ) : question.status === "stale" || refused ? (
        <Copy secondary>This question can no longer accept context.</Copy>
      ) : (
        <SettingsAccentProvider workspace="finances">
          <Card>
            <TextInput
              accessibilityLabel="Your answer"
              multiline
              maxLength={10_000}
              value={text}
              onChangeText={setText}
              editable={!pending && !unconfirmed}
              placeholder="What this was for"
              placeholderTextColor={t.secondary}
              style={{
                color: t.ink,
                fontSize: 17,
                minHeight: 88,
                padding: 0,
                textAlignVertical: "top",
              }}
            />
          </Card>
          <Copy secondary>
            Your answer adds context for review. It does not change the transaction or its category.
          </Copy>
          <Actions inset={false}>
            <Action
              label="Save context"
              disabled={pending || !answer}
              onPress={() => void save()}
            />
          </Actions>
        </SettingsAccentProvider>
      )}
    </>
  );
}
