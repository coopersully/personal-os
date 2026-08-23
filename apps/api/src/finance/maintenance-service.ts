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
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { AppError } from "../errors.js";
import {
  executeFinanceIdempotently,
  type FinanceMutationContext,
  requireFinanceMutation,
} from "./context.js";
import type { createInboxService } from "./inbox-service.js";

type Options = {
  db: Database;
  inbox: ReturnType<typeof createInboxService>;
  now: () => Date;
};

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

  async function applyDeterministicRules(userId: string, runId: string) {
    const [rules, transactions, categories] = await Promise.all([
      db.select().from(financeCategoryRules).where(eq(financeCategoryRules.userId, userId)),
      db
        .select()
        .from(financeTransactions)
        .where(
          and(eq(financeTransactions.userId, userId), eq(financeTransactions.needsReview, true)),
        ),
      db.select().from(financeCategories).where(eq(financeCategories.userId, userId)),
    ]);
    const ruleByMerchant = new Map(rules.map((rule) => [rule.merchantNormalized, rule]));
    const categoryByName = new Map(categories.map((category) => [category.name, category]));
    for (const transaction of transactions) {
      const rule = ruleByMerchant.get(normalizeMerchant(transaction.merchant));
      const category = rule ? categoryByName.get(rule.category) : undefined;
      if (!rule || !category) continue;
      const counts = await db
        .select({ count: sql<number>`count(*)::integer` })
        .from(financeTransactionRevisions)
        .where(eq(financeTransactionRevisions.transactionId, transaction.id));
      await db.insert(financeTransactionRevisions).values({
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
        version: (counts[0]?.count ?? 0) + 1,
      });
      await db
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
    }
  }

  async function ownedRun(userId: string, runId: string) {
    const row = await db.query.financeMaintenanceRuns.findFirst({
      where: and(eq(financeMaintenanceRuns.id, runId), eq(financeMaintenanceRuns.userId, userId)),
    });
    if (!row) throw new AppError("not_found", "That Finance maintenance run was not found.");
    return row;
  }

  async function openReviewCount(userId: string) {
    return (await inbox.getFinanceInbox(userId)).remainingWork.count;
  }

  async function reasoningBatch(
    userId: string,
    scope: Record<string, unknown>,
  ): Promise<FinanceReasoningItem[]> {
    const categories = await db
      .select({ id: financeCategories.id, name: financeCategories.name })
      .from(financeCategories)
      .where(eq(financeCategories.userId, userId));
    const accountIds =
      scope.type === "accounts" && Array.isArray(scope.accountIds)
        ? (scope.accountIds as string[])
        : null;
    const from = scope.type === "since" && typeof scope.from === "string" ? scope.from : null;
    const conditions = [
      eq(financeTransactions.userId, userId),
      eq(financeTransactions.needsReview, true),
    ];
    if (accountIds?.length) conditions.push(inArray(financeTransactions.accountId, accountIds));
    if (from) conditions.push(gte(financeTransactions.transactionDate, from));
    const transactions = await db
      .select()
      .from(financeTransactions)
      .where(and(...conditions))
      .orderBy(financeTransactions.transactionDate)
      .limit(100);
    const activeBudget = await db.query.financeBudgetVersions.findFirst({
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

  async function auditContext(userId: string) {
    const rows = await db
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
  ): Promise<FinanceMaintenancePayload> {
    return {
      auditContext: run.stage === "agent_audit" ? await auditContext(run.userId) : null,
      reasoningBatch:
        run.stage === "agent_reasoning" ? await reasoningBatch(run.userId, run.scope) : [],
      reviewQuestion: null,
      runId: run.id,
      stage: run.stage,
      version: run.version,
    };
  }

  async function ensureEvent(userId: string, transactionId: string) {
    const stableKey = `transaction:${transactionId}`;
    const existing = await db.query.financeEconomicEvents.findFirst({
      where: and(
        eq(financeEconomicEvents.userId, userId),
        eq(financeEconomicEvents.stableKey, stableKey),
      ),
    });
    if (existing) {
      await db
        .insert(financeEventTransactions)
        .values({ economicEventId: existing.id, transactionId, userId })
        .onConflictDoNothing();
      return existing;
    }
    const transaction = await db.query.financeTransactions.findFirst({
      where: and(eq(financeTransactions.id, transactionId), eq(financeTransactions.userId, userId)),
    });
    if (!transaction) throw new AppError("invalid_request", "A judged transaction was not found.");
    const kind =
      transaction.direction === "income"
        ? "income"
        : transaction.direction === "transfer"
          ? "transfer"
          : "purchase";
    const [created] = await db
      .insert(financeEconomicEvents)
      .values({ kind, stableKey, userId })
      .returning();
    if (!created) throw new AppError("internal_error", "The economic event was not created.");
    await db.insert(financeEventTransactions).values({
      economicEventId: created.id,
      transactionId,
      userId,
    });
    return created;
  }

  async function applyJudgment(
    run: typeof financeMaintenanceRuns.$inferSelect,
    judgment: Extract<
      FinanceMaintenanceInput,
      { operation: "submit_judgments" }
    >["judgments"][number],
    context: FinanceMutationContext,
    index: number,
  ) {
    await db.insert(financeMaintenanceJudgments).values({
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
      const category = await db.query.financeCategories.findFirst({
        where: and(
          eq(financeCategories.id, judgment.categoryId),
          eq(financeCategories.userId, context.userId),
        ),
      });
      const transaction = await db.query.financeTransactions.findFirst({
        where: and(
          eq(financeTransactions.id, judgment.transactionId),
          eq(financeTransactions.userId, context.userId),
        ),
      });
      if (!category || !transaction)
        throw new AppError("invalid_request", "A classification target was not found.");
      const counts = await db
        .select({ count: sql<number>`count(*)::integer` })
        .from(financeTransactionRevisions)
        .where(eq(financeTransactionRevisions.transactionId, transaction.id));
      await db.insert(financeTransactionRevisions).values({
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
        version: (counts[0]?.count ?? 0) + 1,
      });
      await db
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
      const event = await ensureEvent(context.userId, judgment.transactionId);
      const transaction = await db.query.financeTransactions.findFirst({
        where: eq(financeTransactions.id, judgment.transactionId),
      });
      if (!transaction) throw new AppError("invalid_request", "A review target was not found.");
      await inbox.upsertFinanceReview({
        economicEventId: event.id,
        evidence: { questionReason: judgment.questionReason, merchant: transaction.merchant },
        impactAmount: Math.abs(transaction.amount) / 100,
        reason: "category_ambiguity",
        transactionId: transaction.id,
        userId: context.userId,
      });
    } else {
      const first = await ensureEvent(context.userId, judgment.transactionIds[0] as string);
      for (const transactionId of judgment.transactionIds.slice(1)) {
        const transaction = await db.query.financeTransactions.findFirst({
          where: and(
            eq(financeTransactions.id, transactionId),
            eq(financeTransactions.userId, context.userId),
          ),
        });
        if (!transaction)
          throw new AppError("invalid_request", "A relationship target was not found.");
        await db
          .insert(financeEventTransactions)
          .values({
            economicEventId: first.id,
            transactionId,
            userId: context.userId,
          })
          .onConflictDoNothing();
      }
      await db.insert(financeTransactionRelationships).values({
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

  return {
    async maintainFinances(input: FinanceMaintenanceInput, context: FinanceMutationContext) {
      requireFinanceMutation(context);
      if (input.operation === "start") {
        const existing = await db.query.financeMaintenanceRuns.findFirst({
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
        if (existing)
          return maintenanceResult(
            await payloadFor(existing),
            await openReviewCount(context.userId),
          );
        const [run] = await db
          .insert(financeMaintenanceRuns)
          .values({
            scope: input.scope,
            stage: "deterministic_processing",
            userId: context.userId,
          })
          .returning();
        if (!run) throw new AppError("internal_error", "Maintenance did not start.");
        await applyDeterministicRules(context.userId, run.id);
        const batch = await reasoningBatch(context.userId, input.scope);
        const stage: FinanceMaintenanceStage = batch.length ? "agent_reasoning" : "agent_audit";
        const [advanced] = await db
          .update(financeMaintenanceRuns)
          .set({ stage, updatedAt: now(), version: run.version + 1 })
          .where(eq(financeMaintenanceRuns.id, run.id))
          .returning();
        if (!advanced) throw new AppError("internal_error", "Maintenance did not advance.");
        return maintenanceResult(await payloadFor(advanced), await openReviewCount(context.userId));
      }
      if (input.operation === "resume") {
        const run = await ownedRun(context.userId, input.runId);
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
        async () => {
          const run = await ownedRun(context.userId, input.runId);
          if (run.version !== input.expectedVersion)
            throw new AppError(
              "conflict",
              `Maintenance is at version ${run.version}; resume it before continuing.`,
            );
          if (input.operation === "submit_judgments") {
            if (run.stage !== "agent_reasoning")
              throw new AppError("conflict", "Maintenance is not awaiting judgments.");
            for (const [index, judgment] of input.judgments.entries()) {
              await applyJudgment(run, judgment, context, index);
            }
            const [updated] = await db
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
              await payloadFor(updated),
              await openReviewCount(context.userId),
            );
          }
          if (run.stage !== "agent_audit")
            throw new AppError("conflict", "Maintenance is not awaiting audit findings.");
          for (const finding of input.findings) {
            const stableKey = `${finding.economicEventId}:${finding.reason}`;
            await db
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
            const eventTransaction = await db.query.financeEventTransactions.findFirst({
              where: eq(financeEventTransactions.economicEventId, finding.economicEventId),
            });
            if (eventTransaction) {
              await inbox.upsertFinanceReview({
                economicEventId: finding.economicEventId,
                evidence: finding.evidence,
                impactAmount: finding.impactAmount,
                reason: finding.reason,
                transactionId: eventTransaction.transactionId,
                userId: context.userId,
              });
            }
          }
          const [updated] = await db
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
            await payloadFor(updated),
            await openReviewCount(context.userId),
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
        items: await Promise.all(rows.map(payloadFor)),
        nextCursor: null,
      };
    },
    async getFinanceMaintenanceRun(userId: string, runId: string) {
      return payloadFor(await ownedRun(userId, runId));
    },
  };
}
