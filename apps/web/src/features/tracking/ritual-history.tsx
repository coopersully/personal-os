import {
  latestRitualResponses,
  localDateAt,
  localDateToIso,
  type RitualOccurrence,
  ritualAnswerIsValid,
} from "@personal-os/domain";
import { useQuery } from "@tanstack/react-query";
import {
  addMonths,
  addWeeks,
  endOfMonth,
  endOfWeek,
  format,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { useEffect, useState } from "react";
import { CompactStatus } from "@/components/compact-status";
import { CompletionCount } from "@/components/completion-count";
import { type DataColumn, DataTable } from "@/components/data-table";
import { DataChoice, FilterBar, SearchDataControls } from "@/components/data-view-controls";
import { DataViewEmpty, DataViewLoading, DataViewRecovery } from "@/components/data-view-state";
import {
  CalendarIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  ClockIcon,
  type Icon,
  MinusIcon,
  MoonIcon,
  SearchIcon,
  SunIcon,
  XIcon,
} from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Pagination, PaginationContent, PaginationItem } from "@/components/ui/pagination";
import { formatRelativeCalendarDate } from "@/lib/date-format";
import { api } from "../../api.js";
import { Button } from "../../components/ui/button.js";

const statuses: Record<RitualOccurrence["status"], string> = {
  pending: "In Progress",
  completed: "Completed",
  skipped: "Skipped",
  missed: "Missed",
  cancelled_configuration: "Cancelled",
};
function statusLabel(status: RitualOccurrence["status"]) {
  return statuses[status];
}
function ritualLabel(o: RitualOccurrence) {
  return o.definition.kind === "night" ? "Evening Ritual" : "Morning Ritual";
}
function progress(o: RitualOccurrence) {
  const answers = latestRitualResponses(o);
  const done = (step: RitualOccurrence["definition"]["steps"][number]) => {
    const answer = answers[step.id];
    return Boolean(answer?.submitted && ritualAnswerIsValid(step, answer.value));
  };
  const required = o.definition.steps.filter((step) => !step.optional);
  const optional = o.definition.steps.filter((step) => step.optional);
  return {
    required: required.length,
    requiredDone: required.filter(done).length,
    optional: optional.length,
    optionalDone: optional.filter(done).length,
    snoozes: o.actions.filter(
      (action) => action.kind === "snooze_confirmed" && action.outcome === "applied",
    ).length,
  };
}
function entrySummary(o: RitualOccurrence) {
  if (o.status === "cancelled_configuration") return "Settings changed before this ritual finished";
  const counts = progress(o);
  const parts = [
    `${counts.requiredDone}/${counts.required} required`,
    `${counts.optionalDone}/${counts.optional} optional`,
  ];
  if (counts.snoozes)
    parts.push(`Snoozed ${counts.snoozes} ${counts.snoozes === 1 ? "time" : "times"}`);
  return parts.join(" · ");
}
function answerPreview(o: RitualOccurrence) {
  const answers = latestRitualResponses(o);
  const step = o.definition.steps.find(
    (item) =>
      item.kind === "short_text" &&
      answers[item.id]?.submitted &&
      String(answers[item.id]?.value ?? "").trim(),
  );
  return step ? `${step.label}: ${String(answers[step.id]?.value)}` : null;
}
export function RitualHistory() {
  const [pageSize, setPageSize] = useState(10);
  const [kind, setKind] = useState("");
  const [period, setPeriod] = useState("week");
  const [offset, setOffset] = useState(0);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [sort, setSort] = useState<"newest" | "oldest">("newest");
  const [committedSearch, setCommittedSearch] = useState("");
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined]);
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<RitualOccurrence | null>(null);
  const profile = useQuery({ queryKey: ["me"], queryFn: api.getMe, staleTime: 60_000 });
  const today = new Date(
    `${localDateToIso(localDateAt(new Date(), profile.data?.planningTimezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone))}T12:00:00`,
  );
  const anchor = period === "week" ? addWeeks(today, offset) : addMonths(today, offset);
  const from = period === "week" ? startOfWeek(anchor, { weekStartsOn: 1 }) : startOfMonth(anchor);
  const to = period === "week" ? endOfWeek(anchor, { weekStartsOn: 1 }) : endOfMonth(anchor);
  function resetPage() {
    setPage(0);
    setCursors([undefined]);
  }
  useEffect(() => {
    if (search.trim() === committedSearch) return;
    const timer = window.setTimeout(() => {
      setCommittedSearch(search.trim());
      setPage(0);
      setCursors([undefined]);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [search, committedSearch]);
  const filters = {
    ...(kind ? { kind } : {}),
    ...(period !== "all"
      ? { dateFrom: format(from, "yyyy-MM-dd"), dateTo: format(to, "yyyy-MM-dd") }
      : {}),
    ...(status ? { status: status as RitualOccurrence["status"] } : {}),
    ...(committedSearch ? { search: committedSearch } : {}),
    sort,
    limit: pageSize,
  };
  const history = useQuery({
    queryKey: ["ritual-history", filters, cursors[page]],
    queryFn: () => api.listRitualHistory(cursors[page], filters),
  });
  const visible = history.data?.items ?? [];
  const total = history.data?.total;
  const hasRows = visible.length > 0;
  const constrained = Boolean(search.trim() || kind || status);
  function showAllHistory() {
    setSearch("");
    setCommittedSearch("");
    setKind("");
    setStatus("");
    changePeriod("all");
  }
  const currentPage = page;
  const lastPage =
    total === undefined
      ? page + (history.data?.nextCursor ? 1 : 0)
      : Math.max(0, Math.ceil(total / pageSize) - 1);
  function changePeriod(value: string) {
    setPeriod(value);
    setOffset(0);
    resetPage();
  }
  function movePeriod(delta: number) {
    setOffset((value) => value + delta);
    resetPage();
  }
  const filterControls: {
    label: string;
    value: string;
    active: boolean;
    choices: [string, string][];
    choiceIcons?: Record<string, Icon>;
    onChange: (value: string) => void;
  }[] = [
    {
      label: "Period",
      choiceIcons: { week: CalendarIcon, month: CalendarIcon, all: ClockIcon },
      value: period,
      active: period !== "all",
      choices: [
        ["week", offset === 0 ? "This Week" : "Week"],
        ["month", offset === 0 ? "This Month" : "Month"],
        ["all", "All Time"],
      ],
      onChange: changePeriod,
    },
    {
      label: "Ritual",
      choiceIcons: { morning: SunIcon, night: MoonIcon },
      value: kind,
      active: Boolean(kind),
      choices: [
        ["", "Both Rituals"],
        ["morning", "Morning"],
        ["night", "Evening"],
      ],
      onChange: (value) => {
        setKind(value);
        resetPage();
      },
    },
    {
      label: "Status",
      choiceIcons: {
        pending: ClockIcon,
        completed: CircleCheckIcon,
        skipped: MinusIcon,
        missed: CircleAlertIcon,
        cancelled_configuration: XIcon,
      },
      value: status,
      active: Boolean(status),
      choices: [["", "All Statuses"], ...Object.entries(statuses)],
      onChange: (value) => {
        setStatus(value);
        resetPage();
      },
    },
  ];
  const columns: DataColumn<RitualOccurrence>[] = [
    {
      id: "ritual",
      label: "Ritual",
      primary: true,
      width: 160,
      value: ritualLabel,
      mobileCell: (row) => (
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="font-medium">{ritualLabel(row)}</span>
          <time
            className="text-xs font-normal text-muted-foreground"
            dateTime={row.scheduledLocalDate}
          >
            {formatRelativeCalendarDate(row.scheduledLocalDate, row.timeZone)}
          </time>
        </span>
      ),
    },
    {
      id: "date",
      label: "Date",
      mobileHidden: true,
      width: 110,
      value: (row) => row.scheduledLocalDate,
      cell: (row) => formatRelativeCalendarDate(row.scheduledLocalDate, row.timeZone),
    },
    {
      id: "status",
      mobileOrder: 2,
      label: "Status",
      width: 110,
      value: (row) => statusLabel(row.status),
      cell: (row) => <Badge variant="secondary">{statusLabel(row.status)}</Badge>,
      mobileCell: (row) => (
        <CompactStatus
          label={statusLabel(row.status)}
          icon={
            {
              pending: ClockIcon,
              completed: CircleCheckIcon,
              missed: CircleAlertIcon,
              skipped: MinusIcon,
              cancelled_configuration: XIcon,
            }[row.status]
          }
        />
      ),
    },
    {
      id: "required",
      mobileOrder: 0,
      label: "Required",
      width: 100,
      value: (row) => `${progress(row).requiredDone}/${progress(row).required}`,
      cell: (row) => (
        <CompletionCount value={progress(row).requiredDone} total={progress(row).required} />
      ),
    },
    {
      id: "optional",
      mobileOrder: 1,
      label: "Optional",
      width: 100,
      value: (row) => `${progress(row).optionalDone}/${progress(row).optional}`,
      cell: (row) => (
        <CompletionCount value={progress(row).optionalDone} total={progress(row).optional} />
      ),
    },
    {
      id: "snoozes",
      mobileOrder: 3,
      label: "Snoozes",
      width: 90,
      value: (row) => progress(row).snoozes,
    },
    {
      id: "answer",
      label: "Written Answer",
      defaultHidden: true,
      width: 320,
      value: (row) => answerPreview(row) ?? "No submitted written answer",
    },
    { id: "outcome", label: "Outcome", defaultHidden: true, width: 300, value: entrySummary },
    {
      id: "due",
      label: "Scheduled Time",
      defaultHidden: true,
      width: 200,
      value: (row) =>
        new Date(row.dueAt).toLocaleString(undefined, {
          timeZone: row.timeZone,
          timeZoneName: "short",
        }),
    },
    {
      id: "zone",
      label: "Time Zone",
      defaultHidden: true,
      width: 180,
      value: (row) => row.timeZone,
    },
  ];
  const periodNavigation = (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <span>
        {period === "all" ? "All time" : `${format(from, "MMM d")} – ${format(to, "MMM d, yyyy")}`}
      </span>
      {period === "all" ? (
        <Button variant="ghost" size="sm" onClick={() => changePeriod("week")}>
          This week
        </Button>
      ) : (
        <div className="flex gap-1">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Previous ${period}`}
            onClick={() => movePeriod(-1)}
          >
            <ChevronLeftIcon />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Next ${period}`}
            disabled={offset >= 0}
            onClick={() => movePeriod(1)}
          >
            <ChevronRightIcon />
          </Button>
        </div>
      )}
    </div>
  );
  return (
    <section className="flex flex-col gap-4" aria-label="Ritual history">
      <search className="flex min-w-0 items-center gap-2" aria-label="Search ritual history">
        <InputGroup className="min-w-0 flex-1">
          <InputGroupAddon>
            <SearchIcon aria-hidden="true" />
          </InputGroupAddon>
          <InputGroupInput
            aria-label="Search history"
            placeholder="Search questions or answers…"
            value={search}
            maxLength={200}
            onChange={(event) => setSearch(event.target.value)}
          />
          <SearchDataControls>
            <FilterBar
              collapsed
              filters={filterControls.map((control) => ({
                id: control.label,
                label: control.label,
                active: control.active,
                control: <DataChoice {...control} />,
              }))}
            >
              {hasRows ? (
                <DataChoice
                  label="Sort"
                  compact
                  sorting
                  value={sort}
                  choices={[
                    ["newest", "Newest First"],
                    ["oldest", "Oldest First"],
                  ]}
                  onChange={(value) => {
                    setSort(value as "newest" | "oldest");
                    resetPage();
                  }}
                />
              ) : null}
            </FilterBar>
          </SearchDataControls>
        </InputGroup>
      </search>
      <section aria-label="History results" className="flex min-w-0 flex-col gap-3">
        {!hasRows ? <div className="text-xs text-muted-foreground">{periodNavigation}</div> : null}
        {history.isPending ? <DataViewLoading label="Loading ritual history" /> : null}
        <DataViewRecovery
          query={history}
          title="Couldn’t load ritual history."
          unavailableLabel="History unavailable"
        />
        {visible.length ? (
          <DataTable
            rows={visible}
            columns={columns}
            rowId={(row) => row.id}
            rowLabel={(row) =>
              `${ritualLabel(row)} · ${formatRelativeCalendarDate(row.scheduledLocalDate, row.timeZone)}`
            }
            onOpen={setSelected}
            label="Ritual history entries"
            storageKey={`ritual-history:${profile.data?.id ?? "account"}`}
            fileName="ritual-history-page.csv"
            caption={periodNavigation}
          />
        ) : null}
        {!history.isPending && !history.isError && !visible.length ? (
          <DataViewEmpty
            title={
              constrained
                ? "No matching rituals"
                : period === "all"
                  ? "No ritual history yet"
                  : "No rituals in this period"
            }
            description={
              constrained
                ? "Try a different search or broaden your filters."
                : period === "all"
                  ? "Your rituals will appear here as you use them."
                  : "Earlier rituals may be outside this date range."
            }
          >
            {page > 0 ? (
              <Button variant="secondary" onClick={() => setPage(page - 1)}>
                Previous page
              </Button>
            ) : null}
            {constrained || period !== "all" ? (
              <Button onClick={showAllHistory}>Show all history</Button>
            ) : null}
          </DataViewEmpty>
        ) : null}
      </section>
      {hasRows ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <label
            htmlFor="ritual-history-page-size"
            className="flex items-center gap-2 text-xs text-muted-foreground"
          >
            <span className="sr-only">Rows per page</span>
            <NativeSelect
              id="ritual-history-page-size"
              aria-label="Rows per page"
              value={String(pageSize)}
              onChange={(event) => {
                setPageSize(Number(event.target.value));
                resetPage();
              }}
            >
              {[10, 25, 50, 100].map((value) => (
                <NativeSelectOption key={value} value={String(value)}>
                  {value} / page
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </label>
          <p className="text-xs text-muted-foreground">
            {visible.length ? currentPage * pageSize + 1 : 0}–
            {currentPage * pageSize + visible.length}{" "}
            {total !== undefined ? `of ${total} rituals` : "rituals"}
          </p>
          {lastPage > 0 ? (
            <Pagination className="mx-0 w-auto" aria-label="History pages">
              <PaginationContent>
                <PaginationItem>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={currentPage === 0}
                    onClick={() => setPage(currentPage - 1)}
                  >
                    Previous
                  </Button>
                </PaginationItem>
                <PaginationItem>
                  <span className="px-2 text-xs text-muted-foreground">
                    Page {currentPage + 1}
                    {total !== undefined ? ` of ${lastPage + 1}` : ""}
                  </span>
                </PaginationItem>
                <PaginationItem>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={!history.data?.nextCursor}
                    onClick={() => {
                      setCursors((values) => [
                        ...values.slice(0, page + 1),
                        history.data?.nextCursor ?? undefined,
                      ]);
                      setPage(page + 1);
                    }}
                  >
                    Next
                  </Button>
                </PaginationItem>
              </PaginationContent>
            </Pagination>
          ) : null}
        </div>
      ) : null}
      <Dialog
        open={selected !== null}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
      >
        {selected ? (
          <DialogContent showCloseButton={false} className="sm:max-w-xl">
            <DialogHeader>
              <DialogTitle>{ritualLabel(selected)}</DialogTitle>
              <DialogDescription>
                {format(new Date(`${selected.scheduledLocalDate}T12:00:00`), "EEEE, MMM d, yyyy")} ·{" "}
                {statusLabel(selected.status)}
              </DialogDescription>
            </DialogHeader>
            <HistoryDetails o={selected} />
            <DialogFooter>
              <Button onClick={() => setSelected(null)}>Close</Button>
            </DialogFooter>
          </DialogContent>
        ) : null}
      </Dialog>
    </section>
  );
}

function HistoryDetails({ o }: { o: RitualOccurrence }) {
  const answers = latestRitualResponses(o);
  const counts = progress(o);
  return (
    <div className="flex max-h-[60dvh] flex-col gap-4 overflow-y-auto text-sm">
      <div className="flex flex-col gap-1">
        <dl className="grid grid-cols-3 gap-3 rounded-lg bg-secondary p-3">
          {[
            ["Required", `${counts.requiredDone} / ${counts.required}`],
            ["Optional", `${counts.optionalDone} / ${counts.optional}`],
            ["Snoozes", String(counts.snoozes)],
          ].map(([label, value]) => (
            <div key={label} className="flex flex-col gap-1">
              <dt className="text-xs text-muted-foreground">{label}</dt>
              <dd className="font-medium tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>
        <p className="text-xs text-muted-foreground">
          Due{" "}
          {new Date(o.dueAt).toLocaleString(undefined, {
            timeZone: o.timeZone,
            timeZoneName: "short",
          })}
        </p>
        {o.status === "completed" ? (
          <p className="text-muted-foreground">
            Required steps finished. {counts.optional - counts.optionalDone} optional steps left.
          </p>
        ) : null}
      </div>
      <section className="flex flex-col gap-4" aria-label="Ritual answers">
        <h3 className="font-semibold">Answers</h3>
        {o.definition.steps.map((step, index) => {
          const answer = answers[step.id];
          const valid = answer?.submitted && ritualAnswerIsValid(step, answer.value);
          const followUp =
            !valid && o.optionalFollowUp?.stepIds.includes(step.id) ? o.optionalFollowUp : null;
          return (
            <div key={step.id} className="flex gap-3">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-secondary text-xs text-muted-foreground">
                {index + 1}
              </span>
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <p className="font-medium">
                  {step.label}
                  {!step.optional ? (
                    <span className="ml-1 text-xs font-normal text-muted-foreground">Required</span>
                  ) : null}
                </p>
                <p
                  className={
                    valid
                      ? "whitespace-pre-wrap break-words"
                      : "whitespace-pre-wrap break-words text-muted-foreground"
                  }
                >
                  {answer
                    ? `${typeof answer.value === "boolean" ? (answer.value ? "Done" : "Not done") : answer.value || "No answer"}${answer.submitted ? "" : " (draft)"}`
                    : "Not done"}
                </p>
                {followUp ? (
                  <p className="text-xs text-muted-foreground">
                    Reminder {followUp.reminderIds ? "scheduled" : "waiting to sync"} ·{" "}
                    {new Date(followUp.dueAt).toLocaleString(undefined, {
                      timeZone: o.timeZone,
                      timeZoneName: "short",
                    })}
                  </p>
                ) : null}
              </div>
            </div>
          );
        })}
      </section>
      {o.actions.length || o.responses.length ? (
        <Collapsible>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm">
              Interaction Log <ChevronRightIcon aria-hidden="true" />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="flex flex-col gap-2 pt-3">
            <p className="text-xs text-muted-foreground">
              Individual saves and button presses, including drafts and cancelled actions.
            </p>
            <ol className="flex flex-col gap-3">
              {[
                ...o.responses.map((r) => ({
                  id: `response-${r.id}`,
                  at: r.recordedAt,
                  title:
                    o.definition.steps.find((step) => step.id === r.stepId)?.label ??
                    "Removed step",
                  detail: `${typeof r.value === "boolean" ? (r.value ? "Done" : "Unchecked") : r.value || "No answer"}${r.submitted ? "" : " (draft)"}`,
                  state: r.submitted ? "Answer saved" : "Draft saved",
                })),
                ...o.actions.map((a) => ({
                  id: `action-${a.id}`,
                  at: a.recordedAt,
                  title: {
                    snooze_pressed: "Snooze opened",
                    snooze_confirmed: "Snooze confirmed",
                    snooze_cancelled: "Snooze cancelled",
                    skip_pressed: "Skip opened",
                    skip_applied: "Ritual skipped",
                    complete_applied: "Ritual completed",
                  }[a.kind],
                  detail: `${a.outcome === "pending" ? "Pending" : a.outcome === "rejected" ? "Not applied" : "Recorded"}`,
                  state: "Ritual action",
                })),
              ]
                .sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
                .map((event) => (
                  <li key={event.id} className="flex min-w-0 gap-3">
                    <span
                      className="mt-1.5 size-2 shrink-0 rounded-full bg-border"
                      aria-hidden="true"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-4">
                        <span className="text-xs text-muted-foreground">{event.state}</span>
                        <time
                          dateTime={event.at}
                          title={new Date(event.at).toLocaleString(undefined, {
                            timeZone: o.timeZone,
                          })}
                          className="shrink-0 text-xs tabular-nums text-muted-foreground"
                        >
                          {new Date(event.at).toLocaleString(undefined, {
                            timeZone: o.timeZone,
                            month: "short",
                            day: "numeric",
                            hour: "numeric",
                            minute: "2-digit",
                            second: "2-digit",
                          })}
                        </time>
                      </div>
                      <p className="whitespace-pre-wrap break-words">
                        <span className="font-medium">{event.title}:</span> {event.detail}
                      </p>
                    </div>
                  </li>
                ))}
            </ol>
          </CollapsibleContent>
        </Collapsible>
      ) : null}
    </div>
  );
}
