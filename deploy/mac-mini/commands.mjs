import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
  chmodSync,
  createReadStream,
  createWriteStream,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { composeModel, environmentFiles, validateConfig } from "./compose.mjs";
import {
  assertEmptyDatabase,
  emptyDatabaseSql,
  privateFile,
  validateRestoreReceipt,
  withLock,
  writePrivate,
} from "./safety.mjs";
import { taskRepairPlan, taskRepairStatement } from "./task-repair.mjs";

// Never print captured command output on errors: provider configuration and dump
// diagnostics can contain credentials or personal records.
export async function run(
  command,
  args,
  { env = process.env, input, output, errorLog, timeout = 120_000 } = {},
) {
  const child = spawn(command, args, { env, stdio: [input ? "pipe" : "ignore", "pipe", "pipe"] });
  let captured = "";
  let diagnostics = "";
  if (errorLog)
    child.stderr.on("data", (chunk) => {
      if (diagnostics.length < 1024 * 1024) diagnostics += chunk.toString();
    });
  else child.stderr.resume();
  const completion = new Promise((ok, fail) => {
    child.once("error", () => fail(new Error(`${command} could not start.`)));
    child.once("close", (code) =>
      code === 0
        ? ok()
        : fail(new Error(`${command} failed (${code ?? "signal"}); inspect private service logs.`)),
    );
  });
  const timer = setTimeout(() => child.kill("SIGKILL"), timeout);
  try {
    const streams = [];
    if (input)
      streams.push(
        pipeline(createReadStream(input), child.stdin).catch((error) => {
          // pg_restore --list intentionally consumes just the archive header. Only a
          // successful child exit can authorize ignoring its closed input pipe.
          if (error.code !== "EPIPE") throw error;
          return completion;
        }),
      );
    if (output)
      streams.push(pipeline(child.stdout, createWriteStream(output, { flags: "wx", mode: 0o600 })));
    else
      child.stdout.on("data", (chunk) => {
        captured += chunk.toString();
        if (captured.length > 16 * 1024 * 1024) child.kill("SIGKILL");
      });
    await Promise.all([completion, ...streams]);
    return captured.trim();
  } catch (error) {
    child.kill("SIGKILL");
    await completion.catch(() => {});
    if (errorLog) writePrivate(errorLog, diagnostics);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export async function fileDigest(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

export function loadRuntime(configPath) {
  const config = validateConfig(JSON.parse(privateFile(configPath)));
  const root = config.root;
  const stat = lstatSync(root);
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    realpathSync(root) !== root ||
    stat.uid !== process.getuid() ||
    (stat.mode & 0o077) !== 0
  )
    throw new Error("Runtime directory must be owned, private (0700), and not a symbolic link.");
  const repository = realpathSync(new URL("../..", import.meta.url).pathname);
  if (root === repository || root.startsWith(`${repository}/`))
    throw new Error("Production state must live outside the checkout.");
  const env = { ...process.env, DOCKER_HOST: config.dockerHost };
  delete env.DOCKER_CONTEXT;
  delete env.COMPOSE_FILE;
  delete env.COMPOSE_PROFILES;
  delete env.COMPOSE_PROJECT_NAME;
  const composePath = join(root, "compose.json");
  const docker = (args, options = {}) =>
    run("docker", ["--host", config.dockerHost, ...args], { env, ...options });
  const compose = (args, options = {}) =>
    docker(
      [
        "compose",
        "--project-name",
        "nohmi-production",
        "--project-directory",
        root,
        "--env-file",
        "/dev/null",
        "-f",
        composePath,
        ...args,
      ],
      options,
    );
  const postgres = (args, options = {}) => compose(["exec", "-T", "postgres", ...args], options);
  return { config, root, docker, compose, postgres };
}

export async function prepare(runtime, sourcePath) {
  const { config, root } = runtime;
  for (const name of ["api.env", "mcp.env", "postgres.env", "compose.json"])
    if (existsSync(join(root, name)))
      throw new Error(
        "Runtime already prepared; refusing to replace credentials or deployment configuration.",
      );
  const source = JSON.parse(privateFile(sourcePath));
  const files = environmentFiles(source, randomBytes(32).toString("hex"));
  for (const [name, value] of Object.entries(files)) writePrivate(join(root, `${name}.env`), value);
  writePrivate(join(root, "compose.json"), JSON.stringify(composeModel(config), null, 2));
  writePrivate(
    join(root, "gateway.conf"),
    readFileSync(new URL("./gateway.conf", import.meta.url), "utf8"),
  );
  chmodSync(join(root, "gateway.conf"), 0o444);
}

export async function assertPrepared(runtime) {
  const { config, root } = runtime;
  if (
    JSON.stringify(JSON.parse(privateFile(join(root, "compose.json")))) !==
    JSON.stringify(composeModel(config))
  )
    throw new Error("Prepared Compose configuration differs from the release configuration.");
  for (const name of ["api.env", "mcp.env", "postgres.env"]) privateFile(join(root, name));
  if (
    readFileSync(join(root, "gateway.conf"), "utf8") !==
    readFileSync(new URL("./gateway.conf", import.meta.url), "utf8")
  )
    throw new Error("Gateway configuration differs from the checked-in release.");
  // Reject a mismatched PostgreSQL image before initializing any database storage.
  for (const name of ["api", "mcp", "web"]) {
    const revision = await runtime.docker([
      "image",
      "inspect",
      config.images[name],
      "--format",
      '{{ index .Config.Labels "org.opencontainers.image.revision" }}',
    ]);
    if (revision !== config.revision)
      throw new Error(`${name} image revision does not match this release.`);
  }
  const version = await runtime.docker([
    "run",
    "--rm",
    "--network",
    "none",
    "--entrypoint",
    "postgres",
    config.images.postgres,
    "--version",
  ]);
  if (!new RegExp(`PostgreSQL\\) ${config.postgresMajor}\\.`).test(version))
    throw new Error("PostgreSQL image does not match the declared major.");
}

export async function assertWritersStopped(runtime) {
  const names = await runtime.compose(["ps", "--status", "running", "--services"]);
  if (names.split("\n").some((name) => ["api", "mcp", "gateway", "tunnel"].includes(name)))
    throw new Error("Stop the application and ingress before restore or activation.");
  const connections = await runtime.postgres([
    "psql",
    "-U",
    "personal_os",
    "-d",
    "personal_os",
    "-Atc",
    "SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid();",
  ]);
  if (connections !== "0")
    throw new Error("Other database connections remain; stop all writers first.");
}

export async function restore(runtime, dumpPath) {
  const dump = resolve(dumpPath);
  const stat = lstatSync(dump);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size === 0 || (stat.mode & 0o077) !== 0)
    throw new Error("Restore input must be a nonempty private regular dump file.");
  if (existsSync(join(runtime.root, "activation.json")))
    throw new Error(
      "An activated production database cannot be restored in place. Use a new recovery runtime.",
    );
  const manifest = JSON.parse(privateFile(`${dump}.json`));
  const dumpSha256 = await fileDigest(dump);
  if (
    manifest.version !== 1 ||
    !["rehearsal", "final-frozen", "recovery"].includes(manifest.mode) ||
    manifest.dumpSha256 !== dumpSha256 ||
    Number(manifest.serverVersion?.split(".")[0]) !== runtime.config.postgresMajor
  )
    throw new Error("Dump manifest must match the file, source major, and transfer mode.");
  await runtime.compose(["up", "-d", "--wait", "postgres"]);
  await assertWritersStopped(runtime);
  const psql = (args) =>
    runtime.postgres([
      "psql",
      "-v",
      "ON_ERROR_STOP=1",
      "-U",
      "personal_os",
      "-d",
      "personal_os",
      ...args,
    ]);
  assertEmptyDatabase(await psql(["-Atc", emptyDatabaseSql]));
  const targetVersion = await psql(["-Atc", "SHOW server_version;"]);
  if (Number(targetVersion.split(".")[0]) !== runtime.config.postgresMajor)
    throw new Error("Target database major differs from the source.");
  const targetLocale = JSON.parse(
    await psql([
      "-Atc",
      "SELECT json_build_object('encoding',pg_encoding_to_char(encoding),'collate',datcollate,'ctype',datctype) FROM pg_database WHERE datname=current_database();",
    ]),
  );
  const canonicalLocale = (value) =>
    String(value)
      .toLowerCase()
      .replaceAll(/[^a-z0-9]/g, "");
  if (
    ["encoding", "collate", "ctype"].some(
      (key) =>
        !manifest.locale?.[key] ||
        canonicalLocale(manifest.locale[key]) !== canonicalLocale(targetLocale[key]),
    )
  )
    throw new Error(
      "Target encoding/collation differs from the source; initialize a compatible empty database.",
    );
  const receipt = {
    status: "restoring",
    mode: manifest.mode,
    revision: runtime.config.revision,
    postgresImage: runtime.config.images.postgres,
    dumpSha256,
    startedAt: new Date().toISOString(),
  };
  const receiptPath = join(runtime.root, "restore.json");
  writePrivate(receiptPath, JSON.stringify(receipt, null, 2));
  await runtime.postgres(["pg_restore", "--list"], { input: dump });
  // One transaction prevents a failing archive from leaving a half-restored database.
  await runtime.postgres(
    [
      "pg_restore",
      "--exit-on-error",
      "--single-transaction",
      "--no-owner",
      "--no-acl",
      "-U",
      "personal_os",
      "-d",
      "personal_os",
    ],
    { input: dump, timeout: 3_600_000 },
  );
  await psql(["-c", "ANALYZE;"]);
  const tables = await psql(["-Atc", "SELECT count(*) FROM pg_tables WHERE schemaname='public';"]);
  if (!/^\d+$/.test(tables) || Number(tables) < 1)
    throw new Error("Restored database contains no application tables.");
  await psql(["-Atc", "SELECT count(*) FROM drizzle.__drizzle_migrations;"]);
  // Record table counts privately for comparison with the frozen source.
  const counts = await psql([
    "-Atc",
    "SELECT format('SELECT %L, count(*) FROM %I.%I;', schemaname||'.'||tablename,schemaname,tablename) FROM pg_tables WHERE schemaname NOT IN ('pg_catalog','information_schema') ORDER BY schemaname,tablename;",
  ]);
  const countPath = join(runtime.root, "restored-counts.sql");
  writePrivate(countPath, counts);
  const result = await runtime.postgres(
    ["psql", "-v", "ON_ERROR_STOP=1", "-U", "personal_os", "-d", "personal_os", "-At"],
    { input: countPath },
  );
  writePrivate(join(runtime.root, "restored-counts.txt"), result);
  if ((await fileDigest(dump)) !== dumpSha256)
    throw new Error("Restore input changed during transfer.");
  writePrivate(
    receiptPath,
    JSON.stringify(
      {
        ...receipt,
        status: "restored",
        completedAt: new Date().toISOString(),
        tables: Number(tables),
      },
      null,
      2,
    ),
  );
}

export async function repairTasks(runtime, acknowledgement) {
  if (acknowledgement !== "--reconcile-skipped-task-migration")
    throw new Error(
      "Task repair requires --reconcile-skipped-task-migration after a successful rehearsal.",
    );
  if (existsSync(join(runtime.root, "activation.json")))
    throw new Error("Task repair is limited to a restored, never-activated target.");
  const receiptPath = join(runtime.root, "restore.json");
  const receipt = JSON.parse(privateFile(receiptPath));
  // An interrupted transaction can be retried, but never authorize activation
  // until the repair check has completed successfully.
  validateRestoreReceipt(
    { ...receipt, status: receipt.status === "repairing" ? "restored" : receipt.status },
    runtime.config,
    receipt.mode === "recovery" ? "recovery" : "final-frozen",
  );
  await assertWritersStopped(runtime);
  const query = (sql) =>
    runtime.postgres([
      "psql",
      "-v",
      "ON_ERROR_STOP=1",
      "-U",
      "personal_os",
      "-d",
      "personal_os",
      "-Atc",
      sql,
    ]);
  const migrations = resolve(
    new URL("../../packages/database/migrations", import.meta.url).pathname,
  );
  const journal = JSON.parse(readFileSync(join(migrations, "meta/_journal.json"), "utf8"));
  const ledger = JSON.parse(
    await query(
      "SELECT coalesce(json_agg(t),'[]') FROM (SELECT hash,created_at FROM drizzle.__drizzle_migrations) t;",
    ),
  );
  const plan = taskRepairPlan(
    journal,
    ledger,
    (await query("SELECT to_regclass('public.task_lists') IS NOT NULL;")) === "t",
    (tag) => readFileSync(join(migrations, `${tag}.sql`), "utf8"),
  );
  if (plan) {
    writePrivate(receiptPath, JSON.stringify({ ...receipt, status: "repairing" }, null, 2));
    const sqlPath = join(runtime.root, "task-repair.sql");
    writePrivate(sqlPath, `BEGIN;\n${taskRepairStatement(plan)}\nCOMMIT;`);
    await runtime.postgres(
      ["psql", "-v", "ON_ERROR_STOP=1", "-U", "personal_os", "-d", "personal_os"],
      { input: sqlPath, errorLog: join(runtime.root, "task-repair-errors.log") },
    );
  }
  writePrivate(
    receiptPath,
    JSON.stringify(
      {
        ...receipt,
        status: "restored",
        taskReconciliationCheckedAt: new Date().toISOString(),
        taskReconciliation: plan?.tag ?? receipt.taskReconciliation ?? null,
      },
      null,
      2,
    ),
  );
}

export async function activate(runtime, acknowledgement) {
  if (!["--aws-writers-stopped", "--previous-writers-stopped"].includes(acknowledgement))
    throw new Error(
      "Activation requires --aws-writers-stopped after the attended freeze checklist.",
    );
  validateRestoreReceipt(
    JSON.parse(privateFile(join(runtime.root, "restore.json"))),
    runtime.config,
    acknowledgement === "--previous-writers-stopped" ? "recovery" : "final-frozen",
  );
  await assertWritersStopped(runtime);
  // Persist before starting API: startup itself can migrate, sync or send externally.
  writePrivate(
    join(runtime.root, "activation.json"),
    JSON.stringify(
      { revision: runtime.config.revision, localWritesPossibleSince: new Date().toISOString() },
      null,
      2,
    ),
  );
  await runtime.compose(["up", "-d", "--wait", "api", "mcp", "web", "gateway"], {
    timeout: 300_000,
  });
}

export async function start(runtime) {
  const receipt = JSON.parse(privateFile(join(runtime.root, "activation.json")));
  if (receipt.revision !== runtime.config.revision)
    throw new Error("Activation release differs; use an attended deployment procedure.");
  await runtime.compose(["up", "-d", "--wait", "api", "mcp", "web", "gateway"], {
    timeout: 300_000,
  });
}

export async function backup(runtime) {
  const activated = existsSync(join(runtime.root, "activation.json"));
  const active = JSON.parse(
    privateFile(join(runtime.root, activated ? "activation.json" : "restore.json")),
  );
  if (active.revision !== runtime.config.revision || (!activated && active.status !== "restored"))
    throw new Error("Backup requires an activated release or successfully restored database.");
  const dir = join(runtime.root, "backups");
  const query = (sql) =>
    runtime.postgres(["psql", "-U", "personal_os", "-d", "personal_os", "-Atc", sql]);
  const serverVersion = await query("SHOW server_version;");
  const locale = JSON.parse(
    await query(
      "SELECT json_build_object('encoding',pg_encoding_to_char(encoding),'collate',datcollate,'ctype',datctype) FROM pg_database WHERE datname=current_database();",
    ),
  );
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const stem = join(
    dir,
    `${new Date().toISOString().replaceAll(":", "-")}-${randomBytes(4).toString("hex")}`,
  );
  const dump = `${stem}.dump`,
    sealed = `${dump}.age`;
  try {
    await runtime.postgres(
      [
        "pg_dump",
        "--format=custom",
        "--no-owner",
        "--no-acl",
        "-U",
        "personal_os",
        "-d",
        "personal_os",
      ],
      { output: dump, timeout: 3_600_000 },
    );
    await runtime.postgres(["pg_restore", "--list"], { input: dump });
    await run("age", ["--encrypt", "--recipient", runtime.config.backupRecipient, dump], {
      output: sealed,
      timeout: 3_600_000,
    });
    const manifest = {
      version: 1,
      mode: "recovery",
      serverVersion,
      locale,
      createdAt: new Date().toISOString(),
      revision: runtime.config.revision,
      images: runtime.config.images,
      postgresMajor: runtime.config.postgresMajor,
      dumpSha256: await fileDigest(dump),
      encryptedSha256: await fileDigest(sealed),
      restoreTested: false,
    };
    writePrivate(`${sealed}.json`, JSON.stringify(manifest, null, 2));
    return sealed;
  } finally {
    if (existsSync(dump)) rmSync(dump);
  }
}

export async function stop(runtime) {
  // Docker labels survive release-file drift; Compose stop would still parse
  // missing env files. Resolve only this fixed project and owned runtime root.
  for (const service of ["tunnel", "gateway", "mcp", "api", "web"]) {
    const found = await runtime.docker([
      "ps",
      "-aq",
      "--filter",
      "label=com.docker.compose.project=nohmi-production",
      "--filter",
      `label=com.docker.compose.project.working_dir=${runtime.root}`,
      "--filter",
      `label=com.docker.compose.service=${service}`,
    ]);
    const ids = found.split("\n").filter(Boolean);
    if (ids.some((id) => !/^[a-f0-9]{12,64}$/.test(id)))
      throw new Error("Invalid container identity.");
    if (ids.length) await runtime.docker(["stop", "--time", "120", ...ids], { timeout: 180000 });
  }
  return "Application and ingress stopped; database volume retained.";
}

export async function execute(action, configPath, args = []) {
  const runtime = loadRuntime(configPath);
  if (action === "status") return runtime.compose(["ps", "--format", "json"]);
  return withLock(runtime.root, async () => {
    if (action === "stop") return stop(runtime);
    if (action === "prepare") {
      await prepare(runtime, args[0]);
      return "Runtime prepared; no services started.";
    }
    await assertPrepared(runtime);
    switch (action) {
      case "check":
        await runtime.compose(["config", "--quiet"]);
        return "Production configuration validated.";
      case "database":
        await runtime.compose(["up", "-d", "--wait", "postgres"]);
        return "Database started; application remains stopped.";
      case "restore":
        await restore(runtime, args[0]);
        return "Restore completed. Compare restored-counts.txt with the frozen source before activation.";
      case "activate":
        await activate(runtime, args[0]);
        return "Application activated. Local writes are now possible; AWS return must preserve them.";
      case "repair-tasks":
        await repairTasks(runtime, args[0]);
        return "Skipped task reconciliation checked/applied on the restored Mac database; application remains stopped.";
      case "start":
        await start(runtime);
        return "Activated application started.";
      case "publish":
        privateFile(join(runtime.root, "tunnel-token"));
        await start(runtime);
        await runtime.compose(["up", "-d", "tunnel"]);
        return "Tunnel started. Verify all public routes separately.";
      case "backup":
        return backup(runtime);
      default:
        throw new Error(
          "Unknown command. Use prepare, check, database, restore, repair-tasks, activate, start, publish, stop, backup, or status.",
        );
    }
  });
}
