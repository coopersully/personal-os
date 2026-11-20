import type {
  DailyBrief,
  RitualActionInput,
  RitualActionResult,
  RitualResponseInput,
  RitualState,
  WeatherSnapshot,
} from "@personal-os/domain";
import { QueryFeedback } from "../../components/async-state.js";
import { MinimizeIcon } from "../../components/icons.js";
import { Button } from "../../components/ui/button.js";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../components/ui/card.js";
import { Skeleton } from "../../components/ui/skeleton.js";
import { RitualBreathing } from "./ritual-breathing.js";
import { RitualChecklist } from "./ritual-overlay.js";
import { ritualClock, ritualTargetLine } from "./ritual-ready-card.js";
import { ritualCommitments, ritualEvents } from "./ritual-today.js";

type Read<T> = {
  data: T | undefined;
  isPending: boolean;
  isError: boolean;
  error: unknown;
  refetch: () => unknown;
};

function TodayList({
  title,
  empty,
  brief,
  rows,
}: {
  title: string;
  empty: string;
  brief: Read<DailyBrief>;
  rows: { id: string; title: string; detail: string }[] | undefined;
}) {
  return (
    <Card size="sm" className="min-h-0">
      <CardHeader>
        <CardTitle>
          <h3>{title}</h3>
        </CardTitle>
        {rows ? (
          <CardDescription>{rows.length ? `${rows.length} today` : empty}</CardDescription>
        ) : null}
      </CardHeader>
      {rows?.length ? (
        <CardContent className="min-h-0 overflow-y-auto">
          <ul className="flex flex-col gap-2">
            {rows.map((row) => (
              <li key={row.id} className="flex items-baseline justify-between gap-3 text-sm">
                <span className="min-w-0 truncate">{row.title}</span>
                <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                  {row.detail}
                </span>
              </li>
            ))}
          </ul>
        </CardContent>
      ) : !rows ? (
        <CardContent>
          {brief.isPending ? (
            <Skeleton className="h-4 w-2/3" />
          ) : (
            <Button variant="secondary" size="sm" onClick={() => void brief.refetch()}>
              Try again
            </Button>
          )}
        </CardContent>
      ) : null}
    </Card>
  );
}

/** The opened ritual: today's facts beside the person's own steps, over the full sky. */
export function RitualDashboard({
  state,
  now,
  brief,
  weather,
  onMinimize,
  saveResponse,
  act,
}: {
  state: RitualState;
  now: number;
  brief: Read<DailyBrief>;
  weather: WeatherSnapshot | undefined;
  onMinimize: () => void;
  saveResponse: (stepId: string, input: RitualResponseInput) => Promise<RitualState>;
  act: (input: RitualActionInput) => Promise<RitualActionResult>;
}) {
  const occurrence = state.current!;
  const { timeZone } = occurrence;
  const target = ritualTargetLine(occurrence, now);
  const events = brief.data
    ? ritualEvents(brief.data).map((event) => ({
        id: event.id,
        title: event.title,
        detail: event.allDay ? "All day" : ritualClock(event.startsAt, timeZone),
      }))
    : undefined;
  const commitments = brief.data
    ? ritualCommitments(brief.data, now).map((item) => ({
        id: `${item.kind}:${item.id}`,
        title: item.title,
        detail: item.overdue ? "Overdue" : item.dueAt ? ritualClock(item.dueAt, timeZone) : "Today",
      }))
    : undefined;
  return (
    <div className="ritual-dashboard">
      <QueryFeedback query={brief} title="Couldn’t load today’s schedule and tasks." toastOnly />
      <header className="ritual-dashboard__header">
        <div className="flex min-w-0 flex-col gap-1">
          <p className="text-4xl font-semibold tabular-nums">{ritualClock(now, timeZone)}</p>
          <p className="text-sm">
            {new Date(now).toLocaleDateString(undefined, {
              timeZone,
              weekday: "long",
              month: "long",
              day: "numeric",
            })}
            {target ? ` · ${target}` : ""}
          </p>
          {weather ? (
            <p className="text-sm">
              {weather.location.shortLabel} · {Math.round(weather.temperatureF)}° ·{" "}
              {weather.condition}
            </p>
          ) : null}
        </div>
        <Button variant="secondary" onClick={onMinimize}>
          <MinimizeIcon data-icon="inline-start" aria-hidden="true" />
          Minimize
        </Button>
      </header>
      <div className="ritual-dashboard__body">
        <section aria-label="Today" className="ritual-dashboard__today">
          {occurrence.definition.kind === "morning" ? <RitualBreathing /> : null}
          <TodayList
            title="Schedule"
            empty="Nothing else scheduled today"
            brief={brief}
            rows={events}
          />
          <TodayList
            title="Tasks and reminders"
            empty="Nothing due today"
            brief={brief}
            rows={commitments}
          />
        </section>
        <section aria-label="Ritual" className="ritual-dashboard__ritual">
          <RitualChecklist
            key={occurrence.id}
            panel
            state={state}
            saveResponse={saveResponse}
            act={act}
          />
        </section>
      </div>
    </div>
  );
}
