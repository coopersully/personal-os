import { createHash, randomUUID } from "node:crypto";
import {
  auditEvents,
  type Database,
  financeAccounts,
  financeAgentActionReviews,
  financeAlerts,
  financeAutomationSettings,
  financeBudgetPlans,
  financeBudgets,
  financeCategories,
  financeIncomeStreams,
  financeMerchants,
  financeProfiles,
  financeRecurringObligations,
  financeTransactions,
  goals,
} from "@personal-os/database";
import {
  applyFinanceCategorizationsInputSchema,
  createFinanceBudgetInputSchema,
  createFinanceTransactionInputSchema,
  type FinanceActionKind,
  type FinanceActionOutcome,
  type FinanceActionReview,
  type FinancePendingActionReview,
  type FinanceQuestion,
  type FinanceSafeChange,
  financeActionKindSchema,
  financeActionReviewSchema,
  financeQuestionSchema,
  type MaterialSourceReference,
  mergeFinanceMerchantsInputSchema,
  resolveFinanceAlertInputSchema,
  setFinanceBudgetPlanInputSchema,
  setFinanceTransactionBreakdownInputSchema,
  updateFinanceIncomeStreamInputSchema,
  updateFinanceMerchantInputSchema,
  updateFinanceProfileInputSchema,
  updateFinanceRecurringObligationInputSchema,
  updateFinanceTransactionInputSchema,
} from "@personal-os/domain";
import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { auditValues } from "./audit.js";
import { AppError } from "./errors.js";
import { reliableMonthlyCapacity } from "./finance-planning.js";
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

type FinanceExecutor = Pick<Database, "execute" | "insert" | "select" | "update">;
type TransactionalWriter = (...args: unknown[]) => Promise<unknown>;

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function actionFingerprint(actionKind: FinanceActionKind, input: Record<string, unknown>): string {
  return createHash("sha256")
    .update(`${actionKind}:${stableJson(input)}`)
    .digest("hex");
}

function snapshotRevision(value: unknown): string {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

function localSource(id: string, revision: string | null): MaterialSourceReference {
  return { accountId: null, provider: "local", remoteId: id, revision, sourceType: "local" };
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

function profileProjection(
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

function supportedActionKind(value: unknown): SupportedActionKind {
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
      "transaction",
      "transaction_breakdown",
    ].includes(actionKind)
  ) {
    throw new AppError("invalid_request", "The stored Finance action kind cannot be resumed.");
  }
  return actionKind as SupportedActionKind;
}
function semanticTargetKeys(actionKind: SupportedActionKind, input: Record<string, unknown>) {
  const ids = (value: unknown) => (Array.isArray(value) ? value.map(String).sort() : []);
  switch (actionKind) {
    case "profile":
      return [`profile:${String(input.effectiveDate)}`];
    case "budget_plan":
      // A one-category budget changes the same monthly capacity and replacement
      // set as a complete plan. Keeping one key prevents cross-variant reviews
      // from being approved against stale budget-month state.
      return [`budget-month:${String(input.month)}`];
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

function isExpectedAnswerValue(field: ExpectedAnswer, value: unknown): boolean {
  if (value === null) return field.nullable;
  const valid = (() => {
    switch (field.type) {
      case "boolean":
        return typeof value === "boolean";
      case "number":
        return typeof value === "number" && Number.isFinite(value);
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
    executor: Pick<Database, "select"> = db,
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
      fingerprint: actionFingerprint(actionKind, input),
      input,
      rationale:
        typeof input.rationale === "string" && input.rationale.trim()
          ? input.rationale
          : `Requested ${actionKind.replaceAll("_", " ")} change.`,
      safeChanges,
      semanticTargetKeys: semanticTargetKeys(actionKind, input),
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
        const input = parse<Record<string, unknown>>(setFinanceTransactionBreakdownInputSchema);
        const id = typeof rawInput.id === "string" ? rawInput.id : "";
        if (!id || !input)
          return missing("Provide a transaction ID and exact transaction allocations.", [
            expectedAnswer("id", "string"),
            expectedAnswer("allocations", "object_array", { example: "[...]" }),
            expectedAnswer("expectedTransactionUpdatedAt", "string"),
            expectedAnswer("rationale", "string"),
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
        if (item.updatedAt.toISOString() !== String(input.expectedTransactionUpdatedAt)) {
          return missing(
            "The displayed transaction revision is stale. Refresh it before setting a breakdown.",
            [expectedAnswer("expectedTransactionUpdatedAt", "string")],
          );
        }
        const allocationCategoryIds = (input.allocations as Array<{ categoryId: string }>).map(
          (allocation) => allocation.categoryId,
        );
        const categories = await lockRead(
          executor
            .select({ id: financeCategories.id })
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
        return prepared(
          { ...input, id },
          item.updatedAt.toISOString(),
          [
            {
              entityId: item.id,
              entityType: "finance_transaction",
              summary: `Set ${item.merchant} transaction breakdown with ${(input.allocations as unknown[]).length} allocations.`,
            },
          ],
          [localSource(item.id, item.updatedAt.toISOString())],
        );
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
    // There is no row lock for an absent target. The target-key advisory lock
    // covers that case and gives queueing, approval, and bypass commits the
    // same deterministic serialization point.
    for (const key of [...prepared.semanticTargetKeys].sort()) {
      await executor.execute(sql`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`);
    }
    if (prepared.actionKind === "budget_plan") {
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

  return {
    prepare,
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
            fingerprint: actionFingerprint("question", {
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
                actionFingerprint("question", {
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
        const payload = review.privatePayload as StoredPayload;
        if (review.status === "applied") {
          return { result: payload.result as T, status: "applied" };
        }
        if (review.status !== "pending") {
          throw new AppError("conflict", "This Finance action review is no longer pending.");
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
          review.actionKind === "transaction" || review.actionKind === "transaction_breakdown"
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
      const canonicalAnswer = suppliedAnswer ? stableJson(suppliedAnswer) : answerValue;
      return db.transaction(async (tx) => {
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
          context.principal.actorType === "agent" &&
          review.requestingAgentId !== context.principal.actorId
        ) {
          throw new AppError(
            "forbidden",
            "Agents can answer only their own referenced Finance questions.",
          );
        }
        const payload = review.privatePayload as {
          answer?: string;
          original: { actionKind: unknown; input: Record<string, unknown> };
          outcome?: FinanceActionOutcome<unknown>;
          question: FinanceQuestion;
        };
        if (review.status !== "pending") {
          if (payload.answer && payload.outcome) {
            try {
              if (stableJson(JSON.parse(payload.answer)) === canonicalAnswer)
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
        const prepared = await prepare(
          originalActionKind,
          { ...payload.original.input, ...supplied },
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
                  input: { ...payload.original.input, ...supplied },
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
