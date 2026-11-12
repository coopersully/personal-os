import { createHash } from "node:crypto";
import { type Database, financeBudgetStartPolicies, users } from "@personal-os/database";
import {
  financeAttentionRecordSchema,
  financeAttentionSnapshotSchema,
  projectFinanceAttention,
} from "@personal-os/domain";
import { desc, eq, sql } from "drizzle-orm";
import { AppError } from "../errors.js";
import { readBudgetPlanContext } from "./budget-plan-projection.js";
import type { FinanceTransaction } from "./context.js";
import { createFinanceOpeningPositionService } from "./opening-position-service.js";

/** One database snapshot across flags, cases, questions, approval and budget policy.
 * Historical independence needs opening-position qualification; until then it stays triage.
 */
export async function readFinanceAttentionSnapshot(
  db: Database,
  userId: string,
  at: Date,
  executor?: FinanceTransaction,
  projection?: { firstMonth?: string | null; excludeBudgetStartPreviewId?: string },
) {
  const read = async (tx: FinanceTransaction) => {
    const owner = await tx.query.users.findFirst({ where: eq(users.id, userId) });
    if (!owner) throw new AppError("not_found", "Account not found.");
    const start = await tx.query.financeBudgetStartPolicies.findFirst({
      where: eq(financeBudgetStartPolicies.userId, userId),
      orderBy: desc(financeBudgetStartPolicies.revision),
    });
    const budget = await readBudgetPlanContext(tx, userId, at);
    const opening = await createFinanceOpeningPositionService({
      db,
      now: () => at,
    }).readOpeningPosition(userId, budget.month, tx);
    const result = await tx.execute<{ record: unknown }>(sql`
      WITH work AS (
        SELECT 'flag:' || t.id::text AS id, t.id::text AS transaction_id,
          'transaction_flag'::text AS source, t.transaction_date AS date,
          NULL::text AS decision_key, 'processing'::text AS work_state
        FROM finance_transactions t WHERE t.user_id = ${userId}::uuid AND t.needs_review
        UNION ALL
        SELECT 'case:' || r.id::text, t.id::text, 'review_case', t.transaction_date,
          CASE WHEN r.human_action->>'state' = 'open'
            THEN 'request:' || (r.human_action->'request'->>'requestId') ELSE NULL END,
          CASE WHEN r.human_action->>'state' = 'open' THEN 'needs_person'
            WHEN t.id IS NULL THEN 'technical_blocker' ELSE 'processing' END
        FROM finance_review_cases r LEFT JOIN finance_transactions t
          ON t.id = r.transaction_id AND t.user_id = ${userId}::uuid
        WHERE r.user_id = ${userId}::uuid AND r.status IN ('open', 'deferred')
        UNION ALL
        SELECT 'question:' || q.id::text, t.id::text, 'question', t.transaction_date,
          'question:' || q.id::text, 'needs_person'
        FROM finance_contextual_questions q LEFT JOIN finance_transactions t
          ON t.id = q.transaction_id AND t.user_id = ${userId}::uuid
        WHERE q.user_id = ${userId}::uuid AND q.state = 'open'
        UNION ALL
        SELECT 'action:' || a.id::text, NULL, CASE WHEN a.action_kind = 'question' THEN 'question' ELSE 'approval' END,
          NULL, 'action:' || a.id::text, 'needs_person'
        FROM finance_agent_action_reviews a WHERE a.user_id = ${userId}::uuid AND a.status = 'pending'
        UNION ALL
        SELECT 'start:' || p.id::text, NULL, 'approval', ${`${budget.month}-01`},
          'start:' || p.id::text, 'needs_person'
        FROM finance_budget_start_previews p
        WHERE p.user_id = ${userId}::uuid
          AND (${projection?.excludeBudgetStartPreviewId ?? null}::uuid IS NULL OR p.id <> ${projection?.excludeBudgetStartPreviewId ?? null}::uuid)
          AND p.expected_policy_revision >= COALESCE((SELECT MAX(revision) FROM finance_budget_start_policies WHERE user_id = ${userId}::uuid), 0)
          AND EXISTS (SELECT 1 FROM finance_conversation_messages m WHERE m.user_id = ${userId}::uuid
            AND m.author_kind = 'agent' AND m.record_refs @> jsonb_build_array(jsonb_build_object('kind','budget_start_preview','id',p.id::text)))
        UNION ALL
        SELECT 'batch:' || b.id::text, NULL, 'approval', ${`${budget.month}-01`},
          'batch:' || b.id::text, CASE WHEN a.id IS NULL THEN 'needs_person' WHEN a.state IN ('blocked','expired','completed_with_exceptions') THEN 'technical_blocker' ELSE 'processing' END
        FROM finance_review_batch_runs b LEFT JOIN finance_review_batch_approvals a
          ON a.batch_id = b.id AND a.user_id = b.user_id
        WHERE b.user_id = ${userId}::uuid AND (jsonb_array_length(b.outcomes) < jsonb_array_length(b.manifest) OR a.state IN ('blocked','expired','completed_with_exceptions'))
          AND (a.id IS NULL OR a.state <> 'cancelled')
          AND EXISTS (SELECT 1 FROM finance_conversation_messages m WHERE m.user_id = ${userId}::uuid
            AND m.author_kind = 'agent' AND m.record_refs @> jsonb_build_array(jsonb_build_object('kind','review_batch','id',b.id::text)))
        UNION ALL
        SELECT 'correction:' || c.id::text, NULL, 'approval', ${`${budget.month}-01`},
          'correction:' || c.id::text, 'needs_person'
        FROM finance_review_batch_corrections c
        WHERE c.user_id = ${userId}::uuid AND jsonb_array_length(c.outcomes) < jsonb_array_length(c.outcome_indexes)
          AND EXISTS (SELECT 1 FROM finance_conversation_messages m WHERE m.user_id = ${userId}::uuid
            AND m.author_kind = 'agent' AND m.record_refs @> jsonb_build_array(jsonb_build_object('kind','review_batch_undo','id',c.id::text)))
      ) SELECT jsonb_build_object('id', id, 'transactionId', transaction_id, 'source', source,
          'date', date, 'decisionKey', decision_key, 'workState', work_state,
          'dependency', CASE
            WHEN date IS NULL THEN 'unknown'
            WHEN EXISTS (
              SELECT 1 FROM finance_transaction_relationships rel
              JOIN finance_transactions related ON related.user_id = ${userId}::uuid
                AND rel.transaction_ids ? related.id::text
              WHERE rel.user_id = ${userId}::uuid AND rel.transaction_ids ? work.transaction_id
                AND related.transaction_date >= ${`${budget.month}-01`}
            ) THEN 'affects_current'
            WHEN date < ${`${budget.month}-01`} AND NOT ${opening.qualified} THEN 'unknown'
            ELSE 'none' END
        ) AS record FROM work ORDER BY id COLLATE "C" LIMIT 10001
    `);
    const complete = result.rows.length <= 10000;
    const records = result.rows
      .slice(0, 10000)
      .map((row) => financeAttentionRecordSchema.parse(row.record));
    // Spending-comparison baseline approval is not proof of an opening account position.
    const readiness = {
      openingPositionQualified: opening.qualified,
      budgetApproved: budget.state === "approved",
    };
    const projected = projectFinanceAttention({
      firstMonth:
        projection?.firstMonth !== undefined ? projection.firstMonth : (start?.firstMonth ?? null),
      period: budget.month,
      complete,
      ...readiness,
      records,
    });
    return financeAttentionSnapshotSchema.parse({
      ...projected,
      asOf: at.toISOString(),
      timezone: owner.planningTimezone,
      snapshot: createHash("sha256")
        .update(
          JSON.stringify({
            start,
            budget,
            records,
            complete,
            opening: { ...opening, asOf: undefined },
          }),
        )
        .digest("hex"),
      readiness,
      policy: start ? { firstMonth: start.firstMonth, revision: start.revision } : null,
      qualificationRecovery: opening.qualified ? "none" : "opening_position_required",
    });
  };
  return executor
    ? read(executor)
    : db.transaction(read, { isolationLevel: "repeatable read", accessMode: "read only" });
}
