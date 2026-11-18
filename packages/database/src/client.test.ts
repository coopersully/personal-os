import { EventEmitter } from "node:events";
import { Pool, type PoolClient, type PoolConfig } from "pg";
import { createDatabaseClient, createDatabaseClientFromPool } from "./client.js";

/** Only client I/O is controlled; acquisition, release, removal and end use the real pinned Pool. */
class HeldEndClient extends EventEmitter {
  _queryable = true;
  _ending = false;
  _ended = false;
  connect(callback: (error: Error | null) => void) {
    queueMicrotask(() => callback(null));
  }
  end(callback?: () => void) {
    this._ending = true;
    if (callback) this.once("end", callback);
  }
  finishEnd() {
    this._ended = true;
    this.emit("end");
  }
}
function controlledPool() {
  const options: PoolConfig = {
    // This I/O double implements only the client operations exercised by the real Pool.
    Client: HeldEndClient as unknown as NonNullable<PoolConfig["Client"]>,
    max: 2,
    idleTimeoutMillis: 0,
  };
  return new Pool(options);
}
async function connection(pool: Pool) {
  return (await pool.connect()) as PoolClient & HeldEndClient;
}
async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
}

describe("database client", () => {
  it("accepts a structured pool configuration and closes an unused pool idempotently", async () => {
    const client = createDatabaseClient({ max: 1 });
    expect(client.db).toBeDefined();
    expect(client.pool.options.max).toBe(1);
    const end = vi.spyOn(client.pool, "end");
    const first = client.close();
    expect(client.close()).toBe(first);
    await first;
    expect(end).toHaveBeenCalledOnce();
    expect(client.close()).toBe(first);
  });

  it("waits for a held idle client's actual end even after Pool.end has resolved", async () => {
    const pool = controlledPool();
    const database = createDatabaseClientFromPool(pool);
    const socket = await connection(pool);
    socket.release();
    let closed = false;
    const close = database.close().then(() => {
      closed = true;
    });
    await flushMicrotasks();
    expect(pool.ended).toBe(true);
    expect(pool.totalCount).toBe(0);
    expect(socket._ended).toBe(false);
    expect(closed).toBe(false);
    socket.finishEnd();
    await close;
    expect(closed).toBe(true);
  });

  it("drains all clients and shares the pending close promise", async () => {
    const pool = controlledPool();
    const database = createDatabaseClientFromPool(pool);
    const first = await connection(pool);
    const second = await connection(pool);
    first.release();
    second.release();
    const close = database.close();
    expect(database.close()).toBe(close);
    let closed = false;
    void close.then(() => {
      closed = true;
    });
    first.finishEnd();
    await flushMicrotasks();
    expect(closed).toBe(false);
    second.finishEnd();
    await close;
    expect(closed).toBe(true);
  });

  it("waits for an acquired client to be released and finish ending", async () => {
    const pool = controlledPool();
    const database = createDatabaseClientFromPool(pool);
    const socket = await connection(pool);
    let closed = false;
    const close = database.close().then(() => {
      closed = true;
    });
    await flushMicrotasks();
    expect(closed).toBe(false);
    expect(socket._ending).toBe(false);
    socket.release();
    await flushMicrotasks();
    expect(socket._ending).toBe(true);
    expect(closed).toBe(false);
    socket.finishEnd();
    await close;
    expect(closed).toBe(true);
    expect(pool.listenerCount("connect")).toBe(0);
  });

  it("accepts a connection string without opening a connection during construction", async () => {
    const database = createDatabaseClient("postgresql://example.invalid/database");
    expect(database.pool.totalCount).toBe(0);
    await database.close();
  });

  it("tracks a client already removed from pool bookkeeping but still ending", async () => {
    const pool = controlledPool();
    const database = createDatabaseClientFromPool(pool);
    const socket = await connection(pool);
    socket.release(true);
    expect(pool.totalCount).toBe(0);
    let closed = false;
    const close = database.close().then(() => {
      closed = true;
    });
    await flushMicrotasks();
    expect(closed).toBe(false);
    socket.finishEnd();
    await close;
  });

  it("does not wait again for a client that has already ended", async () => {
    const pool = controlledPool();
    const database = createDatabaseClientFromPool(pool);
    const socket = await connection(pool);
    socket.release(true);
    socket.finishEnd();
    await database.close();
    expect(pool.ended).toBe(true);
  });

  it("does not suppress an unexpected idle-client error during shutdown", async () => {
    const pool = controlledPool();
    const database = createDatabaseClientFromPool(pool);
    const socket = await connection(pool);
    socket.release();
    const close = database.close();
    const error = new Error("Unexpected shutdown failure");
    expect(() => socket.emit("error", error)).toThrow(error);
    socket.finishEnd();
    await close;
  });

  it("preserves a rejected pool close and never starts another close attempt", async () => {
    const pool = controlledPool();
    const database = createDatabaseClientFromPool(pool);
    const error = new Error("Pool close rejected");
    const end = vi.spyOn(pool, "end").mockRejectedValue(error);
    const close = database.close();
    await expect(close).rejects.toBe(error);
    expect(database.close()).toBe(close);
    await expect(database.close()).rejects.toBe(error);
    expect(end).toHaveBeenCalledOnce();
    end.mockRestore();
    await pool.end();
  });

  it("explicitly rejects a preconnected pool without taking ownership or closing it", async () => {
    const pool = controlledPool();
    const socket = await connection(pool);
    expect(() => createDatabaseClientFromPool(pool)).toThrow(/fresh pool/);
    expect(pool.ending).toBe(false);
    socket.release();
    const close = pool.end();
    socket.finishEnd();
    await close;
  });

  it("explicitly rejects a pool whose shutdown has already started", async () => {
    const pool = controlledPool();
    await pool.end();
    expect(() => createDatabaseClientFromPool(pool)).toThrow(/fresh pool/);
  });
});
