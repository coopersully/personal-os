import { ApiClientError } from "@personal-os/api-client";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { useId } from "react";
import { Link } from "react-router-dom";
import { api } from "../../api.js";
import { QueryFeedback } from "../../components/async-state.js";
import { Button } from "../../components/ui/button.js";
import { cn } from "../../lib/utils.js";
import { TextingRunRecovery } from "./run-recovery.js";

export const textingRunLabels = {
  submitting: "Starting your agent",
  started: "Agent session started",
  running: "Your agent is working",
  completed: "Reply recorded",
  uncertain: "Agent start could not be confirmed",
  blocked: "Agent needs attention",
} as const;

const denied = (error: unknown) =>
  error instanceof ApiClientError && [401, 403].includes(error.status);

export function TextConversation({ userId, timeZone }: { userId: string; timeZone: string }) {
  const mount = useId();
  const client = useQueryClient();
  const history = useInfiniteQuery({
    queryKey: ["text-conversation", userId, mount, timeZone],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      api.getTextConversation(timeZone, {
        limit: 50,
        ...(pageParam ? { beforeCursor: pageParam } : {}),
      }),
    getNextPageParam: (page) =>
      page.hasEarlierMessages ? (page.earlierCursor ?? undefined) : undefined,
    refetchInterval: () => (document.hidden ? false : 10_000),
  });
  const agentQueryKey = ["texting-agent", userId, mount];
  const agent = useInfiniteQuery({
    queryKey: agentQueryKey,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      api.getTextingAgentStatus(pageParam ? { beforeRun: pageParam } : {}),
    getNextPageParam: (page) => page.nextRunCursor ?? undefined,
    refetchInterval: () => (document.hidden ? false : 10_000),
  });
  const privateDenied = denied(history.error) || denied(agent.error);
  const pages = privateDenied ? [] : (history.data?.pages ?? []);
  const messages = [
    ...new Map(
      [...pages]
        .reverse()
        .flatMap((page) => page.messages)
        .map((message) => [message.id, message]),
    ).values(),
  ].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt) || a.id.localeCompare(b.id));
  const connection = pages[0]?.connection;
  const status = privateDenied ? undefined : agent.data?.pages[0];
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
  const latest = status?.runs[0];
  return (
    <section
      className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6"
      aria-label="Messages"
    >
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 flex-1 basis-48 flex-col gap-1">
          <p className="text-sm text-muted-foreground">Your conversation across workspaces.</p>
          {connection?.senderPhoneNumber && (
            <p className="text-xs text-muted-foreground">
              Text {connection.senderPhoneNumber} from {connection.maskedPhoneNumber}.
            </p>
          )}
        </div>
        <Button variant="outline" asChild>
          <Link to="/settings?page=texting">Texting settings</Link>
        </Button>
      </header>
      <QueryFeedback query={history} title="Couldn’t load your messages." />
      <QueryFeedback query={agent} title="Couldn’t load agent status." />
      {status && (
        <section
          className="flex flex-col gap-1 text-sm text-muted-foreground"
          aria-label="Agent status"
        >
          <p>
            {status.readiness === "ready"
              ? "Automatic replies are on."
              : status.readiness === "disabled"
                ? "Automatic replies are off. Your saved messages remain here."
                : status.readiness === "consent_required"
                  ? "Verify your number or reply START to restore texting."
                  : status.readiness === "permission_required"
                    ? "Your agent needs Texting permission. Review its connected-agent settings."
                    : "Your Claude routine needs attention in Texting settings."}
          </p>
          {latest && (
            <p>
              {latest.reason === "retry_requested"
                ? "Saved request queued again"
                : latest.reason === "human_closed"
                  ? "Closed without retrying"
                  : latest.reason === "shutdown_deferred"
                    ? "Waiting for nohmi to resume"
                    : latest.reason === "rate_limited"
                      ? "Waiting for the usage limit to reset"
                      : textingRunLabels[latest.state]}
            </p>
          )}
          {Boolean(status.pendingCount) && (
            <p>
              {status.pendingCount}{" "}
              {status.pendingCount === 1 ? "message waiting" : "messages waiting"} for your agent.
            </p>
          )}
          {runs.length > 0 && (
            <details className="mt-2">
              <summary className="cursor-pointer">Agent runs</summary>
              <ol className="mt-3 flex flex-col gap-4" aria-label="Agent runs">
                {runs.map((run) => (
                  <li key={run.id} className="flex flex-col gap-2 border-b pb-4 last:border-0">
                    <article
                      aria-label={`Run from ${new Date(run.createdAt).toLocaleString(undefined, { timeZone })}`}
                      className="flex flex-col gap-2"
                    >
                      <p>
                        <time dateTime={run.createdAt}>
                          {new Date(run.createdAt).toLocaleString(undefined, { timeZone })}
                        </time>
                        {" · "}
                        {run.reason === "retry_requested"
                          ? "Saved request queued again"
                          : run.reason === "human_closed"
                            ? "Closed without retrying"
                            : run.reason === "rate_limited"
                              ? "Waiting for the usage limit to reset"
                              : run.reason === "shutdown_deferred"
                                ? "Waiting for nohmi to resume"
                                : textingRunLabels[run.state]}
                      </p>
                      <TextingRunRecovery
                        run={run}
                        onRecovered={() => {
                          void client.invalidateQueries({ queryKey: agentQueryKey });
                        }}
                      />
                      {run.work.some((item) => item.state !== "completed") && (
                        <ul className="flex flex-col gap-2" aria-label="Pending work">
                          {run.work
                            .filter((item) => item.state !== "completed")
                            .map((item) => (
                              <li key={`${item.domain}:${item.key}`}>
                                <span className="font-medium capitalize">{item.domain}</span>:{" "}
                                {item.note} <span>({item.state}, reported by your agent)</span>
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
      )}
      {history.hasNextPage && !privateDenied && (
        <Button
          variant="ghost"
          disabled={history.isFetchingNextPage}
          onClick={() => void history.fetchNextPage()}
        >
          Load older messages
        </Button>
      )}
      {history.isSuccess && !messages.length && !privateDenied && (
        <div className="py-12 text-center">
          <h2 className="font-medium">Your conversation starts here</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Text nohmi from your verified phone. Your messages and replies will appear here.
          </p>
        </div>
      )}
      <ol className="flex flex-col gap-4" aria-label="Conversation history">
        {messages.map((message) => (
          <li
            key={message.id}
            className={cn(
              "flex flex-col gap-1",
              message.direction === "inbound" ? "items-end" : "items-start",
            )}
          >
            <div
              className={cn(
                "max-w-[90%] whitespace-pre-wrap break-words rounded-2xl px-4 py-3 text-sm",
                message.direction === "inbound"
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-foreground",
              )}
            >
              <span className="sr-only">{message.direction === "inbound" ? "You" : "nohmi"}: </span>
              {message.text || "Message without text"}
            </div>
            <p className="text-xs text-muted-foreground">
              <time dateTime={message.occurredAt}>{message.localDateTime}</time>
              {message.direction === "outbound" &&
                ` · ${message.status === "unknown" ? "Delivery unconfirmed" : message.status}`}
            </p>
          </li>
        ))}
      </ol>
    </section>
  );
}
