import { createHash } from "node:crypto";

// One known parallel-branch gap, not a generic replay-all-migrations mechanism.
// Published migration contents and journal entries remain unchanged.
export function taskRepairPlan(journal, ledger, taskListsExist, readSql) {
  if (taskListsExist) return null;
  const entry = journal.entries.find((row) => row.tag === "0073_task_organization_reconciliation");
  if (!entry || !Number.isSafeInteger(entry.when))
    throw new Error("Known reconciliation migration is missing.");
  const sql = readSql(entry.tag);
  const hash = createHash("sha256").update(sql).digest("hex");
  if (ledger.some((row) => row.hash === hash))
    throw new Error(
      "Task schema is absent despite a recorded reconciliation; investigate schema drift.",
    );
  const latest = Math.max(0, ...ledger.map((row) => Number(row.created_at)));
  if (!Number.isSafeInteger(latest)) throw new Error("Invalid migration ledger timestamp.");
  if (latest < entry.when) return null; // Normal Drizzle startup will apply it.
  return { tag: entry.tag, hash, when: entry.when, sql };
}

export function taskRepairStatement(plan) {
  return plan
    ? `${plan.sql}\nINSERT INTO drizzle.__drizzle_migrations (hash,created_at) VALUES ('${plan.hash}',${plan.when});\n`
    : "";
}
