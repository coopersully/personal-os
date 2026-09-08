import { type FinanceTransactionQuery, financeTransactionQuerySchema } from "@personal-os/domain";

/** Parse each filter independently so one stale link cannot hide the ledger. */
export function financeTransactionFilters(
  params: URLSearchParams,
): Partial<FinanceTransactionQuery> {
  const result: Record<string, unknown> = { review: "all" };
  for (const key of ["accountId", "categoryId", "from", "to", "review", "search"] as const) {
    const raw = params.get(key);
    const parsed = financeTransactionQuerySchema.shape[key].safeParse(raw ?? undefined);
    if (parsed.success && parsed.data !== undefined) result[key] = parsed.data;
  }
  if (params.get("pending") === "pending") result.pending = true;
  if (params.get("pending") === "posted") result.pending = false;
  return result;
}
