import { createHash, randomUUID } from "node:crypto";
import {
  auditEvents,
  type Database,
  financeAccounts,
  financeAgentActionReviews,
  financeAlerts,
  financeAutomationSettings,
  financeBudgetBuckets,
  financeBudgetPlans,
  financeBudgets,
  financeCategories,
  financeCategoryRules,
  financeClassificationDecisions,
  financeIncomeStreams,
  financeMaintenanceCandidateItems,
  financeMaintenanceCandidates,
  financeMerchants,
  financeProfiles,
  financeRecurringObligations,
  financeReimbursementMatches,
  financeReimbursements,
  financeTransactionAllocations,
  financeTransactions,
  goals,
  workspaceMaintenanceRuns,
  workspaceMaintenanceSteps,
} from "@personal-os/database";
import {
  applyFinanceCategorizationsInputSchema,
  createFinanceBudgetInputSchema,
  createFinanceTransactionInputSchema,
  type FinanceActionKind,
  type FinanceActionOutcome,
  type FinanceActionReview,
  type FinanceMaintenanceCandidateItemDraft,
  type FinancePendingActionReview,
  type FinanceQuestion,
  type FinanceSafeChange,
  financeActionKindSchema,
  financeActionReviewSchema,
  financeMaintenanceCandidateItemDraftSchema,
  financeQuestionSchema,
  financeReimbursementQuestionAnswerSchema,
  idSchema,
  type MaterialSourceReference,
  manageFinanceBudgetBucketInputSchema,
  mergeFinanceMerchantsInputSchema,
  reconcileFinanceReimbursementInputSchema,
  resolveFinanceAlertInputSchema,
  setFinanceBudgetPlanInputSchema,
  setFinanceTransactionBreakdownInputSchema,
  toCents,
  updateFinanceIncomeStreamInputSchema,
  updateFinanceMerchantInputSchema,
  updateFinanceProfileInputSchema,
  updateFinanceRecurringObligationInputSchema,
  updateFinanceTransactionInputSchema,
} from "@personal-os/domain";
import { and, asc, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { auditValues } from "./audit.js";
import { AppError } from "./errors.js";
import {
  financeActionFingerprint,
  financeCandidateActionFingerprint,
  stableFinanceActionInput,
} from "./finance-action-identity.js";
import { evaluateMerchantEvidence } from "./finance-merchant-evidence.js";
import { reliableMonthlyCapacity } from "./finance-planning.js";
import {
  lockReimbursementCases,
  lockReimbursementMatches,
  lockReimbursementTopology,
} from "./finance-reimbursement-locks.js";
import { deriveReimbursementStatus } from "./finance-reimbursement-service.js";
import type { createFinanceService } from "./finance-service.js";
import type { Principal } from "./types.js";

type MutationContext = {
  principal: Principal;
  requestId: string;
};

export type SupportedActionKind = Extract<
  FinanceActionKind,
  | "alert"
  | "budget_plan"
  | "categorization"
  | "income_stream"
  | "merchant"
  | "profile"
  | "recurring_obligation"
  | "reimbursement"
  | "transaction"
  | "transaction_breakdown"
>;

type PreparedAction = {
  actionKind: SupportedActionKind;
  expectedRevision: string | null;
  fingerprint: string;
  input: Record<string, unknown>;
  rationale: string;
  safeChanges: FinanceSafeChange[];
  assumptions: string[];
  sourceRefs: MaterialSourceReference[];
  semanticTargetKeys: string[];
};

type StoredPayload = {
  input: Record<string, unknown>;
  rationale: string;
  result?: unknown;
  assumptions?: string[];
};

type FinanceActionServiceOptions = {
  db: Database;
  finances: ReturnType<typeof createFinanceService>;
  now: () => Date;
};

type FinanceExecutor = Pick<Database, "delete" | "execute" | "insert" | "select" | "update">;
type TransactionalWriter = (...args: unknown[]) => Promise<unknown>;

function snapshotRevision(value: unknown): string {
  return createHash("sha256").update(stableFinanceActionInput(value)).digest("hex");
}

function localSource(id: string, revision: string | null): MaterialSourceReference {
  return { accountId: null, provider: "local", remoteId: id, revision, sourceType: "local" };
}

export function normalizedMerchantRuleKey(merchant: string) {
  return merchant
    .toLowerCase()
    .replace(/[*#]\d+\b/g, " ")
    .replace(/\b\d{4,}\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function transactionSource(
  transaction: typeof financeTransactions.$inferSelect,
  account: typeof financeAccounts.$inferSelect,
): MaterialSourceReference {
  const provider = account.provider === "manual" ? "local" : account.provider;
  return {
    accountId: account.id,
    provider,
    remoteId: provider === "local" ? transaction.id : transaction.providerTransactionId,
    revision: transaction.updatedAt.toISOString(),
    sourceType: "finance_transaction",
  };
}

export function profileProjection(
  existing: typeof financeProfiles.$inferSelect | undefined,
  input: Record<string, unknown>,
): string {
  const before = existing ?? null;
  const changes: string[] = [];
  const field = (name: string, label: string, format = (value: unknown) => String(value)) => {
    const oldValue = before?.[name as keyof typeof before];
    const newValue = input[name];
    if (newValue === undefined || (oldValue ?? null) === (newValue ?? null)) return;
    changes.push(
      `${label} ${oldValue == null ? "unset" : format(oldValue)} → ${newValue == null ? "unset" : format(newValue)}`,
    );
  };
  const privateField = (name: string, label: string) => {
    if (
      input[name] !== undefined &&
      (input[name] ?? null) !== (before?.[name as keyof typeof before] ?? null)
    )
      changes.push(`${label} updated.`);
  };
  privateField("employer", "employer");
  privateField("role", "role");
  field("employmentType", "employment", (value) => String(value).replaceAll("_", " "));
  field("payFrequency", "pay frequency", (value) => String(value));
  field("nextPayday", "next payday");
  field("payAccountId", "pay account", (value) => (value == null ? "unset" : "selected account"));
  field("housingStatus", "housing status", (value) => String(value).replaceAll("_", " "));
  field("investmentRiskCapacity", "risk capacity", (value) => String(value).replaceAll("_", " "));
  field("investmentRiskWillingness", "risk willingness", (value) =>
    String(value).replaceAll("_", " "),
  );
  field("reserveTargetMonths", "reserve target", (value) =>
    value == null ? "unset" : `${String(value)} months`,
  );
  const moneyField = (name: string, label: string, beforeCents: number | null | undefined) => {
    const newValue = input[name];
    const oldValue = beforeCents == null ? null : beforeCents / 100;
    if (newValue === undefined || (oldValue ?? null) === (newValue ?? null)) return;
    const format = (value: number | null) => (value == null ? "unset" : `$${value.toFixed(2)}`);
    changes.push(`${label} ${format(oldValue)} → ${format(newValue as number | null)}`);
  };
  moneyField("expectedNetPay", "net pay", before?.expectedNetPay);
  moneyField("grossAnnualIncome", "annual income", before?.grossAnnualIncome);
  moneyField("monthlyHousingCost", "housing cost", before?.monthlyHousingCost);
  field("householdSize", "household size");
  field("dependents", "dependents");
  return `Update profile effective ${String(input.effectiveDate)}${changes.length ? `: ${changes.join("; ")}.` : "."}`;
}

function assertNever(value: never): never {
  throw new AppError("invalid_request", `Unsupported Finance action kind: ${String(value)}.`);
}

export function supportedActionKind(value: unknown): SupportedActionKind {
  const actionKind = financeActionKindSchema.parse(value);
  if (
    ![
      "alert",
      "budget_plan",
      "categorization",
      "income_stream",
      "merchant",
      "profile",
      "recurring_obligation",
      "reimbursement",
      "transaction",
      "transaction_breakdown",
    ].includes(actionKind)
  ) {
    throw new AppError("invalid_request", "The stored Finance action kind cannot be resumed.");
  }
  return actionKind as SupportedActionKind;
}
export function semanticTargetKeys(
  actionKind: SupportedActionKind,
  input: Record<string, unknown>,
) {
  const ids = (value: unknown) => (Array.isArray(value) ? value.map(String).sort() : []);
  switch (actionKind) {
    case "profile":
      return [`profile:${String(input.effectiveDate)}`];
    case "budget_plan":
      // A one-category budget changes the same monthly capacity and replacement
      // set as a complete plan. Keeping one key prevents cross-variant reviews
      // from being approved against stale budget-month state.
      return [
        "month" in input
          ? `budget-month:${String(input.month)}`
          : `finance-budget-buckets:${String(input.userId ?? "")}`,
      ];
    case "categorization":
      return ids(
        (input.decisions as Array<Record<string, unknown>> | undefined)?.map(
          (item) => item.transactionId,
        ),
      );
    case "merchant":
      return "sourceMerchantId" in input
        ? ids([input.sourceMerchantId, input.targetMerchantId]).map((id) => `merchant:${id}`)
        : [`merchant:${String(input.id)}`];
    case "recurring_obligation":
      return [`recurring:${String(input.id)}`];
    case "alert":
      return [input.operation === "refresh" ? "alert:refresh" : `alert:${String(input.id)}`];
    case "transaction":
      return [
        "accountId" in input
          ? `transaction-create:${String(input.accountId)}:${String(input.date)}:${String(input.merchant)}`
          : `transaction:${String(input.id)}`,
      ];
    case "transaction_breakdown":
      return [`transaction:${String(input.id)}`];
    case "income_stream":
      return [`income:${String(input.id)}`];
    case "reimbursement":
      return [
        input.operation === "create"
          ? `allocation:${String(input.allocationId)}`
          : `reimbursement:${String(input.reimbursementId)}`,
        ...(input.operation === "match_credit"
          ? [`credit:${String(input.creditTransactionId)}`]
          : []),
      ];
  }
}

type ExpectedAnswer = FinanceQuestion["expectedAnswer"][number];

function expectedAnswer(
  name: string,
  type: ExpectedAnswer["type"],
  options: Partial<Pick<ExpectedAnswer, "choices" | "example" | "nullable">> = {},
): ExpectedAnswer {
  const { nullable = false, ...metadata } = options;
  return { name, nullable, required: true, type, ...metadata };
}

const profileValidationAnswers: Record<string, ExpectedAnswer> = {
  dependents: expectedAnswer("dependents", "number", { example: "0 to 20", nullable: true }),
  effectiveDate: expectedAnswer("effectiveDate", "string", { example: "YYYY-MM-DD" }),
  employer: expectedAnswer("employer", "string", {
    example: "Up to 160 characters",
    nullable: true,
  }),
  employmentType: expectedAnswer("employmentType", "string", {
    choices: ["contract", "full_time", "part_time", "self_employed", "unemployed"],
    nullable: true,
  }),
  expectedNetPay: expectedAnswer("expectedNetPay", "number", {
    example: "0 to 100000000",
    nullable: true,
  }),
  grossAnnualIncome: expectedAnswer("grossAnnualIncome", "number", {
    example: "0 to 100000000",
    nullable: true,
  }),
  householdSize: expectedAnswer("householdSize", "number", { example: "1 to 50", nullable: true }),
  housingStatus: expectedAnswer("housingStatus", "string", {
    choices: ["owning", "renting", "shared", "other"],
    nullable: true,
  }),
  investmentRiskCapacity: expectedAnswer("investmentRiskCapacity", "string", {
    choices: ["low", "moderate", "high"],
    nullable: true,
  }),
  investmentRiskWillingness: expectedAnswer("investmentRiskWillingness", "string", {
    choices: ["conservative", "balanced", "growth"],
    nullable: true,
  }),
  monthlyHousingCost: expectedAnswer("monthlyHousingCost", "number", {
    example: "0 to 100000000",
    nullable: true,
  }),
  nextPayday: expectedAnswer("nextPayday", "string", { example: "YYYY-MM-DD", nullable: true }),
  payAccountId: expectedAnswer("payAccountId", "string", { example: "Account ID", nullable: true }),
  payFrequency: expectedAnswer("payFrequency", "string", {
    choices: ["biweekly", "irregular", "monthly", "semimonthly", "weekly"],
    nullable: true,
  }),
  reserveTargetMonths: expectedAnswer("reserveTargetMonths", "number", {
    example: "More than 0 to 60",
    nullable: true,
  }),
  role: expectedAnswer("role", "string", { example: "Up to 160 characters", nullable: true }),
};

function profileValidationAnswer(input: Record<string, unknown>): ExpectedAnswer {
  const parsed = updateFinanceProfileInputSchema.safeParse(input);
  const field = parsed.success
    ? null
    : parsed.error.issues.find((issue) => typeof issue.path[0] === "string")?.path[0];
  const fallback = profileValidationAnswers.effectiveDate;
  if (!fallback) throw new Error("Finance profile validation descriptors are incomplete.");
  return (typeof field === "string" ? profileValidationAnswers[field] : undefined) ?? fallback;
}

export function isExpectedAnswerValue(field: ExpectedAnswer, value: unknown): boolean {
  if (value === null) return field.nullable;
  const valid = (() => {
    switch (field.type) {
      case "boolean":
        return typeof value === "boolean";
      case "number":
        return typeof value === "number" && Number.isFinite(value);
      case "object":
        return value !== null && typeof value === "object" && !Array.isArray(value);
      case "object_array":
        return (
          Array.isArray(value) &&
          value.every((item) => item !== null && typeof item === "object" && !Array.isArray(item))
        );
      case "string":
        return typeof value === "string" && value.trim().length > 0;
      case "string_array":
        return (
          Array.isArray(value) &&
          value.every((item) => typeof item === "string" && item.trim().length > 0)
        );
    }
  })();
  if (!valid) return false;
  if (!field.choices) return true;
  if (field.type === "string") return typeof value === "string" && field.choices.includes(value);
  return (
    field.type === "string_array" &&
    Array.isArray(value) &&
    value.every((item) => typeof item === "string" && field.choices?.includes(item))
  );
}

function question(
  actionKind: SupportedActionKind,
  why: string,
  expectedAnswer: ExpectedAnswer[],
): FinanceQuestion {
  return {
    actionKind,
    choices: [],
    expectedAnswer,
    id: randomUUID(),
    prompt: "Please provide the missing Finance evidence before this change is applied.",
    sourceRefs: [],
    why,
  };
}

function reviewFromRow(row: typeof financeAgentActionReviews.$inferSelect): FinanceActionReview {
  const payload = row.privatePayload as StoredPayload;
  return financeActionReviewSchema.parse({
    actionKind: row.actionKind,
    assumptions: payload.assumptions ?? [],
    changes: row.safeChanges,
    expectedRevision: row.expectedRevision,
    fingerprint: row.fingerprint,
    id: row.id,
    rationale: payload.rationale,
    requestedAt: row.createdAt.toISOString(),
    requestingAgentId: row.requestingAgentId,
    runId: row.maintenanceRunId,
    sourceRefs: row.sourceRefs,
    status: row.status,
  });
}

function questionFromRow(row: typeof financeAgentActionReviews.$inferSelect): FinanceQuestion {
  const payload = row.privatePayload as { question: FinanceQuestion };
  return financeQuestionSchema.parse({ ...payload.question, id: row.id });
}

/**
 * Separates Finance semantic preparation from its eventual disposition. The
 * only source of bypass authority is the persisted Finance settings row.
 */
export function createFinanceActionService({ db, finances, now }: FinanceActionServiceOptions) {
  async function prepare(
    actionKind: SupportedActionKind,
    rawInput: Record<string, unknown>,
    userId: string,
    executor: Pick<Database, "execute" | "select"> = db,
    lockTargets = false,
    actorType: Principal["actorType"] = "agent",
  ): Promise<PreparedAction | { status: "needs_input"; question: FinanceQuestion }> {
    const missing = (
      why: string,
      expected: ExpectedAnswer[],
      sourceRefs: MaterialSourceReference[] = [],
    ) => ({
      question: { ...question(actionKind, why, expected), sourceRefs },
      status: "needs_input" as const,
    });
    const parse = <T>(schema: {
      safeParse: (value: unknown) => { success: boolean; data?: T };
    }) => {
      const parsed = schema.safeParse(rawInput);
      return parsed.success ? parsed.data : null;
    };
    // Revalidation runs in the terminal transaction. Lock every owned record
    // that contributes to the prepared decision before its revision is
    // compared, and retain those locks through the writer and review update.
    // The cast keeps preparation usable with the root read executor, where a
    // lock is deliberately never requested.
    const lockRead = <T>(query: T): T =>
      lockTargets ? (query as { for: (strength: "update") => T }).for("update") : query;
    const lockAccounts = async (accountIds: string[]) => {
      const ids = [...new Set(accountIds)].sort();
      if (!ids.length) return [] as Array<typeof financeAccounts.$inferSelect>;
      return lockRead(
        executor
          .select()
          .from(financeAccounts)
          .where(and(eq(financeAccounts.userId, userId), inArray(financeAccounts.id, ids)))
          .orderBy(financeAccounts.id),
      );
    };
    const row = async <T>(query: PromiseLike<T[]>, why: string, expected: ExpectedAnswer[]) => {
      const item = (await query)[0];
      return item ?? missing(why, expected);
    };
    const prepared = (
      input: Record<string, unknown>,
      expectedRevision: string | null,
      safeChanges: FinanceSafeChange[],
      sourceRefs: MaterialSourceReference[],
      assumptions: string[] = [],
    ): PreparedAction => ({
      actionKind,
      assumptions,
      expectedRevision,
      fingerprint: financeActionFingerprint(actionKind, input),
      input,
      rationale:
        typeof input.rationale === "string" && input.rationale.trim()
          ? input.rationale
          : `Requested ${actionKind.replaceAll("_", " ")} change.`,
      safeChanges,
      semanticTargetKeys: semanticTargetKeys(
        actionKind,
        actionKind === "budget_plan" ? { ...input, userId } : input,
      ),
      // Public review projections are capped by the domain contract; the
      // complete private input remains available for transactional revalidation.
      sourceRefs: sourceRefs.slice(0, 100),
    });

    switch (actionKind) {
      case "profile": {
        const input = parse<Record<string, unknown>>(updateFinanceProfileInputSchema);
        if (!input)
          return missing("Provide a complete valid Finance profile.", [
            profileValidationAnswer(rawInput),
          ]);
        const account = input.payAccountId
          ? await row(
              lockRead(
                executor
                  .select()
                  .from(financeAccounts)
                  .where(
                    and(
                      eq(financeAccounts.id, String(input.payAccountId)),
                      eq(financeAccounts.userId, userId),
                    ),
                  )
                  .orderBy(financeAccounts.id)
                  .limit(1),
              ),
              "Choose one of your Finance accounts for pay deposits.",
              [expectedAnswer("payAccountId", "string")],
            )
          : null;
        if (account && "question" in account) return account;
        const existing = await lockRead(
          executor
            .select()
            .from(financeProfiles)
            .where(
              and(
                eq(financeProfiles.userId, userId),
                eq(financeProfiles.effectiveDate, String(input.effectiveDate)),
              ),
            )
            .orderBy(financeProfiles.id)
            .limit(1),
        );
        const revision = existing[0]?.updatedAt.toISOString() ?? "absent";
        return prepared(
          input,
          revision,
          [
            {
              entityId: existing[0]?.id ?? null,
              entityType: "finance_profile",
              summary: profileProjection(existing[0], input),
            },
          ],
          [
            localSource(`profile:${String(input.effectiveDate)}`, revision),
            ...(account ? [localSource(account.id, account.updatedAt.toISOString())] : []),
          ],
        );
      }
      case "budget_plan": {
        const bucketInput = parse<Record<string, unknown>>(manageFinanceBudgetBucketInputSchema);
        if (!bucketInput && rawInput.operation === "update")
          return missing(
            rawInput.expectedVersion === undefined
              ? "Provide the budget bucket version before updating it."
              : "Provide a complete budget bucket update.",
            [expectedAnswer("bucketId", "string"), expectedAnswer("expectedVersion", "number")],
          );
        if (!bucketInput && rawInput.operation === "create")
          return missing("Provide a complete budget bucket to create.", [
            expectedAnswer("name", "string"),
          ]);
        if (bucketInput) {
          const existing =
            bucketInput.operation === "update"
              ? await lockRead(
                  executor
                    .select()
                    .from(financeBudgetBuckets)
                    .where(
                      and(
                        eq(financeBudgetBuckets.id, String(bucketInput.bucketId)),
                        eq(financeBudgetBuckets.userId, userId),
                      ),
                    )
                    .limit(1),
                )
              : [];
          const row = existing[0];
          if (bucketInput.operation === "update" && !row)
            return missing("The budget bucket was not found.", [
              expectedAnswer("bucketId", "string"),
              expectedAnswer("expectedVersion", "number"),
            ]);
          return prepared(
            bucketInput,
            row?.updatedAt.toISOString() ?? "absent",
            [
              {
                entityId: row?.id ?? null,
                entityType: "finance_budget_bucket",
                summary: `${bucketInput.operation === "create" ? "Create" : "Update"} budget bucket.`,
              },
            ],
            row ? [localSource(row.id, row.updatedAt.toISOString())] : [],
          );
        }
        const plan = parse<Record<string, unknown>>(setFinanceBudgetPlanInputSchema);
        if (plan) {
          const allocations = plan.allocations as Array<{ categoryId: string; limit: number }>;
          const categoryIds = allocations.map((item) => item.categoryId);
          const categories = await lockRead(
            executor
              .select()
              .from(financeCategories)
              .where(
                and(
                  eq(financeCategories.userId, userId),
                  inArray(financeCategories.id, categoryIds),
                ),
              )
              .orderBy(financeCategories.id),
          );
          if (categories.length !== categoryIds.length)
            return missing("Every budget allocation must reference one of your categories.", [
              expectedAnswer("allocations", "object_array", { example: "[...]" }),
            ]);
          const goalIds = plan.goalIds as string[];
          const ownedGoals = goalIds.length
            ? await lockRead(
                executor
                  .select()
                  .from(goals)
                  .where(and(eq(goals.userId, userId), inArray(goals.id, goalIds)))
                  .orderBy(goals.id),
              )
            : [];
          if (ownedGoals.length !== goalIds.length)
            return missing("Every budget-plan goal must belong to you.", [
              expectedAnswer("goalIds", "string_array", { example: "[...]" }),
            ]);
          const planRows = await lockRead(
            executor
              .select()
              .from(financeBudgetPlans)
              .where(
                and(
                  eq(financeBudgetPlans.userId, userId),
                  eq(financeBudgetPlans.month, String(plan.month)),
                ),
              )
              .orderBy(financeBudgetPlans.id)
              .limit(1),
          );
          const currentBudgets = await lockRead(
            executor
              .select()
              .from(financeBudgets)
              .where(
                and(
                  eq(financeBudgets.userId, userId),
                  eq(financeBudgets.month, String(plan.month)),
                ),
              )
              .orderBy(financeBudgets.id),
          );
          const [effectiveProfile] = await lockRead(
            executor
              .select()
              .from(financeProfiles)
              .where(
                and(
                  eq(financeProfiles.userId, userId),
                  sql`${financeProfiles.effectiveDate} <= ${`${String(plan.month)}-31`}`,
                ),
              )
              .orderBy(desc(financeProfiles.effectiveDate), financeProfiles.id)
              .limit(1),
          );
          const payAccountId =
            typeof rawInput.payAccountId === "string"
              ? rawInput.payAccountId
              : effectiveProfile?.payAccountId;
          const payAccount = payAccountId
            ? await row(
                lockRead(
                  executor
                    .select()
                    .from(financeAccounts)
                    .where(
                      and(eq(financeAccounts.id, payAccountId), eq(financeAccounts.userId, userId)),
                    )
                    .orderBy(financeAccounts.id)
                    .limit(1),
                ),
                "The effective Finance profile pay account is unavailable.",
                [expectedAnswer("payAccountId", "string")],
              )
            : null;
          if (payAccount && "question" in payAccount) return payAccount;
          const obligations = await lockRead(
            executor
              .select()
              .from(financeRecurringObligations)
              .where(
                and(
                  eq(financeRecurringObligations.userId, userId),
                  eq(financeRecurringObligations.status, "active"),
                ),
              )
              .orderBy(financeRecurringObligations.id),
          );
          const capacity = reliableMonthlyCapacity({
            expectedNetPay:
              effectiveProfile?.expectedNetPay == null
                ? null
                : effectiveProfile.expectedNetPay / 100,
            expectedNetPayFrequency: effectiveProfile?.payFrequency ?? null,
            grossAnnualIncome:
              effectiveProfile?.grossAnnualIncome == null
                ? null
                : effectiveProfile.grossAnnualIncome / 100,
            observedMonthlyIncome: null,
            recurring: obligations.map((item) => ({
              amount: item.expectedAmount / 100,
              cadence: item.cadence,
            })),
          });
          const total = allocations.reduce((sum, allocation) => sum + allocation.limit, 0);
          if (capacity !== null && total > capacity && !plan.acknowledgeOverAllocation)
            return missing(
              "Budget allocations exceed reliable monthly income. Acknowledge the intentional over-allocation to continue.",
              [expectedAnswer("acknowledgeOverAllocation", "boolean")],
            );
          const revision = snapshotRevision({
            plan: planRows.map((item) => [item.id, item.version, item.updatedAt.toISOString()]),
            budgets: currentBudgets.map((item) => [
              item.id,
              item.category,
              item.limit,
              item.updatedAt.toISOString(),
            ]),
            categories: categories.map((item) => [item.id, item.updatedAt.toISOString()]).sort(),
            goals: ownedGoals.map((item) => [item.id, item.updatedAt.toISOString()]).sort(),
            profile: effectiveProfile
              ? [effectiveProfile.id, effectiveProfile.updatedAt.toISOString()]
              : null,
            payAccount: payAccount ? [payAccount.id, payAccount.updatedAt.toISOString()] : null,
            obligations: obligations.map((item) => [item.id, item.updatedAt.toISOString()]),
          });
          const incomingCategoryNames = new Set(categories.map((category) => category.name));
          const existingDetails = currentBudgets.map((budget) => {
            const disposition =
              plan.replace === true
                ? incomingCategoryNames.has(budget.category)
                  ? "replaced"
                  : "removed"
                : "retained";
            return `${budget.category} $${(budget.limit / 100).toFixed(2)} → ${disposition}`;
          });
          const boundedExistingDetails = existingDetails.slice(0, 3).join("; ").slice(0, 220);
          const existingSummary = currentBudgets.length
            ? ` Existing ${currentBudgets.length} allocation${currentBudgets.length === 1 ? "" : "s"}: ${boundedExistingDetails}${currentBudgets.length > 3 ? "; additional allocations omitted" : ""}.`
            : " No existing allocations.";
          return prepared(
            {
              ...plan,
              ...(typeof rawInput.payAccountId === "string"
                ? { payAccountId: rawInput.payAccountId }
                : {}),
            },
            revision,
            allocations.map((item, index) => ({
              entityId: item.categoryId,
              entityType: "finance_budget",
              summary: `${index === 0 ? `Replace ${String(plan.replace)}.${existingSummary} ` : ""}Set ${String(plan.month)} ${categories.find((category) => category.id === item.categoryId)?.name ?? "selected category"} allocation to $${item.limit.toFixed(2)} (${allocations.length} allocations).`,
            })),
            [
              ...categories.map((item) => localSource(item.id, item.updatedAt.toISOString())),
              ...ownedGoals.map((item) => localSource(item.id, item.updatedAt.toISOString())),
              ...currentBudgets.map((item) => localSource(item.id, item.updatedAt.toISOString())),
              ...(effectiveProfile
                ? [localSource(effectiveProfile.id, effectiveProfile.updatedAt.toISOString())]
                : []),
              ...(payAccount
                ? [localSource(payAccount.id, payAccount.updatedAt.toISOString())]
                : []),
              ...obligations.map((item) => localSource(item.id, item.updatedAt.toISOString())),
            ],
            (plan.assumptions as string[]) ?? [],
          );
        }
        const input = parse<Record<string, unknown>>(createFinanceBudgetInputSchema);
        if (!input)
          return missing("Provide a complete Finance budget or complete monthly budget plan.", [
            expectedAnswer("category", "string"),
            expectedAnswer("limit", "number"),
            expectedAnswer("month", "string", { example: "2026-08" }),
          ]);
        const existing = await lockRead(
          executor
            .select()
            .from(financeBudgets)
            .where(
              and(
                eq(financeBudgets.userId, userId),
                eq(financeBudgets.month, String(input.month)),
                eq(financeBudgets.category, String(input.category)),
              ),
            )
            .orderBy(financeBudgets.id)
            .limit(1),
        );
        const revision = existing[0]?.updatedAt.toISOString() ?? "absent";
        return prepared(
          input,
          revision,
          [
            {
              entityId: existing[0]?.id ?? null,
              entityType: "finance_budget",
              summary: `Set ${String(input.category)} budget to $${Number(input.limit).toFixed(2)} for ${String(input.month)}.`,
            },
          ],
          [localSource(`budget:${String(input.month)}:${String(input.category)}`, revision)],
        );
      }
      case "categorization": {
        const input = parse<Record<string, unknown>>(applyFinanceCategorizationsInputSchema);
        if (!input)
          return missing(
            "Each categorization needs a valid transaction, category, rationale, confidence, and displayed revision.",
            [expectedAnswer("decisions", "object_array", { example: "[...]" })],
          );
        const decisions = input.decisions as Array<{
          transactionId: string;
          categoryId: string;
          expectedTransactionUpdatedAt: string;
          rationale: string;
        }>;
        // Account deletion locks accounts before it locks their transactions.
        // Read the account references without locks, then retain account locks
        // in ID order before taking transaction locks. The second transaction
        // read below is the locked, authoritative snapshot used to decide.
        const transactionAccounts = await executor
          .select({ accountId: financeTransactions.accountId, id: financeTransactions.id })
          .from(financeTransactions)
          .where(
            and(
              eq(financeTransactions.userId, userId),
              inArray(
                financeTransactions.id,
                decisions.map((item) => item.transactionId),
              ),
            ),
          )
          .orderBy(financeTransactions.id);
        if (transactionAccounts.length !== decisions.length)
          return missing("Every categorization must target one of your transactions.", [
            expectedAnswer("decisions", "object_array", { example: "[...]" }),
          ]);
        const accounts = await lockAccounts(transactionAccounts.map((item) => item.accountId));
        if (accounts.length !== new Set(transactionAccounts.map((item) => item.accountId)).size)
          return missing("A transaction account is unavailable.", [
            expectedAnswer("decisions", "object_array", { example: "[...]" }),
          ]);
        const transactions = await lockRead(
          executor
            .select()
            .from(financeTransactions)
            .where(
              and(
                eq(financeTransactions.userId, userId),
                inArray(
                  financeTransactions.id,
                  decisions.map((item) => item.transactionId),
                ),
              ),
            )
            .orderBy(financeTransactions.id),
        );
        if (transactions.length !== decisions.length)
          return missing("Every categorization must target one of your transactions.", [
            expectedAnswer("decisions", "object_array", { example: "[...]" }),
          ]);
        if (
          transactions.some(
            (item) =>
              item.updatedAt.toISOString() !==
              decisions.find((decision) => decision.transactionId === item.id)
                ?.expectedTransactionUpdatedAt,
          )
        )
          return missing(
            "A transaction changed; refresh the categorization evidence before applying it.",
            [expectedAnswer("decisions", "object_array", { example: "[...]" })],
          );
        const categories = await lockRead(
          executor
            .select()
            .from(financeCategories)
            .where(
              and(
                eq(financeCategories.userId, userId),
                inArray(
                  financeCategories.id,
                  decisions.map((item) => item.categoryId),
                ),
              ),
            )
            .orderBy(financeCategories.id),
        );
        if (categories.length !== new Set(decisions.map((item) => item.categoryId)).size)
          return missing("Every categorization must use one of your categories.", [
            expectedAnswer("decisions", "object_array", { example: "[...]" }),
          ]);
        const sourceRefs: MaterialSourceReference[] = [];
        for (const item of transactions) {
          const account = accounts.find((candidate) => candidate.id === item.accountId);
          if (!account)
            return missing("A transaction account is unavailable.", [
              expectedAnswer("decisions", "object_array", { example: "[...]" }),
            ]);
          sourceRefs.push(transactionSource(item, account));
        }
        if (!(await finances.validatePreparedCategorizations(input as never, userId, executor)))
          return missing(
            "The categorization evidence is incomplete, low-confidence, or protected as an ambiguous transfer.",
            [expectedAnswer("decisions", "object_array", { example: "[...]" })],
          );
        return prepared(
          input,
          snapshotRevision(
            transactions.map((item) => [item.id, item.updatedAt.toISOString()]).sort(),
          ),
          transactions.map((item) => ({
            entityId: item.id,
            entityType: "finance_transaction",
            summary: `Categorize ${item.merchant} as ${categories.find((category) => category.id === decisions.find((decision) => decision.transactionId === item.id)?.categoryId)?.name ?? "selected category"}.`,
          })),
          sourceRefs,
        );
      }
      case "merchant": {
        const merge = parse<Record<string, unknown>>(mergeFinanceMerchantsInputSchema);
        const input = merge ?? parse<Record<string, unknown>>(updateFinanceMerchantInputSchema);
        const ids = merge
          ? [String(merge.sourceMerchantId), String(merge.targetMerchantId)]
          : [String(rawInput.id ?? "")];
        if (!input || ids.some((id) => !id))
          return missing(
            "Provide a valid merchant change and merchant ID.",
            "sourceMerchantId" in rawInput || "targetMerchantId" in rawInput
              ? [
                  expectedAnswer("sourceMerchantId", "string"),
                  expectedAnswer("targetMerchantId", "string"),
                  expectedAnswer("rationale", "string"),
                ]
              : [expectedAnswer("id", "string"), expectedAnswer("displayName", "string")],
          );
        const merchants = await lockRead(
          executor
            .select()
            .from(financeMerchants)
            .where(and(eq(financeMerchants.userId, userId), inArray(financeMerchants.id, ids)))
            .orderBy(financeMerchants.id),
        );
        if (merchants.length !== ids.length)
          return missing(
            "Choose only merchants that belong to you.",
            merge
              ? [
                  expectedAnswer("sourceMerchantId", "string"),
                  expectedAnswer("targetMerchantId", "string"),
                ]
              : [expectedAnswer("id", "string")],
          );
        const revision = snapshotRevision(
          merchants.map((item) => [item.id, item.updatedAt.toISOString()]).sort(),
        );
        const sourceMerchant = merge
          ? merchants.find((merchant) => merchant.id === String(merge.sourceMerchantId))
          : null;
        const targetMerchant = merge
          ? merchants.find((merchant) => merchant.id === String(merge.targetMerchantId))
          : null;
        return prepared(
          { ...input, ...(merge ? {} : { id: ids[0] }) },
          revision,
          merge
            ? [
                {
                  entityId: ids[0] ?? null,
                  entityType: "finance_merchant",
                  summary: `Merge ${sourceMerchant?.displayName ?? "source merchant"} into ${targetMerchant?.displayName ?? "target merchant"}.`,
                },
              ]
            : [
                {
                  entityId: ids[0] ?? null,
                  entityType: "finance_merchant",
                  summary: `Rename ${merchants[0]?.displayName ?? "merchant"} to ${String(input.displayName)}.`,
                },
              ],
          merchants.map((item) => localSource(item.id, item.updatedAt.toISOString())),
        );
      }
      case "recurring_obligation": {
        const input = parse<Record<string, unknown>>(updateFinanceRecurringObligationInputSchema);
        const id = typeof rawInput.id === "string" ? rawInput.id : "";
        if (!input || !id)
          return missing("Provide a valid recurring-obligation ID and status.", [
            expectedAnswer("id", "string"),
            expectedAnswer("status", "string", { choices: ["active", "cancelled", "paused"] }),
          ]);
        const item = await row(
          lockRead(
            executor
              .select()
              .from(financeRecurringObligations)
              .where(
                and(
                  eq(financeRecurringObligations.id, id),
                  eq(financeRecurringObligations.userId, userId),
                ),
              )
              .orderBy(financeRecurringObligations.id)
              .limit(1),
          ),
          "Choose one of your recurring obligations.",
          [expectedAnswer("id", "string")],
        );
        if ("question" in item) return item;
        return prepared(
          { ...input, id },
          item.updatedAt.toISOString(),
          [
            {
              entityId: item.id,
              entityType: "finance_recurring_obligation",
              summary: `Set ${item.displayName} to ${String(input.status)}.`,
            },
          ],
          [localSource(item.id, item.updatedAt.toISOString())],
        );
      }
      case "alert": {
        if (rawInput.operation === "refresh") {
          const alerts = await lockRead(
            executor
              .select()
              .from(financeAlerts)
              .where(eq(financeAlerts.userId, userId))
              .orderBy(financeAlerts.id),
          );
          return prepared(
            { operation: "refresh" },
            snapshotRevision(alerts.map((item) => [item.id, item.updatedAt.toISOString()]).sort()),
            [
              {
                entityId: null,
                entityType: "finance_alert",
                summary: "Refresh Finance cash-flow insights.",
              },
            ],
            alerts.map((item) => localSource(item.id, item.updatedAt.toISOString())),
          );
        }
        const input = parse<Record<string, unknown>>(resolveFinanceAlertInputSchema);
        const id = typeof rawInput.id === "string" ? rawInput.id : "";
        if (!input || !id)
          return missing("Provide a valid Finance alert ID and resolution.", [
            expectedAnswer("id", "string"),
            expectedAnswer("action", "string", { choices: ["dismiss", "resolve"] }),
          ]);
        const item = await row(
          lockRead(
            executor
              .select()
              .from(financeAlerts)
              .where(and(eq(financeAlerts.id, id), eq(financeAlerts.userId, userId)))
              .orderBy(financeAlerts.id)
              .limit(1),
          ),
          "Choose one of your Finance alerts.",
          [expectedAnswer("id", "string")],
        );
        if ("question" in item) return item;
        return prepared(
          { ...input, id },
          item.updatedAt.toISOString(),
          [
            {
              entityId: item.id,
              entityType: "finance_alert",
              summary: `${String(input.action) === "dismiss" ? "Dismiss" : "Resolve"} ${item.title}.`,
            },
          ],
          [localSource(item.id, item.updatedAt.toISOString())],
        );
      }
      case "transaction": {
        const create = parse<Record<string, unknown>>(createFinanceTransactionInputSchema);
        if (create) {
          const account = await row(
            lockRead(
              executor
                .select()
                .from(financeAccounts)
                .where(
                  and(
                    eq(financeAccounts.id, String(create.accountId)),
                    eq(financeAccounts.userId, userId),
                  ),
                )
                .orderBy(financeAccounts.id)
                .limit(1),
            ),
            "Choose one of your Finance accounts.",
            [expectedAnswer("accountId", "string")],
          );
          if ("question" in account) return account;
          return prepared(
            create,
            account.updatedAt.toISOString(),
            [
              {
                entityId: null,
                entityType: "finance_transaction",
                summary: `Create ${String(create.direction)} transaction for $${Number(create.amount).toFixed(2)} at ${String(create.merchant)}.`,
              },
            ],
            [localSource(account.id, account.updatedAt.toISOString())],
          );
        }
        const input = parse<Record<string, unknown>>(updateFinanceTransactionInputSchema);
        const id = typeof rawInput.id === "string" ? rawInput.id : "";
        if (!id)
          return missing("Provide the transaction ID to update.", [expectedAnswer("id", "string")]);
        if (!input)
          return missing(
            "Provide a valid transaction category or note change.",
            "category" in rawInput
              ? [expectedAnswer("category", "string")]
              : [expectedAnswer("notes", "string")],
          );
        // Keep the same account-before-transaction order as account deletion.
        // This preliminary read never decides the action; it only determines
        // which stable account rows must be locked first.
        const transactionAccounts = await executor
          .select({ accountId: financeTransactions.accountId, id: financeTransactions.id })
          .from(financeTransactions)
          .where(and(eq(financeTransactions.id, id), eq(financeTransactions.userId, userId)))
          .orderBy(financeTransactions.id)
          .limit(1);
        if (!transactionAccounts[0])
          return missing("Choose one of your Finance transactions.", [
            expectedAnswer("id", "string"),
          ]);
        const accounts = await lockAccounts([transactionAccounts[0].accountId]);
        const account = accounts[0];
        if (!account)
          return missing("The transaction account is unavailable.", [
            expectedAnswer("id", "string"),
          ]);
        const item = await row(
          lockRead(
            executor
              .select()
              .from(financeTransactions)
              .where(and(eq(financeTransactions.id, id), eq(financeTransactions.userId, userId)))
              .orderBy(financeTransactions.id)
              .limit(1),
          ),
          "Choose one of your Finance transactions.",
          [expectedAnswer("id", "string")],
        );
        if ("question" in item) return item;
        if (item.accountId !== account.id)
          return missing("The transaction account is unavailable.", [
            expectedAnswer("id", "string"),
          ]);
        if (actorType === "agent" && input.category !== undefined) {
          const categoryName = typeof input.category === "string" ? input.category : null;
          const confidence = typeof input.confidence === "number" ? input.confidence : null;
          const expectedTransactionUpdatedAt =
            typeof input.expectedTransactionUpdatedAt === "string"
              ? input.expectedTransactionUpdatedAt
              : null;
          const rationale = typeof input.rationale === "string" ? input.rationale : null;
          if (
            categoryName === null ||
            confidence === null ||
            expectedTransactionUpdatedAt === null ||
            rationale === null
          )
            return missing(
              "Agent transaction categorization needs a category, evidence confidence, displayed revision, and rationale.",
              [
                expectedAnswer("category", "string"),
                expectedAnswer("confidence", "number"),
                expectedAnswer("expectedTransactionUpdatedAt", "string"),
                expectedAnswer("rationale", "string"),
              ],
              [transactionSource(item, account)],
            );
          const [category] = await lockRead(
            executor
              .select()
              .from(financeCategories)
              .where(
                and(eq(financeCategories.userId, userId), eq(financeCategories.name, categoryName)),
              )
              .orderBy(financeCategories.id)
              .limit(1),
          );
          if (!category)
            return missing("Choose one of your Finance categories.", [
              expectedAnswer("category", "string"),
            ]);
          const learnMerchant: "always" | "suggest" =
            input.learnMerchant === true ? "always" : "suggest";
          const decision = {
            categoryId: category.id,
            confidence,
            expectedTransactionUpdatedAt,
            learnMerchant,
            rationale,
            transactionId: item.id,
          };
          const suggestionBasis = await finances.preparedCategorizationBasis(
            decision,
            userId,
            executor,
          );
          if (!suggestionBasis)
            return missing(
              "The transaction categorization evidence is incomplete, low-confidence, stale, or protected as an ambiguous transfer.",
              [
                expectedAnswer("category", "string"),
                expectedAnswer("confidence", "number"),
                expectedAnswer("expectedTransactionUpdatedAt", "string"),
                expectedAnswer("rationale", "string"),
              ],
              [transactionSource(item, account)],
            );
          return prepared(
            { ...input, id, suggestionBasis },
            item.updatedAt.toISOString(),
            [
              {
                entityId: item.id,
                entityType: "finance_transaction",
                summary: `Set ${item.merchant} category to ${String(input.category)}.`,
              },
            ],
            [transactionSource(item, account)],
          );
        }
        return prepared(
          { ...input, id },
          item.updatedAt.toISOString(),
          [
            {
              entityId: item.id,
              entityType: "finance_transaction",
              summary:
                input.category !== undefined
                  ? `Set ${item.merchant} category to ${String(input.category)}.`
                  : `Update note for ${item.merchant}.`,
            },
          ],
          [transactionSource(item, account)],
        );
      }
      case "transaction_breakdown": {
        const { id: rawId, ...body } = rawInput;
        const id = idSchema.safeParse(rawId);
        const input = setFinanceTransactionBreakdownInputSchema.safeParse(body);
        if (!id.success || !input.success)
          return missing("Provide a transaction ID and exact transaction allocations.", [
            expectedAnswer("id", "string"),
            expectedAnswer("allocations", "object_array", { example: "[...]" }),
            expectedAnswer("expectedTransactionUpdatedAt", "string"),
            expectedAnswer("rationale", "string"),
          ]);
        // Lock in the same account-before-transaction order as transaction
        // updates and account deletion. This is the authoritative snapshot for
        // both queueing and revalidation.
        const transactionAccounts = await executor
          .select({ accountId: financeTransactions.accountId })
          .from(financeTransactions)
          .where(and(eq(financeTransactions.id, id.data), eq(financeTransactions.userId, userId)))
          .limit(1);
        const accountId = transactionAccounts[0]?.accountId;
        if (!accountId)
          return missing("Choose one of your Finance transactions.", [
            expectedAnswer("id", "string"),
          ]);
        const [account] = await lockAccounts([accountId]);
        if (!account)
          return missing("The transaction account is unavailable.", [
            expectedAnswer("id", "string"),
          ]);
        const item = await row(
          lockRead(
            executor
              .select()
              .from(financeTransactions)
              .where(
                and(
                  eq(financeTransactions.id, id.data),
                  eq(financeTransactions.userId, userId),
                  eq(financeTransactions.accountId, account.id),
                ),
              )
              .orderBy(financeTransactions.id)
              .limit(1),
          ),
          "Choose one of your Finance transactions.",
          [expectedAnswer("id", "string")],
        );
        if ("question" in item) return item;
        if (item.pending)
          return missing("Pending transactions cannot receive a final breakdown.", [
            expectedAnswer("id", "string"),
          ]);
        if (item.updatedAt.toISOString() !== input.data.expectedTransactionUpdatedAt) {
          return missing(
            "The displayed transaction revision is stale. Refresh it before setting a breakdown.",
            [expectedAnswer("expectedTransactionUpdatedAt", "string")],
          );
        }
        const allocationCents = input.data.allocations.map((allocation) =>
          toCents(allocation.amount),
        );
        if (allocationCents.reduce((sum, amount) => sum + amount, 0) !== item.amount) {
          return missing(
            "Transaction allocation amounts must sum exactly to the transaction amount.",
            [expectedAnswer("allocations", "object_array", { example: "[...]" })],
            [transactionSource(item, account)],
          );
        }
        const allocationCategoryIds = [
          ...new Set(input.data.allocations.map((allocation) => allocation.categoryId)),
        ];
        const categories = await lockRead(
          executor
            .select({ id: financeCategories.id, name: financeCategories.name })
            .from(financeCategories)
            .where(
              and(
                eq(financeCategories.userId, userId),
                inArray(financeCategories.id, allocationCategoryIds),
              ),
            )
            .orderBy(financeCategories.id),
        );
        if (categories.length !== allocationCategoryIds.length) {
          return missing("Every transaction allocation category must belong to you.", [
            expectedAnswer("allocations", "object_array", { example: "[...]" }),
          ]);
        }
        const categoryById = new Map(categories.map((category) => [category.id, category]));
        const futureRule = input.data.futureRule;
        if (futureRule) {
          const proposedCategoryIds = new Set(
            input.data.allocations.map((allocation) => allocation.categoryId),
          );
          if (proposedCategoryIds.size !== 1 || !proposedCategoryIds.has(futureRule.categoryId)) {
            return missing(
              "A reusable merchant rule requires a single-category breakdown; keep this mixed split one-off.",
              [expectedAnswer("futureRule", "string", { nullable: true })],
              [transactionSource(item, account)],
            );
          }
          if (!item.merchantId)
            return missing(
              "A reusable merchant rule needs an identified merchant; save this as a one-off breakdown instead.",
              [expectedAnswer("futureRule", "string", { nullable: true })],
              [transactionSource(item, account)],
            );
          const [merchant] = await lockRead(
            executor
              .select()
              .from(financeMerchants)
              .where(
                and(eq(financeMerchants.id, item.merchantId), eq(financeMerchants.userId, userId)),
              )
              .limit(1),
          );
          if (!merchant)
            return missing("The reusable-rule merchant is no longer available.", [
              expectedAnswer("futureRule", "string", { nullable: true }),
            ]);
          const decisions = await lockRead(
            executor
              .select({
                categoryName: financeClassificationDecisions.categoryName,
                outcome: financeClassificationDecisions.outcome,
              })
              .from(financeClassificationDecisions)
              .where(
                and(
                  eq(financeClassificationDecisions.userId, userId),
                  eq(financeClassificationDecisions.merchantId, merchant.id),
                  inArray(financeClassificationDecisions.outcome, ["confirmed", "corrected"]),
                ),
              )
              .orderBy(financeClassificationDecisions.id),
          );
          const evaluation = evaluateMerchantEvidence({
            behavior: merchant.behavior,
            merchantName: merchant.displayName,
            observations: decisions.map((decision) => ({
              category: decision.categoryName,
              outcome: decision.outcome as "confirmed" | "corrected",
            })),
          });
          const category = categoryById.get(futureRule.categoryId);
          if (
            !category ||
            !evaluation.merchantOnlyEligible ||
            evaluation.category !== category.name
          ) {
            return missing(
              "This merchant history is not eligible for a reusable rule. Keep the breakdown one-off or provide a separately reviewed merchant rule.",
              [expectedAnswer("futureRule", "string", { nullable: true })],
              [
                transactionSource(item, account),
                localSource(merchant.id, merchant.updatedAt.toISOString()),
              ],
            );
          }
          const merchantRuleKey = normalizedMerchantRuleKey(item.merchant);
          const [existingRule] = await lockRead(
            executor
              .select()
              .from(financeCategoryRules)
              .where(
                and(
                  eq(financeCategoryRules.userId, userId),
                  eq(financeCategoryRules.merchantNormalized, merchantRuleKey),
                ),
              )
              .limit(1),
          );
          const base = prepared(
            { ...input.data, id: id.data },
            snapshotRevision({
              merchant: [merchant.id, merchant.updatedAt.toISOString(), merchant.behavior],
              rule: existingRule
                ? [existingRule.id, existingRule.category, existingRule.updatedAt.toISOString()]
                : null,
              transaction: item.updatedAt.toISOString(),
            }),
            [
              {
                entityId: item.id,
                entityType: "finance_transaction",
                summary: `Set ${item.merchant} transaction breakdown with ${input.data.allocations.length} allocations.`,
              },
              {
                entityId: existingRule?.id ?? null,
                entityType: "finance_category_rule",
                summary: existingRule
                  ? `Replace reusable ${merchant.displayName} rule from ${existingRule.category} to ${category.name}; future merchant transactions only, with stated rationale.`
                  : `Create reusable ${merchant.displayName} rule for ${category.name}; future merchant transactions only, with stated rationale.`,
              },
            ],
            [
              transactionSource(item, account),
              localSource(merchant.id, merchant.updatedAt.toISOString()),
            ],
            ["Future rule is limited to this normalized merchant and is evidence-backed."],
          );
          return {
            ...base,
            semanticTargetKeys: [...base.semanticTargetKeys, `merchant-rule:${merchantRuleKey}`],
          };
        }
        return prepared(
          { ...input.data, id: id.data },
          item.updatedAt.toISOString(),
          [
            {
              entityId: item.id,
              entityType: "finance_transaction",
              summary: `Set ${item.merchant} transaction breakdown with ${input.data.allocations.length} allocations.`,
            },
          ],
          [transactionSource(item, account)],
        );
      }
      case "reimbursement": {
        if (lockTargets) await lockReimbursementTopology(executor, userId);
        // Maintenance reimbursement questions are deliberately not a loose
        // continuation of the generic action input.  The only caller-supplied
        // value is the bounded typed answer; candidate identity and source
        // provenance remain in the private question payload.
        if (rawInput.operation === "answer_question") {
          const answer = financeReimbursementQuestionAnswerSchema.safeParse(rawInput.answer);
          const candidate = rawInput.candidate;
          const sourceRefs = rawInput.sourceRefs;
          if (
            !answer.success ||
            !candidate ||
            typeof candidate !== "object" ||
            Array.isArray(candidate) ||
            !Array.isArray(sourceRefs)
          )
            return missing("Provide one complete reimbursement answer.", [
              expectedAnswer("answer", "object"),
            ]);
          const privateCandidate = candidate as Record<string, unknown>;
          const transactionId =
            typeof privateCandidate.transactionId === "string"
              ? privateCandidate.transactionId
              : null;
          if (!transactionId)
            return missing("The reimbursement question no longer has a valid transaction.", []);
          const reimbursementIds = Array.isArray(privateCandidate.reimbursementIds)
            ? privateCandidate.reimbursementIds.filter((id): id is string => typeof id === "string")
            : [];
          // Shared lock order starts with the named reimbursement cases before
          // this question locks its account and transaction below.
          const prelockedCases = await lockReimbursementCases(
            executor,
            userId,
            reimbursementIds,
            lockTargets,
          );
          if (reimbursementIds.length && prelockedCases.length !== new Set(reimbursementIds).size)
            return missing("One of the reimbursement cases is no longer available.", [
              expectedAnswer("answer", "object"),
            ]);
          const [unlockedTransaction] = await executor
            .select({ accountId: financeTransactions.accountId })
            .from(financeTransactions)
            .where(
              and(
                eq(financeTransactions.id, transactionId),
                eq(financeTransactions.userId, userId),
              ),
            )
            .limit(1);
          if (!unlockedTransaction)
            return missing("The reimbursement transaction is no longer available.", []);
          const [account] = await lockAccounts([unlockedTransaction.accountId]);
          const [transaction] = await lockRead(
            executor
              .select()
              .from(financeTransactions)
              .where(
                and(
                  eq(financeTransactions.id, transactionId),
                  eq(financeTransactions.userId, userId),
                  eq(financeTransactions.accountId, unlockedTransaction.accountId),
                ),
              )
              .limit(1),
          );
          if (!transaction || !account)
            return missing("The reimbursement transaction account is no longer available.", []);
          const canonicalSource = transactionSource(transaction, account);
          const source = (sourceRefs as MaterialSourceReference[]).find(
            (item) =>
              item.accountId === canonicalSource.accountId &&
              item.provider === canonicalSource.provider &&
              item.remoteId === canonicalSource.remoteId &&
              item.revision === canonicalSource.revision &&
              item.sourceType === canonicalSource.sourceType,
          );
          if (!source)
            return missing(
              "The reimbursement evidence changed after this question was created. Refresh the evidence before answering.",
              [expectedAnswer("answer", "object")],
              [transactionSource(transaction, account)],
            );
          const commonInput = {
            answer: answer.data,
            candidate: privateCandidate,
            operation: "answer_question" as const,
            sourceRefs: [transactionSource(transaction, account)],
          };
          const allocationIds = Array.isArray(privateCandidate.allocationIds)
            ? privateCandidate.allocationIds.filter((id): id is string => typeof id === "string")
            : [];
          if (allocationIds.length > 0) {
            if (answer.data.kind === "not_sure")
              return missing(
                "The expense still needs a personal or reimbursement decision.",
                [expectedAnswer("answer", "object")],
                [transactionSource(transaction, account)],
              );
            if (answer.data.kind !== "entirely_personal" && answer.data.kind !== "reimbursable")
              return missing("Choose an expense reimbursement answer for this expense.", [
                expectedAnswer("answer", "object"),
              ]);
            const allocations = await lockRead(
              executor
                .select()
                .from(financeTransactionAllocations)
                .where(
                  and(
                    eq(financeTransactionAllocations.userId, userId),
                    eq(financeTransactionAllocations.transactionId, transaction.id),
                    eq(financeTransactionAllocations.state, "active"),
                    inArray(financeTransactionAllocations.id, [...new Set(allocationIds)].sort()),
                  ),
                )
                .orderBy(
                  financeTransactionAllocations.allocationOrder,
                  financeTransactionAllocations.id,
                ),
            );
            const existingCases = await lockRead(
              executor
                .select({ allocationId: financeReimbursements.allocationId })
                .from(financeReimbursements)
                .where(
                  and(
                    eq(financeReimbursements.userId, userId),
                    inArray(financeReimbursements.allocationId, [...new Set(allocationIds)].sort()),
                    inArray(financeReimbursements.status, [
                      "expected",
                      "partially_received",
                      "overdue",
                      "needs_input",
                    ]),
                  ),
                )
                .orderBy(financeReimbursements.id),
            );
            if (existingCases.length)
              return missing(
                "This expense already has an active reimbursement case. Adjust or cancel that case through reimbursement reconciliation instead.",
                [expectedAnswer("answer", "object")],
                [canonicalSource],
              );
            if (
              allocations.length !== new Set(allocationIds).size ||
              allocations.some((item) => item.amount <= 0) ||
              allocations.reduce((sum, item) => sum + item.amount, 0) !== transaction.amount
            )
              return missing(
                "The original expense allocations changed; refresh before recording reimbursement evidence.",
                [expectedAnswer("answer", "object")],
                [transactionSource(transaction, account)],
              );
            const categories = await lockRead(
              executor
                .select()
                .from(financeCategories)
                .where(
                  and(
                    eq(financeCategories.userId, userId),
                    inArray(
                      financeCategories.id,
                      [...new Set(allocations.map((item) => item.categoryId))].sort(),
                    ),
                  ),
                )
                .orderBy(financeCategories.id),
            );
            if (categories.length !== new Set(allocations.map((item) => item.categoryId)).size)
              return missing("The expense allocation category is no longer available.", [
                expectedAnswer("answer", "object"),
              ]);
            if (allocations.length !== 1)
              return missing(
                "This expense has a multi-allocation breakdown. Confirm its reimbursement share with a fresh, explicit allocation breakdown.",
                [expectedAnswer("answer", "object")],
                [transactionSource(transaction, account)],
              );
            const amount = answer.data.kind === "reimbursable" ? toCents(answer.data.amount) : 0;
            if (amount > transaction.amount)
              return missing("The reimbursement cannot exceed the posted expense amount.", [
                expectedAnswer("answer", "object"),
              ]);
            const revision = snapshotRevision({
              allocations: allocations.map((item) => [
                item.id,
                item.revision,
                item.updatedAt.toISOString(),
              ]),
              categories: categories.map((item) => [item.id, item.name]),
              transaction: [transaction.id, transaction.updatedAt.toISOString()],
            });
            const plan = {
              allocationIds: allocations.map((item) => item.id),
              allocations: allocations.map((item) => ({
                allocationOrder: item.allocationOrder,
                categoryId: item.categoryId,
                rationale: item.rationale,
                treatment: item.treatment,
              })),
              amount,
              categoryId: allocations[0]?.categoryId,
              kind: answer.data.kind,
              transactionId: transaction.id,
            };
            const base = prepared(
              { ...commonInput, plan },
              revision,
              [
                {
                  entityId: transaction.id,
                  entityType: "finance_transaction",
                  summary:
                    answer.data.kind === "entirely_personal"
                      ? "Record that the expense is entirely personal."
                      : "Record the expense reimbursement and retain only its personal remainder.",
                },
              ],
              [transactionSource(transaction, account)],
              ["The answer is recorded as person-provided reimbursement evidence."],
            );
            return {
              ...base,
              semanticTargetKeys: [
                `account:${account.id}`,
                `transaction:${transaction.id}`,
                ...allocations.map((item) => `allocation:${item.id}`),
              ].sort(),
            };
          }
          if (reimbursementIds.length > 0) {
            if (answer.data.kind === "not_sure")
              return missing("The incoming credit still needs a reimbursement decision.", [
                expectedAnswer("answer", "object"),
              ]);
            if (answer.data.kind !== "not_reimbursement" && answer.data.kind !== "match")
              return missing("Choose a credit reimbursement answer for this incoming credit.", [
                expectedAnswer("answer", "object"),
              ]);
            if (transaction.pending || transaction.direction !== "income")
              return missing("The reimbursement credit must remain a posted income transaction.", [
                expectedAnswer("answer", "object"),
              ]);
            const cases = prelockedCases;
            const allMatches = await lockReimbursementMatches(
              executor,
              userId,
              {
                creditTransactionIds: [transaction.id],
                reimbursementIds: cases.map((item) => item.id),
              },
              lockTargets,
            );
            const matches = allMatches.filter((item) =>
              cases.some((entry) => entry.id === item.reimbursementId),
            );
            const creditMatches = allMatches.filter(
              (item) => item.creditTransactionId === transaction.id,
            );
            if (answer.data.kind === "match") {
              const requested = answer.data.matches;
              const uniqueIds = new Set(requested.map((item) => item.reimbursementId));
              if (
                uniqueIds.size !== requested.length ||
                requested.some(
                  (item) =>
                    !uniqueIds.has(item.reimbursementId) ||
                    !reimbursementIds.includes(item.reimbursementId),
                )
              )
                return missing(
                  "Match only the reimbursement cases named in this question, once each.",
                  [expectedAnswer("answer", "object")],
                );
              const caseById = new Map(cases.map((item) => [item.id, item]));
              const receivedByCase = new Map<string, number>();
              for (const match of matches)
                receivedByCase.set(
                  match.reimbursementId,
                  (receivedByCase.get(match.reimbursementId) ?? 0) + match.amount,
                );
              const requestedCents = requested.reduce((sum, item) => sum + toCents(item.amount), 0);
              const usedCredit = creditMatches.reduce((sum, item) => sum + item.amount, 0);
              if (
                requestedCents + usedCredit > transaction.amount ||
                requested.some((item) => {
                  const current = caseById.get(item.reimbursementId);
                  return (
                    !current ||
                    current.status === "cancelled" ||
                    toCents(item.amount) >
                      current.expectedAmount - (receivedByCase.get(current.id) ?? 0)
                  );
                })
              )
                return missing(
                  "The credit or reimbursement case no longer has the requested remaining amount.",
                  [expectedAnswer("answer", "object")],
                );
            }
            const revision = snapshotRevision({
              cases: cases.map((item) => [item.id, item.revision, item.updatedAt.toISOString()]),
              credit: [transaction.id, transaction.updatedAt.toISOString()],
              matches: [...matches, ...creditMatches].map((item) => [
                item.id,
                item.reimbursementId,
                item.creditTransactionId,
                item.amount,
              ]),
            });
            const base = prepared(
              {
                ...commonInput,
                plan: {
                  creditTransactionId: transaction.id,
                  kind: answer.data.kind,
                  matches: answer.data.kind === "match" ? answer.data.matches : [],
                  reimbursementIds: cases.map((item) => item.id),
                },
              },
              revision,
              [
                {
                  entityId: transaction.id,
                  entityType: "finance_transaction",
                  summary:
                    answer.data.kind === "not_reimbursement"
                      ? "Record that this income credit is not a reimbursement."
                      : "Match this credit to the selected reimbursement cases.",
                },
              ],
              [transactionSource(transaction, account)],
              ["The answer is recorded as person-provided reimbursement evidence."],
            );
            return {
              ...base,
              semanticTargetKeys: [
                `account:${account.id}`,
                `transaction:${transaction.id}`,
                ...cases.map((item) => `reimbursement:${item.id}`),
              ].sort(),
            };
          }
          return missing("The reimbursement question no longer has a supported candidate.", []);
        }
        const input = reconcileFinanceReimbursementInputSchema.safeParse(rawInput);
        if (!input.success)
          return missing("Provide a valid reimbursement operation and its current revision.", [
            expectedAnswer("operation", "string", {
              choices: ["create", "match_credit", "cancel"],
            }),
          ]);
        if (
          input.data.operation === "create" &&
          actorType === "agent" &&
          input.data.evidence.sourceRefs.length === 0
        )
          return missing(
            "Provide bounded evidence for the expected reimbursement before proposing it.",
            [expectedAnswer("evidence", "object_array", { example: "[{ source: 'receipt' }]" })],
          );
        const allocationId =
          input.data.operation === "create" ? input.data.allocationId : undefined;
        const preliminary = allocationId
          ? (
              await executor
                .select()
                .from(financeTransactionAllocations)
                .where(
                  and(
                    eq(financeTransactionAllocations.id, allocationId),
                    eq(financeTransactionAllocations.userId, userId),
                  ),
                )
                .limit(1)
            )[0]
          : undefined;
        const existing =
          input.data.operation === "create"
            ? []
            : await executor
                .select()
                .from(financeReimbursements)
                .where(
                  and(
                    eq(financeReimbursements.id, input.data.reimbursementId),
                    eq(financeReimbursements.userId, userId),
                  ),
                )
                .limit(1);
        const reimbursement = existing[0];
        const resolvedAllocationId = allocationId ?? reimbursement?.allocationId;
        if (!resolvedAllocationId)
          return missing("Choose one of your owned reimbursements or reimbursable allocations.", [
            expectedAnswer("reimbursementId", "string"),
          ]);
        const allocation =
          preliminary ??
          (
            await lockRead(
              executor
                .select()
                .from(financeTransactionAllocations)
                .where(
                  and(
                    eq(financeTransactionAllocations.id, resolvedAllocationId),
                    eq(financeTransactionAllocations.userId, userId),
                  ),
                )
                .limit(1),
            )
          )[0];
        if (allocation?.state !== "active" || allocation.treatment !== "reimbursable")
          return missing("Choose an active reimbursable allocation that belongs to you.", [
            expectedAnswer("allocationId", "string"),
          ]);
        const [expense] = await executor
          .select()
          .from(financeTransactions)
          .where(
            and(
              eq(financeTransactions.id, allocation.transactionId),
              eq(financeTransactions.userId, userId),
            ),
          )
          .limit(1);
        let credit: typeof financeTransactions.$inferSelect | undefined;
        if (input.data.operation === "match_credit") {
          [credit] = await executor
            .select()
            .from(financeTransactions)
            .where(
              and(
                eq(financeTransactions.id, input.data.creditTransactionId),
                eq(financeTransactions.userId, userId),
              ),
            )
            .limit(1);
        }
        if (!expense || (input.data.operation === "match_credit" && !credit))
          return missing("Choose owned posted transaction evidence for this reimbursement.", [
            expectedAnswer("creditTransactionId", "string"),
          ]);
        const accounts = await lockAccounts([
          expense.accountId,
          ...(credit ? [credit.accountId] : []),
        ]);
        const accountById = new Map(accounts.map((account) => [account.id, account]));
        const expenseAccount = accountById.get(expense.accountId);
        const creditAccount = credit ? accountById.get(credit.accountId) : undefined;
        if (!expenseAccount || (credit && !creditAccount))
          return missing("The reimbursement transaction account is unavailable.", []);
        const lockedExpense = (
          await lockRead(
            executor
              .select()
              .from(financeTransactions)
              .where(eq(financeTransactions.id, expense.id))
              .limit(1),
          )
        )[0];
        const lockedCredit = credit
          ? (
              await lockRead(
                executor
                  .select()
                  .from(financeTransactions)
                  .where(eq(financeTransactions.id, credit.id))
                  .limit(1),
              )
            )[0]
          : undefined;
        const lockedAllocation = (
          await lockRead(
            executor
              .select()
              .from(financeTransactionAllocations)
              .where(eq(financeTransactionAllocations.id, allocation.id))
              .limit(1),
          )
        )[0];
        if (!lockedExpense || !lockedAllocation || (credit && !lockedCredit))
          return missing("The reimbursement evidence changed; refresh before continuing.", []);
        const canonicalEvidence = {
          sourceRefs: [
            transactionSource(lockedExpense, expenseAccount),
            ...(lockedCredit && creditAccount
              ? [transactionSource(lockedCredit, creditAccount)]
              : []),
          ],
          summary: input.data.evidence.summary,
        };
        const cases = await lockRead(
          executor
            .select()
            .from(financeReimbursements)
            .where(
              and(
                eq(financeReimbursements.userId, userId),
                eq(financeReimbursements.allocationId, lockedAllocation.id),
              ),
            )
            .orderBy(financeReimbursements.id),
        );
        const current =
          input.data.operation === "create"
            ? undefined
            : cases.find((item) => item.id === reimbursement?.id);
        const matches = current
          ? await lockRead(
              executor
                .select()
                .from(financeReimbursementMatches)
                .where(eq(financeReimbursementMatches.reimbursementId, current.id))
                .orderBy(financeReimbursementMatches.id),
            )
          : [];
        const matchInput = input.data.operation === "match_credit" ? input.data : null;
        const idempotentMatch =
          matchInput !== null &&
          matches.some(
            (match) =>
              match.creditTransactionId === matchInput.creditTransactionId &&
              match.amount === toCents(matchInput.amount) &&
              match.rationale === matchInput.rationale &&
              stableFinanceActionInput(match.evidence) ===
                stableFinanceActionInput(canonicalEvidence),
          );
        const idempotentCancel =
          input.data.operation === "cancel" && current?.status === "cancelled";
        if (
          input.data.operation !== "create" &&
          (!current ||
            (current.revision !== input.data.expectedRevision &&
              !idempotentMatch &&
              !idempotentCancel))
        )
          return missing("The reimbursement changed; refresh its revision before continuing.", [
            expectedAnswer("expectedRevision", "number"),
          ]);
        if (input.data.operation === "create") {
          const createInput = input.data;
          const expected = toCents(input.data.expectedAmount);
          const replayedCreate = cases.some(
            (item) =>
              item.expectedAmount === expected &&
              item.payer === createInput.payer &&
              item.dueDate === createInput.dueDate &&
              item.rationale === createInput.rationale &&
              stableFinanceActionInput(item.evidence) ===
                stableFinanceActionInput(canonicalEvidence),
          );
          if (
            !replayedCreate &&
            expected +
              cases.reduce(
                (sum, item) =>
                  sum + (item.status === "cancelled" ? item.receivedAmount : item.expectedAmount),
                0,
              ) >
              lockedAllocation.amount
          )
            return missing("The reimbursement exceeds the allocation's remaining capacity.", [
              expectedAnswer("expectedAmount", "number"),
            ]);
        }
        if (input.data.operation === "match_credit") {
          if (!lockedCredit || lockedCredit.pending || lockedCredit.direction !== "income")
            return missing("Choose a posted income credit to reconcile.", [
              expectedAnswer("creditTransactionId", "string"),
            ]);
          const creditMatches = await lockRead(
            executor
              .select()
              .from(financeReimbursementMatches)
              .where(eq(financeReimbursementMatches.creditTransactionId, lockedCredit.id))
              .orderBy(financeReimbursementMatches.id),
          );
          const amount = toCents(input.data.amount);
          if (
            !idempotentMatch &&
            (!current ||
              amount > current.expectedAmount - current.receivedAmount ||
              amount + creditMatches.reduce((sum, match) => sum + match.amount, 0) >
                lockedCredit.amount)
          )
            return missing(
              "The credit or reimbursement no longer has the requested remaining amount.",
              [expectedAnswer("amount", "number")],
            );
        }
        const revision = snapshotRevision({
          allocation: [
            lockedAllocation.id,
            lockedAllocation.revision,
            lockedAllocation.updatedAt.toISOString(),
          ],
          case: current ? [current.id, current.revision, current.updatedAt.toISOString()] : null,
          credit: lockedCredit ? [lockedCredit.id, lockedCredit.updatedAt.toISOString()] : null,
          expense: [lockedExpense.id, lockedExpense.updatedAt.toISOString()],
          matches: matches.map((match) => [match.id, match.amount, match.updatedAt.toISOString()]),
        });
        // Evidence references are capability-bearing provenance, never caller
        // assertions. Retain the bounded human summary but replace every
        // supplied reference with the owned records just locked above.
        const canonicalInput = {
          ...input.data,
          evidence: canonicalEvidence,
        };
        const target = current?.id ?? lockedAllocation.id;
        const base = prepared(
          canonicalInput,
          revision,
          [
            {
              entityId: target,
              entityType: "finance_reimbursement",
              summary:
                input.data.operation === "cancel"
                  ? "Cancel the reimbursement and restore its unmatched share to personal spending."
                  : input.data.operation === "match_credit"
                    ? "Match an observed credit to a reimbursement."
                    : "Track an expected reimbursement against a reimbursable allocation.",
            },
          ],
          [
            transactionSource(lockedExpense, expenseAccount),
            ...(lockedCredit && creditAccount
              ? [transactionSource(lockedCredit, creditAccount)]
              : []),
          ],
        );
        return {
          ...base,
          semanticTargetKeys: [
            ...new Set([
              ...base.semanticTargetKeys,
              `allocation:${lockedAllocation.id}`,
              `transaction:${lockedExpense.id}`,
              `account:${expenseAccount.id}`,
              ...(lockedCredit && creditAccount
                ? [`transaction:${lockedCredit.id}`, `account:${creditAccount.id}`]
                : []),
            ]),
          ].sort(),
        };
      }
      case "income_stream": {
        const input = parse<Record<string, unknown>>(updateFinanceIncomeStreamInputSchema);
        const id = typeof rawInput.id === "string" ? rawInput.id : "";
        if (!input || !id)
          return missing("Provide a valid income-stream ID and status.", [
            expectedAnswer("id", "string"),
            expectedAnswer("status", "string", { choices: ["active", "paused"] }),
          ]);
        const item = await row(
          lockRead(
            executor
              .select()
              .from(financeIncomeStreams)
              .where(and(eq(financeIncomeStreams.id, id), eq(financeIncomeStreams.userId, userId)))
              .orderBy(financeIncomeStreams.id)
              .limit(1),
          ),
          "Choose one of your income streams.",
          [expectedAnswer("id", "string")],
        );
        if ("question" in item) return item;
        return prepared(
          { ...input, id },
          item.updatedAt.toISOString(),
          [
            {
              entityId: item.id,
              entityType: "finance_income_stream",
              summary: `Set ${item.displayName} to ${String(input.status)}.`,
            },
          ],
          [localSource(item.id, item.updatedAt.toISOString())],
        );
      }
      default:
        return assertNever(actionKind);
    }
  }

  async function readBypass(executor: FinanceExecutor, userId: string, lock = false) {
    const query = executor
      .select({ reviewBypassEnabled: financeAutomationSettings.reviewBypassEnabled })
      .from(financeAutomationSettings)
      .where(eq(financeAutomationSettings.userId, userId));
    const [settings] = lock ? await query.for("update").limit(1) : await query.limit(1);
    return settings?.reviewBypassEnabled === true;
  }

  async function applyReimbursementQuestion(
    input: Record<string, unknown>,
    context: MutationContext,
    executor: FinanceExecutor,
  ) {
    await lockReimbursementTopology(executor, context.principal.userId);
    const answer = financeReimbursementQuestionAnswerSchema.parse(input.answer);
    const plan = input.plan as Record<string, unknown>;
    const sourceRefs = input.sourceRefs as MaterialSourceReference[];
    const evidence = {
      sourceRefs,
      summary:
        answer.kind === "entirely_personal" || answer.kind === "reimbursable"
          ? answer.rationale
          : answer.kind === "not_reimbursement"
            ? "Person confirmed this credit is not a reimbursement."
            : "Person confirmed the reimbursement credit match.",
    };
    const userId = context.principal.userId;
    const recordedAt = now();
    if (typeof plan.transactionId === "string") {
      const transactionId = plan.transactionId;
      if (answer.kind === "entirely_personal") {
        const [transaction] = await executor
          .update(financeTransactions)
          .set({ needsReview: false, updatedAt: recordedAt })
          .where(
            and(eq(financeTransactions.id, transactionId), eq(financeTransactions.userId, userId)),
          )
          .returning();
        if (!transaction) throw new AppError("conflict", "The expense could not be classified.");
        const categoryId = typeof plan.categoryId === "string" ? plan.categoryId : null;
        const [category] = categoryId
          ? await executor
              .select()
              .from(financeCategories)
              .where(
                and(eq(financeCategories.id, categoryId), eq(financeCategories.userId, userId)),
              )
              .limit(1)
          : [];
        await executor.insert(financeClassificationDecisions).values({
          categoryId: category?.id ?? null,
          categoryName: category?.name ?? transaction.category ?? "Uncategorized",
          confidence: 10_000,
          merchantId: transaction.merchantId,
          outcome: "confirmed",
          rationale: answer.rationale,
          source: "user",
          transactionId: transaction.id,
          userId,
        });
        await executor.insert(auditEvents).values(
          auditValues({
            action: "finance.reimbursement_question_resolved",
            after: { disposition: "entirely_personal" },
            before: null,
            entityId: transaction.id,
            entityType: "finance_transaction",
            ...context,
          }),
        );
        return { disposition: "entirely_personal", transactionId: transaction.id };
      }
      if (answer.kind !== "reimbursable")
        throw new AppError(
          "invalid_request",
          "The stored reimbursement expense answer is invalid.",
        );
      const allocationPlan = Array.isArray(plan.allocations)
        ? (plan.allocations as Array<Record<string, unknown>>)
        : [];
      const oldAllocationIds = Array.isArray(plan.allocationIds)
        ? plan.allocationIds.filter((id): id is string => typeof id === "string")
        : [];
      const categoryId = typeof plan.categoryId === "string" ? plan.categoryId : null;
      const reimbursementCents = typeof plan.amount === "number" ? plan.amount : NaN;
      if (!categoryId || !Number.isSafeInteger(reimbursementCents) || reimbursementCents <= 0)
        throw new AppError("conflict", "The prepared reimbursement plan is invalid.");
      const [transaction] = await executor
        .update(financeTransactions)
        .set({ needsReview: false, updatedAt: recordedAt })
        .where(
          and(eq(financeTransactions.id, transactionId), eq(financeTransactions.userId, userId)),
        )
        .returning();
      if (!transaction) throw new AppError("conflict", "The expense could not be updated.");
      await executor
        .update(financeTransactionAllocations)
        .set({ invalidatedAt: recordedAt, state: "invalidated", updatedAt: recordedAt })
        .where(
          and(
            eq(financeTransactionAllocations.userId, userId),
            inArray(financeTransactionAllocations.id, oldAllocationIds),
            eq(financeTransactionAllocations.state, "active"),
          ),
        );
      const first = allocationPlan[0];
      const order = typeof first?.allocationOrder === "number" ? first.allocationOrder : 0;
      const rationale = typeof first?.rationale === "string" ? first.rationale : answer.rationale;
      const personalCents = transaction.amount - reimbursementCents;
      const allocationValues = [
        ...(personalCents > 0
          ? [
              {
                allocationOrder: order,
                amount: personalCents,
                categoryId,
                rationale,
                transactionId: transaction.id,
                treatment: "personal" as const,
                userId,
              },
            ]
          : []),
        {
          allocationOrder: personalCents > 0 ? order + 1 : order,
          amount: reimbursementCents,
          categoryId,
          rationale: answer.rationale,
          transactionId: transaction.id,
          treatment: "reimbursable" as const,
          userId,
        },
      ];
      const createdAllocations = await executor
        .insert(financeTransactionAllocations)
        .values(allocationValues)
        .returning();
      const reimbursable = createdAllocations.find((item) => item.treatment === "reimbursable");
      if (!reimbursable)
        throw new AppError("conflict", "The reimbursement allocation could not be created.");
      const [reimbursement] = await executor
        .insert(financeReimbursements)
        .values({
          allocationId: reimbursable.id,
          dueDate: answer.dueDate,
          evidence,
          expectedAmount: reimbursementCents,
          payer: answer.payer,
          rationale: answer.rationale,
          userId,
        })
        .returning();
      if (!reimbursement)
        throw new AppError("conflict", "The reimbursement case could not be created.");
      await executor.insert(auditEvents).values(
        auditValues({
          action: "finance.reimbursement_question_resolved",
          after: { disposition: "reimbursable", reimbursementId: reimbursement.id },
          before: null,
          entityId: reimbursement.id,
          entityType: "finance_reimbursement",
          ...context,
        }),
      );
      return {
        disposition: "reimbursable",
        personalAmount: personalCents / 100,
        reimbursementId: reimbursement.id,
        reimbursementAmount: reimbursementCents / 100,
      };
    }
    const creditTransactionId =
      typeof plan.creditTransactionId === "string" ? plan.creditTransactionId : null;
    if (!creditTransactionId)
      throw new AppError("conflict", "The prepared reimbursement credit plan is invalid.");
    if (answer.kind === "not_reimbursement") {
      const [credit] = await executor
        .update(financeTransactions)
        .set({ needsReview: false, updatedAt: recordedAt })
        .where(
          and(
            eq(financeTransactions.id, creditTransactionId),
            eq(financeTransactions.userId, userId),
          ),
        )
        .returning();
      if (!credit) throw new AppError("conflict", "The credit could not be classified.");
      await executor.insert(auditEvents).values(
        auditValues({
          action: "finance.reimbursement_question_resolved",
          after: { disposition: "not_reimbursement" },
          before: null,
          entityId: credit.id,
          entityType: "finance_transaction",
          ...context,
        }),
      );
      return { disposition: "not_reimbursement", transactionId: credit.id };
    }
    if (answer.kind !== "match")
      throw new AppError("invalid_request", "The stored reimbursement credit answer is invalid.");
    const updated = [] as string[];
    for (const requested of answer.matches) {
      const [current] = await executor
        .select()
        .from(financeReimbursements)
        .where(
          and(
            eq(financeReimbursements.id, requested.reimbursementId),
            eq(financeReimbursements.userId, userId),
          ),
        )
        .limit(1);
      if (!current) throw new AppError("conflict", "The reimbursement case no longer exists.");
      const amount = toCents(requested.amount);
      const receivedAmount = current.receivedAmount + amount;
      const [match] = await executor
        .insert(financeReimbursementMatches)
        .values({
          amount,
          creditTransactionId,
          evidence,
          rationale: "Person confirmed this reimbursement credit match.",
          reimbursementId: current.id,
          userId,
        })
        .returning();
      const [next] = await executor
        .update(financeReimbursements)
        .set({
          receivedAmount,
          revision: current.revision + 1,
          status: deriveReimbursementStatus({
            cancelledAt: current.cancelledAt,
            dueDate: current.dueDate,
            expectedCents: current.expectedAmount,
            now: recordedAt,
            receivedCents: receivedAmount,
          }),
          updatedAt: recordedAt,
        })
        .where(eq(financeReimbursements.id, current.id))
        .returning();
      if (!match || !next)
        throw new AppError("conflict", "The reimbursement match could not be saved.");
      updated.push(next.id);
    }
    await executor
      .update(financeTransactions)
      .set({ needsReview: false, updatedAt: recordedAt })
      .where(
        and(
          eq(financeTransactions.id, creditTransactionId),
          eq(financeTransactions.userId, userId),
        ),
      );
    await executor.insert(auditEvents).values(
      auditValues({
        action: "finance.reimbursement_question_resolved",
        after: { disposition: "match", reimbursementCount: updated.length },
        before: null,
        entityId: creditTransactionId,
        entityType: "finance_transaction",
        ...context,
      }),
    );
    return { disposition: "match", reimbursementIds: updated };
  }

  async function applyPrepared(
    prepared: PreparedAction,
    context: MutationContext,
    executor?: FinanceExecutor,
  ) {
    const input = prepared.input;
    const privilegedContext = { ...context, financePreparedAction: true };
    const writer = (method: unknown) => method as TransactionalWriter;
    const invoke = (method: unknown, ...args: unknown[]) => writer(method).call(finances, ...args);
    switch (prepared.actionKind) {
      case "profile":
        return invoke(
          finances.updateProfile,
          input as never,
          privilegedContext as never,
          executor as never,
        );
      case "budget_plan": {
        if (
          "operation" in input &&
          (input.operation === "create" || input.operation === "update")
        ) {
          return invoke(
            finances.mutateFinanceBudgetBucket,
            input as never,
            privilegedContext as never,
            executor as never,
          );
        }
        // `payAccountId` is a recovery-only preparation override. It keeps a
        // corrected owned account in the private revision snapshot without
        // widening the public budget-plan writer contract or result.
        const { payAccountId: _payAccountId, ...budgetInput } = input;
        return "allocations" in input
          ? invoke(
              finances.setBudgetPlan,
              budgetInput as never,
              privilegedContext as never,
              executor as never,
            )
          : invoke(
              finances.createBudget,
              budgetInput as never,
              privilegedContext as never,
              executor as never,
            );
      }
      case "categorization":
        return ensureApplied(
          await invoke(
            finances.applyCategorizations,
            input as never,
            privilegedContext as never,
            executor as never,
          ),
        );
      case "recurring_obligation":
        return invoke(
          finances.updateRecurringObligation,
          String(input.id),
          input as never,
          privilegedContext as never,
          executor as never,
        );
      case "alert":
        return input.operation === "refresh"
          ? invoke(
              finances.refreshCashflowInsights,
              context.principal.userId,
              privilegedContext as never,
              executor as never,
            )
          : invoke(
              finances.resolveAlert,
              String(input.id),
              input as never,
              privilegedContext as never,
              executor as never,
            );
      case "income_stream":
        return invoke(
          finances.updateIncomeStream,
          String(input.id),
          input as never,
          privilegedContext as never,
          executor as never,
        );
      case "merchant":
        return "sourceMerchantId" in input
          ? invoke(
              finances.mergeMerchants,
              input as never,
              privilegedContext as never,
              executor as never,
            )
          : invoke(
              finances.updateMerchant,
              String(input.id),
              input as never,
              privilegedContext as never,
              executor as never,
            );
      case "transaction":
        return "accountId" in input
          ? invoke(
              finances.createTransaction,
              input as never,
              privilegedContext as never,
              executor as never,
            )
          : invoke(
              finances.updateTransaction,
              String(input.id),
              input as never,
              privilegedContext as never,
              executor as never,
            );
      case "transaction_breakdown":
        return invoke(
          finances.setTransactionBreakdown,
          String(input.id),
          input as never,
          privilegedContext as never,
          executor as never,
        );
      case "reimbursement":
        if (input.operation === "answer_question")
          return applyReimbursementQuestion(input, context, executor ?? (db as FinanceExecutor));
        return invoke(
          finances.reconcileReimbursement,
          input as never,
          privilegedContext as never,
          executor as never,
        );
    }
    return assertNever(prepared.actionKind);
  }

  function ensureApplied(result: unknown) {
    if (
      Array.isArray(result) &&
      result.some(
        (item) =>
          item && typeof item === "object" && (item as { status?: unknown }).status === "failed",
      )
    ) {
      throw new AppError("conflict", "A prepared Finance categorization no longer applies.");
    }
    return result;
  }

  async function revalidate(
    prepared: PreparedAction,
    userId: string,
    executor: FinanceExecutor,
    actorType: Principal["actorType"] = "agent",
  ) {
    if (prepared.actionKind === "reimbursement") await lockReimbursementTopology(executor, userId);
    // There is no row lock for an absent target. The target-key advisory lock
    // covers that case and gives queueing, approval, and bypass commits the
    // same deterministic serialization point.
    for (const key of [...prepared.semanticTargetKeys].sort()) {
      await executor.execute(sql`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`);
    }
    if (prepared.actionKind === "budget_plan" && "month" in prepared.input) {
      await executor.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`finance-budget-plan:${userId}:${String(prepared.input.month)}`}, 0))`,
      );
    }
    const current = await prepare(
      prepared.actionKind,
      prepared.input,
      userId,
      executor,
      true,
      actorType,
    );
    if ("status" in current) return current;
    if (current.expectedRevision !== prepared.expectedRevision) {
      return {
        question: question(
          prepared.actionKind,
          "The Finance records changed after this action was prepared. Refresh the evidence and submit a new action.",
          [],
        ),
        status: "needs_input" as const,
      };
    }
    return current;
  }

  async function queue(
    prepared: PreparedAction,
    context: MutationContext,
    executor: FinanceExecutor,
  ) {
    if (prepared.actionKind === "reimbursement")
      await lockReimbursementTopology(executor, context.principal.userId);
    for (const key of [...prepared.semanticTargetKeys].sort()) {
      await executor.execute(sql`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`);
    }
    const pending = await executor
      .select()
      .from(financeAgentActionReviews)
      .where(
        and(
          eq(financeAgentActionReviews.userId, context.principal.userId),
          eq(financeAgentActionReviews.status, "pending"),
        ),
      )
      .orderBy(desc(financeAgentActionReviews.updatedAt));
    const existing = pending.find((row) => row.fingerprint === prepared.fingerprint);
    if (existing) return reviewFromRow(existing);
    const keys = new Set(prepared.semanticTargetKeys);
    const stale = pending.filter(
      (row) =>
        row.actionKind === prepared.actionKind &&
        (row.semanticTargetKeys as string[]).some((key) => keys.has(key)),
    );
    if (stale.length) {
      await executor
        .update(financeAgentActionReviews)
        .set({ status: "superseded", updatedAt: now() })
        .where(
          inArray(
            financeAgentActionReviews.id,
            stale.map((row) => row.id),
          ),
        );
    }
    try {
      const [created] = await executor
        .insert(financeAgentActionReviews)
        .values({
          actionKind: prepared.actionKind,
          expectedRevision: prepared.expectedRevision,
          fingerprint: prepared.fingerprint,
          maintenanceRunId: null,
          privatePayload: {
            assumptions: prepared.assumptions,
            input: prepared.input,
            rationale: prepared.rationale,
          },
          requestingAgentId: context.principal.actorId,
          safeChanges: prepared.safeChanges,
          semanticTargetKeys: prepared.semanticTargetKeys,
          sourceRefs: prepared.sourceRefs,
          userId: context.principal.userId,
        })
        .returning();
      if (!created) throw new Error("The Finance action review could not be saved.");
      return reviewFromRow(created);
    } catch (error) {
      // The partial unique fingerprint index is also the concurrent replay
      // fence. A competing request returns the exact same pending review.
      const [replayed] = await executor
        .select()
        .from(financeAgentActionReviews)
        .where(
          and(
            eq(financeAgentActionReviews.userId, context.principal.userId),
            eq(financeAgentActionReviews.fingerprint, prepared.fingerprint),
            eq(financeAgentActionReviews.status, "pending"),
          ),
        )
        .limit(1);
      if (replayed) return reviewFromRow(replayed);
      throw error;
    }
  }

  function requestingAgentContext(
    context: MutationContext,
    requestingAgentId: string,
  ): MutationContext {
    return {
      ...context,
      principal: { ...context.principal, actorId: requestingAgentId, actorType: "agent" },
    };
  }

  async function settleMaintenanceCandidateInTransaction(input: {
    candidateId: string;
    context: MutationContext;
    expectedItemFingerprints?: string[];
    expectedRevision: string;
    expectedRunId?: string;
    expectedState: "awaiting_approval" | "challenged";
    executor: FinanceExecutor;
    mode: "apply" | "queue";
    reviewId?: string;
  }) {
    const { candidateId, context, executor, expectedRevision } = input;
    const [candidate] = await executor
      .select()
      .from(financeMaintenanceCandidates)
      .where(
        and(
          eq(financeMaintenanceCandidates.id, candidateId),
          eq(financeMaintenanceCandidates.userId, context.principal.userId),
        ),
      )
      .for("update")
      .limit(1);
    if (!candidate)
      throw new AppError("not_found", "The Finance maintenance candidate is not available.");
    if (candidate.state === "committed") return { candidateId, status: "committed" as const };
    const acceptsState =
      candidate.state === input.expectedState ||
      (input.mode === "queue" && candidate.state === "awaiting_approval");
    if (
      !acceptsState ||
      candidate.revision !== expectedRevision ||
      (input.expectedRunId !== undefined && candidate.runId !== input.expectedRunId)
    ) {
      if (input.reviewId) {
        await executor
          .update(financeAgentActionReviews)
          .set({ status: "superseded", updatedAt: now() })
          .where(eq(financeAgentActionReviews.id, input.reviewId));
        return { candidateId, status: "superseded" as const };
      }
      throw new AppError(
        "conflict",
        "The Finance maintenance candidate changed before settlement.",
      );
    }
    const [run] = await executor
      .select({
        checkpoint: workspaceMaintenanceRuns.checkpoint,
        id: workspaceMaintenanceRuns.id,
        scope: workspaceMaintenanceRuns.scope,
        status: workspaceMaintenanceRuns.status,
      })
      .from(workspaceMaintenanceRuns)
      .where(
        and(
          eq(workspaceMaintenanceRuns.id, candidate.runId),
          eq(workspaceMaintenanceRuns.userId, context.principal.userId),
        ),
      )
      .for("update")
      .limit(1);
    if (!run) throw new AppError("conflict", "The Finance maintenance run is no longer available.");
    const checkpoint = run.checkpoint as {
      candidateId?: string;
      phase?: string;
      revision?: string;
    } | null;
    const settlingApproval = candidate.state === "awaiting_approval";
    const expectedRunStatus = settlingApproval ? "awaiting_approval" : "awaiting_agent_challenge";
    const expectedPhase = settlingApproval ? "approval" : "challenge";
    if (
      run.status !== expectedRunStatus ||
      checkpoint?.candidateId !== candidate.id ||
      checkpoint.phase !== expectedPhase ||
      checkpoint.revision !== expectedRevision
    ) {
      if (input.reviewId) {
        await executor
          .update(financeAgentActionReviews)
          .set({ status: "superseded", updatedAt: now() })
          .where(eq(financeAgentActionReviews.id, input.reviewId));
        return { candidateId, status: "superseded" as const };
      }
      throw new AppError("conflict", "The Finance maintenance run changed before settlement.");
    }
    const items = await executor
      .select()
      .from(financeMaintenanceCandidateItems)
      .where(eq(financeMaintenanceCandidateItems.candidateId, candidate.id))
      .orderBy(asc(financeMaintenanceCandidateItems.ordinal))
      .for("update");
    if (items.some((item) => item.disposition === "question"))
      return { candidateId, status: "needs_input" as const };
    const preparedItems = items.filter((item) => item.disposition === "prepared");
    const preparedFingerprints = preparedItems.map((item) => item.fingerprint);
    const hasExpectedItems = input.expectedItemFingerprints
      ? preparedFingerprints.length === input.expectedItemFingerprints.length &&
        preparedFingerprints.every(
          (fingerprint, index) => fingerprint === input.expectedItemFingerprints?.[index],
        )
      : true;
    const supersedeAndRebuild = async () => {
      await executor
        .update(financeMaintenanceCandidates)
        .set({ state: "superseded", updatedAt: now() })
        .where(eq(financeMaintenanceCandidates.id, candidate.id));
      await executor
        .update(workspaceMaintenanceRuns)
        .set({
          checkpoint: { candidateId: candidate.id, phase: "prepare", reason: "candidate_drift" },
          leaseClaimId: null,
          leaseExpiresAt: null,
          retryAt: null,
          status: "queued",
          updatedAt: now(),
        })
        .where(eq(workspaceMaintenanceRuns.id, candidate.runId));
      await executor
        .delete(workspaceMaintenanceSteps)
        .where(eq(workspaceMaintenanceSteps.runId, candidate.runId));
      if (input.reviewId)
        await executor
          .update(financeAgentActionReviews)
          .set({ status: "superseded", updatedAt: now() })
          .where(eq(financeAgentActionReviews.id, input.reviewId));
      return { candidateId, status: "superseded" as const };
    };
    if (!hasExpectedItems) return supersedeAndRebuild();
    if (input.mode === "queue") {
      const fingerprint = `sha256:${createHash("sha256")
        .update(
          JSON.stringify({
            candidateId,
            expectedRevision,
            items: preparedFingerprints,
          }),
        )
        .digest("hex")}`;
      const [created] = await executor
        .insert(financeAgentActionReviews)
        .values({
          actionKind: "maintenance_turn",
          expectedRevision,
          fingerprint,
          maintenanceRunId: candidate.runId,
          privatePayload: {
            candidateId,
            expectedRevision,
            itemFingerprints: preparedFingerprints,
            rationale: "Review one prepared Finance maintenance turn.",
            runId: candidate.runId,
          },
          requestingAgentId: context.principal.actorId,
          safeChanges: preparedItems
            .flatMap((item) => item.safeChanges as FinanceSafeChange[])
            .slice(0, 100),
          semanticTargetKeys: [`finance-maintenance-candidate:${candidateId}`],
          sourceRefs: preparedItems.flatMap((item) => item.sourceRefs).slice(0, 100),
          userId: context.principal.userId,
        })
        .onConflictDoNothing()
        .returning();
      const review =
        created ??
        (
          await executor
            .select()
            .from(financeAgentActionReviews)
            .where(
              and(
                eq(financeAgentActionReviews.userId, context.principal.userId),
                eq(financeAgentActionReviews.fingerprint, fingerprint),
                eq(financeAgentActionReviews.status, "pending"),
              ),
            )
            .limit(1)
        )[0];
      if (!review) throw new Error("The Finance maintenance review could not be saved.");
      if (candidate.state !== "awaiting_approval")
        await executor
          .update(financeMaintenanceCandidates)
          .set({ state: "awaiting_approval", updatedAt: now() })
          .where(eq(financeMaintenanceCandidates.id, candidate.id));
      await executor
        .update(workspaceMaintenanceRuns)
        .set({
          checkpoint: { candidateId, phase: "approval", revision: expectedRevision },
          leaseClaimId: null,
          leaseExpiresAt: null,
          retryAt: null,
          status: "awaiting_approval",
          updatedAt: now(),
        })
        .where(eq(workspaceMaintenanceRuns.id, candidate.runId));
      return { review: reviewFromRow(review), status: "pending_review" as const };
    }
    const currentItems: Array<{ item: (typeof items)[number]; prepared: PreparedAction }> = [];
    for (const item of preparedItems) {
      const payload = item.privatePayload as {
        actionKind?: string;
        input?: Record<string, unknown>;
      };
      if (!payload.actionKind || !payload.input)
        throw new AppError(
          "conflict",
          "A Finance maintenance item is missing its prepared action.",
        );
      const prepared = await prepare(
        supportedActionKind(payload.actionKind),
        payload.input,
        context.principal.userId,
        executor,
        true,
        context.principal.actorType,
      );
      if (
        "status" in prepared ||
        financeCandidateActionFingerprint(prepared.actionKind, prepared.input) !== item.fingerprint
      )
        return supersedeAndRebuild();
      const current = await revalidate(
        prepared,
        context.principal.userId,
        executor,
        context.principal.actorType,
      );
      if ("status" in current) return supersedeAndRebuild();
      currentItems.push({ item, prepared: current });
    }
    const currentSnapshot = await finances.maintenanceCandidateSnapshot(
      context.principal.userId,
      run.scope,
      items,
      candidate.discoveryRevision,
      executor,
    );
    if (currentSnapshot.revision !== candidate.revision) return supersedeAndRebuild();
    await executor
      .update(financeMaintenanceCandidates)
      .set({ state: "committing", updatedAt: now() })
      .where(
        and(
          eq(financeMaintenanceCandidates.id, candidate.id),
          eq(financeMaintenanceCandidates.state, input.expectedState),
          eq(financeMaintenanceCandidates.revision, expectedRevision),
        ),
      );
    for (const { item, prepared } of currentItems) {
      await applyPrepared(prepared, context, executor);
      await executor
        .update(financeMaintenanceCandidateItems)
        .set({ disposition: "committed", updatedAt: now() })
        .where(eq(financeMaintenanceCandidateItems.id, item.id));
    }
    await executor
      .update(financeMaintenanceCandidates)
      .set({ state: "committed", updatedAt: now() })
      .where(
        and(
          eq(financeMaintenanceCandidates.id, candidate.id),
          eq(financeMaintenanceCandidates.state, "committing"),
        ),
      );
    await executor
      .update(workspaceMaintenanceRuns)
      .set({
        checkpoint: { candidateId, phase: "health_refresh" },
        leaseClaimId: null,
        leaseExpiresAt: null,
        retryAt: null,
        status: "queued",
        updatedAt: now(),
      })
      .where(
        and(
          eq(workspaceMaintenanceRuns.id, candidate.runId),
          eq(workspaceMaintenanceRuns.status, expectedRunStatus),
        ),
      );
    return { candidateId, status: "committed" as const };
  }

  return {
    prepare,
    async prepareMaintenanceCandidateDraft(
      actionKind: SupportedActionKind,
      input: Record<string, unknown>,
      userId: string,
      executor?: FinanceExecutor,
      actorType: Principal["actorType"] = "agent",
    ): Promise<FinanceMaintenanceCandidateItemDraft> {
      const result = await prepare(
        actionKind,
        input,
        userId,
        executor ?? db,
        executor !== undefined,
        actorType,
      );
      if ("status" in result) {
        return financeMaintenanceCandidateItemDraftSchema.parse({
          actionKind: "question",
          assumptions: [],
          disposition: "question",
          evidence: { confidence: 0, rationale: result.question.why },
          expectedRevision: null,
          fingerprint: `sha256:${financeActionFingerprint("question", { actionKind, input })}`,
          privatePayload: {
            asOf: now().toISOString(),
            choices: result.question.choices,
            expectedAnswer: result.question.expectedAnswer,
            prompt: result.question.prompt,
            transactionId: null,
            underlyingAction: actionKind,
            why: result.question.why,
          },
          safeChanges: [],
          sourceRefs: result.question.sourceRefs,
        });
      }
      return financeMaintenanceCandidateItemDraftSchema.parse({
        actionKind: result.actionKind,
        assumptions: result.assumptions,
        disposition: "prepared",
        evidence: { confidence: 1, rationale: result.rationale },
        expectedRevision: result.expectedRevision,
        fingerprint: `sha256:${result.fingerprint}`,
        privatePayload: { actionKind: result.actionKind, input: result.input },
        safeChanges: result.safeChanges,
        sourceRefs: result.sourceRefs,
      });
    },
    async settleFinanceMaintenanceCandidate(
      candidateId: string,
      expectedRevision: string,
      context: MutationContext,
    ) {
      return db.transaction(async (tx) => {
        const bypass = await readBypass(tx, context.principal.userId, true);
        const outcome = await settleMaintenanceCandidateInTransaction({
          candidateId,
          context,
          expectedRevision,
          expectedState: "challenged",
          executor: tx,
          mode: bypass ? "apply" : "queue",
        });
        if (outcome.status === "needs_input")
          throw new AppError(
            "conflict",
            "Finance maintenance questions must be answered before settlement.",
          );
        return outcome;
      });
    },
    async performDirect<T>(
      actionKind: SupportedActionKind,
      input: Record<string, unknown>,
      context: MutationContext,
    ): Promise<FinanceActionOutcome<T>> {
      const prepared = await prepare(
        actionKind,
        input,
        context.principal.userId,
        db,
        false,
        context.principal.actorType,
      );
      if ("status" in prepared) {
        const [stored] = await db
          .insert(financeAgentActionReviews)
          .values({
            actionKind: "question",
            expectedRevision: null,
            fingerprint: financeActionFingerprint("question", {
              actionKind,
              input,
              requestingAgentId: context.principal.actorId,
            }),
            maintenanceRunId: null,
            privatePayload: { original: { actionKind, input }, question: prepared.question },
            requestingAgentId: context.principal.actorId,
            safeChanges: [
              {
                entityId: null,
                entityType: `finance_${actionKind}`,
                summary: "Supply the requested Finance evidence.",
              },
            ],
            sourceRefs: prepared.question.sourceRefs,
            userId: context.principal.userId,
          })
          .onConflictDoNothing()
          .returning();
        if (stored)
          return { question: { ...prepared.question, id: stored.id }, status: "needs_input" };
        const [existing] = await db
          .select()
          .from(financeAgentActionReviews)
          .where(
            and(
              eq(financeAgentActionReviews.userId, context.principal.userId),
              eq(
                financeAgentActionReviews.fingerprint,
                financeActionFingerprint("question", {
                  actionKind,
                  input,
                  requestingAgentId: context.principal.actorId,
                }),
              ),
              eq(financeAgentActionReviews.status, "pending"),
            ),
          )
          .limit(1);
        if (!existing) throw new Error("The Finance question could not be saved.");
        const payload = existing.privatePayload as { question: FinanceQuestion };
        return { question: { ...payload.question, id: existing.id }, status: "needs_input" };
      }
      // Lock and re-read immediately before the semantic writer. This closes
      // the setting TOCTOU window for agent actions without accepting token or
      // request-body bypass authority.
      if (context.principal.actorType === "agent") {
        return db.transaction(async (tx) => {
          // Reimbursement terminal paths hold topology before every semantic
          // lock, including the bypass-setting row. A new proposal must take
          // the same order while it revalidates or queues beside them.
          if (prepared.actionKind === "reimbursement")
            await lockReimbursementTopology(tx, context.principal.userId);
          if (!(await readBypass(tx, context.principal.userId, true))) {
            const current = await revalidate(prepared, context.principal.userId, tx, "agent");
            if ("status" in current) return current;
            return {
              review: (await queue(current, context, tx)) as FinancePendingActionReview,
              status: "pending_review",
            };
          }
          const current = await revalidate(prepared, context.principal.userId, tx, "agent");
          if ("status" in current) return current;
          return {
            result: (await applyPrepared(current, context, tx)) as T,
            status: "applied",
          };
        });
      }
      return { result: (await applyPrepared(prepared, context)) as T, status: "applied" };
    },
    async listReviews(userId: string, limit = 50) {
      const rows = await db
        .select()
        .from(financeAgentActionReviews)
        .where(
          and(
            eq(financeAgentActionReviews.userId, userId),
            ne(financeAgentActionReviews.actionKind, "question"),
          ),
        )
        .orderBy(desc(financeAgentActionReviews.createdAt))
        .limit(limit);
      return rows.map(reviewFromRow);
    },
    async listQuestions(userId: string, limit = 50) {
      const rows = await db
        .select()
        .from(financeAgentActionReviews)
        .where(
          and(
            eq(financeAgentActionReviews.userId, userId),
            eq(financeAgentActionReviews.actionKind, "question"),
            eq(financeAgentActionReviews.status, "pending"),
          ),
        )
        .orderBy(desc(financeAgentActionReviews.createdAt))
        .limit(limit);
      return rows.map(questionFromRow);
    },
    async approve<T>(id: string, context: MutationContext): Promise<FinanceActionOutcome<T>> {
      if (context.principal.actorType !== "user") {
        throw new AppError(
          "forbidden",
          "Only an interactive user can approve a Finance action review.",
        );
      }
      const approval = await db.transaction(async (tx) => {
        const [preview] = await tx
          .select()
          .from(financeAgentActionReviews)
          .where(
            and(
              eq(financeAgentActionReviews.id, id),
              eq(financeAgentActionReviews.userId, context.principal.userId),
            ),
          )
          .limit(1);
        if (!preview) throw new AppError("not_found", "The Finance action review was not found.");
        if (preview.actionKind === "reimbursement")
          await lockReimbursementTopology(tx, context.principal.userId);
        const [review] = await tx
          .select()
          .from(financeAgentActionReviews)
          .where(
            and(
              eq(financeAgentActionReviews.id, id),
              eq(financeAgentActionReviews.userId, context.principal.userId),
            ),
          )
          .for("update")
          .limit(1);
        if (!review) throw new AppError("not_found", "The Finance action review was not found.");
        if (
          review.fingerprint !== preview.fingerprint ||
          review.updatedAt.getTime() !== preview.updatedAt.getTime()
        )
          throw new AppError("conflict", "The Finance action review changed before approval.");
        const payload = review.privatePayload as StoredPayload;
        if (review.status === "applied") {
          return { result: payload.result as T, status: "applied" };
        }
        if (review.status !== "pending") {
          throw new AppError("conflict", "This Finance action review is no longer pending.");
        }
        if (review.actionKind === "maintenance_turn") {
          const payload = review.privatePayload as {
            candidateId?: string;
            expectedRevision?: string;
            itemFingerprints?: string[];
            runId?: string;
            result?: unknown;
          };
          if (!payload.candidateId || !payload.expectedRevision || !payload.runId)
            throw new AppError("conflict", "The Finance maintenance review payload is incomplete.");
          const settlement = await settleMaintenanceCandidateInTransaction({
            candidateId: payload.candidateId,
            context: requestingAgentContext(context, review.requestingAgentId),
            ...(payload.itemFingerprints
              ? { expectedItemFingerprints: payload.itemFingerprints }
              : {}),
            expectedRevision: payload.expectedRevision,
            expectedRunId: payload.runId,
            expectedState: "awaiting_approval",
            executor: tx,
            mode: "apply",
            reviewId: review.id,
          });
          if (settlement.status === "needs_input")
            return {
              candidateSuperseded: true as const,
              message: "Finance maintenance questions must be answered before approval.",
            };
          if (settlement.status === "superseded")
            return {
              candidateSuperseded: true as const,
              message: "The Finance maintenance candidate requires rebuilding.",
            };
          const result = { candidateId: settlement.candidateId, status: "committed" as const };
          await tx
            .update(financeAgentActionReviews)
            .set({ privatePayload: { ...payload, result }, status: "applied", updatedAt: now() })
            .where(eq(financeAgentActionReviews.id, review.id));
          return { result: result as T, status: "applied" as const };
        }
        const prepared: PreparedAction = {
          actionKind: supportedActionKind(review.actionKind),
          expectedRevision: review.expectedRevision,
          fingerprint: review.fingerprint,
          input: payload.input,
          rationale: payload.rationale,
          safeChanges: review.safeChanges as FinanceSafeChange[],
          assumptions: payload.assumptions ?? [],
          sourceRefs: review.sourceRefs as MaterialSourceReference[],
          semanticTargetKeys: review.semanticTargetKeys as string[],
        };
        const actionContext =
          review.actionKind === "transaction" ||
          review.actionKind === "transaction_breakdown" ||
          review.actionKind === "reimbursement"
            ? requestingAgentContext(context, review.requestingAgentId)
            : context;
        const current = await revalidate(
          prepared,
          context.principal.userId,
          tx,
          actionContext.principal.actorType,
        );
        if ("status" in current) {
          await tx
            .update(financeAgentActionReviews)
            .set({ status: "superseded", updatedAt: now() })
            .where(eq(financeAgentActionReviews.id, review.id));
          return current;
        }
        const result = await applyPrepared(current, actionContext, tx);
        await tx
          .update(financeAgentActionReviews)
          .set({ privatePayload: { ...payload, result }, status: "applied", updatedAt: now() })
          .where(eq(financeAgentActionReviews.id, review.id));
        await tx.insert(auditEvents).values(
          auditValues({
            action: "finance.action_review_approved",
            after: {
              actionKind: review.actionKind,
              fingerprint: review.fingerprint,
              reviewId: review.id,
            },
            before: null,
            entityId: review.id,
            entityType: "finance_agent_action_review",
            ...context,
          }),
        );
        return { result: result as T, status: "applied" };
      });
      if ("candidateSuperseded" in approval && approval.candidateSuperseded)
        throw new AppError("conflict", approval.message);
      return approval as FinanceActionOutcome<T>;
    },
    async dismiss(id: string, context: MutationContext) {
      if (context.principal.actorType !== "user") {
        throw new AppError(
          "forbidden",
          "Only an interactive user can dismiss a Finance action review.",
        );
      }
      return db.transaction(async (tx) => {
        const [review] = await tx
          .select()
          .from(financeAgentActionReviews)
          .where(
            and(
              eq(financeAgentActionReviews.id, id),
              eq(financeAgentActionReviews.userId, context.principal.userId),
            ),
          )
          .for("update")
          .limit(1);
        if (!review) throw new AppError("not_found", "The Finance action review was not found.");
        if (review.status === "pending") {
          const [dismissed] = await tx
            .update(financeAgentActionReviews)
            .set({ status: "dismissed", updatedAt: now() })
            .where(eq(financeAgentActionReviews.id, review.id))
            .returning();
          if (!dismissed) throw new Error("The Finance action review could not be dismissed.");
          return reviewFromRow(dismissed);
        }
        return reviewFromRow(review);
      });
    },
    async answerQuestion(id: string, answer: string, context: MutationContext) {
      const answerValue = answer.trim();
      if (answerValue.length === 0 || answerValue.length > 4_000) {
        throw new AppError("invalid_request", "Provide a bounded Finance question answer.");
      }
      let suppliedAnswer: Record<string, unknown> | null = null;
      try {
        const parsed = JSON.parse(answerValue);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
        suppliedAnswer = parsed as Record<string, unknown>;
      } catch {
        // Keep malformed answers recoverable for an outstanding question.
      }
      const canonicalAnswer = suppliedAnswer
        ? stableFinanceActionInput(suppliedAnswer)
        : answerValue;
      return db.transaction(async (tx) => {
        const [preview] = await tx
          .select()
          .from(financeAgentActionReviews)
          .where(
            and(
              eq(financeAgentActionReviews.id, id),
              eq(financeAgentActionReviews.userId, context.principal.userId),
              eq(financeAgentActionReviews.actionKind, "question"),
            ),
          )
          .limit(1);
        if (!preview) throw new AppError("not_found", "The Finance question was not found.");
        const previewPayload = preview.privatePayload as { original?: { actionKind?: unknown } };
        if (previewPayload.original?.actionKind === "reimbursement")
          await lockReimbursementTopology(tx, context.principal.userId);
        const [review] = await tx
          .select()
          .from(financeAgentActionReviews)
          .where(
            and(
              eq(financeAgentActionReviews.id, id),
              eq(financeAgentActionReviews.userId, context.principal.userId),
              eq(financeAgentActionReviews.actionKind, "question"),
            ),
          )
          .for("update")
          .limit(1);
        if (!review) throw new AppError("not_found", "The Finance question was not found.");
        if (
          review.fingerprint !== preview.fingerprint ||
          review.updatedAt.getTime() !== preview.updatedAt.getTime()
        )
          throw new AppError("conflict", "The Finance question changed before it was answered.");
        const payload = review.privatePayload as {
          answer?: string;
          candidate?: Record<string, unknown>;
          maintenanceAnswerAuthority?: "same_user_finances_write";
          original: { actionKind: unknown; input: Record<string, unknown> };
          outcome?: FinanceActionOutcome<unknown>;
          question: FinanceQuestion;
        };
        if (
          context.principal.actorType === "agent" &&
          review.requestingAgentId !== context.principal.actorId &&
          !(
            payload.maintenanceAnswerAuthority === "same_user_finances_write" &&
            context.principal.scopes.has("finances:write")
          )
        ) {
          throw new AppError(
            "forbidden",
            "Agents can answer only their own referenced Finance questions.",
          );
        }
        if (review.status !== "pending") {
          if (payload.answer && payload.outcome) {
            try {
              if (stableFinanceActionInput(JSON.parse(payload.answer)) === canonicalAnswer)
                return payload.outcome;
            } catch {
              if (payload.answer === canonicalAnswer) return payload.outcome;
            }
          }
          throw new AppError("conflict", "This Finance question has already been answered.");
        }
        const originalActionKind = supportedActionKind(payload.original.actionKind);
        const actionContext = requestingAgentContext(context, review.requestingAgentId);
        const expected = payload.question.expectedAnswer;
        const retryQuestion = { ...payload.question, expectedAnswer: expected, id: review.id };
        if (!suppliedAnswer) {
          return { question: retryQuestion, status: "needs_input" as const };
        }
        const supplied = suppliedAnswer;
        if (
          expected.some(
            (field) =>
              (field.required && supplied[field.name] === undefined) ||
              (supplied[field.name] !== undefined &&
                !isExpectedAnswerValue(field, supplied[field.name])),
          ) ||
          Object.keys(supplied).some((key) => !expected.some((field) => field.name === key))
        )
          return { question: retryQuestion, status: "needs_input" as const };
        const reimbursementQuestion =
          originalActionKind === "reimbursement" &&
          payload.original.input.operation === "answer_question";
        const resumeInput = reimbursementQuestion
          ? {
              ...payload.original.input,
              answer: supplied.answer,
              candidate: payload.candidate,
              sourceRefs: review.sourceRefs,
            }
          : { ...payload.original.input, ...supplied };
        const prepared = await prepare(
          originalActionKind,
          resumeInput,
          context.principal.userId,
          tx,
          false,
          "agent",
        );
        let outcome: FinanceActionOutcome<unknown>;
        if ("status" in prepared) {
          const nextQuestion = { ...prepared.question, id: review.id };
          await tx
            .update(financeAgentActionReviews)
            .set({
              privatePayload: {
                ...payload,
                original: {
                  ...payload.original,
                  input: resumeInput,
                },
                question: nextQuestion,
              },
              updatedAt: now(),
            })
            .where(eq(financeAgentActionReviews.id, review.id));
          await tx.insert(auditEvents).values(
            auditValues({
              action: "finance.question_answered",
              after: { requestingAgentId: review.requestingAgentId, status: "needs_input" },
              before: null,
              entityId: review.id,
              entityType: "finance_agent_action_question",
              ...context,
            }),
          );
          return { question: nextQuestion, status: "needs_input" };
        } else if (!(await readBypass(tx, context.principal.userId, true))) {
          outcome = {
            review: (await queue(prepared, actionContext, tx)) as FinancePendingActionReview,
            status: "pending_review",
          };
        } else {
          const current = await revalidate(prepared, context.principal.userId, tx, "agent");
          outcome =
            "status" in current
              ? current
              : { result: await applyPrepared(current, actionContext, tx), status: "applied" };
        }
        await tx
          .update(financeAgentActionReviews)
          .set({
            privatePayload: { ...payload, answer: canonicalAnswer, outcome },
            status: "superseded",
            updatedAt: now(),
          })
          .where(eq(financeAgentActionReviews.id, review.id));
        await tx.insert(auditEvents).values(
          auditValues({
            action: "finance.question_answered",
            after: { requestingAgentId: review.requestingAgentId, status: outcome.status },
            before: null,
            entityId: review.id,
            entityType: "finance_agent_action_question",
            ...context,
          }),
        );
        return outcome;
      });
    },
  };
}
