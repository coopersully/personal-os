import { useLocalSearchParams } from "expo-router";
import { ActivityIndicator, Linking, Text, View } from "react-native";
import { toast } from "sonner-native";
import { Icon, type IconName } from "../../components/icons";
import { RecordRow } from "../../components/record-row";
import { Screen } from "../../components/screen";
import { spacing, useTheme, workspaceColor } from "../../theme";
import { useCalendarEvent, useCalendarScope, useCalendars } from "./data";
import {
  attendeeLabel,
  calendarFreshness,
  calendarSourceLabel,
  eventWhenLabel,
  fallbackEventColor,
} from "./logic";
import { CalendarDot, Card, Copy, SectionTitle } from "./ui";

const conferenceStates = {
  failure: "The video link couldn’t be created.",
  pending: "The video link is still being created.",
} as const;

function open(url: string) {
  void Linking.openURL(url).catch(() => toast.error("Couldn’t open this link."));
}

/** Read-only event details; changing an event belongs to the event editor. */
export function CalendarEventScreen() {
  const t = useTheme();
  const tint = workspaceColor(t, "calendar");
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { timeZone = "UTC" } = useCalendarScope();
  const query = useCalendarEvent(typeof id === "string" ? id : undefined);
  const calendars = useCalendars();
  const event = query.data;
  if (!event)
    return (
      <Screen>
        {query.isError || !id ? (
          <RecordRow
            title={id ? "Retry loading" : "This event is no longer available."}
            leading={<Icon name="disconnected" color={tint} />}
            onPress={id ? () => void query.refetch() : undefined}
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
  const calendar = calendars.data?.find((candidate) => candidate.id === event.calendarId);
  const freshness = calendar ? calendarFreshness(calendar, timeZone) : null;
  const icon = (name: IconName) => <Icon name={name} color={tint} />;
  const conferenceState =
    event.conferenceStatus === "failure" || event.conferenceStatus === "pending"
      ? conferenceStates[event.conferenceStatus]
      : null;
  const reminders = event.reminders ?? [];
  const attendees = event.attendees ?? [];
  return (
    <Screen>
      <View style={{ gap: spacing.lg }}>
        <Text accessibilityRole="header" style={{ color: t.ink, fontSize: 28, fontWeight: "700" }}>
          {event.title}
        </Text>
        <Card rows>
          <RecordRow
            title={eventWhenLabel(event, timeZone)}
            subtitle={[
              event.allDay ? null : `Times shown in ${timeZone}`,
              !event.allDay && event.timezone !== timeZone
                ? `Event set in ${event.timezone}`
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
              title="Source"
              value={freshness.label}
              valueTone={freshness.attention ? "attention" : undefined}
              accessibilityHint={freshness.attention ? "This event may be out of date." : undefined}
              leading={icon("refresh")}
            />
          )}
          {!!reminders.length && (
            <RecordRow
              title="Reminders"
              subtitle={reminders
                .map(({ minutes }) => (minutes ? `${minutes} min before` : "At start"))
                .join(" · ")}
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
