import { ApiClientError } from "@personal-os/api-client";
import type {
  Calendar,
  CalendarEvent,
  CreateEventInput,
  EventBlockMode,
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
import {
  type BlockTarget,
  blockModeLabels,
  isUnlinkedCopy,
  looksLikeOccurrence,
} from "./event-blocks";
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

/** How a new block reads on the other calendar: the saved busy-block privacy, or Busy. */
export function useSavedBlockMode(): { ready: boolean; mode: EventBlockMode } {
  const guidance = useSettingsResource("guidance-calendar", (api) =>
    api.getDomainProfile("calendar"),
  );
  return {
    ready: !guidance.isPending,
    mode:
      guidance.data?.status === "active" && guidance.data.preferences.busyBlockPrivacy === "details"
        ? "details"
        : "busy",
  };
}

/**
 * The events on shown calendars around one span of time, for conflict checks. Nothing is kept
 * from an earlier span, so a result always belongs to the time on screen.
 */
export function useEventsDuring(span: { startsAt: string; endsAt: string } | null) {
  const { api, epoch, owner } = useCalendarScope();
  return useQuery({
    queryKey: ["calendar", owner, epoch, "events", span?.startsAt, span?.endsAt],
    queryFn: () => api.listEvents({ from: span?.startsAt as string, to: span?.endsAt as string }),
    enabled: !!owner && !!span,
    // The check's own retry control is its one failure notice.
    meta: { scopedReadFeedback: true },
  });
}

/**
 * An event with everything that bears on blocking it. One record carries only the blocks linked
 * to itself and its own calendar; when the same occurrence sits on several calendars, the list
 * read is what names those calendars and the blocks linked to the other copies.
 */
export function useEventOccurrence(event: CalendarEvent | undefined) {
  const read = useEventsDuring(event ? { startsAt: event.startsAt, endsAt: event.endsAt } : null);
  // The list shows one record per occurrence, which may be its copy on another calendar. A
  // record under another id is taken for this event only on proof: it carries a block linked
  // to this very event. A look-alike alone could be another meeting, whose blocks must never
  // be changed from here.
  const listed =
    event &&
    (read.data?.find((candidate) => candidate.id === event.id) ??
      read.data?.find(
        (candidate) =>
          looksLikeOccurrence(candidate, event) &&
          (candidate.blocks ?? []).some((block) => block.sourceEventId === event.id),
      ));
  const merged = useMemo(() => {
    if (!event || !listed) return event;
    // The record is the newer authority for its own blocks; the list adds the other copies'.
    const own = event.blocks ?? [];
    const others = (listed.blocks ?? []).filter(
      (block) =>
        block.sourceEventId &&
        block.sourceEventId !== event.id &&
        !own.some((mine) => mine.eventId === block.eventId),
    );
    return {
      ...event,
      blocks: [...own, ...others],
      sourceCalendarIds: listed.sourceCalendarIds ?? event.sourceCalendarIds,
    };
  }, [event, listed]);
  return { read, event: merged };
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

function timeZoneOf(user: { planningTimezone?: string | null } | null | undefined) {
  return user?.planningTimezone ?? "UTC";
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

/** A check before a repeat write stopped it, so nothing was sent; the message says why. */
class NothingSent extends Error {}
const unreadable = "Couldn’t check your calendar, so nothing was sent. Try again in a moment.";

type WriteCopy = {
  pending: string;
  done: string;
  unconfirmed: string;
  /** The provider has the new record although nohmi does not. */
  landed?: string;
  /** The record changed elsewhere; for writes that have no draft to keep. */
  conflict?: string;
};

/**
 * A block attempt whose result was never confirmed: what was sent, and when the destination
 * calendar had last synced. Until that calendar syncs again nohmi cannot see whether the
 * provider took the copy, so nothing is sent again before then.
 */
type UnsettledBlock = {
  mode: EventBlockMode;
  source: CalendarEvent;
  /** Undefined while the sync time at the attempt is not known; null for never synced. */
  syncedAt?: string | null;
};
/** Kept per cache, so per signed-in app, and keyed by owner, session, event and calendar. */
const unsettledBlocks = new WeakMap<object, Map<string, UnsettledBlock>>();

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
      /** Offered on the error toast after a plain refusal; never after a conflict, a missing
       * record or an unconfirmed result. */
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
      if (error instanceof NothingSent) {
        toast.error(error.message, { id });
        return { ok: false, reason: "unchecked" };
      }
      const reason = eventWriteFailure(error);
      if (reason !== "rejected") refresh(captured);
      if (createdAtProvider(error)) {
        toast.error(
          copy.landed ??
            "Your calendar provider has this event, but nohmi couldn’t record it yet. It will appear after the next sync.",
          { id },
        );
        return { ok: false, reason: "landed" };
      }
      let used = false;
      const message =
        reason === "uncertain"
          ? copy.unconfirmed
          : (reason === "conflict" && copy.conflict) || errorMessage(error);
      toast.error(message, {
        id,
        ...(retry &&
          reason === "rejected" && {
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
  const unsettled = () => {
    const known = unsettledBlocks.get(cache) ?? new Map<string, UnsettledBlock>();
    unsettledBlocks.set(cache, known);
    return known;
  };
  /** The API's copy of the event is shown at once, then everything is read again. */
  const keepAndReread = (event: CalendarEvent, captured: Scope) => {
    keep(event, captured);
    return "";
  };
  /**
   * Changes every linked copy on one calendar. Once one of them has changed, a later failure
   * is reported as unconfirmed, because the calendar is no longer as it was.
   */
  async function eachBlock(
    event: CalendarEvent,
    blocks: BlockTarget["blocks"],
    change: (source: string, block: BlockTarget["blocks"][number]) => Promise<CalendarEvent>,
  ) {
    let latest = event;
    let changed = false;
    for (const block of blocks) {
      try {
        latest = await change(block.sourceEventId ?? event.id, block);
        changed = true;
      } catch (error) {
        throw changed ? new Error("Only part of the change was applied.") : error;
      }
    }
    return latest;
  }
  /** The event's revision is only known for the event on screen, not for its other copies. */
  const blockRevision = (
    event: CalendarEvent,
    source: string,
    block: BlockTarget["blocks"][number],
  ) => ({
    expectedBlockUpdatedAt: block.updatedAt,
    ...(source === event.id && { expectedUpdatedAt: event.updatedAt }),
  });
  const changedElsewhere =
    "This event or its blocks changed elsewhere, so nothing was sent. The latest is shown now.";
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
              throw new NothingSent(unreadable);
            });
          return existing.find(isSame) ?? api.createEvent(input);
        },
        keep,
      ),
    /**
     * Blocks the event's time on another calendar. After an attempt that was never confirmed,
     * the event and that calendar are read first: nothing is sent when the block is already
     * linked, when an unlinked copy would be duplicated, or when the calendar cannot be read.
     */
    block: async (event: CalendarEvent, { calendar }: BlockTarget, mode: EventBlockMode) => {
      const key = `${scope.owner}:${scope.epoch}:${event.id}:${calendar.id}`;
      const earlier = unsettled().get(key);
      let sent = event;
      const name = calendar.name;
      const result = await run(
        {
          pending: "Blocking time…",
          done: `Time blocked on ${name}`,
          unconfirmed:
            calendar.provider === "local"
              ? `Couldn’t confirm the time was blocked on ${name}. nohmi re-reads the event before blocking there again.`
              : `Couldn’t confirm the time was blocked on ${name}. nohmi re-reads the event, and ${name} once it has synced, before blocking there again.`,
          landed: `${name} has this time, but nohmi couldn’t link it to the event. Check ${name} after it next syncs.`,
          conflict: changedElsewhere,
        },
        async (api) => {
          let current = event;
          sent = event;
          if (earlier) {
            const unread = () => {
              throw new NothingSent(unreadable);
            };
            current = await api.getEvent(event.id).catch(unread);
            if (current.blocks.some((block) => block.calendarId === calendar.id)) return current;
            // A nohmi calendar has no provider that could hold a copy nohmi cannot see.
            if (calendar.provider !== "local") {
              // Events are read from shown calendars only, so a hidden one cannot be checked.
              if (!calendar.isSelected)
                throw new NothingSent(
                  `nohmi can’t check ${name} while it is hidden, so nothing was sent. Show it in Calendar, or check it in your calendar app.`,
                );
              const latest = (await api.listCalendars().catch(unread)).find(
                (candidate) => candidate.id === calendar.id,
              );
              // With no sync time from the attempt, this one becomes the mark to get past.
              const unknown = earlier.syncedAt === undefined;
              if (unknown) earlier.syncedAt = latest?.lastSyncedAt ?? null;
              if (unknown || !latest?.lastSyncedAt || latest.lastSyncedAt === earlier.syncedAt)
                throw new NothingSent(
                  `${name} hasn’t synced since the earlier attempt, so nothing was sent. Try again after it syncs.`,
                );
              const day = 86_400_000;
              const { source } = earlier;
              const copies = (
                await api
                  .listEvents({
                    // A day either side covers all-day events, which providers date in UTC.
                    from: new Date(new Date(source.startsAt).getTime() - day).toISOString(),
                    to: new Date(new Date(source.endsAt).getTime() + day).toISOString(),
                    calendarIds: [calendar.id],
                  })
                  .catch(unread)
              ).filter((found) =>
                // The copy is whatever the earlier attempt sent, not what is chosen now.
                isUnlinkedCopy(found, source, calendar.id, earlier.mode, timeZoneOf(state.user)),
              );
              // The API links exactly one unlinked Busy copy at the very same instants instead
              // of writing another. Any other copy would be left beside a second one.
              const [only] = copies;
              const linkable =
                mode === "busy" &&
                earlier.mode === "busy" &&
                copies.length === 1 &&
                only?.startsAt === current.startsAt &&
                only.endsAt === current.endsAt;
              if (copies.length && !linkable)
                throw new NothingSent(
                  `${name} already has this time from the earlier attempt, but it isn’t linked to the event. Remove it in your calendar app before blocking again.`,
                );
            }
          }
          sent = current;
          return api.createEventBlock(event.id, {
            calendarId: calendar.id,
            mode,
            expectedUpdatedAt: current.updatedAt,
          });
        },
        keepAndReread,
      );
      if (result.ok) unsettled().delete(key);
      else if (result.reason === "uncertain" || result.reason === "landed") {
        // Recorded at once, so no tap can slip through unchecked while the sync time is read.
        // What a copy would look like is what this attempt sent, which a check may have re-read.
        const attempt: UnsettledBlock = { mode, source: sent };
        unsettled().set(key, attempt);
        // The page's calendars may be minutes old, so only a fresh read counts as the sync
        // time at this attempt. Without one it stays unknown and the next attempt sets it.
        await session
          .api()
          .listCalendars()
          .then((all) => {
            const latest = all.find((candidate) => candidate.id === calendar.id);
            if (attempt.syncedAt === undefined) attempt.syncedAt = latest?.lastSyncedAt ?? null;
          })
          .catch(() => {});
      }
      return result;
    },
    /** Changes whether a block shows Busy or the event's details on its calendar. */
    setBlockMode: (event: CalendarEvent, { calendar, blocks }: BlockTarget, mode: EventBlockMode) =>
      run(
        {
          pending: "Changing block…",
          done: `${calendar.name} now shows ${blockModeLabels[mode]}`,
          unconfirmed: `Couldn’t confirm the change on ${calendar.name}. Check the block before trying again.`,
          conflict: changedElsewhere,
        },
        (api) =>
          eachBlock(
            event,
            blocks.filter((block) => block.mode !== mode),
            (source, block) =>
              api.updateEventBlock(source, block.eventId, {
                mode,
                ...blockRevision(event, source, block),
              }),
          ),
        keepAndReread,
      ),
    unblock: (event: CalendarEvent, { calendar, blocks }: BlockTarget) =>
      run(
        {
          pending: "Removing block…",
          done: `Block removed from ${calendar.name}`,
          unconfirmed: `Couldn’t confirm the block was removed from ${calendar.name}. Check the block before trying again.`,
          conflict: changedElsewhere,
        },
        (api) =>
          eachBlock(event, blocks, (source, block) =>
            api.deleteEventBlock(source, block.eventId, blockRevision(event, source, block)),
          ),
        keepAndReread,
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
