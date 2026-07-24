/** Finance presentation stays feature-local so locale and currency remain a UI decision. */
export function formatMoney(value: number): string {
  return new Intl.NumberFormat(undefined, { currency: "USD", style: "currency" }).format(value);
}
