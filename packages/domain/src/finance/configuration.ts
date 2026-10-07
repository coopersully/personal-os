import type { FinanceAccountList, FinanceGuidedSetupContext, FinanceProfile } from "../finance.js";
import type { WorkspaceSettings } from "../workspace-search.js";
import type { FinanceBudgetVersion } from "./budget.js";
import type { FinanceProfileVersion } from "./profile.js";

export type FinanceConfigurationSection<T> =
  | { state: "loaded"; value: T }
  | { state: "unavailable" };
export type FinanceCapabilityReadiness = {
  state: "ready" | "needs_input" | "running" | "blocked" | "unavailable";
  reason: string | null;
  href: string | null;
  action: string | null;
};
export type FinanceConfiguration = {
  execution: FinanceConfigurationSection<{
    id: string;
    status: import("../maintenance.js").MaintenanceRun["status"];
  } | null>;
  profile: FinanceConfigurationSection<FinanceProfileVersion | null>;
  preferences: FinanceConfigurationSection<WorkspaceSettings>;
  income: FinanceConfigurationSection<FinanceProfile | null>;
  budget: FinanceConfigurationSection<FinanceBudgetVersion | null>;
  accounts: FinanceConfigurationSection<FinanceAccountList>;
  guidance: FinanceConfigurationSection<FinanceGuidedSetupContext | null>;
  capabilities: Record<"budget" | "cashflow" | "wealth", FinanceCapabilityReadiness>;
};

/** Readiness for destinations, not permission to approve or trust a derived financial result. */
export function financeConfigurationCapabilities(
  budget: FinanceConfiguration["budget"],
): FinanceConfiguration["capabilities"] {
  const ready: FinanceCapabilityReadiness = {
    state: "ready",
    reason: null,
    href: null,
    action: null,
  };
  return {
    budget:
      budget.state === "unavailable"
        ? {
            state: "unavailable",
            reason: "Your budget could not be loaded. Your saved information has not changed.",
            href: null,
            action: "Retry",
          }
        : budget.value
          ? ready
          : {
              state: "needs_input",
              reason: "Create a budget from your income, expenses, and priorities.",
              href: "/finances/setup?section=budget",
              action: "Set up your budget",
            },
    // Recording goals, bills, and income remains useful without a forecast or an approved budget.
    // These pages retain their existing evidence checks on derived financial material.
    cashflow: ready,
    wealth: ready,
  };
}
