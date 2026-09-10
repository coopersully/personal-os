import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { taskRepairPlan, taskRepairStatement } from "./task-repair.mjs";

test("repair targets only the known skipped reconciliation and rejects contradictory history", () => {
  const journal = { entries: [{ tag: "0073_task_organization_reconciliation", when: 100 }] };
  const sql = "SELECT 'synthetic migration';";
  const read = () => sql;
  assert.equal(taskRepairPlan(journal, [], false, read), null);
  assert.equal(taskRepairPlan(journal, [{ created_at: 200 }], true, read), null);
  const plan = taskRepairPlan(journal, [{ created_at: 200 }], false, read);
  assert.equal(plan.sql, sql);
  assert.ok(taskRepairStatement(plan).includes("INSERT INTO drizzle.__drizzle_migrations"));
  assert.throws(
    () =>
      taskRepairPlan(
        journal,
        [{ created_at: 100, hash: createHash("sha256").update(sql).digest("hex") }],
        false,
        read,
      ),
    /schema drift/,
  );
  assert.throws(() => taskRepairPlan(journal, [{ created_at: "invalid" }], false, read));
  assert.equal(taskRepairStatement(null), "");
});
