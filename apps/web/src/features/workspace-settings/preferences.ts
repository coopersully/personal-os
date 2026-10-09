import type { Workspace, WorkspacePreferences, WorkspaceSettings } from "@personal-os/domain";
import {
  type MutateOptions,
  type QueryClient,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useId, useSyncExternalStore } from "react";
import { api } from "@/api";
import { classifyMutationError } from "@/lib/feedback";
import { useFeedbackMutation } from "@/lib/use-feedback-mutation";

export const workspaceSettingsKey = (workspace: Workspace) =>
  ["workspace-settings", workspace] as const;
export function useWorkspacePreferences<W extends Workspace>(workspace: W) {
  const cache = useQueryClient();
  const session = usePreferenceSession(cache);
  return useQuery({
    queryKey: workspaceSettingsKey(workspace),
    enabled: !!session.owner,
    queryFn: async () => {
      const started = { ...preferenceSession(cache) };
      if (!started.owner) throw new Error("Load your account before reading preferences.");
      const settings = await api.getWorkspaceSettings(workspace);
      if (!sameSession(cache, started))
        throw new Error("Your account session changed. Reload preferences.");
      return settings;
    },
    staleTime: 60_000,
  });
}
export type WorkspacePreferenceChange<W extends Workspace> =
  | Partial<WorkspacePreferences<W>>
  | ((current: WorkspacePreferences<W>) => Partial<WorkspacePreferences<W>>);
type SaveAttempt<W extends Workspace> = {
  change: WorkspacePreferenceChange<W>;
  observed: WorkspaceSettings<W> | undefined;
  attempted?: Partial<WorkspacePreferences<W>>;
  sequence: number;
  session: PreferenceSession;
  queue: SaveQueue;
};
type SaveQueue = {
  pending: number;
  sequence: number;
  successfulFields: Map<string, number>;
  advances: Map<number, WorkspaceSettings<Workspace>>;
};
type PreferenceRecovery<W extends Workspace> = {
  attempted: Partial<WorkspacePreferences<W>>;
  fieldSequences: Record<string, number>;
  outcome: "conflict" | "uncertain" | "rejected";
  reviewed?: WorkspaceSettings<W>;
};
const recoveryPrefix = "workspace-settings-recovery";
const accountIdentity = (cache: QueryClient) =>
  cache.getQueryData<{ id: string }>(["me"])?.id ?? null;
type PreferenceSession = { owner: string | null; epoch: number };
const sessions = new WeakMap<QueryClient, PreferenceSession>();
function preferenceSession(cache: QueryClient): PreferenceSession {
  let state = sessions.get(cache);
  if (state) return state;
  state = { owner: accountIdentity(cache), epoch: 0 };
  sessions.set(cache, state);
  const session = state;
  cache.getQueryCache().subscribe((event) => {
    if (event.query.queryKey.length !== 1 || event.query.queryKey[0] !== "me") return;
    const next = accountIdentity(cache);
    if (next === session.owner) return;
    session.owner = next;
    session.epoch++;
    cache.removeQueries({ queryKey: [recoveryPrefix] });
    cache.removeQueries({ queryKey: ["workspace-settings"] });
    queues.get(cache)?.clear();
  });
  return session;
}
function sameSession(cache: QueryClient, captured: PreferenceSession) {
  const current = preferenceSession(cache);
  return !!captured.owner && current.owner === captured.owner && current.epoch === captured.epoch;
}
function usePreferenceSession(cache: QueryClient) {
  preferenceSession(cache);
  useSyncExternalStore(
    (changed) =>
      cache.getQueryCache().subscribe((event) => {
        if (event.query.queryKey[0] === "me") changed();
      }),
    () => preferenceSession(cache).epoch,
    () => preferenceSession(cache).epoch,
  );
  return { ...preferenceSession(cache) };
}
const queues = new WeakMap<QueryClient, Map<string, SaveQueue>>();

export function useSaveWorkspacePreferences<W extends Workspace>(workspace: W) {
  const cache = useQueryClient();
  // Bind the intent to what this render observed, not a later server read.
  const query = useWorkspacePreferences(workspace);
  const observed = query.data;
  const session = usePreferenceSession(cache);
  const owner = session.owner;
  const unidentifiedHook = useId();
  const identity = owner ?? `unidentified:${unidentifiedHook}`;
  const recoveryKey = [recoveryPrefix, identity, session.epoch, workspace] as const;
  const recoveryQuery = useQuery<PreferenceRecovery<W> | null>({
    queryKey: recoveryKey,
    queryFn: async () => null,
    initialData: null,
    enabled: false,
    gcTime: Number.POSITIVE_INFINITY,
  });
  const recovery = sameSession(cache, session) ? (recoveryQuery.data ?? undefined) : undefined;
  const currentOwner = () => sameSession(cache, session);
  const setRecovery = (
    update: (previous: PreferenceRecovery<W> | undefined) => PreferenceRecovery<W> | undefined,
  ) => {
    if (!currentOwner()) return;
    cache.setQueryData<PreferenceRecovery<W> | null>(
      recoveryKey,
      (previous) => update(previous ?? undefined) ?? null,
    );
  };
  const queueKey = `${identity}:${session.epoch}:${workspace}`;
  let workspaceQueues = queues.get(cache);
  if (!workspaceQueues) {
    workspaceQueues = new Map();
    queues.set(cache, workspaceQueues);
  }
  let queue = workspaceQueues.get(queueKey);
  if (!queue) {
    queue = { pending: 0, sequence: 0, successfulFields: new Map(), advances: new Map() };
    workspaceQueues.set(queueKey, queue);
  }
  const saves = queue;
  const mutation = useFeedbackMutation({
    scope: { id: `workspace-settings:${identity}:${session.epoch}:${workspace}` },
    feedback: { action: "save workspace preferences", safeToRetry: false },
    mutationFn: async (attempt: SaveAttempt<W>) => {
      const { change, observed, queue: saves } = attempt;
      if (!sameSession(cache, attempt.session))
        throw new Error("Load your account before saving preferences.");
      if (!observed) throw new Error("Load workspace preferences before saving.");
      let current = observed;
      // Only our successful queued writes can advance this observed revision.
      // An unseen remote write must reach the API with a stale revision and conflict.
      let next = saves.advances.get(current.revision);
      while (next) {
        current = next as WorkspaceSettings<W>;
        next = saves.advances.get(current.revision);
      }
      const preferences =
        typeof change === "function"
          ? change(current.preferences as WorkspacePreferences<W>)
          : change;
      attempt.attempted = preferences;
      const data = await api.updateWorkspaceSettings(workspace, {
        expectedRevision: current.revision,
        preferences,
      });
      if (sameSession(cache, attempt.session)) saves.advances.set(current.revision, data);
      return data;
    },
    onSuccess: async (data: WorkspaceSettings<W>, attempt: SaveAttempt<W>) => {
      if (!sameSession(cache, attempt.session)) return;
      const saves = attempt.queue;
      for (const key of Object.keys(attempt.attempted ?? {}))
        saves.successfulFields.set(key, attempt.sequence);
      setRecovery((previous) => {
        if (!previous) return previous;
        const attempted = { ...previous.attempted };
        const fieldSequences = { ...previous.fieldSequences };
        for (const key of Object.keys(attempt.attempted ?? {})) {
          if (attempt.sequence < (fieldSequences[key] ?? 0)) continue;
          if (
            JSON.stringify((attempted as Record<string, unknown>)[key]) !==
            JSON.stringify((data.preferences as Record<string, unknown>)[key])
          )
            continue;
          delete (attempted as Record<string, unknown>)[key];
          delete fieldSequences[key];
        }
        const { reviewed: _reviewed, ...unreviewed } = previous;
        return Object.keys(attempted).length
          ? { ...unreviewed, attempted, fieldSequences }
          : undefined;
      });
      if (!sameSession(cache, attempt.session)) return;
      await cache.cancelQueries({ queryKey: workspaceSettingsKey(workspace) });
      if (!sameSession(cache, attempt.session)) return;
      cache.setQueryData(workspaceSettingsKey(workspace), data);
      if (workspace === "finances")
        void cache.invalidateQueries({ queryKey: ["finance-configuration"] });
    },
    onError: (error, attempt) => {
      if (!sameSession(cache, attempt.session)) return;
      const saves = attempt.queue;
      if (attempt.attempted)
        setRecovery((previous) => {
          const attempted = { ...previous?.attempted } as Partial<WorkspacePreferences<W>>;
          const fieldSequences = { ...previous?.fieldSequences };
          for (const [key, value] of Object.entries(attempt.attempted ?? {})) {
            if (
              (saves.successfulFields.get(key) ?? 0) >= attempt.sequence ||
              (fieldSequences[key] ?? 0) > attempt.sequence
            )
              continue;
            (attempted as Record<string, unknown>)[key] = value;
            fieldSequences[key] = attempt.sequence;
          }
          const kind = classifyMutationError(error, {
            action: "save workspace preferences",
            safeToRetry: false,
          }).kind;
          return Object.keys(attempted).length
            ? {
                attempted,
                fieldSequences,
                outcome:
                  kind === "conflict"
                    ? "conflict"
                    : kind === "uncertain"
                      ? "uncertain"
                      : "rejected",
              }
            : undefined;
        });
      if (!currentOwner()) return;
      void cache.invalidateQueries({ queryKey: workspaceSettingsKey(workspace) });
    },
    onSettled: (_data, _error, attempt) => {
      if (--attempt.queue.pending === 0) attempt.queue.advances.clear();
    },
  });
  type Caller = MutateOptions<WorkspaceSettings<W>, Error, WorkspacePreferenceChange<W>, unknown>;
  function callbacks(
    caller?: Caller,
  ): MutateOptions<WorkspaceSettings<W>, Error, SaveAttempt<W>, unknown> | undefined {
    if (!caller) return undefined;
    return {
      onSuccess: (data, attempt, result, context) =>
        sameSession(cache, attempt.session)
          ? caller.onSuccess?.(data, attempt.change, result, context)
          : undefined,
      onError: (error, attempt, result, context) =>
        sameSession(cache, attempt.session)
          ? caller.onError?.(error, attempt.change, result, context)
          : undefined,
      onSettled: (data, error, attempt, result, context) =>
        sameSession(cache, attempt.session)
          ? caller.onSettled?.(data, error, attempt.change, result, context)
          : undefined,
    };
  }
  return {
    ...mutation,
    variables: mutation.variables?.change,
    feedback:
      mutation.variables && sameSession(cache, mutation.variables.session)
        ? mutation.feedback
        : null,
    recovery,
    refreshRecovery: async () => {
      if (!currentOwner()) return;
      setRecovery((current) => {
        if (!current) return current;
        const { reviewed: _reviewed, ...unreviewed } = current;
        return unreviewed;
      });
      const latest = await query.refetch();
      const reviewed = latest.data;
      if (!latest.isError && reviewed)
        setRecovery((current) => (current ? { ...current, reviewed } : current));
    },
    acceptLatest: () => {
      setRecovery(() => undefined);
      mutation.reset();
    },
    reapplyReviewed: () => {
      if (!recovery?.reviewed) return;
      saves.pending++;
      mutation.mutate({
        change: recovery.attempted,
        observed: recovery.reviewed,
        sequence: ++saves.sequence,
        session,
        queue: saves,
      });
    },
    mutate: (change: WorkspacePreferenceChange<W>, caller?: Caller) => {
      saves.pending++;
      mutation.mutate(
        { change, observed, sequence: ++saves.sequence, session, queue: saves },
        callbacks(caller),
      );
    },
    mutateAsync: (change: WorkspacePreferenceChange<W>, caller?: Caller) => {
      saves.pending++;
      return mutation.mutateAsync(
        { change, observed, sequence: ++saves.sequence, session, queue: saves },
        callbacks(caller),
      );
    },
  };
}
