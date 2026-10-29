import {
  type FinancesWorkspacePreferences,
  getDefaultWorkspacePreferences,
} from "@personal-os/domain";
import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import {
  useSaveWorkspacePreferences,
  useWorkspacePreferences,
} from "../workspace-settings/preferences";

/** Explicit links override saved defaults without changing the account's preferences. */
export function financePresentationParams(
  params: URLSearchParams,
  preferences?: FinancesWorkspacePreferences,
) {
  const next = new URLSearchParams(params);
  const values = { ...getDefaultWorkspacePreferences("finances"), ...preferences };
  const defaults = {
    view: values.financeTransactionView,
    group: values.financeTransactionGroup,
  };
  for (const [key, value] of Object.entries(defaults)) {
    if (!next.has(key)) next.set(key, value);
  }
  return next;
}

export function useFinancePresentationParams() {
  const [params] = useSearchParams();
  const settings = useWorkspacePreferences("finances");
  return useMemo(
    () => financePresentationParams(params, settings.data?.preferences),
    [params, settings.data?.preferences],
  );
}

export function useSaveFinancePresentation() {
  return useSaveWorkspacePreferences("finances");
}
