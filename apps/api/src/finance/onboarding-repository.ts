import {
  auditEvents,
  type Database,
  financeOnboardingReceipts,
  financeOnboardingStates,
  users,
} from "@personal-os/database";
import {
  type FinanceOnboardingSnapshot,
  financeOnboardingSaveInputSchema,
} from "@personal-os/domain";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { auditValues } from "../audit.js";
import { AppError } from "../errors.js";
import type {
  FinanceOnboardingEvidence,
  FinanceOnboardingRead,
  FinanceOnboardingRepository,
  FinanceOnboardingState,
} from "../finance-onboarding-service.js";
import {
  type FinanceTransaction,
  requireFinanceExecution,
  requireFinanceMutation,
} from "./context.js";

// Decode persisted receipts without deriving, repairing, or granting authority from their contents.
const snapshotSchema = z
  .object({
    revision: z.number().int().nonnegative(),
    completedAt: z.iso.datetime().nullable(),
    existingAccess: z.boolean(),
    source: z
      .object({
        state: z.enum(["usable", "syncing", "missing", "ownership_required", "unavailable"]),
        summary: z.string(),
        recoveryHref: z.string().nullable(),
      })
      .strict(),
    contextReview: z.enum(["reviewed", "needs_review", "unavailable"]),
    questions: z
      .array(
        z
          .object({
            questionId: z.string(),
            label: z.string(),
            disposition: z.enum(["unreviewed", "answered", "none", "unknown"]),
            answerSummary: z.string().nullable(),
            allowsNone: z.boolean(),
          })
          .strict(),
      )
      .max(100),
    displayPreferences: z.object({ reviewed: z.boolean(), summary: z.array(z.string()) }).strict(),
    automationChoice: z.enum(["later", "now"]).nullable(),
    manualVisibility: z.enum(["auto", "show", "hide"]),
    automation: z
      .object({
        registrationCount: z.number().int().nonnegative(),
        authorizedRegistrationWithCadence: z.boolean(),
        chatVerification: z.enum(["pending", "verified", "unavailable"]),
        canSendChat: z.boolean(),
        historyAvailable: z.boolean(),
      })
      .strict(),
  })
  .strict();

function state(
  row: typeof financeOnboardingStates.$inferSelect | undefined,
): FinanceOnboardingState {
  if (!row)
    return {
      revision: 0,
      completedAt: null,
      answers: [],
      displayPreferencesReviewed: false,
      automationChoice: null,
      updatedAt: null,
    };
  return {
    revision: row.revision,
    completedAt: row.completedAt?.toISOString() ?? null,
    answers: financeOnboardingSaveInputSchema.shape.answers.parse(row.answers),
    displayPreferencesReviewed: row.displayPreferencesReviewed,
    automationChoice: row.automationChoice,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function createFinanceOnboardingRepository(options: {
  db: Database;
  loadEvidence: (
    executor: Database | FinanceTransaction,
    userId: string,
  ) => Promise<FinanceOnboardingEvidence>;
  now?: () => Date;
}): FinanceOnboardingRepository {
  const now = options.now ?? (() => new Date());
  async function read(
    executor: Database | FinanceTransaction,
    userId: string,
  ): Promise<FinanceOnboardingRead> {
    const [row] = await executor
      .select()
      .from(financeOnboardingStates)
      .where(eq(financeOnboardingStates.userId, userId));
    return { state: state(row), evidence: await options.loadEvidence(executor, userId) };
  }
  return {
    read: (userId) => read(options.db, userId),
    withOwnerTransaction(context, action) {
      requireFinanceMutation(context);
      return options.db.transaction(async (tx) => {
        const [owner] = await tx
          .select({ id: users.id })
          .from(users)
          .where(eq(users.id, context.userId))
          .for("key share")
          .limit(1);
        if (!owner) throw new AppError("not_found", "Finance setup owner not found.");
        await requireFinanceExecution(tx, context, now());
        for (const identity of [
          `finance-profile:${context.userId}`,
          `finance-onboarding:${context.userId}`,
        ])
          await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${identity}, 0))`);
        return action({
          read: () => read(tx, context.userId),
          async readReceipt(idempotencyKey) {
            const [receipt] = await tx
              .select()
              .from(financeOnboardingReceipts)
              .where(
                and(
                  eq(financeOnboardingReceipts.userId, context.userId),
                  eq(financeOnboardingReceipts.idempotencyKey, idempotencyKey),
                ),
              );
            if (!receipt) return null;
            const parsed = snapshotSchema.safeParse(receipt.result);
            if (!parsed.success)
              throw new AppError("internal_error", "The saved Finance setup receipt is invalid.");
            return {
              operation: receipt.operation,
              requestHash: receipt.requestHash,
              result: parsed.data,
            };
          },
          async write(input) {
            if (
              input.context.userId !== context.userId ||
              input.context.actorId !== context.actorId ||
              input.context.actorType !== context.actorType
            )
              throw new AppError(
                "forbidden",
                "Finance setup transaction belongs to another principal.",
              );
            if (input.state.revision !== input.expectedRevision + 1)
              throw new AppError("conflict", "Finance setup revision must advance once.");
            const [previous] = await tx
              .select()
              .from(financeOnboardingStates)
              .where(eq(financeOnboardingStates.userId, context.userId));
            if ((previous?.revision ?? 0) !== input.expectedRevision)
              throw new AppError("conflict", "Finance setup changed. Reload before continuing.");
            const values = {
              userId: context.userId,
              revision: input.state.revision,
              completedAt:
                input.state.completedAt === null ? null : new Date(input.state.completedAt),
              answers: financeOnboardingSaveInputSchema.shape.answers.parse(input.state.answers),
              displayPreferencesReviewed: input.state.displayPreferencesReviewed,
              automationChoice: input.state.automationChoice,
              updatedAt: now(),
            };
            const changed = previous
              ? await tx
                  .update(financeOnboardingStates)
                  .set(values)
                  .where(
                    and(
                      eq(financeOnboardingStates.userId, context.userId),
                      eq(financeOnboardingStates.revision, input.expectedRevision),
                    ),
                  )
                  .returning({ userId: financeOnboardingStates.userId })
              : await tx
                  .insert(financeOnboardingStates)
                  .values(values)
                  .onConflictDoNothing()
                  .returning({ userId: financeOnboardingStates.userId });
            if (changed.length !== 1)
              throw new AppError("conflict", "Finance setup changed. Reload before continuing.");
            const result: FinanceOnboardingSnapshot = snapshotSchema.parse(input.receipt.result);
            await tx.insert(financeOnboardingReceipts).values({
              userId: context.userId,
              idempotencyKey: input.receipt.idempotencyKey,
              operation: input.receipt.operation,
              requestHash: input.receipt.requestHash,
              result: { ...result },
              actorId: context.actorId,
              actorType: context.actorType,
              createdAt: now(),
            });
            await tx.insert(auditEvents).values(
              auditValues({
                action: `finance.onboarding.${input.receipt.operation === "complete" ? "completed" : "reviewed"}`,
                entityId: context.userId,
                entityType: "finance_onboarding",
                principal: context,
                requestId: context.requestId,
                before: previous
                  ? { revision: previous.revision, completed: previous.completedAt !== null }
                  : null,
                after: { revision: values.revision, completed: values.completedAt !== null },
              }),
            );
          },
        });
      });
    },
  };
}
