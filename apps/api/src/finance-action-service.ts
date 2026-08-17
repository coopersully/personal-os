import { createHash, randomUUID } from "node:crypto";
import {
  type Database,
  financeAgentActionReviews,
  financeAutomationSettings,
} from "@personal-os/database";
import {
  type FinanceActionKind,
  type FinanceActionOutcome,
  type FinanceActionReview,
  type FinancePendingActionReview,
  type FinanceQuestion,
  type FinanceSafeChange,
  financeActionReviewSchema,
} from "@personal-os/domain";
import { and, desc, eq, inArray } from "drizzle-orm";
import { AppError } from "./errors.js";
import type { createFinanceService } from "./finance-service.js";
import type { Principal } from "./types.js";

type MutationContext = {
  principal: Principal;
  requestId: string;
};

type PreparedAction = {
  actionKind: FinanceActionKind;
  expectedRevision: string | null;
  fingerprint: string;
  input: Record<string, unknown>;
  rationale: string;
  safeChanges: FinanceSafeChange[];
};

type StoredPayload = {
  input: Record<string, unknown>;
  rationale: string;
  result?: unknown;
};

type FinanceActionServiceOptions = {
  db: Database;
  finances: ReturnType<typeof createFinanceService>;
  now: () => Date;
};

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

function targetFor(
  actionKind: FinanceActionKind,
  input: Record<string, unknown>,
): FinanceSafeChange {
  const entityId =
    typeof input.id === "string"
      ? input.id
      : typeof input.transactionId === "string"
        ? input.transactionId
        : null;
  return {
    entityId,
    entityType: `finance_${actionKind}`,
    summary: `Apply prepared ${actionKind.replaceAll("_", " ")} change.`,
  };
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
    assumptions: [],
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
    actionKind: FinanceActionKind,
    input: Record<string, unknown>,
  ): Promise<PreparedAction | { status: "needs_input"; question: FinanceQuestion }> {
    // Evidence is evaluated before any bypass setting is read. Empty batches and
    // revisionless categorizations cannot become permission merely because a
    // person has elected direct application for justified work.
    if (actionKind === "categorization") {
      const decisions = input.decisions;
      if (!Array.isArray(decisions) || decisions.length === 0) {
        return {
          question: question(actionKind, "No transaction categorization evidence was supplied."),
          status: "needs_input",
        };
      }
      if (
        decisions.some(
          (decision) =>
            !decision ||
            typeof decision !== "object" ||
            typeof (decision as Record<string, unknown>).rationale !== "string" ||
            typeof (decision as Record<string, unknown>).expectedTransactionUpdatedAt !== "string",
        )
      ) {
        return {
          question: question(
            actionKind,
            "Each categorization needs rationale and a displayed transaction revision.",
          ),
          status: "needs_input",
        };
      }
    }
    const expectedRevision =
      typeof input.expectedTransactionUpdatedAt === "string"
        ? input.expectedTransactionUpdatedAt
        : actionKind === "categorization"
          ? createHash("sha256").update(stableJson(input.decisions)).digest("hex")
          : null;
    return {
      actionKind,
      expectedRevision,
      fingerprint: actionFingerprint(actionKind, input),
      input,
      rationale:
        typeof input.rationale === "string" && input.rationale.trim()
          ? input.rationale
          : `Requested ${actionKind.replaceAll("_", " ")} change.`,
      safeChanges: [targetFor(actionKind, input)],
    };
  }

  async function readBypass(userId: string, lock = false) {
    const query = db
      .select({ reviewBypassEnabled: financeAutomationSettings.reviewBypassEnabled })
      .from(financeAutomationSettings)
      .where(eq(financeAutomationSettings.userId, userId));
    const [settings] = lock ? await query.for("update").limit(1) : await query.limit(1);
    return settings?.reviewBypassEnabled === true;
  }

  async function applyPrepared(prepared: PreparedAction, context: MutationContext) {
    const input = prepared.input;
    const privilegedContext = { ...context, financeReviewBypass: true };
    switch (prepared.actionKind) {
      case "profile":
        return finances.updateProfile(input as never, privilegedContext);
      case "budget_plan":
        return "allocations" in input
          ? finances.setBudgetPlan(input as never, privilegedContext)
          : finances.createBudget(input as never, privilegedContext);
      case "categorization":
        return finances.applyCategorizations(input as never, privilegedContext);
      case "recurring_obligation":
        return finances.updateRecurringObligation(
          String(input.id),
          input as never,
          privilegedContext,
        );
      case "alert":
        return input.operation === "refresh"
          ? finances.refreshCashflowInsights(context.principal.userId)
          : finances.resolveAlert(String(input.id), input as never, privilegedContext);
      case "income_stream":
        return finances.updateIncomeStream(String(input.id), input as never, privilegedContext);
      case "merchant":
        return "sourceMerchantId" in input
          ? finances.mergeMerchants(input as never, privilegedContext)
          : finances.updateMerchant(String(input.id), input as never, privilegedContext);
      case "transaction":
        return "accountId" in input
          ? finances.createTransaction(input as never, privilegedContext)
          : finances.updateTransaction(String(input.id), input as never, privilegedContext);
      default:
        throw new AppError(
          "invalid_request",
          `Unsupported Finance action kind: ${prepared.actionKind}.`,
        );
    }
  }

  async function queue(prepared: PreparedAction, context: MutationContext) {
    const pending = await db
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
    const entityIds = new Set(
      prepared.safeChanges.map((change) => change.entityId).filter(Boolean),
    );
    const stale = pending.filter(
      (row) =>
        row.actionKind === prepared.actionKind &&
        (row.safeChanges as FinanceSafeChange[]).some((change) =>
          change.entityId ? entityIds.has(change.entityId) : false,
        ),
    );
    if (stale.length) {
      await db
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
      const [created] = await db
        .insert(financeAgentActionReviews)
        .values({
          actionKind: prepared.actionKind,
          expectedRevision: prepared.expectedRevision,
          fingerprint: prepared.fingerprint,
          maintenanceRunId: null,
          privatePayload: { input: prepared.input, rationale: prepared.rationale },
          requestingAgentId: context.principal.actorId,
          safeChanges: prepared.safeChanges,
          sourceRefs: [],
          userId: context.principal.userId,
        })
        .returning();
      if (!created) throw new Error("The Finance action review could not be saved.");
      return reviewFromRow(created);
    } catch (error) {
      // The partial unique fingerprint index is also the concurrent replay
      // fence. A competing request returns the exact same pending review.
      const [replayed] = await db
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
      actionKind: FinanceActionKind,
      input: Record<string, unknown>,
      context: MutationContext,
    ): Promise<FinanceActionOutcome<T>> {
      const prepared = await prepare(actionKind, input);
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
            safeChanges: [targetFor(actionKind, input)],
            sourceRefs: [],
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
        !(await readBypass(context.principal.userId))
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
        return db.transaction(async () => {
          if (!(await readBypass(context.principal.userId, true))) {
            return {
              review: (await queue(prepared, context)) as FinancePendingActionReview,
              status: "pending_review",
            };
          }
          return { result: (await applyPrepared(prepared, context)) as T, status: "applied" };
        });
      }
      return { result: (await applyPrepared(prepared, context)) as T, status: "applied" };
    },
    async listReviews(userId: string, limit = 50) {
      const rows = await db
        .select()
        .from(financeAgentActionReviews)
        .where(eq(financeAgentActionReviews.userId, userId))
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
          actionKind: review.actionKind as FinanceActionKind,
          expectedRevision: review.expectedRevision,
          fingerprint: review.fingerprint,
          input: payload.input,
          rationale: payload.rationale,
          safeChanges: review.safeChanges as FinanceSafeChange[],
        };
        // Semantic writers validate their current records. The review lock
        // prevents two humans from replaying this prepared action.
        const result = await applyPrepared(prepared, context);
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
      return db.transaction(async (tx) => {
        const [review] = await tx
          .select()
          .from(financeAgentActionReviews)
          .where(
            and(
              eq(financeAgentActionReviews.id, id),
              eq(financeAgentActionReviews.userId, context.principal.userId),
              eq(financeAgentActionReviews.actionKind, "question"),
              eq(financeAgentActionReviews.status, "pending"),
            ),
          )
          .for("update")
          .limit(1);
        if (!review) throw new AppError("not_found", "The Finance question was not found.");
        const payload = review.privatePayload as { question: FinanceQuestion };
        // The answer is durable, but it is not an approval and it cannot alter
        // bypass. A subsequent prepared action consumes it as evidence rather
        // than guessing a transaction/category mutation from free text.
        await tx
          .update(financeAgentActionReviews)
          .set({ privatePayload: { ...payload, answer }, updatedAt: now() })
          .where(eq(financeAgentActionReviews.id, review.id));
        return { question: payload.question, status: "needs_input" as const };
      });
    },
  };
}
