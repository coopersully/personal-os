import type { Workspace, WorkspacePreferences, WorkspaceSettings } from "@personal-os/domain";
import {
  type MutateOptions,
  type QueryClient,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { api } from "@/api";
import { useFeedbackMutation } from "@/lib/use-feedback-mutation";

export const workspaceSettingsKey = (workspace: Workspace) =>
  ["workspace-settings", workspace] as const;
export function useWorkspacePreferences<W extends Workspace>(workspace: W) {
  return useQuery({
    queryKey: workspaceSettingsKey(workspace),
    queryFn: () => api.getWorkspaceSettings(workspace),
    staleTime: 60_000,
  });
}
export type WorkspacePreferenceChange<W extends Workspace> =
  | Partial<WorkspacePreferences<W>>
  | ((current: WorkspacePreferences<W>) => Partial<WorkspacePreferences<W>>);
type SaveAttempt<W extends Workspace> = {
  change: WorkspacePreferenceChange<W>;
  observed: WorkspaceSettings<W> | undefined;
};
type SaveQueue = { pending: number; advances: Map<number, WorkspaceSettings<Workspace>> };
const queues = new WeakMap<QueryClient, Map<Workspace, SaveQueue>>();

export function useSaveWorkspacePreferences<W extends Workspace>(workspace: W) {
  const cache = useQueryClient();
  // Bind the intent to what this render observed, not a later server read.
  const observed = useWorkspacePreferences(workspace).data;
  let workspaceQueues = queues.get(cache);
  if (!workspaceQueues) {
    workspaceQueues = new Map();
    queues.set(cache, workspaceQueues);
  }
  let queue = workspaceQueues.get(workspace);
  if (!queue) {
    queue = { pending: 0, advances: new Map() };
    workspaceQueues.set(workspace, queue);
  }
  const saves = queue;
  const mutation = useFeedbackMutation({
    scope: { id: `workspace-settings:${workspace}` },
    feedback: { action: "save workspace preferences", safeToRetry: false },
    mutationFn: async ({ change, observed }: SaveAttempt<W>) => {
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
      const data = await api.updateWorkspaceSettings(workspace, {
        expectedRevision: current.revision,
        preferences,
      });
      saves.advances.set(current.revision, data);
      return data;
    },
    onSuccess: async (data: WorkspaceSettings<W>) => {
      await cache.cancelQueries({ queryKey: workspaceSettingsKey(workspace) });
      cache.setQueryData(workspaceSettingsKey(workspace), data);
      if (workspace === "finances")
        void cache.invalidateQueries({ queryKey: ["finance-configuration"] });
    },
    onError: () => {
      void cache.invalidateQueries({ queryKey: workspaceSettingsKey(workspace) });
    },
    onSettled: () => {
      if (--saves.pending === 0) saves.advances.clear();
    },
  });
  type Caller = MutateOptions<WorkspaceSettings<W>, Error, WorkspacePreferenceChange<W>, unknown>;
  function callbacks(
    caller?: Caller,
  ): MutateOptions<WorkspaceSettings<W>, Error, SaveAttempt<W>, unknown> | undefined {
    if (!caller) return undefined;
    return {
      onSuccess: (data, attempt, result, context) =>
        caller.onSuccess?.(data, attempt.change, result, context),
      onError: (error, attempt, result, context) =>
        caller.onError?.(error, attempt.change, result, context),
      onSettled: (data, error, attempt, result, context) =>
        caller.onSettled?.(data, error, attempt.change, result, context),
    };
  }
  return {
    ...mutation,
    variables: mutation.variables?.change,
    mutate: (change: WorkspacePreferenceChange<W>, caller?: Caller) => {
      saves.pending++;
      mutation.mutate({ change, observed }, callbacks(caller));
    },
    mutateAsync: (change: WorkspacePreferenceChange<W>, caller?: Caller) => {
      saves.pending++;
      return mutation.mutateAsync({ change, observed }, callbacks(caller));
    },
  };
}
