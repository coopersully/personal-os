import type { FinanceIncomeStream, FinanceRecurringObligation } from "../finance.js";
import type { FinanceRecurringOccurrencesQuery } from "./recurring-schedule.js";

/** Same-row server revisions, never inferred from a previous statement or a browser clock. */
export type FinanceCashflowSourcesQuery = FinanceRecurringOccurrencesQuery;
export type FinanceCashflowActualEligibilityReason =
  | "pending"
  | "not_income"
  | "not_expense"
  | "transfer_or_card_payment"
  | "reimbursement_or_refund_credit"
  | "unclassified"
  | "unsupported_currency"
  | "allocation_invalidated"
  | "account_unavailable";
export type FinanceCashflowSourceSnapshots = {
  from: string;
  to: string;
  accounts: Array<{
    id: string;
    name: string;
    currencyCode: string | null;
    kind: "cash" | "debt" | "investment" | "other";
    includeInPlanning: boolean;
    ownershipType: "individual" | "joint" | "unknown";
    ownershipShare: number | null;
    accountRevision: string;
  }>;
  income: Array<FinanceIncomeStream & { revision: number }>;
  obligations: Array<FinanceRecurringObligation & { revision: number }>;
  transactions: Array<{
    id: string;
    accountId: string;
    merchant: string;
    date: string;
    amountCents: number;
    currencyCode: string | null;
    direction: "income" | "expense" | "transfer";
    pending: boolean;
    transactionRevision: string;
    incomeEligibility: { eligible: boolean; reasons: FinanceCashflowActualEligibilityReason[] };
    allocations: Array<{
      id: string;
      revision: number;
      amountCents: number;
      treatment: "personal" | "reimbursable";
      expenseEligibility: { eligible: boolean; reasons: FinanceCashflowActualEligibilityReason[] };
    }>;
  }>;
  coverage: { truncated: boolean; transactionLimit: number };
};
