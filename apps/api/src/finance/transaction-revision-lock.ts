import { type Database, financeTransactionRevisions } from "@personal-os/database";
import { eq, sql } from "drizzle-orm";

type RevisionExecutor = Pick<Database, "execute" | "select">;

/** Allocate the next revision while serializing writers for one transaction. */
export async function nextFinanceTransactionRevision(
  executor: RevisionExecutor,
  transactionId: string,
): Promise<number> {
  await executor.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`finance-transaction-revision:${transactionId}`}, 0))`,
  );
  const [latest] = await executor
    .select({
      version: sql<number>`coalesce(max(${financeTransactionRevisions.version}), 0)::integer`,
    })
    .from(financeTransactionRevisions)
    .where(eq(financeTransactionRevisions.transactionId, transactionId));
  /* v8 ignore next -- PostgreSQL aggregate queries always return exactly one row. */
  if (!latest) throw new Error("Finance transaction revision could not be allocated.");
  return latest.version + 1;
}
