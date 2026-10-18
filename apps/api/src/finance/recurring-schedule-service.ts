import {
  auditEvents,
  type Database,
  financeAccounts,
  financeIncomeStreams,
  financeOccurrenceMatchEvents,
  financeRecurringObligations,
  financeRecurringOccurrences,
  financeRecurringScheduleVersions,
} from "@personal-os/database";
import {
  type ConfirmFinanceRecurringScheduleInput,
  confirmFinanceRecurringScheduleInputSchema,
  type FinanceRecurringSchedule,
  type FinanceToolResult,
  financeRecurringScheduleSchema,
} from "@personal-os/domain";
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { auditValues } from "../audit.js";
import { AppError } from "../errors.js";
import { lockReimbursementTopology } from "../finance-reimbursement-locks.js";
import { executeFinanceIdempotently, type FinanceMutationContext } from "./context.js";
import { requireExplicitUser } from "./planning-evidence-service.js";
export type CashflowTransaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
export function cashflowResult<T>(data: T, headline: string): FinanceToolResult<T> {
  return {
    schemaVersion: 1,
    outcome: "completed",
    data,
    changes: [],
    remainingWork: { categories: [], count: 0 },
    communication: { headline, optionalDetails: [], requiredDisclosures: [] },
  };
}
export function scheduleValue(
  row: typeof financeRecurringScheduleVersions.$inferSelect,
): FinanceRecurringSchedule {
  return financeRecurringScheduleSchema.parse({
    id: row.id,
    source: {
      kind: row.incomeStreamId ? "income" : "obligation",
      id: row.incomeStreamId ?? row.obligationId,
    },
    sourceRevision: row.sourceRevision,
    accountId: row.accountId,
    cadence: row.cadence,
    timezone: row.timezone,
    anchorLocalDate: row.anchorLocalDate,
    effectiveFrom: row.effectiveFrom,
    semimonthlyDays: row.semimonthlyDays,
    amountCents: row.amountCents,
    amountBasis: row.amountBasis,
    currencyCode: row.currencyCode,
    supersedesId: row.supersedesId,
    actorUserId: row.actorUserId,
    recordedAt: row.recordedAt.toISOString(),
  });
}
export function createFinanceRecurringScheduleService({
  db,
  now,
}: {
  db: Database;
  now: () => Date;
}) {
  return {
    async listFinanceRecurringSchedules(userId: string) {
      const rows = await db
        .selectDistinctOn([
          financeRecurringScheduleVersions.incomeStreamId,
          financeRecurringScheduleVersions.obligationId,
        ])
        .from(financeRecurringScheduleVersions)
        .where(eq(financeRecurringScheduleVersions.userId, userId))
        .orderBy(
          financeRecurringScheduleVersions.incomeStreamId,
          financeRecurringScheduleVersions.obligationId,
          desc(financeRecurringScheduleVersions.sourceRevision),
        )
        .limit(1001);
      if (rows.length > 1000)
        throw new AppError(
          "conflict",
          "Too many schedules to read safely; narrow the source scope.",
        );
      return rows.map(scheduleValue);
    },
    async confirmFinanceRecurringSchedule(
      raw: ConfirmFinanceRecurringScheduleInput,
      context: FinanceMutationContext,
    ) {
      requireExplicitUser(context);
      const input = confirmFinanceRecurringScheduleInputSchema.parse(raw);
      return executeFinanceIdempotently(
        db,
        context,
        {
          operation: "finance.recurring.schedule.confirm",
          idempotencyKey: input.idempotencyKey,
          payload: input,
          lockIdentities: [`finance-reimbursement-topology:${context.userId}`],
        },
        async (tx) => {
          await lockReimbursementTopology(tx, context.userId);
          const table =
            input.source.kind === "income" ? financeIncomeStreams : financeRecurringObligations;
          if (input.accountId) {
            const [account] = await tx
              .select()
              .from(financeAccounts)
              .where(
                and(
                  eq(financeAccounts.userId, context.userId),
                  eq(financeAccounts.id, input.accountId),
                ),
              )
              .limit(1)
              .for("update");
            if (!account) throw new AppError("not_found", "Source account not found.");
            if (account.currencyCode !== null && account.currencyCode !== input.currencyCode)
              throw new AppError("invalid_request", "Schedule and account currency differ.");
          }
          const [source] = await tx
            .select()
            .from(table)
            .where(and(eq(table.userId, context.userId), eq(table.id, input.source.id)))
            .limit(1)
            .for("update");
          if (!source) throw new AppError("not_found", "Recurring source not found.");
          if (!["active", "needs_review"].includes(source.status))
            throw new AppError(
              "conflict",
              "Confirm or resume the recurring source before scheduling it.",
            );
          if (
            source.revision !== input.expectedSourceRevision ||
            source.accountId !== input.accountId
          )
            throw new AppError(
              "conflict",
              "The source changed; reload its current revision and account.",
            );
          const column =
            input.source.kind === "income"
              ? financeRecurringScheduleVersions.incomeStreamId
              : financeRecurringScheduleVersions.obligationId;
          const [previous] = await tx
            .select()
            .from(financeRecurringScheduleVersions)
            .where(
              and(
                eq(financeRecurringScheduleVersions.userId, context.userId),
                eq(column, source.id),
              ),
            )
            .orderBy(desc(financeRecurringScheduleVersions.sourceRevision))
            .limit(1);
          if ((previous?.id ?? null) !== input.supersedesId)
            throw new AppError(
              "conflict",
              "The schedule has a newer version; reload before confirming.",
            );
          if (previous && input.effectiveFrom <= previous.effectiveFrom)
            throw new AppError(
              "conflict",
              "A successor must advance the current effective boundary.",
            );
          const priorVersions = await tx
            .select({ id: financeRecurringScheduleVersions.id })
            .from(financeRecurringScheduleVersions)
            .where(
              and(
                eq(financeRecurringScheduleVersions.userId, context.userId),
                eq(column, source.id),
              ),
            )
            .limit(1001);
          if (priorVersions.length > 1000)
            throw new AppError("conflict", "Schedule history exceeds the safe confirmation bound.");
          if (priorVersions.length) {
            const matches = await tx
              .select({ id: financeOccurrenceMatchEvents.id })
              .from(financeOccurrenceMatchEvents)
              .innerJoin(
                financeRecurringOccurrences,
                and(
                  eq(financeRecurringOccurrences.id, financeOccurrenceMatchEvents.occurrenceId),
                  eq(financeRecurringOccurrences.userId, context.userId),
                ),
              )
              .where(
                and(
                  eq(financeOccurrenceMatchEvents.userId, context.userId),
                  eq(financeOccurrenceMatchEvents.kind, "match"),
                  inArray(
                    financeRecurringOccurrences.scheduleVersionId,
                    priorVersions.map((row) => row.id),
                  ),
                  gte(financeRecurringOccurrences.localDate, input.effectiveFrom),
                ),
              )
              .limit(1001);
            if (matches.length > 1000)
              throw new AppError(
                "conflict",
                "Matched history exceeds the safe confirmation bound.",
              );
            if (matches.length) {
              const reversals = await tx
                .select({ original: financeOccurrenceMatchEvents.reversesMatchId })
                .from(financeOccurrenceMatchEvents)
                .where(
                  and(
                    eq(financeOccurrenceMatchEvents.userId, context.userId),
                    eq(financeOccurrenceMatchEvents.kind, "reverse"),
                    inArray(
                      financeOccurrenceMatchEvents.reversesMatchId,
                      matches.map((row) => row.id),
                    ),
                  ),
                );
              const reversed = new Set(reversals.map((row) => row.original));
              if (matches.some((row) => !reversed.has(row.id)))
                throw new AppError(
                  "conflict",
                  "Reverse the actual matches before changing dates in their schedule interval.",
                );
            }
          }
          const [updated] = await tx
            .update(table)
            .set({ revision: sql`${table.revision} + 1`, updatedAt: now() })
            .where(
              and(
                eq(table.userId, context.userId),
                eq(table.id, source.id),
                eq(table.revision, source.revision),
              ),
            )
            .returning();
          if (!updated)
            throw new AppError("conflict", "Recurring source changed in another request.");
          const [saved] = await tx
            .insert(financeRecurringScheduleVersions)
            .values({
              userId: context.userId,
              actorUserId: context.userId,
              recordedAt: now(),
              incomeStreamId: input.source.kind === "income" ? source.id : null,
              obligationId: input.source.kind === "obligation" ? source.id : null,
              sourceRevision: updated.revision,
              accountId: input.accountId,
              cadence: input.cadence,
              timezone: input.timezone,
              anchorLocalDate: input.anchorLocalDate,
              effectiveFrom: input.effectiveFrom,
              semimonthlyDays: input.semimonthlyDays
                ? [...input.semimonthlyDays].sort((a, b) => a - b)
                : null,
              amountCents: input.amountCents,
              amountBasis: input.amountBasis,
              currencyCode: input.currencyCode,
              supersedesId: input.supersedesId,
            })
            .returning();
          if (!saved)
            throw new AppError("internal_error", "Schedule statement could not be recorded.");
          await tx.insert(auditEvents).values(
            auditValues({
              action: "finance.recurring_schedule.confirmed",
              before: { versionId: previous?.id ?? null, revision: source.revision },
              after: {
                versionId: saved.id,
                revision: updated.revision,
                effectiveFrom: saved.effectiveFrom,
              },
              entityId: source.id,
              entityType:
                input.source.kind === "income"
                  ? "finance_income_stream"
                  : "finance_recurring_obligation",
              principal: context,
              requestId: context.requestId,
            }),
          );
          return cashflowResult(
            scheduleValue(saved),
            "Your explicit recurring schedule was recorded.",
          );
        },
      );
    },
  };
}
