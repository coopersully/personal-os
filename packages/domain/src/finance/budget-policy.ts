import { z } from "zod";
import { idSchema, isoDateTimeSchema } from "../common.js";
import { financePositionEvidenceSchema, financeRevisionRefSchema } from "./workflow-contracts.js";

/** Explicit terms for hypothetical evaluation only; this contract confers no authority. */
export const financeBudgetPolicyCentsSchema = z.number().int().min(0).max(2_147_483_647);
const keySchema = z.string().trim().min(1).max(120);
const revisionRef = financeRevisionRefSchema.readonly();

export const financeBudgetPolicyPeriodSchema = z
  .object({ from: z.iso.date(), through: z.iso.date(), timezone: z.string().min(1).max(100) })
  .strict()
  .superRefine((period, context) => {
    const start = new Date(`${period.from}T00:00:00Z`);
    if (!Number.isFinite(start.getTime())) return;
    const end = new Date(start);
    end.setUTCMonth(end.getUTCMonth() + 1, 0);
    if (!period.from.endsWith("-01") || period.through !== end.toISOString().slice(0, 10))
      context.addIssue({ code: "custom", message: "Supply one complete calendar month." });
    try {
      if (/^[+-]/.test(period.timezone)) throw new Error("Expected named timezone");
      new Intl.DateTimeFormat("en-US", { timeZone: period.timezone });
    } catch {
      context.addIssue({ code: "custom", message: "Supply a valid IANA timezone." });
    }
  })
  .readonly();

export const financeBudgetPolicyTermsSchema = z
  .object({
    currency: z.literal("USD"),
    period: financeBudgetPolicyPeriodSchema,
    rollover: z.literal("none"),
    accounting: z.literal("gross_positive_allocation_deltas"),
    usageScope: z.literal("user_month_all_policy_versions"),
    perChangeCapCents: financeBudgetPolicyCentsSchema,
    monthlyCapCents: financeBudgetPolicyCentsSchema,
    expiresAt: isoDateTimeSchema,
    baseline: revisionRef,
    directions: z
      .array(
        z
          .object({
            allocationKey: keySchema,
            direction: z.enum(["increase", "decrease", "both"]),
          })
          .strict()
          .readonly(),
      )
      .max(500)
      .readonly(),
    protections: z
      .array(
        z
          .object({
            allocationKey: keySchema,
            minimumCents: financeBudgetPolicyCentsSchema,
          })
          .strict()
          .readonly(),
      )
      .max(500)
      .readonly(),
  })
  .strict()
  .superRefine((terms, context) => {
    for (const field of ["directions", "protections"] as const) {
      const keys = terms[field].map((entry) => entry.allocationKey);
      if (new Set(keys).size !== keys.length)
        context.addIssue({
          code: "custom",
          path: [field],
          message: "Allocation identities must be unique.",
        });
    }
  })
  .readonly();
export type FinanceBudgetPolicyTerms = z.infer<typeof financeBudgetPolicyTermsSchema>;

/** Every expected and observed identity is explicit; null is missing evidence, never a wildcard. */
export const financeBudgetPolicyRevisionTupleSchema = z
  .object({
    userId: idSchema,
    planId: idSchema,
    policy: revisionRef,
    policyLifecycleRevision: z.number().int().nonnegative().safe(),
    profile: revisionRef.nullable(),
    baseline: revisionRef,
    activeBudget: revisionRef.nullable(),
    latestBudget: revisionRef.nullable(),
    positionRevision: z.string().min(1).max(200).nullable(),
    usageRevision: z.string().min(1).max(200).nullable(),
  })
  .strict()
  .readonly();
export type FinanceBudgetPolicyRevisionTuple = z.infer<
  typeof financeBudgetPolicyRevisionTupleSchema
>;

export const financeBudgetPolicyPlanSnapshotSchema = z
  .object({
    userId: idSchema,
    planId: idSchema,
    revision: revisionRef,
    month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
    resources: z
      .array(
        z
          .object({
            key: keySchema,
            kind: z.enum(["income", "reserve_draw", "borrowing", "other"]),
            sourceId: idSchema.nullable(),
            amountCents: financeBudgetPolicyCentsSchema,
          })
          .strict()
          .readonly(),
      )
      .max(100)
      .readonly(),
    allocations: z
      .array(
        z
          .object({
            key: keySchema,
            kind: z.enum(["spending", "savings", "debt", "goal", "buffer"]),
            targetId: idSchema.nullable(),
            amountCents: financeBudgetPolicyCentsSchema,
          })
          .strict()
          .readonly(),
      )
      .max(500)
      .readonly(),
  })
  .strict()
  .superRefine((plan, context) => {
    for (const field of ["resources", "allocations"] as const) {
      const keys = plan[field].map((item) => item.key);
      if (new Set(keys).size !== keys.length)
        context.addIssue({
          code: "custom",
          path: [field],
          message: "Plan identities must be unique.",
        });
      if (plan[field].reduce((total, item) => total + item.amountCents, 0) > 2_147_483_647)
        context.addIssue({
          code: "custom",
          path: [field],
          message: "Plan total exceeds supported cents.",
        });
    }
  })
  .readonly();
export type FinanceBudgetPolicyPlanSnapshot = z.infer<typeof financeBudgetPolicyPlanSnapshotSchema>;

const unavailable = z
  .object({
    state: z.literal("unavailable"),
    reason: z.enum(["producer_not_registered", "missing_evidence", "stale_evidence"]),
  })
  .strict()
  .readonly();

type ImmutableEvidence<T> = T extends object
  ? { readonly [K in keyof T]: ImmutableEvidence<T[K]> }
  : T;

/** Freeze only Zod's parsed copy, including nested fact sources and account scopes. */
function immutableEvidence<T>(value: T): ImmutableEvidence<T> {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) immutableEvidence(child);
    Object.freeze(value);
  }
  return value as ImmutableEvidence<T>;
}

export const financeBudgetPolicyEvaluationInputSchema = z
  .object({
    evaluatedAt: isoDateTimeSchema,
    terms: financeBudgetPolicyTermsSchema,
    policyState: z.enum(["draft", "disabled", "expired", "unknown"]),
    expected: financeBudgetPolicyRevisionTupleSchema,
    observed: financeBudgetPolicyRevisionTupleSchema,
    baseline: financeBudgetPolicyPlanSnapshotSchema.nullable(),
    current: financeBudgetPolicyPlanSnapshotSchema.nullable(),
    candidate: financeBudgetPolicyPlanSnapshotSchema,
    position: z.union([
      unavailable,
      z
        .object({
          state: z.literal("available"),
          userId: idSchema,
          evidence: financePositionEvidenceSchema.transform(immutableEvidence),
        })
        .strict()
        .readonly(),
    ]),
    usage: z.union([
      unavailable,
      z
        .object({
          state: z.literal("available"),
          userId: idSchema,
          period: financeBudgetPolicyPeriodSchema,
          revision: z.string().min(1).max(200),
          accounting: z.literal("gross_positive_allocation_deltas"),
          scope: z.literal("user_month_all_policy_versions"),
          consumedCents: financeBudgetPolicyCentsSchema,
        })
        .strict()
        .readonly(),
    ]),
  })
  .strict()
  .readonly();
export type FinanceBudgetPolicyEvaluationInput = z.infer<
  typeof financeBudgetPolicyEvaluationInputSchema
>;

export const financeBudgetPolicyDenialReasonSchema = z.enum([
  "stale_revision",
  "missing_evidence",
  "position_unavailable",
  "position_unqualified",
  "usage_unavailable",
  "scope_mismatch",
  "policy_disabled",
  "policy_expired",
  "policy_unknown",
  "outside_period",
  "resource_changed",
  "allocation_identity_changed",
  "unbalanced_plan",
  "direction_not_permitted",
  "protected_release",
  "protection_floor",
  "per_change_cap",
  "monthly_cap",
  "amount_overflow",
]);

/** A hypothetical preview is not a saved proposal, approval, reservation, or permission to execute. */
export const financeBudgetPolicyEvaluationSchema = z
  .object({
    kind: z.enum(["hypothetical_preview", "denied"]),
    executionAvailable: z.literal(false),
    executionUnavailableReasons: z
      .tuple([z.literal("authority_not_wired"), z.literal("position_commit_fence_not_wired")])
      .readonly(),
    evaluatedAt: isoDateTimeSchema,
    input: financeBudgetPolicyEvaluationInputSchema,
    revisions: financeBudgetPolicyRevisionTupleSchema,
    reasons: z.array(financeBudgetPolicyDenialReasonSchema).readonly(),
    grossMovedCents: financeBudgetPolicyCentsSchema.nullable(),
    projectedMonthlyUsageCents: financeBudgetPolicyCentsSchema.nullable(),
    deltas: z
      .array(
        z
          .object({
            allocationKey: keySchema,
            beforeCents: financeBudgetPolicyCentsSchema,
            afterCents: financeBudgetPolicyCentsSchema,
            deltaCents: z.number().int().min(-2_147_483_647).max(2_147_483_647),
          })
          .strict()
          .readonly(),
      )
      .max(500)
      .readonly(),
  })
  .strict()
  .superRefine((result, context) => {
    if (
      result.kind === "hypothetical_preview" &&
      (result.input.position.state !== "available" || result.input.usage.state !== "available")
    )
      context.addIssue({
        code: "custom",
        message: "A matching hypothetical preview requires position and usage evidence.",
      });
    const keys = result.deltas.map((delta) => delta.allocationKey);
    if (new Set(keys).size !== keys.length)
      context.addIssue({
        code: "custom",
        path: ["deltas"],
        message: "Allocation identities must be unique.",
      });
    if (result.deltas.some((delta) => delta.deltaCents !== delta.afterCents - delta.beforeCents))
      context.addIssue({
        code: "custom",
        path: ["deltas"],
        message: "Delta must equal after minus before cents.",
      });
    const gross = result.deltas.reduce((total, delta) => total + Math.max(0, delta.deltaCents), 0);
    if (
      result.grossMovedCents === null ? result.deltas.length > 0 : result.grossMovedCents !== gross
    )
      context.addIssue({
        code: "custom",
        path: ["grossMovedCents"],
        message: "Gross moved cents must equal the sum of positive allocation deltas.",
      });
    const projected =
      result.input.usage.state === "available" && result.grossMovedCents !== null
        ? result.input.usage.consumedCents + result.grossMovedCents
        : null;
    if (result.projectedMonthlyUsageCents !== projected)
      context.addIssue({
        code: "custom",
        path: ["projectedMonthlyUsageCents"],
        message:
          "Projected usage must equal evidenced consumed cents plus gross moved cents, or remain unknown.",
      });
    if (
      result.evaluatedAt !== result.input.evaluatedAt ||
      JSON.stringify(result.revisions) !== JSON.stringify(result.input.observed)
    )
      context.addIssue({
        code: "custom",
        message: "Preview identity and observation time must match the supplied evidence.",
      });
    if ((result.kind === "denied") !== result.reasons.length > 0)
      context.addIssue({
        code: "custom",
        path: ["reasons"],
        message: "A denial requires reasons; a matching hypothetical preview has none.",
      });
    if (
      result.kind === "hypothetical_preview" &&
      (result.grossMovedCents === null || result.projectedMonthlyUsageCents === null)
    )
      context.addIssue({
        code: "custom",
        message: "A matching hypothetical preview requires known amounts.",
      });
  })
  .readonly();
export type FinanceBudgetPolicyEvaluation = z.infer<typeof financeBudgetPolicyEvaluationSchema>;
