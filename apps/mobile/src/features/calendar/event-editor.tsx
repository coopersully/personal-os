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
import {
  canChangeEvent,
  createInput,
  draftFromEvent,
  draftProblem,
  type EventDraft,
  newEventDraft,
  updateInput,
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
  const calendar =
    writable.find((candidate) => candidate.id === defaults.calendarId) ??
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
      reload={() => setSession((current) => current + 1)}
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
  const [blocked, setBlocked] = useState<"conflict" | "uncertain" | null>(null);
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
    if (!event) sent.current ??= createInput(draft, calendar, timeZone);
    const result = event
      ? await writes.update(event, updateInput(draft, event, timeZone))
      : await writes.create(sent.current as CreateEventInput);
    if (result.ok) return leave();
    if (event) {
      if (result.reason === "conflict") setBlocked("conflict");
      return;
    }
    if (result.reason === "uncertain") return setBlocked("uncertain");
    // A refused create changed nothing, so the draft opens up again for correction.
    sent.current = null;
    setBlocked(null);
  };
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
                onChange={(allDay) => edit({ allDay })}
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
          {blocked === "uncertain" && (
            <Section title="Recovery">
              <Action label="Review calendar before creating again" onPress={leave} />
              <Action
                label="Create again anyway"
                disabled={writes.pending}
                onPress={() =>
                  confirm(
                    "Create this event again?",
                    "If the first attempt went through, your calendar will have it twice.",
                    () => void save(),
                  )
                }
              />
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
