import { type Database, users } from "@personal-os/database";
import { eq, sql } from "drizzle-orm";
import { AppError } from "./errors.js";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
/** Auth-only: Finance consumers must never acquire this gate after domain locks. */
export async function lockOAuthGrant(
  tx: Transaction,
  userId: string,
  clientId: string,
  resource: string,
) {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${JSON.stringify([userId, clientId, resource])}, 0))`,
  );
  const [owner] = await tx
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, userId))
    .for("key share")
    .limit(1);
  if (!owner) throw new AppError("unauthorized", "The OAuth owner is no longer available.");
}
