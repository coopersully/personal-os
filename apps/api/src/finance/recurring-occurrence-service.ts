import {
  auditEvents,
  type Database,
  financeAccounts,
  financeIncomeStreams,
  financeOccurrenceMatchEvents,
  financeRecurringObligations,
  financeRecurringOccurrences,
  financeRecurringScheduleVersions,
  financeReimbursementMatches,
  financeReimbursements,
  financeTransactionAllocations,
  financeTransactions,
} from "@personal-os/database";
import {
  expandRecurringOccurrences,
  type FinanceOccurrenceMatchEvent,
  type FinanceRecurringOccurrencesQuery,
  type FinanceRecurringOccurrencesView,
  financeOccurrenceMatchEventSchema,
  financeRecurringOccurrencesQuerySchema,
  type ManageFinanceOccurrenceMatchInput,
  manageFinanceOccurrenceMatchInputSchema,
} from "@personal-os/domain";
import { and, desc, eq, gte, inArray, lte } from "drizzle-orm";
import { auditValues } from "../audit.js";
import { AppError } from "../errors.js";
import {
  lockReimbursementCases,
  lockReimbursementMatches,
  lockReimbursementTopology,
} from "../finance-reimbursement-locks.js";
import { readCashflowActuals } from "./balance-basis-service.js";
import { executeFinanceIdempotently, type FinanceMutationContext } from "./context.js";
import { requireExplicitUser } from "./planning-evidence-service.js";
import { type CashflowTransaction, cashflowResult } from "./recurring-schedule-service.js";

type Executor = Database | CashflowTransaction;
export function matchEventValue(
  row: typeof financeOccurrenceMatchEvents.$inferSelect,
): FinanceOccurrenceMatchEvent {
  return financeOccurrenceMatchEventSchema.parse({
    ...row,
    transactionRevision: row.transactionRevision.toString(),
    reimbursementRelationshipRevision: typeof row.sourceEvidence.reimbursementRelationshipRevision === "string" ? row.sourceEvidence.reimbursementRelationshipRevision : null,
    recordedAt: row.recordedAt.toISOString(),
  });
}
export function createFinanceRecurringOccurrenceService({
  db,
  now,
}: {
  db: Database;
  now: () => Date;
}) {
  async function read(
    userId: string,
    query: FinanceRecurringOccurrencesQuery,
    tx: Executor = db,
  ): Promise<FinanceRecurringOccurrencesView> {
    const versions = await tx
      .select()
      .from(financeRecurringScheduleVersions)
      .where(
        and(
          eq(financeRecurringScheduleVersions.userId, userId),
          ...(query.accountIds !== undefined
            ? [inArray(financeRecurringScheduleVersions.accountId, query.accountIds)]
            : []),
        ),
      )
      .orderBy(desc(financeRecurringScheduleVersions.sourceRevision))
      .limit(1001);
    if (versions.length > 1000)
      throw new AppError("conflict", "Schedule history exceeds the safe range-read bound.");
    const income = await tx
      .select()
      .from(financeIncomeStreams)
      .where(eq(financeIncomeStreams.userId, userId))
      .limit(1001);
    const obligations = await tx
      .select()
      .from(financeRecurringObligations)
      .where(eq(financeRecurringObligations.userId, userId))
      .limit(1001);
    if (income.length > 1000 || obligations.length > 1000)
      throw new AppError("conflict", "Recurring sources exceed the safe read bound.");
    const stored = versions.length
      ? await tx
          .select()
          .from(financeRecurringOccurrences)
          .where(
            and(
              eq(financeRecurringOccurrences.userId, userId),
              inArray(
                financeRecurringOccurrences.scheduleVersionId,
                versions.map((row) => row.id),
              ),
              gte(financeRecurringOccurrences.localDate, query.from),
              lte(financeRecurringOccurrences.localDate, query.to),
            ),
          )
          .limit(5001)
      : [];
    if (stored.length > 5000)
      throw new AppError("conflict", "Occurrence history exceeds the safe read bound.");
    const events = stored.length
      ? await tx
          .select()
          .from(financeOccurrenceMatchEvents)
          .where(
            and(
              eq(financeOccurrenceMatchEvents.userId, userId),
              inArray(
                financeOccurrenceMatchEvents.occurrenceId,
                stored.map((row) => row.id),
              ),
            ),
          )
          .orderBy(financeOccurrenceMatchEvents.id)
          .limit(10001)
      : [];
    if (events.length > 10000)
      throw new AppError("conflict", "Match history exceeds the safe read bound.");
    const allocationIds = events.flatMap((row) => (row.allocationId ? [row.allocationId] : []));
    const allocations = allocationIds.length
      ? await tx
          .select()
          .from(financeTransactionAllocations)
          .where(
            and(
              eq(financeTransactionAllocations.userId, userId),
              inArray(financeTransactionAllocations.id, allocationIds),
            ),
          )
      : [];
    const transactionIds = [
      ...new Set([
        ...allocations.map((row) => row.transactionId),
        ...events.flatMap((row) => (row.incomeTransactionId ? [row.incomeTransactionId] : [])),
      ]),
    ];
    const transactions = transactionIds.length
      ? await tx
          .select()
          .from(financeTransactions)
          .where(
            and(
              eq(financeTransactions.userId, userId),
              inArray(financeTransactions.id, transactionIds),
            ),
          )
      : [];
    const actualContext = transactions.length
      ? await readCashflowActuals(tx, userId, {
          from: transactions.map((row) => row.transactionDate).sort()[0] as string,
          to: transactions
            .map((row) => row.transactionDate)
            .sort()
            .at(-1) as string,
          accountIds: [...new Set(transactions.map((row) => row.accountId))],
        })
      : null;
    const reversed = new Set(
      events.flatMap((row) => (row.reversesMatchId ? [row.reversesMatchId] : [])),
    );
    const result: FinanceRecurringOccurrencesView = {
      from: query.from,
      to: query.to,
      occurrences: [],
      matchEvents: events.map(matchEventValue),
      unavailableSources: [],
    };
    const versionSource = (version: (typeof versions)[number]) =>
      version.incomeStreamId
        ? { kind: "income" as const, id: version.incomeStreamId }
        : { kind: "obligation" as const, id: version.obligationId as string };
    for (const source of [
      ...income.map((row) => ({ kind: "income" as const, row })),
      ...obligations.map((row) => ({ kind: "obligation" as const, row })),
    ]) {
      if (
        !["active", "needs_review"].includes(source.row.status) ||
        (query.accountIds !== undefined &&
          (source.row.accountId === null || !query.accountIds.includes(source.row.accountId)))
      )
        continue;
      const sourceVersions = versions.filter((version) =>
        source.kind === "income"
          ? version.incomeStreamId === source.row.id
          : version.obligationId === source.row.id,
      );
      if (!sourceVersions.length)
        result.unavailableSources.push({
          source: { kind: source.kind, id: source.row.id },
          reason: "unconfirmed_schedule",
        });
      else if (sourceVersions[0]?.sourceRevision !== source.row.revision)
        result.unavailableSources.push({
          source: { kind: source.kind, id: source.row.id },
          reason: "source_changed",
        });
    }
    for (const version of versions) {
      const source = versionSource(version);
      const current =
        source.kind === "income"
          ? income.find((row) => row.id === source.id)
          : obligations.find((row) => row.id === source.id);
      if (!current) continue;
      const siblings = versions.filter((row) =>
        source.kind === "income"
          ? row.incomeStreamId === source.id
          : row.obligationId === source.id,
      );
      const successor = versions.find((row) => row.supersedesId === version.id);
      const sourceValid =
        ["active", "needs_review"].includes(current.status) &&
        siblings[0]?.sourceRevision === current.revision;
      const interval = (date: string) =>
        sourceValid &&
        date >= version.effectiveFrom &&
        (!successor || date < successor.effectiveFrom);
      const key = (date: string, slot: number) => JSON.stringify([version.id, date, slot]);
      const candidates = new Map<
        string,
        { date: string; slot: number; inCurrentSchedule: boolean }
      >();
      if (version.cadence === "irregular") {
        if (
          sourceValid &&
          version.effectiveFrom <= query.to &&
          (!successor || successor.effectiveFrom > query.from)
        )
          result.unavailableSources.push({ source, reason: "irregular_cadence" });
      } else {
        // Expansion enumerates dates; nullable amount remains null in every public/persisted row.
        const expanded = expandRecurringOccurrences(
          {
            confirmed: true,
            scheduleVersionId: version.id,
            sourceId: source.id,
            sourceRevision: version.sourceRevision,
            timezone: version.timezone,
            anchorLocalDate: version.anchorLocalDate,
            cadence: version.cadence as "monthly",
            ...(version.semimonthlyDays
              ? { semimonthlyDays: version.semimonthlyDays as [number, number] }
              : {}),
            amountCents: version.amountCents ?? 0,
            currencyCode: version.currencyCode,
            sourceReferences: [source.id],
          },
          { fromLocalDate: query.from, toLocalDate: query.to },
        );
        for (const occurrence of expanded.occurrences)
          if (interval(occurrence.localDate))
            candidates.set(key(occurrence.localDate, occurrence.slot), {
              date: occurrence.localDate,
              slot: occurrence.slot,
              inCurrentSchedule: true,
            });
      }
      for (const row of stored.filter((row) => row.scheduleVersionId === version.id))
        if (events.some((event) => event.occurrenceId === row.id))
          candidates.set(key(row.localDate, row.slot), {
            date: row.localDate,
            slot: row.slot,
            inCurrentSchedule: interval(row.localDate),
          });
      for (const [identity, candidate] of candidates) {
        const persisted = stored.find(
          (row) =>
            row.scheduleVersionId === version.id &&
            row.localDate === candidate.date &&
            row.slot === candidate.slot,
        );
        const originals = events.filter(
          (event) =>
            event.occurrenceId === persisted?.id &&
            event.kind === "match" &&
            !reversed.has(event.id),
        );
        const valid = originals.filter((event) => {
          const allocation = event.allocationId
            ? allocations.find((row) => row.id === event.allocationId)
            : undefined;
          const actual = transactions.find(
            (row) => row.id === (event.incomeTransactionId ?? allocation?.transactionId),
          );
          return (
            actual &&
            !actual.pending &&
            actual.contextualRevision === event.transactionRevision &&
            actual.reimbursementRelationshipRevision.toString() === event.sourceEvidence.reimbursementRelationshipRevision &&
            actualContext?.eligibility(
              actual,
              event.incomeTransactionId ? "income" : "expense",
              allocation,
            ).eligible &&
            actualContext.recognitionFingerprint(actual.id) ===
              event.sourceEvidence.recognitionFingerprint &&
            (!event.allocationId ||
              (allocation?.state === "active" && allocation.revision === event.allocationRevision))
          );
        });
        const matched = valid.reduce((sum, event) => sum + event.amountCents, 0);
        const invalidated = valid.length !== originals.length;
        result.occurrences.push({
          key: identity,
          occurrenceId: persisted?.id ?? null,
          scheduleVersionId: version.id,
          source,
          sourceRevision: version.sourceRevision,
          accountId: version.accountId,
          displayName: current.displayName,
          localDate: candidate.date,
          slot: candidate.slot,
          expectedAmountCents: version.amountCents,
          currencyCode: version.currencyCode,
          amountBasis: version.amountBasis as "fixed" | "variable",
          certainty: "expected",
          inCurrentSchedule: candidate.inCurrentSchedule,
          matchState: invalidated
            ? "invalidated"
            : matched > 0
              ? version.amountCents !== null && matched === version.amountCents
                ? "matched"
                : "partially_matched"
              : "expected",
          matchedAmountCents: matched,
          remainingExpectedCents:
            candidate.inCurrentSchedule && version.amountCents !== null
              ? Math.max(0, version.amountCents - matched)
              : candidate.inCurrentSchedule
                ? null
                : 0,
          matchIds: valid.map((event) => event.id),
        });
      }
    }
    if (result.occurrences.length > 5000)
      throw new AppError("conflict", "Choose fewer sources or dates.");
    result.occurrences.sort(
      (a, b) => a.localDate.localeCompare(b.localDate) || a.key.localeCompare(b.key),
    );
    return result;
  }
  return {
    async listFinanceRecurringOccurrences(
      userId: string,
      raw: FinanceRecurringOccurrencesQuery,
      executor?: CashflowTransaction,
    ) {
      const query = financeRecurringOccurrencesQuerySchema.parse(raw);
      if (executor) return read(userId, query, executor);
      return db.transaction((tx) => read(userId, query, tx), {
        isolationLevel: "repeatable read",
        accessMode: "read only",
      });
    },
    async manageFinanceOccurrenceMatch(
      raw: ManageFinanceOccurrenceMatchInput,
      context: FinanceMutationContext,
    ) {
      requireExplicitUser(context);
      const input = manageFinanceOccurrenceMatchInputSchema.parse(raw);
      return executeFinanceIdempotently(
        db,
        context,
        {
          operation: `finance.recurring_occurrence.${input.operation}`,
          idempotencyKey: input.idempotencyKey,
          payload: input,
          lockIdentities: [`finance-reimbursement-topology:${context.userId}`],
        },
        async (tx) => {
          await lockReimbursementTopology(tx, context.userId);
          const [original] =
            input.operation === "reverse"
              ? await tx
                  .select()
                  .from(financeOccurrenceMatchEvents)
                  .where(
                    and(
                      eq(financeOccurrenceMatchEvents.userId, context.userId),
                      eq(financeOccurrenceMatchEvents.id, input.matchId),
                    ),
                  )
                  .limit(1)
              : [];
          if (input.operation === "reverse" && original?.kind !== "match")
            throw new AppError("not_found", "Original occurrence match not found.");
          const [initialAllocation] = original?.allocationId
            ? await tx
                .select()
                .from(financeTransactionAllocations)
                .where(
                  and(
                    eq(financeTransactionAllocations.userId, context.userId),
                    eq(financeTransactionAllocations.id, original.allocationId),
                  ),
                )
                .limit(1)
            : [];
          const transactionId =
            input.operation === "reverse"
              ? (original?.incomeTransactionId ?? initialAllocation?.transactionId)
              : input.transactionId;
          if (!transactionId)
            throw new AppError(
              "conflict",
              "The original actual is unavailable; review its source.",
            );
          const [identity] = await tx
            .select()
            .from(financeTransactions)
            .where(
              and(
                eq(financeTransactions.userId, context.userId),
                eq(financeTransactions.id, transactionId),
              ),
            )
            .limit(1);
          if (!identity) throw new AppError("not_found", "Actual transaction not found.");
          const caseRows = await tx
            .select({ id: financeReimbursements.id })
            .from(financeReimbursements)
            .innerJoin(
              financeTransactionAllocations,
              and(
                eq(financeTransactionAllocations.id, financeReimbursements.allocationId),
                eq(financeTransactionAllocations.userId, context.userId),
              ),
            )
            .where(
              and(
                eq(financeReimbursements.userId, context.userId),
                eq(financeTransactionAllocations.transactionId, identity.id),
              ),
            );
          const creditRows = await tx
            .select({ id: financeReimbursementMatches.reimbursementId })
            .from(financeReimbursementMatches)
            .where(
              and(
                eq(financeReimbursementMatches.userId, context.userId),
                eq(financeReimbursementMatches.creditTransactionId, identity.id),
              ),
            );
          const caseIds = [...new Set([...caseRows, ...creditRows].map((row) => row.id))].sort();
          await lockReimbursementCases(tx, context.userId, caseIds, true);
          const [account] = await tx
            .select()
            .from(financeAccounts)
            .where(
              and(
                eq(financeAccounts.userId, context.userId),
                eq(financeAccounts.id, identity.accountId),
              ),
            )
            .orderBy(financeAccounts.id)
            .for("update");
          const [actual] = await tx
            .select()
            .from(financeTransactions)
            .where(
              and(
                eq(financeTransactions.userId, context.userId),
                eq(financeTransactions.id, identity.id),
              ),
            )
            .orderBy(financeTransactions.id)
            .for("update");
          const allocations = await tx
            .select()
            .from(financeTransactionAllocations)
            .where(
              and(
                eq(financeTransactionAllocations.userId, context.userId),
                eq(financeTransactionAllocations.transactionId, identity.id),
              ),
            )
            .orderBy(financeTransactionAllocations.id)
            .for("update");
          await lockReimbursementMatches(
            tx,
            context.userId,
            { creditTransactionIds: [identity.id], reimbursementIds: caseIds },
            true,
          );
          if (!account || !actual || actual.accountId !== account.id)
            throw new AppError("conflict", "Actual account changed; reload before matching.");
          if (input.operation === "reverse") {
            const [locked] = await tx
              .select()
              .from(financeOccurrenceMatchEvents)
              .where(
                and(
                  eq(financeOccurrenceMatchEvents.userId, context.userId),
                  eq(financeOccurrenceMatchEvents.id, input.matchId),
                ),
              )
              .orderBy(financeOccurrenceMatchEvents.id)
              .for("update");
            const [reversal] = await tx
              .select()
              .from(financeOccurrenceMatchEvents)
              .where(
                and(
                  eq(financeOccurrenceMatchEvents.userId, context.userId),
                  eq(financeOccurrenceMatchEvents.reversesMatchId, input.matchId),
                ),
              )
              .limit(1);
            if (locked?.kind !== "match" || reversal)
              throw new AppError(
                "conflict",
                "This original match is unavailable or already fully reversed.",
              );
            const [saved] = await tx
              .insert(financeOccurrenceMatchEvents)
              .values({
                userId: context.userId,
                actorUserId: context.userId,
                recordedAt: now(),
                occurrenceId: locked.occurrenceId,
                kind: "reverse",
                allocationId: null,
                incomeTransactionId: null,
                amountCents: locked.amountCents,
                currencyCode: locked.currencyCode,
                allocationRevision: null,
                transactionRevision: locked.transactionRevision,
                sourceEvidence: { originalMatchId: locked.id, reimbursementRelationshipRevision: locked.sourceEvidence.reimbursementRelationshipRevision ?? null },
                rationale: input.rationale,
                reversesMatchId: locked.id,
              })
              .returning();
            if (!saved) throw new AppError("internal_error", "Reversal could not be recorded.");
            await tx.insert(auditEvents).values(
              auditValues({
                action: "finance.occurrence_match.reversed",
                before: { matchId: locked.id },
                after: { reversalId: saved.id },
                entityId: locked.occurrenceId,
                entityType: "finance_recurring_occurrence",
                principal: context,
                requestId: context.requestId,
              }),
            );
            return cashflowResult(
              matchEventValue(saved),
              "The original actual match was fully reversed.",
            );
          }
          if (
            actual.pending ||
            actual.contextualRevision.toString() !== input.expectedTransactionRevision ||
            actual.reimbursementRelationshipRevision.toString() !== input.expectedReimbursementRelationshipRevision
          )
            throw new AppError(
              "conflict",
              "The actual transaction is pending or its revision changed.",
            );
          const day = await read(
            context.userId,
            { from: input.occurrence.localDate, to: input.occurrence.localDate },
            tx,
          );
          const expected = day.occurrences.find(
            (row) =>
              row.scheduleVersionId === input.occurrence.scheduleVersionId &&
              row.slot === input.occurrence.slot &&
              row.inCurrentSchedule,
          );
          if (
            !expected ||
            expected.expectedAmountCents === null ||
            expected.accountId !== account.id ||
            expected.currencyCode !== input.currencyCode
          )
            throw new AppError(
              "conflict",
              "The confirmed occurrence is unavailable or its account/currency differs.",
            );
          if (
            input.operation === "match_income"
              ? expected.source.kind !== "income"
              : expected.source.kind !== "obligation"
          )
            throw new AppError("invalid_request", "Actual kind and recurring source differ.");
          const data = await readCashflowActuals(tx, context.userId, {
            from: actual.transactionDate,
            to: actual.transactionDate,
            accountIds: [account.id],
          });
          const allocation =
            input.operation === "match_expense"
              ? allocations.find((row) => row.id === input.allocationId)
              : undefined;
          if (
            input.operation === "match_expense" &&
            (allocation?.state !== "active" ||
              allocation.revision !== input.expectedAllocationRevision)
          )
            throw new AppError(
              "conflict",
              "The canonical allocation changed; review its current breakdown.",
            );
          const eligibility = data.eligibility(
            actual,
            input.operation === "match_income" ? "income" : "expense",
            allocation,
          );
          const currency = actual.currencyCode ?? account.currencyCode;
          if (!eligibility.eligible || currency !== input.currencyCode)
            throw new AppError(
              "conflict",
              "Actual eligibility is unavailable; review its classification or breakdown before matching.",
              { reasons: eligibility.reasons },
            );
          const identityScope = allocation
            ? eq(financeOccurrenceMatchEvents.allocationId, allocation.id)
            : eq(financeOccurrenceMatchEvents.incomeTransactionId, actual.id);
          const originals = await tx
            .select()
            .from(financeOccurrenceMatchEvents)
            .where(
              and(
                eq(financeOccurrenceMatchEvents.userId, context.userId),
                eq(financeOccurrenceMatchEvents.kind, "match"),
                identityScope,
              ),
            )
            .orderBy(financeOccurrenceMatchEvents.id)
            .for("update");
          const reversals = originals.length
            ? await tx
                .select()
                .from(financeOccurrenceMatchEvents)
                .where(
                  and(
                    eq(financeOccurrenceMatchEvents.userId, context.userId),
                    inArray(
                      financeOccurrenceMatchEvents.reversesMatchId,
                      originals.map((row) => row.id),
                    ),
                  ),
                )
            : [];
          const reversed = new Set(reversals.map((row) => row.reversesMatchId));
          if (
            originals
              .filter((row) => !reversed.has(row.id))
              .reduce((sum, row) => sum + row.amountCents, 0) +
              input.amountCents >
            (allocation?.amount ?? actual.amount)
          )
            throw new AppError(
              "conflict",
              "The actual's remaining matching capacity is insufficient.",
            );
          const occurrenceEvents = day.matchEvents.filter(
            (event) => event.occurrenceId === expected.occurrenceId,
          );
          const reversedOccurrence = new Set(
            occurrenceEvents.flatMap((event) =>
              event.reversesMatchId ? [event.reversesMatchId] : [],
            ),
          );
          if (
            occurrenceEvents
              .filter((event) => event.kind === "match" && !reversedOccurrence.has(event.id))
              .reduce((sum, event) => sum + event.amountCents, 0) +
              input.amountCents >
            expected.expectedAmountCents
          )
            throw new AppError("conflict", "The occurrence's remaining amount is insufficient.");
          const [inserted] = await tx
            .insert(financeRecurringOccurrences)
            .values({
              userId: context.userId,
              scheduleVersionId: expected.scheduleVersionId,
              localDate: expected.localDate,
              slot: expected.slot,
              expectedAmountCents: expected.expectedAmountCents,
              currencyCode: expected.currencyCode,
            })
            .onConflictDoNothing()
            .returning();
          const [existing] = inserted
            ? [inserted]
            : await tx
                .select()
                .from(financeRecurringOccurrences)
                .where(
                  and(
                    eq(financeRecurringOccurrences.userId, context.userId),
                    eq(financeRecurringOccurrences.scheduleVersionId, expected.scheduleVersionId),
                    eq(financeRecurringOccurrences.localDate, expected.localDate),
                    eq(financeRecurringOccurrences.slot, expected.slot),
                  ),
                )
                .limit(1)
                .for("update");
          if (!existing)
            throw new AppError("internal_error", "Occurrence identity could not be materialized.");
          const [saved] = await tx
            .insert(financeOccurrenceMatchEvents)
            .values({
              userId: context.userId,
              actorUserId: context.userId,
              recordedAt: now(),
              occurrenceId: existing.id,
              kind: "match",
              allocationId: allocation?.id ?? null,
              incomeTransactionId: allocation ? null : actual.id,
              amountCents: input.amountCents,
              currencyCode: input.currencyCode,
              allocationRevision: allocation?.revision ?? null,
              transactionRevision: actual.contextualRevision,
              sourceEvidence: {
                transactionId: actual.id,
                accountId: account.id,
                scheduleVersionId: expected.scheduleVersionId,
                recognitionFingerprint: data.recognitionFingerprint(actual.id),
                reimbursementRelationshipRevision: actual.reimbursementRelationshipRevision.toString(),
              },
              rationale: input.rationale,
              reversesMatchId: null,
            })
            .returning();
          if (!saved) throw new AppError("internal_error", "Actual match could not be recorded.");
          await tx.insert(auditEvents).values(
            auditValues({
              action: "finance.occurrence_match.confirmed",
              before: null,
              after: {
                matchId: saved.id,
                transactionId: actual.id,
                allocationId: allocation?.id ?? null,
              },
              entityId: existing.id,
              entityType: "finance_recurring_occurrence",
              principal: context,
              requestId: context.requestId,
            }),
          );
          return cashflowResult(matchEventValue(saved), "Your explicit actual match was recorded.");
        },
      );
    },
  };
}
