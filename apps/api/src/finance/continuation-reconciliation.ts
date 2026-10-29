import type { Database } from "@personal-os/database";
import { sql } from "drizzle-orm";

type Executor = Database | Parameters<Parameters<Database["transaction"]>[0]>[0];
/** Terminal run evidence and stale claims are projected without another host fire. */
export async function reconcileFinanceContinuations(db: Executor, now: Date, userId?: string) {
  await db.execute(sql`
    WITH terminal AS (
      SELECT c.id,r.status FROM finance_answer_continuations c
      JOIN workspace_maintenance_runs r ON r.id=c.maintenance_run_id AND r.user_id=c.user_id
      WHERE c.state='accepted' AND r.status IN ('completed','completed_with_questions','failed_terminal')
      AND ${userId ? sql`c.user_id=${userId}::uuid` : sql`true`}
      ORDER BY c.id LIMIT 100 FOR UPDATE OF c SKIP LOCKED
    ) UPDATE finance_answer_continuations c SET state=CASE WHEN terminal.status='failed_terminal' THEN 'unavailable' ELSE 'completed' END,updated_at=${now}
      FROM terminal WHERE c.id=terminal.id
  `);
  await db.execute(sql`
    WITH stale AS (
      SELECT id FROM finance_answer_continuations WHERE state='pending' AND fire_state='submitting'
      AND updated_at < ${new Date(now.getTime() - 120000)}
      AND ${userId ? sql`user_id=${userId}::uuid` : sql`true`}
      ORDER BY id LIMIT 100 FOR UPDATE SKIP LOCKED
    ) UPDATE finance_answer_continuations c SET fire_state='uncertain',updated_at=${now}
      FROM stale WHERE c.id=stale.id
  `);
}
