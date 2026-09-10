import { randomUUID } from "node:crypto";
import {
  closeSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

export function privateFile(path) {
  const stat = lstatSync(path);
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    (stat.mode & 0o077) !== 0 ||
    stat.uid !== process.getuid()
  )
    throw new Error(`Expected an owned private regular file: ${path}`);
  return readFileSync(path, "utf8");
}

export function writePrivate(path, value) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  const fd = openSync(temporary, "wx", 0o600);
  try {
    writeFileSync(fd, value);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(temporary, path);
}

export async function withLock(root, operation) {
  const lock = join(root, "operation.lock");
  try {
    mkdirSync(lock, { mode: 0o700 });
  } catch {
    throw new Error(
      "Production operation is locked. Inspect operation.lock; never auto-break a stale lock.",
    );
  }
  try {
    writePrivate(
      join(lock, "owner.json"),
      JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }),
    );
    return await operation();
  } finally {
    rmSync(lock, { recursive: true });
  }
}

export function assertEmptyDatabase(value) {
  if (value.trim() !== "0")
    throw new Error(
      "Restore target is not demonstrably empty. Create a separate empty target; never overwrite production.",
    );
}

export function validateRestoreReceipt(receipt, config, expectedMode = "final-frozen") {
  if (
    receipt?.status !== "restored" ||
    receipt.mode !== expectedMode ||
    receipt.revision !== config.revision ||
    receipt.postgresImage !== config.images.postgres ||
    !/^[a-f0-9]{64}$/.test(receipt.dumpSha256)
  )
    throw new Error(
      "A successful restore receipt matching this release and database image is required before activation.",
    );
}

export const emptyDatabaseSql =
  "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%' AND c.relkind IN ('r','p','v','m','S','f');";
