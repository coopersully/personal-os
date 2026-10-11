import type { QueryClient } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";

const cleanups = new WeakMap<QueryClient, Set<() => void>>();
export function registerSessionCleanup(cache: QueryClient, cleanup: () => void) {
  let entries = cleanups.get(cache);
  if (!entries) {
    entries = new Set();
    cleanups.set(cache, entries);
  }
  entries.add(cleanup);
}

const accountIdentity = (cache: QueryClient) =>
  cache.getQueryData<{ id: string }>(["me"])?.id ?? null;
export type PreferenceSession = { owner: string | null; epoch: number };
const sessions = new WeakMap<QueryClient, PreferenceSession>();
export function preferenceSession(cache: QueryClient): PreferenceSession {
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
    cache.removeQueries({ queryKey: ["workspace-settings-recovery"] });
    cache.removeQueries({ queryKey: ["workspace-settings"] });
    cache.removeQueries({ queryKey: ["execution-policy"] });
    cache.removeQueries({ queryKey: ["notification-status"] });
    for (const cleanup of cleanups.get(cache) ?? []) cleanup();
  });
  return session;
}
export function sameSession(cache: QueryClient, captured: PreferenceSession) {
  const current = preferenceSession(cache);
  return !!captured.owner && current.owner === captured.owner && current.epoch === captured.epoch;
}
export function usePreferenceSession(cache: QueryClient) {
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
