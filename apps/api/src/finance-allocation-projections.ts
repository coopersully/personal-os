/**
 * Allocation projections preserve the bank transaction's gross cash amount,
 * while allowing personal-spending views to exclude reimbursable shares.
 */
export type AllocationProjection = {
  amount: number;
  state: "active" | "invalidated";
  transactionId: string;
  treatment: "personal" | "reimbursable";
};

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
): number {
  const allocations = activeAllocations.get(transactionId);
  if (!allocations) return grossAmount;
  return allocations
    .filter((allocation) => allocation.treatment === "personal")
    .reduce((sum, allocation) => sum + allocation.amount, 0);
}
