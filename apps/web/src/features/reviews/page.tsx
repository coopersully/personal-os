import { ApiClientError } from "@personal-os/api-client";
import type {
  AgentAccessDomain,
  AgentAccessWorkItem,
  AgentAccessWorkItemKind,
} from "@personal-os/domain";
import { useQuery } from "@tanstack/react-query";
import { useRef, useState } from "react";
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
import { api } from "../../api.js";
import { QueryFeedback } from "../../components/async-state.js";

import { SettingsSection } from "../settings/settings-layout.js";

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
      className="settings-record"
      variant="secondary"
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

export function ReviewsPage() {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedKind = searchParams.get("kind");
  const requestedDomain = searchParams.get("workspace");
  const kind: AgentAccessWorkItemKind | "all" = isKind(requestedKind) ? requestedKind : "all";
  const domain: AgentAccessDomain | "all" = isDomain(requestedDomain) ? requestedDomain : "all";
  const [cursor, setCursor] = useState<string | null>(null);
  const [previousCursors, setPreviousCursors] = useState<Array<string | null>>([]);
  const query = useQuery({
    queryKey: ["agent-access-work-items", kind, domain, cursor],
    queryFn: () =>
      api.listAgentAccessWorkItems({
        ...(cursor ? { cursor } : {}),
        ...(kind === "all" ? {} : { kind }),
        ...(domain === "all" ? {} : { domain }),
        limit: pageSize,
      }),
  });
  const pageNumber = previousCursors.length + 1;
  const start = (pageNumber - 1) * pageSize + 1;
  const end = start + (query.data?.items.length ?? 0) - 1;
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

  function selectFilter(name: "kind" | "workspace", value: string) {
    if (!value) return;
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      if (value === "all") next.delete(name);
      else next.set(name, value);
      return next;
    });
    setCursor(null);
    setPreviousCursors([]);
    headingRef.current?.focus();
  }

  return (
    <div className="settings-stack reviews-page">
      <h2 className="sr-only" ref={headingRef} tabIndex={-1}>
        Reviews
      </h2>

      <SettingsSection
        title="Review filters"
        description="Choose the work type and workspace to review."
      >
        <section aria-label="Review filters" className="reviews-page__filters">
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
        </section>
      </SettingsSection>

      <SettingsSection title="Review queue" description="Work that needs your review or attention.">
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
            <ItemGroup>
              {query.data.items.map((item) => (
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
                      disabled={!query.data.nextCursor || query.isFetching}
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
      </SettingsSection>
    </div>
  );
}
