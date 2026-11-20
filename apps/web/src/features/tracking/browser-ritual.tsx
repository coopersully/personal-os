import {
  type RitualActionInput,
  type RitualResponseInput,
  type RitualState,
  ritualShouldPresent,
} from "@personal-os/domain";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { m } from "motion/react";
import { useEffect, useId, useRef, useState } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { api } from "../../api.js";
import { classifyMutationError } from "../../lib/feedback.js";
import { RitualDashboard } from "./ritual-dashboard.js";
import { RitualReadyCard, ritualSkyLayoutId } from "./ritual-ready-card.js";
import { ritualCommitments, ritualEvents } from "./ritual-today.js";
import { RitualWeatherSky, useRitualWeather } from "./ritual-weather-sky.js";

type Snapshot = { state: RitualState; receivedAt: number };
const currentKey = (userId: string) => ["ritual-current", userId];

/**
 * The browser presents the real account occurrence as a resting card that the person opens into a
 * dashboard when ready; it never covers the page by itself. The native shell owns desktop delivery.
 */
export function BrowserRitual({ userId }: { userId: string }) {
  const cache = useQueryClient();
  const owner = useRef(userId);
  owner.current = userId;
  const active = useRef(false);
  const card = useRef<HTMLButtonElement>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const errorToast = useId();
  const lastError = useRef<string | null>(null);
  const [, tick] = useState(0);
  const query = useQuery({
    queryKey: currentKey(userId),
    queryFn: async (): Promise<Snapshot> => ({
      state: await api.getCurrentRitual(),
      receivedAt: performance.now(),
    }),
    staleTime: 0,
    gcTime: 0,
    retry: false,
    refetchInterval: 10_000,
    refetchOnWindowFocus: "always",
    refetchOnReconnect: "always",
  });
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      toast.dismiss(errorToast);
    };
  }, [errorToast]);
  useEffect(() => {
    if (query.error) {
      const message = classifyMutationError(query.error, {
        action: "refresh your ritual",
        safeToRetry: true,
      }).message;
      if (lastError.current !== message) {
        lastError.current = message;
        toast.error(message, {
          id: errorToast,
          action: {
            label: "Retry",
            onClick: () => {
              if (active.current && owner.current === userId) void query.refetch();
            },
          },
        });
      }
    } else lastError.current = null;
  }, [query.error, query.refetch, errorToast, userId]);
  useEffect(() => {
    const refresh = () => {
      void query.refetch();
    };
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [query.refetch]);
  useEffect(() => {
    if (query.data?.state.current?.status !== "pending") return;
    const timer = setInterval(() => tick((value) => value + 1), 1000);
    return () => clearInterval(timer);
  }, [query.data?.state.current?.status]);

  async function accept(state: RitualState, user: string, completed = false) {
    await cache.cancelQueries({ queryKey: currentKey(user), exact: true });
    if (active.current && owner.current === user) {
      cache.setQueryData<Snapshot>(currentKey(user), { state, receivedAt: performance.now() });
      void cache.invalidateQueries({ queryKey: ["ritual-history"] });
      if (completed) {
        void cache.invalidateQueries({ queryKey: ["reminders"] });
        void cache.invalidateQueries({ queryKey: ["tasks"] });
      }
    }
  }
  const response = useMutation({
    mutationFn: ({
      id,
      stepId,
      input,
    }: {
      id: string;
      stepId: string;
      input: RitualResponseInput;
      user: string;
    }) => api.saveRitualResponse(id, stepId, input),
    onMutate: ({ user }) => cache.cancelQueries({ queryKey: currentKey(user), exact: true }),
    onSuccess: (state, { user }) => accept(state, user),
  });
  const action = useMutation({
    mutationFn: ({ id, input }: { id: string; input: RitualActionInput; user: string }) =>
      api.recordRitualAction(id, input),
    onMutate: ({ user }) => cache.cancelQueries({ queryKey: currentKey(user), exact: true }),
    onSuccess: (result, { user, input }) =>
      accept(result.state, user, result.outcome === "applied" && input.kind === "complete"),
  });

  const snapshot = query.data;
  const current = snapshot?.state.current;
  // Use server time plus monotonic elapsed time, independent of the device's wall clock.
  const now = snapshot
    ? Date.parse(snapshot.state.serverNow) + Math.max(0, performance.now() - snapshot.receivedAt)
    : NaN;
  const presenting =
    !!snapshot &&
    !!current &&
    Number.isFinite(now) &&
    ritualShouldPresent(current, new Date(now).toISOString());
  const open = presenting && expanded === current.id;
  // Today's facts are supplementary: the ritual stays usable while they load or fail.
  const brief = useQuery({
    enabled: presenting,
    queryFn: api.getDailyBrief,
    queryKey: ["daily-brief", current?.timeZone],
    refetchInterval: 60_000,
  });
  // Weather is decorative context read outside the query cache, like the sky itself, so a
  // provider outage can never raise the app-wide recovery gate over a ritual.
  const weather = useRitualWeather(presenting);
  if (!presenting) return null;
  const kind = current.definition.kind;
  return (
    <>
      {open ? null : (
        <RitualReadyCard
          ref={card}
          occurrence={current}
          weather={weather}
          now={now}
          dueCount={brief.data ? ritualCommitments(brief.data, now).length : undefined}
          nextEvent={
            brief.data
              ? ritualEvents(brief.data).find(
                  (event) => !event.allDay && Date.parse(event.startsAt) > now,
                )
              : undefined
          }
          onOpen={() => setExpanded(current.id)}
        />
      )}
      <Dialog open={open} onOpenChange={(next) => !next && setExpanded(null)}>
        <DialogContent
          showCloseButton={false}
          className="ritual-fullscreen browser-ritual translate-x-0 translate-y-0"
          onKeyDown={(event) => {
            // Keep app-wide shortcuts from opening a second editor above the ritual.
            // Native copy/paste shortcuts still work because their default is preserved.
            if (event.metaKey || event.ctrlKey) event.stopPropagation();
          }}
          onCloseAutoFocus={(event) => {
            // The card remounts as the dashboard leaves; return focus to it once it exists.
            event.preventDefault();
            requestAnimationFrame(() => card.current?.focus({ preventScroll: true }));
          }}
        >
          <DialogTitle className="sr-only">
            {kind === "night" ? "Evening ritual" : "Morning ritual"}
          </DialogTitle>
          <DialogDescription className="sr-only">
            Today’s schedule, tasks, and your ritual steps. Minimize to return to your page.
          </DialogDescription>
          <m.div
            layout
            layoutId={ritualSkyLayoutId}
            className="ritual-surface ritual-dashboard-surface"
            data-ritual-kind={kind}
            style={{ borderRadius: 0 }}
          >
            <RitualWeatherSky
              key={current.id}
              occurrenceId={current.id}
              kind={kind}
              timeZone={current.timeZone}
              observed={{ weather }}
            />
            <RitualDashboard
              state={snapshot.state}
              now={now}
              brief={brief}
              weather={weather}
              onMinimize={() => setExpanded(null)}
              saveResponse={(stepId, input) =>
                response.mutateAsync({ id: current.id, stepId, input, user: userId })
              }
              act={(input) => action.mutateAsync({ id: current.id, input, user: userId })}
            />
          </m.div>
        </DialogContent>
      </Dialog>
    </>
  );
}
