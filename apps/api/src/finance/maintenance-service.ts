import {
  type Database,
  financeAuditFindings,
  financeBudgetVersions,
  financeCategories,
  financeCategoryRules,
  financeEconomicEvents,
  financeEventTransactions,
  financeMaintenanceJudgments,
  financeMaintenanceRuns,
  financeTransactionRelationships,
  financeTransactionRevisions,
  financeTransactions,
} from "@personal-os/database";
import type {
  FinanceMaintenanceHistoryQuery,
  FinanceMaintenanceInput,
  FinanceMaintenancePayload,
  FinanceMaintenanceStage,
  FinanceReasoningItem,
  FinanceToolResult,
} from "@personal-os/domain";
import { ILO_FINANCE_PLAYBOOK } from "@personal-os/domain";
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { AppError } from "../errors.js";
import {
  executeFinanceIdempotently,
  type FinanceMutationContext,
  requireFinanceMutation,
} from "./context.js";
import type { createInboxService } from "./inbox-service.js";
import { nextFinanceTransactionRevision } from "./transaction-revision-lock.js";

type Options = {
  db: Database;
  inbox: ReturnType<typeof createInboxService>;
  now: () => Date;
};
type FinanceExecutor = Pick<Database, "execute" | "insert" | "query" | "select" | "update">;

function maintenanceResult(
  payload: FinanceMaintenancePayload,
  reviewCount: number,
): FinanceToolResult<FinanceMaintenancePayload> {
  const complete = payload.stage === "settled";
  return {
    changes: [],
    communication: {
      headline: complete
        ? reviewCount
          ? `Maintenance settled with ${reviewCount} transaction reviews in the Inbox.`
          : "Maintenance completed and the budget is balanced."
        : payload.stage === "agent_reasoning"
          ? `Deterministic rules finished; ${payload.reasoningBatch.length} transactions need agent judgment.`
          : "Categorization and reconciliation finished; audit the recent activity as a whole.",
      optionalDetails: [],
      requiredDisclosures: [],
    },
    data: payload,
    ...(complete
      ? {}
      : {
          nextAction: {
            arguments: {
              operation: payload.stage === "agent_reasoning" ? "submit_judgments" : "submit_audit",
              runId: payload.runId,
            },
            reason:
              payload.stage === "agent_reasoning"
                ? "Submit bounded classifications, relationships, or review judgments."
                : "Submit red-team findings after reviewing the supplied recent activity.",
            tool: "maintain_finances",
          },
        }),
    outcome: complete ? "completed" : "work_remaining",
    remainingWork: { categories: reviewCount ? ["finance_inbox"] : [], count: reviewCount },
    schemaVersion: 1,
  };
}

export function createMaintenanceService({ db, inbox, now }: Options) {
  const normalizeMerchant = (value: string) =>
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();

  function scopedTransactionConditions(userId: string, scope: Record<string, unknown>) {
    const conditions = [
      eq(financeTransactions.userId, userId),
      eq(financeTransactions.needsReview, true),
    ];
    const accountIds =
      scope.type === "accounts" && Array.isArray(scope.accountIds)
        ? (scope.accountIds as string[])
        : null;
    const from = scope.type === "since" && typeof scope.from === "string" ? scope.from : null;
    if (accountIds?.length) conditions.push(inArray(financeTransactions.accountId, accountIds));
    if (from) conditions.push(gte(financeTransactions.transactionDate, from));
    return conditions;
  }

  async function applyDeterministicRules(
    userId: string,
    runId: string,
    scope: Record<string, unknown>,
  ) {
    const [rules, transactions, categories] = await Promise.all([
      db.select().from(financeCategoryRules).where(eq(financeCategoryRules.userId, userId)),
      db
        .select()
        .from(financeTransactions)
        .where(and(...scopedTransactionConditions(userId, scope))),
      db.select().from(financeCategories).where(eq(financeCategories.userId, userId)),
    ]);
    const ruleByMerchant = new Map(rules.map((rule) => [rule.merchantNormalized, rule]));
    const categoryByName = new Map(categories.map((category) => [category.name, category]));
    for (const transaction of transactions) {
      const rule = ruleByMerchant.get(normalizeMerchant(transaction.merchant));
      const category = rule ? categoryByName.get(rule.category) : undefined;
      if (!rule || !category) continue;
      await db.transaction(async (tx) => {
        const version = await nextFinanceTransactionRevision(tx, transaction.id);
        await tx.insert(financeTransactionRevisions).values({
          changes: { category: { after: category.name, before: transaction.category } },
          provenance: {
            actorId: rule.id,
            actorType: "deterministic_rule",
            confidence: 1,
            maintenanceRunId: runId,
            source: "finance_category_rule",
          },
          transactionId: transaction.id,
          userId,
          version,
        });
        await tx
          .update(financeTransactions)
          .set({
            category: category.name,
            categoryConfidence: 10_000,
            categoryDecidedAt: now(),
            categoryId: category.id,
            categoryRationale: "Applied an existing exact merchant rule.",
            categorySource: "rule",
            needsReview: false,
            updatedAt: now(),
          })
          .where(eq(financeTransactions.id, transaction.id));
      });
    }
  }

  async function ownedRun(userId: string, runId: string, executor: FinanceExecutor = db) {
    const row = await executor.query.financeMaintenanceRuns.findFirst({
      where: and(eq(financeMaintenanceRuns.id, runId), eq(financeMaintenanceRuns.userId, userId)),
    });
    if (!row) throw new AppError("not_found", "That Finance maintenance run was not found.");
    return row;
  }

  async function openReviewCount(userId: string, executor: FinanceExecutor = db) {
    return (await inbox.getFinanceInbox(userId, executor)).remainingWork.count;
  }

  async function reasoningBatch(
    userId: string,
    scope: Record<string, unknown>,
    executor: FinanceExecutor = db,
  ): Promise<FinanceReasoningItem[]> {
    const categories = await executor
      .select({ id: financeCategories.id, name: financeCategories.name })
      .from(financeCategories)
      .where(eq(financeCategories.userId, userId));
    const transactions = await executor
      .select()
      .from(financeTransactions)
      .where(and(...scopedTransactionConditions(userId, scope)))
      .orderBy(financeTransactions.transactionDate)
      .limit(100);
    const activeBudget = await executor.query.financeBudgetVersions.findFirst({
      orderBy: [desc(financeBudgetVersions.effectiveFrom), desc(financeBudgetVersions.version)],
      where: and(
        eq(financeBudgetVersions.userId, userId),
        eq(financeBudgetVersions.status, "active"),
      ),
    });
    return transactions.map((transaction) => ({
      accountId: transaction.accountId,
      amount: transaction.amount / 100,
      budgetContext: activeBudget
        ? { effectiveFrom: activeBudget.effectiveFrom, versionId: activeBudget.id }
        : {},
      candidateRelationships: [],
      categoryChoices: categories,
      date: transaction.transactionDate,
      existingPreferences: [],
      merchant: transaction.merchant,
      transactionId: transaction.id,
    }));
  }

  async function auditContext(userId: string, executor: FinanceExecutor = db) {
    const rows = await executor
      .select({
        amount: financeTransactions.amount,
        category: financeTransactions.category,
        date: financeTransactions.transactionDate,
        direction: financeTransactions.direction,
        id: financeTransactions.id,
        merchant: financeTransactions.merchant,
      })
      .from(financeTransactions)
      .where(eq(financeTransactions.userId, userId))
      .orderBy(desc(financeTransactions.transactionDate))
      .limit(200);
    return { recentTransactions: rows.map((row) => ({ ...row, amount: row.amount / 100 })) };
  }

  async function payloadFor(
    run: typeof financeMaintenanceRuns.$inferSelect,
    executor: FinanceExecutor = db,
  ): Promise<FinanceMaintenancePayload> {
    return {
      auditContext: run.stage === "agent_audit" ? await auditContext(run.userId, executor) : null,
      reasoningBatch:
        run.stage === "agent_reasoning"
          ? await reasoningBatch(run.userId, run.scope, executor)
          : [],
      reviewQuestion: null,
      playbookVersion: ILO_FINANCE_PLAYBOOK.version,
      runId: run.id,
      stage: run.stage,
      version: run.version,
    };
  }

  async function ensureEvent(executor: FinanceExecutor, userId: string, transactionId: string) {
    const stableKey = `transaction:${transactionId}`;
    const transaction = await executor.query.financeTransactions.findFirst({
      where: and(eq(financeTransactions.id, transactionId), eq(financeTransactions.userId, userId)),
    });
    if (!transaction) throw new AppError("invalid_request", "A judged transaction was not found.");
    const kind =
      transaction.direction === "income"
        ? "income"
        : transaction.direction === "transfer"
          ? "transfer"
          : "purchase";
    const [created] = await executor
      .insert(financeEconomicEvents)
      .values({ kind, stableKey, userId })
      .onConflictDoUpdate({
        set: { updatedAt: now() },
        target: [financeEconomicEvents.userId, financeEconomicEvents.stableKey],
      })
      .returning();
    if (!created) throw new AppError("internal_error", "The economic event was not created.");
    await executor
      .insert(financeEventTransactions)
      .values({ economicEventId: created.id, transactionId, userId })
      .onConflictDoNothing();
    return created;
  }

  async function applyJudgment(
    executor: FinanceExecutor,
    run: typeof financeMaintenanceRuns.$inferSelect,
    judgment: Extract<
      FinanceMaintenanceInput,
      { operation: "submit_judgments" }
    >["judgments"][number],
    context: FinanceMutationContext,
    index: number,
  ) {
    await executor.insert(financeMaintenanceJudgments).values({
      judgmentKey: `${judgment.type}:${index}`,
      payload: judgment,
      provenance: {
        actorId: context.actorId,
        actorType: context.actorType,
        requestId: context.requestId,
      },
      runId: run.id,
      type: judgment.type,
      userId: context.userId,
    });
    if (judgment.type === "classify_transaction") {
      const category = await executor.query.financeCategories.findFirst({
        where: and(
          eq(financeCategories.id, judgment.categoryId),
          eq(financeCategories.userId, context.userId),
        ),
      });
      const transaction = await executor.query.financeTransactions.findFirst({
        where: and(
          eq(financeTransactions.id, judgment.transactionId),
          eq(financeTransactions.userId, context.userId),
        ),
      });
      if (!category || !transaction)
        throw new AppError("invalid_request", "A classification target was not found.");
      const version = await nextFinanceTransactionRevision(executor, transaction.id);
      await executor.insert(financeTransactionRevisions).values({
        changes: {
          category: { after: category.name, before: transaction.category },
          meaning: judgment.meaning,
        },
        provenance: {
          actorId: context.actorId,
          actorType: context.actorType,
          confidence: judgment.confidence,
          maintenanceRunId: run.id,
          requestId: context.requestId,
        },
        transactionId: transaction.id,
        userId: context.userId,
        version,
      });
      await executor
        .update(financeTransactions)
        .set({
          category: category.name,
          categoryConfidence: Math.round(judgment.confidence * 10_000),
          categoryDecidedAt: now(),
          categoryId: category.id,
          categoryRationale: judgment.rationale,
          categorySource: "agent",
          needsReview: false,
          updatedAt: now(),
        })
        .where(eq(financeTransactions.id, transaction.id));
    } else if (judgment.type === "needs_user_review") {
      const event = await ensureEvent(executor, context.userId, judgment.transactionId);
      const transaction = await executor.query.financeTransactions.findFirst({
        where: eq(financeTransactions.id, judgment.transactionId),
      });
      if (!transaction) throw new AppError("invalid_request", "A review target was not found.");
      await inbox.upsertFinanceReview(
        {
          economicEventId: event.id,
          evidence: { questionReason: judgment.questionReason, merchant: transaction.merchant },
          impactAmount: Math.abs(transaction.amount) / 100,
          reason: "category_ambiguity",
          transactionId: transaction.id,
          userId: context.userId,
        },
        executor,
      );
    } else {
      const first = await ensureEvent(
        executor,
        context.userId,
        judgment.transactionIds[0] as string,
      );
      for (const transactionId of judgment.transactionIds.slice(1)) {
        const transaction = await executor.query.financeTransactions.findFirst({
          where: and(
            eq(financeTransactions.id, transactionId),
            eq(financeTransactions.userId, context.userId),
          ),
        });
        if (!transaction)
          throw new AppError("invalid_request", "A relationship target was not found.");
        await executor
          .insert(financeEventTransactions)
          .values({
            economicEventId: first.id,
            transactionId,
            userId: context.userId,
          })
          .onConflictDoNothing();
      }
      await executor.insert(financeTransactionRelationships).values({
        economicEventId: first.id,
        provenance: {
          actorId: context.actorId,
          actorType: context.actorType,
          confidence: judgment.confidence,
          maintenanceRunId: run.id,
          requestId: context.requestId,
        },
        rationale: judgment.rationale,
        relationship: judgment.relationship,
        transactionIds: judgment.transactionIds,
        userId: context.userId,
      });
    }
  }

  async function continuePreparation(run: typeof financeMaintenanceRuns.$inferSelect) {
    if (run.stage === "deterministic_processing") {
      await applyDeterministicRules(run.userId, run.id, run.scope);
      const batch = await reasoningBatch(run.userId, run.scope);
      const stage: FinanceMaintenanceStage = batch.length ? "agent_reasoning" : "agent_audit";
      const [advanced] = await db
        .update(financeMaintenanceRuns)
        .set({ stage, updatedAt: now(), version: run.version + 1 })
        .where(
          and(
            eq(financeMaintenanceRuns.id, run.id),
            eq(financeMaintenanceRuns.version, run.version),
          ),
        )
        .returning();
      if (!advanced) return ownedRun(run.userId, run.id);
      return advanced;
    }
    if (run.stage === "reconciliation") {
      const [advanced] = await db
        .update(financeMaintenanceRuns)
        .set({ stage: "agent_audit", updatedAt: now(), version: run.version + 1 })
        .where(
          and(
            eq(financeMaintenanceRuns.id, run.id),
            eq(financeMaintenanceRuns.version, run.version),
          ),
        )
        .returning();
      if (!advanced) return ownedRun(run.userId, run.id);
      return advanced;
    }
    return run;
  }

  return {
    async maintainFinances(input: FinanceMaintenanceInput, context: FinanceMutationContext) {
      requireFinanceMutation(context);
      if (input.operation === "start") {
        const run = await db.transaction(async (tx) => {
          await tx.execute(
            sql`select pg_advisory_xact_lock(hashtextextended(${`finance-maintenance-start:${context.userId}`}, 0))`,
          );
          const existing = await tx.query.financeMaintenanceRuns.findFirst({
            orderBy: [desc(financeMaintenanceRuns.updatedAt)],
            where: and(
              eq(financeMaintenanceRuns.userId, context.userId),
              inArray(financeMaintenanceRuns.stage, [
                "deterministic_processing",
                "agent_reasoning",
                "reconciliation",
                "agent_audit",
              ]),
            ),
          });
          if (existing) return existing;
          const [created] = await tx
            .insert(financeMaintenanceRuns)
            .values({
              scope: input.scope,
              stage: "deterministic_processing",
              userId: context.userId,
            })
            .returning();
          if (!created) throw new AppError("internal_error", "Maintenance did not start.");
          return created;
        });
        const advanced = await continuePreparation(run);
        return maintenanceResult(await payloadFor(advanced), await openReviewCount(context.userId));
      }
      if (input.operation === "resume") {
        const run = await continuePreparation(await ownedRun(context.userId, input.runId));
        return maintenanceResult(await payloadFor(run), await openReviewCount(context.userId));
      }
      return executeFinanceIdempotently(
        db,
        context,
        {
          idempotencyKey: input.idempotencyKey,
          operation: `maintain_finances:${input.operation}`,
          payload: input,
        },
        async (tx) => {
          const run = await ownedRun(context.userId, input.runId, tx);
          if (run.version !== input.expectedVersion)
            throw new AppError(
              "conflict",
              `Maintenance is at version ${run.version}; resume it before continuing.`,
            );
          if (input.operation === "submit_judgments") {
            if (run.stage !== "agent_reasoning")
              throw new AppError("conflict", "Maintenance is not awaiting judgments.");
            for (const [index, judgment] of input.judgments.entries()) {
              await applyJudgment(tx, run, judgment, context, index);
            }
            const [updated] = await tx
              .update(financeMaintenanceRuns)
              .set({ stage: "agent_audit", updatedAt: now(), version: run.version + 1 })
              .where(
                and(
                  eq(financeMaintenanceRuns.id, run.id),
                  eq(financeMaintenanceRuns.version, run.version),
                ),
              )
              .returning();
            if (!updated)
              throw new AppError("conflict", "Maintenance advanced in another request.");
            return maintenanceResult(
              await payloadFor(updated, tx),
              await openReviewCount(context.userId, tx),
            );
          }
          if (run.stage !== "agent_audit")
            throw new AppError("conflict", "Maintenance is not awaiting audit findings.");
          for (const finding of input.findings) {
            const stableKey = `${finding.economicEventId}:${finding.reason}`;
            await tx
              .insert(financeAuditFindings)
              .values({
                economicEventId: finding.economicEventId,
                evidence: finding.evidence,
                impactAmount: Math.round(finding.impactAmount * 100),
                rationale: finding.rationale,
                reasonCode: finding.reason,
                runId: run.id,
                stableKey,
                userId: context.userId,
              })
              .onConflictDoNothing();
            const eventTransaction = await tx.query.financeEventTransactions.findFirst({
              where: eq(financeEventTransactions.economicEventId, finding.economicEventId),
            });
            if (eventTransaction) {
              await inbox.upsertFinanceReview(
                {
                  economicEventId: finding.economicEventId,
                  evidence: finding.evidence,
                  impactAmount: finding.impactAmount,
                  reason: finding.reason,
                  transactionId: eventTransaction.transactionId,
                  userId: context.userId,
                },
                tx,
              );
            }
          }
          const [updated] = await tx
            .update(financeMaintenanceRuns)
            .set({ settledAt: now(), stage: "settled", updatedAt: now(), version: run.version + 1 })
            .where(
              and(
                eq(financeMaintenanceRuns.id, run.id),
                eq(financeMaintenanceRuns.version, run.version),
              ),
            )
            .returning();
          if (!updated) throw new AppError("conflict", "Maintenance advanced in another request.");
          return maintenanceResult(
            await payloadFor(updated, tx),
            await openReviewCount(context.userId, tx),
          );
        },
      );
    },

    async getFinanceMaintenanceHistory(userId: string, query: FinanceMaintenanceHistoryQuery) {
      const rows = await db
        .select()
        .from(financeMaintenanceRuns)
        .where(
          query.status
            ? and(
                eq(financeMaintenanceRuns.userId, userId),
                eq(financeMaintenanceRuns.stage, query.status),
              )
            : eq(financeMaintenanceRuns.userId, userId),
        )
        .orderBy(desc(financeMaintenanceRuns.createdAt))
        .limit(query.limit);
      return {
        items: await Promise.all(rows.map((row) => payloadFor(row))),
        nextCursor: null,
      };
    },
    async getFinanceMaintenanceRun(userId: string, runId: string) {
      return payloadFor(await ownedRun(userId, runId));
    },
  };
}
