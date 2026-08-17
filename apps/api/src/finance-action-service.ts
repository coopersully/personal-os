import { createHash, randomUUID } from "node:crypto";
import {
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
  financeActionReviewSchema,
  type MaterialSourceReference,
  mergeFinanceMerchantsInputSchema,
  resolveFinanceAlertInputSchema,
  setFinanceBudgetPlanInputSchema,
  updateFinanceIncomeStreamInputSchema,
  updateFinanceMerchantInputSchema,
  updateFinanceProfileInputSchema,
  updateFinanceRecurringObligationInputSchema,
  updateFinanceTransactionInputSchema,
} from "@personal-os/domain";
import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { AppError } from "./errors.js";
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

function assertNever(value: never): never {
  throw new AppError("invalid_request", `Unsupported Finance action kind: ${String(value)}.`);
}
function semanticTargetKeys(actionKind: SupportedActionKind, input: Record<string, unknown>) {
  const ids = (value: unknown) => (Array.isArray(value) ? value.map(String).sort() : []);
  switch (actionKind) {
    case "profile":
      return [`profile:${String(input.effectiveDate)}`];
    case "budget_plan":
      return [
        "allocations" in input
          ? `budget-plan:${String(input.month)}`
          : `budget:${String(input.month)}:${String(input.category)}`,
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
    case "income_stream":
      return [`income:${String(input.id)}`];
  }
}

function question(actionKind: FinanceActionKind, why: string): FinanceQuestion {
  return {
    actionKind,
    choices: [],
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
  ): Promise<PreparedAction | { status: "needs_input"; question: FinanceQuestion }> {
    const missing = (why: string, sourceRefs: MaterialSourceReference[] = []) => ({
      question: { ...question(actionKind, why), sourceRefs },
      status: "needs_input" as const,
    });
    const parse = <T>(schema: {
      safeParse: (value: unknown) => { success: boolean; data?: T };
    }) => {
      const parsed = schema.safeParse(rawInput);
      return parsed.success ? parsed.data : null;
    };
    const row = async <T>(query: Promise<T[]>, why: string) => {
      const item = (await query)[0];
      return item ?? missing(why);
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
      sourceRefs,
    });

    switch (actionKind) {
      case "profile": {
        const input = parse<Record<string, unknown>>(updateFinanceProfileInputSchema);
        if (!input) return missing("Provide a complete valid Finance profile.");
        const account = input.payAccountId
          ? await row(
              executor
                .select()
                .from(financeAccounts)
                .where(
                  and(
                    eq(financeAccounts.id, String(input.payAccountId)),
                    eq(financeAccounts.userId, userId),
                  ),
                )
                .limit(1),
              "Choose one of your Finance accounts for pay deposits.",
            )
          : null;
        if (account && "question" in account) return account;
        const existing = await executor
          .select()
          .from(financeProfiles)
          .where(
            and(
              eq(financeProfiles.userId, userId),
              eq(financeProfiles.effectiveDate, String(input.effectiveDate)),
            ),
          )
          .limit(1);
        const revision = existing[0]?.updatedAt.toISOString() ?? "absent";
        return prepared(
          input,
          revision,
          [
            {
              entityId: existing[0]?.id ?? null,
              entityType: "finance_profile",
              summary: `Update profile effective ${String(input.effectiveDate)}.`,
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
          const categories = await executor
            .select()
            .from(financeCategories)
            .where(
              and(eq(financeCategories.userId, userId), inArray(financeCategories.id, categoryIds)),
            );
          if (categories.length !== categoryIds.length)
            return missing("Every budget allocation must reference one of your categories.");
          const goalIds = plan.goalIds as string[];
          const ownedGoals = goalIds.length
            ? await executor
                .select()
                .from(goals)
                .where(and(eq(goals.userId, userId), inArray(goals.id, goalIds)))
            : [];
          if (ownedGoals.length !== goalIds.length)
            return missing("Every budget-plan goal must belong to you.");
          const planRows = await executor
            .select()
            .from(financeBudgetPlans)
            .where(
              and(
                eq(financeBudgetPlans.userId, userId),
                eq(financeBudgetPlans.month, String(plan.month)),
              ),
            )
            .limit(1);
          const revision = stableJson({
            plan: planRows[0]?.version ?? 0,
            categories: categories.map((item) => [item.id, item.updatedAt.toISOString()]).sort(),
            goals: ownedGoals.map((item) => [item.id, item.updatedAt.toISOString()]).sort(),
          });
          return prepared(
            plan,
            revision,
            allocations.map((item) => ({
              entityId: item.categoryId,
              entityType: "finance_budget",
              summary: `Set ${String(plan.month)} allocation to $${item.limit.toFixed(2)}.`,
            })),
            [
              ...categories.map((item) => localSource(item.id, item.updatedAt.toISOString())),
              ...ownedGoals.map((item) => localSource(item.id, item.updatedAt.toISOString())),
            ],
            (plan.assumptions as string[]) ?? [],
          );
        }
        const input = parse<Record<string, unknown>>(createFinanceBudgetInputSchema);
        if (!input)
          return missing("Provide a complete Finance budget or complete monthly budget plan.");
        const existing = await executor
          .select()
          .from(financeBudgets)
          .where(
            and(
              eq(financeBudgets.userId, userId),
              eq(financeBudgets.month, String(input.month)),
              eq(financeBudgets.category, String(input.category)),
            ),
          )
          .limit(1);
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
          );
        const decisions = input.decisions as Array<{
          transactionId: string;
          categoryId: string;
          expectedTransactionUpdatedAt: string;
          rationale: string;
        }>;
        const transactions = await executor
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
          );
        if (transactions.length !== decisions.length)
          return missing("Every categorization must target one of your transactions.");
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
          );
        const categories = await executor
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
          );
        if (categories.length !== new Set(decisions.map((item) => item.categoryId)).size)
          return missing("Every categorization must use one of your categories.");
        const accounts = await executor
          .select()
          .from(financeAccounts)
          .where(
            and(
              eq(financeAccounts.userId, userId),
              inArray(
                financeAccounts.id,
                transactions.map((item) => item.accountId),
              ),
            ),
          );
        const sourceRefs: MaterialSourceReference[] = [];
        for (const item of transactions) {
          const account = accounts.find((candidate) => candidate.id === item.accountId);
          if (!account) return missing("A transaction account is unavailable.");
          sourceRefs.push(transactionSource(item, account));
        }
        return prepared(
          input,
          stableJson(transactions.map((item) => [item.id, item.updatedAt.toISOString()]).sort()),
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
          return missing("Provide a valid merchant change and merchant ID.");
        const merchants = await executor
          .select()
          .from(financeMerchants)
          .where(and(eq(financeMerchants.userId, userId), inArray(financeMerchants.id, ids)));
        if (merchants.length !== ids.length)
          return missing("Choose only merchants that belong to you.");
        const revision = stableJson(
          merchants.map((item) => [item.id, item.updatedAt.toISOString()]).sort(),
        );
        return prepared(
          { ...input, ...(merge ? {} : { id: ids[0] }) },
          revision,
          merge
            ? [
                {
                  entityId: ids[0] ?? null,
                  entityType: "finance_merchant",
                  summary: `Merge ${merchants[0]?.displayName} into ${merchants[1]?.displayName}.`,
                },
              ]
            : [
                {
                  entityId: ids[0] ?? null,
                  entityType: "finance_merchant",
                  summary: `Rename merchant to ${String(input.displayName)}.`,
                },
              ],
          merchants.map((item) => localSource(item.id, item.updatedAt.toISOString())),
        );
      }
      case "recurring_obligation": {
        const input = parse<Record<string, unknown>>(updateFinanceRecurringObligationInputSchema);
        const id = typeof rawInput.id === "string" ? rawInput.id : "";
        if (!input || !id) return missing("Provide a valid recurring-obligation ID and status.");
        const item = await row(
          executor
            .select()
            .from(financeRecurringObligations)
            .where(
              and(
                eq(financeRecurringObligations.id, id),
                eq(financeRecurringObligations.userId, userId),
              ),
            )
            .limit(1),
          "Choose one of your recurring obligations.",
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
        if (rawInput.operation === "refresh")
          return prepared(
            { operation: "refresh" },
            null,
            [
              {
                entityId: null,
                entityType: "finance_alert",
                summary: "Refresh Finance cash-flow insights.",
              },
            ],
            [],
          );
        const input = parse<Record<string, unknown>>(resolveFinanceAlertInputSchema);
        const id = typeof rawInput.id === "string" ? rawInput.id : "";
        if (!input || !id) return missing("Provide a valid Finance alert ID and resolution.");
        const item = await row(
          executor
            .select()
            .from(financeAlerts)
            .where(and(eq(financeAlerts.id, id), eq(financeAlerts.userId, userId)))
            .limit(1),
          "Choose one of your Finance alerts.",
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
            executor
              .select()
              .from(financeAccounts)
              .where(
                and(
                  eq(financeAccounts.id, String(create.accountId)),
                  eq(financeAccounts.userId, userId),
                ),
              )
              .limit(1),
            "Choose one of your Finance accounts.",
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
        if (!input || !id)
          return missing("Provide a valid transaction ID and a category or note change.");
        const item = await row(
          executor
            .select()
            .from(financeTransactions)
            .where(and(eq(financeTransactions.id, id), eq(financeTransactions.userId, userId)))
            .limit(1),
          "Choose one of your Finance transactions.",
        );
        if ("question" in item) return item;
        const [account] = await executor
          .select()
          .from(financeAccounts)
          .where(eq(financeAccounts.id, item.accountId))
          .limit(1);
        if (!account) return missing("The transaction account is unavailable.");
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
      case "income_stream": {
        const input = parse<Record<string, unknown>>(updateFinanceIncomeStreamInputSchema);
        const id = typeof rawInput.id === "string" ? rawInput.id : "";
        if (!input || !id) return missing("Provide a valid income-stream ID and status.");
        const item = await row(
          executor
            .select()
            .from(financeIncomeStreams)
            .where(and(eq(financeIncomeStreams.id, id), eq(financeIncomeStreams.userId, userId)))
            .limit(1),
          "Choose one of your income streams.",
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
    const privilegedContext = { ...context, financeReviewBypass: true };
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
      case "budget_plan":
        return "allocations" in input
          ? invoke(
              finances.setBudgetPlan,
              input as never,
              privilegedContext as never,
              executor as never,
            )
          : invoke(
              finances.createBudget,
              input as never,
              privilegedContext as never,
              executor as never,
            );
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
          ? invoke(finances.refreshCashflowInsights, context.principal.userId, executor as never)
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
    executor: Pick<Database, "select">,
  ) {
    const current = await prepare(prepared.actionKind, prepared.input, userId, executor);
    if ("status" in current) return current;
    if (current.expectedRevision !== prepared.expectedRevision) {
      return {
        question: question(
          prepared.actionKind,
          "The Finance records changed after this action was prepared. Refresh the evidence and submit a new action.",
        ),
        status: "needs_input" as const,
      };
    }
    return current;
  }

  async function queue(
    prepared: PreparedAction,
    context: MutationContext,
    executor: FinanceExecutor = db,
  ) {
    for (const key of prepared.semanticTargetKeys) {
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

  return {
    prepare,
    async performDirect<T>(
      actionKind: SupportedActionKind,
      input: Record<string, unknown>,
      context: MutationContext,
    ): Promise<FinanceActionOutcome<T>> {
      const prepared = await prepare(actionKind, input, context.principal.userId);
      if ("status" in prepared) {
        const [stored] = await db
          .insert(financeAgentActionReviews)
          .values({
            actionKind: "question",
            expectedRevision: null,
            fingerprint: actionFingerprint("question", { actionKind, input }),
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
                actionFingerprint("question", { actionKind, input }),
              ),
              eq(financeAgentActionReviews.status, "pending"),
            ),
          )
          .limit(1);
        if (!existing) throw new Error("The Finance question could not be saved.");
        const payload = existing.privatePayload as { question: FinanceQuestion };
        return { question: { ...payload.question, id: existing.id }, status: "needs_input" };
      }
      if (
        context.principal.actorType === "agent" &&
        !(await readBypass(db, context.principal.userId))
      ) {
        return {
          review: (await queue(prepared, context)) as FinancePendingActionReview,
          status: "pending_review",
        };
      }
      // Lock and re-read immediately before the semantic writer. This closes
      // the setting TOCTOU window for agent actions without accepting token or
      // request-body bypass authority.
      if (context.principal.actorType === "agent") {
        return db.transaction(async (tx) => {
          if (!(await readBypass(tx, context.principal.userId, true))) {
            return {
              review: (await queue(prepared, context, tx)) as FinancePendingActionReview,
              status: "pending_review",
            };
          }
          const current = await revalidate(prepared, context.principal.userId, tx);
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
          actionKind: review.actionKind as SupportedActionKind,
          expectedRevision: review.expectedRevision,
          fingerprint: review.fingerprint,
          input: payload.input,
          rationale: payload.rationale,
          safeChanges: review.safeChanges as FinanceSafeChange[],
          assumptions: payload.assumptions ?? [],
          sourceRefs: review.sourceRefs as MaterialSourceReference[],
          semanticTargetKeys: review.semanticTargetKeys as string[],
        };
        const current = await revalidate(prepared, context.principal.userId, tx);
        if ("status" in current) {
          await tx
            .update(financeAgentActionReviews)
            .set({ status: "superseded", updatedAt: now() })
            .where(eq(financeAgentActionReviews.id, review.id));
          return current;
        }
        const result = await applyPrepared(current, context, tx);
        await tx
          .update(financeAgentActionReviews)
          .set({ privatePayload: { ...payload, result }, status: "applied", updatedAt: now() })
          .where(eq(financeAgentActionReviews.id, review.id));
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
        const payload = review.privatePayload as {
          answer?: string;
          original: { actionKind: SupportedActionKind; input: Record<string, unknown> };
          outcome?: FinanceActionOutcome<unknown>;
          question: FinanceQuestion;
        };
        if (review.status !== "pending") {
          if (payload.answer === answerValue && payload.outcome) return payload.outcome;
          throw new AppError("conflict", "This Finance question has already been answered.");
        }
        let supplied: Record<string, unknown>;
        try {
          const parsed = JSON.parse(answerValue);
          if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
          supplied = parsed as Record<string, unknown>;
        } catch {
          const outcome: FinanceActionOutcome<unknown> = {
            question: {
              ...question(
                payload.original.actionKind,
                "Answer with the bounded fields requested for this Finance action.",
              ),
              id: review.id,
            },
            status: "needs_input",
          };
          await tx
            .update(financeAgentActionReviews)
            .set({
              privatePayload: { ...payload, answer: answerValue, outcome },
              status: "superseded",
              updatedAt: now(),
            })
            .where(eq(financeAgentActionReviews.id, review.id));
          return outcome;
        }
        const prepared = await prepare(
          payload.original.actionKind,
          { ...payload.original.input, ...supplied },
          context.principal.userId,
          tx,
        );
        let outcome: FinanceActionOutcome<unknown>;
        if ("status" in prepared) {
          outcome = prepared;
        } else if (
          context.principal.actorType === "agent" &&
          !(await readBypass(tx, context.principal.userId, true))
        ) {
          outcome = {
            review: (await queue(prepared, context, tx)) as FinancePendingActionReview,
            status: "pending_review",
          };
        } else {
          const current = await revalidate(prepared, context.principal.userId, tx);
          outcome =
            "status" in current
              ? current
              : { result: await applyPrepared(current, context, tx), status: "applied" };
        }
        await tx
          .update(financeAgentActionReviews)
          .set({
            privatePayload: { ...payload, answer: answerValue, outcome },
            status: "superseded",
            updatedAt: now(),
          })
          .where(eq(financeAgentActionReviews.id, review.id));
        return outcome;
      });
    },
  };
}
