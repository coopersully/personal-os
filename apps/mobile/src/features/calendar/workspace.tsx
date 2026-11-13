import type { CalendarEvent, LocalDate } from "@personal-os/domain";
import { addLocalDays, sameLocalDate } from "@personal-os/domain";
import { router } from "expo-router";
import { useMemo, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { Icon } from "../../components/icons";
import { RecordRow } from "../../components/record-row";
import { Screen } from "../../components/screen";
import { radius, spacing, touchTarget, useTheme, workspaceColor } from "../../theme";
import { CalendarPicker } from "./calendar-picker";
import {
  useCalendarEvents,
  useCalendarRefresh,
  useCalendarScope,
  useCalendars,
  useToday,
  useWeekStart,
} from "./data";
import {
  agendaDayCount,
  agendaSections,
  calendarFreshness,
  type DayEventLayout,
  dayEvents,
  eventOccursOnDay,
  eventTimeLabel,
  formatDay,
  formatHour,
  timelineHours,
  weekDays,
} from "./logic";
import {
  type CalendarsById,
  Card,
  Copy,
  EventRow,
  eventColor,
  openEvent,
  SectionTitle,
  Segments,
} from "./ui";

const views = ["Day", "Agenda"] as const;
const hourHeight = 56;
const gutter = 52;

/** Calendar on iPhone: one day's timeline or a rolling agenda, never the web week grid. */
export function CalendarScreen() {
  const t = useTheme();
  const tint = workspaceColor(t, "calendar");
  const { timeZone } = useCalendarScope();
  const today = useToday(timeZone);
  const [picked, setPicked] = useState<LocalDate | null>(null);
  const [view, setView] = useState<(typeof views)[number]>("Day");
  const [choosing, setChoosing] = useState(false);
  const day = picked ?? today;
  const weekStart = useWeekStart();
  const week = useMemo(() => (day && weekStart ? weekDays(day, weekStart) : []), [day, weekStart]);
  const events = useCalendarEvents(
    view === "Day" ? (week[0] ?? null) : day,
    view === "Day" ? 7 : agendaDayCount,
  );
  const calendars = useCalendars();
  const refresh = useCalendarRefresh([events, calendars]);
  const calendarsById: CalendarsById = useMemo(
    () => new Map((calendars.data ?? []).map((calendar) => [calendar.id, calendar])),
    [calendars.data],
  );
  if (!day || !today || !timeZone)
    return (
      <Screen chrome>
        <RecordRow
          title="Set your timezone"
          subtitle="Choose your account timezone to see your calendar."
          leading={<Icon name="settings" color={tint} />}
          onPress={() => router.navigate("/settings")}
        />
      </Screen>
    );
  const shown = calendars.data?.filter((calendar) => calendar.isSelected) ?? [];
  const stale = shown.filter((calendar) => calendarFreshness(calendar, timeZone).attention);
  const isToday = sameLocalDate(day, today);
  return (
    <Screen chrome onRefresh={refresh}>
      <View style={{ gap: spacing.lg, paddingTop: 8 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.xs }}>
          <View style={{ flex: 1 }}>
            <Text
              accessibilityRole="header"
              accessibilityLabel={formatDay(day)}
              style={{ color: t.ink, fontSize: 28, fontWeight: "700" }}
            >
              {formatDay(day, "short")}
            </Text>
          </View>
          <IconButton
            label="Previous day"
            flipped
            onPress={() => setPicked(addLocalDays(day, -1))}
          />
          <IconButton label="Next day" onPress={() => setPicked(addLocalDays(day, 1))} />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Choose calendars"
            accessibilityHint="Show or hide calendars"
            onPress={() => setChoosing(true)}
            style={styles.iconButton}
          >
            <Icon name="calendar" color={tint} />
          </Pressable>
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
          <Segments value={view} options={views} onChange={setView} />
          {!isToday && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Go to today"
              onPress={() => setPicked(null)}
              style={{
                minHeight: touchTarget,
                paddingHorizontal: spacing.lg,
                justifyContent: "center",
                borderRadius: radius.panel,
                backgroundColor: t.surface,
              }}
            >
              <Text style={{ color: tint, fontSize: 15, fontWeight: "600" }}>Today</Text>
            </Pressable>
          )}
        </View>
        {view === "Day" && (
          <View style={{ flexDirection: "row" }}>
            {week.map((date) => {
              const selected = sameLocalDate(date, day);
              const current = sameLocalDate(date, today);
              // Kept events belong to the previous range, so they cannot mark this week's days.
              const busy =
                !events.isPlaceholderData &&
                events.data?.some((event) => eventOccursOnDay(event, date, timeZone));
              return (
                <Pressable
                  key={date.day}
                  accessibilityRole="button"
                  accessibilityLabel={[
                    formatDay(date),
                    current ? "today" : null,
                    busy ? "has events" : null,
                  ]
                    .filter(Boolean)
                    .join(", ")}
                  accessibilityState={{ selected }}
                  onPress={() => setPicked(date)}
                  style={{ flex: 1, minHeight: 60, alignItems: "center", gap: spacing.xs }}
                >
                  <Text style={{ color: t.secondary, fontSize: 12 }}>
                    {formatDay(date, "weekday")}
                  </Text>
                  <View
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: 16,
                      alignItems: "center",
                      justifyContent: "center",
                      backgroundColor: selected ? tint : "transparent",
                    }}
                  >
                    <Text
                      style={{
                        color: selected ? t.canvas : current ? tint : t.ink,
                        fontSize: 16,
                        fontWeight: selected || current ? "700" : "400",
                      }}
                    >
                      {date.day}
                    </Text>
                  </View>
                  <View
                    style={{
                      width: 4,
                      height: 4,
                      borderRadius: 2,
                      backgroundColor: busy ? t.secondary : "transparent",
                    }}
                  />
                </Pressable>
              );
            })}
          </View>
        )}
        {!!calendars.data && shown.length < calendars.data.length && (
          <Copy>
            {shown.length} of {calendars.data.length} calendars shown
          </Copy>
        )}
        {!!stale.length && (
          <Pressable
            accessibilityRole="button"
            accessibilityHint="Shows each calendar and when it was last updated"
            onPress={() => setChoosing(true)}
            style={{
              minHeight: touchTarget,
              flexDirection: "row",
              alignItems: "center",
              gap: spacing.sm,
            }}
          >
            <Icon name="attention" size={18} color={t.secondary} />
            <Text style={{ flex: 1, color: t.warning, fontSize: 15 }}>
              {stale.length === 1
                ? `${stale[0]?.name} may be out of date`
                : `${stale.length} calendars may be out of date`}
            </Text>
          </Pressable>
        )}
        {events.isPending ? (
          <ActivityIndicator
            color={t.secondary}
            accessibilityLabel="Loading calendar"
            style={{ padding: 24 }}
          />
        ) : !events.data ? (
          <RecordRow
            title="Retry loading"
            leading={<Icon name="disconnected" color={tint} />}
            onPress={() => void events.refetch()}
          />
        ) : calendars.data && !shown.length ? (
          <Card>
            <Copy>
              {calendars.data.length
                ? "Every calendar is hidden. Choose calendars to see their events."
                : "No calendars yet. Connect or create one in Settings."}
            </Copy>
          </Card>
        ) : view === "Day" ? (
          <DayView
            events={events.data}
            day={day}
            timeZone={timeZone}
            calendars={calendarsById}
            loading={events.isPlaceholderData}
          />
        ) : (
          <AgendaView
            events={events.data}
            from={day}
            today={today}
            timeZone={timeZone}
            calendars={calendarsById}
            loading={events.isPlaceholderData}
          />
        )}
      </View>
      {choosing && <CalendarPicker onClose={() => setChoosing(false)} />}
    </Screen>
  );
}

function IconButton({
  label,
  flipped = false,
  onPress,
}: {
  label: string;
  flipped?: boolean;
  onPress: () => void;
}) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={[styles.iconButton, flipped && { transform: [{ rotate: "180deg" }] }]}
    >
      <Icon name="chevron" color={t.ink} />
    </Pressable>
  );
}

type ViewProps = {
  events: CalendarEvent[];
  timeZone: string;
  calendars: CalendarsById;
  /** The events are the previous range's, kept on screen while this range loads. */
  loading: boolean;
};

/** Kept events cannot prove a day is empty; say it is loading instead. */
function Empty({ loading, children }: { loading: boolean; children: string }) {
  const t = useTheme();
  if (loading)
    return (
      <ActivityIndicator
        color={t.secondary}
        accessibilityLabel="Loading calendar"
        style={{ padding: 24 }}
      />
    );
  return (
    <Card>
      <Copy>{children}</Copy>
    </Card>
  );
}

function DayView({ events, day, timeZone, calendars, loading }: ViewProps & { day: LocalDate }) {
  const { allDay, timed } = useMemo(
    () => dayEvents(events, day, timeZone),
    [events, day, timeZone],
  );
  if (!allDay.length && !timed.length) return <Empty loading={loading}>Nothing scheduled.</Empty>;
  return (
    <>
      {!!allDay.length && (
        <View style={{ gap: spacing.sm }}>
          <SectionTitle>All day</SectionTitle>
          <Card rows>
            {allDay.map((event) => (
              <EventRow
                key={event.id}
                event={event}
                day={day}
                timeZone={timeZone}
                calendars={calendars}
              />
            ))}
          </Card>
        </View>
      )}
      {timed.length ? (
        <Timeline layouts={timed} day={day} timeZone={timeZone} calendars={calendars} />
      ) : (
        <Copy>No timed events.</Copy>
      )}
    </>
  );
}

function Timeline({
  layouts,
  day,
  timeZone,
  calendars,
}: {
  layouts: DayEventLayout[];
  day: LocalDate;
  timeZone: string;
  calendars: CalendarsById;
}) {
  const t = useTheme();
  const { startHour, endHour } = timelineHours(layouts);
  const hours = Array.from({ length: endHour - startHour }, (_, index) => startHour + index);
  return (
    <View style={{ height: hours.length * hourHeight }}>
      {hours.map((hour, index) => (
        <View
          key={hour}
          accessible={false}
          importantForAccessibility="no-hide-descendants"
          style={[styles.hour, { top: index * hourHeight }]}
        >
          <Text style={{ width: gutter, color: t.secondary, fontSize: 12, marginTop: -8 }}>
            {formatHour(hour)}
          </Text>
          <View style={{ flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: t.line }} />
        </View>
      ))}
      <View style={styles.events}>
        {layouts.map(({ event, startMinute, endMinute, column, columns }) => {
          const color = eventColor(event, calendars);
          const height = Math.max(28, ((endMinute - startMinute) / 60) * hourHeight - 2);
          const time = eventTimeLabel(event, day, timeZone);
          return (
            <Pressable
              key={event.id}
              accessibilityRole="button"
              accessibilityLabel={[
                event.title,
                time,
                calendars.get(event.calendarId)?.name,
                columns > 1 ? "overlaps another event" : null,
              ]
                .filter(Boolean)
                .join(", ")}
              accessibilityHint="Opens event details"
              hitSlop={{ top: 8, bottom: 8 }}
              onPress={() => openEvent(event)}
              style={{
                position: "absolute",
                top: (startMinute / 60 - startHour) * hourHeight,
                left: `${(column / columns) * 100}%`,
                width: `${100 / columns}%`,
                height,
                paddingRight: 2,
              }}
            >
              <View
                style={{
                  flex: 1,
                  overflow: "hidden",
                  borderRadius: radius.control,
                  borderLeftWidth: 3,
                  borderLeftColor: color,
                  backgroundColor: `${color}26`,
                  paddingHorizontal: spacing.sm,
                  paddingVertical: 4,
                  opacity: event.status === "cancelled" ? 0.6 : 1,
                }}
              >
                <Text numberOfLines={1} style={{ color: t.ink, fontSize: 14, fontWeight: "600" }}>
                  {event.title}
                </Text>
                {height >= 44 && (
                  <Text numberOfLines={1} style={{ color: t.secondary, fontSize: 12 }}>
                    {[time, event.location].filter(Boolean).join(" · ")}
                  </Text>
                )}
              </View>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function AgendaView({
  events,
  from,
  today,
  timeZone,
  calendars,
  loading,
}: ViewProps & { from: LocalDate; today: LocalDate }) {
  const sections = useMemo(
    () => agendaSections(events, from, agendaDayCount, timeZone),
    [events, from, timeZone],
  );
  if (!sections.length)
    return <Empty loading={loading}>{`Nothing scheduled in these ${agendaDayCount} days.`}</Empty>;
  return (
    <>
      {sections.map(({ day, allDay, timed }) => (
        <View key={`${day.month}-${day.day}`} style={{ gap: spacing.sm }}>
          <SectionTitle>
            {sameLocalDate(day, today) ? `Today · ${formatDay(day, "short")}` : formatDay(day)}
          </SectionTitle>
          <Card rows>
            {[...allDay, ...timed].map((event) => (
              <EventRow
                key={event.id}
                event={event}
                day={day}
                timeZone={timeZone}
                calendars={calendars}
              />
            ))}
          </Card>
        </View>
      ))}
    </>
  );
}

const styles = StyleSheet.create({
  iconButton: {
    width: touchTarget,
    height: touchTarget,
    alignItems: "center",
    justifyContent: "center",
  },
  hour: { position: "absolute", left: 0, right: 0, flexDirection: "row", alignItems: "flex-start" },
  events: { position: "absolute", top: 0, bottom: 0, left: gutter, right: 0 },
});
