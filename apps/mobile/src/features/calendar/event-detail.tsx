import { router, Stack, useLocalSearchParams } from "expo-router";
import { useEffect, useRef } from "react";
import { ActivityIndicator, Linking, Text, View } from "react-native";
import { toast } from "sonner-native";
import { editorActionsOptions } from "../../components/editor-header";
import { Icon, type IconName } from "../../components/icons";
import { RecordRow } from "../../components/record-row";
import { Screen } from "../../components/screen";
import { spacing, useTheme, workspaceColor } from "../../theme";
import { confirm } from "../tasks/ui";
import {
  isNotFound,
  useCalendarEvent,
  useCalendarScope,
  useCalendars,
  useEventWrites,
} from "./data";
import { canChangeEvent, canRestoreFaithfully } from "./event-draft";
import {
  attendeeLabel,
  calendarFreshness,
  calendarSourceLabel,
  eventWhenLabel,
  fallbackEventColor,
  reminderLabel,
  timeZoneName,
} from "./logic";
import { CalendarDot, Card, Copy, SectionTitle } from "./ui";

const conferenceStates = {
  failure: "The video link couldn’t be created.",
  pending: "The video link is still being created.",
} as const;

function open(url: string) {
  void Linking.openURL(url).catch(() => toast.error("Couldn’t open this link."));
}

/** Event details. Edit and Delete are offered only where the person may change the event. */
export function CalendarEventScreen() {
  const t = useTheme();
  const tint = workspaceColor(t, "calendar");
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { timeZone = "UTC" } = useCalendarScope();
  const query = useCalendarEvent(typeof id === "string" ? id : undefined);
  const calendars = useCalendars();
  const writes = useEventWrites();
  // A delete that settles after the person left this page must not close whatever is open now.
  const shown = useRef(true);
  useEffect(() => {
    shown.current = true;
    return () => {
      shown.current = false;
    };
  }, []);
  const event = query.data;
  if (!event) {
    const gone = !id || isNotFound(query.error);
    return (
      <Screen>
        {query.isError || gone ? (
          <RecordRow
            title={gone ? "This event is no longer available." : "Retry loading"}
            leading={<Icon name="disconnected" color={tint} />}
            onPress={gone ? undefined : () => void query.refetch()}
          />
        ) : (
          <ActivityIndicator
            color={t.secondary}
            accessibilityLabel="Loading event"
            style={{ padding: 24 }}
          />
        )}
      </Screen>
    );
  }
  const calendar = calendars.data?.find((candidate) => candidate.id === event.calendarId);
  const freshness = calendar ? calendarFreshness(calendar, timeZone) : null;
  const icon = (name: IconName) => <Icon name={name} color={tint} />;
  const conferenceState =
    event.conferenceStatus === "failure" || event.conferenceStatus === "pending"
      ? conferenceStates[event.conferenceStatus]
      : null;
  const reminders = event.reminders ?? [];
  const attendees = event.attendees ?? [];
  // The list's copy may be stale; actions wait for the record the API confirms.
  const changeable = !query.isPlaceholderData && canChangeEvent(event, calendar);
  const remove = () =>
    confirm(
      "Delete event?",
      [
        `“${event.title}” will be removed from ${calendar?.name}.`,
        event.recurrence.length ? "Every occurrence of this repeating event is deleted." : null,
        canRestoreFaithfully(event)
          ? "You can undo this right after deleting."
          : "This can’t be undone from nohmi.",
      ]
        .filter(Boolean)
        .join(" "),
      () =>
        void writes.remove(event).then((result) => {
          if (result.ok && shown.current) router.back();
        }),
      true,
    );
  return (
    <Screen>
      <Stack.Screen
        options={editorActionsOptions(
          "Event actions",
          changeable
            ? [
                {
                  id: "edit",
                  label: "Edit",
                  icon: "edit",
                  disabled: writes.pending,
                  onPress: () =>
                    router.push({ pathname: "/calendar-event-edit", params: { id: event.id } }),
                },
                {
                  id: "delete",
                  label: "Delete",
                  icon: "trash",
                  destructive: true,
                  disabled: writes.pending,
                  onPress: remove,
                },
              ]
            : [],
          t,
        )}
      />
      <View style={{ gap: spacing.lg }}>
        <Text accessibilityRole="header" style={{ color: t.ink, fontSize: 28, fontWeight: "700" }}>
          {event.title}
        </Text>
        <Card rows>
          <RecordRow
            title={eventWhenLabel(event, timeZone)}
            subtitle={[
              event.allDay ? null : `Times shown in ${timeZoneName(timeZone, event.startsAt)}`,
              !event.allDay && event.timezone !== timeZone
                ? `Event set in ${timeZoneName(event.timezone, event.startsAt)}`
                : null,
              event.status === "tentative" ? "Tentative" : null,
              event.status === "cancelled" ? "Cancelled" : null,
              event.recurrence.length ? "Repeats" : null,
            ]
              .filter(Boolean)
              .join(" · ")}
            leading={icon("clock")}
          />
          {!!event.location && (
            <RecordRow title={event.location} subtitle="Location" leading={icon("location")} />
          )}
          {event.conferenceUrl ? (
            <RecordRow
              title="Join video call"
              subtitle={event.conferenceUrl}
              subtitleLines={1}
              leading={icon("people")}
              accessibilityHint="Opens the meeting link"
              onPress={() => open(event.conferenceUrl as string)}
            />
          ) : (
            !!conferenceState && (
              <RecordRow title="Video call" subtitle={conferenceState} leading={icon("people")} />
            )
          )}
          {!!event.url && (
            <RecordRow
              title="Open link"
              subtitle={event.url}
              subtitleLines={1}
              leading={icon("send")}
              accessibilityHint="Opens the event link"
              onPress={() => open(event.url as string)}
            />
          )}
        </Card>
        <Card rows>
          <RecordRow
            title={calendar?.name ?? "Calendar unavailable"}
            subtitle={
              calendar
                ? [calendarSourceLabel(calendar), calendar.isWritable ? null : "Read only"]
                    .filter(Boolean)
                    .join(" · ")
                : "This calendar is no longer connected."
            }
            leading={<CalendarDot color={calendar?.color ?? fallbackEventColor} />}
          />
          {freshness && (
            <RecordRow
              title={freshness.label}
              subtitle={freshness.attention ? "Source · This event may be out of date" : "Source"}
              leading={
                freshness.attention ? <Icon name="attention" color={t.warning} /> : icon("refresh")
              }
            />
          )}
          {!!reminders.length && (
            <RecordRow
              title="Reminders"
              subtitle={reminders.map(({ minutes }) => reminderLabel(minutes)).join(" · ")}
              leading={icon("notification")}
            />
          )}
        </Card>
        {!!attendees.length && (
          <View style={{ gap: spacing.sm }}>
            <SectionTitle>Guests</SectionTitle>
            <Card rows>
              {attendees.map((attendee) => (
                <RecordRow
                  key={attendee.email}
                  {...attendeeLabel(attendee)}
                  leading={icon("profile")}
                />
              ))}
            </Card>
          </View>
        )}
        {!!event.notes && (
          <View style={{ gap: spacing.sm }}>
            <SectionTitle>Notes</SectionTitle>
            <Card>
              <Copy>{event.notes}</Copy>
            </Card>
          </View>
        )}
      </View>
    </Screen>
  );
}
