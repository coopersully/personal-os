import { deriveFinanceOnboardingReadiness } from "@personal-os/domain";
import { type QueryClient, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import {
  preferenceSession,
  registerSessionCleanup,
  sameSession,
  usePreferenceSession,
} from "../workspace-settings/account-save-session";
import { financeOnboardingApiAdapter } from "./onboarding-adapter";

const registered = new WeakSet<QueryClient>();

export const financeWorkspaceReadinessKey = [
  "finance-onboarding",
  financeOnboardingApiAdapter,
] as const;

/** One server projection for workspace access and creation visibility, never an authorization grant. */
export function useFinanceWorkspaceReadiness() {
  const cache = useQueryClient();
  const session = usePreferenceSession(cache);
  useEffect(() => {
    if (!registered.has(cache)) {
      registered.add(cache);
      registerSessionCleanup(cache, () =>
        cache.removeQueries({ queryKey: ["finance-onboarding"] }),
      );
    }
  }, [cache]);
  const query = useQuery({
    queryKey: financeWorkspaceReadinessKey,
    enabled: !!session.owner,
    queryFn: async () => {
      const started = { ...preferenceSession(cache) };
      if (!started.owner) throw new Error("Load your account before reading Finance readiness.");
      const snapshot = await financeOnboardingApiAdapter.getFinanceOnboarding();
      if (!sameSession(cache, started))
        throw new Error("Your account changed. Reload Finance readiness.");
      return snapshot;
    },
    staleTime: 30_000,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  const snapshot = session.owner ? query.data : undefined;
  const readiness = snapshot ? deriveFinanceOnboardingReadiness(snapshot) : undefined;
  return {
    snapshot,
    readiness,
    isPending: query.isPending,
    isError: query.isError,
    error: query.error,
    reload: () => query.refetch({ throwOnError: true }),
    manualCreationVisible: readiness?.manualCreationVisible,
  };
}
