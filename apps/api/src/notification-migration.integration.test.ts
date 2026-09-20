import { randomUUID } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { createDatabaseClient, type DatabaseClient, migrateDatabase } from "@personal-os/database";
import { defaultNotificationPreferences, textOccurredAtSourceSchema } from "@personal-os/domain";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { migrationsWithout } from "./test-migrations.js";

describe.sequential("notification migration integrity", () => {
  let container: StartedPostgreSqlContainer;
  let database: DatabaseClient;
  const owner = randomUUID();
  const other = randomUUID();
  const connection = randomUUID();
  const foreignConnection = randomUUID();
  let originalMessages: Record<string, unknown>[];
  let originalConsent: Record<string, unknown>[];
  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:17.5-alpine").start();
    database = createDatabaseClient(container.getConnectionUri());
    const folder = resolve(process.cwd(), "packages/database/migrations");
    const prior = await migrationsWithout(folder, "nohmi-notifications-", [
      "0086_notification_foundation",
    ]);
    try {
      await migrateDatabase(database.db, prior);
      for (const [user, conn] of [
        [owner, connection],
        [other, foreignConnection],
      ]) {
        await database.pool.query(
          "INSERT INTO users(id,email,display_name,password_hash) VALUES($1,$2,'Test','unused')",
          [user, `${user}@example.test`],
        );
        await database.pool.query(
          "INSERT INTO texting_connections(id,user_id,encrypted_phone_number,phone_fingerprint,phone_last_four,country,consent_version,verified_at,consent_epoch) VALUES($1,$2,'{}',$2::uuid::text,'0123','US','v1',now(),3)",
          [conn, user],
        );
      }
      for (const source of ["ilo", "provider"]) {
        await database.pool.query(
          "INSERT INTO text_messages(user_id,connection_id,body,direction,status,occurred_at,occurred_at_source) VALUES($1,$2,$3,'outbound','delivered','2026-01-01T12:00:00Z',$4)",
          [owner, connection, `Historical ${source} body`, source],
        );
      }
      for (const source of ["ilo", "twilio"]) {
        await database.pool.query(
          "INSERT INTO texting_consent_events(user_id,connection_id,phone_fingerprint,kind,source,occurred_at) VALUES($1,$2,$1::uuid::text,'verified_opt_in',$3,'2026-01-01T12:00:00Z')",
          [owner, connection, source],
        );
      }
      originalMessages = (await database.pool.query("SELECT * FROM text_messages ORDER BY id"))
        .rows;
      originalConsent = (
        await database.pool.query("SELECT * FROM texting_consent_events ORDER BY id")
      ).rows;
      await migrateDatabase(database.db, folder);
    } finally {
      await rm(prior, { recursive: true, force: true });
    }
  }, 120_000);
  afterAll(async () => {
    await database?.close();
    await container?.stop();
  });
  it("cuts over only application provenance and preserves all historical evidence on replay", async () => {
    const expectedMessages = originalMessages.map((r) => ({
      ...r,
      occurred_at_source: r.occurred_at_source === "ilo" ? "nohmi" : r.occurred_at_source,
    }));
    const expectedConsent = originalConsent.map((r) => ({
      ...r,
      source: r.source === "ilo" ? "nohmi" : r.source,
    }));
    for (let repeat = 0; repeat < 2; repeat++) {
      expect((await database.pool.query("SELECT * FROM text_messages ORDER BY id")).rows).toEqual(
        expectedMessages,
      );
      expect(
        (await database.pool.query("SELECT * FROM texting_consent_events ORDER BY id")).rows,
      ).toEqual(expectedConsent);
      expect(
        (
          await database.pool.query("SELECT consent_epoch FROM texting_connections WHERE id=$1", [
            connection,
          ])
        ).rows[0].consent_epoch,
      ).toBe(3);
      const sql = await readFile(
        resolve(process.cwd(), "packages/database/migrations/0086_notification_foundation.sql"),
        "utf8",
      );
      for (const part of sql.split("--> statement-breakpoint")) {
        if (
          part.includes("UPDATE text_messages SET") ||
          part.includes("UPDATE texting_consent_events SET")
        )
          await database.pool.query(part);
      }
      await migrateDatabase(database.db, resolve(process.cwd(), "packages/database/migrations"));
    }
    expect(textOccurredAtSourceSchema.parse("nohmi")).toBe("nohmi");
    expect(textOccurredAtSourceSchema.safeParse("ilo").success).toBe(false);
    expect(textOccurredAtSourceSchema.parse("provider")).toBe("provider");
  });
  it("rejects malformed preferences and references at the database boundary", async () => {
    for (const preferences of [
      {},
      { ...defaultNotificationPreferences, reminderDays: 0 },
      { ...defaultNotificationPreferences, quietStartMinute: 1440 },
      { ...defaultNotificationPreferences, detail: "unrestricted" },
    ])
      await expect(
        database.pool.query(
          "INSERT INTO notification_preferences(user_id,scope,revision,preferences) VALUES($1,'global',1,$2)",
          [owner, JSON.stringify(preferences)],
        ),
      ).rejects.toThrow();
    await expect(
      database.pool.query(
        "INSERT INTO notification_preferences(user_id,scope,revision,preferences) VALUES($1,'mail',1,$2)",
        [owner, JSON.stringify(defaultNotificationPreferences)],
      ),
    ).rejects.toThrow();
    await expect(
      database.pool.query(
        "INSERT INTO notification_preferences(user_id,scope,revision,preferences) VALUES($1,'global',0,$2)",
        [owner, JSON.stringify(defaultNotificationPreferences)],
      ),
    ).rejects.toThrow();
    await expect(
      database.pool.query(
        "INSERT INTO notification_intents(user_id,domain,work_id,work) VALUES($1,'finances',$2,'{}')",
        [owner, randomUUID()],
      ),
    ).rejects.toThrow();
  });
  it("enforces same-tenant connection and message references and complete submission evidence", async () => {
    const insert =
      "INSERT INTO notification_delivery_attempts(user_id,state,claim_id,lease_until,connection_id,consent_epoch) VALUES($1,$2,$3,now()+interval '1 minute',$4,3)";
    await expect(
      database.pool.query(insert, [owner, "claimed", randomUUID(), foreignConnection]),
    ).rejects.toThrow();
    await expect(
      database.pool.query(insert, [owner, "submitting", randomUUID(), connection]),
    ).rejects.toThrow();
    await expect(
      database.pool.query(insert, [owner, "nonsense", randomUUID(), connection]),
    ).rejects.toThrow();
    const attempt = (
      await database.pool.query(`${insert} RETURNING id`, [
        other,
        "claimed",
        randomUUID(),
        foreignConnection,
      ])
    ).rows[0].id;
    await expect(
      database.pool.query("UPDATE notification_delivery_attempts SET message_id=$1 WHERE id=$2", [
        originalMessages[0]?.id,
        attempt,
      ]),
    ).rejects.toThrow();
    await expect(
      database.pool.query("UPDATE notification_delivery_attempts SET generation=0 WHERE id=$1", [
        attempt,
      ]),
    ).rejects.toThrow();
    await expect(
      database.pool.query("UPDATE notification_delivery_attempts SET consent_epoch=0 WHERE id=$1", [
        attempt,
      ]),
    ).rejects.toThrow();
  });
});
