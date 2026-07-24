import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool, type PoolConfig } from "pg";
import * as schema from "./schema.js";

export type Database = NodePgDatabase<typeof schema>;

export type DatabaseClient = {
  close: () => Promise<void>;
  db: Database;
  pool: Pool;
};

export function createDatabaseClient(config: string | PoolConfig): DatabaseClient {
  const pool = new Pool(typeof config === "string" ? { connectionString: config } : config);
  return createDatabaseClientFromPool(pool);
}

export function createDatabaseClientFromPool(pool: Pool): DatabaseClient {
  return {
    close: async () => {
      await pool.end();
    },
    db: drizzle(pool, { schema }),
    pool,
  };
}

export async function migrateDatabase(db: Database, migrationsFolder: string): Promise<void> {
  await migrate(db, { migrationsFolder });
}
