import { deriveFinanceOnboardingReadiness } from "@personal-os/domain";
import { type QueryClient, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import {
  preferenceSession,
  registerSessionCleanup,
  sameSession,
  usePreferenceSession,
} from "../workspace-settings/account-save-session";
import {
  captureFinanceOnboardingAccess,
  confirmFinanceOnboardingRead,
  denyFinanceOnboardingAccess,
  useFinanceOnboardingAccess,
} from "./onboarding-access";
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
  const access = useFinanceOnboardingAccess(cache);
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
    enabled: !!session.owner && !access.denied,
    queryFn: async () => {
      const started = { ...preferenceSession(cache) };
      if (!started.owner) throw new Error("Load your account before reading Finance readiness.");
      const captured = captureFinanceOnboardingAccess(cache);
      try {
        const snapshot = await financeOnboardingApiAdapter.getFinanceOnboarding();
        if (!sameSession(cache, started) || !confirmFinanceOnboardingRead(cache, captured))
          throw new Error("Your Finance access changed. Reload readiness.");
        return snapshot;
      } catch (error) {
        if (sameSession(cache, started)) denyFinanceOnboardingAccess(cache, captured, error);
        throw error;
      }
    },
    staleTime: 30_000,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  const snapshot = session.owner && !access.denied ? query.data : undefined;
  const readiness = snapshot ? deriveFinanceOnboardingReadiness(snapshot) : undefined;
  return {
    snapshot,
    readiness,
    isPending: !access.denied && query.isPending,
    isError: access.denied || query.isError,
    error: access.denied ? access.error : query.error,
    reload: async () => {
      const result = await query.refetch({ throwOnError: true });
      const current = captureFinanceOnboardingAccess(cache);
      if (current.denied) throw current.error;
      return result;
    },
    manualCreationVisible: readiness?.manualCreationVisible,
  };
}
