import type {
  AgentAccessDomain,
  AgentAccessWorkItem,
  AgentAccessWorkItemKind,
} from "@personal-os/domain";
import { useQuery } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangleIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CircleCheckIcon,
  KeyIcon,
  RefreshIcon,
} from "@/components/icons";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";
import { Pagination, PaginationContent, PaginationItem } from "@/components/ui/pagination";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { WorkspaceIcon, workspaceIdentities } from "@/components/workspace-identity";
import { api, errorMessage } from "../../api.js";

const pageSize = 10;
const skeletonRows = ["first", "second", "third"] as const;
const kindLabels: Record<AgentAccessWorkItemKind, string> = {
  attention: "Attention",
  review: "Review",
  setup: "Setup",
};

function joinLabels(domains: AgentAccessDomain[]) {
  const labels = domains.map((domain) => workspaceIdentities[domain].label);
  if (labels.length < 2) return labels[0] ?? "A workspace";
  if (labels.length === 2) return `${labels[0]} and ${labels[1]}`;
  return `${labels.slice(0, -1).join(", ")}, and ${labels.at(-1)}`;
}

function WorkItemRow({ item }: { item: AgentAccessWorkItem }) {
  const workspaceLabel = item.domain ? workspaceIdentities[item.domain].label : "Agent access";

  return (
    <Item role="listitem" size="sm" variant="outline">
      <ItemMedia variant="icon">
        {item.domain ? (
          <WorkspaceIcon size="sm" workspace={item.domain} />
        ) : (
          <span
            aria-hidden="true"
            className="agent-access-queue__functional-icon"
            data-functional-icon="agent-access"
          >
            <KeyIcon />
          </span>
        )}
      </ItemMedia>
      <ItemContent>
        <div className="agent-access-queue__metadata">
          <span>{workspaceLabel}</span>
          <Badge variant="outline">{kindLabels[item.kind]}</Badge>
        </div>
        <ItemTitle>{item.title}</ItemTitle>
        <ItemDescription>{item.summary}</ItemDescription>
      </ItemContent>
      {item.action ? (
        <ItemActions>
          <Button asChild size="sm" variant="outline">
            <Link to={item.action.to}>{item.action.label}</Link>
          </Button>
        </ItemActions>
      ) : null}
    </Item>
  );
}

function QueueSkeleton() {
  return (
    <div aria-label="Loading action queue" className="agent-access-queue__skeleton" role="status">
      {skeletonRows.map((row) => (
        <div className="agent-access-queue__skeleton-row" key={row}>
          <Skeleton className="size-8 shrink-0 rounded-lg" />
          <div className="agent-access-queue__skeleton-copy">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-4 w-full" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function AgentAccessQueue() {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [kind, setKind] = useState<AgentAccessWorkItemKind | "all">("all");
  const [cursor, setCursor] = useState<string | null>(null);
  const [previousCursors, setPreviousCursors] = useState<Array<string | null>>([]);
  const query = useQuery({
    queryKey: ["agent-access-work-items", kind, cursor],
    queryFn: () =>
      api.listAgentAccessWorkItems({
        ...(cursor ? { cursor } : {}),
        ...(kind === "all" ? {} : { kind }),
        limit: pageSize,
      }),
  });
  const pageNumber = previousCursors.length + 1;
  const start = (pageNumber - 1) * pageSize + 1;
  const end = start + (query.data?.items.length ?? 0) - 1;
  const total = query.data
    ? kind === "all"
      ? query.data.summary.total
      : query.data.summary.byKind[kind]
    : null;

  function selectKind(value: string) {
    if (!value) return;
    setKind(value as AgentAccessWorkItemKind | "all");
    setCursor(null);
    setPreviousCursors([]);
    headingRef.current?.focus();
  }

  function nextPage() {
    if (!query.data?.nextCursor) return;
    setPreviousCursors((current) => [...current, cursor]);
    setCursor(query.data.nextCursor);
  }

  function previousPage() {
    setPreviousCursors((current) => {
      if (current.length === 0) return current;
      setCursor(current.at(-1) ?? null);
      return current.slice(0, -1);
    });
  }

  return (
    <Card className="agent-access-queue">
      <CardHeader>
        <CardTitle>
          <h2 ref={headingRef} tabIndex={-1}>
            Your action queue
          </h2>
        </CardTitle>
        <CardDescription>
          Review decisions, unblock agents, and finish workspace setup.
        </CardDescription>
      </CardHeader>
      <CardContent className="agent-access-queue__content">
        <ToggleGroup
          aria-label="Filter action queue"
          onValueChange={selectKind}
          type="single"
          value={kind}
          variant="outline"
        >
          <ToggleGroupItem aria-label="All" value="all">
            All
          </ToggleGroupItem>
          {(["review", "attention", "setup"] as const).map((itemKind) => (
            <ToggleGroupItem aria-label={kindLabels[itemKind]} key={itemKind} value={itemKind}>
              {kindLabels[itemKind]}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>

        {query.isPending ? <QueueSkeleton /> : null}

        {query.isError ? (
          <Alert variant="destructive">
            <AlertTriangleIcon />
            <AlertTitle>Action queue could not load</AlertTitle>
            <AlertDescription>{errorMessage(query.error)}</AlertDescription>
            <AlertAction>
              <Button onClick={() => query.refetch()} size="sm" variant="outline">
                <RefreshIcon data-icon="inline-start" />
                Try again
              </Button>
            </AlertAction>
          </Alert>
        ) : null}

        {query.data && query.data.unavailableDomains.length > 0 ? (
          <Alert variant="warning">
            <AlertTriangleIcon />
            <AlertTitle>Some workspaces are unavailable</AlertTitle>
            <AlertDescription>
              {joinLabels(query.data.unavailableDomains)} could not be checked. Counts may be
              incomplete.
            </AlertDescription>
          </Alert>
        ) : null}

        {query.data && query.data.items.length === 0 ? (
          <Empty className="agent-access-queue__empty">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <CircleCheckIcon />
              </EmptyMedia>
              <EmptyTitle>
                {query.data.unavailableDomains.length > 0
                  ? "Available work is clear"
                  : "You’re caught up"}
              </EmptyTitle>
              <EmptyDescription>
                {query.data.unavailableDomains.length > 0
                  ? "Nothing available needs action. Check back after unavailable workspaces recover."
                  : "Nothing needs your review or attention right now."}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : null}

        {query.data && query.data.items.length > 0 ? (
          <>
            <ItemGroup aria-label="Agent Access action queue">
              {query.data.items.map((item) => (
                <WorkItemRow item={item} key={item.id} />
              ))}
            </ItemGroup>
            <div className="agent-access-queue__pagination">
              <span className="agent-access-queue__range">
                {total === null ? `${start}–${end}` : `${start}–${end} of ${total}`}
              </span>
              <Pagination>
                <PaginationContent>
                  <PaginationItem>
                    <Button
                      aria-label="Previous page"
                      disabled={previousCursors.length === 0 || query.isFetching}
                      onClick={previousPage}
                      size="sm"
                      variant="outline"
                    >
                      <ChevronLeftIcon data-icon="inline-start" />
                      Previous
                    </Button>
                  </PaginationItem>
                  <PaginationItem>
                    <Button
                      aria-label="Next page"
                      disabled={!query.data.nextCursor || query.isFetching}
                      onClick={nextPage}
                      size="sm"
                      variant="outline"
                    >
                      Next
                      <ChevronRightIcon data-icon="inline-end" />
                    </Button>
                  </PaginationItem>
                </PaginationContent>
              </Pagination>
            </div>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}
