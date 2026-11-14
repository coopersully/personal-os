import type { Database } from "@personal-os/database";
import * as databaseSchema from "@personal-os/database";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import { AppError } from "../errors.js";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
export type FinanceTransactionLimits = {
  transactionMs: number;
  statementMs: number;
  lockMs: number;
};

/** Bounds for owner approval, decline and correction transactions. */
export const financeBatchTransactionLimits: FinanceTransactionLimits = {
  transactionMs: 10_000,
  statementMs: 8_000,
  lockMs: 2_000,
};

function isTransactionTimeout(error: unknown): boolean {
  const seen = new Set<unknown>();
  let current = error;
  while (typeof current === "object" && current !== null && !seen.has(current)) {
    if ("code" in current && current.code === "25P04") return true;
    seen.add(current);
    current = "cause" in current ? current.cause : null;
  }
  return false;
}

/**
 * Run one transaction under transaction, statement and lock limits.
 *
 * PostgreSQL 17.5 does start the transaction timer when `SET LOCAL transaction_timeout`
 * runs inside the transaction (transaction-limits.integration.test.ts), and the setting
 * ends with the transaction, so nothing leaks to the pool. It enforces the limit by
 * terminating the connection. This owns one checkout so that termination is observed,
 * reported as a typed recoverable error, and the dead connection is discarded instead of
 * surfacing as an uncaught driver error and a failed rollback.
 */
export async function runBoundedFinanceTransaction<T>(
  db: Database,
  limits: FinanceTransactionLimits,
  work: (tx: Transaction) => Promise<T>,
): Promise<T> {
  const pool = (db as Database & { $client: Pool }).$client;
  const client = await pool.connect();
  let timedOut = false;
  let broken = false;
  const onError = (error: Error) => {
    broken = true;
    if (isTransactionTimeout(error)) timedOut = true;
  };
  client.on("error", onError);
  try {
    const session: Database = drizzle(client, { schema: databaseSchema });
    return await session.transaction(async (tx) => {
      await tx.execute(sql.raw(`SET LOCAL transaction_timeout = '${limits.transactionMs}ms'`));
      await tx.execute(sql.raw(`SET LOCAL statement_timeout = '${limits.statementMs}ms'`));
      await tx.execute(sql.raw(`SET LOCAL lock_timeout = '${limits.lockMs}ms'`));
      try {
        return await work(tx);
      } catch (error) {
        // The rollback that follows fails on the terminated connection and would
        // otherwise replace this, the only error that names the cause.
        if (isTransactionTimeout(error)) timedOut = true;
        throw error;
      }
    });
  } catch (error) {
    if (!(error instanceof AppError)) broken = true;
    if (timedOut || isTransactionTimeout(error))
      throw new AppError(
        "service_unavailable",
        "This Finance request ran out of time before it was saved. Read the current state before trying again.",
      );
    throw error;
  } finally {
    if (broken || timedOut) {
      // Never return a connection whose state is unknown to the pool.
      client.once("end", () => client.removeListener("error", onError));
      client.release(true);
    } else {
      client.removeListener("error", onError);
      client.release();
    }
  }
}
