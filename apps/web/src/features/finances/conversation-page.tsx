import { ApiClientError } from "@personal-os/api-client";
import type {
  FinanceAnswer,
  FinanceConversationMessage,
  FinanceConversationSendInput,
} from "@personal-os/domain";
import { type QueryClient, skipToken, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { api } from "../../api.js";
import {
  type PreferenceSession,
  registerSessionCleanup,
  sameSession,
  usePreferenceSession,
} from "../workspace-settings/account-save-session.js";
import { financeConversationRecovery, financeRecoveryHref } from "./automation-recovery.js";
import { FinanceConversationComposer } from "./conversation-composer.js";
import { FinanceConversationThread } from "./conversation-thread.js";

const draftCleanupClients = new WeakSet<QueryClient>();

/** The shell must key this page by authenticated owner so local drafts never cross sessions. */
export function FinanceConversationPage({ ownerId }: { ownerId: string }) {
  const client = useQueryClient();
  const session = usePreferenceSession(client);
  if (!draftCleanupClients.has(client)) {
    draftCleanupClients.add(client);
    registerSessionCleanup(client, () =>
      client.removeQueries({ queryKey: ["finance-conversation-local-drafts"] }),
    );
  }
  if (session.owner !== ownerId) return <p>Sign in again to open your Finance conversation.</p>;
  return (
    <OwnerConversation key={`${ownerId}:${session.epoch}`} ownerId={ownerId} session={session} />
  );
}
function OwnerConversation({ ownerId, session }: { ownerId: string; session: PreferenceSession }) {
  const client = useQueryClient();
  const capturedSession = useRef({ ...session }).current;
  const currentSession = () =>
    sameSession(client, capturedSession) && capturedSession.owner === ownerId;
  const [params] = useSearchParams();
  const questionId = params.get("question");
  const targetMessageId = params.get("message");
  const draftStateKey = ["finance-conversation-local-drafts", ownerId, capturedSession.epoch];
  // Memory only: recovery navigation retains drafts and exact retry commands for this owner.
  // The application clears session queries on logout/expiry; nothing is stored in the browser.
  const local = useQuery<{
    drafts: Record<string, string>;
    commands: Map<string, FinanceAnswer | FinanceConversationSendInput>;
  }>({
    queryKey: draftStateKey,
    queryFn: skipToken,
    enabled: false,
    gcTime: Number.POSITIVE_INFINITY,
    initialData: () => ({ drafts: {}, commands: new Map() }),
  });
  const drafts = local.data?.drafts ?? {};
  const setDrafts = (update: (current: Record<string, string>) => Record<string, string>) => {
    if (!currentSession()) return;
    client.setQueryData<NonNullable<typeof local.data>>(draftStateKey, (current) => ({
      drafts: update(current?.drafts ?? {}),
      commands: commands.current,
    }));
  };
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
  const commands = useRef(
    local.data?.commands ?? new Map<string, FinanceAnswer | FinanceConversationSendInput>(),
  );
  const readThrough = useRef("0");
  const [loadedThrough, setLoadedThrough] = useState("0");
  const fetchedThrough = useRef("0");
  const [accessDenied, setAccessDenied] = useState(false);
  const accessGeneration = useRef(0);
  const manualHistory = useRef(false);
  const clearDeniedHistory = useCallback(
    (error: unknown) => {
      if (!(error instanceof ApiClientError) || (error.status !== 401 && error.status !== 403))
        return;
      accessGeneration.current += 1;
      setAccessDenied(true);
      setMessages([]);
      setCursor(null);
      setLoadedThrough("0");
      fetchedThrough.current = "0";
      readThrough.current = "0";
      for (const query of client
        .getQueryCache()
        .findAll({ queryKey: ["finance-conversation-message-context", ownerId] }))
        query.setState({
          data: undefined,
          dataUpdatedAt: 0,
          error,
          errorUpdatedAt: Date.now(),
          status: "error",
          fetchStatus: "idle",
        });
      // Direct page requests do not pass through QueryCache's denial handler.
      client
        .getQueryCache()
        .find({ queryKey: ["finance-conversation-history", ownerId], exact: true })
        ?.setState({
          data: undefined,
          dataUpdatedAt: 0,
          error,
          errorUpdatedAt: Date.now(),
          status: "error",
          fetchStatus: "idle",
        });
    },
    [client, ownerId],
  );
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
      const generation = accessGeneration.current;
      try {
        const page = await api.getFinanceConversationHistory({ limit: 50 });
        if (generation !== accessGeneration.current)
          throw new ApiClientError({ status: 403, code: "forbidden", message: "Access changed" });
        if (generation === accessGeneration.current) {
          merge(page.messages);
          const through = page.messages.reduce(
            (max, message) => (BigInt(message.sequence) > BigInt(max) ? message.sequence : max),
            "0",
          );
          if (BigInt(through) > BigInt(fetchedThrough.current)) fetchedThrough.current = through;
          setAccessDenied(false);
        }
        return page;
      } catch (error) {
        clearDeniedHistory(error);
        if (!manualHistory.current)
          toast.error("Couldn’t load conversation. Try Refresh conversation.");
        throw error;
      }
    },
  });
  const target = useQuery({
    queryKey: ["finance-conversation-message-context", ownerId, targetMessageId],
    enabled: Boolean(targetMessageId),
    queryFn: async () => {
      const id = toast.loading("Loading source message…");
      const generation = accessGeneration.current;
      try {
        const context = await api.getFinanceConversationMessageContext(targetMessageId ?? "");
        if (generation !== accessGeneration.current)
          throw new ApiClientError({ status: 403, code: "forbidden", message: "Access changed" });
        if (
          context.targetMessageId !== targetMessageId ||
          !context.messages.some((message) => message.id === targetMessageId)
        )
          throw new Error("Source message unavailable");
        setAccessDenied(false);
        toast.success("Source message loaded", { id });
        return context;
      } catch (error) {
        clearDeniedHistory(error);
        toast.error(
          error instanceof ApiClientError && error.status === 404
            ? "Source message not found."
            : "Couldn’t load source message. Check access and try again.",
          { id },
        );
        throw error;
      }
    },
  });
  // Query data is rendered directly, including after a refresh failure; fetching never marks it read.
  const visible = accessDenied
    ? []
    : [
        ...new Map(
          [...(initial.data?.messages ?? []), ...messages, ...(target.data?.messages ?? [])].map(
            (message) => [message.id, message],
          ),
        ).values(),
      ].sort((a, b) =>
        BigInt(a.sequence) < BigInt(b.sequence)
          ? -1
          : BigInt(a.sequence) > BigInt(b.sequence)
            ? 1
            : 0,
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
      if (accessDenied) return;
      void api
        .markFinanceConversationRendered(sequence)
        .then(() => {
          void client.invalidateQueries({ queryKey: ["finance-conversation-unread", ownerId] });
        })
        .catch((error) => {
          clearDeniedHistory(error);
          if (readThrough.current === sequence) readThrough.current = "0";
        });
    },
    [historyThrough, accessDenied, clearDeniedHistory, client, ownerId],
  );
  const loadMore = async (refresh = false) => {
    if (loadingHistory) return;
    setLoadingHistory(true);
    const id = toast.loading(refresh ? "Refreshing conversation…" : "Loading messages…");
    const generation = accessGeneration.current;
    try {
      const after = refresh ? fetchedThrough.current : (cursor ?? initial.data?.nextCursor);
      const page = await api.getFinanceConversationHistory({
        ...(after ? { after } : {}),
        limit: 50,
      });
      if (generation !== accessGeneration.current) {
        toast.error("Access changed. Reload the conversation before continuing.", { id });
        return;
      }
      setAccessDenied(false);
      merge(page.messages);
      fetchedThrough.current = page.messages.reduce(
        (max, message) => (BigInt(message.sequence) > BigInt(max) ? message.sequence : max),
        fetchedThrough.current,
      );
      setLoadedThrough((current) =>
        page.messages.reduce(
          (max, message) => (BigInt(message.sequence) > BigInt(max) ? message.sequence : max),
          current,
        ),
      );
      setCursor(page.nextCursor);
      toast.success("Messages loaded", { id });
    } catch (error) {
      clearDeniedHistory(error);
      toast.error("Couldn’t load messages. Try again.", { id });
    } finally {
      setLoadingHistory(false);
    }
  };
  const submit = async () => {
    if (!currentSession() || pending || !text.trim()) return;
    const contextual = Boolean(questionId);
    if (
      contextual
        ? question.data?.state !== "available" ||
          question.data.question.status !== "open" ||
          answerBlocked
        : accessDenied || !readiness.data?.canSend || readiness.isError
    )
      return;
    setPending(true);
    const id = toast.loading(contextual ? "Saving answer…" : "Saving message…");
    const snapshot = text;
    const generation = accessGeneration.current;
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
        if (!currentSession()) {
          toast.dismiss(id);
          return;
        }
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
        const message = await api.sendFinanceConversationMessage(command);
        if (!currentSession()) {
          toast.dismiss(id);
          return;
        }
        if (generation !== accessGeneration.current) {
          toast.error("Access changed. Reload the conversation before continuing.", { id });
          return;
        }
        merge([message]);
      }
      commands.current.delete(identity);
      setDrafts((current) =>
        current[draftKey] === snapshot ? { ...current, [draftKey]: "" } : current,
      );
      toast.success(contextual ? "Answer saved" : "Message saved for the next run", { id });
      void initial.refetch();
    } catch (error) {
      if (!currentSession()) {
        toast.dismiss(id);
        return;
      }
      clearDeniedHistory(error);
      toast.error("Couldn’t save. Your draft is retained; try again.", { id });
      void readiness.refetch();
    } finally {
      if (currentSession()) setPending(false);
    }
  };
  const available = question.data?.state === "available" ? question.data.question : null;
  const recovery = readiness.data ? financeConversationRecovery[readiness.data.reason] : null;
  const returnTo = `/finances/chat${params.size ? `?${params.toString()}` : ""}`;
  return (
    <section aria-label="Finance chat" className="mx-auto grid w-full min-w-0 max-w-3xl gap-6 p-4">
      {accessDenied || !readiness.data?.canSend || readiness.isError ? (
        <div className="grid gap-2">
          <p className="text-sm text-muted-foreground">
            Chat sending is locked.{" "}
            {accessDenied
              ? "Conversation access was denied. Refresh to check access again."
              : readiness.isPending
                ? "Checking automation access…"
                : readiness.isError
                  ? "Automation access could not be checked."
                  : readiness.data
                    ? recovery?.cause
                    : "Check automation access."}
          </p>
          {!accessDenied && !readiness.isPending && !readiness.isError && recovery ? (
            <Button asChild variant="secondary" className="justify-self-start">
              <Link to={financeRecoveryHref(recovery.href, returnTo)}>{recovery.action}</Link>
            </Button>
          ) : null}
          <p className="text-sm text-muted-foreground">
            Your draft stays here while you check access. Existing questions can still be answered.
          </p>
        </div>
      ) : null}
      {initial.isPending ? <p>Loading conversation…</p> : null}
      <Button
        variant="outline"
        disabled={initial.isFetching || loadingHistory}
        onClick={() => {
          void (async () => {
            void readiness.refetch();
            if (fetchedThrough.current !== "0" && !accessDenied) {
              await loadMore(true);
              return;
            }
            const id = toast.loading("Loading conversation…");
            manualHistory.current = true;
            try {
              const result = await initial.refetch();
              if (result.isError) toast.error("Couldn’t load conversation. Try again.", { id });
              else {
                setCursor(undefined);
                toast.success("Conversation loaded", { id });
              }
            } finally {
              manualHistory.current = false;
            }
          })();
        }}
      >
        Refresh conversation
      </Button>
      {!accessDenied && !initial.isPending && !initial.isError && visible.length === 0 ? (
        <p className="text-sm text-muted-foreground">No messages yet.</p>
      ) : null}
      {targetMessageId && target.isError ? (
        <Button
          variant="outline"
          disabled={target.isFetching}
          onClick={() => void target.refetch()}
        >
          Retry source message
        </Button>
      ) : null}
      {!accessDenied && target.data ? (
        <p className="text-sm text-muted-foreground">
          Showing the source message with nearby context. Other messages may be outside the loaded
          pages.
        </p>
      ) : null}
      <FinanceConversationThread
        messages={visible}
        onRendered={rendered}
        targetMessageId={
          accessDenied || initial.isPending ? null : (target.data?.targetMessageId ?? null)
        }
      />
      {!accessDenied && (cursor === undefined ? initial.data?.nextCursor : cursor) ? (
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
            : accessDenied || !readiness.data?.canSend || readiness.isError
        }
        label={questionId ? "Answer" : "Message"}
      />
    </section>
  );
}
