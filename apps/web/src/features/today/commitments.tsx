import { addLocalDays, localDateToIso, type Reminder, type Task } from "@personal-os/domain";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { Fragment, type MouseEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { api } from "@/api";
import { ChevronDownIcon } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CardContent, CardFooter } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ItemGroup } from "@/components/ui/item";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import { useWorkspacePreferences } from "@/features/workspace-settings/preferences";
import { useTodayPreferences } from "./preferences";

type Props = {
  day: string;
  renderTask: (task: Task) => ReactNode;
  renderReminder: (reminder: Reminder) => ReactNode;
  children?: ReactNode;
};
const labels = {
  overdue: "Overdue",
  today: "Today",
  later_this_week: "Later this week",
  undated: "Undated",
};

export function TodayCommitments(props: Props) {
  const preferences = useTodayPreferences();
  const calendar = useWorkspacePreferences("calendar");
  const [pageSize, setPageSize] = useState(6);
  const includeUndated = preferences.data?.preferences.includeUndated ?? false;
  const day = `${props.day}:${calendar.data?.preferences.weekStartsOn ?? "sunday"}`;
  return (
    <CommitmentPage
      {...props}
      key={`${day}:${includeUndated}`}
      day={day}
      includeUndated={includeUndated}
      pageSize={pageSize}
      setPageSize={setPageSize}
    />
  );
}

function CommitmentPage({
  day,
  includeUndated,
  pageSize,
  setPageSize,
  renderTask,
  renderReminder,
  children,
}: Props & {
  includeUndated: boolean;
  pageSize: number;
  setPageSize: (size: number) => void;
}) {
  const cache = useQueryClient();
  const [cursors, setCursors] = useState<Array<string | undefined>>([undefined]);
  const [page, setPage] = useState(0);
  const [navigating, setNavigating] = useState(false);
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const options = (cursor: string | undefined) => ({
    queryKey: ["today-commitments", day, "all", includeUndated, pageSize, cursor],
    queryFn: () =>
      api.getTodayCommitments({
        filter: "all",
        includeUndated,
        limit: pageSize,
        ...(cursor ? { cursor } : {}),
      }),
  });
  const query = useQuery({
    ...options(cursors[page]),
    placeholderData: keepPreviousData,
    refetchInterval: page ? false : 60000,
  });
  useEffect(() => {
    if (page && query.isSuccess && !query.isFetching && !query.data.items.length) {
      setPage((value) => value - 1);
      setCursors((value) => value.slice(0, page));
    }
  }, [page, query.isSuccess, query.isFetching, query.data]);
  const busy = navigating || query.isPlaceholderData;
  const total = query.data?.counts.all;
  const pages =
    total === null || total === undefined ? null : Math.max(1, Math.ceil(total / pageSize));
  const goTo = async (target: number) => {
    if (busy || target === page || target < 0 || (pages !== null && target >= pages)) return;
    if (target < cursors.length) {
      setPage(target);
      return;
    }
    setNavigating(true);
    try {
      const next = [...cursors];
      while (next.length <= target && active.current) {
        const previous = await cache.fetchQuery(options(next.at(-1)));
        if (!previous.nextCursor) break;
        next.push(previous.nextCursor);
      }
      if (!active.current) return;
      const destination = Math.min(target, next.length - 1);
      // Keep the current rows/footer mounted until the destination is ready.
      await cache.fetchQuery(options(next[destination]));
      if (active.current) {
        setCursors(next);
        setPage(destination);
      }
    } catch {
      if (active.current)
        toast.error("Could not open that page. Refresh commitments and try again.", {
          action: {
            label: "Refresh",
            onClick: () => {
              void refresh();
            },
          },
        });
    } finally {
      if (active.current) setNavigating(false);
    }
  };
  const refresh = () =>
    toast.promise(
      cache.fetchQuery({ ...options(undefined), staleTime: 0 }).then(() => {
        if (active.current) {
          setCursors([undefined]);
          setPage(0);
        }
      }),
      {
        loading: "Refreshing commitments…",
        success: "Commitments refreshed.",
        error: "Could not refresh commitments.",
      },
    );
  const link = (target: number, disabled = false) => ({
    href: "#today-queue-title",
    "aria-disabled": disabled || busy,
    tabIndex: disabled || busy ? -1 : 0,
    onClick: (event: MouseEvent<HTMLAnchorElement>) => {
      event.preventDefault();
      if (!disabled && !busy) void goTo(target);
    },
  });
  const visiblePages = Array.from(
    new Set([0, page - 1, page, page + 1, ...(pages === null ? [] : [pages - 1])]),
  )
    .filter(
      (value) =>
        value >= 0 &&
        (pages === null ? value <= page + (query.data?.nextCursor ? 1 : 0) : value < pages),
    )
    .sort((a, b) => a - b);
  return (
    <>
      <CardContent className="today-commitments" aria-busy={busy}>
        {!query.data ? (
          <div className="min-h-48" aria-busy={query.isPending}>
            {query.isError ? (
              <Button variant="outline" onClick={refresh}>
                Retry commitments
              </Button>
            ) : (
              <span className="text-muted-foreground">Loading commitments…</span>
            )}
          </div>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              {weekLabel(query.data.weekStart, query.data.weekEndExclusive)} · {total ?? "Unknown"}{" "}
              commitments
            </p>
            {query.isError || query.data.unavailableSources.length ? (
              <p className="text-sm text-muted-foreground">
                Some commitments could not be refreshed.{" "}
                <Button variant="link" onClick={refresh}>
                  Refresh
                </Button>
              </p>
            ) : null}
            {query.data.items.length ? (
              <div className="today-commitment-groups">
                {(Object.keys(labels) as Array<keyof typeof labels>).map((group) => {
                  const items = query.data.items.filter((item) => item.group === group);
                  if (!items.length) return null;
                  return (
                    <Collapsible
                      key={group}
                      open={!closed.has(group)}
                      onOpenChange={(open) =>
                        setClosed((previous) => {
                          const next = new Set(previous);
                          if (open) next.delete(group);
                          else next.add(group);
                          return next;
                        })
                      }
                    >
                      <CollapsibleTrigger className="today-commitment-group__trigger" type="button">
                        <span>{labels[group]}</span>
                        <Badge variant="secondary" title="Shown on this page">
                          {items.length}
                        </Badge>
                        <ChevronDownIcon aria-hidden="true" />
                      </CollapsibleTrigger>
                      <CollapsibleContent>
                        <ItemGroup className="gap-2">
                          {items.map((item) => (
                            <div key={`${item.kind}:${item.material.id}`}>
                              {item.kind === "task"
                                ? renderTask(item.material)
                                : renderReminder(item.material)}
                            </div>
                          ))}
                        </ItemGroup>
                      </CollapsibleContent>
                    </Collapsible>
                  );
                })}
              </div>
            ) : (
              <p className="py-4 text-muted-foreground">No commitments this week.</p>
            )}
          </>
        )}
        {children}
      </CardContent>
      {query.data ? (
        <CardFooter className="today-commitments__footer" aria-busy={busy}>
          <div className="today-commitments__page-options">
            <span className="text-sm text-muted-foreground">
              Page {page + 1}
              {pages === null ? " · total unavailable" : ` of ${pages}`}
            </span>
            <NativeSelect
              aria-label="Commitments per page"
              size="sm"
              value={String(pageSize)}
              onChange={(event) => {
                setPage(0);
                setCursors([undefined]);
                setPageSize(Number(event.target.value));
              }}
              disabled={busy}
            >
              {[6, 12, 24].map((size) => (
                <NativeSelectOption key={size} value={String(size)}>
                  {size} per page
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </div>
          <Pagination aria-label="Commitment pages">
            <PaginationContent>
              <PaginationItem>
                <PaginationPrevious {...link(page - 1, page === 0)} />
              </PaginationItem>
              {visiblePages.map((value, index) => (
                <Fragment key={value}>
                  {index && value > (visiblePages[index - 1] ?? -1) + 1 ? (
                    <PaginationItem>
                      <PaginationEllipsis />
                    </PaginationItem>
                  ) : null}
                  <PaginationItem>
                    <PaginationLink
                      {...link(value)}
                      aria-label={`Page ${value + 1}`}
                      isActive={page === value}
                    >
                      {value + 1}
                    </PaginationLink>
                  </PaginationItem>
                </Fragment>
              ))}
              <PaginationItem>
                <PaginationNext {...link(page + 1, !query.data.nextCursor)} />
              </PaginationItem>
            </PaginationContent>
          </Pagination>
        </CardFooter>
      ) : null}
    </>
  );
}

function weekLabel(start: string, end: string) {
  const format = (value: string) =>
    new Intl.DateTimeFormat("en", { month: "short", day: "numeric", timeZone: "UTC" }).format(
      new Date(`${value}T12:00:00Z`),
    );
  const [year, month, day] = end.split("-").map(Number);
  return `${format(start)}–${format(localDateToIso(addLocalDays({ year: year as number, month: month as number, day: day as number }, -1)))}`;
}
