import type { Calendar, CalendarEvent, LocalDate } from "@personal-os/domain";
import { router } from "expo-router";
import type { PropsWithChildren } from "react";
import { Pressable, Text, View } from "react-native";
import { RecordRow } from "../../components/record-row";
import { radius, spacing, touchTarget, useTheme, workspaceColor } from "../../theme";
import { eventTimeLabel, fallbackEventColor } from "./logic";

export type CalendarsById = ReadonlyMap<string, Calendar>;

export function eventColor(event: CalendarEvent, calendars: CalendarsById) {
  return calendars.get(event.calendarId)?.color ?? fallbackEventColor;
}

export function openEvent(event: CalendarEvent) {
  router.push({ pathname: "/calendar-event", params: { id: event.id } });
}

/** Everything a row says about an event besides its title, in reading order. */
export function eventSummary(
  event: CalendarEvent,
  day: LocalDate,
  timeZone: string,
  calendars: CalendarsById,
) {
  return [
    eventTimeLabel(event, day, timeZone),
    event.status === "confirmed" ? null : event.status === "tentative" ? "Tentative" : "Cancelled",
    event.location,
    event.conferenceUrl ? "Video call" : null,
    calendars.get(event.calendarId)?.name,
  ]
    .filter(Boolean)
    .join(" · ");
}

export function CalendarDot({ color }: { color: string }) {
  return (
    <View
      style={{ width: 12, height: 12, borderRadius: 6, marginTop: 4, backgroundColor: color }}
    />
  );
}

export function Card({ children, rows = false }: PropsWithChildren<{ rows?: boolean }>) {
  const t = useTheme();
  return (
    <View
      style={{
        backgroundColor: t.surface,
        borderRadius: radius.panel,
        paddingHorizontal: spacing.lg,
        paddingVertical: rows ? 2 : spacing.lg,
        gap: rows ? 0 : spacing.md,
      }}
    >
      {children}
    </View>
  );
}

export function Copy({ children }: PropsWithChildren) {
  const t = useTheme();
  return <Text style={{ color: t.secondary, fontSize: 15, lineHeight: 21 }}>{children}</Text>;
}

export function SectionTitle({ children }: PropsWithChildren) {
  const t = useTheme();
  return (
    <Text accessibilityRole="header" style={{ color: t.ink, fontSize: 17, fontWeight: "600" }}>
      {children}
    </Text>
  );
}

export function EventRow({
  event,
  day,
  timeZone,
  calendars,
}: {
  event: CalendarEvent;
  day: LocalDate;
  timeZone: string;
  calendars: CalendarsById;
}) {
  return (
    <RecordRow
      title={event.title}
      subtitle={eventSummary(event, day, timeZone, calendars)}
      leading={<CalendarDot color={eventColor(event, calendars)} />}
      onPress={() => openEvent(event)}
    />
  );
}

export function Segments<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: readonly T[];
  onChange: (value: T) => void;
}) {
  const t = useTheme();
  return (
    <View
      style={{
        flex: 1,
        flexDirection: "row",
        backgroundColor: t.surface,
        borderRadius: radius.panel,
        padding: 4,
        gap: 4,
      }}
    >
      {options.map((option) => (
        <Pressable
          key={option}
          accessibilityRole="button"
          accessibilityState={{ selected: option === value }}
          onPress={() => onChange(option)}
          style={{
            flex: 1,
            minHeight: touchTarget,
            justifyContent: "center",
            alignItems: "center",
            borderRadius: radius.menu,
            backgroundColor: value === option ? t.canvas : "transparent",
          }}
        >
          <Text
            style={{
              color: value === option ? workspaceColor(t, "calendar") : t.secondary,
              fontSize: 15,
              fontWeight: "600",
            }}
          >
            {option}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}
