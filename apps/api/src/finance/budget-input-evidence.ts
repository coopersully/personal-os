import { createHash } from "node:crypto";
import { type Database, users } from "@personal-os/database";
import { eq, sql } from "drizzle-orm";
import { AppError } from "../errors.js";

/** Same expression is used by snapshot reads and the atomic approval UPDATE predicate. */
export function budgetInputEvidenceSql(userId: string, month: string) {
  return sql<unknown>`jsonb_build_object(
    'schema', 1, 'month', ${month}::text,
    'profile', (SELECT id FROM finance_profile_versions WHERE user_id = ${userId}::uuid ORDER BY version DESC LIMIT 1),
    'timezone', (SELECT planning_timezone FROM users WHERE id = ${userId}::uuid),
    'accounts', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', id, 'currencyCode', currency_code, 'includeInPlanning', include_in_planning, 'ownershipType', ownership_type, 'ownershipShareBps', ownership_share_bps) ORDER BY id), '[]'::jsonb) FROM finance_accounts WHERE user_id = ${userId}::uuid),
    'income', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', income.id, 'accountId', income.account_id, 'cadence', income.cadence, 'amountCents', income.expected_amount_cents, 'status', income.status, 'nextExpectedDate', income.next_expected_date, 'scheduleCurrent',
        (SELECT s.source_revision = income.revision FROM finance_recurring_schedule_versions s WHERE s.user_id = income.user_id AND s.income_stream_id = income.id ORDER BY s.source_revision DESC LIMIT 1)) ORDER BY income.id), '[]'::jsonb)
      FROM finance_income_streams income WHERE income.user_id = ${userId}::uuid AND status IN ('active', 'needs_review')),
    'obligations', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', obligation.id, 'accountId', obligation.account_id, 'kind', obligation.kind, 'cadence', obligation.cadence, 'amountCents', obligation.expected_amount_cents, 'status', obligation.status, 'nextExpectedDate', obligation.next_expected_date, 'scheduleCurrent',
        (SELECT s.source_revision = obligation.revision FROM finance_recurring_schedule_versions s WHERE s.user_id = obligation.user_id AND s.obligation_id = obligation.id ORDER BY s.source_revision DESC LIMIT 1)) ORDER BY obligation.id), '[]'::jsonb)
      FROM finance_recurring_obligations obligation WHERE obligation.user_id = ${userId}::uuid AND status IN ('active', 'needs_review')),
    'schedules', (SELECT coalesce(jsonb_agg(jsonb_build_object('incomeStreamId', s.income_stream_id, 'obligationId', s.obligation_id, 'accountId', s.account_id, 'cadence', s.cadence, 'timezone', s.timezone, 'anchorLocalDate', s.anchor_local_date, 'effectiveFrom', s.effective_from, 'semimonthlyDays', s.semimonthly_days, 'amountCents', s.amount_cents, 'amountBasis', s.amount_basis, 'currencyCode', s.currency_code) ORDER BY s.income_stream_id, s.obligation_id, s.effective_from), '[]'::jsonb)
      FROM finance_recurring_schedule_versions s WHERE s.user_id = ${userId}::uuid
      AND left(s.effective_from, 7) <= ${month}
      AND NOT EXISTS (SELECT 1 FROM finance_recurring_schedule_versions successor
        WHERE successor.user_id = s.user_id AND successor.supersedes_id = s.id
        AND successor.effective_from <= ${`${month}-01`}))
  )`;
}

/** Legacy budgets retain approvals, but no snapshot is manufactured for them. */
export async function readBudgetPlanningInputs(
  reader: Pick<Database, "select">,
  userId: string,
  month: string,
) {
  const [row] = await reader
    .select({ evidence: budgetInputEvidenceSql(userId, month) })
    .from(users)
    .where(eq(users.id, userId));
  if (!row) throw new AppError("not_found", "The budget owner was not found.");
  return {
    month,
    fingerprint: createHash("sha256").update(JSON.stringify(row.evidence)).digest("hex"),
    evidence: row.evidence,
  };
}
export async function readBudgetInputFingerprint(
  reader: Pick<Database, "select">,
  userId: string,
  month: string,
) {
  return (await readBudgetPlanningInputs(reader, userId, month)).fingerprint;
}
