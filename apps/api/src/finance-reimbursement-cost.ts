import { financePlanningEvidenceCurrencySchema } from "@personal-os/domain";
import { personalAllocationCents } from "./finance-allocation-projections.js";

type Owned = { id: string; userId: string };
type Transaction = Owned & {
  accountId: string;
  amount: number;
  currencyCode: string | null;
  pending: boolean;
  direction: string;
  providerDirection: string | null;
  transferGroupId: string | null;
  reconciliationStatus: string;
};
type Allocation = Owned & {
  transactionId: string;
  amount: number;
  state: "active" | "invalidated";
  treatment: "personal" | "reimbursable";
};
type Case = Owned & {
  allocationId: string;
  expectedAmount: number;
  receivedAmount: number;
  status: string;
};
type Match = Owned & { reimbursementId: string; creditTransactionId: string; amount: number };
export type ReimbursementCostReason =
  | "source_missing"
  | "invalid_money"
  | "pending_activity"
  | "unknown_ownership"
  | "unsupported_currency"
  | "incomplete_allocations"
  | "unresolved_case"
  | "corrupt_match"
  | "ambiguous_relationship"
  | "owner_mismatch";
export type ReimbursementCostQualification =
  | {
      state: "qualified";
      amountCents: number;
      receivedCents: number;
      currency: string;
      scope: "whole_expense";
    }
  | { state: "unavailable"; reason: ReimbursementCostReason };

/** Facts must be read together from one owner-scoped, repeatable-read snapshot. No expected recovery is deducted. */
export function qualifyReimbursementPersonalCost(input: {
  ownerUserId: string;
  expenseTransactionId: string;
  transactions: readonly Transaction[];
  accounts: readonly (Owned & { ownershipType: string; ownershipShareBps: number | null })[];
  allocations: readonly Allocation[];
  reimbursements: readonly Case[];
  matches: readonly Match[];
  relationships: readonly { userId: string; transactionIds: readonly string[] }[];
}): ReimbursementCostQualification {
  const unavailable = (reason: ReimbursementCostReason): ReimbursementCostQualification => ({
    state: "unavailable",
    reason,
  });
  const groups = [
    input.transactions,
    input.accounts,
    input.allocations,
    input.reimbursements,
    input.matches,
  ];
  if (
    groups.some((rows) => rows.some((row) => row.userId !== input.ownerUserId)) ||
    input.relationships.some((row) => row.userId !== input.ownerUserId)
  )
    return unavailable("owner_mismatch");
  if (groups.some((rows) => new Set(rows.map((row) => row.id)).size !== rows.length))
    return unavailable("corrupt_match");
  const transactions = new Map(input.transactions.map((row) => [row.id, row]));
  const accounts = new Map(input.accounts.map((row) => [row.id, row]));
  const cases = new Map(input.reimbursements.map((row) => [row.id, row]));
  const expense = transactions.get(input.expenseTransactionId);
  if (!expense || expense.direction !== "expense") return unavailable("source_missing");
  const money = (amount: number) =>
    Number.isSafeInteger(amount) && amount >= 0 && amount <= 10_000_000_000;
  if (!money(expense.amount)) return unavailable("invalid_money");
  if (
    !financePlanningEvidenceCurrencySchema.safeParse(expense.currencyCode).success ||
    expense.currencyCode === null
  )
    return unavailable("unsupported_currency");
  const fullyOwned = (transaction: Transaction) => {
    const account = accounts.get(transaction.accountId);
    return account?.ownershipType === "individual" && account.ownershipShareBps === 10_000;
  };
  if (!fullyOwned(expense)) return unavailable("unknown_ownership");
  if (expense.pending) return unavailable("pending_activity");
  const ambiguous = (transaction: Transaction) =>
    transaction.transferGroupId !== null ||
    transaction.reconciliationStatus !== "not_applicable" ||
    (transaction.providerDirection !== null &&
      transaction.providerDirection !== transaction.direction) ||
    input.relationships.some((row) => row.transactionIds.includes(transaction.id));
  if (ambiguous(expense)) return unavailable("ambiguous_relationship");
  const sourceAllocations = input.allocations.filter((row) => row.transactionId === expense.id);
  const active = sourceAllocations.filter((row) => row.state === "active");
  if (
    !active.length ||
    active.some((row) => !money(row.amount) || row.amount <= 0) ||
    active.reduce((sum, row) => sum + row.amount, 0) !== expense.amount
  )
    return unavailable("incomplete_allocations");
  const byAllocation = new Map(sourceAllocations.map((row) => [row.id, row]));
  const relatedCases = input.reimbursements.filter((row) => byAllocation.has(row.allocationId));
  const receivedByAllocation = new Map<string, number>();
  const reservedByAllocation = new Map<string, number>();
  const relevantCreditIds = new Set<string>();
  for (const row of relatedCases) {
    const allocation = byAllocation.get(row.allocationId);
    if (row.status === "needs_input") return unavailable("unresolved_case");
    if (allocation?.state !== "active" || allocation.treatment !== "reimbursable")
      return unavailable("incomplete_allocations");
    if (
      !money(row.expectedAmount) ||
      row.expectedAmount <= 0 ||
      !money(row.receivedAmount) ||
      row.receivedAmount > row.expectedAmount
    )
      return unavailable("corrupt_match");
    const matches = input.matches.filter((match) => match.reimbursementId === row.id);
    if (
      matches.some((match) => !money(match.amount) || match.amount <= 0) ||
      matches.reduce((sum, match) => sum + match.amount, 0) !== row.receivedAmount
    )
      return unavailable("corrupt_match");
    receivedByAllocation.set(
      row.allocationId,
      (receivedByAllocation.get(row.allocationId) ?? 0) + row.receivedAmount,
    );
    reservedByAllocation.set(
      row.allocationId,
      (reservedByAllocation.get(row.allocationId) ?? 0) +
        (row.status === "cancelled" ? row.receivedAmount : row.expectedAmount),
    );
    for (const match of matches) relevantCreditIds.add(match.creditTransactionId);
  }
  for (const [allocationId, received] of receivedByAllocation) {
    const allocation = byAllocation.get(allocationId);
    if (
      !allocation ||
      received > allocation.amount ||
      (reservedByAllocation.get(allocationId) ?? 0) > allocation.amount
    )
      return unavailable("corrupt_match");
  }
  for (const creditId of relevantCreditIds) {
    const credit = transactions.get(creditId);
    if (!credit || credit.direction !== "income" || !money(credit.amount))
      return unavailable("corrupt_match");
    if (credit.pending) return unavailable("pending_activity");
    if (credit.currencyCode !== expense.currencyCode) return unavailable("unsupported_currency");
    if (!fullyOwned(credit)) return unavailable("unknown_ownership");
    if (ambiguous(credit)) return unavailable("ambiguous_relationship");
    // Capacity uses every canonical match for this credit, including other expenses' cases.
    const creditMatches = input.matches.filter((match) => match.creditTransactionId === creditId);
    if (
      creditMatches.some(
        (match) => !money(match.amount) || match.amount <= 0 || !cases.has(match.reimbursementId),
      ) ||
      creditMatches.reduce((sum, match) => sum + match.amount, 0) > credit.amount
    )
      return unavailable("corrupt_match");
    for (const match of creditMatches) {
      const row = cases.get(match.reimbursementId);
      if (!row || row.status === "needs_input") return unavailable("unresolved_case");
      const caseMatches = input.matches.filter((entry) => entry.reimbursementId === row.id);
      if (
        !money(row.expectedAmount) ||
        row.expectedAmount <= 0 ||
        !money(row.receivedAmount) ||
        row.receivedAmount > row.expectedAmount ||
        caseMatches.some(
          (entry) =>
            !money(entry.amount) ||
            entry.amount <= 0 ||
            transactions.get(entry.creditTransactionId)?.currencyCode !== expense.currencyCode,
        ) ||
        caseMatches.reduce((sum, entry) => sum + entry.amount, 0) !== row.receivedAmount
      )
        return unavailable("corrupt_match");
    }
  }
  const receivedCents = [...receivedByAllocation.values()].reduce((sum, value) => sum + value, 0);
  const amountCents = personalAllocationCents(
    expense.id,
    expense.amount,
    new Map([[expense.id, active]]),
    receivedByAllocation,
  );
  // Qualification prevents the canonical helper's defensive clamp from guessing at corrupt input.
  if (!money(amountCents) || amountCents !== expense.amount - receivedCents)
    return unavailable("corrupt_match");
  return {
    state: "qualified",
    amountCents,
    receivedCents,
    currency: expense.currencyCode,
    scope: "whole_expense",
  };
}
