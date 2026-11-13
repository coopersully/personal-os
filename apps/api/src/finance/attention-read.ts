import { createHash } from "node:crypto";
import { type Database, financeBudgetStartPolicies, users } from "@personal-os/database";
import {
  financeAttentionRecordSchema,
  financeAttentionSnapshotSchema,
  projectFinanceAttention,
} from "@personal-os/domain";
import { desc, eq, type SQL, sql } from "drizzle-orm";
import { AppError } from "../errors.js";
import { readBudgetPlanContext } from "./budget-plan-projection.js";
import type { FinanceTransaction } from "./context.js";
import { createFinanceOpeningPositionService } from "./opening-position-service.js";

/** Stored JSON carries transaction ids as text. Converting the JSON side keeps every
 * comparison uuid-to-uuid, so `finance_transactions` is reached through its primary key.
 * Only canonical text converts: exactly the values the former text comparison matched.
 */
const canonicalUuid = sql.raw("'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'");
const uuidFrom = (text: SQL) => sql`CASE WHEN ${text} ~ ${canonicalUuid} THEN (${text})::uuid END`;
const transferCategories = sql.raw("('TRANSFER_IN','TRANSFER_OUT')");

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
    const firstMonth =
      projection?.firstMonth !== undefined ? projection.firstMonth : (start?.firstMonth ?? null);
    // A missing new month's statement does not invalidate a qualified activation boundary.
    const boundary = firstMonth
      ? await createFinanceOpeningPositionService({ db, now: () => at }).readOpeningPosition(
          userId,
          firstMonth,
          tx,
          true,
        )
      : opening;
    const dependencyFrom = `${firstMonth ?? budget.month}-01`;
    const result = await tx.execute<{ record: unknown }>(sql`
      WITH work AS (
        SELECT 'flag:' || t.id::text AS id, t.id AS transaction_id,
          'transaction_flag'::text AS source, t.transaction_date AS date,
          NULL::text AS decision_key, 'processing'::text AS work_state
        FROM finance_transactions t WHERE t.user_id = ${userId}::uuid AND t.needs_review
        UNION ALL
        SELECT 'case:' || r.id::text, t.id, 'review_case', t.transaction_date,
          CASE WHEN r.human_action->>'state' = 'open'
            THEN 'request:' || (r.human_action->'request'->>'requestId') ELSE NULL END,
          CASE WHEN r.human_action->>'state' = 'open' THEN 'needs_person'
            WHEN t.id IS NULL THEN 'technical_blocker' ELSE 'processing' END
        FROM finance_review_cases r LEFT JOIN finance_transactions t
          ON t.id = r.transaction_id AND t.user_id = ${userId}::uuid
        WHERE r.user_id = ${userId}::uuid AND r.status IN ('open', 'deferred')
        UNION ALL
        SELECT 'question:' || q.id::text, t.id, 'question', t.transaction_date,
          'question:' || q.id::text, 'needs_person'
        FROM finance_contextual_questions q LEFT JOIN finance_transactions t
          ON t.id = q.transaction_id AND t.user_id = ${userId}::uuid
        WHERE q.user_id = ${userId}::uuid AND q.state = 'open'
        UNION ALL
        SELECT 'action:' || a.id::text, NULL::uuid, CASE WHEN a.action_kind = 'question' THEN 'question' ELSE 'approval' END,
          NULL, 'action:' || a.id::text, 'needs_person'
        FROM finance_agent_action_reviews a WHERE a.user_id = ${userId}::uuid AND a.status = 'pending'
        UNION ALL
        SELECT 'start:' || p.id::text, NULL::uuid, 'approval', ${`${budget.month}-01`},
          'start:' || p.id::text, 'needs_person'
        FROM finance_budget_start_previews p
        WHERE p.user_id = ${userId}::uuid
          AND (${projection?.excludeBudgetStartPreviewId ?? null}::uuid IS NULL OR p.id <> ${projection?.excludeBudgetStartPreviewId ?? null}::uuid)
          AND p.expected_policy_revision >= COALESCE((SELECT MAX(revision) FROM finance_budget_start_policies WHERE user_id = ${userId}::uuid), 0)
          AND EXISTS (SELECT 1 FROM finance_conversation_messages m WHERE m.user_id = ${userId}::uuid
            AND m.author_kind = 'agent' AND m.record_refs @> jsonb_build_array(jsonb_build_object('kind','budget_start_preview','id',p.id::text)))
        UNION ALL
        SELECT 'batch:' || b.id::text || ':' || d.ordinal::text || ':' || leg.ordinal::text,
          t.id, 'approval', t.transaction_date,
          'batch:' || b.id::text, CASE WHEN a.id IS NULL THEN 'needs_person' WHEN a.state IN ('blocked','expired','completed_with_exceptions') THEN 'technical_blocker' ELSE 'processing' END
        FROM finance_review_batch_runs b
        CROSS JOIN LATERAL jsonb_array_elements(b.manifest) WITH ORDINALITY d(value, ordinal)
        CROSS JOIN LATERAL jsonb_array_elements_text(jsonb_build_array(
          COALESCE(d.value->'decision', d.value)->>'transactionId',
          COALESCE(d.value->'decision', d.value)->>'counterpartTransactionId'
        )) WITH ORDINALITY leg(id, ordinal)
        LEFT JOIN finance_transactions t ON t.user_id = b.user_id AND t.id = ${uuidFrom(sql`leg.id`)}
        LEFT JOIN finance_review_batch_approvals a ON a.batch_id = b.id AND a.user_id = b.user_id
        WHERE b.user_id = ${userId}::uuid AND leg.id IS NOT NULL
          AND (a.id IS NULL OR a.state <> 'cancelled')
          AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(b.outcomes) outcome
            WHERE (outcome->>'index')::integer = d.ordinal - 1 AND outcome->>'status' = 'applied')
          AND (t.id IS NULL OR (
            t.contextual_revision::text = CASE WHEN leg.ordinal = 1
              THEN COALESCE(d.value->'decision', d.value)->>'expectedTransactionRevision'
              ELSE COALESCE(d.value->'decision', d.value)->>'expectedCounterpartRevision' END
            AND (a.state IS DISTINCT FROM 'completed_with_exceptions' OR t.needs_review
              OR EXISTS (SELECT 1 FROM finance_review_cases r WHERE r.user_id = b.user_id AND r.transaction_id = t.id AND r.status IN ('open','deferred')))
          ))
          AND EXISTS (SELECT 1 FROM finance_conversation_messages m WHERE m.user_id = ${userId}::uuid
            AND m.author_kind = 'agent' AND m.record_refs @> jsonb_build_array(jsonb_build_object('kind','review_batch','id',b.id::text)))
        UNION ALL
        SELECT 'correction:' || c.id::text || ':' || idx.value || ':' || COALESCE(leg.value->>'id', 'unknown'),
          t.id, 'approval', t.transaction_date,
          'correction:' || c.id::text, 'needs_person'
        FROM finance_review_batch_corrections c
        CROSS JOIN LATERAL jsonb_array_elements_text(c.outcome_indexes) idx(value)
        LEFT JOIN finance_review_batch_effects effect ON effect.user_id = c.user_id AND effect.batch_id = c.batch_id AND effect.outcome_index = idx.value::integer
        LEFT JOIN LATERAL jsonb_array_elements(effect.before->'transactions') leg(value) ON true
        LEFT JOIN finance_transactions t ON t.user_id = c.user_id AND t.id = ${uuidFrom(sql`leg.value->>'id'`)}
        WHERE c.user_id = ${userId}::uuid
          AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(c.outcomes) outcome WHERE outcome->>'index' = idx.value)
          AND EXISTS (SELECT 1 FROM finance_conversation_messages m WHERE m.user_id = ${userId}::uuid
            AND m.author_kind = 'agent' AND m.record_refs @> jsonb_build_array(jsonb_build_object('kind','review_batch_undo','id',c.id::text)))
      ), linked AS (
        -- Each relationship's members, expanded once instead of probed per work record.
        SELECT rel.id AS relationship_id, ${uuidFrom(sql`member.id`)} AS transaction_id
        FROM finance_transaction_relationships rel
        CROSS JOIN LATERAL jsonb_array_elements_text(
          CASE WHEN jsonb_typeof(rel.transaction_ids) = 'array' THEN rel.transaction_ids ELSE '[]'::jsonb END
        ) member(id)
        WHERE rel.user_id = ${userId}::uuid
      ), current_linked AS (
        -- Members of any relationship that also contains current-period activity.
        SELECT member.transaction_id FROM linked member
        WHERE member.transaction_id IS NOT NULL AND member.relationship_id IN (
          SELECT peer.relationship_id FROM linked peer
          JOIN finance_transactions related ON related.id = peer.transaction_id
            AND related.user_id = ${userId}::uuid
          WHERE related.transaction_date >= ${dependencyFrom})
      ), candidates AS (
        -- Only work that could be one side of a transfer is compared with later activity.
        SELECT source.id, source.account_id, source.amount_cents, source.currency_code,
          source.provider_direction, source.provider_category, source.transaction_date,
          source.transfer_group_id
        FROM finance_transactions source
        WHERE source.user_id = ${userId}::uuid
          AND source.id IN (SELECT work.transaction_id FROM work WHERE work.transaction_id IS NOT NULL)
          AND (source.transfer_group_id IS NOT NULL OR source.provider_category IN ${transferCategories})
      ), current_counterpart AS (
        SELECT source.id AS transaction_id FROM candidates source
        JOIN finance_transactions related ON related.user_id = ${userId}::uuid
          AND related.transfer_group_id = source.transfer_group_id AND related.id <> source.id
        WHERE related.transaction_date >= ${dependencyFrom}
        UNION
        SELECT source.id FROM candidates source
        JOIN finance_transactions related ON related.user_id = ${userId}::uuid
          AND related.amount_cents = source.amount_cents
          AND related.currency_code = source.currency_code AND related.id <> source.id
        WHERE related.transaction_date >= ${dependencyFrom}
          AND source.account_id <> related.account_id
          AND source.provider_direction <> related.provider_direction
          AND source.provider_category IN ${transferCategories}
          AND related.provider_category IN ${transferCategories}
          AND abs(source.transaction_date::date - related.transaction_date::date) <= 3
      ) SELECT jsonb_build_object('id', id, 'transactionId', transaction_id, 'source', source,
          'date', date, 'decisionKey', decision_key, 'workState', work_state,
          'dependency', CASE
            WHEN date IS NULL THEN 'unknown'
            WHEN transaction_id IN (SELECT transaction_id FROM current_linked) THEN 'affects_current'
            WHEN transaction_id IN (SELECT transaction_id FROM current_counterpart) THEN 'affects_current'
            WHEN date < ${dependencyFrom} AND NOT EXISTS (
              SELECT 1 FROM finance_transactions source WHERE source.user_id = ${userId}::uuid
                AND source.id = work.transaction_id
                AND ${JSON.stringify(boundary.accounts.filter((account) => account.reasons.length === 0).map((account) => account.accountId))}::jsonb ? source.account_id::text
            ) THEN 'unknown'
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
            boundary: { ...boundary, asOf: undefined },
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
