import {
  latestRitualResponses,
  localDateAt,
  localDateToIso,
  type RitualOccurrence,
  ritualAnswerIsValid,
  unfinishedOptionalRitualSteps,
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
import { useState } from "react";
import { ChevronLeftIcon, ChevronRightIcon, SearchIcon } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Pagination, PaginationContent, PaginationItem } from "@/components/ui/pagination";
import { api } from "../../api.js";
import { QueryFeedback } from "../../components/async-state.js";
import { Button } from "../../components/ui/button.js";
import { SettingsSection } from "../settings/settings-layout";

const pageSize = 10;
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
function completion(o: RitualOccurrence) {
  const answers = latestRitualResponses(o);
  return o.definition.steps.filter((step) => {
    const answer = answers[step.id];
    return answer?.submitted && ritualAnswerIsValid(step, answer.value);
  }).length;
}
function HistoryChoice({
  label,
  value,
  choices,
  onChange,
}: {
  label: string;
  value: string;
  choices: [string, string][];
  onChange: (value: string) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="secondary"
          size="sm"
          aria-label={`${label}: ${choices.find(([key]) => key === value)?.[1]}`}
        >
          {choices.find(([key]) => key === value)?.[1]}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuRadioGroup value={value} onValueChange={onChange}>
          {choices.map(([key, text]) => (
            <DropdownMenuRadioItem key={key} value={key}>
              {text}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function RitualHistory() {
  const [kind, setKind] = useState("");
  const [period, setPeriod] = useState("week");
  const [offset, setOffset] = useState(0);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [sort, setSort] = useState("newest");
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<RitualOccurrence | null>(null);
  const profile = useQuery({ queryKey: ["me"], queryFn: api.getMe, staleTime: 60_000 });
  const today = new Date(
    `${localDateToIso(localDateAt(new Date(), profile.data?.planningTimezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone))}T12:00:00`,
  );
  const anchor = period === "week" ? addWeeks(today, offset) : addMonths(today, offset);
  const from = period === "week" ? startOfWeek(anchor, { weekStartsOn: 1 }) : startOfMonth(anchor);
  const to = period === "week" ? endOfWeek(anchor, { weekStartsOn: 1 }) : endOfMonth(anchor);
  const filters = {
    ...(kind ? { kind } : {}),
    dateFrom: format(from, "yyyy-MM-dd"),
    dateTo: format(to, "yyyy-MM-dd"),
  };
  const history = useQuery({
    queryKey: ["ritual-history", filters],
    queryFn: async ({ signal }) => {
      // Resolve the bounded week/month before local search/sort so matches
      // are not limited to the first cursor page.
      const items = new Map<string, RitualOccurrence>();
      const cursors = new Set<string>();
      let cursor: string | undefined;
      do {
        signal.throwIfAborted();
        const result = await api.listRitualHistory(cursor, filters);
        signal.throwIfAborted();
        for (const item of result.items) items.set(item.id, item);
        cursor = result.nextCursor ?? undefined;
        if (cursor && cursors.has(cursor)) throw new Error("History pagination did not advance");
        if (cursor) cursors.add(cursor);
      } while (cursor);
      return [...items.values()];
    },
  });
  const query = search.trim().toLocaleLowerCase();
  const entries = (history.data ?? [])
    .filter(
      (o) =>
        (!status || o.status === status) &&
        (!query ||
          [
            ritualLabel(o),
            o.definition.title,
            o.scheduledLocalDate,
            statusLabel(o.status),
            ...o.definition.steps.map((s) => s.label),
            ...o.responses.map((r) => String(r.value)),
          ]
            .join(" ")
            .toLocaleLowerCase()
            .includes(query)),
    )
    .sort((a, b) => {
      const order = a.dueAt.localeCompare(b.dueAt) || a.id.localeCompare(b.id);
      return sort === "oldest" ? order : -order;
    });
  const lastPage = Math.max(0, Math.ceil(entries.length / pageSize) - 1);
  const currentPage = Math.min(page, lastPage);
  const visible = entries.slice(currentPage * pageSize, (currentPage + 1) * pageSize);
  function changePeriod(value: string) {
    setPeriod(value);
    setOffset(0);
    setPage(0);
  }
  function movePeriod(delta: number) {
    setOffset((value) => value + delta);
    setPage(0);
  }
  return (
    <section className="flex flex-col gap-4" aria-label="Ritual history">
      <search className="flex flex-col gap-2" aria-label="Search ritual history">
        <InputGroup>
          <InputGroupAddon>
            <SearchIcon aria-hidden="true" />
          </InputGroupAddon>
          <InputGroupInput
            aria-label="Search history"
            placeholder="Search rituals, questions, or answers in this period…"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(0);
            }}
          />
        </InputGroup>
        <div className="flex flex-wrap items-center gap-2">
          <HistoryChoice
            label="Period"
            value={period}
            choices={[
              ["week", offset === 0 ? "This Week" : "Week"],
              ["month", offset === 0 ? "This Month" : "Month"],
            ]}
            onChange={changePeriod}
          />
          <HistoryChoice
            label="Ritual"
            value={kind}
            choices={[
              ["", "Both Rituals"],
              ["morning", "Morning"],
              ["night", "Evening"],
            ]}
            onChange={(value) => {
              setKind(value);
              setPage(0);
            }}
          />
          <HistoryChoice
            label="Status"
            value={status}
            choices={[
              ["", "All Statuses"],
              ["completed", "Completed"],
              ["skipped", "Skipped"],
              ["missed", "Missed"],
              ["pending", "In Progress"],
              ["cancelled_configuration", "Cancelled"],
            ]}
            onChange={(value) => {
              setStatus(value);
              setPage(0);
            }}
          />
          <div className="ml-auto">
            <HistoryChoice
              label="Sort"
              value={sort}
              choices={[
                ["newest", "Newest First"],
                ["oldest", "Oldest First"],
              ]}
              onChange={(value) => {
                setSort(value);
                setPage(0);
              }}
            />
          </div>
        </div>
      </search>
      <SettingsSection
        layout="rows"
        title={`${format(from, "MMM d")} – ${format(to, "MMM d, yyyy")}`}
        action={
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
        }
      >
        {history.isPending ? (
          <p className="p-4 text-sm text-muted-foreground">Loading history…</p>
        ) : null}
        <QueryFeedback query={history} title="Couldn’t load ritual history." />
        {visible.map((o) => (
          <Button
            key={o.id}
            variant="ghost"
            className="settings-navigation-row h-auto w-full justify-between gap-4 rounded-none text-left font-normal"
            onClick={() => setSelected(o)}
          >
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="truncate font-medium">{ritualLabel(o)}</span>
              <span className="truncate text-xs text-muted-foreground">
                {format(new Date(`${o.scheduledLocalDate}T12:00:00`), "EEE, MMM d")} ·{" "}
                {completion(o)}/{o.definition.steps.length} steps done
              </span>
            </span>
            <span className="flex shrink-0 items-center gap-2">
              <Badge variant="secondary">{statusLabel(o.status)}</Badge>
              <ChevronRightIcon className="size-4 text-muted-foreground" />
            </span>
          </Button>
        ))}
        {!history.isPending && !history.isError && !entries.length ? (
          <div className="flex flex-col gap-1 p-6 text-center">
            <p className="text-sm font-medium">
              {search || status ? "No matching rituals" : "No rituals in this period"}
            </p>
            <p className="text-sm text-muted-foreground">
              {search || status
                ? "Try another search or status filter."
                : "Choose a previous week or month to see earlier rituals."}
            </p>
          </div>
        ) : null}
      </SettingsSection>
      {entries.length ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">
            {currentPage * pageSize + 1}–{Math.min((currentPage + 1) * pageSize, entries.length)} of{" "}
            {entries.length} rituals
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
                    {currentPage + 1} / {lastPage + 1}
                  </span>
                </PaginationItem>
                <PaginationItem>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={currentPage === lastPage}
                    onClick={() => setPage(currentPage + 1)}
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
  return (
    <div className="flex max-h-[60dvh] flex-col gap-2 overflow-y-auto text-sm">
      <p>
        Due{" "}
        {new Date(o.dueAt).toLocaleString(undefined, {
          timeZone: o.timeZone,
          timeZoneName: "short",
        })}
      </p>
      <h3 className="mt-2 font-medium">Answers</h3>
      {!o.responses.length ? <p className="text-muted-foreground">No answers recorded.</p> : null}
      {o.responses.map((r) => (
        <div key={r.id} className="flex flex-col gap-0.5 pb-2">
          <p>
            {o.definition.steps.find((s) => s.id === r.stepId)?.label}:{" "}
            {typeof r.value === "boolean" ? (r.value ? "Done" : "Unchecked") : r.value}{" "}
            {r.submitted ? "" : "(draft)"}
          </p>
          <time className="text-xs text-muted-foreground" dateTime={r.recordedAt}>
            {new Date(r.recordedAt).toLocaleString(undefined, {
              timeZone: o.timeZone,
              timeZoneName: "short",
            })}
          </time>
        </div>
      ))}
      {o.status === "completed"
        ? unfinishedOptionalRitualSteps(o).map((step) => (
            <p key={`optional-${step.id}`}>
              {step.label}: Optional ·{" "}
              {o.optionalFollowUp?.stepIds.includes(step.id)
                ? `Reminder ${o.optionalFollowUp.reminderIds ? "scheduled" : "waiting to sync"} · ${new Date(o.optionalFollowUp.dueAt).toLocaleString(undefined, { timeZone: o.timeZone, timeZoneName: "short" })}`
                : "Not done"}
            </p>
          ))
        : null}
      {o.actions.length ? <h3 className="mt-2 font-medium">Activity</h3> : null}
      {o.actions.map((a) => (
        <div key={a.id} className="flex items-start justify-between gap-4 py-1">
          <p className="capitalize">
            {a.kind.replaceAll("_", " ")}{" "}
            <span className="text-muted-foreground">· {a.outcome}</span>
          </p>
          <time className="shrink-0 text-xs text-muted-foreground" dateTime={a.recordedAt}>
            {new Date(a.recordedAt).toLocaleTimeString(undefined, {
              timeZone: o.timeZone,
              hour: "numeric",
              minute: "2-digit",
            })}
          </time>
        </div>
      ))}
    </div>
  );
}
