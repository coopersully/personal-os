import type {
  FinanceConfiguration,
  FinanceProfileVersion,
  UpdateFinancialProfileInput,
} from "@personal-os/domain";
import { financialProfileChangesSchema } from "@personal-os/domain";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef } from "react";
import { api } from "../../api.js";
import { useFeedbackMutation } from "../../lib/use-feedback-mutation.js";
import {
  isConfirmedFinanceMutationFailure,
  requireFinanceMutationResult,
} from "./mutation-retry.js";

export const financeConfigurationKey = ["finance-configuration"];
export function useFinanceConfiguration() {
  return useQuery({
    queryKey: financeConfigurationKey,
    queryFn: () => api.getFinanceConfiguration(),
    refetchInterval: 60_000,
  });
}
export function useFinanceProfileField<T>(
  id: string,
  saved: T,
  changes: (
    value: T,
    profile: FinanceProfileVersion | null,
  ) => UpdateFinancialProfileInput["changes"],
) {
  const client = useQueryClient();
  const draftKey = ["finance-configuration-draft", id];
  const draft = useQuery<{ value: T } | null>({
    queryKey: draftKey,
    queryFn: () => null,
    enabled: false,
    gcTime: Infinity,
  });
  const value = draft.data ? draft.data.value : saved;
  const attempt = useRef<{ signature: string; input: UpdateFinancialProfileInput } | null>(null);
  const mutationKey = ["finance-configuration-save", id];
  const save = useFeedbackMutation({
    mutationKey,
    scope: { id: "finance-profile-configuration" },
    feedback: { action: "save financial settings", safeToRetry: false, form: true },
    mutationFn: async (submitted: T) => {
      const signature = JSON.stringify(submitted);
      if (attempt.current?.signature !== signature) {
        const config = client.getQueryData<FinanceConfiguration>(financeConfigurationKey);
        if (config?.profile.state !== "loaded")
          throw new Error("Reload your financial profile before editing.");
        const profile = config.profile.value;
        attempt.current = {
          signature,
          input: {
            changes: financialProfileChangesSchema.parse(changes(submitted, profile)),
            expectedVersion: profile?.version ?? 0,
            idempotencyKey: crypto.randomUUID(),
          },
        };
      }
      return requireFinanceMutationResult(await api.updateFinancialProfile(attempt.current.input));
    },
    onError: (error) => {
      if (isConfirmedFinanceMutationFailure(error)) attempt.current = null;
    },
    onSuccess: async (result, submitted) => {
      await client.cancelQueries({ queryKey: financeConfigurationKey });
      client.setQueryData<FinanceConfiguration>(financeConfigurationKey, (config) =>
        config ? { ...config, profile: { state: "loaded", value: result.data } } : config,
      );
      client.setQueryData(draftKey, (current: { value: T } | null | undefined) =>
        current && JSON.stringify(current.value) === JSON.stringify(submitted) ? null : current,
      );
      attempt.current = null;
      void client.invalidateQueries({
        predicate: (query) =>
          typeof query.queryKey[0] === "string" &&
          query.queryKey[0].startsWith("finance-") &&
          query.queryKey[0] !== "finance-configuration" &&
          query.queryKey[0] !== "finance-configuration-draft",
      });
    },
  });
  function setValue(next: T) {
    client.setQueryData(draftKey, { value: next });
  }
  function commit(
    next = (client.getQueryData<{ value: T } | null>(draftKey) ?? { value: saved }).value,
  ) {
    const pending = client.getMutationCache().findAll({ mutationKey, status: "pending" });
    const latest = pending.at(-1);
    if (
      (latest && JSON.stringify(next) === JSON.stringify(latest.state.variables)) ||
      (!latest && JSON.stringify(next) === JSON.stringify(saved))
    )
      return;
    save.mutate(next);
  }
  async function reload() {
    client.setQueryData(draftKey, null);
    attempt.current = null;
    save.reset();
    await client.refetchQueries({ queryKey: financeConfigurationKey });
  }
  return { value, setValue, commit, save, reload };
}
