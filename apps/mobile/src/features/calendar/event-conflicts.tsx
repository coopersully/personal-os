import type { Calendar, CalendarEvent } from "@personal-os/domain";
import { View } from "react-native";
import { Action } from "../../components/forms/form-rows";
import { SectionNote } from "../../components/forms/section-content";
import { Icon } from "../../components/icons";
import { RecordRow } from "../../components/record-row";
import { spacing, useTheme } from "../../theme";
import { useEventsDuring } from "./data";
import { overlapping, timeCanConflict } from "./event-blocks";
import { eventWhenLabel } from "./logic";
import { Card, Copy, openEvent, SectionTitle } from "./ui";

/** Both checks follow the Calendar review's rule, and say what that rule leaves out. */
const unchecked = " Repeating and all-day events aren’t checked.";

/**
 * The events that overlap this one, by the Calendar review's rule. The section appears only
 * when there is something to see or the check itself failed.
 */
export function EventConflicts({
  event,
  timeZone,
  calendars,
}: {
  event: CalendarEvent;
  timeZone: string;
  calendars: readonly Calendar[] | undefined;
}) {
  const t = useTheme();
  const read = useEventsDuring(
    timeCanConflict(event) ? { startsAt: event.startsAt, endsAt: event.endsAt } : null,
  );
  const found = overlapping(event, read.data ?? [], event);
  if (!read.isError && !found.length) return null;
  const warning = <Icon name="attention" color={t.warning} />;
  return (
    <View style={{ gap: spacing.sm }}>
      <SectionTitle>Conflicts</SectionTitle>
      <Card rows>
        {read.isError ? (
          <RecordRow
            title="Couldn’t check for conflicts"
            subtitle="Retry"
            leading={warning}
            onPress={() => void read.refetch()}
          />
        ) : (
          found.map((other) => (
            <RecordRow
              key={other.id}
              title={other.title}
              subtitle={[
                eventWhenLabel(other, timeZone),
                calendars?.find((calendar) => calendar.id === other.calendarId)?.name,
              ]
                .filter(Boolean)
                .join(" · ")}
              leading={warning}
              accessibilityHint="Opens the conflicting event"
              onPress={() => openEvent(other)}
            />
          ))
        )}
      </Card>
      {!read.isError && (
        <Copy>{`Compared with one-off timed events on the calendars you show.${unchecked}`}</Copy>
      )}
    </View>
  );
}

/**
 * Whether a proposed time is free, read before anything is saved. It reports what the shown
 * calendars hold for exactly the time on screen; `span` is null while the time is not valid.
 */
export function TimeCheck({
  span,
  allDay,
  self,
  timeZone,
}: {
  span: { startsAt: string; endsAt: string } | null;
  allDay: boolean;
  /** The event being edited, which never conflicts with itself. */
  self?: CalendarEvent;
  timeZone: string;
}) {
  const read = useEventsDuring(allDay ? null : span);
  if (allDay) return <SectionNote>All-day events aren’t compared with other events.</SectionNote>;
  if (!span) return null;
  if (read.isError)
    return (
      <View style={{ flexDirection: "row" }}>
        <Action label="Check this time again" onPress={() => void read.refetch()} />
      </View>
    );
  // Until the read lands nothing is claimed about the time, free or not.
  if (!read.data) return null;
  const [first, ...rest] = overlapping(span, read.data, self);
  if (!first)
    return (
      <SectionNote>
        {`No overlap with one-off timed events on the calendars you show.${unchecked}`}
      </SectionNote>
    );
  return (
    <SectionNote warning>
      {`Overlaps ${first.title} (${eventWhenLabel(first, timeZone)})${rest.length ? ` and ${rest.length} more` : ""} on the calendars you show.${unchecked}`}
    </SectionNote>
  );
}
