import { Socket } from "node:net";
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

export type DatabaseConnectionOptions = {
  connectHost?: string;
};

export function createDatabaseClient(
  config: string | PoolConfig,
  options: DatabaseConnectionOptions = {},
): DatabaseClient {
  const poolConfig: PoolConfig =
    typeof config === "string" ? { connectionString: config } : { ...config };
  const connectHost = options.connectHost;
  if (connectHost) {
    poolConfig.stream = () => createTransportStream(connectHost);
  }
  const pool = new Pool(poolConfig);
  return createDatabaseClientFromPool(pool);
}

function createTransportStream(connectHost: string): Socket {
  const socket = new Socket();
  const connect = socket.connect.bind(socket);
  socket.connect = ((port: number, _logicalHost?: string, listener?: () => void) =>
    connect(port, connectHost, listener)) as typeof socket.connect;
  return socket;
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
