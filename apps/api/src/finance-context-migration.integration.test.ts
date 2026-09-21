import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { resolve } from "node:path";
import { createDatabaseClient, type DatabaseClient, migrateDatabase } from "@personal-os/database";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { migrationsWithout } from "./test-migrations.js";

describe.sequential("Finance context migration integrity", () => {
  let container: StartedPostgreSqlContainer;
  let database: DatabaseClient;
  let owner: string;
  let other: string;
  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:17.5-alpine").start();
    database = createDatabaseClient(container.getConnectionUri());
    const folder = resolve(process.cwd(), "packages/database/migrations");
    const prior = await migrationsWithout(folder, "nohmi-context-", [
      "0085_finance_context_capture",
      "0086_notification_foundation",
      "0087_finance_budget_policy_management",
      "0088_finance_budget_policy_nonempty_text",
    ]);
    try {
      await migrateDatabase(database.db, prior);
      owner = randomUUID();
      other = randomUUID();
      for (const id of [owner, other])
        await database.pool.query(
          "INSERT INTO users(id,email,display_name,password_hash) VALUES($1,$2,'Context','unused')",
          [id, `${id}@example.com`],
        );
      await migrateDatabase(database.db, folder);
      expect(
        (
          await database.pool.query("SELECT id FROM users WHERE id=ANY($1::uuid[])", [
            [owner, other],
          ])
        ).rowCount,
      ).toBe(2);
    } finally {
      await rm(prior, { recursive: true, force: true });
    }
  }, 120_000);
  afterAll(async () => {
    await database?.close();
    await container?.stop();
  });
  const pointerSql = "INSERT INTO finance_contexts(id,user_id,current_revision) VALUES($1,$2,$3)";
  const snapshotSql =
    "INSERT INTO finance_context_revisions(context_id,user_id,revision,text,status,source_kind,actor_type,actor_id,request_id,operation_id,recorded_at) VALUES($1,$2,$3,'Context','active','app','user','user','request',gen_random_uuid(),now())";
  it.each([
    false,
    true,
  ])("commits a complete deferred cycle in either insertion order (%s)", async (snapshotFirst) => {
    const client = await database.pool.connect();
    const id = randomUUID();
    try {
      await client.query("BEGIN");
      await client.query(snapshotFirst ? snapshotSql : pointerSql, [id, owner, 1]);
      await client.query(snapshotFirst ? pointerSql : snapshotSql, [id, owner, 1]);
      await client.query("SET CONSTRAINTS ALL IMMEDIATE");
      await client.query("COMMIT");
      expect(
        (await database.pool.query("SELECT id FROM finance_contexts WHERE id=$1", [id])).rowCount,
      ).toBe(1);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });
  it.each([
    "missing_snapshot",
    "orphan_snapshot",
    "wrong_tenant",
    "wrong_context",
    "wrong_revision",
  ])("rejects %s at real COMMIT and leaves no partial rows", async (mode) => {
    const client = await database.pool.connect();
    const id = randomUUID();
    const foreignContext = randomUUID();
    try {
      await client.query("BEGIN");
      if (mode !== "orphan_snapshot") await client.query(pointerSql, [id, owner, 1]);
      if (mode !== "missing_snapshot")
        await client.query(snapshotSql, [
          mode === "wrong_context" ? foreignContext : id,
          mode === "wrong_tenant" ? other : owner,
          mode === "wrong_revision" ? 2 : 1,
        ]);
      await expect(client.query("COMMIT")).rejects.toMatchObject({ code: "23503" });
      expect(
        (await database.pool.query("SELECT id FROM finance_contexts WHERE id=$1", [id])).rowCount,
      ).toBe(0);
      expect(
        (
          await database.pool.query(
            "SELECT id FROM finance_context_revisions WHERE context_id=ANY($1::uuid[])",
            [[id, foreignContext]],
          )
        ).rowCount,
      ).toBe(0);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });
  it("rejects an incomplete pair when constraints are forced immediate", async () => {
    const client = await database.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(pointerSql, [randomUUID(), owner, 1]);
      await expect(client.query("SET CONSTRAINTS ALL IMMEDIATE")).rejects.toMatchObject({
        code: "23503",
      });
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });
  it("rejects all snapshot updates but permits privacy cascades and guards the live pointer", async () => {
    const id = randomUUID();
    const client = await database.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(pointerSql, [id, owner, 2]);
      await client.query(snapshotSql, [id, owner, 1]);
      await client.query(snapshotSql, [id, owner, 2]);
      await client.query("COMMIT");
      for (const change of ["text='changed'", "actor_id='changed'", "revision=99", "text=text"])
        await expect(
          client.query(`UPDATE finance_context_revisions SET ${change} WHERE context_id=$1`, [id]),
        ).rejects.toMatchObject({ code: "23514" });
      await client.query("BEGIN");
      await client.query(
        "DELETE FROM finance_context_revisions WHERE context_id=$1 AND revision=2",
        [id],
      );
      await expect(client.query("COMMIT")).rejects.toMatchObject({ code: "23503" });
      await client.query("DELETE FROM finance_contexts WHERE id=$1", [id]);
      expect(
        (await client.query("SELECT id FROM finance_context_revisions WHERE context_id=$1", [id]))
          .rowCount,
      ).toBe(0);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });
  it.each([
    null,
    "null",
    "{}",
    "[null]",
    "[1]",
    "[true]",
    "[{}]",
    '[""]',
    '[" padded "]',
    JSON.stringify(Array(51).fill("x")),
    JSON.stringify(["x".repeat(201)]),
  ])("participants helper fails closed for %s", async (input) => {
    expect(
      (
        await database.pool.query("SELECT finance_context_participants_valid($1::jsonb) AS valid", [
          input,
        ])
      ).rows[0].valid,
    ).toBe(false);
  });
  it("enforces zero links and exact bounded provenance independently of the service", async () => {
    const client = await database.pool.connect();
    const id = randomUUID();
    try {
      await client.query("BEGIN");
      await client.query(pointerSql, [id, owner, 1]);
      await client.query(snapshotSql, [id, owner, 1]);
      await client.query("COMMIT");
      const bad: Record<string, unknown> = {
        participants: null,
        transaction_ids: [randomUUID()],
        category_id: randomUUID(),
        expected_cents: "9007199254740992",
        request_id: "",
        actor_id: "x".repeat(241),
        source_kind: "sms",
        actor_type: "system",
        status: "matched",
        operation_id: null,
        text: "",
        payment_channel: " ",
        revision: 0,
      };
      for (const [column, input] of Object.entries(bad)) {
        // Copy an otherwise valid snapshot, overriding one constrained field on INSERT.
        const columns = [
          "context_id",
          "user_id",
          "revision",
          "text",
          "status",
          "source_kind",
          "actor_type",
          "actor_id",
          "request_id",
          "operation_id",
          "recorded_at",
          "participants",
          "transaction_ids",
          "category_id",
          "expected_cents",
          "payment_channel",
        ];
        const expressions = columns
          .map((name) => (name === column ? "$2" : name === "revision" ? "2" : name))
          .join(",");
        await expect(
          client.query(
            `INSERT INTO finance_context_revisions(${columns.join(",")}) SELECT ${expressions} FROM finance_context_revisions WHERE context_id=$1 AND revision=1`,
            [id, Array.isArray(input) ? JSON.stringify(input) : input],
          ),
        ).rejects.toMatchObject({
          code: input === null && column === "participants" ? "23502" : "23514",
        });
      }
    } finally {
      client.release();
    }
  });
});
