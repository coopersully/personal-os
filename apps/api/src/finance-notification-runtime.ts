import { type Database, financeReviewCases } from "@personal-os/database";
import type { FinanceHumanWorkRef } from "@personal-os/domain";
import { and, asc, eq, sql } from "drizzle-orm";
import { contextualTransaction } from "./finance/contextual-question-store.js";
import { issueMaintenanceReviewQuestion } from "./finance/review-action-service.js";
import { resolveFinanceWorks } from "./finance/work-resolver.js";
import {
  FinanceClaimReconciliationError,
  FinanceReconciliationError,
  type FinanceStageFailure,
} from "./finance-reconciliation-errors.js";
import type { createNotificationService } from "./notification-service.js";
import type { Principal } from "./types.js";

type Key = { userId: string; id: string };

/** Preserve stage order while one failed channel cannot starve the remaining durable work. */
export async function runFinanceReconciliationStages(
  stages: Array<{ name: FinanceStageFailure["stage"]; run: () => Promise<unknown> }>,
) {
  const failures: FinanceStageFailure[] = [];
  for (const stage of stages) {
    try {
      const result = await stage.run();
      if (result && typeof result === "object" && "failed" in result) {
        const count = result.failed;
        if (typeof count === "number" && Number.isSafeInteger(count) && count > 0)
          failures.push({ stage: stage.name, code: "operations_failed", count });
      }
    } catch (error) {
      const count =
        error instanceof FinanceClaimReconciliationError &&
        Number.isSafeInteger(error.failed) &&
        error.failed > 0
          ? error.failed
          : 1;
      failures.push({ stage: stage.name, code: "stage_failed", count });
    }
  }
  if (failures.length) throw new FinanceReconciliationError(failures);
}
/** Repeated stable source discovery repairs every publication crash window. Intent history owns
 * dedupe/reminders; rediscovery never creates a new action. No provider retry on uncertainty. */
export function createFinanceNotificationDispatcher(options: {
  db: Database;
  notifications: Pick<ReturnType<typeof createNotificationService>, "publish" | "drain">;
  enabled: () => boolean;
}) {
  let cursor: Key | null = null;
  let issuanceCursor: Key | null = null;
  async function scan(after: Key | null) {
    const rows = await options.db.execute<{
      userId: string;
      id: string;
      revision: string;
      actionRevision: string;
      kind: "question" | "approval";
    }>(sql`
     WITH work AS (
       SELECT user_id,id,contextual_revision::text AS revision,action_revision::text AS action_revision,'question'::text AS kind,0 AS source FROM finance_review_cases WHERE status='open' AND human_action->>'state'='open'
       UNION ALL
       SELECT user_id,id,work_revision::text AS revision,action_revision::text AS action_revision,'question'::text AS kind,1 AS source FROM finance_contextual_questions WHERE state='open'
       UNION ALL
       SELECT user_id,work_id AS id,work->>'revision' AS revision,work->>'actionRevision' AS action_revision,work->>'kind' AS kind,2 AS source FROM notification_intents WHERE state='pending' AND work->>'kind' IN ('question','approval') AND work->>'revision' ~ '^[1-9][0-9]{0,18}$' AND work->>'actionRevision' ~ '^[1-9][0-9]{0,18}$'
       UNION ALL
       SELECT user_id,id,floor(extract(epoch FROM updated_at)*1000)::bigint::text AS revision,floor(extract(epoch FROM updated_at)*1000)::bigint::text AS action_revision,'approval'::text AS kind,0 AS source FROM finance_agent_action_reviews WHERE status='pending'
     ), exact AS (SELECT DISTINCT ON (user_id,id) * FROM work ORDER BY user_id,id,source)
     SELECT user_id::text AS "userId",id::text,revision::text,"action_revision"::text AS "actionRevision",kind FROM exact
     WHERE ${after ? sql`(user_id,id)>(${after.userId}::uuid,${after.id}::uuid)` : sql`true`}
     ORDER BY user_id,id LIMIT 25
   `);
    return rows.rows;
  }
  return async (shouldContinue: () => boolean = () => true) => {
    if (!options.enabled() || !shouldContinue()) return { processed: 0, failed: 0 };
    let failed = 0;
    const undiscovered = await options.db
      .select({ userId: financeReviewCases.userId, id: financeReviewCases.id })
      .from(financeReviewCases)
      .where(
        and(
          eq(financeReviewCases.status, "open"),
          sql`${financeReviewCases.humanAction}->>'state' = 'absent'`,
          sql`${financeReviewCases.evidence}->>'maintenanceRunId' IS NOT NULL`,
          issuanceCursor
            ? sql`(${financeReviewCases.userId},${financeReviewCases.id})>(${issuanceCursor.userId}::uuid,${issuanceCursor.id}::uuid)`
            : sql`true`,
        ),
      )
      .orderBy(asc(financeReviewCases.userId), asc(financeReviewCases.id))
      .limit(25);
    if (!undiscovered.length) issuanceCursor = null;
    for (const row of undiscovered) {
      if (!options.enabled() || !shouldContinue()) break;
      try {
        await contextualTransaction(options.db, undefined, (tx) =>
          issueMaintenanceReviewQuestion(tx, row.userId, row.id),
        );
      } catch {
        failed++;
      } finally {
        issuanceCursor = row;
      }
    }
    let rows = await scan(cursor);
    if (!rows.length && cursor) {
      cursor = null;
      rows = await scan(null);
    }
    let processed = 0;
    const groups = new Map<string, typeof rows>();
    for (const row of rows) groups.set(row.userId, [...(groups.get(row.userId) ?? []), row]);
    for (const [userId, group] of groups) {
      if (!options.enabled() || !shouldContinue()) break;
      const principal: Principal = {
        actorId: userId,
        actorType: "user",
        userId,
        scopes: new Set(["finances:read", "texting:read", "texting:write"]),
      };
      const refs: FinanceHumanWorkRef[] = group.map((row) => ({
        id: row.id,
        domain: "finances",
        kind: row.kind,
        revision: row.revision,
        actionRevision: row.actionRevision,
      }));
      try {
        const results = await contextualTransaction(options.db, undefined, (tx) =>
          resolveFinanceWorks(userId, refs, tx),
        );
        const current = refs.filter((_ref, i) => results[i]?.state === "current");
        if (current.length) await options.notifications.publish(principal, { work: current });
        if (options.enabled() && shouldContinue()) await options.notifications.drain(principal);
      } catch {
        failed++;
      } finally {
        const last = group.at(-1);
        if (last) cursor = { userId: last.userId, id: last.id };
        processed += group.length;
      }
    }
    return { processed, failed };
  };
}
