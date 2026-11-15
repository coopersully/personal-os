import { ApiClientError } from "@personal-os/api-client";
import type {
  Calendar,
  CalendarEvent,
  CreateEventInput,
  LocalDate,
  UpdateEventInput,
} from "@personal-os/domain";
import {
  getDefaultWorkspacePreferences,
  localDateAt,
  localDateToIso,
  parseLocalDate,
} from "@personal-os/domain";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { AppState } from "react-native";
import { toast } from "sonner-native";
import { holdReadFeedback } from "../../components/read-feedback-scope";
import { useAuth } from "../auth/context";
import { type SettingsApi, useSettingsAction, useSettingsResource } from "../settings/data";
import { errorMessage } from "../tasks/data";
import { canRestoreFaithfully, eventRevision } from "./event-draft";
import { calendarRange, type WeekStart } from "./logic";

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

/**
 * The account's "Week starts on" choice, shared with Settings. Null until it is known, so the
 * week is not read twice; a failed read falls back to the product default after its notice.
 */
export function useWeekStart(): WeekStart | null {
  const settings = useSettingsResource("workspace-calendar", (api) =>
    api.getWorkspaceSettings("calendar"),
  );
  if (settings.isPending) return null;
  return settings.data?.preferences.weekStartsOn ?? "sunday";
}

/** What a new event starts from: the account's event length and approved default calendar. */
export function useEventDefaults() {
  const settings = useSettingsResource("workspace-calendar", (api) =>
    api.getWorkspaceSettings("calendar"),
  );
  const guidance = useSettingsResource("guidance-calendar", (api) =>
    api.getDomainProfile("calendar"),
  );
  const preferred =
    guidance.data?.status === "active" ? guidance.data.preferences.defaultCalendarId : undefined;
  return {
    // A failed read falls back to the product defaults after its own notice.
    ready: !settings.isPending && !guidance.isPending,
    durationMinutes:
      settings.data?.preferences.defaultEventDurationMinutes ??
      getDefaultWorkspacePreferences("calendar").defaultEventDurationMinutes,
    calendarId: typeof preferred === "string" ? preferred : undefined,
  };
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
    // Moving to another week or view keeps the last events on screen until the new ones arrive.
    placeholderData: keepPreviousData,
  });
}

export function isNotFound(error: unknown) {
  return error instanceof ApiClientError && error.status === 404;
}

/** Opens from the list's copy when present, then confirms against the record itself. */
export function useCalendarEvent(id: string | undefined) {
  const { api, epoch, owner } = useCalendarScope();
  const cache = useQueryClient();
  return useQuery({
    queryKey: ["calendar", owner, epoch, "event", id],
    queryFn: () => api.getEvent(id as string),
    enabled: !!owner && !!id,
    // A deleted event will not come back; other failures keep the client's usual retries.
    retry: (failures, error) => {
      if (isNotFound(error)) return false;
      const usual = cache.getDefaultOptions().queries?.retry ?? 3;
      if (typeof usual === "function") return usual(failures, error);
      return typeof usual === "number" ? failures < usual : usual;
    },
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

/**
 * Why a write did not report success. "unchecked" means the calendar could not be read first, so
 * nothing was sent; "landed" means the provider has the new event although nohmi does not yet.
 */
export type EventWriteFailure =
  | "rejected"
  | "conflict"
  | "gone"
  | "uncertain"
  | "unchecked"
  | "landed";
export type EventWriteResult<T> = { ok: true; value: T } | { ok: false; reason: EventWriteFailure };

/**
 * Whether a failed write is known not to have happened. A refusal from the API is certain; a
 * lost connection or a server or provider failure may have changed the calendar anyway.
 */
export function eventWriteFailure(error: unknown): EventWriteFailure {
  if (error instanceof Error && error.name === "ZodError") return "rejected";
  if (!(error instanceof ApiClientError) || error.status >= 500) return "uncertain";
  // A write that touches several calendars can be refused after part of it reached a provider.
  const details = (error.details ?? {}) as Record<string, unknown>;
  const reached = (key: string) => Array.isArray(details[key]) && details[key].length > 0;
  if (
    reached("completedEffects") ||
    reached("indeterminateEffects") ||
    typeof details.partialEffect === "string"
  )
    return "uncertain";
  if (error.status === 409) return "conflict";
  return error.status === 404 ? "gone" : "rejected";
}

/** A failed create whose event the provider did accept; a second create would duplicate it. */
function createdAtProvider(error: unknown) {
  if (!(error instanceof ApiClientError)) return false;
  const details = (error.details ?? {}) as Record<string, unknown>;
  return (
    details.partialEffect === "provider_event_created" ||
    (Array.isArray(details.completedEffects) &&
      details.completedEffects.some(
        (effect) => (effect as { action?: unknown } | null)?.action === "create",
      ))
  );
}

/** The calendar could not be read before a repeat create, so the create was not sent. */
class CalendarCheckFailed extends Error {}

type WriteCopy = { pending: string; done: string; unconfirmed: string };

/**
 * Event writes change the person's real calendar, so each one is a single Sonner toast that
 * reports success only after the API confirms it. Anything short of a clear refusal re-reads
 * the calendar, so the page shows what is actually there before anyone tries again.
 */
export function useEventWrites() {
  const { state, session } = useAuth();
  const cache = useQueryClient();
  const scope = { owner: state.user?.id, epoch: session.epoch() };
  const live = useRef(scope);
  live.current = scope;
  const busy = useRef(false);
  const [pending, setPending] = useState(false);
  type Scope = typeof scope;
  const current = (captured: Scope) =>
    captured.owner === live.current.owner && captured.epoch === session.epoch();
  /**
   * Re-reads the calendar without holding up the write's own result. A settled event's record
   * is only marked stale, so a closing page does not re-read it. The write's toast is the one
   * notice; a re-read that fails raises none of its own.
   */
  const refresh = ({ owner, epoch }: Scope, settled?: string) => {
    const queryKey = ["calendar", owner, epoch];
    const release = holdReadFeedback(cache.getQueryCache().findAll({ queryKey }));
    if (settled)
      void cache.invalidateQueries({
        queryKey: [...queryKey, "event", settled],
        refetchType: "none",
      });
    void cache
      .invalidateQueries({
        queryKey,
        predicate: (query) =>
          !settled || query.queryKey[3] !== "event" || query.queryKey[4] !== settled,
      })
      .finally(release);
  };
  async function run<T>(
    copy: WriteCopy,
    send: (api: SettingsApi) => Promise<T>,
    settle: (value: T, captured: Scope) => string,
    {
      undo,
      retry,
      // Undo stays inside the session that made the change it reverses.
      captured = scope,
    }: {
      undo?: (value: T, captured: Scope) => Promise<unknown>;
      /** Offered on the error toast after a clear refusal; never after an unconfirmed result. */
      retry?: (captured: Scope) => Promise<unknown>;
      captured?: Scope;
    } = {},
  ): Promise<EventWriteResult<T>> {
    if (busy.current || !captured.owner || !current(captured))
      return { ok: false, reason: "rejected" };
    busy.current = true;
    setPending(true);
    const id = toast.loading(copy.pending);
    try {
      const value = await send(session.api());
      if (!current(captured)) {
        toast.dismiss(id);
        return { ok: false, reason: "rejected" };
      }
      refresh(captured, settle(value, captured));
      let used = false;
      toast.success(copy.done, {
        id,
        ...(undo && {
          duration: 10_000,
          action: {
            label: "Undo",
            onClick: () => {
              if (used) return;
              used = true;
              void undo(value, captured);
            },
          },
        }),
      });
      return { ok: true, value };
    } catch (error) {
      if (!current(captured)) {
        toast.dismiss(id);
        return { ok: false, reason: "rejected" };
      }
      if (error instanceof CalendarCheckFailed) {
        toast.error("Couldn’t check your calendar, so nothing was sent. Try again in a moment.", {
          id,
        });
        return { ok: false, reason: "unchecked" };
      }
      const reason = eventWriteFailure(error);
      if (reason !== "rejected") refresh(captured);
      if (createdAtProvider(error)) {
        toast.error(
          "Your calendar provider has this event, but nohmi couldn’t record it yet. It will appear after the next sync.",
          { id },
        );
        return { ok: false, reason: "landed" };
      }
      let used = false;
      toast.error(reason === "uncertain" ? copy.unconfirmed : errorMessage(error), {
        id,
        ...(retry &&
          reason !== "uncertain" && {
            action: {
              label: "Try again",
              onClick: () => {
                if (used) return;
                used = true;
                void retry(captured);
              },
            },
          }),
      });
      return { ok: false, reason };
    } finally {
      busy.current = false;
      setPending(false);
    }
  }
  const keep = (event: CalendarEvent, { owner, epoch }: Scope) => {
    cache.setQueryData(["calendar", owner, epoch, "event", event.id], event);
    return event.id;
  };
  const restore = (
    event: CalendarEvent,
    revision: ReturnType<typeof eventRevision>,
    captured: Scope,
  ): Promise<unknown> =>
    run(
      {
        pending: "Restoring event…",
        done: "Event restored",
        unconfirmed: "Couldn’t confirm the event was restored. Check your calendar.",
      },
      (api) => api.restoreEvent(event.id, revision),
      keep,
      // A refused restore changed nothing, so the person can ask again; an unconfirmed one
      // may have re-created the event and is never repeated from here.
      { captured, retry: (within) => restore(event, revision, within) },
    );
  const createCopy = {
    pending: "Creating event…",
    done: "Event created",
    unconfirmed: "Couldn’t confirm the event was created. Check your calendar before trying again.",
  };
  return {
    pending,
    create: (input: CreateEventInput) => run(createCopy, (api) => api.createEvent(input), keep),
    /**
     * A second attempt after an unconfirmed create. The calendar is read first: if the event is
     * already there the first attempt worked and nothing more is sent, and if the calendar
     * cannot be read nothing is sent either.
     */
    createAfterCheck: (input: CreateEventInput, isSame: (event: CalendarEvent) => boolean) =>
      run(
        createCopy,
        async (api) => {
          const day = 86_400_000;
          const existing = await api
            .listEvents({
              // A day either side covers all-day events, which providers date in UTC.
              from: new Date(new Date(input.startsAt).getTime() - day).toISOString(),
              to: new Date(new Date(input.endsAt).getTime() + day).toISOString(),
              calendarIds: [input.calendarId],
            })
            .catch(() => {
              throw new CalendarCheckFailed();
            });
          return existing.find(isSame) ?? api.createEvent(input);
        },
        keep,
      ),
    update: (event: CalendarEvent, input: UpdateEventInput) =>
      run(
        {
          pending: "Saving event…",
          done: "Event saved",
          unconfirmed: "Couldn’t confirm the event was saved. Check your calendar.",
        },
        (api) => api.updateEvent(event.id, input),
        keep,
      ),
    /**
     * Deleting is recoverable: the confirmed result offers Undo, which restores the event,
     * unless restoring would bring back something different from what was deleted.
     */
    remove: (event: CalendarEvent) =>
      run(
        {
          pending: "Deleting event…",
          done: "Event deleted",
          unconfirmed: "Couldn’t confirm the event was deleted. Check your calendar.",
        },
        (api) => api.trashEvent(event.id, eventRevision(event)),
        () => event.id,
        {
          undo: canRestoreFaithfully(event)
            ? (revision, captured) =>
                restore(
                  event,
                  {
                    expectedUpdatedAt: revision.updatedAt,
                    expectedBlockUpdatedAtById: revision.blockUpdatedAtById,
                  },
                  captured,
                )
            : undefined,
        },
      ),
  };
}
