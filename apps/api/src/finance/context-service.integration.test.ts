import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import {
  createDatabaseClient,
  type DatabaseClient,
  migrateDatabase,
  users,
} from "@personal-os/database";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { sql } from "drizzle-orm";
import { createFinanceContextService } from "./context-service.js";

const content = {
  text: "Reimbursement expected",
  validFrom: null,
  validThrough: null,
  participants: ["Sam"],
  paymentChannel: null,
  expectedCents: null,
  categoryId: null,
  transactionIds: [],
};
describe.sequential("capture-only Finance contexts", () => {
  let container: StartedPostgreSqlContainer;
  let database: DatabaseClient;
  let userId: string;
  let time: Date;
  function service(
    scopes = ["finances:read", "finances:write"],
    actorType: "user" | "agent" = "user",
  ) {
    return createFinanceContextService({
      db: database.db,
      principal: { userId, actorId: userId, actorType, scopes: new Set(scopes) as never },
      requestId: "context-test",
      now: () => time,
    });
  }
  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:17.5-alpine").start();
    database = createDatabaseClient(container.getConnectionUri());
    await migrateDatabase(database.db, resolve(process.cwd(), "packages/database/migrations"));
  }, 120_000);
  beforeEach(async () => {
    userId = randomUUID();
    time = new Date("2026-09-20T12:00:00Z");
    await database.db.insert(users).values({
      id: userId,
      displayName: "Context",
      email: `${userId}@example.com`,
      passwordHash: "unused",
    });
  });
  afterAll(async () => {
    await database?.close();
    await container?.stop();
  });
  it("captures, replaces and cancels immutable snapshots with exact historical replay", async () => {
    const api = service();
    const input = { ...content, type: "create" as const, operationId: randomUUID() };
    const first = await api.captureContext(input);
    expect(first).toMatchObject({
      ...content,
      revision: "1",
      status: "active",
      source: { revision: "1" },
    });
    const second = await api.captureContext({
      ...content,
      type: "revise",
      operationId: randomUUID(),
      id: first.id,
      expectedRevision: "1",
      text: "Updated",
      expectedCents: 123,
    });
    expect(second).toMatchObject({ revision: "2", text: "Updated", expectedCents: 123 });
    expect(second.source.id).not.toBe(first.source.id);
    const cancelled = await api.captureContext({
      type: "cancel",
      operationId: randomUUID(),
      id: first.id,
      expectedRevision: "2",
    });
    expect(cancelled).toMatchObject({
      revision: "3",
      status: "cancelled",
      text: "Updated",
      expectedCents: 123,
    });
    expect(await api.captureContext(input)).toEqual(first);
    expect(await api.getCurrentContext(userId, first.id)).toEqual(cancelled);
    await expect(api.captureContext({ ...input, text: "Changed" })).rejects.toMatchObject({
      code: "invalid_request",
    });
    await expect(
      api.captureContext({
        type: "cancel",
        operationId: randomUUID(),
        id: first.id,
        expectedRevision: "3",
      }),
    ).rejects.toMatchObject({ code: "conflict" });
  });
  it("checks scope, tenant and server provenance before replay without leaking another owner", async () => {
    const input = { ...content, type: "create", operationId: randomUUID() };
    const first = await service().captureContext(input);
    await expect(service([]).captureContext(input)).rejects.toMatchObject({ code: "forbidden" });
    await expect(service([]).getCurrentContext(userId, first.id)).rejects.toMatchObject({
      code: "forbidden",
    });
    await expect(service().getCurrentContext(randomUUID(), first.id)).rejects.toMatchObject({
      code: "forbidden",
    });
    await expect(service().getCurrentContext(userId, randomUUID())).rejects.toMatchObject({
      code: "not_found",
    });
    const original = userId;
    userId = randomUUID();
    await database.db.insert(users).values({
      id: userId,
      displayName: "Other",
      email: `${userId}@example.com`,
      passwordHash: "unused",
    });
    await expect(service().getCurrentContext(userId, first.id)).rejects.toMatchObject({
      code: "not_found",
    });
    await expect(
      service().captureContext({
        type: "cancel",
        id: first.id,
        expectedRevision: "1",
        operationId: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "not_found" });
    const invalid = createFinanceContextService({
      db: database.db,
      principal: {
        userId: original,
        actorId: "",
        actorType: "user",
        scopes: new Set(["finances:write"]),
      },
      requestId: "valid",
    });
    await expect(invalid.captureContext(input)).rejects.toThrow();
    const agent = await service(undefined, "agent").captureContext({
      ...input,
      operationId: randomUUID(),
    });
    expect(
      (
        await database.pool.query(
          "SELECT source_kind,actor_type FROM finance_context_revisions WHERE id=$1",
          [agent.source.id],
        )
      ).rows,
    ).toEqual([{ source_kind: "agent", actor_type: "agent" }]);
    expect(
      (
        await database.pool.query(
          "SELECT count(*)::int AS count FROM finance_transactions WHERE user_id=$1",
          [userId],
        )
      ).rows[0].count,
    ).toBe(0);
  });

  it("conflicts on effective expiry without materializing it; read commits exactly one terminal snapshot", async () => {
    const api = service();
    const input = {
      ...content,
      type: "create",
      operationId: randomUUID(),
      validFrom: "2026-09-20T11:00:00Z",
      validThrough: "2026-09-20T13:00:00Z",
    };
    const first = await api.captureContext(input);
    expect((await api.getCurrentContext(userId, first.id)).status).toBe("active");
    time = new Date("2026-09-20T13:00:00Z");
    const cancel = {
      type: "cancel",
      operationId: randomUUID(),
      id: first.id,
      expectedRevision: "1",
    };
    await expect(api.captureContext(cancel)).rejects.toMatchObject({ code: "conflict" });
    expect(
      (
        await database.pool.query("SELECT current_revision FROM finance_contexts WHERE id=$1", [
          first.id,
        ])
      ).rows[0].current_revision,
    ).toBe("1");
    expect(
      (
        await database.pool.query(
          "SELECT status FROM finance_mutation_records WHERE idempotency_key=$1",
          [cancel.operationId],
        )
      ).rows[0].status,
    ).toBe("failed");
    await expect(api.captureContext(cancel)).rejects.toMatchObject({ code: "conflict" });
    const reads = await Promise.all([
      api.getCurrentContext(userId, first.id),
      api.getCurrentContext(userId, first.id),
    ]);
    expect(reads[0]).toEqual(reads[1]);
    expect(reads[0]).toMatchObject({ status: "expired", revision: "2" });
    expect(await api.captureContext(input)).toEqual(first);
    await expect(
      api.captureContext({
        ...input,
        type: "revise",
        id: first.id,
        expectedRevision: "2",
        operationId: randomUUID(),
        validThrough: null,
      }),
    ).rejects.toMatchObject({ code: "conflict" });
    await expect(api.captureContext({ ...input, operationId: randomUUID() })).rejects.toMatchObject(
      { code: "conflict" },
    );
    expect(
      (
        await database.pool.query(
          "SELECT actor_type,actor_id,operation_id FROM finance_context_revisions WHERE id=$1",
          [reads[0]?.source.id],
        )
      ).rows,
    ).toEqual([{ actor_type: "system", actor_id: "finance-context-expiry", operation_id: null }]);
    const audit = (
      await database.pool.query("SELECT before,after FROM audit_events WHERE entity_id=$1", [
        first.id,
      ])
    ).rows;
    expect(audit).toHaveLength(2);
    expect(JSON.stringify(audit)).not.toContain(content.text);
  });

  it("rolls back supplied mutations, receipt and audit; supplied expiry remains provisional", async () => {
    const api = service();
    const operationId = randomUUID();
    await expect(
      database.db.transaction(async (tx) => {
        await api.captureContext({ ...content, type: "create", operationId }, tx);
        throw new Error("outer rollback");
      }),
    ).rejects.toThrow("outer rollback");
    expect(
      (
        await database.pool.query(
          "SELECT count(*)::int AS count FROM finance_contexts WHERE user_id=$1",
          [userId],
        )
      ).rows[0].count,
    ).toBe(0);
    expect(
      (
        await database.pool.query(
          "SELECT count(*)::int AS count FROM finance_mutation_records WHERE user_id=$1",
          [userId],
        )
      ).rows[0].count,
    ).toBe(0);
    expect(
      (
        await database.pool.query(
          "SELECT count(*)::int AS count FROM audit_events WHERE user_id=$1",
          [userId],
        )
      ).rows[0].count,
    ).toBe(0);
    const first = await api.captureContext({
      ...content,
      type: "create",
      operationId,
      validThrough: "2026-09-20T13:00:00Z",
    });
    time = new Date("2026-09-20T13:00:00Z");
    await expect(
      database.db.transaction(async (tx) => {
        expect((await api.getCurrentContext(userId, first.id, tx)).status).toBe("expired");
        throw new Error("outer rollback");
      }),
    ).rejects.toThrow("outer rollback");
    expect(
      (
        await database.pool.query("SELECT current_revision FROM finance_contexts WHERE id=$1", [
          first.id,
        ])
      ).rows[0].current_revision,
    ).toBe("1");
  });

  async function blockedBy(pid: number) {
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline) {
      const rows = await database.pool.query(
        "SELECT pid FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid))",
        [pid],
      );
      if (rows.rowCount) return;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error("Expected PostgreSQL lock wait was not observed");
  }
  it("serializes duplicate receipts and competing revisions behind observed barriers", async () => {
    const api = service();
    const input = { ...content, type: "create", operationId: randomUUID() };
    const blocker = await database.pool.connect();
    try {
      await blocker.query("BEGIN");
      const pid = (await blocker.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
      await blocker.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        `finance-mutation:${userId}:${input.operationId}`,
      ]);
      const one = api.captureContext(input);
      const two = api.captureContext(input);
      const results = Promise.all([one, two]);
      await blockedBy(pid);
      await blocker.query("COMMIT");
      const [a, b] = await results;
      expect(a).toEqual(b);
      await blocker.query("BEGIN");
      await blocker.query("SELECT id FROM finance_contexts WHERE id=$1 FOR UPDATE", [a.id]);
      const replace = {
        ...content,
        type: "revise",
        id: a.id,
        expectedRevision: "1",
        text: "Replacement",
      };
      const racing = Promise.allSettled([
        api.captureContext({ ...replace, operationId: randomUUID() }),
        api.captureContext({ ...replace, operationId: randomUUID() }),
      ]);
      await blockedBy(pid);
      await blocker.query("COMMIT");
      const outcomes = await racing;
      expect(outcomes.filter((x) => x.status === "fulfilled")).toHaveLength(1);
      expect(outcomes.filter((x) => x.status === "rejected")).toHaveLength(1);
      expect((await api.getCurrentContext(userId, a.id)).revision).toBe("2");
    } finally {
      await blocker.query("ROLLBACK");
      blocker.release();
    }
  });

  it("samples expiry after a pointer wait, not before it", async () => {
    const api = service();
    const first = await api.captureContext({
      ...content,
      type: "create",
      operationId: randomUUID(),
      validThrough: "2026-09-20T13:00:00Z",
    });
    const blocker = await database.pool.connect();
    try {
      await blocker.query("BEGIN");
      const pid = (await blocker.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
      await blocker.query("SELECT id FROM finance_contexts WHERE id=$1 FOR UPDATE", [first.id]);
      const pending = api.getCurrentContext(userId, first.id);
      await blockedBy(pid);
      time = new Date("2026-09-20T13:00:00Z");
      await blocker.query("COMMIT");
      expect(await pending).toMatchObject({ status: "expired", revision: "2" });
    } finally {
      await blocker.query("ROLLBACK");
      blocker.release();
    }
  });

  it.each([
    "read",
    "create",
    "reclaim",
  ])("admits %s before deletion and fails after deletion wins", async (mode) => {
    const api = service();
    const input = { ...content, type: "create", operationId: randomUUID() };
    const first = await api.captureContext(input);
    if (mode === "reclaim")
      await database.pool.query(
        "UPDATE finance_mutation_records SET status='started', response=NULL, lease_expires_at=now()-interval '1 hour' WHERE idempotency_key=$1",
        [input.operationId],
      );
    const blocker = await database.pool.connect();
    try {
      await blocker.query("BEGIN");
      await blocker.query("SET LOCAL lock_timeout='4s'");
      const pid = (await blocker.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
      await blocker.query("DELETE FROM users WHERE id=$1", [userId]);
      const pending =
        mode === "read"
          ? api.getCurrentContext(userId, first.id)
          : api.captureContext(mode === "create" ? { ...input, operationId: randomUUID() } : input);
      const assertion = expect(pending).rejects.toMatchObject({ code: "not_found" });
      await blockedBy(pid);
      await blocker.query("COMMIT");
      await assertion;
      expect(
        (
          await database.pool.query(
            "SELECT count(*)::int AS count FROM finance_context_revisions WHERE user_id=$1",
            [userId],
          )
        ).rows[0].count,
      ).toBe(0);
    } finally {
      await blocker.query("ROLLBACK");
      blocker.release();
    }
  });

  it.each([
    "read",
    "create",
    "reclaim",
  ])("holds %s admission through supplied commit while deletion waits at the user", async (mode) => {
    const api = service();
    const input = {
      ...content,
      type: "create",
      operationId: randomUUID(),
      validThrough: "2026-09-20T13:00:00Z",
    };
    const first = await api.captureContext(input);
    if (mode === "reclaim")
      await database.pool.query(
        "UPDATE finance_mutation_records SET status='started', response=NULL, lease_expires_at=now()-interval '1 hour' WHERE idempotency_key=$1",
        [input.operationId],
      );
    if (mode === "read") time = new Date("2026-09-20T13:00:00Z");
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let admitted: (pid: number) => void = () => {};
    const ready = new Promise<number>((resolve) => {
      admitted = resolve;
    });
    const txPromise = database.db.transaction(async (tx) => {
      if (mode === "read") await api.getCurrentContext(userId, first.id, tx);
      else
        await api.captureContext(
          mode === "create" ? { ...input, operationId: randomUUID() } : input,
          tx,
        );
      const result = await tx.execute(sql`SELECT pg_backend_pid() AS pid`);
      admitted(Number(result.rows[0]?.pid));
      await gate;
    });
    const pid = await ready;
    const deleter = await database.pool.connect();
    try {
      await deleter.query("SET lock_timeout='4s'");
      const deletion = deleter.query("DELETE FROM users WHERE id=$1", [userId]);
      await blockedBy(pid);
      release();
      await txPromise;
      await deletion;
      expect(
        (
          await database.pool.query(
            "SELECT count(*)::int AS count FROM finance_contexts WHERE user_id=$1",
            [userId],
          )
        ).rows[0].count,
      ).toBe(0);
    } finally {
      release();
      await txPromise;
      deleter.release();
    }
  });
  it.each([
    ["finance_context_revisions", "AFTER INSERT"],
    ["finance_contexts", "BEFORE UPDATE"],
    ["finance_mutation_records", "BEFORE UPDATE"],
  ])("rolls back an injected failure at %s %s", async (table, event) => {
    const api = service();
    const first = await api.captureContext({
      ...content,
      type: "create",
      operationId: randomUUID(),
    });
    const operationId = randomUUID();
    await database.pool.query(`CREATE FUNCTION context_test_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF TG_TABLE_NAME = 'finance_mutation_records' THEN IF NEW.status <> 'completed' THEN RETURN NEW; END IF; END IF;
      RAISE EXCEPTION 'injected context failure'; END; $$`);
    await database.pool.query(
      `CREATE TRIGGER context_test_fail ${event} ON ${table} FOR EACH ROW EXECUTE FUNCTION context_test_fail()`,
    );
    try {
      await expect(
        api.captureContext({
          ...content,
          type: "revise",
          id: first.id,
          expectedRevision: "1",
          operationId,
        }),
      ).rejects.toThrow();
      expect(
        (
          await database.pool.query("SELECT current_revision FROM finance_contexts WHERE id=$1", [
            first.id,
          ])
        ).rows[0].current_revision,
      ).toBe("1");
      expect(
        (
          await database.pool.query(
            "SELECT count(*)::int AS count FROM finance_context_revisions WHERE context_id=$1",
            [first.id],
          )
        ).rows[0].count,
      ).toBe(1);
      expect(
        (
          await database.pool.query(
            "SELECT status FROM finance_mutation_records WHERE idempotency_key=$1",
            [operationId],
          )
        ).rows,
      ).toEqual([{ status: "failed" }]);
    } finally {
      await database.pool.query(`DROP TRIGGER context_test_fail ON ${table}`);
      await database.pool.query("DROP FUNCTION context_test_fail()");
    }
  });

  it("returns conflict when pointer CAS affects no row and rolls back the appended snapshot", async () => {
    const api = service();
    const first = await api.captureContext({
      ...content,
      type: "create",
      operationId: randomUUID(),
    });
    await database.pool.query(
      "CREATE FUNCTION context_test_skip() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NULL; END; $$; CREATE TRIGGER context_test_skip BEFORE UPDATE ON finance_contexts FOR EACH ROW EXECUTE FUNCTION context_test_skip()",
    );
    try {
      await expect(
        api.captureContext({
          ...content,
          type: "revise",
          id: first.id,
          expectedRevision: "1",
          operationId: randomUUID(),
        }),
      ).rejects.toMatchObject({ code: "conflict" });
      expect(
        (
          await database.pool.query(
            "SELECT count(*)::int AS count FROM finance_context_revisions WHERE context_id=$1",
            [first.id],
          )
        ).rows[0].count,
      ).toBe(1);
    } finally {
      await database.pool.query(
        "DROP TRIGGER context_test_skip ON finance_contexts; DROP FUNCTION context_test_skip()",
      );
    }
  });

  it("refuses bigint revision overflow without converting the revision to Number", async () => {
    const api = service();
    const first = await api.captureContext({
      ...content,
      type: "create",
      operationId: randomUUID(),
    });
    const client = await database.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "INSERT INTO finance_context_revisions(context_id,user_id,revision,text,status,source_kind,actor_type,actor_id,request_id,operation_id,recorded_at) VALUES($1,$2,9223372036854775807,'Limit','active','app','user','user','test',gen_random_uuid(),now())",
        [first.id, userId],
      );
      await client.query(
        "UPDATE finance_contexts SET current_revision=9223372036854775807 WHERE id=$1",
        [first.id],
      );
      await client.query("COMMIT");
      expect((await api.getCurrentContext(userId, first.id)).revision).toBe("9223372036854775807");
      await expect(
        api.captureContext({
          type: "cancel",
          id: first.id,
          expectedRevision: "9223372036854775807",
          operationId: randomUUID(),
        }),
      ).rejects.toMatchObject({ code: "conflict" });
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });
  it("uses the server clock by default and rejects invalid authenticated actor kinds", async () => {
    const principal = {
      userId,
      actorId: userId,
      actorType: "user" as const,
      scopes: new Set(["finances:read" as const, "finances:write" as const]),
    };
    const api = createFinanceContextService({
      db: database.db,
      principal,
      requestId: "default-clock",
    });
    const first = await api.captureContext({
      ...content,
      type: "create",
      operationId: randomUUID(),
    });
    expect(await api.getCurrentContext(userId, first.id)).toEqual(first);
    const invalid = createFinanceContextService({
      db: database.db,
      principal: { ...principal, actorType: "connector" as never },
      requestId: "invalid-actor",
    });
    await expect(
      invalid.captureContext({ ...content, type: "create", operationId: randomUUID() }),
    ).rejects.toMatchObject({ code: "forbidden" });
  });

  it("preserves the operation error when deletion wins before standalone failure persistence", async () => {
    const api = service();
    const blocker = await database.pool.connect();
    const deleter = await database.pool.connect();
    // Block inside the mutation after admission; queue deletion before releasing its failure.
    await database.pool.query(
      "CREATE FUNCTION context_test_wait_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_advisory_xact_lock(88547); RAISE EXCEPTION 'controlled context failure'; END; $$; CREATE TRIGGER context_test_wait_fail BEFORE INSERT ON finance_context_revisions FOR EACH ROW EXECUTE FUNCTION context_test_wait_fail()",
    );
    let operation: Promise<unknown> | undefined;
    try {
      await blocker.query("BEGIN");
      await blocker.query("SELECT pg_advisory_xact_lock(88547)");
      const blockerPid = (await blocker.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
      operation = api
        .captureContext({ ...content, type: "create", operationId: randomUUID() })
        .catch((error) => error);
      await blockedBy(blockerPid);
      const waiting = (
        await database.pool.query(
          "SELECT pid FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))",
          [blockerPid],
        )
      ).rows[0].pid;
      await deleter.query("BEGIN");
      await deleter.query("SET LOCAL lock_timeout='4s'");
      const deletion = deleter.query("DELETE FROM users WHERE id=$1", [userId]);
      await blockedBy(waiting);
      await blocker.query("COMMIT");
      await deletion;
      const deletePid = (await deleter.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
      await blockedBy(deletePid);
      await deleter.query("COMMIT");
      const error = await operation;
      expect(error).toBeInstanceOf(Error);
      expect((error as { cause?: { message?: string } }).cause?.message).toContain(
        "controlled context failure",
      );
      expect(
        (
          await database.pool.query(
            "SELECT count(*)::int AS count FROM finance_mutation_records WHERE user_id=$1",
            [userId],
          )
        ).rows[0].count,
      ).toBe(0);
    } finally {
      await blocker.query("ROLLBACK");
      await deleter.query("ROLLBACK");
      await operation;
      blocker.release();
      deleter.release();
      await database.pool.query(
        "DROP TRIGGER context_test_wait_fail ON finance_context_revisions; DROP FUNCTION context_test_wait_fail()",
      );
    }
  });
  it("reuses the supplied connection for authorization with a one-connection pool", async () => {
    const single = createDatabaseClient({
      connectionString: container.getConnectionUri(),
      max: 1,
      connectionTimeoutMillis: 1_000,
    });
    try {
      const api = createFinanceContextService({
        db: single.db,
        principal: {
          userId,
          actorId: userId,
          actorType: "user",
          scopes: new Set(["finances:write", "finances:read"]),
        },
        requestId: "single-connection",
      });
      const captured = await single.db.transaction((tx) =>
        api.captureContext(
          {
            ...content,
            type: "create",
            operationId: randomUUID(),
          },
          tx,
        ),
      );
      expect(captured).toMatchObject({ revision: "1", status: "active" });
      expect(await api.getCurrentContext(userId, captured.id)).toEqual(captured);
      expect(single.pool.totalCount).toBe(1);
      expect(single.pool.waitingCount).toBe(0);
    } finally {
      await single.close();
    }
  });
});
