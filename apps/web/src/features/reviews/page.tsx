import { ApiClientError } from "@personal-os/api-client";
import type {
  AgentAccessDomain,
  AgentAccessWorkItem,
  AgentAccessWorkItemKind,
} from "@personal-os/domain";
import { useQuery } from "@tanstack/react-query";
import { useDeferredValue, useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  AlertTriangleIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CircleCheckIcon,
  RefreshIcon,
} from "@/components/icons";
import { SegmentedControl, SegmentedControlItem } from "@/components/segmented-control";
import { SettingsRecordAction, SettingsRecordContent } from "@/components/settings-record";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Item, ItemGroup } from "@/components/ui/item";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Pagination, PaginationContent, PaginationItem } from "@/components/ui/pagination";
import { Skeleton } from "@/components/ui/skeleton";
import { WorkspaceIcon, workspaceIdentities } from "@/components/workspace-identity";
import { WorkspaceSearch } from "@/components/workspace-search";
import { api } from "../../api.js";
import { QueryFeedback } from "../../components/async-state.js";

const pageSize = 10;
const skeletonRows = ["first", "second", "third"] as const;
const kinds = ["review", "attention"] as const;
const domains = ["mail", "calendar", "tasks", "finances"] as const;
const kindLabels: Record<AgentAccessWorkItemKind, string> = {
  attention: "Attention",
  review: "Review",
};

function isKind(value: string | null): value is AgentAccessWorkItemKind {
  return kinds.includes(value as AgentAccessWorkItemKind);
}

function isDomain(value: string | null): value is AgentAccessDomain {
  return domains.includes(value as AgentAccessDomain);
}

function joinLabels(values: AgentAccessDomain[]) {
  const labels = values.map((domain) => workspaceIdentities[domain].label);
  if (labels.length === 1) return labels[0] as string;
  if (labels.length === 2) return `${labels[0]} and ${labels[1]}`;
  return `${labels.slice(0, -1).join(", ")}, and ${labels.at(-1)}`;
}

function WorkItemRow({ item }: { item: AgentAccessWorkItem }) {
  if (!item.domain) return null;
  return (
    <Item
      data-work-item-id={item.id}
      data-work-item-kind={item.kind}
      data-work-item-priority={item.priority}
      role="listitem"
      className="settings-record h-full min-w-0 items-start"
      variant="outline"
    >
      <SettingsRecordContent
        title={item.title}
        description={item.summary}
        leading={<WorkspaceIcon size="sm" workspace={item.domain} />}
        metadata={
          <>
            <span>{workspaceIdentities[item.domain].label}</span>
            <Badge variant="secondary">{kindLabels[item.kind]}</Badge>
          </>
        }
        actions={
          item.action ? (
            <SettingsRecordAction asChild label={item.action.label}>
              <Link to={item.action.to}>
                <ChevronRightIcon />
              </Link>
            </SettingsRecordAction>
          ) : null
        }
      >
        {item.preview?.length ? (
          <dl className="grid gap-3 text-sm sm:grid-cols-2" aria-label="Review preview">
            {item.preview.map((field) => (
              <div className="min-w-0" key={field.label}>
                <dt className="text-xs text-muted-foreground">{field.label}</dt>
                <dd className="mt-1 whitespace-pre-wrap break-words">{field.value}</dd>
              </div>
            ))}
          </dl>
        ) : null}
      </SettingsRecordContent>
    </Item>
  );
}

function QueueSkeleton() {
  return (
    <div aria-label="Loading reviews" className="reviews-page__skeleton" role="status">
      {skeletonRows.map((row) => (
        <div className="reviews-page__skeleton-row" key={row}>
          <Skeleton className="size-8 shrink-0 rounded-lg" />
          <div className="reviews-page__skeleton-copy">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-4 w-full" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function ReviewsPage({ workspace }: { workspace?: AgentAccessDomain }) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedKind = searchParams.get("kind");
  const requestedDomain = workspace ?? searchParams.get("workspace");
  const search = searchParams.get("q") ?? "";
  const deferredSearch = useDeferredValue(search);
  const sort =
    searchParams.get("sort") === "oldest"
      ? "oldest"
      : searchParams.get("sort") === "newest"
        ? "newest"
        : "priority";
  const transform = Boolean(deferredSearch.trim()) || sort !== "priority";
  const kind: AgentAccessWorkItemKind | "all" = isKind(requestedKind) ? requestedKind : "all";
  const domain: AgentAccessDomain | "all" = isDomain(requestedDomain) ? requestedDomain : "all";
  const [cursor, setCursor] = useState<string | null>(null);
  const [previousCursors, setPreviousCursors] = useState<Array<string | null>>([]);
  const query = useQuery({
    queryKey: [
      "agent-access-work-items",
      kind,
      domain,
      transform ? null : cursor,
      deferredSearch,
      sort,
    ],
    queryFn: async ({ signal }) => {
      const filters = {
        ...(kind === "all" ? {} : { kind }),
        ...(domain === "all" ? {} : { domain }),
        limit: pageSize,
      };
      const first = await api.listAgentAccessWorkItems({
        ...filters,
        ...(!transform && cursor ? { cursor } : {}),
      });
      if (!transform) return first;
      const items = [...first.items];
      let next = first.nextCursor;
      while (next) {
        signal.throwIfAborted();
        const page = await api.listAgentAccessWorkItems({ ...filters, cursor: next });
        items.push(...page.items);
        next = page.nextCursor;
      }
      const term = deferredSearch.trim().toLocaleLowerCase();
      const filtered = items.filter((item) =>
        [
          item.title,
          item.summary,
          ...(item.preview ?? []).flatMap((field) => [field.label, field.value]),
        ]
          .join(" ")
          .toLocaleLowerCase()
          .includes(term),
      );
      if (sort !== "priority")
        filtered.sort(
          (a, b) =>
            (sort === "oldest" ? 1 : -1) * a.updatedAt.localeCompare(b.updatedAt) ||
            a.id.localeCompare(b.id),
        );
      return {
        ...first,
        items: filtered,
        nextCursor: null,
        filteredTotal: first.unavailableDomains.length ? null : filtered.length,
      };
    },
  });
  useEffect(() => {
    // The shared workspace search changes the URL independently of this queue.
    // Reset both server and local pagination when its scope changes.
    void deferredSearch;
    void kind;
    void domain;
    void sort;
    setCursor(null);
    setPreviousCursors([]);
  }, [deferredSearch, kind, domain, sort]);
  const pageNumber = previousCursors.length + 1;
  const start = (pageNumber - 1) * pageSize + 1;
  const visibleItems = transform
    ? query.data?.items.slice((pageNumber - 1) * pageSize, pageNumber * pageSize)
    : query.data?.items;
  const hasNext = transform
    ? (query.data?.items.length ?? 0) > pageNumber * pageSize
    : Boolean(query.data?.nextCursor);
  const end = start + (visibleItems?.length ?? 0) - 1;
  const total = query.data?.filteredTotal ?? null;

  function retry() {
    if (cursor && query.error instanceof ApiClientError && query.error.code === "invalid_request") {
      setCursor(null);
      setPreviousCursors([]);
      headingRef.current?.focus();
      return;
    }
    void query.refetch();
  }

  function selectFilter(name: "kind" | "workspace" | "q" | "sort", value: string) {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      if (!value || value === "all" || value === "priority") next.delete(name);
      else next.set(name, value);
      return next;
    });
    setCursor(null);
    setPreviousCursors([]);
    if (name !== "q") headingRef.current?.focus();
  }

  return (
    <div className="wide-page reviews-page flex w-full flex-col gap-4 pb-8">
      <h2 className="sr-only" ref={headingRef} tabIndex={-1}>
        Reviews
      </h2>

      <section aria-label="Review filters" className="reviews-page__filters">
        <WorkspaceSearch label="Search reviews" />
        <label htmlFor="review-sort" className="reviews-page__workspace-filter">
          Sort
          <NativeSelect
            id="review-sort"
            value={sort}
            onChange={(event) => selectFilter("sort", event.target.value)}
          >
            <NativeSelectOption value="priority">Priority</NativeSelectOption>
            <NativeSelectOption value="oldest">Oldest updated</NativeSelectOption>
            <NativeSelectOption value="newest">Recently updated</NativeSelectOption>
          </NativeSelect>
        </label>
        <SegmentedControl
          aria-label="Filter by work type"
          onValueChange={(value) => selectFilter("kind", value)}
          value={kind}
        >
          <SegmentedControlItem value="all">All work</SegmentedControlItem>
          {kinds.map((value) => (
            <SegmentedControlItem key={value} value={value}>
              {kindLabels[value]}
            </SegmentedControlItem>
          ))}
        </SegmentedControl>
        {!workspace ? (
          <label className="reviews-page__workspace-filter" htmlFor="review-workspace">
            <span>Workspace</span>
            <NativeSelect
              id="review-workspace"
              aria-label="Filter by workspace"
              autoComplete="off"
              name="review-workspace"
              onChange={(event) => selectFilter("workspace", event.target.value)}
              value={domain}
            >
              <NativeSelectOption value="all">All workspaces</NativeSelectOption>
              {domains.map((value) => (
                <NativeSelectOption key={value} value={value}>
                  {workspaceIdentities[value].label}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </label>
        ) : null}
      </section>
      <div className="flex min-w-0 flex-col gap-4">
        {query.isPending ? <QueueSkeleton /> : null}
        <QueryFeedback query={{ ...query, refetch: retry }} title="Couldn’t load your reviews." />
        {query.data && query.data.unavailableDomains.length > 0 ? (
          <Alert variant="warning">
            <AlertTriangleIcon />
            <AlertTitle>Some workspaces are unavailable</AlertTitle>
            <AlertDescription>
              {joinLabels(query.data.unavailableDomains)} could not be checked. Counts may be
              incomplete.
            </AlertDescription>
            <AlertAction>
              <Button onClick={() => query.refetch()} size="sm" variant="outline">
                <RefreshIcon data-icon="inline-start" />
                Check again
              </Button>
            </AlertAction>
          </Alert>
        ) : null}
        {query.data && query.data.items.length === 0 ? (
          <Empty className="reviews-page__empty">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <CircleCheckIcon />
              </EmptyMedia>
              <EmptyTitle>
                {query.data.unavailableDomains.length
                  ? "Available work is clear"
                  : "You’re caught up"}
              </EmptyTitle>
              <EmptyDescription>
                Nothing needs your review or attention in this view.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : null}
        {query.data && query.data.items.length > 0 ? (
          <section aria-label="Reviews" className="reviews-page__results">
            <ItemGroup className="grid grid-cols-1 items-stretch lg:grid-cols-2">
              {(visibleItems ?? []).map((item) => (
                <WorkItemRow item={item} key={item.id} />
              ))}
            </ItemGroup>
            <div className="reviews-page__pagination">
              <span>{total === null ? `${start}–${end}` : `${start}–${end} of ${total}`}</span>
              <Pagination>
                <PaginationContent>
                  <PaginationItem>
                    <Button
                      aria-label="Previous page"
                      disabled={!previousCursors.length || query.isFetching}
                      onClick={() => {
                        setCursor(previousCursors.at(-1) as string | null);
                        setPreviousCursors((current) => current.slice(0, -1));
                      }}
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
                      disabled={!hasNext || query.isFetching}
                      onClick={() => {
                        setPreviousCursors((current) => [...current, cursor]);
                        setCursor(query.data.nextCursor);
                      }}
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
          </section>
        ) : null}
      </div>
    </div>
  );
}
