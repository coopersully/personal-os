import type { UpdateWorkspaceSettings, Workspace, WorkspaceSettings } from "@personal-os/domain";
import { useEffect, useRef, useSyncExternalStore } from "react";
import { useAuth } from "../auth/context";
import { createPreferenceQueue } from "./preferences";

const queues = new WeakMap<object, Map<string, unknown>>();
/** Local sibling editors share a revision; unseen remote writes still conflict. */
export function useWorkspacePreferenceQueue<W extends Workspace>(initial: WorkspaceSettings<W>) {
  const { session } = useAuth();
  const epoch = session.epoch();
  let entries = queues.get(session);
  if (!entries) {
    entries = new Map();
    queues.set(session, entries);
  }
  const key = `${epoch}:${initial.workspace}`;
  type Store = {
    queue: ReturnType<typeof createPreferenceQueue<WorkspaceSettings<W>>>;
    mounts: number;
  };
  let store = entries.get(key) as Store | undefined;
  if (!store) {
    const api = session.api();
    const queue = createPreferenceQueue(initial, async (expectedRevision, preferences) => {
      if (session.epoch() !== epoch)
        throw new Error("Your session changed. Reopen settings before saving.");
      const next = await api.updateWorkspaceSettings(initial.workspace, {
        expectedRevision,
        preferences: preferences as UpdateWorkspaceSettings<W>["preferences"],
      });
      if (session.epoch() !== epoch)
        throw new Error("Your session changed. Reopen settings before saving.");
      return next;
    });
    store = { queue, mounts: 0 };
    entries.set(key, store);
  }
  const captured = store;
  const opened = useRef(initial);
  const mayReconcile = useRef(false);
  const snapshot = useSyncExternalStore(
    captured.queue.subscribe,
    captured.queue.snapshot,
    captured.queue.snapshot,
  );
  useEffect(() => {
    mayReconcile.current = captured.mounts === 0;
    captured.mounts += 1;
    return () => {
      captured.mounts -= 1;
    };
  }, [captured]);
  useEffect(() => {
    if (captured.queue.snapshot() !== snapshot || !mayReconcile.current || captured.queue.pending)
      return;
    mayReconcile.current = false;
    // Fresh reopening can reconcile an idle, resolved queue; uncertain writes
    // always require the visible explicit reload/review path.
    if (!captured.queue.blocked && opened.current.revision > captured.queue.current.revision)
      captured.queue.recover(opened.current);
  }, [captured, snapshot]);
  return captured.queue;
}
