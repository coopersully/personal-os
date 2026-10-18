import type {
  FinanceAnswer,
  FinanceConversationMessage,
  FinanceConversationReadiness,
  FinanceConversationSendInput,
} from "@personal-os/domain";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { api } from "../../api.js";
import { FinanceConversationComposer } from "./conversation-composer.js";
import { FinanceConversationThread } from "./conversation-thread.js";

const lockReasons: Record<FinanceConversationReadiness["reason"], string> = {
  ready: "Automation is ready.",
  registration_missing: "Set up an automation to send messages.",
  registration_paused: "Resume an eligible automation.",
  registration_revoked: "Register an eligible automation again.",
  connection_missing: "Connect your automation host.",
  connection_disconnected: "Reconnect your automation host.",
  connection_revoked: "Reconnect your automation host.",
  message_protocol_unavailable: "Your host needs messaging support.",
  challenge_required: "Verify messaging with your automation host.",
  challenge_expired: "Verify messaging again with your automation host.",
  protocol_upgrade_required: "Update your automation host’s messaging support.",
  execution_not_authorized: "Review your automation’s execution permissions.",
};

/** The shell must key this page by authenticated owner so local drafts never cross sessions. */
export function FinanceConversationPage({ ownerId }: { ownerId: string }) {
  return <OwnerConversation key={ownerId} ownerId={ownerId} />;
}
function OwnerConversation({ ownerId }: { ownerId: string }) {
  const [params] = useSearchParams();
  const questionId = params.get("question");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const draftKey = questionId ?? "conversation";
  const text = drafts[draftKey] ?? "";
  const setText = (value: string) => setDrafts((current) => ({ ...current, [draftKey]: value }));
  const [messages, setMessages] = useState<FinanceConversationMessage[]>([]);
  const [cursor, setCursor] = useState<string | null | undefined>();
  const [pending, setPending] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [blockedQuestions, setBlockedQuestions] = useState<Set<string>>(new Set());
  const answerBlocked = blockedQuestions.has(draftKey);
  const setAnswerBlocked = (blocked: boolean) =>
    setBlockedQuestions((current) => {
      const next = new Set(current);
      if (blocked) next.add(draftKey);
      else next.delete(draftKey);
      return next;
    });
  const commands = useRef(new Map<string, FinanceAnswer | FinanceConversationSendInput>());
  const readThrough = useRef("0");
  const [loadedThrough, setLoadedThrough] = useState("0");
  const readiness = useQuery({
    queryKey: ["finance-conversation-readiness", ownerId],
    queryFn: () => api.getFinanceConversationReadiness(),
    refetchInterval: 30000,
  });
  const question = useQuery({
    queryKey: ["finance-conversation-question", ownerId, questionId],
    queryFn: () => api.getFinanceContextualQuestion(questionId ?? ""),
    enabled: Boolean(questionId),
  });
  const merge = useCallback(
    (incoming: FinanceConversationMessage[]) =>
      setMessages((current) =>
        [
          ...new Map([...current, ...incoming].map((message) => [message.id, message])).values(),
        ].sort((a, b) =>
          BigInt(a.sequence) < BigInt(b.sequence)
            ? -1
            : BigInt(a.sequence) > BigInt(b.sequence)
              ? 1
              : 0,
        ),
      ),
    [],
  );
  const initial = useQuery({
    queryKey: ["finance-conversation-history", ownerId],
    queryFn: async () => {
      const page = await api.getFinanceConversationHistory({ limit: 50 });
      return page;
    },
  });
  // Query data is rendered directly, including after a refresh failure; fetching never marks it read.
  const visible = [
    ...new Map(
      [...(initial.data?.messages ?? []), ...messages].map((message) => [message.id, message]),
    ).values(),
  ].sort((a, b) =>
    BigInt(a.sequence) < BigInt(b.sequence) ? -1 : BigInt(a.sequence) > BigInt(b.sequence) ? 1 : 0,
  );
  const historyThrough = (initial.data?.messages ?? []).reduce(
    (max, message) => (BigInt(message.sequence) > BigInt(max) ? message.sequence : max),
    loadedThrough,
  );
  const rendered = useCallback(
    (sequence: string) => {
      // An outgoing message can jump beyond unfetched history; never mark those pages read.
      if (BigInt(sequence) > BigInt(historyThrough)) return;
      if (BigInt(sequence) <= BigInt(readThrough.current)) return;
      readThrough.current = sequence;
      void api.markFinanceConversationRendered(sequence).catch(() => {
        if (readThrough.current === sequence) readThrough.current = "0";
      });
    },
    [historyThrough],
  );
  const loadMore = async () => {
    if (loadingHistory) return;
    setLoadingHistory(true);
    const id = toast.loading("Loading messages…");
    try {
      const after = cursor ?? initial.data?.nextCursor;
      const page = await api.getFinanceConversationHistory({
        ...(after ? { after } : {}),
        limit: 50,
      });
      merge(page.messages);
      setLoadedThrough((current) =>
        page.messages.reduce(
          (max, message) => (BigInt(message.sequence) > BigInt(max) ? message.sequence : max),
          current,
        ),
      );
      setCursor(page.nextCursor);
      toast.success("Messages loaded", { id });
    } catch {
      toast.error("Couldn’t load messages. Try again.", { id });
    } finally {
      setLoadingHistory(false);
    }
  };
  const submit = async () => {
    if (pending || !text.trim()) return;
    const contextual = Boolean(questionId);
    if (
      contextual
        ? question.data?.state !== "available" ||
          question.data.question.status !== "open" ||
          answerBlocked
        : !readiness.data?.canSend || readiness.isError
    )
      return;
    setPending(true);
    const id = toast.loading(contextual ? "Saving answer…" : "Saving message…");
    const snapshot = text;
    try {
      const available = question.data?.state === "available" ? question.data.question : null;
      const identity = JSON.stringify([draftKey, text.trim(), contextual ? available?.work : null]);
      let command = commands.current.get(identity);
      if (!command) {
        command =
          contextual && available
            ? {
                operationId: crypto.randomUUID(),
                work: available.work,
                text: text.trim(),
                source: { kind: "app", messageId: null },
              }
            : {
                idempotencyKey: crypto.randomUUID(),
                text: text.trim(),
                caseId: null,
                recordRefs: [],
              };
        commands.current.set(identity, command);
      }
      if ("operationId" in command) {
        const result = await api.answerFinanceContextualQuestion(command);
        if (result.state !== "accepted") {
          setAnswerBlocked(true);
          toast.error(
            "This question changed or is unavailable. Reload the question; your draft is retained.",
            { id },
          );
          return;
        }
        setAnswerBlocked(true);
        void question.refetch();
      } else {
        merge([await api.sendFinanceConversationMessage(command)]);
        commands.current.delete(identity);
      }
      setDrafts((current) =>
        current[draftKey] === snapshot ? { ...current, [draftKey]: "" } : current,
      );
      toast.success(contextual ? "Answer saved" : "Message saved for the next run", { id });
      void initial.refetch();
    } catch {
      toast.error("Couldn’t save. Your draft is retained; try again.", { id });
      void readiness.refetch();
    } finally {
      setPending(false);
    }
  };
  const available = question.data?.state === "available" ? question.data.question : null;
  return (
    <section aria-label="Finance chat" className="mx-auto grid w-full min-w-0 max-w-3xl gap-6 p-4">
      {!readiness.data?.canSend || readiness.isError ? (
        <div className="grid gap-2">
          <p className="text-sm text-muted-foreground">
            Chat sending is locked.{" "}
            {readiness.isPending
              ? "Checking automation access…"
              : readiness.isError
                ? "Automation access could not be checked."
                : readiness.data
                  ? lockReasons[readiness.data.reason]
                  : "Check automation access."}
          </p>
          <Link className="text-sm underline underline-offset-4" to="/finances/automations">
            Open Automations
          </Link>
        </div>
      ) : null}
      {initial.isPending ? <p>Loading conversation…</p> : null}
      <Button
        variant="outline"
        disabled={initial.isFetching}
        onClick={() => {
          void (async () => {
            const id = toast.loading("Loading conversation…");
            const result = await initial.refetch();
            void readiness.refetch();
            if (result.isError) toast.error("Couldn’t load conversation. Try again.", { id });
            else toast.success("Conversation loaded", { id });
          })();
        }}
      >
        Refresh conversation
      </Button>
      {!initial.isPending && !initial.isError && visible.length === 0 ? (
        <p className="text-sm text-muted-foreground">No messages yet.</p>
      ) : null}
      <FinanceConversationThread messages={visible} onRendered={rendered} />
      {(cursor === undefined ? initial.data?.nextCursor : cursor) ? (
        <Button variant="outline" disabled={loadingHistory} onClick={() => void loadMore()}>
          Load more messages
        </Button>
      ) : null}
      {questionId ? (
        <div className="grid gap-2">
          <p>
            {available?.prompt ??
              (question.isPending
                ? "Loading question…"
                : "This question is unavailable. Your draft is retained.")}
          </p>
          {available ? (
            <Link
              className="text-sm underline underline-offset-4"
              to={`/finances/transactions?transactionId=${encodeURIComponent(available.transactionId)}`}
            >
              View transaction
            </Link>
          ) : null}
          <Button
            variant="outline"
            disabled={question.isFetching}
            onClick={() => {
              void (async () => {
                const id = toast.loading("Loading question…");
                const result = await question.refetch();
                if (result.isError)
                  toast.error("Couldn’t reload question. Your draft is retained.", { id });
                else {
                  setAnswerBlocked(false);
                  toast.success("Question reloaded", { id });
                }
              })();
            }}
          >
            Reload question
          </Button>
          <Link to="/finances/chat">Return to conversation</Link>
        </div>
      ) : null}
      <FinanceConversationComposer
        text={text}
        onChange={setText}
        onSubmit={() => void submit()}
        pending={pending}
        disabled={
          questionId
            ? available?.status !== "open" || answerBlocked || question.isError
            : !readiness.data?.canSend || readiness.isError
        }
        label={questionId ? "Answer" : "Message"}
      />
    </section>
  );
}
