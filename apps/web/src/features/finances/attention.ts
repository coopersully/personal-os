import {
  availableFinancePlanningQuestions,
  type FinanceAccount,
  type FinanceProfileVersion,
  financeSetupPlanningSchema,
} from "@personal-os/domain";

export function financeAccountNeedsConnectionAttention(account: FinanceAccount, now = Date.now()) {
  if (account.provider === "manual" || account.status === "manual") return false;
  return (
    account.status !== "connected" ||
    account.synchronization.state === "blocked" ||
    !account.lastSyncedAt ||
    now - Date.parse(account.lastSyncedAt) > 24 * 60 * 60 * 1000
  );
}
export function financeProfileNeedsAttention(profile: FinanceProfileVersion | null) {
  return (
    !profile ||
    availableFinancePlanningQuestions(
      financeSetupPlanningSchema.parse(profile.planning ?? {}),
      [],
      profile.version,
    ).length > 0
  );
}

export function financeAccountNeedsAttention(account: FinanceAccount, duplicate = false) {
  return (
    financeAccountNeedsConnectionAttention(account) ||
    account.balance === null ||
    account.ownershipType === "unknown" ||
    account.ownershipShare === null ||
    duplicate
  );
}
