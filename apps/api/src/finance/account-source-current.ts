import type { financeAccounts, financeProviderItems } from "@personal-os/database";
import { effectiveSynchronization } from "../finance-status-service.js";

/** Qualification requires the account and its exact provider source to agree. */
export function isFinanceAccountSourceIdentified(
  account: typeof financeAccounts.$inferSelect,
  item: typeof financeProviderItems.$inferSelect | undefined,
): boolean {
  if (account.provider === "manual")
    return (
      account.status === "manual" &&
      !account.providerItemRecordId &&
      !account.providerAccountId &&
      !account.providerItemId
    );
  return (
    account.provider === "plaid" &&
    account.status === "connected" &&
    !!item &&
    item.userId === account.userId &&
    item.id === account.providerItemRecordId &&
    item.provider === "plaid" &&
    account.providerItemId === item.providerItemId
  );
}

export function isFinanceAccountSourceCurrent(
  account: typeof financeAccounts.$inferSelect,
  item: typeof financeProviderItems.$inferSelect | undefined,
  at: Date,
): boolean {
  if (!isFinanceAccountSourceIdentified(account, item)) return false;
  if (account.provider === "manual") return true;
  return (
    !!item &&
    !!account.lastSyncedAt &&
    account.lastSyncedAt <= at &&
    !!item.lastSyncedAt &&
    item.lastSyncedAt <= at &&
    effectiveSynchronization(account, at).state === "current" &&
    effectiveSynchronization(item, at).state === "current"
  );
}
