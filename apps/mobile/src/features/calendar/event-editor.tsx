import type { Calendar, CalendarEvent, CreateEventInput } from "@personal-os/domain";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { type ReactNode, useRef, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { toast } from "sonner-native";
import { editorDismissOptions } from "../../components/editor-header";
import { EnumChoice } from "../../components/forms/enum-choice";
import {
  Action,
  Field,
  FormBody,
  Section,
  TitleField,
  ToggleRow,
} from "../../components/forms/form-rows";
import { FormSave } from "../../components/forms/form-save";
import { PlanningPicker } from "../../components/forms/planning-picker";
import { SectionFootnote, SectionNote } from "../../components/forms/section-content";
import { useDirtyDismiss } from "../../components/forms/use-dirty-dismiss";
import { SettingsAccentProvider } from "../../components/settings-accent";
import { useTheme } from "../../theme";
import { confirm } from "../tasks/ui";
import {
  isNotFound,
  useCalendarEvent,
  useCalendarScope,
  useCalendars,
  useEventDefaults,
  useEventWrites,
} from "./data";
import { TimeCheck } from "./event-conflicts";
import {
  canChangeEvent,
  createInput,
  draftFromEvent,
  draftProblem,
  draftSpan,
  type EventDraft,
  matchesDraft,
  newEventDraft,
  updateInput,
  withAllDay,
  withStart,
} from "./event-draft";
import { calendarSourceLabel, timeZoneName } from "./logic";

/** Create an event, or change one on a calendar the person can write to. */
export function CalendarEventEditScreen() {
  const { id, day } = useLocalSearchParams<{ id?: string; day?: string }>();
  const { timeZone } = useCalendarScope();
  const calendars = useCalendars();
  const editing = typeof id === "string" && !!id;
  if (!timeZone)
    return (
      <Unavailable editing={editing}>Set your account timezone in Settings first.</Unavailable>
    );
  if (!calendars.data)
    return (
      <Unavailable
        editing={editing}
        loading={calendars.isPending}
        retry={() => void calendars.refetch()}
      />
    );
  return editing ? (
    <ExistingEvent id={id} calendars={calendars.data} timeZone={timeZone} />
  ) : (
    <NewEvent day={day} calendars={calendars.data} timeZone={timeZone} />
  );
}

/** The page before there is a form: loading, a retry, or why this event cannot be edited. */
function Unavailable({
  editing,
  loading = false,
  retry,
  children,
}: {
  editing: boolean;
  loading?: boolean;
  retry?: () => void;
  children?: ReactNode;
}) {
  const t = useTheme();
  return (
    <SettingsAccentProvider workspace="calendar">
      <Stack.Screen
        options={{
          title: editing ? "edit event" : "new event",
          ...editorDismissOptions({ label: "Close", onPress: () => router.back() }),
        }}
      />
      <FormBody>
        {loading ? (
          <ActivityIndicator
            color={t.secondary}
            accessibilityLabel="Loading event"
            style={{ padding: 24 }}
          />
        ) : children ? (
          <Section>
            <SectionNote>{children}</SectionNote>
          </Section>
        ) : (
          !!retry && (
            <View style={{ flexDirection: "row" }}>
              <Action label="Retry loading" onPress={retry} />
            </View>
          )
        )}
      </FormBody>
    </SettingsAccentProvider>
  );
}

type FormScope = { calendars: Calendar[]; timeZone: string };

function NewEvent({ day, calendars, timeZone }: FormScope & { day?: string }) {
  const defaults = useEventDefaults();
  const writable = calendars.filter((calendar) => calendar.isWritable);
  if (!defaults.ready) return <Unavailable editing={false} loading />;
  if (!writable.length)
    return (
      <Unavailable editing={false}>
        None of your calendars can take new events. Connect or create one in Settings.
      </Unavailable>
    );
  // The approved default first; otherwise prefer a calendar the agenda shows, primary first.
  const shown = writable.filter((candidate) => candidate.isSelected);
  const calendar =
    writable.find((candidate) => candidate.id === defaults.calendarId) ??
    shown.find((candidate) => candidate.isPrimary) ??
    shown[0] ??
    writable.find((candidate) => candidate.isPrimary) ??
    writable[0];
  return (
    <EventForm
      calendars={writable}
      timeZone={timeZone}
      initial={() => ({
        ...newEventDraft(day, new Date(), timeZone, defaults.durationMinutes),
        calendarId: calendar?.id ?? "",
      })}
    />
  );
}

function ExistingEvent({ id, calendars, timeZone }: FormScope & { id: string }) {
  const query = useCalendarEvent(id);
  // A reload after a conflict starts a new form from the record the API now returns.
  const [session, setSession] = useState(0);
  if (isNotFound(query.error))
    return <Unavailable editing>This event is no longer available.</Unavailable>;
  // The list's copy may be stale; editing starts only from the record the API confirms.
  if (!query.data || query.isPlaceholderData)
    return <Unavailable editing loading={!query.isError} retry={() => void query.refetch()} />;
  const event = query.data;
  const calendar = calendars.find((candidate) => candidate.id === event.calendarId);
  if (!canChangeEvent(event, calendar))
    return (
      <Unavailable editing>
        {event.blockSourceEventId
          ? "This busy block follows another event. Change that event instead."
          : "This event is on a calendar you can only read."}
      </Unavailable>
    );
  return (
    <EventForm
      key={session}
      event={event}
      calendars={calendar ? [calendar] : []}
      timeZone={timeZone}
      initial={() => draftFromEvent(event, timeZone)}
      reload={() =>
        void query.refetch().then((read) => {
          if (read.isSuccess) setSession((current) => current + 1);
        })
      }
    />
  );
}

function EventForm({
  event: latest,
  calendars,
  timeZone,
  initial,
  reload,
}: FormScope & {
  event?: CalendarEvent;
  initial: () => EventDraft;
  reload?: () => void;
}) {
  const writes = useEventWrites();
  // The form keeps the revision it opened with, so a change made elsewhere is a conflict
  // rather than something this draft silently overwrites.
  const [event] = useState(latest);
  const [draft, setDraft] = useState(initial);
  const [edited, setEdited] = useState(false);
  const [blocked, setBlocked] = useState<"conflict" | "uncertain" | "landed" | null>(null);
  // An unconfirmed create is retried with exactly what was sent, never a changed draft.
  const sent = useRef<CreateEventInput | null>(null);
  const permitDismiss = useDirtyDismiss(edited, writes.pending);
  const locked = writes.pending || !!blocked;
  const calendar = calendars.find((candidate) => candidate.id === draft.calendarId);
  const edit = (change: Partial<EventDraft>) => {
    setEdited(true);
    setDraft((current) => ({ ...current, ...change }));
  };
  const moveStart = (change: { startDate?: string; startTime?: string }) => {
    setEdited(true);
    setDraft((current) => withStart(current, change, timeZone));
  };
  const leave = () => {
    permitDismiss();
    router.back();
  };
  const save = async () => {
    const problem = draftProblem(draft, timeZone);
    if (problem || !calendar) {
      toast.error(problem ?? "Choose a calendar before saving.");
      return;
    }
    if (event) {
      const result = await writes.update(event, updateInput(draft, event, timeZone));
      if (result.ok) return leave();
      if (result.reason === "conflict") setBlocked("conflict");
      return;
    }
    const again = !!sent.current;
    sent.current ??= createInput(draft, calendar, timeZone);
    // A repeat reads the calendar first and sends nothing if the first attempt is there.
    const result = again
      ? await writes.createAfterCheck(sent.current, (found) => matchesDraft(found, draft, timeZone))
      : await writes.create(sent.current);
    if (result.ok) return leave();
    if (result.reason === "landed") return setBlocked("landed");
    // The calendar could not be read, so the choice stays as it was.
    if (result.reason === "unchecked") return;
    if (result.reason === "uncertain") return setBlocked("uncertain");
    // A refused create changed nothing, so the draft opens up again for correction.
    sent.current = null;
    setBlocked(null);
  };
  // The time on screen, once it is a real span; the provider only shapes all-day dates.
  const span = draftSpan(draft, calendar?.provider ?? "local", timeZone);
  const names = calendars.map((candidate) => candidate.name);
  const footnote = [
    draft.allDay ? null : `Times are in ${timeZoneName(timeZone, `${draft.startDate}T12:00:00Z`)}.`,
    event?.recurrence.length ? "Changes apply to every occurrence." : null,
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <SettingsAccentProvider workspace="calendar">
      <View style={{ flex: 1 }}>
        <Stack.Screen
          options={{
            title: event ? "edit event" : "new event",
            ...editorDismissOptions({
              label: edited ? "Cancel" : "Close",
              disabled: writes.pending,
              onPress: () => router.back(),
            }),
          }}
        />
        <FormBody>
          <View pointerEvents={locked ? "none" : "auto"}>
            <Section>
              <TitleField
                label="Event title"
                value={draft.title}
                onChangeText={(title) => edit({ title })}
                placeholder="Dentist appointment"
                maxLength={500}
                editable={!locked}
              />
            </Section>
            <Section title="When">
              <ToggleRow
                label="All day"
                value={draft.allDay}
                onChange={(allDay) => {
                  setEdited(true);
                  setDraft((current) => withAllDay(current, allDay, timeZone));
                }}
                disabled={locked}
              />
              <PlanningPicker
                label="Starts"
                mode="date"
                value={draft.startDate}
                timeZone={timeZone}
                disabled={locked}
                onChange={(startDate) => moveStart({ startDate })}
              />
              {!draft.allDay && (
                <PlanningPicker
                  label="Start time"
                  mode="time"
                  value={draft.startTime}
                  timeZone={timeZone}
                  disabled={locked}
                  onChange={(startTime) => moveStart({ startTime })}
                />
              )}
              <PlanningPicker
                label="Ends"
                mode="date"
                value={draft.endDate}
                timeZone={timeZone}
                disabled={locked}
                onChange={(endDate) => edit({ endDate })}
              />
              {!draft.allDay && (
                <PlanningPicker
                  label="End time"
                  mode="time"
                  value={draft.endTime}
                  timeZone={timeZone}
                  disabled={locked}
                  onChange={(endTime) => edit({ endTime })}
                />
              )}
              {!blocked && (
                <TimeCheck span={span} allDay={draft.allDay} self={event} timeZone={timeZone} />
              )}
            </Section>
            {!!footnote && <SectionFootnote>{footnote}</SectionFootnote>}
            <Section title="Calendar">
              <EnumChoice
                label="Calendar"
                icon="calendar"
                value={draft.calendarId}
                // An event stays on its calendar; the API has no move.
                disabled={!!event || locked}
                options={calendars.map((candidate) => ({
                  value: candidate.id,
                  label:
                    names.filter((name) => name === candidate.name).length > 1
                      ? `${candidate.name} · ${calendarSourceLabel(candidate)}`
                      : candidate.name,
                }))}
                onChange={(calendarId) => edit({ calendarId })}
              />
            </Section>
            <Section title="Details">
              <Field
                label="Location"
                value={draft.location}
                onChangeText={(location) => edit({ location })}
                placeholder="200 Main Street"
                maxLength={1000}
                editable={!locked}
              />
              <Field
                label="Notes"
                value={draft.notes}
                onChangeText={(notes) => edit({ notes })}
                placeholder="Bring the insurance card."
                multiline
                maxLength={50000}
                editable={!locked}
              />
            </Section>
          </View>
          {blocked === "landed" && (
            <Section title="Recovery">
              <Action label="Close and review calendar" onPress={leave} />
            </Section>
          )}
          {blocked === "uncertain" && (
            <Section title="Recovery">
              <Action label="Review calendar before creating again" onPress={leave} />
              {/* Events are read from shown calendars only, so a hidden calendar cannot be
                  checked and offers no second create. */}
              {!!calendar?.isSelected && (
                <Action
                  label="Check calendar and create again"
                  disabled={writes.pending}
                  onPress={() =>
                    confirm(
                      "Create this event again?",
                      "nohmi checks your calendar first and sends nothing if the event is already there. If your provider has it but nohmi doesn’t yet, you’ll get it twice.",
                      () => void save(),
                    )
                  }
                />
              )}
            </Section>
          )}
          {blocked === "conflict" && (
            <Section title="Recovery">
              <Action
                label="Reload event (discard changes)"
                onPress={() =>
                  confirm("Reload this event?", "Your changes will be discarded.", () => reload?.())
                }
              />
            </Section>
          )}
        </FormBody>
        <FormSave
          label={event ? "Save changes" : "Create event"}
          workspace="calendar"
          disabled={!edited || locked || !draft.title.trim() || !draft.calendarId}
          onPress={() => void save()}
        />
      </View>
    </SettingsAccentProvider>
  );
}
