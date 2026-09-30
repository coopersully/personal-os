#!/usr/bin/env node
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { backup, restore, run } from "./commands.mjs";
import { privateFile, writePrivate } from "./safety.mjs";
import { taskRepairPlan, taskRepairStatement } from "./task-repair.mjs";
import { unseal } from "./unseal.mjs";

// Database tools only. Never start API, MCP, schedulers or provider clients on a
// production-derived rehearsal copy. All Docker mutations target this unique name.
export async function rehearse(dump, destination, image, revision, sourcePath, backupKeyPath) {
  if (!/^sha256:[a-f0-9]{64}$/.test(image) || !/^[a-f0-9]{40}$/.test(revision))
    throw new Error("Supply an inspected local PostgreSQL image ID and full target revision.");
  const manifest = JSON.parse(privateFile(`${resolve(dump)}.json`));
  if (!["rehearsal", "recovery"].includes(manifest.mode))
    throw new Error("This command accepts rehearsal or recovery backups only.");
  const root = resolve(destination);
  mkdirSync(root, { mode: 0o700 }); // Never reuse a previous rehearsal directory.
  const name = `ilo-restore-rehearsal-${randomUUID()}`;
  const volume = `${name}-data`;
  const docker = (args, options) => run("docker", args, options);
  const postgres = (args, options) => docker(["exec", "-i", name, ...args], options);
  const runtime = {
    root: realpathSync(root),
    config: {
      revision,
      images: { postgres: image },
      postgresMajor: Number(manifest.serverVersion.split(".")[0]),
    },
    postgres,
    compose: async (args) => {
      if (args[0] === "ps") return "postgres";
      if (args[0] !== "up" || args.at(-1) !== "postgres")
        throw new Error("Rehearsal cannot start application services.");
      for (let attempt = 0; attempt < 30; attempt++) {
        try {
          await postgres(["pg_isready", "-U", "personal_os", "-d", "personal_os"]);
          return "";
        } catch {
          await new Promise((ok) => setTimeout(ok, 1000));
        }
      }
      throw new Error("Rehearsal PostgreSQL did not become ready.");
    },
  };
  const startedAt = Date.now();
  try {
    await docker(["volume", "create", volume]);
    await docker([
      "run",
      "-d",
      "--name",
      name,
      "--network",
      "none",
      "--memory",
      "1g",
      "--cpus",
      "1",
      "--user",
      "postgres",
      "--cap-drop",
      "ALL",
      "--security-opt",
      "no-new-privileges",
      "-e",
      "POSTGRES_USER=personal_os",
      "-e",
      "POSTGRES_DB=personal_os",
      "-e",
      `POSTGRES_PASSWORD=${randomUUID()}`,
      "-v",
      `${volume}:/var/lib/postgresql/data`,
      image,
    ]);
    await restore(runtime, dump);
    // Validate pending SQL against the restored data, inside a rolled-back
    // transaction. This is not API startup and does not advance its Drizzle ledger.
    const repository = resolve(new URL("../..", import.meta.url).pathname);
    await run("git", [
      "-C",
      repository,
      "diff",
      "--quiet",
      revision,
      "--",
      "packages/database/migrations",
    ]);
    const latest = await postgres([
      "psql",
      "-U",
      "personal_os",
      "-d",
      "personal_os",
      "-Atc",
      "SELECT coalesce(max(created_at),0) FROM drizzle.__drizzle_migrations;",
    ]);
    if (!/^\d+$/.test(latest)) throw new Error("Invalid restored migration ledger.");
    const migrations = join(repository, "packages/database/migrations");
    const journal = JSON.parse(readFileSync(join(migrations, "meta/_journal.json"), "utf8"));
    const ledger = JSON.parse(
      await postgres([
        "psql",
        "-U",
        "personal_os",
        "-d",
        "personal_os",
        "-Atc",
        "SELECT coalesce(json_agg(t),'[]') FROM (SELECT hash,created_at FROM drizzle.__drizzle_migrations) t;",
      ]),
    );
    const taskListsExist = await postgres([
      "psql",
      "-U",
      "personal_os",
      "-d",
      "personal_os",
      "-Atc",
      "SELECT to_regclass('public.task_lists') IS NOT NULL;",
    ]);
    const repair = taskRepairPlan(journal, ledger, taskListsExist === "t", (tag) =>
      readFileSync(join(migrations, `${tag}.sql`), "utf8"),
    );
    writePrivate(
      join(root, "migration-gap.json"),
      JSON.stringify(
        {
          repair: repair?.tag ?? null,
          missing: journal.entries
            .filter(
              (entry) =>
                !ledger.some(
                  (row) =>
                    row.hash ===
                    createHash("sha256")
                      .update(readFileSync(join(migrations, `${entry.tag}.sql`)))
                      .digest("hex"),
                ),
            )
            .map((entry) => entry.tag),
        },
        null,
        2,
      ),
    );
    const pending = journal.entries.filter((entry) => entry.when > Number(latest));
    const pendingSql = join(root, "pending-migrations.sql");
    writePrivate(
      pendingSql,
      `BEGIN;\n${taskRepairStatement(repair)}\n${pending
        .map((entry) => {
          if (!/^[0-9a-z_]+$/.test(entry.tag)) throw new Error("Invalid migration tag.");
          return readFileSync(join(migrations, `${entry.tag}.sql`), "utf8");
        })
        .join("\n")}\nROLLBACK;`,
    );
    await postgres(["psql", "-v", "ON_ERROR_STOP=1", "-U", "personal_os", "-d", "personal_os"], {
      input: pendingSql,
      errorLog: join(root, "pending-migration-errors.log"),
    });
    let encryptedRecordsVerified = null;
    if (sourcePath) {
      const encrypted = await postgres([
        "psql",
        "-U",
        "personal_os",
        "-d",
        "personal_os",
        "-Atc",
        "SELECT encrypted_credentials FROM calendar_accounts WHERE encrypted_credentials IS NOT NULL UNION ALL SELECT encrypted_credentials FROM x_bookmark_accounts WHERE encrypted_credentials IS NOT NULL UNION ALL SELECT encrypted_credentials FROM finance_provider_items WHERE encrypted_credentials IS NOT NULL UNION ALL SELECT encrypted_credentials FROM finance_accounts WHERE encrypted_credentials IS NOT NULL;",
      ]);
      const payload = join(root, "encrypted-records.jsonl");
      writePrivate(payload, encrypted);
      const result = await run("pnpm", [
        "exec",
        "tsx",
        "deploy/mac-mini/verify-encryption.ts",
        sourcePath,
        payload,
      ]);
      if (!/^\d+$/.test(result)) throw new Error("Invalid credential verification result.");
      encryptedRecordsVerified = Number(result);
    }
    let backupRoundtrip = false;
    if (backupKeyPath) {
      privateFile(backupKeyPath);
      runtime.config.backupRecipient = await run("age-keygen", ["-y", backupKeyPath]);
      const sealed = await backup(runtime);
      await unseal(sealed, backupKeyPath, join(root, "backup-roundtrip.dump"));
      backupRoundtrip = true;
    }
    const receipt = JSON.parse(readFileSync(join(root, "restore.json"), "utf8"));
    writePrivate(
      join(root, "rehearsal.json"),
      JSON.stringify(
        {
          ...receipt,
          elapsedSeconds: (Date.now() - startedAt) / 1000,
          applicationStarted: false,
          encryptedRecordsVerified,
          pendingMigrationSqlValidated: pending.map((entry) => entry.tag),
          reconciliationValidated: repair?.tag ?? null,
          backupRoundtrip,
        },
        null,
        2,
      ),
    );
    return "Rehearsal restore succeeded. Private counts and timing recorded; no application started.";
  } finally {
    await docker(["rm", "-f", name]).catch(() => {});
    await docker(["volume", "rm", volume]);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.umask(0o077);
  try {
    console.log(await rehearse(...process.argv.slice(2)));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
