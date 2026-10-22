import type { FinanceCategory, FinanceTransaction } from "@personal-os/domain";

export type FinanceCategoryReadState = "loading" | "unavailable" | "ready";
type CategoryReference = Pick<FinanceTransaction, "categoryId" | "category">;

export function legacyFinanceCategoryLabel(category: string | null) {
  if (!category) return "Uncategorized";
  const providerLabels: Record<string, string> = {
    FOOD_AND_DRINK: "Food & Drink",
    GENERAL_MERCHANDISE: "Shopping",
    TRANSFER_IN: "Transfers",
    TRANSFER_OUT: "Transfers",
  };
  if (providerLabels[category]) return providerLabels[category];
  return category
    .toLowerCase()
    .split(/[_-]+/)
    .map((word) => `${word.slice(0, 1).toUpperCase()}${word.slice(1)}`)
    .join(" ");
}

/** Canonical identity wins; an unresolved ID is never evidence of an uncategorized record. */
export function financeTransactionCategoryLabel(
  transaction: CategoryReference,
  categories: FinanceCategory[],
  state: FinanceCategoryReadState,
): string {
  if (!transaction.categoryId) return legacyFinanceCategoryLabel(transaction.category);
  const category = categories.find((category) => category.id === transaction.categoryId);
  if (category) return category.name;
  return state === "loading" ? "Loading category…" : "Category unavailable";
}

/** Group by identity without rewriting native records or confusing conflicting legacy strings. */
export function groupFinanceTransactionsByCategory(
  transactions: FinanceTransaction[],
  categories: FinanceCategory[],
  state: FinanceCategoryReadState,
) {
  const groups = new Map<string, { label: string; items: FinanceTransaction[] }>();
  for (const transaction of transactions) {
    const label = financeTransactionCategoryLabel(transaction, categories, state);
    const key = transaction.categoryId ? `id:${transaction.categoryId}` : `legacy:${label}`;
    const group = groups.get(key) ?? { label, items: [] };
    group.items.push(transaction);
    groups.set(key, group);
  }
  return [...groups.values()];
}
