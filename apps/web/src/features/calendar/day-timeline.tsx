import type { CalendarEvent, LocalDate } from "@personal-os/domain";
import { localDateAt, sameLocalDate } from "@personal-os/domain";
import type { CSSProperties, ReactNode } from "react";
import { minuteToTimelinePixels } from "@/calendar-timeline";

export type TimelinePositionable = {
  allDay: boolean;
  endsAt: string;
  id: string;
  startsAt: string;
};

export type TimelineEventLayout<T extends TimelinePositionable = CalendarEvent> = {
  column: number;
  columns: number;
  endMinute: number;
  event: T;
  startMinute: number;
};

// A timeline formats many timestamps in one owner timezone. Keep one formatter
// pair rather than rebuilding ICU formatters for every event on every render.
let timelineFormatters:
  | { timeZone: string; parts: Intl.DateTimeFormat; clock: Intl.DateTimeFormat }
  | undefined;
function formattersFor(timeZone: string) {
  if (timelineFormatters?.timeZone !== timeZone) {
    timelineFormatters = {
      timeZone,
      parts: new Intl.DateTimeFormat("en", {
        day: "numeric",
        hour: "numeric",
        hourCycle: "h23",
        minute: "numeric",
        month: "numeric",
        second: "numeric",
        timeZone,
        year: "numeric",
      }),
      clock: new Intl.DateTimeFormat("en", { hour: "numeric", minute: "2-digit", timeZone }),
    };
  }
  return timelineFormatters;
}

export function localDateTimeAt(value: Date | string, timeZone: string) {
  const values = Object.fromEntries(
    formattersFor(timeZone)
      .parts.formatToParts(new Date(value))
      .map((part) => [part.type, part.value]),
  );
  return {
    date: {
      day: Number(values.day),
      month: Number(values.month),
      year: Number(values.year),
    } satisfies LocalDate,
    minute: Number(values.hour) * 60 + Number(values.minute) + Number(values.second) / 60,
  };
}

export function positionTimelineEvents<T extends TimelinePositionable>(
  events: T[],
  day: LocalDate,
  timeZone: string,
): TimelineEventLayout<T>[] {
  const intervals = events
    .filter((event) => !event.allDay)
    .map((event) => {
      const start = localDateTimeAt(event.startsAt, timeZone);
      const end = localDateTimeAt(event.endsAt, timeZone);
      const startMinute = sameLocalDate(start.date, day) ? start.minute : 0;
      const endMinute = sameLocalDate(end.date, day) ? end.minute : 1440;
      // Only repeated-hour events whose wall-clock end is not later need elapsed time.
      const minimumMinutes =
        sameLocalDate(start.date, day) && sameLocalDate(end.date, day) && end.minute <= start.minute
          ? Math.max(
              15,
              (new Date(event.endsAt).getTime() - new Date(event.startsAt).getTime()) / 60_000,
            )
          : 15;
      return {
        endMinute: Math.min(1440, Math.max(endMinute, startMinute + minimumMinutes)),
        event,
        startMinute: Math.max(0, startMinute),
      };
    })
    .sort(
      (left, right) =>
        left.startMinute - right.startMinute ||
        left.endMinute - right.endMinute ||
        left.event.id.localeCompare(right.event.id),
    );
  const result: TimelineEventLayout<T>[] = [];
  let cluster: Array<TimelineEventLayout<T>> = [];
  let clusterEnd = -1;
  let laneEnds: number[] = [];
  const flush = () => {
    for (const layout of cluster) result.push({ ...layout, columns: laneEnds.length });
    cluster = [];
    laneEnds = [];
  };
  for (const interval of intervals) {
    if (interval.startMinute >= clusterEnd) flush();
    let column = laneEnds.findIndex((end) => end <= interval.startMinute);
    if (column < 0) column = laneEnds.length;
    laneEnds[column] = interval.endMinute;
    cluster.push({ ...interval, column, columns: 0 });
    clusterEnd = Math.max(cluster.length === 1 ? -1 : clusterEnd, interval.endMinute);
  }
  flush();
  return result;
}

function formatHour(hour: number): string {
  if (hour === 0) return "12 AM";
  if (hour === 12) return "12 PM";
  return hour < 12 ? `${hour} AM` : `${hour - 12} PM`;
}

export function formatTimelineClock(value: string, timeZone: string) {
  return formattersFor(timeZone).clock.format(new Date(value));
}
export type TodayTimelineDensity = "compact" | "full" | "short";

export function todayTimelineStartMinute(currentMinute: number): number {
  return Math.floor(currentMinute / 15) * 15;
}

export function todayTimelineItemRange(startMinute: number, endMinute: number) {
  const start = Math.floor(startMinute / 15) * 15;
  const end = Math.max(start + 15, Math.ceil(endMinute / 15) * 15);
  return { end, start };
}

export function todayTimelineDensity(durationMinutes: number): TodayTimelineDensity {
  if (durationMinutes <= 15) return "compact";
  if (durationMinutes <= 30) return "short";
  return "full";
}

/** Shared Calendar/Today axis; marks and scale must change together. */
export function TimelineAxis({
  startMinute = 0,
  endMinute = 1440,
}: {
  startMinute?: number;
  endMinute?: number;
}) {
  const first = Math.ceil(startMinute / 30) * 30;
  const marks = Array.from(
    { length: Math.max(0, Math.ceil((endMinute - first) / 30)) },
    (_, i) => first + i * 30,
  );
  return (
    <ol
      aria-hidden="true"
      data-calendar-axis="left"
      className="calendar-time-axis"
      style={{ height: minuteToTimelinePixels(endMinute - startMinute) }}
    >
      {marks.map((minute) => (
        <li
          key={minute}
          data-major={minute % 60 === 0}
          style={{ top: minuteToTimelinePixels(minute - startMinute) }}
        >
          {minute % 60
            ? `${formatHour(Math.floor(minute / 60)).split(" ")[0]}:30 ${minute < 720 ? "AM" : "PM"}`
            : formatHour(Math.floor(minute / 60) % 24)}
        </li>
      ))}
    </ol>
  );
}

export function timelineLaneStyle(column: number, columns: number) {
  return {
    left: `calc(${(column / columns) * 100}% + 3px)`,
    width: `calc(${100 / columns}% - 6px)`,
  };
}

/** Today is a clipped Calendar day grid, using the same axis, scale and event layout. */
export function DayTimeline<T extends TimelinePositionable>({
  currentTime,
  items,
  renderItem,
  timeZone,
  preview = false,
}: {
  currentTime: Date;
  items: T[];
  renderItem: (
    item: T,
    style: CSSProperties,
    density: TodayTimelineDensity,
    layout: TimelineEventLayout<T>,
    startMinute: number,
  ) => ReactNode;
  timeZone: string;
  preview?: boolean;
}) {
  const currentMinute = localDateTimeAt(currentTime, timeZone).minute;
  const positioned = positionTimelineEvents(items, localDateAt(currentTime, timeZone), timeZone);
  const startMinute =
    preview && positioned.length > 0
      ? Math.min(...positioned.map((layout) => layout.startMinute))
      : todayTimelineStartMinute(currentMinute);
  const layouts = positioned.filter((layout) => layout.endMinute > startMinute);
  const endMinute = Math.max(startMinute + 60, ...layouts.map((layout) => layout.endMinute));
  const height = minuteToTimelinePixels(endMinute - startMinute);
  return (
    // biome-ignore lint/a11y/useSemanticElements: Decorative axis and grid interleave event list items.
    <div
      className="calendar-time-grid calendar-time-grid--day today-calendar-grid"
      role="list"
      style={{ height }}
    >
      <TimelineAxis startMinute={startMinute} endMinute={endMinute} />
      <div
        className="calendar-timeline"
        style={{ height, backgroundPositionY: `${-minuteToTimelinePixels(startMinute)}px` }}
      >
        <div
          role="timer"
          aria-label={`Current time ${formatTimelineClock(currentTime.toISOString(), timeZone)}`}
          className="calendar-now-line"
          style={{ top: minuteToTimelinePixels(currentMinute - startMinute) }}
        >
          <span>{formatTimelineClock(currentTime.toISOString(), timeZone)}</span>
          <i />
        </div>
        {layouts.map((layout) => {
          const start = Math.max(startMinute, layout.startMinute);
          const style = {
            ...timelineLaneStyle(layout.column, layout.columns),
            top: minuteToTimelinePixels(start - startMinute),
            height: Math.max(18, minuteToTimelinePixels(layout.endMinute - start)),
            position: "absolute",
          } satisfies CSSProperties;
          return renderItem(
            layout.event,
            style,
            todayTimelineDensity(layout.endMinute - start),
            { ...layout, startMinute: start },
            startMinute,
          );
        })}
      </div>
    </div>
  );
}
