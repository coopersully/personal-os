import {
  type FinanceSpendingReferenceFilter,
  financeSpendingReferenceFilterSchema,
} from "@personal-os/domain";
export const spendingReferenceMaximumLength = 16000;
/** A stale revision is provenance for a fresh Spending read, never authority to refresh Transactions. */
export function spendingRecoveryDestination(filter: FinanceSpendingReferenceFilter): string | null {
  const parsed = financeSpendingReferenceFilterSchema.safeParse(filter);
  if (!parsed.success) return null;
  const serialized = JSON.stringify(parsed.data);
  if (serialized.length > spendingReferenceMaximumLength) return null;
  return `/finances/spending?${new URLSearchParams({ recoverSpending: serialized })}`;
}
export function parseSpendingRecovery(value: string | null) {
  if (value === null) return { state: "absent" as const };
  if (value.length > spendingReferenceMaximumLength) return { state: "invalid" as const };
  try {
    const parsed = financeSpendingReferenceFilterSchema.safeParse(JSON.parse(value));
    return parsed.success
      ? { state: "valid" as const, filter: parsed.data }
      : { state: "invalid" as const };
  } catch {
    return { state: "invalid" as const };
  }
}
/** Materialize the original complete query so leaving recovery preserves every explicit filter. */
export function spendingRecoveryControls(
  params: URLSearchParams,
  filter: FinanceSpendingReferenceFilter,
) {
  const next = new URLSearchParams(params);
  const { scope } = filter.query;
  next.set("period", "custom");
  next.set("from", scope.from);
  next.set("through", scope.through);
  next.set("timezone", scope.timezone);
  next.set("accounts", scope.accountIds === null ? "all" : scope.accountIds.join(","));
  if (scope.categoryIds === null) next.delete("categories");
  else next.set("categories", scope.categoryIds.map((id) => id ?? "uncategorized").join(","));
  next.set("basis", scope.basis);
  next.set("pending", scope.includePending ? "1" : "0");
  next.set("refunds", scope.subtractRefunds ? "1" : "0");
  next.set("grouping", filter.query.grouping);
  next.set("uncategorized", filter.query.includeUncategorized ? "1" : "0");
  return next;
}
