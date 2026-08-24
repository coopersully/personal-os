/**
 * Allocation projections preserve the bank transaction's gross cash amount,
 * while allowing personal-spending views to exclude reimbursable shares.
 */
export type AllocationProjection = {
  amount: number;
  id: string;
  state: "active" | "invalidated";
  transactionId: string;
  treatment: "personal" | "reimbursable";
};

/**
 * A reimbursement excludes a reimbursable allocation from personal spending
 * while it is expected.  Cancellation deliberately restores only the
 * unmatched portion: money already received remains non-personal.
 */
export type ReimbursementAllocationProjection = {
  allocationId: string;
  expectedAmount: number;
  receivedAmount: number;
  status: "cancelled" | string;
};

export function excludedReimbursementCentsByAllocation(
  reimbursements: ReimbursementAllocationProjection[],
): Map<string, number> {
  const excluded = new Map<string, number>();
  for (const reimbursement of reimbursements) {
    const amount =
      reimbursement.status === "cancelled"
        ? reimbursement.receivedAmount
        : reimbursement.expectedAmount;
    excluded.set(
      reimbursement.allocationId,
      (excluded.get(reimbursement.allocationId) ?? 0) + amount,
    );
  }
  return excluded;
}

export function matchedReimbursementCentsByCredit(
  matches: Array<{ amount: number; creditTransactionId: string }>,
): Map<string, number> {
  const matched = new Map<string, number>();
  for (const match of matches) {
    matched.set(
      match.creditTransactionId,
      (matched.get(match.creditTransactionId) ?? 0) + match.amount,
    );
  }
  return matched;
}

export function activeAllocationsByTransaction(
  allocations: AllocationProjection[],
): Map<string, AllocationProjection[]> {
  const byTransaction = new Map<string, AllocationProjection[]>();
  for (const allocation of allocations) {
    const items = byTransaction.get(allocation.transactionId) ?? [];
    // Preserve allocation existence even when every split has been invalidated.
    // That state means the provider amount changed and personal spending must
    // await review instead of falling back to the gross legacy category.
    if (!byTransaction.has(allocation.transactionId)) {
      byTransaction.set(allocation.transactionId, items);
    }
    if (allocation.state !== "active") continue;
    items.push(allocation);
  }
  return byTransaction;
}

/** Falls back to gross only when the transaction has never had an allocation. */
export function personalAllocationCents(
  transactionId: string,
  grossAmount: number,
  activeAllocations: ReadonlyMap<string, AllocationProjection[]>,
  excludedReimbursementByAllocation: ReadonlyMap<string, number> = new Map(),
): number {
  const allocations = activeAllocations.get(transactionId);
  if (!allocations) return grossAmount;
  return allocations.reduce((sum, allocation) => {
    if (allocation.treatment === "personal") return sum + allocation.amount;
    // Allocation and reimbursement lifecycle validation guarantee this cannot
    // be negative. Clamp defensively so historic bad data cannot invert spend.
    return (
      sum +
      Math.max(0, allocation.amount - (excludedReimbursementByAllocation.get(allocation.id) ?? 0))
    );
  }, 0);
}
