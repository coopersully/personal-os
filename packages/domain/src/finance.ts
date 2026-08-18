import { z } from "zod";
import {
  attentionItemImportanceSchema,
  attentionItemKindSchema,
  domainProfileSchema,
} from "./assistant.js";
import { idSchema, isoDateTimeSchema } from "./common.js";
import { connectorSyncRecoverySchema } from "./connection.js";
import { agentMutationPolicies, materialSourceReferenceSchema } from "./feature-contracts.js";

export const financeProviderSchema = z.enum(["plaid", "paypal", "venmo", "zelle", "manual"]);
export type FinanceProvider = z.infer<typeof financeProviderSchema>;
export const transactionDirectionSchema = z.enum(["income", "expense", "transfer"]);
export type TransactionDirection = z.infer<typeof transactionDirectionSchema>;
export const financeAccountKindSchema = z.enum(["cash", "investment", "debt", "other"]);
export type FinanceAccountKind = z.infer<typeof financeAccountKindSchema>;

export const financeSynchronizationSchema = z.object({
  failureCode: z.string().max(120).nullable(),
  failureCount: z.number().int().nonnegative(),
  lastAttemptAt: isoDateTimeSchema.nullable(),
  lastSuccessAt: isoDateTimeSchema.nullable(),
  message: z.string().max(300).nullable(),
  nextRetryAt: isoDateTimeSchema.nullable(),
  recovery: connectorSyncRecoverySchema.nullable(),
  state: z.enum(["current", "stale", "retrying", "blocked"]),
});
export type FinanceSynchronization = z.infer<typeof financeSynchronizationSchema>;

/**
 * Public, local-only synchronization health for the authoritative Plaid Item.
 * Remote Item identity, credentials, cursors, claims, and legacy grouping
 * values remain storage and service implementation details.
 */
export const financeProviderItemHealthSchema = z.object({
  accountIds: z.array(idSchema),
  id: idSchema,
  provider: z.literal("plaid"),
  synchronization: financeSynchronizationSchema,
});
export type FinanceProviderItemHealth = z.infer<typeof financeProviderItemHealthSchema>;

export const financeAutomationSettingsSchema = z.object({
  reviewBypassEnabled: z.boolean().default(false),
});
export type FinanceAutomationSettings = z.infer<typeof financeAutomationSettingsSchema>;

export const updateFinanceAutomationSettingsInputSchema = z
  .object({ reviewBypassEnabled: z.boolean() })
  .strict();
export type UpdateFinanceAutomationSettingsInput = z.infer<
  typeof updateFinanceAutomationSettingsInputSchema
>;

const moneySchema = z.number().finite().nonnegative().max(100_000_000);
const categorySchema = z.string().trim().min(1).max(80);
const financeMonthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/u);

export const financeFactBasisSchema = z.enum([
  "user_stated",
  "ledger_observed",
  "calculated",
  "estimated",
  "missing",
]);
export type FinanceFactBasis = z.infer<typeof financeFactBasisSchema>;

export const financeFactConfidenceSchema = z.enum(["high", "medium", "low"]);
export type FinanceFactConfidence = z.infer<typeof financeFactConfidenceSchema>;

/** Provenance for a material fact used to make a Finance decision. */
export const financeFactEvidenceSchema = <T extends z.ZodType>(valueSchema: T) =>
  z
    .object({
      asOf: isoDateTimeSchema.nullable(),
      basis: financeFactBasisSchema,
      confidence: financeFactConfidenceSchema.nullable(),
      sourceRefs: z.array(materialSourceReferenceSchema).max(100),
      value: valueSchema.nullable(),
    })
    .strict();
export type FinanceFactEvidence<T> = {
  asOf: string | null;
  basis: FinanceFactBasis;
  confidence: FinanceFactConfidence | null;
  sourceRefs: z.infer<typeof materialSourceReferenceSchema>[];
  value: T | null;
};

export const financeActionKindSchema = z.enum([
  "categorization",
  "question",
  "recurring_obligation",
  "alert",
  "merchant",
  "budget_plan",
  "transaction",
  "income_stream",
  "profile",
  "transaction_breakdown",
  "reimbursement",
  "maintenance_turn",
]);
export type FinanceActionKind = z.infer<typeof financeActionKindSchema>;

const financeSafeChangeSchema = z
  .object({
    entityId: idSchema.nullable().default(null),
    entityType: z.string().trim().min(1).max(100),
    summary: z.string().trim().min(1).max(500),
  })
  .strict();
export type FinanceSafeChange = z.infer<typeof financeSafeChangeSchema>;

export const financeQuestionSchema = z
  .object({
    actionKind: financeActionKindSchema,
    choices: z
      .array(
        z
          .object({
            label: z.string().trim().min(1).max(240),
            value: z.string().trim().min(1).max(240),
          })
          .strict(),
      )
      .max(10)
      .default([]),
    id: idSchema,
    expectedAnswer: z
      .array(
        z
          .object({
            choices: z.array(z.string().trim().min(1).max(120)).max(10).optional(),
            example: z.string().trim().max(240).optional(),
            name: z.string().trim().min(1).max(80),
            nullable: z.boolean().default(false),
            required: z.boolean(),
            type: z.enum(["boolean", "number", "object_array", "string", "string_array"]),
          })
          .strict(),
      )
      .max(20)
      .default([]),
    prompt: z.string().trim().min(1).max(1_000),
    sourceRefs: z.array(materialSourceReferenceSchema).max(100).default([]),
    why: z.string().trim().min(1).max(1_000),
  })
  .strict();
export type FinanceQuestion = z.infer<typeof financeQuestionSchema>;

export const financeActionReviewStatusSchema = z.enum([
  "pending",
  "applied",
  "dismissed",
  "superseded",
]);
export type FinanceActionReviewStatus = z.infer<typeof financeActionReviewStatusSchema>;

/**
 * The human-safe projection of a prepared Finance action. Private payloads
 * remain in Finance storage and are deliberately absent from this schema.
 */
export const financeActionReviewSchema = z
  .object({
    actionKind: financeActionKindSchema,
    assumptions: z.array(z.string().trim().min(1).max(500)).max(25).default([]),
    changes: z.array(financeSafeChangeSchema).min(1).max(100),
    expectedRevision: z.string().trim().min(1).max(128).nullable().default(null),
    fingerprint: z.string().trim().min(1).max(128),
    id: idSchema,
    rationale: z.string().trim().min(1).max(4_000),
    requestedAt: isoDateTimeSchema,
    requestingAgentId: z.string().trim().min(1).max(160),
    runId: idSchema.nullable().default(null),
    sourceRefs: z.array(materialSourceReferenceSchema).max(100),
    status: financeActionReviewStatusSchema,
  })
  .strict();
export type FinanceActionReview = z.infer<typeof financeActionReviewSchema>;

/** Only an unresolved review may be returned as a pending action outcome. */
export const financePendingActionReviewSchema = financeActionReviewSchema.extend({
  status: z.literal("pending"),
});
export type FinancePendingActionReview = Omit<FinanceActionReview, "status"> & {
  status: "pending";
};

/** Internal prepared action; unlike a review it intentionally contains the private payload. */
export const financeAgentActionPayloadSchema = z
  .object({
    actionKind: financeActionKindSchema,
    expectedRevision: z.string().trim().min(1).max(128).nullable().default(null),
    fingerprint: z.string().trim().min(1).max(128),
    privatePayload: z.record(z.string(), z.unknown()),
    rationale: z.string().trim().min(1).max(4_000),
    requestingAgentId: z.string().trim().min(1).max(160),
    runId: idSchema.nullable().default(null),
    safeChanges: z.array(financeSafeChangeSchema).min(1).max(100),
    sourceRefs: z.array(materialSourceReferenceSchema).max(100),
  })
  .strict();
export type FinanceAgentActionPayload = z.infer<typeof financeAgentActionPayloadSchema>;

export const financeActionOutcomeSchema = <T extends z.ZodType>(resultSchema: T) =>
  z.discriminatedUnion("status", [
    z.object({ result: resultSchema, status: z.literal("applied") }).strict(),
    z
      .object({ review: financePendingActionReviewSchema, status: z.literal("pending_review") })
      .strict(),
    z.object({ question: financeQuestionSchema, status: z.literal("needs_input") }).strict(),
  ]);
export type FinanceActionOutcome<T> =
  | { result: T; status: "applied" }
  | { review: FinancePendingActionReview; status: "pending_review" }
  | { question: FinanceQuestion; status: "needs_input" };

/**
 * Stable preference keys used by the Finance guided interview. Unknown
 * primitive and string-array values remain valid so the shared profile
 * envelope can evolve without forcing Finance-specific storage.
 */
export const financeGuidedPreferencesSchema = z
  .object({
    billReviewLeadDays: z.number().int().min(0).max(90).optional(),
    budgetOffTrackForecastRatio: z.number().finite().gt(1).max(10).default(1.15),
    budgetStyle: z
      .enum(["category", "envelope", "flexible", "unspecified", "zero_based"])
      .optional(),
    budgetWatchForecastRatio: z.number().finite().gt(1).max(10).default(1.05),
    emergencyReserveTargetMonths: z.number().finite().positive().max(60).default(3),
    largeExpenseAlertAmount: moneySchema.positive().optional(),
    lowBalanceAlertAmount: moneySchema.optional(),
    planningCurrency: z.literal("USD").optional(),
    /** Percentage points, not a fraction: 20 means alert at a 20% amount change. */
    recurringAmountChangePercent: z.number().finite().min(0).max(100).optional(),
    reviewCadence: z.enum(["daily", "monthly", "on_change", "weekly"]).optional(),
    reviewConfidenceBelow: z.number().finite().min(0.5).max(1).optional(),
    reviewPendingTransactions: z.boolean().optional(),
    termForReviewQueue: z.string().trim().min(1).max(80).optional(),
    termForSpending: z.string().trim().min(1).max(80).optional(),
  })
  .catchall(
    z.union([
      z.boolean(),
      z.number(),
      z.string().max(500),
      z.array(z.string().max(500)).max(100),
      z.null(),
    ]),
  )
  .superRefine((value, context) => {
    if (value.budgetWatchForecastRatio >= value.budgetOffTrackForecastRatio) {
      context.addIssue({
        code: "custom",
        message: "The Finance budget watch ratio must be lower than the off-track ratio.",
        path: ["budgetWatchForecastRatio"],
      });
    }
    if (
      (value.largeExpenseAlertAmount !== undefined || value.lowBalanceAlertAmount !== undefined) &&
      value.planningCurrency !== "USD"
    ) {
      context.addIssue({
        code: "custom",
        message: "Finance amount thresholds currently require planningCurrency USD.",
        path: ["planningCurrency"],
      });
    }
  });
export type FinanceGuidedPreferences = z.infer<typeof financeGuidedPreferencesSchema>;

export const financeAccountSchema = z.object({
  balance: z.number().finite().nullable(),
  createdAt: isoDateTimeSchema,
  currencyCode: z
    .string()
    .regex(/^[A-Z]{3}$/u)
    .nullable()
    .default(null),
  id: idSchema,
  institution: z.string().min(1).max(160),
  kind: financeAccountKindSchema,
  lastSyncedAt: isoDateTimeSchema.nullable(),
  name: z.string().min(1).max(160),
  provider: financeProviderSchema,
  status: z.enum(["connected", "needs_reauth", "manual"]),
  synchronization: financeSynchronizationSchema,
  updatedAt: isoDateTimeSchema,
});
export type FinanceAccount = z.infer<typeof financeAccountSchema>;

export const financeWealthSummarySchema = z.object({
  /** Planning baseline: the effective stated income when available, otherwise observed trailing income. */
  annualIncome: moneySchema,
  cash: z.number().finite(),
  debt: moneySchema,
  incomeBasis: z.enum(["none", "observed", "stated"]),
  investments: z.number().finite(),
  monthlyIncome: moneySchema,
  monthlyPlanRemaining: z.number().finite().nullable(),
  netWorth: z.number().finite(),
  observedAnnualIncome: moneySchema,
  otherAssets: z.number().finite(),
  plannedThisMonth: moneySchema,
  statedAnnualIncome: moneySchema.nullable(),
});
export type FinanceWealthSummary = z.infer<typeof financeWealthSummarySchema>;

export const financePayFrequencySchema = z.enum([
  "biweekly",
  "irregular",
  "monthly",
  "semimonthly",
  "weekly",
]);
export const financeHousingStatusSchema = z.enum(["owning", "renting", "shared", "other"]);
export type FinanceHousingStatus = z.infer<typeof financeHousingStatusSchema>;
export const financeInvestmentRiskWillingnessSchema = z.enum([
  "conservative",
  "balanced",
  "growth",
]);
export type FinanceInvestmentRiskWillingness = z.infer<
  typeof financeInvestmentRiskWillingnessSchema
>;
export const financeInvestmentRiskCapacitySchema = z.enum(["low", "moderate", "high"]);
export type FinanceInvestmentRiskCapacity = z.infer<typeof financeInvestmentRiskCapacitySchema>;
export const financeProfileSchema = z.object({
  dependents: z.number().int().min(0).max(20).nullable().optional(),
  effectiveDate: z.iso.date(),
  employer: z.string().max(160).nullable(),
  employmentType: z
    .enum(["contract", "full_time", "part_time", "self_employed", "unemployed"])
    .nullable(),
  expectedNetPay: moneySchema.nullable(),
  grossAnnualIncome: moneySchema.nullable(),
  householdSize: z.number().int().min(1).max(50).nullable().optional(),
  housingStatus: financeHousingStatusSchema.nullable().optional(),
  investmentRiskCapacity: financeInvestmentRiskCapacitySchema.nullable().optional(),
  investmentRiskWillingness: financeInvestmentRiskWillingnessSchema.nullable().optional(),
  monthlyHousingCost: moneySchema.nullable().optional(),
  nextPayday: z.iso.date().nullable(),
  payAccountId: idSchema.nullable(),
  payFrequency: financePayFrequencySchema.nullable(),
  reserveTargetMonths: z.number().finite().positive().max(60).nullable().optional(),
  role: z.string().max(160).nullable(),
  updatedAt: isoDateTimeSchema,
});
export type FinanceProfile = z.infer<typeof financeProfileSchema>;

export const updateFinanceProfileInputSchema = z.object({
  dependents: z.number().int().min(0).max(20).nullable().optional(),
  effectiveDate: z.iso.date().default(() => new Date().toISOString().slice(0, 10)),
  employer: z.string().trim().max(160).nullable().default(null),
  employmentType: z
    .enum(["contract", "full_time", "part_time", "self_employed", "unemployed"])
    .nullable()
    .default(null),
  expectedNetPay: moneySchema.nullable().default(null),
  grossAnnualIncome: moneySchema.nullable().default(null),
  householdSize: z.number().int().min(1).max(50).nullable().optional(),
  housingStatus: financeHousingStatusSchema.nullable().optional(),
  investmentRiskCapacity: financeInvestmentRiskCapacitySchema.nullable().optional(),
  investmentRiskWillingness: financeInvestmentRiskWillingnessSchema.nullable().optional(),
  monthlyHousingCost: moneySchema.nullable().optional(),
  nextPayday: z.iso.date().nullable().default(null),
  payAccountId: idSchema.nullable().default(null),
  payFrequency: financePayFrequencySchema.nullable().default(null),
  reserveTargetMonths: z.number().finite().positive().max(60).nullable().optional(),
  role: z.string().trim().max(160).nullable().default(null),
});
export type UpdateFinanceProfileInput = z.infer<typeof updateFinanceProfileInputSchema>;

const financeBudgetPlanAllocationSchema = z.object({
  categoryId: idSchema,
  limit: moneySchema.positive(),
});
const noDuplicateIds = (values: string[]) => new Set(values).size === values.length;

export const setFinanceBudgetPlanInputSchema = z
  .object({
    allocations: z.array(financeBudgetPlanAllocationSchema).min(1).max(100),
    assumptions: z.array(z.string().trim().min(1).max(500)).max(25).default([]),
    goalIds: z.array(idSchema).max(25).default([]),
    month: financeMonthSchema,
    acknowledgeOverAllocation: z.boolean().default(false),
    rationale: z.string().trim().min(1).max(4_000),
    replace: z.boolean().default(true),
    scenarioFingerprint: z.string().max(128).nullable().default(null),
  })
  .superRefine((value, context) => {
    const categoryIds = value.allocations.map((allocation) => allocation.categoryId);
    if (!noDuplicateIds(categoryIds)) {
      context.addIssue({
        code: "custom",
        message: "Include each category only once in a Finance budget plan.",
        path: ["allocations"],
      });
    }
    if (!noDuplicateIds(value.goalIds)) {
      context.addIssue({
        code: "custom",
        message: "Include each goal only once in a Finance budget plan.",
        path: ["goalIds"],
      });
    }
  });
export type SetFinanceBudgetPlanInput = z.infer<typeof setFinanceBudgetPlanInputSchema>;

/** The accepted budget-plan shape is also the durable semantic action result. */
export const financeBudgetPlanSchema = setFinanceBudgetPlanInputSchema;
export type FinanceBudgetPlan = z.infer<typeof financeBudgetPlanSchema>;

const financeScenarioPlanSchema = z
  .object({
    assumptions: z.array(z.string().trim().min(1).max(500)).max(25).default([]),
    budgetAllocations: z.array(financeBudgetPlanAllocationSchema).max(100).default([]),
    label: z.string().trim().min(1).max(160),
    monthlyDebtPayment: moneySchema.default(0),
    monthlyHousingCost: moneySchema.default(0),
    monthlyIncome: moneySchema,
    monthlyReserveContribution: moneySchema.default(0),
    debtBalance: moneySchema.optional(),
    goalTarget: moneySchema.optional(),
    goalCurrent: moneySchema.optional(),
    startingCash: z.number().finite().min(-100_000_000).max(100_000_000),
  })
  .superRefine((value, context) => {
    if (!noDuplicateIds(value.budgetAllocations.map((allocation) => allocation.categoryId))) {
      context.addIssue({
        code: "custom",
        message: "Include each category only once in a Finance scenario budget.",
        path: ["budgetAllocations"],
      });
    }
  });

export const financeScenarioInputSchema = z.object({
  alternatives: z.array(financeScenarioPlanSchema).max(5),
  asOf: z.iso.date(),
  baseline: financeScenarioPlanSchema,
  horizonMonths: z.number().int().min(1).max(120),
});
export type FinanceScenarioInput = z.infer<typeof financeScenarioInputSchema>;

export const financeScenarioProjectionSchema = z.object({
  debtPayoffMonths: z.number().int().positive().nullable(),
  goalDateEffects: z.array(z.string().trim().min(1).max(500)).max(25),
  label: z.string().trim().min(1).max(160),
  monthlyCashFlow: z.number().finite(),
  projectedLowestBalance: z.number().finite(),
  reserveRunwayMonths: z.number().finite().nonnegative().nullable(),
});
export type FinanceScenarioProjection = z.infer<typeof financeScenarioProjectionSchema>;

export const financeScenarioResultSchema = z.object({
  alternatives: z.array(financeScenarioProjectionSchema).max(5),
  asOf: z.iso.date(),
  assumptions: z.array(z.string().trim().min(1).max(500)).max(150),
  baseline: financeScenarioProjectionSchema,
  fingerprint: z.string().trim().min(1).max(128),
  goalConflicts: z.array(z.string().trim().min(1).max(500)).max(25),
  missingInputs: z.array(z.string().trim().min(1).max(500)).max(25),
  sensitivityWarnings: z.array(z.string().trim().min(1).max(500)).max(25),
});
export type FinanceScenarioResult = z.infer<typeof financeScenarioResultSchema>;

const financeCadenceSchema = z.enum([
  "biweekly",
  "irregular",
  "monthly",
  "quarterly",
  "semimonthly",
  "weekly",
  "yearly",
]);
export const financeIncomeStreamSchema = z.object({
  accountId: idSchema.nullable(),
  cadence: financePayFrequencySchema,
  confidence: z.number().min(0).max(1),
  displayName: z.string(),
  expectedAmount: moneySchema,
  id: idSchema,
  lastObservedDate: z.iso.date().nullable(),
  nextExpectedDate: z.iso.date().nullable(),
  payer: z.string(),
  source: z.enum(["inferred", "user"]),
  status: z.enum(["active", "needs_review", "paused"]),
});
export type FinanceIncomeStream = z.infer<typeof financeIncomeStreamSchema>;
export const financeRecurringObligationSchema = z.object({
  accountId: idSchema.nullable(),
  cadence: financeCadenceSchema,
  confidence: z.number().min(0).max(1),
  displayName: z.string(),
  expectedAmount: moneySchema,
  id: idSchema,
  kind: z.enum(["bill", "savings", "subscription"]),
  lastObservedDate: z.iso.date().nullable(),
  merchant: z.string(),
  nextExpectedDate: z.iso.date().nullable(),
  source: z.enum(["inferred", "user"]),
  status: z.enum(["active", "cancelled", "needs_review", "paused"]),
});
export type FinanceRecurringObligation = z.infer<typeof financeRecurringObligationSchema>;
export const financeAlertSchema = z.object({
  body: z.string(),
  createdAt: isoDateTimeSchema,
  evidence: z.record(z.string(), z.unknown()),
  id: idSchema,
  recurringObligationId: idSchema.nullable(),
  severity: z.enum(["info", "warning"]),
  status: z.enum(["dismissed", "open", "resolved"]),
  title: z.string(),
  type: z.enum([
    "income_changed",
    "income_missing",
    "recurring_amount_changed",
    "recurring_missing",
    "subscription_price_changed",
  ]),
});
export type FinanceAlert = z.infer<typeof financeAlertSchema>;
export const financeForecastSchema = z.object({
  asOf: isoDateTimeSchema,
  lowestProjectedBalance: z.number().finite(),
  lowestProjectedDate: z.iso.date().nullable(),
  projectedBalanceAtNextPayday: z.number().finite().nullable(),
  safeToSpend: z.number().finite(),
  upcomingIncome: moneySchema,
  upcomingObligations: moneySchema,
});
export type FinanceForecast = z.infer<typeof financeForecastSchema>;
export const resolveFinanceAlertInputSchema = z.object({
  action: z.enum(["dismiss", "resolve"]),
  rationale: z.string().trim().max(1_000).nullable().default(null),
});
export type ResolveFinanceAlertInput = z.infer<typeof resolveFinanceAlertInputSchema>;
export const updateFinanceIncomeStreamInputSchema = z.object({
  status: z.enum(["active", "paused"]),
});
export type UpdateFinanceIncomeStreamInput = z.infer<typeof updateFinanceIncomeStreamInputSchema>;
export const updateFinanceRecurringObligationInputSchema = z.object({
  status: z.enum(["active", "cancelled", "paused"]),
});
export type UpdateFinanceRecurringObligationInput = z.infer<
  typeof updateFinanceRecurringObligationInputSchema
>;

export const financeTransactionSchema = z.object({
  amount: moneySchema,
  category: categorySchema.nullable(),
  categoryConfidence: z.number().min(0).max(1).nullable(),
  categoryId: idSchema.nullable().optional(),
  categoryRationale: z.string().max(1_000).nullable().optional(),
  categorySource: z.enum(["agent", "provider", "rule", "user"]).nullable().optional(),
  createdAt: isoDateTimeSchema,
  currencyCode: z
    .string()
    .regex(/^[A-Z]{3}$/u)
    .nullable()
    .default(null),
  date: z.iso.date(),
  direction: transactionDirectionSchema,
  id: idSchema,
  merchant: z.string().min(1).max(240),
  merchantId: idSchema.nullable().optional(),
  needsReview: z.boolean(),
  notes: z.string().max(4_000).nullable(),
  pending: z.boolean().optional(),
  providerCategory: z.string().max(120).nullable().optional(),
  providerCategoryConfidence: z
    .enum(["HIGH", "LOW", "MEDIUM", "UNKNOWN", "VERY_HIGH"])
    .nullable()
    .optional(),
  providerDirection: z.enum(["expense", "income"]).nullable().optional(),
  rawMerchant: z.string().min(1).max(240).optional(),
  reconciliationStatus: z.enum(["candidate", "confirmed", "matched", "not_applicable"]).optional(),
  accountId: idSchema,
  allocations: z
    .array(
      z
        .object({
          allocationOrder: z.number().int().nonnegative(),
          amount: moneySchema.positive(),
          categoryId: idSchema,
          id: idSchema,
          rationale: z.string().max(1_000).nullable(),
          revision: z.number().int().positive(),
          treatment: z.enum(["personal", "reimbursable"]),
        })
        .strict(),
    )
    .optional(),
  updatedAt: isoDateTimeSchema,
});
export type FinanceTransaction = z.infer<typeof financeTransactionSchema>;

export type FinanceTransactionAllocation = NonNullable<FinanceTransaction["allocations"]>[number];

export const financeCategorySchema = z.object({
  color: z.string().nullable(),
  group: z.string().min(1).max(80),
  id: idSchema,
  isSystem: z.boolean(),
  name: categorySchema,
  slug: z.string().min(1).max(80),
});
export type FinanceCategory = z.infer<typeof financeCategorySchema>;

export const financeMerchantSchema = z.object({
  aliases: z.array(z.string().min(1).max(240)),
  behavior: z.enum(["unknown", "consistent", "mixed"]).default("unknown"),
  displayName: z.string().min(1).max(240),
  id: idSchema,
  isUserConfirmed: z.boolean(),
});
export type FinanceMerchant = z.infer<typeof financeMerchantSchema>;

const financeAllocationInputSchema = z
  .object({
    amount: moneySchema.positive(),
    categoryId: idSchema,
    rationale: z.string().trim().min(1).max(1_000),
    treatment: z.enum(["personal", "reimbursable"]).default("personal"),
  })
  .strict()
  .superRefine((value, context) => {
    if (!Number.isInteger(value.amount * 100)) {
      context.addIssue({
        code: "custom",
        message: "Allocation amounts must be expressed in exact cents.",
        path: ["amount"],
      });
    }
  });

export const setFinanceTransactionBreakdownInputSchema = z
  .object({
    allocations: z.array(financeAllocationInputSchema).min(1).max(100),
    expectedTransactionUpdatedAt: isoDateTimeSchema,
    futureRule: z
      .object({
        categoryId: idSchema,
        rationale: z.string().trim().min(1).max(1_000),
      })
      .strict()
      .nullable()
      .default(null),
    rationale: z.string().trim().min(1).max(1_000),
  })
  .strict()
  .superRefine((value, context) => {
    const categoryIds = value.allocations.map((item) => item.categoryId);
    if (new Set(categoryIds).size !== categoryIds.length) {
      context.addIssue({
        code: "custom",
        message: "Use one allocation per category in a transaction breakdown.",
        path: ["allocations"],
      });
    }
    if (value.futureRule && !categoryIds.includes(value.futureRule.categoryId)) {
      context.addIssue({
        code: "custom",
        message: "A future merchant rule must be supported by an allocation in this breakdown.",
        path: ["futureRule", "categoryId"],
      });
    }
  });
export type SetFinanceTransactionBreakdownInput = z.input<
  typeof setFinanceTransactionBreakdownInputSchema
>;

export const financeMerchantQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export const updateFinanceMerchantInputSchema = z.object({
  displayName: z.string().trim().min(1).max(240),
});
export type UpdateFinanceMerchantInput = z.infer<typeof updateFinanceMerchantInputSchema>;

export const mergeFinanceMerchantsInputSchema = z
  .object({
    rationale: z.string().trim().min(1).max(1_000),
    sourceMerchantId: idSchema,
    targetMerchantId: idSchema,
  })
  .refine((value) => value.sourceMerchantId !== value.targetMerchantId, {
    message: "Choose two different merchants.",
  });
export type MergeFinanceMerchantsInput = z.infer<typeof mergeFinanceMerchantsInputSchema>;

export const financeReviewCaseSchema = z.object({
  createdAt: isoDateTimeSchema,
  id: idSchema,
  rationale: z.string().nullable(),
  reason: z.enum([
    "ambiguous_merchant",
    "low_confidence",
    "one_time",
    "possible_duplicate",
    "possible_transfer",
    "refund_or_reversal",
    "unknown_merchant",
  ]),
  status: z.enum(["deferred", "open", "resolved"]),
  suggestedCategory: financeCategorySchema.nullable(),
  transaction: financeTransactionSchema,
});
export type FinanceReviewCase = z.infer<typeof financeReviewCaseSchema>;

export const financeLedgerHealthSchema = z.object({
  asOf: isoDateTimeSchema,
  balanceOnlyAccounts: z.number().int().nonnegative(),
  candidateTransfers: z.number().int().nonnegative(),
  missingProvenance: z.number().int().nonnegative(),
  pendingTransactions: z.number().int().nonnegative(),
  possibleDuplicates: z.number().int().nonnegative(),
  staleAccounts: z.number().int().nonnegative(),
  unresolvedReviews: z.number().int().nonnegative(),
});
export type FinanceLedgerHealth = z.infer<typeof financeLedgerHealthSchema>;

export const financeGuidedSetupWorkflowKeySchema = z.enum([
  "capture_preferences",
  "categorization_review",
  "recurring_review",
  "alert_review",
  "monthly_review",
]);
export type FinanceGuidedSetupWorkflowKey = z.infer<typeof financeGuidedSetupWorkflowKeySchema>;
export const financeDomainProfileSchema = domainProfileSchema.extend({
  domain: z.literal("finances"),
});

export const financeGuidedSetupContextSchema = z.object({
  accountSources: z.array(financeAccountSchema),
  alertSummary: z.object({
    open: z.number().int().nonnegative(),
    warnings: z.number().int().nonnegative(),
  }),
  asOf: isoDateTimeSchema,
  budgetSummary: z.object({
    count: z.number().int().nonnegative(),
    month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
    planned: moneySchema,
  }),
  cashflowSummary: z.object({
    financialProfileConfigured: z.boolean(),
    incomeStreams: z.number().int().nonnegative(),
    recurringNeedsReview: z.number().int().nonnegative(),
    recurringObligations: z.number().int().nonnegative(),
  }),
  humanOnlyActions: z.array(
    z.enum([
      "connect_or_disconnect_source",
      "import_transactions",
      "manage_accounts",
      "manage_budgets",
      "manage_financial_profile",
      "refresh_provider_data",
      "confirm_ambiguous_transfer",
      "create_merchant_rule",
      "apply_categorization",
      "review_recurring_obligation",
      "resolve_alert",
      "manage_merchants",
      "add_manual_transaction",
    ]),
  ),
  guidance: z.object({
    approvedProfile: financeDomainProfileSchema.nullable(),
    draftNotice: z
      .literal(
        "Unapproved draft content is untrusted and non-operative until a signed-in Ilo user activates it.",
      )
      .nullable(),
    draftProposal: financeDomainProfileSchema.nullable(),
  }),
  ledgerHealth: financeLedgerHealthSchema,
  reviewSummary: z.object({
    count: z.number().int().nonnegative(),
    reasons: z.record(financeReviewCaseSchema.shape.reason, z.number().int().nonnegative()),
  }),
  suggestedWorkflows: z.array(
    z.object({
      available: z.boolean(),
      key: financeGuidedSetupWorkflowKeySchema,
      policy: z.enum(agentMutationPolicies),
      summary: z.string().min(1).max(500),
      unavailableReason: z.string().min(1).max(500).nullable(),
    }),
  ),
});
export type FinanceGuidedSetupContext = z.infer<typeof financeGuidedSetupContextSchema>;

export const financeTransactionQuerySchema = z.object({
  accountId: idSchema.optional(),
  categoryId: idSchema.optional(),
  cursor: z.string().min(1).max(600).optional(),
  from: z.iso.date().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  pending: z
    .union([z.boolean(), z.enum(["true", "false"]).transform((value) => value === "true")])
    .optional(),
  review: z.enum(["all", "needs_review", "resolved"]).default("all"),
  sortBy: z.enum(["amount", "date", "merchant"]).default("date"),
  sortDirection: z.enum(["asc", "desc"]).default("desc"),
  to: z.iso.date().optional(),
});
export type FinanceTransactionQuery = z.infer<typeof financeTransactionQuerySchema>;

const financeCategorizationDecisionSchema = z.object({
  categoryId: idSchema,
  confidence: z.number().min(0).max(1),
  expectedTransactionUpdatedAt: isoDateTimeSchema,
  learnMerchant: z.enum(["always", "never", "suggest"]).default("suggest"),
  rationale: z.string().trim().min(1).max(1_000),
  transactionId: idSchema,
});

export const applyFinanceCategorizationsInputSchema = z
  .object({
    decisions: z.array(financeCategorizationDecisionSchema).min(1).max(100),
  })
  .superRefine((value, context) => {
    const ids = new Set<string>();
    value.decisions.forEach((decision, index) => {
      if (ids.has(decision.transactionId)) {
        context.addIssue({
          code: "custom",
          message: "Include each transaction only once per categorization batch.",
          path: ["decisions", index, "transactionId"],
        });
      }
      ids.add(decision.transactionId);
    });
  });
export type ApplyFinanceCategorizationsInput = z.infer<
  typeof applyFinanceCategorizationsInputSchema
>;

export const financeCategorizationProposalSchema = z.object({
  confidence: z.number().min(0).max(1),
  meetsPolicyThreshold: z.boolean(),
  policy: z.literal("preview"),
  rationale: z.string().min(1).max(1_000),
  suggestionBasis: z.enum(["merchant_rule", "transaction_evidence"]).nullable().default(null),
  source: materialSourceReferenceSchema,
  suggestedCategory: financeCategorySchema.nullable(),
  threshold: z.number().min(0).max(1),
  transaction: financeTransactionSchema,
});
export type FinanceCategorizationProposal = z.infer<typeof financeCategorizationProposalSchema>;

export const upsertFinanceAttentionItemInputSchema = z.object({
  expiresAt: isoDateTimeSchema.nullable().default(null),
  importance: attentionItemImportanceSchema.default("high"),
  kind: attentionItemKindSchema
    .extract(["important", "upcoming", "follow_up"])
    .default("important"),
  occursAt: isoDateTimeSchema.nullable().default(null),
  summary: z.string().trim().min(1).max(4_000),
  title: z.string().trim().min(1).max(240),
});
export type UpsertFinanceAttentionItemInput = z.infer<typeof upsertFinanceAttentionItemInputSchema>;

export const financeCategorizationProposalPageSchema = z.object({
  items: z.array(financeCategorizationProposalSchema),
  nextCursor: z.string().min(1).max(600).nullable(),
});
export type FinanceCategorizationProposalPage = z.infer<
  typeof financeCategorizationProposalPageSchema
>;

export const financeCategorizationApplyResultSchema = z.object({
  applied: z.boolean(),
  error: z
    .object({
      code: z.string().min(1),
      message: z.string().min(1),
      requestId: z.string().min(1),
    })
    .nullable(),
  replayed: z.boolean(),
  status: z.enum(["applied", "failed", "review_required"]),
  threshold: z.number().min(0).max(1).nullable(),
  transaction: financeTransactionSchema.nullable(),
  transactionId: idSchema,
});
export type FinanceCategorizationApplyResult = z.infer<
  typeof financeCategorizationApplyResultSchema
>;

export const financeReviewDecisionInputSchema = z
  .object({
    action: z.enum(["approve", "confirm_transfer", "defer", "recategorize"]),
    categoryId: idSchema.optional(),
    confidence: z.number().min(0).max(1).optional(),
    expectedTransactionUpdatedAt: isoDateTimeSchema.optional(),
    learnMerchant: z.enum(["always", "never", "suggest"]).default("suggest"),
    nonTransferDirection: z.enum(["expense", "income"]).optional(),
    rationale: z.string().trim().max(1_000).nullable().default(null),
  })
  .superRefine((value, context) => {
    if (value.action !== "defer" && value.expectedTransactionUpdatedAt === undefined) {
      context.addIssue({
        code: "custom",
        message: "Resolving a Finance review requires the displayed transaction revision.",
        path: ["expectedTransactionUpdatedAt"],
      });
    }
    if (value.action === "recategorize" && value.categoryId === undefined) {
      context.addIssue({
        code: "custom",
        message: "Recategorizing a Finance review requires a category.",
        path: ["categoryId"],
      });
    }
  });
export type FinanceReviewDecisionInput = z.infer<typeof financeReviewDecisionInputSchema>;

export const financeBudgetSchema = z.object({
  category: categorySchema,
  createdAt: isoDateTimeSchema,
  id: idSchema,
  limit: moneySchema.positive(),
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  updatedAt: isoDateTimeSchema,
});
export type FinanceBudget = z.infer<typeof financeBudgetSchema>;

export const financeExportSchema = z.object({
  accounts: z.array(financeAccountSchema),
  asOf: isoDateTimeSchema,
  budgets: z.array(financeBudgetSchema),
  categories: z.array(financeCategorySchema),
  alerts: z.array(financeAlertSchema),
  incomeStreams: z.array(financeIncomeStreamSchema),
  profile: financeProfileSchema.nullable(),
  recurringObligations: z.array(financeRecurringObligationSchema),
  transactions: z.array(financeTransactionSchema),
});
export type FinanceExport = z.infer<typeof financeExportSchema>;

export const financeBudgetStatusSchema = z.object({
  budget: financeBudgetSchema,
  remaining: z.number().finite(),
  spent: z.number().finite(),
});
export type FinanceBudgetStatus = z.infer<typeof financeBudgetStatusSchema>;

export const financeBudgetStatusQuerySchema = z.object({
  month: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
    .optional(),
});

/** A calendar period used to compare actual spending with a budget's expected pace. */
export const financeBudgetPacePeriodSchema = z.enum(["week", "month", "year"]);
export type FinanceBudgetPacePeriod = z.infer<typeof financeBudgetPacePeriodSchema>;

export const financeBudgetPaceQuerySchema = z.object({
  period: financeBudgetPacePeriodSchema.default("week"),
});

export const financeBudgetPaceCellSchema = z.object({
  date: z.iso.date(),
  planned: moneySchema,
  spent: moneySchema,
  status: z.enum(["ahead", "behind", "neutral", "blank"]),
});
export type FinanceBudgetPaceCell = z.infer<typeof financeBudgetPaceCellSchema>;

/** Budget pace calculated through each displayed calendar day. */
export const financeBudgetPaceSchema = z.object({
  /** The newest day for which posted activity has been evaluated. */
  asOf: z.iso.date(),
  cells: z.array(financeBudgetPaceCellSchema),
  period: financeBudgetPacePeriodSchema,
});
export type FinanceBudgetPace = z.infer<typeof financeBudgetPaceSchema>;

export const createFinanceAccountInputSchema = z.object({
  balance: z.number().finite().nullable().default(null),
  institution: z.string().trim().min(1).max(160),
  kind: financeAccountKindSchema.optional(),
  name: z.string().trim().min(1).max(160),
  provider: financeProviderSchema.default("manual"),
});
export type CreateFinanceAccountInput = z.infer<typeof createFinanceAccountInputSchema>;

export const createFinanceTransactionInputSchema = z.object({
  accountId: idSchema,
  amount: moneySchema,
  category: categorySchema.nullable().default(null),
  categoryConfidence: z.number().min(0).max(1).nullable().default(null),
  date: z.iso.date(),
  direction: transactionDirectionSchema,
  merchant: z.string().trim().min(1).max(240),
  notes: z.string().trim().max(4_000).nullable().default(null),
});
export type CreateFinanceTransactionInput = z.infer<typeof createFinanceTransactionInputSchema>;

export const updateFinanceTransactionInputSchema = z
  .object({
    category: categorySchema.nullable().optional(),
    confidence: z.number().min(0).max(1).optional(),
    expectedTransactionUpdatedAt: isoDateTimeSchema.optional(),
    learnMerchant: z.boolean().optional(),
    notes: z.string().trim().max(4_000).nullable().optional(),
    rationale: z.string().trim().min(1).max(1_000).optional(),
    suggestionBasis: z.enum(["merchant_rule", "transaction_evidence"]).optional(),
  })
  .refine(
    (value) => value.category !== undefined || value.notes !== undefined,
    "Provide a category or note.",
  );
export type UpdateFinanceTransactionInput = z.infer<typeof updateFinanceTransactionInputSchema>;

export const createFinanceBudgetInputSchema = z.object({
  category: categorySchema,
  limit: moneySchema.positive(),
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
});
export type CreateFinanceBudgetInput = z.infer<typeof createFinanceBudgetInputSchema>;

export const exchangePlaidTokenInputSchema = z.object({
  institution: z.string().trim().min(1).max(160).nullable().default(null),
  publicToken: z.string().trim().min(1).max(2_000),
});
export type ExchangePlaidTokenInput = z.infer<typeof exchangePlaidTokenInputSchema>;

export const financeCsvImportInputSchema = z.object({
  accountId: idSchema,
  csv: z.string().min(1).max(1_000_000),
  provider: z.enum(["paypal", "venmo", "zelle"]),
});
export type FinanceCsvImportInput = z.infer<typeof financeCsvImportInputSchema>;

export const financeOverviewSchema = z.object({
  accounts: z.array(financeAccountSchema),
  budgets: z.array(financeBudgetSchema),
  reviewCount: z.number().int().nonnegative(),
  refundCreditsThisMonth: moneySchema,
  pendingSpendThisMonth: moneySchema,
  spendingThisMonth: moneySchema,
  transactions: z.array(financeTransactionSchema),
});
export type FinanceOverview = z.infer<typeof financeOverviewSchema>;
