import { getDefaultWorkspacePreferences } from "@personal-os/domain";
import { useFinanceRead } from "./data";
import type { SpendingPeriod, WeekStart } from "./spending-math";

export type SpendingPreferences = {
  basis: "personal_cost" | "full_outflow";
  includePending: boolean;
  subtractRefunds: boolean;
  includeUncategorized: boolean;
  period: SpendingPeriod;
  weekStartsOn: WeekStart;
};

/**
 * The saved Spending defaults and the account's week start. Spending waits for these instead of
 * assuming defaults, so a total is never shown on a basis the person did not choose. Saving a
 * Finance preference in Settings invalidates every `finances` read, this one included.
 */
export function useSpendingPreferences() {
  return useFinanceRead(["spending-preferences"], async (api): Promise<SpendingPreferences> => {
    const [finances, calendar] = await Promise.all([
      api.getWorkspaceSettings("finances"),
      api.getWorkspaceSettings("calendar"),
    ]);
    const saved = { ...getDefaultWorkspacePreferences("finances"), ...finances.preferences };
    return {
      basis: saved.financeSpendingBasis,
      includePending: saved.financeSpendingIncludePending,
      subtractRefunds: saved.financeSpendingSubtractRefunds,
      includeUncategorized: saved.financeSpendingIncludeUncategorized,
      period: saved.financeSpendingPeriod,
      weekStartsOn: calendar.preferences.weekStartsOn,
    };
  });
}

/** What the total counts, written out from the preferences that produced it. */
export function spendingBasisLine(preferences: SpendingPreferences) {
  return [
    preferences.basis === "personal_cost" ? "Your share" : "Full outflow",
    `pending ${preferences.includePending ? "included" : "left out"}`,
    `refunds ${preferences.subtractRefunds ? "subtracted" : "not subtracted"}`,
    preferences.includeUncategorized ? "" : "uncategorized left out",
  ]
    .filter(Boolean)
    .join(" · ");
}
