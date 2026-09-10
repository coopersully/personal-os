import {
  type Database,
  financeReimbursementMatches,
  financeReimbursements,
} from "@personal-os/database";
import { and, eq, inArray, or, sql } from "drizzle-orm";

type ReimbursementReadExecutor = Pick<Database, "select">;
type ReimbursementTopologyExecutor = Pick<Database, "execute">;

/**
 * Serializes the reimbursement graph for one owner before any row locks.
 * It covers absent rows (new cases/matches) and crossed case-credit writes,
 * which row locking alone cannot order safely.
 */
export async function lockReimbursementTopology(
  executor: ReimbursementTopologyExecutor,
  userId: string,
) {
  await executor.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`finance-reimbursement-topology:${userId}`}, 0))`,
  );
}

/**
 * Shared reimbursement lock contract. Callers first lock sorted case IDs,
 * then owned accounts, transactions, allocations, and finally these match
 * rows. Initial identity reads may be unlocked; every mutation revalidates
 * after acquiring this order.
 */
export async function lockReimbursementCases(
  executor: ReimbursementReadExecutor,
  userId: string,
  reimbursementIds: string[],
  lock = false,
) {
  const ids = [...new Set(reimbursementIds)].sort();
  if (!ids.length) return [] as Array<typeof financeReimbursements.$inferSelect>;
  const query = executor
    .select()
    .from(financeReimbursements)
    .where(and(eq(financeReimbursements.userId, userId), inArray(financeReimbursements.id, ids)))
    .orderBy(financeReimbursements.id);
  return lock ? query.for("update") : query;
}

export async function lockReimbursementMatches(
  executor: ReimbursementReadExecutor,
  userId: string,
  {
    creditTransactionIds = [],
    reimbursementIds = [],
  }: {
    creditTransactionIds?: string[];
    reimbursementIds?: string[];
  },
  lock = false,
) {
  const creditIds = [...new Set(creditTransactionIds)].sort();
  const caseIds = [...new Set(reimbursementIds)].sort();
  if (!creditIds.length && !caseIds.length)
    return [] as Array<typeof financeReimbursementMatches.$inferSelect>;
  const matchScope =
    caseIds.length && creditIds.length
      ? or(
          inArray(financeReimbursementMatches.reimbursementId, caseIds),
          inArray(financeReimbursementMatches.creditTransactionId, creditIds),
        )
      : caseIds.length
        ? inArray(financeReimbursementMatches.reimbursementId, caseIds)
        : inArray(financeReimbursementMatches.creditTransactionId, creditIds);
  const query = executor
    .select()
    .from(financeReimbursementMatches)
    .where(and(eq(financeReimbursementMatches.userId, userId), matchScope))
    .orderBy(financeReimbursementMatches.id);
  return lock ? query.for("update") : query;
}
