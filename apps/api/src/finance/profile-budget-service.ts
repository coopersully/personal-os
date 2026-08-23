import {
  auditEvents,
  type Database,
  financeAccounts,
  financeBudgetAllocations,
  financeBudgetPlans,
  financeBudgetVersions,
  financeCategories,
  financeGoals,
  financeProfileVersions,
} from "@personal-os/database";
import type {
  ApproveFinanceBudgetInput,
  CreateFinanceBudgetVersionInput,
  FinanceBudgetAllocation,
  FinanceBudgetResource,
  FinanceBudgetVersion,
  FinanceChange,
  FinanceGoal,
  FinanceProfileVersion,
  FinanceProvenance,
  FinanceToolResult,
  ManageFinanceGoalInput,
  ReviseFinanceBudgetInput,
  UpdateFinancialProfileInput,
} from "@personal-os/domain";
import { and, desc, eq, inArray } from "drizzle-orm";
import { auditValues } from "../audit.js";
import { AppError } from "../errors.js";
import {
  executeFinanceIdempotently,
  type FinanceMutationContext,
  requireFinanceMutation,
} from "./context.js";

type Options = { db: Database; now: () => Date };

const defaultPreferences = {
  bufferTarget: null,
  debtPriority: null,
  emergencyReserveMonths: null,
  notes: [],
} as const;

function toCents(amount: number): number {
  return Math.round((amount + Number.EPSILON) * 100);
}

function fromCents(amount: number): number {
  return Math.round(amount) / 100;
}

function formatMoney(amount: number): string {
  return new Intl.NumberFormat("en-US", { currency: "USD", style: "currency" }).format(amount);
}

function result<T>(input: {
  changes?: FinanceChange[];
  data: T;
  disclosures?: string[];
  headline: string;
}): FinanceToolResult<T> {
  return {
    changes: input.changes ?? [],
    communication: {
      headline: input.headline,
      optionalDetails: [],
      requiredDisclosures: (input.disclosures ?? []).map((message) => ({
        importance: "important" as const,
        message,
      })),
    },
    data: input.data,
    outcome: "completed",
    remainingWork: { categories: [], count: 0 },
    schemaVersion: 1,
  };
}

function provenance(context: FinanceMutationContext, now: Date): FinanceProvenance {
  return {
    actorId: context.actorId,
    actorType: context.actorType,
    confidence: 1,
    evidence: {},
    maintenanceRunId: null,
    observedAt: now.toISOString(),
    requestId: context.requestId,
    sourceId: null,
  };
}

function profileValue(row: typeof financeProfileVersions.$inferSelect): FinanceProfileVersion {
  return {
    createdAt: row.createdAt.toISOString(),
    debts: row.debts as FinanceProfileVersion["debts"],
    dependents: row.dependents,
    expectedMonthlyTakeHome:
      row.expectedMonthlyTakeHome === null ? null : fromCents(row.expectedMonthlyTakeHome),
    householdSize: row.householdSize,
    id: row.id,
    incomeStability: row.incomeStability,
    insurance: row.insurance as FinanceProfileVersion["insurance"],
    jurisdiction: row.jurisdiction,
    liquidReserves: row.liquidReserves === null ? null : fromCents(row.liquidReserves),
    preferences: row.preferences as FinanceProfileVersion["preferences"],
    provenance: row.provenance as FinanceProfileVersion["provenance"],
    userId: row.userId,
    version: row.version,
  };
}

function goalValue(row: typeof financeGoals.$inferSelect): FinanceGoal {
  return {
    createdAt: row.createdAt.toISOString(),
    currentAmount: fromCents(row.currentAmount),
    deadline: row.deadline,
    id: row.id,
    name: row.name,
    priority: row.priority,
    status: row.status,
    targetAmount: fromCents(row.targetAmount),
    updatedAt: row.updatedAt.toISOString(),
    version: row.version,
  };
}

export function createProfileBudgetService({ db, now }: Options) {
  async function latestProfile(userId: string) {
    return db.query.financeProfileVersions.findFirst({
      orderBy: [desc(financeProfileVersions.version)],
      where: eq(financeProfileVersions.userId, userId),
    });
  }

  async function ownedGoal(userId: string, goalId: string) {
    const row = await db.query.financeGoals.findFirst({
      where: and(eq(financeGoals.userId, userId), eq(financeGoals.id, goalId)),
    });
    if (!row) throw new AppError("not_found", "That financial goal was not found.");
    return row;
  }

  async function validateAllocations(userId: string, allocations: FinanceBudgetAllocation[]) {
    const categoryIds = allocations.flatMap((allocation) =>
      allocation.kind === "spending" && allocation.categoryId ? [allocation.categoryId] : [],
    );
    if (
      allocations.some((allocation) => allocation.kind === "spending" && !allocation.categoryId)
    ) {
      throw new AppError("invalid_request", "Every new spending allocation needs a category.");
    }
    if (categoryIds.length > 0) {
      const rows = await db
        .select({ id: financeCategories.id })
        .from(financeCategories)
        .where(
          and(eq(financeCategories.userId, userId), inArray(financeCategories.id, categoryIds)),
        );
      if (new Set(rows.map((row) => row.id)).size !== new Set(categoryIds).size) {
        throw new AppError("invalid_request", "A budget category does not belong to this user.");
      }
    }
    const accountIds = allocations.flatMap((allocation) =>
      allocation.kind === "debt" ? [allocation.accountId] : [],
    );
    if (accountIds.length > 0) {
      const rows = await db
        .select({ id: financeAccounts.id })
        .from(financeAccounts)
        .where(and(eq(financeAccounts.userId, userId), inArray(financeAccounts.id, accountIds)));
      if (new Set(rows.map((row) => row.id)).size !== new Set(accountIds).size) {
        throw new AppError("invalid_request", "A budget account does not belong to this user.");
      }
    }
    const goalIds = allocations.flatMap((allocation) => {
      if (allocation.kind === "goal") return [allocation.goalId];
      if (allocation.kind === "savings" && allocation.goalId) return [allocation.goalId];
      return [];
    });
    if (goalIds.length > 0) {
      const rows = await db
        .select({ id: financeGoals.id })
        .from(financeGoals)
        .where(and(eq(financeGoals.userId, userId), inArray(financeGoals.id, goalIds)));
      if (new Set(rows.map((row) => row.id)).size !== new Set(goalIds).size) {
        throw new AppError("invalid_request", "A budget goal does not belong to this user.");
      }
    }
  }

  async function budgetValue(row: typeof financeBudgetVersions.$inferSelect) {
    const allocationRows = await db
      .select()
      .from(financeBudgetAllocations)
      .where(eq(financeBudgetAllocations.budgetVersionId, row.id));
    const allocations = allocationRows.map((allocation): FinanceBudgetAllocation => {
      const base = {
        amount: fromCents(allocation.amount),
        ...(allocation.description ? { description: allocation.description } : {}),
        key: allocation.allocationKey,
      };
      if (allocation.kind === "spending") {
        return {
          ...base,
          ...(allocation.categoryId ? { categoryId: allocation.categoryId } : {}),
          kind: "spending",
          ...(allocation.legacyCategory ? { legacyCategory: allocation.legacyCategory } : {}),
        };
      }
      if (allocation.kind === "debt") {
        if (!allocation.accountId)
          throw new AppError("internal_error", "A debt allocation lost its account.");
        return { ...base, accountId: allocation.accountId, kind: "debt" };
      }
      if (allocation.kind === "goal") {
        if (!allocation.goalId)
          throw new AppError("internal_error", "A goal allocation lost its goal.");
        return { ...base, goalId: allocation.goalId, kind: "goal" };
      }
      if (allocation.kind === "savings") {
        return {
          ...base,
          ...(allocation.goalId ? { goalId: allocation.goalId } : {}),
          kind: "savings",
        };
      }
      return { ...base, kind: "buffer" };
    });
    return {
      allocatedTotal: fromCents(row.allocatedTotal),
      allocations,
      approvedAt: row.approvedAt?.toISOString() ?? null,
      assumptions: row.assumptions,
      balanceDelta: fromCents(row.balanceDelta),
      createdAt: row.createdAt.toISOString(),
      effectiveFrom: row.effectiveFrom,
      expectedResources: fromCents(row.expectedResources),
      id: row.id,
      planId: row.planId,
      rationale: row.rationale,
      resources: (row.resources as FinanceBudgetResource[]).map((resource) => ({
        ...resource,
        amount: fromCents(resource.amount),
      })),
      status: row.status,
      version: row.version,
    } satisfies FinanceBudgetVersion;
  }

  async function insertBudgetVersion(
    input: CreateFinanceBudgetVersionInput,
    context: FinanceMutationContext,
    existingPlan?: { id: string; latestVersion: number },
  ) {
    await validateAllocations(context.userId, input.allocations);
    const resourceTotal = input.resources.reduce((sum, item) => sum + toCents(item.amount), 0);
    const allocatedTotal = input.allocations.reduce((sum, item) => sum + toCents(item.amount), 0);
    if (resourceTotal !== allocatedTotal) {
      throw new AppError(
        "invalid_request",
        "A complete budget must assign every expected resource or show an explicit funding source.",
      );
    }
    const row = await db.transaction(async (tx) => {
      let planId = existingPlan?.id;
      if (!planId) {
        const [plan] = await tx
          .insert(financeBudgetPlans)
          .values({ name: input.name, userId: context.userId })
          .returning();
        if (!plan) throw new AppError("internal_error", "The budget plan was not created.");
        planId = plan.id;
      }
      const [version] = await tx
        .insert(financeBudgetVersions)
        .values({
          allocatedTotal,
          assumptions: input.assumptions,
          balanceDelta: resourceTotal - allocatedTotal,
          createdByActorId: context.actorId,
          createdByActorType: context.actorType,
          effectiveFrom: input.effectiveFrom,
          expectedResources: resourceTotal,
          planId,
          rationale: input.rationale,
          resources: input.resources.map((resource) => ({
            ...resource,
            amount: toCents(resource.amount),
          })),
          status: "proposed",
          userId: context.userId,
          version: (existingPlan?.latestVersion ?? 0) + 1,
        })
        .returning();
      if (!version) throw new AppError("internal_error", "The budget version was not created.");
      await tx.insert(financeBudgetAllocations).values(
        input.allocations.map((allocation) => ({
          accountId: allocation.kind === "debt" ? allocation.accountId : null,
          allocationKey: allocation.key,
          amount: toCents(allocation.amount),
          budgetVersionId: version.id,
          categoryId: allocation.kind === "spending" ? (allocation.categoryId ?? null) : null,
          description: allocation.description ?? null,
          goalId:
            allocation.kind === "goal" || allocation.kind === "savings"
              ? (allocation.goalId ?? null)
              : null,
          kind: allocation.kind,
          legacyCategory:
            allocation.kind === "spending" ? (allocation.legacyCategory ?? null) : null,
          userId: context.userId,
        })),
      );
      await tx.insert(auditEvents).values(
        auditValues({
          action: existingPlan ? "finance.budget.revised" : "finance.budget.created",
          after: { planId, version: version.version },
          before: existingPlan ? { version: existingPlan.latestVersion } : null,
          entityId: version.id,
          entityType: "finance_budget_version",
          principal: context,
          requestId: context.requestId,
        }),
      );
      return version;
    });
    return budgetValue(row);
  }

  function budgetDisclosures(budget: FinanceBudgetVersion): string[] {
    return [
      `Expected resources: ${formatMoney(budget.expectedResources)}. Total allocated: ${formatMoney(budget.allocatedTotal)}. Balance: ${formatMoney(budget.balanceDelta)}.`,
      ...(budget.assumptions.length > 0
        ? [`Material assumptions: ${budget.assumptions.join("; ")}`]
        : []),
    ];
  }

  return {
    async getFinancialProfile(userId: string) {
      const row = await latestProfile(userId);
      return result({
        data: row ? profileValue(row) : null,
        headline: row ? "Your financial profile is current." : "No financial profile exists yet.",
      });
    },

    async updateFinancialProfile(
      input: UpdateFinancialProfileInput,
      context: FinanceMutationContext,
    ) {
      return executeFinanceIdempotently(
        db,
        context,
        {
          idempotencyKey: input.idempotencyKey,
          operation: "update_financial_profile",
          payload: input,
        },
        async () => {
          const before = await latestProfile(context.userId);
          const currentVersion = before?.version ?? 0;
          if (input.expectedVersion !== currentVersion) {
            throw new AppError(
              "conflict",
              `The financial profile is at version ${currentVersion}; reload it before updating.`,
            );
          }
          const observedAt = now();
          const previous = before
            ? profileValue(before)
            : {
                debts: [],
                dependents: null,
                expectedMonthlyTakeHome: null,
                householdSize: null,
                incomeStability: "unknown" as const,
                insurance: [],
                jurisdiction: null,
                liquidReserves: null,
                preferences: { ...defaultPreferences },
                provenance: {},
              };
          const next = { ...previous, ...input.changes };
          const nextProvenance = { ...previous.provenance };
          for (const field of Object.keys(input.changes)) {
            nextProvenance[field] = provenance(context, observedAt);
          }
          const [row] = await db
            .insert(financeProfileVersions)
            .values({
              debts: next.debts as unknown as Record<string, unknown>[],
              dependents: next.dependents,
              expectedMonthlyTakeHome:
                next.expectedMonthlyTakeHome == null ? null : toCents(next.expectedMonthlyTakeHome),
              householdSize: next.householdSize,
              incomeStability: next.incomeStability,
              insurance: next.insurance as unknown as Record<string, unknown>[],
              jurisdiction: next.jurisdiction,
              liquidReserves: next.liquidReserves == null ? null : toCents(next.liquidReserves),
              preferences: next.preferences,
              provenance: nextProvenance,
              userId: context.userId,
              version: currentVersion + 1,
            })
            .returning();
          if (!row) throw new AppError("internal_error", "The financial profile was not updated.");
          await db.insert(auditEvents).values(
            auditValues({
              action: "finance.profile.updated",
              after: { changedFields: Object.keys(input.changes), version: row.version },
              before: before ? { version: before.version } : null,
              entityId: row.id,
              entityType: "finance_profile_version",
              principal: context,
              requestId: context.requestId,
            }),
          );
          const data = profileValue(row);
          return result({
            changes: [
              {
                affectedEntityId: row.id,
                description: `Saved profile version ${row.version}.`,
                reversible: true,
                type: "profile_updated",
              },
            ],
            data,
            headline: "I saved that answer to your financial profile.",
          });
        },
      );
    },

    async getFinanceBudget(userId: string, planId?: string) {
      const row = await db.query.financeBudgetVersions.findFirst({
        orderBy: [desc(financeBudgetVersions.version)],
        where: planId
          ? and(eq(financeBudgetVersions.userId, userId), eq(financeBudgetVersions.planId, planId))
          : eq(financeBudgetVersions.userId, userId),
      });
      const data = row ? await budgetValue(row) : null;
      return result({
        data,
        disclosures: data ? budgetDisclosures(data) : [],
        headline: data
          ? `Budget version ${data.version} is ${data.status}.`
          : "No budget exists yet.",
      });
    },

    async createFinanceBudget(
      input: CreateFinanceBudgetVersionInput,
      context: FinanceMutationContext,
    ) {
      return executeFinanceIdempotently(
        db,
        context,
        {
          idempotencyKey: input.idempotencyKey,
          operation: "create_finance_budget",
          payload: input,
        },
        async () => {
          const data = await insertBudgetVersion(input, context);
          return result({
            changes: [
              {
                affectedEntityId: data.id,
                description: `Created proposed budget version ${data.version}.`,
                reversible: true,
                type: "budget_proposed",
              },
            ],
            data,
            disclosures: budgetDisclosures(data),
            headline: "I created a balanced budget proposal.",
          });
        },
      );
    },

    async reviseFinanceBudget(input: ReviseFinanceBudgetInput, context: FinanceMutationContext) {
      return executeFinanceIdempotently(
        db,
        context,
        {
          idempotencyKey: input.idempotencyKey,
          operation: "revise_finance_budget",
          payload: input,
        },
        async () => {
          const plan = await db.query.financeBudgetPlans.findFirst({
            where: and(
              eq(financeBudgetPlans.id, input.planId),
              eq(financeBudgetPlans.userId, context.userId),
            ),
          });
          if (!plan) throw new AppError("not_found", "That budget plan was not found.");
          const latest = await db.query.financeBudgetVersions.findFirst({
            orderBy: [desc(financeBudgetVersions.version)],
            where: eq(financeBudgetVersions.planId, plan.id),
          });
          if (!latest || latest.version !== input.expectedVersion) {
            throw new AppError(
              "conflict",
              `The budget is at version ${latest?.version ?? 0}; reload it before revising.`,
            );
          }
          const data = await insertBudgetVersion(input, context, {
            id: plan.id,
            latestVersion: latest.version,
          });
          return result({
            changes: [
              {
                affectedEntityId: data.id,
                description: `Created budget revision ${data.version}.`,
                reversible: true,
                type: "budget_revised",
              },
            ],
            data,
            disclosures: budgetDisclosures(data),
            headline: "I revised the budget and kept it balanced.",
          });
        },
      );
    },

    async approveFinanceBudget(input: ApproveFinanceBudgetInput, context: FinanceMutationContext) {
      requireFinanceMutation(context, { approvalSource: input.approvalSource });
      return executeFinanceIdempotently(
        db,
        context,
        {
          idempotencyKey: input.idempotencyKey,
          operation: "approve_finance_budget",
          payload: input,
        },
        async () => {
          const approvedAt = now();
          const row = await db.transaction(async (tx) => {
            const version = await tx.query.financeBudgetVersions.findFirst({
              where: and(
                eq(financeBudgetVersions.id, input.budgetVersionId),
                eq(financeBudgetVersions.userId, context.userId),
              ),
            });
            if (!version) throw new AppError("not_found", "That budget version was not found.");
            if (version.version !== input.expectedVersion) {
              throw new AppError("conflict", "The budget version changed before approval.");
            }
            if (version.status !== "proposed" || version.balanceDelta !== 0) {
              throw new AppError(
                "invalid_request",
                "Only a complete balanced proposal can be approved.",
              );
            }
            await tx
              .update(financeBudgetVersions)
              .set({ status: "retired", updatedAt: approvedAt })
              .where(
                and(
                  eq(financeBudgetVersions.userId, context.userId),
                  eq(financeBudgetVersions.effectiveFrom, version.effectiveFrom),
                  eq(financeBudgetVersions.status, "active"),
                ),
              );
            const [active] = await tx
              .update(financeBudgetVersions)
              .set({
                approvedAt,
                approvedByActorId: context.actorId,
                approvedByActorType: context.actorType,
                status: "active",
                updatedAt: approvedAt,
              })
              .where(eq(financeBudgetVersions.id, version.id))
              .returning();
            if (!active) throw new AppError("internal_error", "The budget was not activated.");
            await tx.insert(auditEvents).values(
              auditValues({
                action:
                  input.approvalSource === "agent_self_approval"
                    ? "finance.budget.agent_self_approved"
                    : "finance.budget.user_instruction_approved",
                after: { approvalSource: input.approvalSource, status: "active" },
                before: { status: version.status },
                entityId: active.id,
                entityType: "finance_budget_version",
                principal: context,
                requestId: context.requestId,
              }),
            );
            return active;
          });
          const data = await budgetValue(row);
          return result({
            changes: [
              {
                affectedEntityId: data.id,
                description: `Activated budget version ${data.version}.`,
                reversible: true,
                type: "budget_approved",
              },
            ],
            data,
            disclosures: budgetDisclosures(data),
            headline: "The balanced budget is now active.",
          });
        },
      );
    },

    async getFinanceBudgetStatus(userId: string) {
      const row = await db.query.financeBudgetVersions.findFirst({
        orderBy: [desc(financeBudgetVersions.effectiveFrom), desc(financeBudgetVersions.version)],
        where: and(
          eq(financeBudgetVersions.userId, userId),
          eq(financeBudgetVersions.status, "active"),
        ),
      });
      const data = row ? await budgetValue(row) : null;
      return result({
        data,
        disclosures: data ? budgetDisclosures(data) : [],
        headline: data ? "Your active budget is balanced." : "There is no active budget.",
      });
    },

    async listFinanceGoals(userId: string) {
      const rows = await db
        .select()
        .from(financeGoals)
        .where(eq(financeGoals.userId, userId))
        .orderBy(desc(financeGoals.updatedAt));
      return result({
        data: rows.map(goalValue),
        headline: `Found ${rows.length} financial goals.`,
      });
    },

    async manageFinanceGoal(input: ManageFinanceGoalInput, context: FinanceMutationContext) {
      return executeFinanceIdempotently(
        db,
        context,
        {
          idempotencyKey: input.idempotencyKey,
          operation: `manage_finance_goal:${input.operation}`,
          payload: input,
        },
        async () => {
          if (input.operation === "create") {
            const [row] = await db
              .insert(financeGoals)
              .values({
                deadline: input.deadline,
                name: input.name,
                priority: input.priority,
                targetAmount: toCents(input.targetAmount),
                userId: context.userId,
              })
              .returning();
            if (!row) throw new AppError("internal_error", "The financial goal was not created.");
            await db.insert(auditEvents).values(
              auditValues({
                action: "finance.goal.created",
                after: { name: row.name, targetAmount: input.targetAmount, version: row.version },
                before: null,
                entityId: row.id,
                entityType: "finance_goal",
                principal: context,
                requestId: context.requestId,
              }),
            );
            return result({
              changes: [
                {
                  affectedEntityId: row.id,
                  description: `Created financial goal “${row.name}”.`,
                  reversible: true,
                  type: "goal_created",
                },
              ],
              data: goalValue(row),
              headline: "I created the financial goal.",
            });
          }
          const before = await ownedGoal(context.userId, input.goalId);
          if (before.version !== input.expectedVersion) {
            throw new AppError(
              "conflict",
              `The financial goal is at version ${before.version}; reload it before changing it.`,
            );
          }
          const changes =
            input.operation === "update"
              ? {
                  ...(input.changes.deadline !== undefined
                    ? { deadline: input.changes.deadline }
                    : {}),
                  ...(input.changes.name !== undefined ? { name: input.changes.name } : {}),
                  ...(input.changes.priority !== undefined
                    ? { priority: input.changes.priority }
                    : {}),
                  ...(input.changes.targetAmount !== undefined
                    ? { targetAmount: toCents(input.changes.targetAmount) }
                    : {}),
                }
              : {
                  status:
                    input.operation === "complete"
                      ? ("completed" as const)
                      : input.operation === "pause"
                        ? ("paused" as const)
                        : input.operation === "remove"
                          ? ("removed" as const)
                          : ("active" as const),
                };
          const [row] = await db
            .update(financeGoals)
            .set({ ...changes, updatedAt: now(), version: before.version + 1 })
            .where(eq(financeGoals.id, before.id))
            .returning();
          if (!row) throw new AppError("internal_error", "The financial goal was not updated.");
          await db.insert(auditEvents).values(
            auditValues({
              action: `finance.goal.${input.operation}`,
              after: { status: row.status, version: row.version },
              before: { status: before.status, version: before.version },
              entityId: row.id,
              entityType: "finance_goal",
              principal: context,
              requestId: context.requestId,
            }),
          );
          return result({
            changes: [
              {
                affectedEntityId: row.id,
                description: `Applied ${input.operation} to financial goal “${row.name}”.`,
                reversible: input.operation !== "complete",
                type: `goal_${input.operation}`,
              },
            ],
            data: goalValue(row),
            headline: "I updated the financial goal.",
          });
        },
      );
    },
  };
}
