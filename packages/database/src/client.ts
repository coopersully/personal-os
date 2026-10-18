import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool, type PoolClient, type PoolConfig } from "pg";
import * as schema from "./schema.js";

export type Database = NodePgDatabase<typeof schema>;

export type DatabaseClient = {
  /** Idempotent; resolves after pool shutdown AND every observed client end event. */
  close: () => Promise<void>;
  db: Database;
  pool: Pool;
};

export function createDatabaseClient(config: string | PoolConfig): DatabaseClient {
  const pool = new Pool(typeof config === "string" ? { connectionString: config } : config);
  return createDatabaseClientFromPool(pool);
}

/**
 * Takes ownership of a fresh pool, before any connection is opened or requested.
 * Prior connection events cannot be recovered through Pool's public API. Live or
 * closing pools are rejected; callers must also avoid supplying a previously used
 * pool that happens to be empty. The repository factory above always supplies a
 * newly constructed pool. Once wrapped, shut it down through this client's close.
 */
export function createDatabaseClientFromPool(pool: Pool): DatabaseClient {
  if (pool.totalCount !== 0 || pool.waitingCount !== 0 || pool.ending || pool.ended) {
    throw new Error("Database clients require a fresh pool before any connections are requested.");
  }
  const pendingEnds = new Set<Promise<void>>();
  const trackClient = (client: PoolClient) => {
    const ended = new Promise<void>((resolve) => {
      client.once("end", () => {
        pendingEnds.delete(ended);
        resolve();
      });
    });
    pendingEnds.add(ended);
  };
  pool.on("connect", trackClient);
  let closing: Promise<void> | undefined;
  return {
    close: () => {
      closing ??= (async () => {
        await pool.end();
        // pg-pool removes idle clients from its count before their end callbacks.
        // Keep removed-but-still-closing clients in this independent end barrier.
        await Promise.all(pendingEnds);
        pool.removeListener("connect", trackClient);
      })();
      return closing;
    },
    db: drizzle(pool, { schema }),
    pool,
  };
}

export async function migrateDatabase(db: Database, migrationsFolder: string): Promise<void> {
  await migrate(db, { migrationsFolder });
}
