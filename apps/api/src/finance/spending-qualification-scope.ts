import type { FinanceSpendingScope, FinanceSpendingSnapshot } from "@personal-os/domain";
import { resolveFinanceCurrentRelationships } from "./recognition.js";
import { financeSpendingLocalDate, type SpendingEvidenceInput } from "./spending-contributions.js";

/** Attribute whole-budget account/month uncertainty after complete recognition, without pruning its ledger. */
export function spendingQualificationsForScope(
  input: SpendingEvidenceInput,
  scope: FinanceSpendingScope,
  qualifications: FinanceSpendingSnapshot["qualifications"],
): FinanceSpendingSnapshot["qualifications"] {
  const accounts = input.accounts.filter((row) => row.userId === input.userId);
  const accountIds = new Set(accounts.map((row) => row.id));
  const selectedAccounts = new Set(
    accounts
      .filter((row) => scope.accountIds === null || scope.accountIds.includes(row.id))
      .map((row) => row.id),
  );
  const transactions = input.transactions.filter(
    (row) => row.userId === input.userId && accountIds.has(row.accountId),
  );
  const transactionIds = new Set(transactions.map((row) => row.id));
  const known = new Set(accountIds);
  const edges = new Map<string, Set<string>>();
  const connect = (left: string, right: string) => {
    known.add(left);
    known.add(right);
    if (!edges.has(left)) edges.set(left, new Set());
    if (!edges.has(right)) edges.set(right, new Set());
    edges.get(left)?.add(right);
    edges.get(right)?.add(left);
  };
  const providerIdentities = new Map<string, string[]>();
  for (const row of transactions) {
    known.add(row.id);
    for (const key of new Set(
      [row.id, row.providerTransactionId].filter((id): id is string => !!id),
    ))
      providerIdentities.set(key, [...(providerIdentities.get(key) ?? []), row.id]);
    if (
      row.transferGroupId &&
      row.direction === "transfer" &&
      (row.reconciliationStatus === "matched" || row.reconciliationStatus === "confirmed")
    )
      connect(row.id, row.transferGroupId);
  }
  for (const row of transactions)
    if (row.pendingTransactionId)
      for (const pending of providerIdentities.get(row.pendingTransactionId) ?? [])
        connect(row.id, pending);
  const allocationIds = new Set<string>();
  for (const row of input.allocations)
    if (transactionIds.has(row.transactionId)) {
      allocationIds.add(row.id);
      connect(row.id, row.transactionId);
    }
  const claimIds = new Set<string>();
  for (const row of input.reimbursements)
    if (allocationIds.has(row.allocationId)) {
      claimIds.add(row.id);
      connect(row.id, row.allocationId);
    }
  for (const row of input.matches)
    if (claimIds.has(row.reimbursementId) && transactionIds.has(row.creditTransactionId))
      connect(row.reimbursementId, row.creditTransactionId);
  for (const row of resolveFinanceCurrentRelationships(input)) {
    connect(row.id, row.eventId);
    for (const id of row.transactionIds) connect(row.eventId, id);
  }
  const relevant = new Set<string>(selectedAccounts);
  const queue: string[] = [];
  for (const row of transactions) {
    const date = financeSpendingLocalDate(row.transactionDate, scope.timezone);
    if (
      selectedAccounts.has(row.accountId) &&
      date >= scope.from &&
      date <= scope.through &&
      (scope.includePending || !row.pending)
    ) {
      relevant.add(row.id);
      queue.push(row.id);
    }
  }
  // Related evidence may be outside the budget accounts/month but still change selected money.
  for (let index = 0; index < queue.length; index++)
    for (const id of edges.get(queue[index] ?? "") ?? [])
      if (!relevant.has(id)) {
        relevant.add(id);
        queue.push(id);
      }
  for (const row of transactions) if (relevant.has(row.id)) relevant.add(row.accountId);
  return qualifications.flatMap((row) => {
    // Unattributable uncertainty remains fail-closed rather than silently disappearing.
    if (!row.sourceIds.length) return [row];
    const sourceIds = row.sourceIds.filter((id) => relevant.has(id) || !known.has(id));
    return sourceIds.length ? [{ ...row, sourceIds }] : [];
  });
}
