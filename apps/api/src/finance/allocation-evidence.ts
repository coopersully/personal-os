import {
  type Database,
  financeTransactionAllocations,
  type financeTransactions,
} from "@personal-os/database";
import { and, eq } from "drizzle-orm";

/** Call under the owning parent lock when qualifying a write. Values stay in native cents. */
export async function activeAllocationEvidence(
  executor: Pick<Database, "select">,
  parent: typeof financeTransactions.$inferSelect,
) {
  const history = await executor
    .select()
    .from(financeTransactionAllocations)
    .where(
      and(
        eq(financeTransactionAllocations.userId, parent.userId),
        eq(financeTransactionAllocations.transactionId, parent.id),
      ),
    )
    .orderBy(financeTransactionAllocations.allocationOrder);
  const allocations = history.filter((allocation) => allocation.state === "active");
  const total = allocations.reduce((sum, allocation) => sum + allocation.amount, 0);
  return {
    allocations,
    hasHistory: history.length > 0,
    complete:
      !parent.pending &&
      parent.direction !== "transfer" &&
      parent.reconciliationStatus !== "candidate" &&
      allocations.length > 0 &&
      Number.isSafeInteger(parent.amount) &&
      parent.amount > 0 &&
      allocations.every(
        (allocation) => Number.isSafeInteger(allocation.amount) && allocation.amount > 0,
      ) &&
      Number.isSafeInteger(total) &&
      total === parent.amount,
  };
}
