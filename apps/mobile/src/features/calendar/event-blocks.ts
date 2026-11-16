import type {
  Calendar,
  CalendarEvent,
  CalendarEventBlock,
  EventBlockMode,
} from "@personal-os/domain";
import { sameLocalDate } from "@personal-os/domain";
import { allDaySpan } from "./logic";

export const blockModeLabels: Record<EventBlockMode, string> = {
  busy: "Busy",
  details: "Details",
};

/** A calendar an event's time can be blocked on, with the linked copies already there. */
export type BlockTarget = {
  calendar: Calendar;
  blocks: CalendarEventBlock[];
  /** How the block reads on that calendar; null when the time is not blocked there. */
  mode: EventBlockMode | null;
};

/** Records cached before blocks were read carry none. */
const blocksOf = (event: CalendarEvent) => event.blocks ?? [];

/** Only a real event blocks time; a block that follows another event is changed from its source. */
export function canBlockEvent(event: Pick<CalendarEvent, "blockSourceEventId">) {
  return !event.blockSourceEventId;
}

/**
 * Every writable calendar the event is not already on. The same occurrence can sit on several
 * calendars, so each may contribute its own linked copy to one destination.
 */
export function blockTargets(event: CalendarEvent, calendars: readonly Calendar[]): BlockTarget[] {
  const own = new Set(event.sourceCalendarIds ?? [event.calendarId]);
  return calendars
    .filter((calendar) => calendar.isWritable && !own.has(calendar.id))
    .map((calendar) => {
      const blocks = blocksOf(event).filter((block) => block.calendarId === calendar.id);
      return {
        calendar,
        blocks,
        mode: !blocks.length
          ? null
          : blocks.some((block) => block.mode === "details")
            ? "details"
            : "busy",
      };
    });
}

/** Where this event blocks time and how each block reads; null when it blocks nowhere. */
export function blockSummary(event: CalendarEvent, calendars: readonly Calendar[]) {
  const blocks = blocksOf(event);
  if (!blocks.length) return null;
  return blocks
    .map((block) => {
      const name = calendars.find((calendar) => calendar.id === block.calendarId)?.name;
      return `${name ?? "A disconnected calendar"} (${blockModeLabels[block.mode]})`;
    })
    .join(" · ");
}

/**
 * Whether an event takes part in conflict checks. This is the Calendar review's rule: timed,
 * busy, not cancelled, not a linked block, and not a repeating series (the API does not expand
 * occurrences).
 */
export function timeCanConflict(
  event: Pick<
    CalendarEvent,
    "allDay" | "status" | "transparency" | "recurrence" | "blockSourceEventId"
  >,
) {
  return (
    !event.allDay &&
    event.status !== "cancelled" &&
    (event.transparency ?? "busy") === "busy" &&
    !event.recurrence.length &&
    !event.blockSourceEventId
  );
}

/**
 * Whether a listed record is this event: the record itself, or the one record the list shows
 * for an occurrence that also sits on this event's calendar. The API exposes no occurrence
 * identity, so the other copy is recognised by its calendars, exact time and title.
 */
export function isSameOccurrence(listed: CalendarEvent, event: CalendarEvent) {
  return (
    listed.id === event.id ||
    (!listed.blockSourceEventId &&
      listed.title === event.title &&
      listed.startsAt === event.startsAt &&
      listed.endsAt === event.endsAt &&
      !!listed.sourceCalendarIds?.includes(event.calendarId))
  );
}

/** The events that overlap a span, earliest first. Ends are exclusive, so touching is not overlap. */
export function overlapping(
  span: { startsAt: string; endsAt: string },
  events: readonly CalendarEvent[],
  /** The event the span belongs to, which never conflicts with itself. */
  self?: CalendarEvent,
) {
  const from = new Date(span.startsAt).getTime();
  const to = new Date(span.endsAt).getTime();
  return events
    .filter(
      (event) =>
        !(self && isSameOccurrence(event, self)) &&
        timeCanConflict(event) &&
        new Date(event.startsAt).getTime() < to &&
        new Date(event.endsAt).getTime() > from,
    )
    .sort(
      (left, right) =>
        new Date(left.startsAt).getTime() - new Date(right.startsAt).getTime() ||
        left.id.localeCompare(right.id),
    );
}

/**
 * Whether an event on the destination calendar is what an earlier, unconfirmed block attempt
 * would have left behind: the same time under the block's title, with no link to its source.
 */
export function isUnlinkedCopy(
  found: CalendarEvent,
  source: CalendarEvent,
  calendarId: string,
  mode: EventBlockMode,
  timeZone: string,
) {
  if (found.calendarId !== calendarId || found.blockSourceEventId) return false;
  if (found.title !== (mode === "details" ? source.title : "Busy")) return false;
  if (found.allDay !== source.allDay) return false;
  if (!source.allDay) return found.startsAt === source.startsAt && found.endsAt === source.endsAt;
  const [left, right] = [allDaySpan(found, timeZone), allDaySpan(source, timeZone)];
  return sameLocalDate(left.first, right.first) && sameLocalDate(left.last, right.last);
}
