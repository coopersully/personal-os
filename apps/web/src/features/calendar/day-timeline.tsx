import type { CalendarEvent, LocalDate } from "@personal-os/domain";
import { localDateAt, sameLocalDate } from "@personal-os/domain";
import type { CSSProperties, ReactNode } from "react";

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

export function localDateTimeAt(value: Date | string, timeZone: string) {
  const values = Object.fromEntries(
    new Intl.DateTimeFormat("en", {
      day: "numeric",
      hour: "numeric",
      hourCycle: "h23",
      minute: "numeric",
      month: "numeric",
      second: "numeric",
      timeZone,
      year: "numeric",
    })
      .formatToParts(new Date(value))
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
      const elapsedMinutes = Math.max(
        15,
        (new Date(event.endsAt).getTime() - new Date(event.startsAt).getTime()) / 60_000,
      );
      return {
        endMinute: Math.min(1440, Math.max(endMinute, startMinute + elapsedMinutes)),
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
  // Only simultaneous starts share horizontal lanes. Later starts paint above
  // earlier events while retaining their actual time and duration geometry.
  const simultaneous = new Map<number, typeof intervals>();
  for (const interval of intervals) {
    const start = new Date(interval.event.startsAt).getTime();
    const group = simultaneous.get(start) ?? [];
    group.push(interval);
    simultaneous.set(start, group);
  }
  return intervals.map((interval) => {
    const group = simultaneous.get(new Date(interval.event.startsAt).getTime()) as typeof intervals;
    return { ...interval, column: group.indexOf(interval), columns: group.length };
  });
}

function formatHour(hour: number): string {
  if (hour === 0) return "12 AM";
  if (hour === 12) return "12 PM";
  return hour < 12 ? `${hour} AM` : `${hour - 12} PM`;
}

function formatTime(value: string, timeZone: string) {
  return new Intl.DateTimeFormat("en", { hour: "numeric", minute: "2-digit", timeZone }).format(
    new Date(value),
  );
}
const todayTimelinePixelsPerMinute = 1.5;
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

export function DayTimeline<T extends TimelinePositionable>({
  currentTime,
  items,
  renderItem,
  timeZone,
}: {
  currentTime: Date;
  items: T[];
  renderItem: (item: T, style: CSSProperties, density: TodayTimelineDensity) => ReactNode;
  timeZone: string;
}) {
  const day = localDateAt(currentTime, timeZone);
  const currentMinute = localDateTimeAt(currentTime, timeZone).minute;
  const startMinute = todayTimelineStartMinute(currentMinute);
  const layouts = positionTimelineEvents(items, day, timeZone);
  const endMinute = Math.max(
    startMinute,
    ...layouts.map((layout) => todayTimelineItemRange(layout.startMinute, layout.endMinute).end),
  );
  const height = Math.max(
    15 * todayTimelinePixelsPerMinute,
    (endMinute - startMinute) * todayTimelinePixelsPerMinute,
  );
  const firstHourMinute = Math.ceil(startMinute / 60) * 60;
  const hourTicks =
    firstHourMinute > endMinute
      ? []
      : Array.from(
          { length: Math.floor((endMinute - firstHourMinute) / 60) + 1 },
          (_, index) => firstHourMinute + index * 60,
        );
  const minorTicks = Array.from(
    { length: Math.floor((endMinute - startMinute) / 15) + 1 },
    (_, index) => startMinute + index * 15,
  ).filter((minute) => minute % 60 !== 0);
  const gridTicks = Array.from(
    { length: Math.floor((endMinute - startMinute) / 15) + 1 },
    (_, index) => startMinute + index * 15,
  );

  return (
    // biome-ignore lint/a11y/useSemanticElements: The timeline interleaves its decorative time axis with event list items.
    <div className="today-timeline" role="list" style={{ height }}>
      <div aria-hidden="true" className="today-timeline__axis">
        <span className="today-timeline__line" />
        {hourTicks.map((minute) => (
          <span
            className="today-timeline__tick"
            key={minute}
            style={{ top: (minute - startMinute) * todayTimelinePixelsPerMinute }}
          >
            <span>{formatHour(Math.floor(minute / 60) % 24)}</span>
            <i />
          </span>
        ))}
        {minorTicks.map((minute) => (
          <i
            className="today-timeline__minor-tick"
            data-half-hour={minute % 60 === 30 ? "true" : "false"}
            data-slot="today-timeline-minor-tick"
            key={minute}
            style={{ top: (minute - startMinute) * todayTimelinePixelsPerMinute }}
          />
        ))}
        {endMinute % 15 === 0 ? null : <i className="today-timeline__end-cap" />}
      </div>
      <div
        aria-label={`Current time ${formatTime(currentTime.toISOString(), timeZone)}`}
        className="calendar-now-line today-timeline__now"
        role="timer"
        style={{ top: (currentMinute - startMinute) * todayTimelinePixelsPerMinute }}
      >
        <span>{formatTime(currentTime.toISOString(), timeZone)}</span>
        <i />
      </div>
      <div className="today-timeline__track">
        <div aria-hidden="true" className="today-timeline__grid">
          {gridTicks.map((minute) => (
            <i
              data-half-hour={minute % 60 === 30 ? "true" : "false"}
              data-major={minute % 60 === 0 ? "true" : "false"}
              data-slot="today-timeline-grid-line"
              key={minute}
              style={{ top: (minute - startMinute) * todayTimelinePixelsPerMinute }}
            />
          ))}
        </div>
        {layouts.map((layout) => {
          const snappedRange = todayTimelineItemRange(layout.startMinute, layout.endMinute);
          const visibleStartMinute = Math.max(startMinute, snappedRange.start);
          const visibleEndMinute = Math.max(visibleStartMinute + 15, snappedRange.end);
          const visibleDurationMinutes = visibleEndMinute - visibleStartMinute;
          const columnGap = 8;
          const layoutStyle = {
            height: visibleDurationMinutes * todayTimelinePixelsPerMinute,
            left: `calc(${(layout.column / layout.columns) * 100}% + ${layout.column === 0 ? 0 : columnGap / 2}px)`,
            top: (visibleStartMinute - startMinute) * todayTimelinePixelsPerMinute,
            width: `calc(${100 / layout.columns}% - ${layout.columns === 1 ? 0 : columnGap / 2}px)`,
          } satisfies CSSProperties;
          return renderItem(
            layout.event,
            layoutStyle,
            todayTimelineDensity(visibleDurationMinutes),
          );
        })}
      </div>
    </div>
  );
}
