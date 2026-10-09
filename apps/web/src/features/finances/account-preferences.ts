import type { FinanceAccount, FinancesWorkspacePreferences } from "@personal-os/domain";

export type FinanceAccountScope = "spend" | "cash" | "investments";
export const financeAccountPreferenceKeys = {
  spend: "spendAccountIds",
  cash: "cashAccountIds",
  investments: "investmentAccountIds",
} as const;
export function selectedFinanceAccounts(
  accounts: FinanceAccount[],
  scope: FinanceAccountScope,
  preferences?: FinancesWorkspacePreferences,
): string[] {
  const eligible = accounts.filter(
    (account) => scope === "spend" || account.kind === (scope === "cash" ? "cash" : "investment"),
  );
  const saved = preferences?.[financeAccountPreferenceKeys[scope]];
  return eligible
    .filter((account) => saved == null || saved.includes(account.id))
    .map((account) => account.id);
}
