import { randomUUID } from "node:crypto";
import {
  auditEvents,
  type Database,
  financeAccounts,
  financeGoals,
  financePlanningEvidence,
  financeRecurringObligations,
  users,
} from "@personal-os/database";
import {
  type FinancePlanningEvidence,
  financePlanningEvidenceCentsSchema,
  financePlanningEvidenceCurrencySchema,
  financePlanningEvidenceSchema,
  financeRecurringObligationSchema,
  idSchema,
  localDateAt,
  localDateToIso,
} from "@personal-os/domain";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { auditValues } from "../audit.js";
import { AppError } from "../errors.js";
import { type FinanceMutationContext, requireFinanceMutation } from "./context.js";

type FinanceTransaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type StoredEvidence = typeof financePlanningEvidence.$inferSelect;
const incrementableRevision = z.number().int().positive().max(2_147_483_646);
const commonInput = {
  asOf: z.iso.date(),
  currencyCode: financePlanningEvidenceCurrencySchema,
};
const obligationInputSchema = z
  .object({
    ...commonInput,
    obligationId: idSchema,
    expectedRevision: incrementableRevision,
    expectedAmountCents: financePlanningEvidenceCentsSchema,
    cadence: financeRecurringObligationSchema.shape.cadence,
    accountId: idSchema.nullable(),
    fixedness: z.enum(["fixed", "variable"]),
  })
  .strict();
const goalInputSchema = z
  .object({
    ...commonInput,
    goalId: idSchema,
    expectedVersion: incrementableRevision,
    // The existing compatibility progress column is PostgreSQL integer, not bigint.
    progressAmountCents: financePlanningEvidenceCentsSchema.max(2_147_483_647),
  })
  .strict();
export type ConfirmFinanceObligationEvidenceInput = z.infer<typeof obligationInputSchema>;
export type ConfirmFinanceGoalEvidenceInput = z.infer<typeof goalInputSchema>;
type Mutation<I> = { tx: FinanceTransaction; context: FinanceMutationContext; input: I };

/** Storage is an append-only explicit-user ledger; no inference or default-zero backfill. */
export function serializeFinancePlanningEvidence(row: StoredEvidence): FinancePlanningEvidence {
  const common = {
    evidenceId: row.id,
    ownerUserId: row.userId,
    actor: { type: "user", userId: row.actorUserId },
    provenance: "explicit_user",
    currencyCode: row.currencyCode,
    asOf: row.asOf,
    recordedAt: row.recordedAt.toISOString(),
  };
  return financePlanningEvidenceSchema.parse(
    row.obligationId !== null
      ? {
          ...common,
          kind: "obligation",
          sourceId: row.obligationId,
          sourceRevision: row.sourceRevision,
          expectedAmountCents: row.amountCents,
          cadence: row.boundCadence,
          accountId: row.boundAccountId,
          fixedness: row.fixedness,
        }
      : {
          ...common,
          kind: "goal",
          goalId: row.goalId,
          goalVersion: row.sourceRevision,
          progressAmountCents: row.amountCents,
        },
  );
}

function requireExplicitUser(context: FinanceMutationContext) {
  requireFinanceMutation(context);
  if (context.actorType !== "user" || context.actorId !== context.userId)
    throw new AppError(
      "forbidden",
      "Planning evidence requires the authenticated user's explicit statement.",
    );
}
function requireCurrentDate(asOf: string, today: string) {
  const current = z.iso.date().parse(today);
  if (asOf > current)
    throw new AppError("invalid_request", "Evidence as-of date cannot be in the future.");
}

/** Caller owns the canonical idempotent transaction; this helper never opens another one. */
export function createFinancePlanningEvidenceService({
  db,
  now,
}: {
  db: Database;
  now: () => Date;
}) {
  async function todayForOwner(tx: FinanceTransaction, userId: string) {
    const [owner] = await tx
      .select({ planningTimezone: users.planningTimezone })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1)
      .for("share");
    if (!owner) throw new AppError("not_found", "Account not found.");
    try {
      return localDateToIso(localDateAt(now(), owner.planningTimezone));
    } catch {
      throw new AppError(
        "invalid_request",
        "A valid planning timezone is required to record evidence.",
      );
    }
  }
  async function append(
    tx: FinanceTransaction,
    context: FinanceMutationContext,
    values: Omit<
      typeof financePlanningEvidence.$inferInsert,
      "id" | "userId" | "actorUserId" | "recordedAt"
    >,
    beforeRevision: number,
  ) {
    const [saved] = await tx
      .insert(financePlanningEvidence)
      .values({
        ...values,
        id: randomUUID(),
        userId: context.userId,
        actorUserId: context.userId,
        recordedAt: now(),
      })
      .returning();
    if (!saved) throw new AppError("internal_error", "Planning evidence could not be recorded.");
    const evidence = serializeFinancePlanningEvidence(saved);
    await tx.insert(auditEvents).values(
      auditValues({
        action: "finance.planning_evidence.confirmed",
        before: { revision: beforeRevision },
        after: {
          evidenceId: saved.id,
          revision: saved.sourceRevision,
          asOf: saved.asOf,
          provenance: "explicit_user",
        },
        entityId: (saved.goalId ?? saved.obligationId) as string,
        entityType: saved.goalId ? "finance_goal" : "finance_recurring_obligation",
        principal: context,
        requestId: context.requestId,
      }),
    );
    return evidence;
  }
  return {
    async confirmObligation({
      tx,
      context,
      input: raw,
    }: Mutation<ConfirmFinanceObligationEvidenceInput>) {
      requireExplicitUser(context);
      const input = obligationInputSchema.parse(raw);
      requireCurrentDate(input.asOf, await todayForOwner(tx, context.userId));
      const [before] = await tx
        .select()
        .from(financeRecurringObligations)
        .where(
          and(
            eq(financeRecurringObligations.userId, context.userId),
            eq(financeRecurringObligations.id, input.obligationId),
          ),
        )
        .limit(1)
        .for("update");
      if (!before) throw new AppError("not_found", "The recurring payment was not found.");
      if (!["active", "needs_review"].includes(before.status) || before.kind === "savings")
        throw new AppError(
          "invalid_request",
          "Only eligible bills and subscriptions can have planning evidence confirmed.",
        );
      if (
        before.revision !== input.expectedRevision ||
        before.expectedAmount !== input.expectedAmountCents ||
        before.cadence !== input.cadence ||
        before.accountId !== input.accountId
      )
        throw new AppError(
          "conflict",
          "The recurring payment changed; reload it before confirming evidence.",
        );
      if (before.accountId !== null) {
        const [account] = await tx
          .select()
          .from(financeAccounts)
          .where(
            and(
              eq(financeAccounts.userId, context.userId),
              eq(financeAccounts.id, before.accountId),
            ),
          )
          .limit(1)
          .for("share");
        if (!account)
          throw new AppError("conflict", "The source account is unavailable; reload the payment.");
        if (account.currencyCode !== null && account.currencyCode !== input.currencyCode)
          throw new AppError(
            "invalid_request",
            "The evidence currency differs from the source account currency.",
          );
      }
      const [source] = await tx
        .update(financeRecurringObligations)
        .set({ revision: before.revision + 1, updatedAt: now() })
        .where(
          and(
            eq(financeRecurringObligations.userId, context.userId),
            eq(financeRecurringObligations.id, before.id),
            eq(financeRecurringObligations.revision, before.revision),
          ),
        )
        .returning();
      if (!source)
        throw new AppError("conflict", "The recurring payment changed in another request.");
      const evidence = await append(
        tx,
        context,
        {
          obligationId: source.id,
          goalId: null,
          sourceRevision: source.revision,
          amountCents: source.expectedAmount,
          currencyCode: input.currencyCode,
          fixedness: input.fixedness,
          asOf: input.asOf,
          boundAccountId: source.accountId,
          boundCadence: source.cadence,
        },
        before.revision,
      );
      return { source, evidence };
    },
    async confirmGoal({ tx, context, input: raw }: Mutation<ConfirmFinanceGoalEvidenceInput>) {
      requireExplicitUser(context);
      const input = goalInputSchema.parse(raw);
      requireCurrentDate(input.asOf, await todayForOwner(tx, context.userId));
      const [before] = await tx
        .select()
        .from(financeGoals)
        .where(and(eq(financeGoals.userId, context.userId), eq(financeGoals.id, input.goalId)))
        .limit(1)
        .for("update");
      if (!before) throw new AppError("not_found", "The financial goal was not found.");
      if (before.status === "removed")
        throw new AppError("invalid_request", "Removed goals cannot receive progress evidence.");
      if (before.version !== input.expectedVersion)
        throw new AppError(
          "conflict",
          "The financial goal changed; reload it before recording progress.",
        );
      const [source] = await tx
        .update(financeGoals)
        .set({
          currentAmount: input.progressAmountCents,
          version: before.version + 1,
          updatedAt: now(),
        })
        .where(
          and(
            eq(financeGoals.userId, context.userId),
            eq(financeGoals.id, before.id),
            eq(financeGoals.version, before.version),
          ),
        )
        .returning();
      if (!source) throw new AppError("conflict", "The financial goal changed in another request.");
      const evidence = await append(
        tx,
        context,
        {
          goalId: source.id,
          obligationId: null,
          sourceRevision: source.version,
          amountCents: source.currentAmount,
          currencyCode: input.currencyCode,
          asOf: input.asOf,
          fixedness: null,
          boundAccountId: null,
          boundCadence: null,
        },
        before.version,
      );
      return { source, evidence };
    },
    async listEvidence(userId: string, tx?: FinanceTransaction) {
      idSchema.parse(userId);
      const rows = await (tx ?? db)
        .select()
        .from(financePlanningEvidence)
        .where(eq(financePlanningEvidence.userId, userId))
        .orderBy(
          desc(financePlanningEvidence.sourceRevision),
          desc(financePlanningEvidence.recordedAt),
          desc(financePlanningEvidence.id),
        );
      return rows.map(serializeFinancePlanningEvidence);
    },
  };
}
