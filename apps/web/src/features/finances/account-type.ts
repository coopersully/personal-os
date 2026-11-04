import type { FinanceAccount } from "@personal-os/domain";

type AccountTypeSource = Pick<FinanceAccount, "kind" | "providerSubtype"> &
  Partial<Pick<FinanceAccount, "providerType">>;
export const accountTypeLabels = {
  credit_card: "Credit card",
  debit_card: "Debit card",
  bank: "Bank account",
  investment: "Investment account",
  loan: "Loan",
  credit_line: "Line of credit",
  cash: "Cash account",
  debt: "Debt account",
  other: "Other asset",
} as const;
export type AccountType = keyof typeof accountTypeLabels;

/** Provider facts describe the product; planning kind alone cannot prove a card exists. */
export function financeAccountType(account: AccountTypeSource): AccountType {
  const subtype = account.providerSubtype?.trim().toLowerCase().replaceAll("_", " ");
  if (subtype === "credit card") return "credit_card";
  if (subtype === "prepaid") return "debit_card";
  if (subtype === "debit card") return "debit_card";
  if (subtype === "line of credit" || subtype === "commercial line of credit") return "credit_line";
  if (account.providerType === "credit") return "debt";
  if (account.providerType === "loan") return "loan";
  if (account.providerType === "investment" || account.providerType === "brokerage")
    return "investment";
  if (account.providerType === "depository") return "bank";
  if (
    [
      "checking",
      "savings",
      "money market",
      "cd",
      "cash management",
      "limited purpose checking",
    ].includes(subtype ?? "")
  )
    return "bank";
  if (account.kind === "investment") return "investment";
  if (account.kind === "debt") return "debt";
  if (account.kind === "cash") return "cash";
  return "other";
}

export function financeAccountTypeLabel(account: AccountTypeSource) {
  return accountTypeLabels[financeAccountType(account)];
}

/** Missing currency stays missing; never silently format an account balance as USD. */
export function financeAccountBalance(account: Pick<FinanceAccount, "balance" | "currencyCode">) {
  if (account.balance === null) return "Balance unavailable";
  return account.currencyCode
    ? new Intl.NumberFormat(undefined, {
        style: "currency",
        currency: account.currencyCode,
      }).format(account.balance)
    : account.balance.toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
}
