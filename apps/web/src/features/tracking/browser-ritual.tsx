import {
  type RitualActionInput,
  type RitualResponseInput,
  type RitualState,
  ritualShouldPresent,
} from "@personal-os/domain";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useRef, useState } from "react";
import { toast } from "sonner";
import { api } from "../../api.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "../../components/ui/dialog.js";
import { classifyMutationError } from "../../lib/feedback.js";
import { RitualChecklist } from "./ritual-overlay.js";

type Snapshot = { state: RitualState; receivedAt: number };
const currentKey = (userId: string) => ["ritual-current", userId];

/** The browser presents the real account occurrence; the native shell owns desktop delivery. */
export function BrowserRitual({ userId }: { userId: string }) {
  const cache = useQueryClient();
  const owner = useRef(userId);
  owner.current = userId;
  const active = useRef(false);
  const previousFocus = useRef<HTMLElement | null>(null);
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
  if (
    !snapshot ||
    !current ||
    !Number.isFinite(now) ||
    !ritualShouldPresent(current, new Date(now).toISOString())
  )
    return null;
  return (
    <Dialog open>
      <DialogContent
        showCloseButton={false}
        className="browser-ritual inset-0 left-0 top-0 h-dvh w-screen max-w-none translate-x-0 translate-y-0 gap-0 rounded-none bg-background/70 p-0 sm:max-w-none"
        onEscapeKeyDown={(event) => event.preventDefault()}
        onKeyDown={(event) => {
          // Keep app-wide shortcuts from opening a second editor above the ritual.
          // Native copy/paste shortcuts still work because their default is preserved.
          if (event.metaKey || event.ctrlKey) event.stopPropagation();
        }}
        onInteractOutside={(event) => event.preventDefault()}
        onOpenAutoFocus={(event) => {
          previousFocus.current =
            document.activeElement instanceof HTMLElement ? document.activeElement : null;
          const question = document.querySelector<HTMLElement>(
            '[aria-label="Ritual questions"] [data-slot="card-content"] :is(button, input, textarea, select):not([disabled])',
          );
          if (question) {
            event.preventDefault();
            question.focus({ preventScroll: true });
          }
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          if (previousFocus.current?.isConnected)
            previousFocus.current.focus({ preventScroll: true });
        }}
      >
        <DialogTitle className="sr-only">
          {current.definition.kind === "night" ? "Evening ritual" : "Morning ritual"}
        </DialogTitle>
        <DialogDescription className="sr-only">
          Complete, snooze, or skip your ritual to return to your page.
        </DialogDescription>
        <div className="ritual-surface" data-ritual-kind={current.definition.kind}>
          <div className="flex max-h-full min-h-0 w-full max-w-lg flex-col items-center">
            <RitualChecklist
              key={`${userId}:${current.id}`}
              state={snapshot.state}
              saveResponse={(stepId, input) =>
                response.mutateAsync({ id: current.id, stepId, input, user: userId })
              }
              act={(input) => action.mutateAsync({ id: current.id, input, user: userId })}
            />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
