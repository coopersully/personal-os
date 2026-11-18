import type { FinanceTransaction } from "@personal-os/domain";

export const transactionGroupingOptions = [
  ["none", "None"],
  ["date", "Date"],
  ["category", "Category"],
  ["merchant", "Merchant"],
  ["direction", "Direction"],
  ["posting", "Posting state"],
] as const;
export function groupTransactions(transactions: FinanceTransaction[], group: string | null) {
  const labelFor = (transaction: FinanceTransaction) => {
    switch (group) {
      case "date":
        return transaction.date;
      case "category":
        return transaction.category ?? "Uncategorized";
      case "merchant":
        return transaction.merchant;
      case "direction":
        return transaction.direction === "income"
          ? "Income"
          : transaction.direction === "expense"
            ? "Expenses"
            : "Transfers";
      case "posting":
        return transaction.pending ? "Pending" : "Posted";
      default:
        return "";
    }
  };
  const groups = new Map<string, FinanceTransaction[]>();
  for (const transaction of transactions) {
    const label = labelFor(transaction);
    const entries = groups.get(label) ?? [];
    entries.push(transaction);
    groups.set(label, entries);
  }
  return Array.from(groups, ([label, items]) => ({ label, items }));
}
