import type { Calendar, CalendarEvent, LocalDate } from "@personal-os/domain";
import { localDateAt, localDateToIso, parseLocalDate } from "@personal-os/domain";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { AppState } from "react-native";
import { holdReadFeedback } from "../../components/read-feedback-scope";
import { useAuth } from "../auth/context";
import { useSettingsAction, useSettingsResource } from "../settings/data";
import { calendarRange } from "./logic";

export function useCalendarScope() {
  const { session, state } = useAuth();
  return {
    api: session.api(),
    epoch: session.epoch(),
    owner: state.user?.id,
    timeZone: state.user?.planningTimezone,
  };
}

/** Today in the account timezone, re-read whenever the app returns to the foreground. */
export function useToday(timeZone: string | undefined): LocalDate | null {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const listener = AppState.addEventListener("change", (state) => {
      if (state === "active") setNow(new Date());
    });
    return () => listener.remove();
  }, []);
  const iso = timeZone ? localDateToIso(localDateAt(now, timeZone)) : null;
  // A stable object per calendar date keeps dependent memos and query keys quiet.
  return useMemo(() => (iso ? parseLocalDate(iso) : null), [iso]);
}

/** Calendar sources share the Settings cache, so a change in either place is seen by both. */
export function useCalendars() {
  return useSettingsResource("calendar-sources", (api) => api.listCalendars());
}

/** One bounded read of `days` local days; the server returns only shown calendars. */
export function useCalendarEvents(from: LocalDate | null, days: number) {
  const { api, epoch, owner, timeZone } = useCalendarScope();
  const range = from && timeZone ? calendarRange(from, days, timeZone) : null;
  return useQuery({
    queryKey: ["calendar", owner, epoch, "events", range?.from, range?.to],
    queryFn: () => {
      if (!range) throw new Error("Your account timezone is unavailable.");
      return api.listEvents(range);
    },
    enabled: !!owner && !!range,
  });
}

/** Opens from the list's copy when present, then confirms against the record itself. */
export function useCalendarEvent(id: string | undefined) {
  const { api, epoch, owner } = useCalendarScope();
  const cache = useQueryClient();
  return useQuery({
    queryKey: ["calendar", owner, epoch, "event", id],
    queryFn: () => api.getEvent(id as string),
    enabled: !!owner && !!id,
    placeholderData: () =>
      cache
        .getQueriesData<CalendarEvent[]>({ queryKey: ["calendar", owner, epoch, "events"] })
        .flatMap(([, events]) => events ?? [])
        .find((event) => event.id === id),
  });
}

/** Pull-to-refresh owns one failure notice for every Calendar read on the page. */
export function useCalendarRefresh(reads: readonly { refetch: () => Promise<unknown> }[]) {
  const { epoch, owner } = useCalendarScope();
  const cache = useQueryClient();
  return async () => {
    const release = holdReadFeedback([
      ...cache.getQueryCache().findAll({ queryKey: ["calendar", owner, epoch] }),
      ...cache
        .getQueryCache()
        .findAll({ queryKey: ["settings", owner, epoch, "calendar-sources"] }),
    ]);
    try {
      const results = await Promise.all(reads.map((read) => read.refetch()));
      if (results.some((result) => (result as { isError?: boolean }).isError))
        throw new Error("Calendar refresh failed");
    } finally {
      release();
    }
  };
}

/** Showing or hiding a calendar is saved to the account, then events are re-read. */
export function useCalendarSelection() {
  const { epoch, owner } = useCalendarScope();
  const action = useSettingsAction();
  const cache = useQueryClient();
  const select = (calendar: Calendar, selected: boolean) =>
    action.run(async (api) => {
      const accepted = await api.setCalendarSelected(calendar.id, selected);
      const queryKey = ["settings", owner, epoch, "calendar-sources"];
      await cache.cancelQueries({ queryKey, exact: true });
      cache.setQueryData<Calendar[]>(queryKey, (records) =>
        records?.map((current) => (current.id === accepted.id ? accepted : current)),
      );
      await cache.invalidateQueries({ queryKey: ["calendar"] });
    });
  return { pending: action.pending, select };
}
