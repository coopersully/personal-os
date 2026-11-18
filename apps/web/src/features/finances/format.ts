/** Finance presentation stays feature-local so locale and currency remain a UI decision. */
export function formatMoney(value: number): string {
  return new Intl.NumberFormat(undefined, { currency: "USD", style: "currency" }).format(value);
}

/** Compact KPI values retain currency and at most one fractional digit. */
export function formatCompactMoney(value: number): string {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    notation: "compact",
    minimumFractionDigits: 0,
    maximumFractionDigits: 1,
  })
    .formatToParts(value)
    .map((part) => (part.type === "compact" && part.value === "K" ? "k" : part.value))
    .join("");
}
