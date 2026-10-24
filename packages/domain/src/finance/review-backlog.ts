import { z } from "zod";

export const financeReviewBacklogGroupSchema = z.enum([
  "roundups",
  "internal_movements",
  "card_payments",
  "ambiguous_payments",
  "other_categorization",
]);
export type FinanceReviewBacklogGroup = z.infer<typeof financeReviewBacklogGroupSchema>;
export const financeReviewBacklogQuerySchema = z
  .object({
    group: financeReviewBacklogGroupSchema.optional(),
    cursor: z.string().min(1).max(2048).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict();
export type FinanceReviewBacklogQuery = z.input<typeof financeReviewBacklogQuerySchema>;

const periodSchema = z.enum(["current_month", "historical", "future", "unknown"]);
const reasonSchema = z.enum([
  "needs_review",
  "budget_variance",
  "category_ambiguity",
  "merchant_identity",
  "missing_provenance",
  "possible_duplicate",
  "possible_transfer",
  "profile_fact",
  "recurring_status",
  "refund_or_reversal",
  "reimbursement",
  "source_freshness",
  "unusual_amount",
]);
const countSchema = z.number().int().nonnegative();
const countsSchema = z.object({
  items: countSchema,
  needsReviewTransactions: countSchema,
  openReviewCases: countSchema,
  deferredReviewCases: countSchema,
  currentMonth: countSchema,
  historical: countSchema,
  future: countSchema,
  unknownDate: countSchema,
  mismatchedReviewCases: countSchema,
});
export const financeReviewBacklogItemSchema = z.object({
  id: z.string().max(80),
  source: z.enum(["transaction_flag", "review_case"]),
  transactionId: z.uuid(),
  reviewCaseId: z.uuid().nullable(),
  group: financeReviewBacklogGroupSchema,
  reason: reasonSchema,
  status: z.enum(["needs_review", "open", "deferred"]),
  period: periodSchema,
  transaction: z
    .object({
      date: z.iso.date().nullable(),
      merchant: z.string().max(240),
      amountCents: z.number().int(),
      currencyCode: z.string().max(3).nullable(),
      direction: z.enum(["expense", "income", "transfer"]),
      category: z.string().max(120).nullable(),
      needsReview: z.boolean(),
      pending: z.boolean(),
    })
    .nullable(),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  provenance: z.object({
    transactionFingerprint: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .nullable(),
    reviewFingerprint: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .nullable(),
    expectedTransactionUpdatedAt: z.iso.datetime().nullable(),
    expectedReviewUpdatedAt: z.iso.datetime().nullable(),
    transactionRevision: z.string().regex(/^\d+$/).nullable(),
    reviewRevision: z.string().regex(/^\d+$/).nullable(),
    actionRevision: z.string().regex(/^\d+$/).nullable(),
    evidenceState: z.enum([
      "current_record",
      "transaction_not_flagged",
      "transaction_unavailable",
      "transaction_changed_since_observation",
    ]),
    // A current row is not proof that its evidence remains applicable.
    freshness: z.literal("requires_validation"),
  }),
  savedClarification: z
    .object({
      source: z.enum(["resolution", "evidence"]),
      text: z.string().max(1000),
      truncated: z.boolean(),
    })
    .nullable(),
  evidence: z.array(z.string().max(300)).max(5),
  recommendedOperations: z
    .array(
      z.enum([
        "review_transaction",
        "review_case",
        "inspect_transfer_counterpart",
        "confirm_category",
        "ask_person",
        "validate_case_evidence",
        "review_saved_clarification",
      ]),
    )
    .max(4),
  requiresPreview: z.literal(true),
  destination: z.string().max(200),
});
export type FinanceReviewBacklogItem = z.infer<typeof financeReviewBacklogItemSchema>;

const groupSummarySchema = z.object({
  group: financeReviewBacklogGroupSchema,
  label: z.string(),
  guidance: z.string(),
  counts: countsSchema,
});
export const financeReviewBacklogAssessmentSchema = z.object({
  schemaVersion: z.literal(1),
  snapshot: z.string().regex(/^[a-f0-9]{64}$/),
  scope: z.literal("all_owned_transactions_flagged_and_open_or_deferred_cases"),
  countingUnit: z.literal("transaction_flags_and_review_cases_separately"),
  month: z.string().regex(/^\d{4}-\d{2}$/),
  timezone: z.string().min(1).max(100),
  complete: z.literal(true),
  counts: countsSchema,
  reasons: z.array(z.object({ reason: reasonSchema, count: countSchema })).max(14),
  groups: z.array(groupSummarySchema).length(5),
});
export type FinanceReviewBacklogAssessment = z.infer<typeof financeReviewBacklogAssessmentSchema>;
export const financeReviewBacklogPageSchema = z.object({
  schemaVersion: z.literal(1),
  snapshot: z.string().regex(/^[a-f0-9]{64}$/),
  group: financeReviewBacklogGroupSchema.nullable(),
  total: countSchema,
  items: z.array(financeReviewBacklogItemSchema).max(100),
  nextCursor: z.string().max(2048).nullable(),
  complete: z.boolean(),
  consistency: z.literal("snapshot_bound_restart_on_change"),
});
export type FinanceReviewBacklogPage = z.infer<typeof financeReviewBacklogPageSchema>;

export const financeReviewBacklogGroups = [
  {
    group: "roundups",
    label: "Possible roundups",
    guidance:
      "A roundup description is a clue. Confirm the destination and purpose before deciding.",
  },
  {
    group: "internal_movements",
    label: "Possible internal movements",
    guidance: "Inspect both sides and account ownership before confirming a transfer.",
  },
  {
    group: "card_payments",
    label: "Possible card payments",
    guidance: "Confirm the card account and matching payment; a label alone is insufficient.",
  },
  {
    group: "ambiguous_payments",
    label: "Ambiguous payments",
    guidance:
      "Payment wording does not establish spending, reimbursement, or transfer purpose. Ask when evidence is insufficient.",
  },
  {
    group: "other_categorization",
    label: "Other review work",
    guidance:
      "Review the exact reason and current evidence. Categorization does not resolve unrelated review reasons.",
  },
] as const;

/** Grouping is a routing hint, never a resolution or permission to clear a flag/case. */
export function classifyFinanceReviewBacklog(input: {
  merchant: string;
  providerCategory: string | null;
  providerCategoryDetailed: string | null;
  direction: string;
  reconciliationStatus: string;
  reason: string;
}): FinanceReviewBacklogGroup {
  const label = input.merchant.toLowerCase();
  const provider =
    `${input.providerCategory ?? ""} ${input.providerCategoryDetailed ?? ""}`.toLowerCase();
  if (/\bround[ -]?ups?\b/.test(label)) return "roundups";
  if (
    /credit_card_payment|loan_payments_credit_card_payment/.test(provider) ||
    /\b(card payment|credit card payment)\b/.test(label)
  )
    return "card_payments";
  if (
    input.direction === "transfer" ||
    input.reason === "possible_transfer" ||
    ["confirmed", "matched"].includes(input.reconciliationStatus)
  )
    return "internal_movements";
  if (/\b(payment|p2p|venmo|paypal|cash app|zelle)\b/.test(label)) return "ambiguous_payments";
  return "other_categorization";
}

export function financeReviewBacklogPeriod(
  date: string | null,
  month: string,
): z.infer<typeof periodSchema> {
  if (!date || !z.iso.date().safeParse(date).success) return "unknown";
  if (date.slice(0, 7) === month) return "current_month";
  return date.slice(0, 7) < month ? "historical" : "future";
}

export function emptyFinanceReviewBacklogCounts(): z.infer<typeof countsSchema> {
  return {
    items: 0,
    needsReviewTransactions: 0,
    openReviewCases: 0,
    deferredReviewCases: 0,
    currentMonth: 0,
    historical: 0,
    future: 0,
    unknownDate: 0,
    mismatchedReviewCases: 0,
  };
}

export function countFinanceReviewBacklogItem(
  counts: z.infer<typeof countsSchema>,
  item: FinanceReviewBacklogItem,
): void {
  counts.items++;
  if (item.source === "transaction_flag") counts.needsReviewTransactions++;
  else if (item.status === "open") counts.openReviewCases++;
  else counts.deferredReviewCases++;
  const periodKey = {
    current_month: "currentMonth",
    historical: "historical",
    future: "future",
    unknown: "unknownDate",
  } as const;
  counts[periodKey[item.period]]++;
  if (item.source === "review_case" && item.provenance.evidenceState !== "current_record")
    counts.mismatchedReviewCases++;
}
