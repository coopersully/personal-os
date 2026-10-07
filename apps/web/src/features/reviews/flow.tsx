import type { AgentAccessDomain, AgentAccessWorkItem } from "@personal-os/domain";
import { useIsMutating, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { QueryFeedback } from "@/components/async-state";
import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/responsive-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { workspaceIdentities } from "@/components/workspace-identity";
import { api } from "../../api.js";
import { ReviewActions } from "./review-actions.js";

export async function loadReviewSession(workspace: AgentAccessDomain, signal?: AbortSignal) {
  const first = await api.listAgentAccessWorkItems({ domain: workspace, limit: 10 });
  const items = [...first.items];
  let cursor = first.nextCursor;
  let unavailable = first.unavailableDomains.includes(workspace);
  while (cursor) {
    signal?.throwIfAborted();
    const page = await api.listAgentAccessWorkItems({ domain: workspace, limit: 10, cursor });
    items.push(...page.items);
    unavailable ||= page.unavailableDomains.includes(workspace);
    cursor = page.nextCursor;
  }
  return { items, unavailable };
}

export function ReviewFlowHost({ workspace }: { workspace: AgentAccessDomain | undefined }) {
  const [params, setParams] = useSearchParams();
  const requested = params.get("review");
  if (
    !workspace ||
    !requested ||
    (workspace === "finances" && ["all", "needs_review", "resolved"].includes(requested))
  )
    return null;
  return (
    <ReviewFlow
      key={`${workspace}:${requested}`}
      workspace={workspace}
      initialId={requested}
      onClose={() =>
        setParams(
          (current) => {
            const next = new URLSearchParams(current);
            next.delete("review");
            return next;
          },
          { replace: true },
        )
      }
    />
  );
}

function ReviewFlow({
  workspace,
  initialId,
  onClose,
}: {
  workspace: AgentAccessDomain;
  initialId: string;
  onClose: () => void;
}) {
  const busy = useIsMutating() > 0;
  const query = useQuery({
    queryKey: ["review-session", workspace, initialId],
    queryFn: ({ signal }) => loadReviewSession(workspace, signal),
    refetchOnWindowFocus: false,
    gcTime: 0,
    staleTime: 0,
  });
  return (
    <ResponsiveDialog
      open
      dismissible={!busy}
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <ResponsiveDialogContent className="sm:max-w-2xl" showCloseButton={!busy}>
        <ResponsiveDialogHeader className="sr-only">
          <ResponsiveDialogTitle>
            {workspaceIdentities[workspace].label} reviews
          </ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            One decision at a time. Leave anything you’re unsure about for later.
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        {query.isPending ? <p role="status">Loading your decisions…</p> : null}
        <QueryFeedback query={query} title="Couldn’t load your review session." />
        {query.data &&
        initialId !== "open" &&
        !query.data.items.some((item) => item.id === initialId) ? (
          <p role="status">This review is no longer available. It may already be resolved.</p>
        ) : query.data ? (
          <ReviewSession
            initialItems={query.data.items}
            initialId={initialId}
            unavailable={query.data.unavailable}
            workspace={workspace}
          />
        ) : null}
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}

function ReviewSession({
  initialItems,
  initialId,
  unavailable,
  workspace,
}: {
  initialItems: AgentAccessWorkItem[];
  initialId: string;
  unavailable: boolean;
  workspace: AgentAccessDomain;
}) {
  const client = useQueryClient();
  const mutating = useIsMutating() > 0;
  const [items, setItems] = useState(() =>
    [...initialItems].sort((a, b) => (a.id === initialId ? -1 : b.id === initialId ? 1 : 0)),
  );
  const [completed, setCompleted] = useState<string[]>([]);
  const [deferred, setDeferred] = useState<string[]>([]);
  const [checking, setChecking] = useState(false);
  const [message, setMessage] = useState("");
  const current = items.find((item) => !completed.includes(item.id) && !deferred.includes(item.id));
  const title = useRef<HTMLHeadingElement>(null);
  const currentId = current?.id;
  useEffect(() => {
    if (currentId) title.current?.focus();
  }, [currentId]);
  const total = initialItems.length;
  const remaining = total - completed.length;
  async function refresh() {
    if (!current) return;
    setChecking(true);
    setMessage("");
    try {
      const fresh = await loadReviewSession(workspace);
      if (fresh.unavailable) {
        setMessage(
          "Your change was submitted, but review status couldn’t be confirmed. Check again before continuing.",
        );
        return;
      }
      if (!fresh.items.some((item) => item.id === current.id)) {
        setCompleted((ids) => (ids.includes(current.id) ? ids : [...ids, current.id]));
      } else {
        setItems((records) =>
          records.map((item) => fresh.items.find((next) => next.id === item.id) ?? item),
        );
        setMessage("Your update was checked. This item still needs review.");
      }
      await client.invalidateQueries({
        predicate: (query) => {
          const key = query.queryKey[0];
          return (
            typeof key === "string" &&
            (key === "agent-access-work-items" ||
              key === "assistant-setup-status" ||
              key === "domain-profile" ||
              key === "review-attention" ||
              key === "review-mail-question" ||
              key === "review-finance-legacy" ||
              key.startsWith(
                workspace === "finances"
                  ? "finance-"
                  : workspace === "tasks"
                    ? "task"
                    : workspace === "calendar"
                      ? "calendar"
                      : "mail",
              ) ||
              (workspace === "calendar" && key === "events"))
          );
        },
      });
    } catch {
      setMessage(
        "Couldn’t confirm the result. Check again; this item hasn’t been counted as completed.",
      );
    } finally {
      setChecking(false);
    }
  }
  return (
    <>
      <div className="grid gap-2 px-4 pt-4 pb-3 md:px-0 md:pt-0 md:pb-0 pr-10" aria-live="polite">
        <p className="text-sm text-muted-foreground">
          {completed.length} completed · {remaining} left · {total} total
          {unavailable ? " (available items)" : ""}
        </p>
        <Progress
          aria-label="Review progress"
          value={total ? (completed.length / total) * 100 : 0}
        />
      </div>
      <ResponsiveDialogBody>
        {unavailable ? (
          <p role="status">
            Some review sources couldn’t be checked. This session may be incomplete.
          </p>
        ) : null}
        {current ? (
          <Card
            key={current.id}
            className="animate-in fade-in slide-in-from-right-2 duration-150 motion-reduce:animate-none"
          >
            <CardHeader
              className={
                /^(finance-|mail-question:|mail-run:|mail-rule:)/.test(current.id)
                  ? "sr-only"
                  : undefined
              }
            >
              <CardTitle>
                <h3 ref={title} tabIndex={-1} className="outline-none">
                  {current.title}
                </h3>
              </CardTitle>
              <CardDescription>{current.summary}</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4">
              {current.preview?.length &&
              !/^(finance-|mail-question:|mail-rule:)/.test(current.id) ? (
                <dl className="grid gap-3 sm:grid-cols-2">
                  {current.preview.map((field) => (
                    <div key={field.label}>
                      <dt className="text-xs text-muted-foreground">{field.label}</dt>
                      <dd className="text-sm whitespace-pre-wrap break-words">{field.value}</dd>
                    </div>
                  ))}
                </dl>
              ) : null}
              <fieldset disabled={checking} className="min-w-0">
                <ReviewActions item={current} onChanged={refresh} />
              </fieldset>
            </CardContent>
          </Card>
        ) : (
          <div className="py-8 text-center">
            <h3 className="text-lg font-semibold">
              {remaining
                ? "That’s everything for this pass"
                : unavailable
                  ? "Available reviews complete"
                  : "You’re caught up"}
            </h3>
            <p className="text-sm text-muted-foreground">
              {remaining
                ? `${remaining} items left for later. They’ll be here when you’re ready.`
                : `${completed.length} decisions completed.`}
            </p>
          </div>
        )}
        {message ? (
          <p role="status" className="mt-3 text-sm">
            {message}
          </p>
        ) : null}
      </ResponsiveDialogBody>
      <ResponsiveDialogFooter className="flex-row justify-end">
        {current ? (
          <>
            <Button
              variant="ghost"
              disabled={checking || mutating}
              onClick={() => {
                setDeferred((ids) => [...ids, current.id]);
                setMessage("");
              }}
            >
              Later
            </Button>
            <Button
              variant="outline"
              disabled={checking || mutating}
              onClick={() => void refresh()}
            >
              {checking ? "Checking…" : "Check status"}
            </Button>
          </>
        ) : remaining ? (
          <Button onClick={() => setDeferred([])}>Review remaining</Button>
        ) : null}
      </ResponsiveDialogFooter>
    </>
  );
}
