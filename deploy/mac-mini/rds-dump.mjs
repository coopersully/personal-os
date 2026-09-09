#!/usr/bin/env node
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileDigest, run } from "./commands.mjs";
import { privateFile, writePrivate } from "./safety.mjs";

// Run while a separate, attended SSM remote-host forwarding session is open.
// Native libpq hostaddr preserves verification against the real RDS hostname.
process.umask(0o077);
try {
  const [sourcePath, port, caPath, destination, mode] = process.argv.slice(2);
  if (
    !/^\d+$/.test(port) ||
    Number(port) < 1024 ||
    Number(port) > 65535 ||
    !["rehearsal", "final-frozen"].includes(mode)
  )
    throw new Error(
      "Usage: rds-dump.mjs SOURCE.json LOCAL_PORT RDS_CA.pem OUTPUT.dump rehearsal|final-frozen",
    );
  if (existsSync(destination) || existsSync(`${destination}.json`))
    throw new Error("Choose a new dump filename.");
  const source = JSON.parse(privateFile(sourcePath));
  const url = new URL(source.DATABASE_URL);
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    !url.hostname.endsWith(".rds.amazonaws.com")
  )
    throw new Error("Expected the exported RDS database URL.");
  const env = {
    ...process.env,
    PGHOST: url.hostname,
    PGHOSTADDR: "127.0.0.1",
    PGPORT: port,
    PGDATABASE: decodeURIComponent(url.pathname.slice(1)),
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGSSLMODE: "verify-full",
    PGSSLROOTCERT: resolve(caPath),
    PGCONNECT_TIMEOUT: "10",
    PGOPTIONS: "-c default_transaction_read_only=on",
  };
  delete env.PGSERVICE;
  const query = (sql) => run("psql", ["-X", "-v", "ON_ERROR_STOP=1", "-Atc", sql], { env });
  const version = await query("SHOW server_version;");
  const tools = await run("pg_dump", ["--version"]);
  if (Number(tools.match(/\) (\d+)/)?.[1]) !== Number(version.split(".")[0]))
    throw new Error("Use pg_dump matching the source/target major for this same-version transfer.");
  if (mode === "final-frozen") {
    const connections = await query(
      "SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND backend_type='client backend';",
    );
    if (connections !== "0")
      throw new Error("Final dump requires all other database clients stopped.");
  }
  const locale = await query(
    "SELECT json_build_object('encoding',pg_encoding_to_char(encoding),'collate',datcollate,'ctype',datctype) FROM pg_database WHERE datname=current_database();",
  );
  await run("pg_dump", ["--format=custom", "--no-owner", "--no-acl"], {
    env,
    output: resolve(destination),
    timeout: 3_600_000,
  });
  await run("pg_restore", ["--list", resolve(destination)]);
  writePrivate(
    `${resolve(destination)}.json`,
    JSON.stringify(
      {
        version: 1,
        mode,
        serverVersion: version,
        locale: JSON.parse(locale),
        dumpSha256: await fileDigest(destination),
        createdAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
  process.stdout.write(
    "Private RDS dump and manifest created. A rehearsal dump must never activate production.\n",
  );
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}
