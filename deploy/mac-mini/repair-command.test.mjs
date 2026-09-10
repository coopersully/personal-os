import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { repairTasks } from "./commands.mjs";
import { privateFile, validateRestoreReceipt, writePrivate } from "./safety.mjs";

test("repair failure blocks activation and successful retry retains the release/data receipt", async () => {
  const root = mkdtempSync(join(tmpdir(), "ilo-repair-command-test-"));
  const config = { revision: "a".repeat(40), images: { postgres: `sha256:${"b".repeat(64)}` } };
  const receipt = {
    status: "restored",
    mode: "final-frozen",
    revision: config.revision,
    postgresImage: config.images.postgres,
    dumpSha256: "c".repeat(64),
  };
  const receiptPath = join(root, "restore.json");
  let fail = true;
  const runtime = {
    root,
    config,
    compose: async () => "postgres",
    postgres: async (args, options) => {
      if (options?.input) {
        assert.ok(privateFile(options.input).includes("BEGIN;"));
        if (fail) throw new Error("synthetic SQL failure");
        return "";
      }
      const sql = args.at(-1);
      if (sql.includes("pg_stat_activity")) return "0";
      if (sql.includes("json_agg"))
        return JSON.stringify([{ hash: "d".repeat(64), created_at: 2000000000000 }]);
      if (sql.includes("to_regclass")) return "f";
      throw new Error("Unexpected query");
    },
  };
  try {
    writePrivate(receiptPath, JSON.stringify(receipt));
    await assert.rejects(repairTasks(runtime, "wrong acknowledgement"));
    await assert.rejects(repairTasks(runtime, "--reconcile-skipped-task-migration"), /synthetic/);
    assert.throws(() => validateRestoreReceipt(JSON.parse(privateFile(receiptPath)), config));
    fail = false;
    await repairTasks(runtime, "--reconcile-skipped-task-migration");
    const completed = JSON.parse(privateFile(receiptPath));
    validateRestoreReceipt(completed, config);
    assert.equal(completed.taskReconciliation, "0073_task_organization_reconciliation");
    assert.equal(completed.dumpSha256, receipt.dumpSha256);
    assert.equal(existsSync(join(root, "activation.json")), false);
    writePrivate(join(root, "activation.json"), "{}");
    await assert.rejects(
      repairTasks(runtime, "--reconcile-skipped-task-migration"),
      /never-activated/,
    );
  } finally {
    rmSync(root, { recursive: true });
  }
});
