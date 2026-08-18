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
    if (allocation.state !== "active") continue;
    const items = byTransaction.get(allocation.transactionId) ?? [];
    items.push(allocation);
    byTransaction.set(allocation.transactionId, items);
  }
  return byTransaction;
}

/** Falls back to the gross amount only when the transaction has no active split. */
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
