import {
  type FinanceSpendingReferenceFilter,
  type FinanceTransactionQuery,
  financeSpendingReferenceFilterSchema,
  financeTransactionQuerySchema,
} from "@personal-os/domain";

/** Parse each filter independently so one stale link cannot hide the ledger. */
export function financeTransactionFilters(
  params: URLSearchParams,
): Partial<FinanceTransactionQuery> {
  const result: Record<string, unknown> = { review: "all" };
  for (const key of ["accountId", "categoryId", "from", "to", "review", "search"] as const) {
    const raw =
      key === "review" ? (params.get("reviewState") ?? params.get("review")) : params.get(key);
    const parsed = financeTransactionQuerySchema.shape[key].safeParse(raw ?? undefined);
    if (parsed.success && parsed.data !== undefined) result[key] = parsed.data;
  }
  if (params.get("pending") === "pending") result.pending = true;
  if (params.get("pending") === "posted") result.pending = false;
  return result;
}

/** A present malformed reference must never become an ordinary ledger request. */
export function financeSpendingReferenceFilter(
  params: URLSearchParams,
):
  | { status: "absent" }
  | { status: "invalid" }
  | { status: "valid"; filter: FinanceSpendingReferenceFilter } {
  if (!params.has("spending")) return { status: "absent" };
  const values = params.getAll("spending");
  const raw = values[0] ?? "";
  if (values.length !== 1 || !raw || raw.length > 16_000) return { status: "invalid" };
  try {
    const parsed = financeSpendingReferenceFilterSchema.safeParse(JSON.parse(raw));
    return parsed.success ? { status: "valid", filter: parsed.data } : { status: "invalid" };
  } catch {
    return { status: "invalid" };
  }
}
