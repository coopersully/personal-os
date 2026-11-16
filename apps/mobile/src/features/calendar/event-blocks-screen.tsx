import type { EventBlockMode } from "@personal-os/domain";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { Fragment, type ReactNode, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { editorDismissOptions } from "../../components/editor-header";
import { EnumChoice } from "../../components/forms/enum-choice";
import { Action, FormBody, Section, ToggleRow } from "../../components/forms/form-rows";
import { SectionFootnote, SectionNote } from "../../components/forms/section-content";
import { SettingsAccentProvider } from "../../components/settings-accent";
import { useTheme } from "../../theme";
import {
  isNotFound,
  useCalendarEvent,
  useCalendarScope,
  useCalendars,
  useEventWrites,
  useSavedBlockMode,
} from "./data";
import { blockModeLabels, blockTargets, canBlockEvent } from "./event-blocks";
import { calendarSourceLabel, eventWhenLabel } from "./logic";

const modes = (["busy", "details"] as const).map((value) => ({
  value,
  label: blockModeLabels[value],
}));

/**
 * Blocks an event's time on the person's other calendars. Every switch and choice here is one
 * write to a real calendar, shown as changed only after the API confirms it.
 */
export function CalendarEventBlocksScreen() {
  const t = useTheme();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { timeZone = "UTC" } = useCalendarScope();
  const query = useCalendarEvent(typeof id === "string" ? id : undefined);
  const calendars = useCalendars();
  const saved = useSavedBlockMode();
  const writes = useEventWrites();
  // The saved busy-block privacy until the person picks another for the blocks they add now.
  const [chosen, setChosen] = useState<EventBlockMode | null>(null);
  const page = (children: ReactNode) => (
    <SettingsAccentProvider workspace="calendar">
      <Stack.Screen
        options={{
          title: "block time",
          ...editorDismissOptions({ label: "Close", onPress: () => router.back() }),
        }}
      />
      <FormBody>{children}</FormBody>
    </SettingsAccentProvider>
  );
  const note = (text: string) =>
    page(
      <Section>
        <SectionNote>{text}</SectionNote>
      </Section>,
    );
  if (!id || isNotFound(query.error)) return note("This event is no longer available.");
  // The list's copy may be stale; blocks are changed only from the record the API confirms.
  const event = query.isPlaceholderData ? undefined : query.data;
  if (!event || !calendars.data || !saved.ready) {
    const failed = query.isError ? query : calendars.isError ? calendars : null;
    return page(
      failed ? (
        <View style={{ flexDirection: "row" }}>
          <Action label="Retry loading" onPress={() => void failed.refetch()} />
        </View>
      ) : (
        <ActivityIndicator
          color={t.secondary}
          accessibilityLabel="Loading event"
          style={{ padding: 24 }}
        />
      ),
    );
  }
  if (!canBlockEvent(event))
    return note("This busy block follows another event. Block time from that event.");
  const targets = blockTargets(event, calendars.data);
  if (!targets.length) return note("You have no other calendar that can take a block.");
  const mode = chosen ?? saved.mode;
  const named = (name: string) => targets.filter((target) => target.calendar.name === name);
  return page(
    <>
      <Section title="New blocks">
        <EnumChoice
          label="New blocks show"
          icon="calendar"
          value={mode}
          options={modes}
          disabled={writes.pending}
          onChange={(value) => setChosen(value as EventBlockMode)}
        />
      </Section>
      <SectionFootnote>
        Busy shows only that you’re busy. Details copies this event’s title, location and notes to
        the other calendar.
      </SectionFootnote>
      <Section title="Other calendars">
        {targets.map((target) => {
          const { calendar } = target;
          const name =
            named(calendar.name).length > 1
              ? `${calendar.name} · ${calendarSourceLabel(calendar)}`
              : calendar.name;
          return (
            <Fragment key={calendar.id}>
              <ToggleRow
                label={`Block on ${name}`}
                value={!!target.mode}
                disabled={writes.pending}
                onChange={(on) =>
                  void (on ? writes.block(event, target, mode) : writes.unblock(event, target))
                }
              />
              {!!target.mode && (
                <EnumChoice
                  label={`${name} shows`}
                  icon="calendar"
                  value={target.mode}
                  options={modes}
                  disabled={writes.pending}
                  onChange={(value) =>
                    void writes.setBlockMode(event, target, value as EventBlockMode)
                  }
                />
              )}
            </Fragment>
          );
        })}
      </Section>
      <SectionFootnote>
        {`“${event.title}” · ${eventWhenLabel(event, timeZone)}. A block follows this event when its time changes.`}
      </SectionFootnote>
    </>,
  );
}
