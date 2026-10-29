import { ApiClientError } from "@personal-os/api-client";
import type { QueryClient } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";
import { preferenceSession } from "../workspace-settings/account-save-session";

type Access = {
  owner: string | null;
  epoch: number;
  generation: number;
  denied: boolean;
  error: ApiClientError | null;
};
const accessByClient = new WeakMap<QueryClient, Access>();
const listenersByClient = new WeakMap<QueryClient, Set<() => void>>();
function access(client: QueryClient): Access {
  const session = preferenceSession(client);
  let state = accessByClient.get(client);
  if (!state || state.owner !== session.owner || state.epoch !== session.epoch) {
    state = { ...session, generation: (state?.generation ?? 0) + 1, denied: false, error: null };
    accessByClient.set(client, state);
  }
  return state;
}
function publish(client: QueryClient, next: Access) {
  accessByClient.set(client, next);
  for (const changed of listenersByClient.get(client) ?? []) changed();
}
export function useFinanceOnboardingAccess(client: QueryClient) {
  return useSyncExternalStore(
    (changed) => {
      let listeners = listenersByClient.get(client);
      if (!listeners) {
        listeners = new Set();
        listenersByClient.set(client, listeners);
      }
      listeners.add(changed);
      return () => listeners.delete(changed);
    },
    () => access(client),
    () => access(client),
  );
}
export function captureFinanceOnboardingAccess(client: QueryClient) {
  return { ...access(client) };
}
export function isFinanceOnboardingAccessCurrent(client: QueryClient, captured: Access) {
  const current = access(client);
  return (
    current.owner === captured.owner &&
    current.epoch === captured.epoch &&
    current.generation === captured.generation
  );
}
/** Only a current authenticated HTTP denial revokes this projection; transport errors do not. */
export function denyFinanceOnboardingAccess(client: QueryClient, captured: Access, error: unknown) {
  if (
    !(error instanceof ApiClientError) ||
    (error.status !== 401 && error.status !== 403) ||
    !isFinanceOnboardingAccessCurrent(client, captured)
  )
    return false;
  const current = access(client);
  // Advance before removing queries so every in-flight read/mutation is already stale.
  accessByClient.set(client, {
    ...current,
    generation: current.generation + 1,
    denied: true,
    error,
  });
  client.removeQueries({ queryKey: ["finance-onboarding"] });
  for (const changed of listenersByClient.get(client) ?? []) changed();
  return true;
}
/** A successful read started after the denial is the only same-session recovery. */
export function confirmFinanceOnboardingRead(client: QueryClient, captured: Access) {
  if (!isFinanceOnboardingAccessCurrent(client, captured)) return false;
  const current = access(client);
  if (current.denied) publish(client, { ...current, denied: false, error: null });
  return true;
}
