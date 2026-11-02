import { createHash } from "node:crypto";
import { type Database, users } from "@personal-os/database";
import {
  classifyFinanceReviewBacklog,
  countFinanceReviewBacklogItem,
  emptyFinanceReviewBacklogCounts,
  type FinanceReviewBacklogAssessment,
  type FinanceReviewBacklogItem,
  type FinanceReviewBacklogPage,
  financeReviewBacklogAssessmentSchema,
  financeReviewBacklogGroups,
  financeReviewBacklogItemSchema,
  financeReviewBacklogPageSchema,
  financeReviewBacklogPeriod,
  financeReviewBacklogQuerySchema,
  localDateAt,
  localDateToIso,
} from "@personal-os/domain";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { AppError } from "../errors.js";

const transactionSchema = z.object({
  id: z.uuid(),
  contextual_revision: z.string(),
  transaction_date: z.string(),
  merchant: z.string(),
  amount_cents: z.number(),
  currency_code: z.string().nullable(),
  direction: z.enum(["income", "expense", "transfer"]),
  category: z.string().nullable(),
  needs_review: z.boolean(),
  pending: z.boolean(),
  provider_category: z.string().nullable(),
  provider_category_detailed: z.string().nullable(),
  reconciliation_status: z.string(),
  updated_at: z.string(),
});
const reviewSchema = z.object({
  id: z.uuid(),
  transaction_id: z.uuid(),
  contextual_revision: z.string(),
  action_revision: z.string(),
  reason_code: financeReviewBacklogItemSchema.shape.reason,
  reason: z.string(),
  status: z.enum(["open", "deferred"]),
  last_seen_at: z.string(),
  updated_at: z.string(),
  resolution: z.record(z.string(), z.unknown()).nullable(),
  evidence: z.record(z.string(), z.unknown()),
});
const cursorSchema = z
  .object({
    version: z.literal(1),
    snapshot: z.string().regex(/^[a-f0-9]{64}$/),
    group: financeReviewBacklogQuerySchema.shape.group.unwrap().nullable(),
    after: z.string().regex(/^(review_case|transaction_flag):[a-f0-9-]{36}$/),
  })
  .strict();
type Row = { key: string; transaction: string | null; review: string | null };
const digest = (value: string) => createHash("sha256").update(value).digest("hex");

function itemValue(row: Row, month: string): FinanceReviewBacklogItem {
  const transaction = row.transaction ? transactionSchema.parse(JSON.parse(row.transaction)) : null;
  const review = row.review ? reviewSchema.parse(JSON.parse(row.review)) : null;
  const transactionId = transaction?.id ?? review?.transaction_id;
  if (!transactionId) throw new AppError("internal_error", "Backlog source is unavailable.");
  const evidenceState = !transaction
    ? "transaction_unavailable"
    : !transaction.needs_review && review
      ? "transaction_not_flagged"
      : review && Date.parse(review.last_seen_at) < Date.parse(transaction.updated_at)
        ? "transaction_changed_since_observation"
        : "current_record";
  const group = classifyFinanceReviewBacklog({
    merchant: transaction?.merchant ?? "",
    providerCategory: transaction?.provider_category ?? null,
    providerCategoryDetailed: transaction?.provider_category_detailed ?? null,
    direction: transaction?.direction ?? "",
    reconciliationStatus: transaction?.reconciliation_status ?? "",
    reason: review?.reason_code ?? "needs_review",
  });
  const savedAnswer =
    review?.resolution?.type === "clarify"
      ? (review.resolution.answer ?? review.resolution.clarification)
      : null;
  const clarificationText =
    typeof savedAnswer === "string" && savedAnswer.trim()
      ? savedAnswer
      : typeof review?.evidence.clarification === "string" && review.evidence.clarification.trim()
        ? review.evidence.clarification
        : null;
  const savedClarification = clarificationText
    ? {
        source: clarificationText === savedAnswer ? ("resolution" as const) : ("evidence" as const),
        text: clarificationText.slice(0, 1000),
        truncated: clarificationText.length > 1000,
      }
    : null;
  const operations: FinanceReviewBacklogItem["recommendedOperations"] = review
    ? ["review_case", "validate_case_evidence"]
    : ["review_transaction"];
  if (group === "internal_movements" || group === "card_payments" || group === "roundups")
    operations.push("inspect_transfer_counterpart");
  else if (
    group !== "ambiguous_payments" &&
    (!review ||
      ["category_ambiguity", "merchant_identity", "missing_provenance"].includes(
        review.reason_code,
      ))
  )
    operations.push("confirm_category");
  // A flag is not a question; inspect its case history before asking again.
  else if (group === "ambiguous_payments" && review && !savedClarification)
    operations.push("ask_person");
  if (savedClarification) operations.push("review_saved_clarification");
  const evidence = [
    "Grouping is a routing clue, not a confirmed classification or authorization to clear review.",
    review
      ? `Active case reason: ${review.reason_code}; original reason: ${review.reason.slice(0, 100)}.`
      : "The transaction is explicitly flagged needsReview; no specific reason is inferred from that flag.",
  ];
  if (evidenceState !== "current_record")
    evidence.push(
      {
        transaction_unavailable:
          "The case has no accessible owner transaction. Investigate the mismatch; do not dismiss it automatically.",
        transaction_not_flagged:
          "The transaction is no longer flagged, but this case remains active and requires its own decision.",
        transaction_changed_since_observation:
          "The transaction changed after this case was last observed. Revalidate the case evidence before deciding.",
      }[evidenceState],
    );
  if (transaction?.provider_category_detailed)
    evidence.push(
      `Provider category hint: ${transaction.provider_category_detailed.slice(0, 120)}. Confirm against current evidence.`,
    );
  if (savedClarification)
    evidence.push(
      "A prior clarification is saved. Review that answer and apply it only to this case's reason; do not ask the same question again.",
    );
  return financeReviewBacklogItemSchema.parse({
    id: row.key,
    source: review ? "review_case" : "transaction_flag",
    transactionId,
    reviewCaseId: review?.id ?? null,
    group,
    reason: review?.reason_code ?? "needs_review",
    status: review?.status ?? "needs_review",
    period: financeReviewBacklogPeriod(transaction?.transaction_date ?? null, month),
    transaction: transaction
      ? {
          date: z.iso.date().safeParse(transaction.transaction_date).success
            ? transaction.transaction_date
            : null,
          merchant: transaction.merchant.slice(0, 240),
          amountCents: transaction.amount_cents,
          currencyCode: transaction.currency_code,
          direction: transaction.direction,
          category: transaction.category?.slice(0, 120) ?? null,
          needsReview: transaction.needs_review,
          pending: transaction.pending,
        }
      : null,
    // Full database JSON text retains timestamp microseconds and all decision-relevant fields.
    // Version the hashing contract; never substitute a contextual revision alone.
    fingerprint: digest(
      JSON.stringify(["finance-review-backlog:v1", row.key, row.transaction, row.review]),
    ),
    provenance: {
      transactionFingerprint: row.transaction ? digest(row.transaction) : null,
      reviewFingerprint: row.review ? digest(row.review) : null,
      expectedTransactionUpdatedAt: transaction
        ? new Date(transaction.updated_at).toISOString()
        : null,
      expectedReviewUpdatedAt: review ? new Date(review.updated_at).toISOString() : null,
      transactionRevision: transaction?.contextual_revision ?? null,
      reviewRevision: review?.contextual_revision ?? null,
      actionRevision: review?.action_revision ?? null,
      evidenceState,
      freshness: "requires_validation",
    },
    savedClarification,
    evidence,
    recommendedOperations: operations,
    requiresPreview: true,
    destination: review
      ? `/finances?review=${encodeURIComponent(`finance-review:${review.id}`)}`
      : `/finances/transactions?transactionId=${transactionId}`,
  });
}

/** Complete owner-only reads; no ledger writes, resolution, or external calls.
 * Each request scans all sources in bounded chunks under one repeatable-read snapshot.
 * Payload/memory stay bounded, but work is O(backlog size). A changed snapshot invalidates paging.
 * Fingerprints cover these source rows, not counterpart/account/authorization state: execution
 * must revalidate those dependencies under its own audited domain action locks.
 */
export function createFinanceReviewBacklogService(
  db: Database,
  options: { now?: () => Date } = {},
) {
  async function read(userId: string, rawQuery: unknown) {
    z.uuid().parse(userId);
    const query = financeReviewBacklogQuerySchema.parse(rawQuery);
    let cursor: z.infer<typeof cursorSchema> | null = null;
    if (query.cursor) {
      try {
        cursor = cursorSchema.parse(
          JSON.parse(Buffer.from(query.cursor, "base64url").toString("utf8")),
        );
      } catch {
        throw new AppError("invalid_request", "Invalid Finance backlog cursor.");
      }
      if (cursor.group !== (query.group ?? null))
        throw new AppError("invalid_request", "Backlog cursor scope changed. Restart listing.");
    }
    const asOf = options.now?.() ?? new Date();
    return db.transaction(
      async (tx) => {
        const [owner] = await tx
          .select({ planningTimezone: users.planningTimezone })
          .from(users)
          .where(eq(users.id, userId))
          .limit(1);
        if (!owner) throw new AppError("not_found", "Account not found.");
        const timezone = owner.planningTimezone;
        let month: string;
        try {
          month = localDateToIso(localDateAt(asOf, timezone)).slice(0, 7);
        } catch {
          throw new AppError(
            "invalid_request",
            "A valid planning timezone is required to assess Finance review periods.",
          );
        }
        const counts = emptyFinanceReviewBacklogCounts();
        const groups = financeReviewBacklogGroups.map((group) => ({
          ...group,
          counts: emptyFinanceReviewBacklogCounts(),
        }));
        const reasons = new Map<FinanceReviewBacklogItem["reason"], number>();
        const items: FinanceReviewBacklogItem[] = [];
        const hash = createHash("sha256").update(
          JSON.stringify(["finance-review-backlog:v1", userId, timezone, month]),
        );
        let after = "";
        let total = 0;
        let hasMore = false;
        let anchorFound = !cursor;
        for (;;) {
          // Cases remain visible even when their transaction is unflagged or incorrectly linked
          // to another owner. The left join must enforce ownership independently of the case.
          const result = await tx.execute<Row>(sql`
          WITH backlog AS (
            SELECT 'transaction_flag:' || t.id::text AS key,
              (to_jsonb(t) || jsonb_build_object('contextual_revision', t.contextual_revision::text))::text AS transaction,
              NULL::text AS review
            FROM finance_transactions t WHERE t.user_id = ${userId}::uuid AND t.needs_review
            UNION ALL
            SELECT 'review_case:' || r.id::text AS key,
              CASE WHEN t.id IS NULL THEN NULL ELSE
                (to_jsonb(t) || jsonb_build_object('contextual_revision', t.contextual_revision::text))::text END AS transaction,
              (to_jsonb(r) || jsonb_build_object('contextual_revision', r.contextual_revision::text, 'action_revision', r.action_revision::text))::text AS review
            FROM finance_review_cases r LEFT JOIN finance_transactions t
              ON t.id = r.transaction_id AND t.user_id = ${userId}::uuid
            WHERE r.user_id = ${userId}::uuid AND r.status IN ('open', 'deferred')
          ) SELECT key, transaction, review FROM backlog
          WHERE key COLLATE "C" > ${after} ORDER BY key COLLATE "C" LIMIT 500
        `);
          for (const row of result.rows) {
            const item = itemValue(row, month);
            hash.update(item.fingerprint);
            countFinanceReviewBacklogItem(counts, item);
            const group = groups.find((entry) => entry.group === item.group);
            if (group) countFinanceReviewBacklogItem(group.counts, item);
            reasons.set(item.reason, (reasons.get(item.reason) ?? 0) + 1);
            if (!query.group || item.group === query.group) {
              total++;
              if (cursor?.after === row.key) anchorFound = true;
              if (!cursor || row.key > cursor.after) {
                if (items.length < query.limit) items.push(item);
                else hasMore = true;
              }
            }
            after = row.key;
          }
          if (result.rows.length < 500) break;
        }
        const snapshot = hash.digest("hex");
        if (cursor && (cursor.snapshot !== snapshot || !anchorFound))
          throw new AppError(
            "conflict",
            "Finance backlog changed. Restart listing to obtain a complete current snapshot.",
          );
        const assessment = financeReviewBacklogAssessmentSchema.parse({
          schemaVersion: 1,
          snapshot,
          scope: "all_owned_transactions_flagged_and_open_or_deferred_cases",
          countingUnit: "transaction_flags_and_review_cases_separately",
          month,
          timezone,
          complete: true,
          counts,
          groups,
          reasons: [...reasons]
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([reason, count]) => ({ reason, count })),
        });
        const last = items.at(-1);
        const nextCursor =
          hasMore && last
            ? Buffer.from(
                JSON.stringify({
                  version: 1,
                  snapshot,
                  group: query.group ?? null,
                  after: last.id,
                }),
              ).toString("base64url")
            : null;
        const page = financeReviewBacklogPageSchema.parse({
          schemaVersion: 1,
          snapshot,
          group: query.group ?? null,
          total,
          items,
          nextCursor,
          complete: !hasMore,
          consistency: "snapshot_bound_restart_on_change",
        });
        return { assessment, page };
      },
      { accessMode: "read only", isolationLevel: "repeatable read" },
    );
  }
  return {
    async assess(userId: string): Promise<FinanceReviewBacklogAssessment> {
      return (await read(userId, {})).assessment;
    },
    async list(userId: string, query: unknown = {}): Promise<FinanceReviewBacklogPage> {
      return (await read(userId, query)).page;
    },
  };
}
