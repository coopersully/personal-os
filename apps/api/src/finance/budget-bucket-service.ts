import {
  auditEvents,
  type Database,
  financeBudgetBucketCategories,
  financeBudgetBuckets,
  financeBudgets,
  financeBudgetTaxonomies,
  financeCategories,
  financeTransactions,
} from "@personal-os/database";
import type {
  CreateFinanceBudgetBucketInput,
  FinanceBudgetBucketList,
  FinanceBudgetBucketQuery,
  FinanceBudgetBucketTaxonomy,
  UpdateFinanceBudgetBucketInput,
} from "@personal-os/domain";
import { and, asc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { auditValues } from "../audit.js";
import { AppError } from "../errors.js";
import { executeFinanceIdempotently, type FinanceMutationContext } from "./context.js";

type MutationContext = {
  principal: { actorId: string; actorType: "agent" | "user"; userId: string };
  requestId: string;
};
type FinanceTransaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type FinanceExecutor = Pick<Database, "delete" | "execute" | "insert" | "select" | "update">;

function monthNow(now: () => Date) {
  return now().toISOString().slice(0, 7);
}

function snapshot(row: typeof financeBudgetBuckets.$inferSelect) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    position: row.position,
    version: row.version,
  };
}

export function createFinanceBudgetBucketService(input: { db: Database; now: () => Date }) {
  const { db, now } = input;

  async function taxonomyForUser(userId: string, executor: FinanceExecutor = db) {
    const [taxonomy] = await executor
      .select()
      .from(financeBudgetTaxonomies)
      .where(
        and(eq(financeBudgetTaxonomies.userId, userId), eq(financeBudgetTaxonomies.isActive, true)),
      )
      .limit(1);
    return taxonomy;
  }

  async function ensureTaxonomy(userId: string, executor: FinanceExecutor = db) {
    const existing = await taxonomyForUser(userId, executor);
    if (existing) return existing;
    const [created] = await executor
      .insert(financeBudgetTaxonomies)
      .values({ name: "My budget", userId })
      .onConflictDoNothing()
      .returning();
    const resolved = created ?? (await taxonomyForUser(userId, executor));
    if (!resolved)
      throw new AppError("internal_error", "The budget taxonomy could not be created.");
    return resolved;
  }

  async function list(
    userId: string,
    query: FinanceBudgetBucketQuery = {},
    executor: FinanceExecutor = db,
  ): Promise<FinanceBudgetBucketList> {
    const taxonomy = await taxonomyForUser(userId, executor);
    if (!taxonomy) return { taxonomy: null };
    const buckets = await executor
      .select()
      .from(financeBudgetBuckets)
      .where(
        and(
          eq(financeBudgetBuckets.userId, userId),
          eq(financeBudgetBuckets.taxonomyId, taxonomy.id),
        ),
      )
      .orderBy(asc(financeBudgetBuckets.position), asc(financeBudgetBuckets.name));
    const memberships = await executor
      .select()
      .from(financeBudgetBucketCategories)
      .where(eq(financeBudgetBucketCategories.taxonomyId, taxonomy.id));
    const month = query.month ?? monthNow(now);
    const budgets = await executor
      .select()
      .from(financeBudgets)
      .where(and(eq(financeBudgets.userId, userId), eq(financeBudgets.month, month)));
    const transactions = await executor
      .select()
      .from(financeTransactions)
      .where(
        and(
          eq(financeTransactions.userId, userId),
          gte(financeTransactions.transactionDate, `${month}-01`),
          lt(financeTransactions.transactionDate, `${month}-32`),
          eq(financeTransactions.pending, false),
        ),
      );
    const spent = new Map<string, number>();
    for (const transaction of transactions) {
      if (transaction.direction === "expense" && transaction.categoryId) {
        spent.set(
          transaction.categoryId,
          (spent.get(transaction.categoryId) ?? 0) + transaction.amount,
        );
      }
    }
    const budgeted = new Map<string | null, number>();
    for (const budget of budgets)
      budgeted.set(
        budget.bucketId ?? null,
        (budgeted.get(budget.bucketId ?? null) ?? 0) + budget.limit,
      );
    const categoriesByBucket = new Map<string, string[]>();
    for (const membership of memberships) {
      const ids = categoriesByBucket.get(membership.bucketId) ?? [];
      ids.push(membership.categoryId);
      categoriesByBucket.set(membership.bucketId, ids);
    }
    const rollups: FinanceBudgetBucketTaxonomy["rollups"] = buckets.map((bucket) => {
      const categoryIds = categoriesByBucket.get(bucket.id) ?? [];
      const actual = categoryIds.reduce((sum, id) => sum + (spent.get(id) ?? 0), 0);
      const planned = budgeted.get(bucket.id) ?? 0;
      return {
        bucketId: bucket.id,
        budgeted: planned / 100,
        categoryIds,
        label: bucket.name,
        remaining: (planned - actual) / 100,
        spent: actual / 100,
      };
    });
    const mapped = new Set(memberships.map((membership) => membership.categoryId));
    const unmappedBudget = budgets
      .filter((budget) => budget.bucketId === null)
      .reduce((sum, budget) => sum + budget.limit, 0);
    const unmappedSpent = transactions
      .filter(
        (transaction) =>
          transaction.direction === "expense" &&
          transaction.categoryId !== null &&
          !mapped.has(transaction.categoryId),
      )
      .reduce((sum, transaction) => sum + transaction.amount, 0);
    rollups.push({
      bucketId: null,
      budgeted: unmappedBudget / 100,
      categoryIds: [],
      label: "Unmapped categories",
      remaining: (unmappedBudget - unmappedSpent) / 100,
      spent: unmappedSpent / 100,
    });
    return {
      taxonomy: {
        buckets: buckets.map((bucket) => ({
          ...bucket,
          categories: categoriesByBucket.get(bucket.id) ?? [],
          createdAt: bucket.createdAt.toISOString(),
          updatedAt: bucket.updatedAt.toISOString(),
        })),
        createdAt: taxonomy.createdAt.toISOString(),
        description: taxonomy.description,
        id: taxonomy.id,
        isActive: taxonomy.isActive,
        name: taxonomy.name,
        rollups,
        updatedAt: taxonomy.updatedAt.toISOString(),
        version: taxonomy.version,
      },
    };
  }

  async function mutate(
    input: CreateFinanceBudgetBucketInput | UpdateFinanceBudgetBucketInput,
    context: MutationContext,
    executor?: FinanceTransaction,
  ): Promise<FinanceBudgetBucketTaxonomy> {
    const write = async (tx: FinanceExecutor) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`finance-budget-buckets:${context.principal.userId}`}, 0))`,
      );
      const taxonomy = await ensureTaxonomy(context.principal.userId, tx);
      if ("bucketId" in input) {
        const [before] = await tx
          .select()
          .from(financeBudgetBuckets)
          .where(
            and(
              eq(financeBudgetBuckets.id, input.bucketId),
              eq(financeBudgetBuckets.userId, context.principal.userId),
            ),
          )
          .limit(1);
        if (!before) throw new AppError("not_found", "The budget bucket was not found.");
        if (before.version !== input.expectedVersion)
          throw new AppError("conflict", "The budget bucket changed; refresh and try again.");
        if (input.categoryIds) {
          const categories = await tx
            .select({ id: financeCategories.id })
            .from(financeCategories)
            .where(
              and(
                eq(financeCategories.userId, context.principal.userId),
                inArray(financeCategories.id, input.categoryIds),
              ),
            );
          if (categories.length !== new Set(input.categoryIds).size)
            throw new AppError("not_found", "Every bucket category must belong to you.");
          await tx
            .delete(financeBudgetBucketCategories)
            .where(eq(financeBudgetBucketCategories.bucketId, before.id));
          if (input.categoryIds.length) {
            await tx
              .delete(financeBudgetBucketCategories)
              .where(
                and(
                  eq(financeBudgetBucketCategories.taxonomyId, taxonomy.id),
                  inArray(financeBudgetBucketCategories.categoryId, input.categoryIds),
                ),
              );
            await tx.insert(financeBudgetBucketCategories).values(
              input.categoryIds.map((categoryId) => ({
                categoryId,
                bucketId: before.id,
                taxonomyId: taxonomy.id,
                userId: context.principal.userId,
              })),
            );
          }
        }
        const [updated] = await tx
          .update(financeBudgetBuckets)
          .set({
            description: input.description,
            name: input.name,
            position: input.position,
            updatedAt: now(),
            version: before.version + 1,
          })
          .where(eq(financeBudgetBuckets.id, before.id))
          .returning();
        /* v8 ignore start -- the locked row still exists in this transaction, so UPDATE ... RETURNING yields it or throws. */
        if (!updated)
          throw new AppError("internal_error", "The budget bucket could not be updated.");
        /* v8 ignore stop */
        await tx.insert(auditEvents).values(
          auditValues({
            action: "finance.budget_bucket_updated",
            after: snapshot(updated),
            before: snapshot(before),
            entityId: before.id,
            entityType: "finance_budget_bucket",
            principal: context.principal,
            requestId: context.requestId,
          }),
        );
      } else {
        const [duplicate] = await tx
          .select({ id: financeBudgetBuckets.id })
          .from(financeBudgetBuckets)
          .where(
            and(
              eq(financeBudgetBuckets.taxonomyId, taxonomy.id),
              eq(financeBudgetBuckets.name, input.name),
            ),
          )
          .limit(1);
        if (duplicate)
          throw new AppError("conflict", "A budget bucket with that name already exists.");
        const [created] = await tx
          .insert(financeBudgetBuckets)
          .values({
            description: input.description,
            name: input.name,
            position: 0,
            taxonomyId: taxonomy.id,
            userId: context.principal.userId,
          })
          .returning();
        if (!created)
          throw new AppError("internal_error", "The budget bucket could not be created.");
        await tx.insert(auditEvents).values(
          auditValues({
            action: "finance.budget_bucket_created",
            after: snapshot(created),
            before: null,
            entityId: created.id,
            entityType: "finance_budget_bucket",
            principal: context.principal,
            requestId: context.requestId,
          }),
        );
      }
    };
    const mutationContext: FinanceMutationContext = {
      actorId: context.principal.actorId,
      actorType: context.principal.actorType,
      bypassEnabled: context.principal.actorType === "agent",
      canMutate: true,
      canSelfApprove: context.principal.actorType === "agent",
      requestId: context.requestId,
      userId: context.principal.userId,
    };
    return executeFinanceIdempotently(
      db,
      mutationContext,
      {
        idempotencyKey: input.idempotencyKey,
        operation:
          "bucketId" in input ? "finance.budget_bucket.update" : "finance.budget_bucket.create",
        payload: input,
      },
      async (tx) => {
        await write(tx);
        const result = await list(context.principal.userId, {}, tx);
        if (!result.taxonomy)
          throw new AppError("internal_error", "The budget taxonomy could not be loaded.");
        return result.taxonomy;
      },
      executor,
    );
  }

  return { list, mutate };
}
