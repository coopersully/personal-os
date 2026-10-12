import {
  addLocalDays,
  localDateToIso,
  type Reminder,
  type Task,
  type TodayPreferences,
} from "@personal-os/domain";
import { useQuery } from "@tanstack/react-query";
import { type ReactNode, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { api } from "@/api";
import { SegmentedControl, SegmentedControlItem } from "@/components/segmented-control";
import { Button } from "@/components/ui/button";
import { useWorkspacePreferences } from "@/features/workspace-settings/preferences";
import { useSaveTodayPreferences, useTodayPreferences } from "./preferences";

export function TodayCommitments({
  day,
  renderTask,
  renderReminder,
}: {
  day: string;
  renderTask: (task: Task) => ReactNode;
  renderReminder: (reminder: Reminder) => ReactNode;
}) {
  const preferences = useTodayPreferences();
  const save = useSaveTodayPreferences();
  const filter = preferences.data?.preferences.commitmentFilter ?? "all";
  const includeUndated = preferences.data?.preferences.includeUndated ?? false;
  const calendar = useWorkspacePreferences("calendar");
  const scopeDay = `${day}:${calendar.data?.preferences.weekStartsOn ?? "sunday"}`;
  const counts = useQuery({
    queryKey: ["today-commitments", scopeDay, filter, includeUndated, undefined],
    queryFn: () => api.getTodayCommitments({ filter, includeUndated, limit: 6 }),
    refetchInterval: 60000,
  });
  return (
    <div className="today-commitments">
      <SegmentedControl
        aria-label="Commitment filters"
        value={filter}
        onValueChange={(value) => {
          if (value)
            save.mutate({ commitmentFilter: value as TodayPreferences["commitmentFilter"] });
        }}
      >
        {(
          [
            ["all", "All"],
            ["overdue", "Overdue"],
            ["tasks", "Tasks"],
            ["reminders", "Reminders"],
          ] as const
        ).map(([value, label]) => (
          <SegmentedControlItem
            key={value}
            value={value}
            disabled={!preferences.data || !!save.recovery}
          >
            {label} {counts.data?.counts[value] ?? "–"}
          </SegmentedControlItem>
        ))}
      </SegmentedControl>
      {save.recovery ? <Link to="/today/settings">Review unsaved preferences</Link> : null}
      <CommitmentPage
        key={`${scopeDay}:${filter}:${includeUndated}`}
        filter={filter}
        includeUndated={includeUndated}
        day={scopeDay}
        renderTask={renderTask}
        renderReminder={renderReminder}
      />
    </div>
  );
}
function CommitmentPage({
  filter,
  includeUndated,
  day,
  renderTask,
  renderReminder,
}: {
  filter: TodayPreferences["commitmentFilter"];
  includeUndated: boolean;
  day: string;
  renderTask: (task: Task) => ReactNode;
  renderReminder: (reminder: Reminder) => ReactNode;
}) {
  const [cursors, setCursors] = useState<Array<string | undefined>>([undefined]);
  const cursor = cursors.at(-1);
  const query = useQuery({
    queryKey: ["today-commitments", day, filter, includeUndated, cursor],
    queryFn: () =>
      api.getTodayCommitments({ filter, includeUndated, limit: 6, ...(cursor ? { cursor } : {}) }),
    refetchInterval: cursor ? false : 60000,
  });
  useEffect(() => {
    if (cursor && query.isSuccess && !query.isFetching && query.data.items.length === 0) {
      setCursors((value) => (value.length > 1 ? value.slice(0, -1) : value));
    }
  }, [cursor, query.isSuccess, query.isFetching, query.data]);
  const labels = {
    overdue: "Overdue",
    today: "Today",
    later_this_week: "Later this week",
    undated: "Undated",
  };
  if (!query.data)
    return (
      <div className="min-h-48" aria-busy={query.isPending}>
        {query.isError ? (
          <Button
            variant="outline"
            onClick={() => {
              setCursors([undefined]);
              toast.promise(
                query.refetch().then((result) => {
                  if (result.isError) throw result.error;
                }),
                {
                  loading: "Refreshing commitments…",
                  success: "Commitments refreshed.",
                  error: "Could not refresh commitments.",
                },
              );
            }}
          >
            Retry commitments
          </Button>
        ) : (
          <span className="text-muted-foreground">Loading commitments…</span>
        )}
      </div>
    );
  return (
    <>
      <p className="text-sm text-muted-foreground">
        {weekLabel(query.data.weekStart, query.data.weekEndExclusive)} ·{" "}
        {query.data.counts[filter] ?? "Unknown"} {filter === "all" ? "commitments" : filter}
      </p>
      {query.isError || query.data.unavailableSources.length ? (
        <p className="text-sm text-muted-foreground">
          Some commitments could not be refreshed.{" "}
          <Button
            variant="link"
            onClick={() => {
              setCursors([undefined]);
              toast.promise(
                query.refetch().then((result) => {
                  if (result.isError) throw result.error;
                }),
                {
                  loading: "Refreshing commitments…",
                  success: "Commitments refreshed.",
                  error: "Could not refresh commitments.",
                },
              );
            }}
          >
            Refresh
          </Button>
        </p>
      ) : null}
      {query.data.items.length ? (
        <div>
          {query.data.items.map((item, index) => (
            <div key={`${item.kind}:${item.material.id}`}>
              {index === 0 || query.data.items[index - 1]?.group !== item.group ? (
                <h3 className="mb-2 mt-4 text-sm font-medium">{labels[item.group]}</h3>
              ) : null}
              {item.kind === "task" ? renderTask(item.material) : renderReminder(item.material)}
            </div>
          ))}
        </div>
      ) : (
        <p className="py-8 text-muted-foreground">Nothing in this view.</p>
      )}
      <div className="flex items-center justify-between gap-2">
        <Button
          variant="outline"
          disabled={cursors.length === 1}
          onClick={() => setCursors((value) => value.slice(0, -1))}
        >
          Previous
        </Button>
        <span className="text-sm">Page {cursors.length}</span>
        <Button
          variant="outline"
          disabled={!query.data.nextCursor}
          onClick={() => setCursors((value) => [...value, query.data!.nextCursor!])}
        >
          Next
        </Button>
      </div>
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
