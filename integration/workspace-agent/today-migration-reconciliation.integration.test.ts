import { randomUUID } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createDatabaseClient, migrateDatabase } from "@personal-os/database";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { expect, it } from "vitest";

it.each([
  "fresh",
  "main",
  "today",
] as const)("reconciles the %s migration lineage without changing published history or preferences", async (history) => {
  const container = await new PostgreSqlContainer("postgres:17.5-alpine").start();
  const database = createDatabaseClient(container.getConnectionUri());
  const temporary = await mkdtemp(join(tmpdir(), "nohmi-today-merge-"));
  try {
    const root = resolve("packages/database/migrations");
    const journal = JSON.parse(await readFile(join(root, "meta/_journal.json"), "utf8")) as {
      entries: Array<{
        idx: number;
        version: string;
        when: number;
        tag: string;
        breakpoints: boolean;
      }>;
    };
    const today = journal.entries.find((entry) => entry.tag === "0112_today_preferences")!;
    const connector = journal.entries.find(
      (entry) => entry.tag === "0112_connector_capability_health",
    )!;
    expect(today).toEqual({
      idx: 117,
      version: "7",
      when: 1791820800000,
      tag: "0112_today_preferences",
      breakpoints: true,
    });
    expect(connector).toEqual({
      idx: 117,
      version: "7",
      when: 1791806400000,
      tag: "0112_connector_capability_health",
      breakpoints: true,
    });
    const entries = journal.entries.filter(
      (entry) => !entry.tag.startsWith("0112_") && !entry.tag.startsWith("0113_"),
    );
    if (history === "main") entries.push(connector);
    if (history === "today") entries.push(today);
    await mkdir(join(temporary, "meta"));
    for (const entry of entries)
      await copyFile(join(root, `${entry.tag}.sql`), join(temporary, `${entry.tag}.sql`));
    await writeFile(join(temporary, "meta/_journal.json"), JSON.stringify({ ...journal, entries }));
    await migrateDatabase(database.db, temporary);
    const owner = randomUUID();
    await database.pool.query(
      "INSERT INTO users(id,email,display_name,password_hash) VALUES($1,$2,'Preserved owner','unused')",
      [owner, `${history}@migration.example`],
    );
    if (history === "today")
      await database.pool.query(
        "INSERT INTO today_settings(user_id,background,revision) VALUES($1,'map',7)",
        [owner],
      );
    await migrateDatabase(database.db, root);
    // Repeated migrations must stay idempotent for each lineage.
    await migrateDatabase(database.db, root);
    const columns = await database.pool.query(
      "SELECT column_name FROM information_schema.columns WHERE table_name='calendar_accounts' AND column_name='sync_capabilities'",
    );
    expect(columns.rowCount).toBe(1);
    const relation = await database.pool.query(
      "SELECT to_regclass('public.today_settings') AS name",
    );
    expect(relation.rows[0].name).toBe("today_settings");
    expect(
      (await database.pool.query("SELECT display_name FROM users WHERE id=$1", [owner])).rows[0]
        .display_name,
    ).toBe("Preserved owner");
    if (history === "today")
      expect(
        (
          await database.pool.query(
            "SELECT background,revision FROM today_settings WHERE user_id=$1",
            [owner],
          )
        ).rows[0],
      ).toEqual({ background: "map", revision: 7 });
  } finally {
    await database.close();
    await container.stop();
    await rm(temporary, { recursive: true, force: true });
  }
}, 60000);
