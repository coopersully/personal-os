import type { Database } from "@personal-os/database";
import { sql } from "drizzle-orm";

type SqlExecutor = Pick<Database, "execute">;

/** Serialize the latest-version read and append for one user's financial profile. */
export async function lockFinanceProfileVersion(
  executor: SqlExecutor,
  userId: string,
): Promise<void> {
  await executor.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`finance-profile:${userId}`}, 0))`,
  );
}
