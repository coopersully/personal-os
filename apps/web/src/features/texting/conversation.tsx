import { ApiClientError } from "@personal-os/api-client";
import type { TextingAgentRun } from "@personal-os/domain";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { useId } from "react";
import { Link, useLocation } from "react-router-dom";
import { api } from "../../api.js";
import { QueryFeedback } from "../../components/async-state.js";
import { DataViewLoading } from "../../components/data-view-state.js";
import { Button } from "../../components/ui/button.js";
import { ConversationPreview, conversationPreviewMode } from "./conversation-preview.js";
import { ConversationSetup } from "./conversation-setup.js";
import {
  ConversationNavigation,
  ConversationView,
  type ConversationWorkspace,
} from "./conversation-view.js";
import { TextingRunRecovery } from "./run-recovery.js";

export const textingRunLabels = {
  submitting: "Starting your agent",
  started: "Agent session started",
  running: "Your agent is working",
  completed: "Reply recorded",
  uncertain: "Agent start could not be confirmed",
  blocked: "Agent needs attention",
} as const;

function runLabel(run: TextingAgentRun) {
  if (run.reason === "retry_requested") return "Saved request queued again";
  if (run.reason === "human_closed") return "Closed without retrying";
  if (run.reason === "shutdown_deferred") return "Waiting for nohmi to resume";
  if (run.reason === "rate_limited") return "Waiting for the usage limit to reset";
  return textingRunLabels[run.state];
}
const denied = (error: unknown) =>
  error instanceof ApiClientError && [401, 403].includes(error.status);
const polling = () => (document.hidden ? false : 10_000);

type Props = { userId: string; timeZone: string; workspace?: ConversationWorkspace };
export function TextConversation(props: Props) {
  const location = useLocation();
  const preview = conversationPreviewMode(
    new URL(`${location.pathname}${location.search}`, window.location.origin),
  );
  return preview ? (
    <ConversationPreview mode={preview} workspace={props.workspace} timeZone={props.timeZone} />
  ) : (
    <LiveConversation key={`${props.userId}:${props.workspace ?? "all"}`} {...props} />
  );
}

function LiveConversation({ userId, timeZone, workspace }: Props) {
  const mount = useId();
  const client = useQueryClient();
  const agentQueryKey = ["texting-agent", userId, mount];
  const agent = useInfiniteQuery({
    queryKey: agentQueryKey,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      api.getTextingAgentStatus(pageParam ? { beforeRun: pageParam } : {}),
    getNextPageParam: (page) => page.nextRunCursor ?? undefined,
    refetchInterval: polling,
  });
  const connectionQuery = useQuery({
    queryKey: ["texting-connection", userId, mount],
    queryFn: () => api.getTextingConnection(),
    refetchInterval: polling,
  });
  const status = denied(agent.error) ? undefined : agent.data?.pages[0];
  const chatReady = status?.chatReady === true && !denied(connectionQuery.error);
  const history = useInfiniteQuery({
    queryKey: ["text-conversation", userId, mount, timeZone, workspace ?? "all"],
    enabled: chatReady,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      api.getTextConversation(timeZone, {
        limit: 50,
        ...(workspace ? { workspace } : {}),
        ...(pageParam ? { beforeCursor: pageParam } : {}),
      }),
    getNextPageParam: (page) =>
      page.hasEarlierMessages ? (page.earlierCursor ?? undefined) : undefined,
    refetchInterval: polling,
  });
  const privateDenied =
    denied(history.error) || denied(agent.error) || denied(connectionQuery.error);
  const messages =
    chatReady && !privateDenied
      ? [
          ...new Map(
            [...(history.data?.pages ?? [])]
              .reverse()
              .flatMap((page) => page.messages)
              .map((message) => [message.id, message]),
          ).values(),
        ].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt) || a.id.localeCompare(b.id))
      : [];
  const runs = privateDenied
    ? []
    : [
        ...new Map(
          [...(agent.data?.pages ?? [])]
            .reverse()
            .flatMap((page) => page.runs)
            .map((run) => [run.id, run]),
        ).values(),
      ].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
  const connection = privateDenied ? undefined : connectionQuery.data;
  return (
    <section
      className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6"
      aria-label="Messages"
    >
      <ConversationNavigation workspace={workspace} />
      <QueryFeedback query={agent} title="Couldn’t load agent status." />
      <QueryFeedback query={connectionQuery} title="Couldn’t load Texting setup." />
      {privateDenied ? null : !status ? (
        agent.isPending && <DataViewLoading label="Checking your agent connection" />
      ) : !chatReady ? (
        <ConversationSetup status={status} connection={connection} />
      ) : (
        <>
          <header className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-col gap-1">
              <p className="text-sm font-medium">
                {workspace
                  ? "The same conversation, focused here."
                  : "One conversation across your workspaces."}
              </p>
              {connection?.senderPhoneNumber && (
                <p className="text-xs text-muted-foreground">
                  Text {connection.senderPhoneNumber} from {connection.maskedPhoneNumber}.
                </p>
              )}
            </div>
            <Button variant="ghost" size="sm" asChild>
              <Link to="/settings?page=texting">Texting settings</Link>
            </Button>
          </header>
          <QueryFeedback query={history} title="Couldn’t load your messages." />
          {history.isPending ? (
            <DataViewLoading label="Loading your conversation" />
          ) : (
            <>
              {history.hasNextPage && (
                <Button
                  variant="ghost"
                  disabled={history.isFetchingNextPage}
                  onClick={() => void history.fetchNextPage()}
                >
                  Load older messages
                </Button>
              )}
              <ConversationView messages={messages} workspace={workspace} timeZone={timeZone} />
            </>
          )}
          {Boolean(status.pendingCount) && (
            <p className="text-center text-xs text-muted-foreground">
              {status.pendingCount}{" "}
              {status.pendingCount === 1 ? "message waiting" : "messages waiting"} for your agent.
            </p>
          )}
        </>
      )}
      {!privateDenied && runs.length > 0 && (
        <details className="text-sm text-muted-foreground">
          <summary className="cursor-pointer py-2">Agent runs</summary>
          <ol className="mt-2 flex flex-col gap-4" aria-label="Agent runs">
            {runs.map((run) => (
              <li key={run.id} className="border-b border-border/40 pb-4 last:border-0">
                <article
                  aria-label={`Run from ${new Date(run.createdAt).toLocaleString(undefined, { timeZone })}`}
                  className="flex flex-col gap-2"
                >
                  <p>
                    <time dateTime={run.createdAt}>
                      {new Date(run.createdAt).toLocaleString(undefined, { timeZone })}
                    </time>
                    {" · "}
                    {runLabel(run)}
                  </p>
                  <TextingRunRecovery
                    run={run}
                    onRecovered={() => {
                      void client.invalidateQueries({ queryKey: agentQueryKey });
                    }}
                  />
                  {chatReady &&
                    run.work.some(
                      (item) =>
                        item.state !== "completed" && (!workspace || item.domain === workspace),
                    ) && (
                      <ul aria-label="Pending work" className="flex flex-col gap-2">
                        {run.work
                          .filter(
                            (item) =>
                              item.state !== "completed" &&
                              (!workspace || item.domain === workspace),
                          )
                          .map((item) => (
                            <li key={`${item.domain}:${item.key}`}>
                              <span className="font-medium capitalize">{item.domain}</span>:{" "}
                              {item.note} ({item.state}, reported by your agent)
                            </li>
                          ))}
                      </ul>
                    )}
                </article>
              </li>
            ))}
          </ol>
          {agent.hasNextPage && (
            <Button
              variant="ghost"
              disabled={agent.isFetchingNextPage}
              onClick={() => void agent.fetchNextPage()}
            >
              Load older runs
            </Button>
          )}
        </details>
      )}
    </section>
  );
}
