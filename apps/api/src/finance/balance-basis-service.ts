import { createHash } from "node:crypto";
import {
  auditEvents,
  type Database,
  financeAccounts,
  financeBalanceInclusions,
  financeCashBalanceBases,
  financeEconomicEvents,
  financeIncomeStreams,
  financeRecurringObligations,
  financeRecurringScheduleVersions,
  financeReimbursementMatches,
  financeReimbursements,
  financeTransactionAllocations,
  financeTransactionRelationships,
  financeTransactions,
} from "@personal-os/database";
import {
  type ConfirmFinanceBalanceBasisInput,
  confirmFinanceBalanceBasisInputSchema,
  type FinanceBalanceBasis,
  type FinanceCashflowActualEligibilityReason,
  type FinanceCashflowProjectionQuery,
  type FinanceCashflowProjectionView,
  type FinanceCashflowSourceSnapshots,
  type FinanceRecurringOccurrencesQuery,
  type FinanceRecurringOccurrencesView,
  financeBalanceBasisSchema,
  financeCashflowProjectionQuerySchema,
  financePlanningEvidenceCurrencySchema,
  financeProvenanceSchema,
  financeRecurringOccurrencesQuerySchema,
  localDateAt,
  localDateToIso,
  type PaydayActualMovement,
  type PaydayOccurrence,
  projectPaydayCycle,
} from "@personal-os/domain";
import { and, desc, eq, gte, inArray, lte } from "drizzle-orm";
import { auditValues } from "../audit.js";
import { AppError } from "../errors.js";
import { lockReimbursementTopology } from "../finance-reimbursement-locks.js";
import { executeFinanceIdempotently, type FinanceMutationContext } from "./context.js";
import { requireExplicitUser } from "./planning-evidence-service.js";
import { resolveFinanceSpendingEvidence } from "./recognition.js";
import { type CashflowTransaction, cashflowResult } from "./recurring-schedule-service.js";

type Executor = Database | CashflowTransaction;
const LIMIT = 1000;
export async function readCashflowActuals(
  tx: Executor,
  userId: string,
  query: FinanceRecurringOccurrencesQuery,
) {
  const accounts = await tx
    .select()
    .from(financeAccounts)
    .where(
      and(
        eq(financeAccounts.userId, userId),
        ...(query.accountIds !== undefined ? [inArray(financeAccounts.id, query.accountIds)] : []),
      ),
    )
    .orderBy(financeAccounts.id)
    .limit(101);
  const transactions = await tx
    .select()
    .from(financeTransactions)
    .where(
      and(
        eq(financeTransactions.userId, userId),
        gte(financeTransactions.transactionDate, query.from),
        lte(financeTransactions.transactionDate, query.to),
        ...(query.accountIds !== undefined
          ? [inArray(financeTransactions.accountId, query.accountIds)]
          : []),
      ),
    )
    .orderBy(financeTransactions.id)
    .limit(LIMIT + 1);
  const ids = transactions.slice(0, LIMIT).map((row) => row.id);
  const allocations = ids.length
    ? await tx
        .select()
        .from(financeTransactionAllocations)
        .where(
          and(
            eq(financeTransactionAllocations.userId, userId),
            inArray(financeTransactionAllocations.transactionId, ids),
          ),
        )
        .limit(5001)
    : [];
  const cases = await tx
    .select()
    .from(financeReimbursements)
    .where(eq(financeReimbursements.userId, userId))
    .limit(LIMIT + 1);
  const matches = await tx
    .select()
    .from(financeReimbursementMatches)
    .where(eq(financeReimbursementMatches.userId, userId))
    .limit(LIMIT + 1);
  const relationships = await tx
    .select()
    .from(financeTransactionRelationships)
    .where(eq(financeTransactionRelationships.userId, userId))
    .limit(LIMIT + 1);
  const events = relationships.length
    ? await tx
        .select()
        .from(financeEconomicEvents)
        .where(
          and(
            eq(financeEconomicEvents.userId, userId),
            inArray(
              financeEconomicEvents.id,
              relationships.map((row) => row.economicEventId),
            ),
          ),
        )
        .limit(LIMIT + 1)
    : [];
  const eventById = new Map(events.map((row) => [row.id, row]));
  const projectedRelationships = relationships.flatMap((row) => {
    const event = eventById.get(row.economicEventId);
    const provenance = financeProvenanceSchema.safeParse(row.provenance);
    return event &&
      provenance.success &&
      ["user", "agent", "system"].includes(provenance.data.actorType)
      ? [
          {
            ...row,
            createdAt: row.createdAt.toISOString(),
            eventId: event.id,
            eventUserId: event.userId,
            provenanceValidated: true,
            provenance: { actorType: provenance.data.actorType as "user" | "agent" | "system" },
          },
        ]
      : [];
  });
  const resolved = resolveFinanceSpendingEvidence({
    userId,
    accounts,
    transactions,
    allocations,
    reimbursements: cases,
    matches,
    relationships: projectedRelationships,
  });
  const truncated =
    accounts.length > 100 ||
    transactions.length > LIMIT ||
    allocations.length > 5000 ||
    cases.length > LIMIT ||
    matches.length > LIMIT ||
    relationships.length > LIMIT;
  function eligibility(
    transaction: typeof financeTransactions.$inferSelect,
    kind: "income" | "expense",
    allocation?: typeof financeTransactionAllocations.$inferSelect,
  ) {
    const reasons: FinanceCashflowActualEligibilityReason[] = [];
    const account = accounts.find((row) => row.id === transaction.accountId);
    if (account?.kind !== "cash") reasons.push("account_unavailable");
    if (transaction.pending) reasons.push("pending");
    if ((transaction.providerDirection ?? transaction.direction) !== kind)
      reasons.push(kind === "income" ? "not_income" : "not_expense");
    const currency = transaction.currencyCode ?? account?.currencyCode;
    if (
      !financePlanningEvidenceCurrencySchema.safeParse(currency).success ||
      (transaction.currencyCode &&
        account?.currencyCode &&
        transaction.currencyCode !== account.currencyCode)
    )
      reasons.push("unsupported_currency");
    if (
      transaction.direction === "transfer" ||
      transaction.transferGroupId ||
      transaction.reconciliationStatus === "matched" ||
      transaction.reconciliationStatus === "confirmed" ||
      resolved.evidence.transferTransactionIds.has(transaction.id)
    )
      reasons.push("transfer_or_card_payment");
    const linked = relationships.filter((row) => row.transactionIds.includes(transaction.id));
    if (
      resolved.evidence.excludedTransactionIds.has(transaction.id) ||
      linked.some((row) => !projectedRelationships.some((valid) => valid.id === row.id)) ||
      truncated
    )
      reasons.push("unclassified");
    if (
      kind === "income" &&
      (resolved.evidence.refundTransactionIds.has(transaction.id) ||
        matches.some((row) => row.creditTransactionId === transaction.id) ||
        linked.some((row) => ["refund", "reimbursement", "reversal"].includes(row.relationship)))
    )
      reasons.push("reimbursement_or_refund_credit");
    if (!transaction.category || transaction.category === "OTHER") reasons.push("unclassified");
    if (allocation) {
      if (allocation.state !== "active") reasons.push("allocation_invalidated");
      const active = allocations.filter(
        (row) => row.transactionId === transaction.id && row.state === "active",
      );
      if (active.reduce((sum, row) => sum + row.amount, 0) !== transaction.amount)
        reasons.push("unclassified");
    }
    return { eligible: reasons.length === 0, reasons: [...new Set(reasons)] };
  }
  function recognitionFingerprint(transactionId: string) {
    const ownAllocations = allocations
      .filter((row) => row.transactionId === transactionId)
      .sort((a, b) => a.id.localeCompare(b.id));
    const ownCases = cases
      .filter(
        (row) =>
          ownAllocations.some((allocation) => allocation.id === row.allocationId) ||
          matches.some(
            (match) =>
              match.creditTransactionId === transactionId && match.reimbursementId === row.id,
          ),
      )
      .sort((a, b) => a.id.localeCompare(b.id));
    return createHash("sha256")
      .update(
        JSON.stringify({
          allocations: ownAllocations.map((row) => [row.id, row.revision, row.state, row.amount]),
          cases: ownCases,
          matches: matches
            .filter(
              (row) =>
                row.creditTransactionId === transactionId ||
                ownCases.some((entry) => entry.id === row.reimbursementId),
            )
            .sort((a, b) => a.id.localeCompare(b.id)),
          relationships: relationships
            .filter((row) => row.transactionIds.includes(transactionId))
            .sort((a, b) => a.id.localeCompare(b.id)),
        }),
      )
      .digest("hex");
  }
  return {
    accounts: accounts.slice(0, 100),
    transactions: transactions.slice(0, LIMIT),
    allocations,
    cases,
    matches,
    relationships,
    truncated,
    eligibility,
    recognitionFingerprint,
  };
}
export async function assertCashflowAccountMayBeDeleted(
  tx: Executor,
  userId: string,
  accountId: string,
) {
  const [schedule] = await tx
    .select({ id: financeRecurringScheduleVersions.id })
    .from(financeRecurringScheduleVersions)
    .where(
      and(
        eq(financeRecurringScheduleVersions.userId, userId),
        eq(financeRecurringScheduleVersions.accountId, accountId),
      ),
    )
    .limit(1);
  const [basis] = await tx
    .select({ id: financeCashBalanceBases.id })
    .from(financeCashBalanceBases)
    .where(
      and(
        eq(financeCashBalanceBases.userId, userId),
        eq(financeCashBalanceBases.accountId, accountId),
      ),
    )
    .limit(1);
  if (schedule || basis)
    throw new AppError(
      "conflict",
      "This account has immutable schedule or balance-statement history. Disconnect it or exclude it from planning instead of deleting it.",
    );
}
export function basisValue(
  row: typeof financeCashBalanceBases.$inferSelect,
  reflections: Array<typeof financeBalanceInclusions.$inferSelect>,
): FinanceBalanceBasis {
  return financeBalanceBasisSchema.parse({
    id: row.id,
    accountId: row.accountId,
    basisRevision: row.basisRevision,
    accountRevision: row.accountContextualRevision.toString(),
    kind: row.kind,
    amountCents: row.amountCents,
    currencyCode: row.currencyCode,
    asOf: row.asOf.toISOString(),
    validUntil: row.validUntil.toISOString(),
    protectedFloorCents: row.protectedFloorCents,
    actorUserId: row.actorUserId,
    recordedAt: row.recordedAt.toISOString(),
    reflections: reflections.map((entry) => ({
      transactionId: entry.transactionId,
      transactionRevision: entry.transactionContextualRevision.toString(),
      reflection: entry.reflection,
    })),
  });
}
export function createFinanceBalanceBasisService({
  db,
  now,
  readOccurrences,
}: {
  db: Database;
  now: () => Date;
  readOccurrences: (
    userId: string,
    query: FinanceRecurringOccurrencesQuery,
    tx?: CashflowTransaction,
  ) => Promise<FinanceRecurringOccurrencesView>;
}) {
  async function listFinanceBalanceBases(userId: string, accountIds?: string[], tx: Executor = db) {
    const rows = await tx
      .selectDistinctOn([financeCashBalanceBases.accountId])
      .from(financeCashBalanceBases)
      .where(
        and(
          eq(financeCashBalanceBases.userId, userId),
          ...(accountIds !== undefined
            ? [inArray(financeCashBalanceBases.accountId, accountIds)]
            : []),
        ),
      )
      .orderBy(financeCashBalanceBases.accountId, desc(financeCashBalanceBases.basisRevision))
      .limit(101);
    if (rows.length > 100) throw new AppError("conflict", "Select at most100 balance accounts.");
    const refs = rows.length
      ? await tx
          .select()
          .from(financeBalanceInclusions)
          .where(
            and(
              eq(financeBalanceInclusions.userId, userId),
              inArray(
                financeBalanceInclusions.basisId,
                rows.map((row) => row.id),
              ),
            ),
          )
          .limit(100001)
      : [];
    if (refs.length > 100000)
      throw new AppError("conflict", "Balance reflection history exceeds the safe read bound.");
    return rows.map((row) =>
      basisValue(
        row,
        refs.filter((ref) => ref.basisId === row.id),
      ),
    );
  }
  return {
    listFinanceBalanceBases,
    async listFinanceCashflowSources(
      userId: string,
      raw: FinanceRecurringOccurrencesQuery,
    ): Promise<FinanceCashflowSourceSnapshots> {
      const query = financeRecurringOccurrencesQuerySchema.parse(raw);
      return db.transaction(
        async (tx) => {
          const data = await readCashflowActuals(tx, userId, query);
          const income = await tx
            .select()
            .from(financeIncomeStreams)
            .where(
              and(
                eq(financeIncomeStreams.userId, userId),
                ...(query.accountIds !== undefined
                  ? [inArray(financeIncomeStreams.accountId, query.accountIds)]
                  : []),
              ),
            )
            .limit(1001);
          const obligations = await tx
            .select()
            .from(financeRecurringObligations)
            .where(
              and(
                eq(financeRecurringObligations.userId, userId),
                ...(query.accountIds !== undefined
                  ? [inArray(financeRecurringObligations.accountId, query.accountIds)]
                  : []),
              ),
            )
            .limit(1001);
          return {
            from: query.from,
            to: query.to,
            accounts: data.accounts.map((row) => ({
              id: row.id,
              name: row.name,
              currencyCode: row.currencyCode,
              kind: row.kind,
              includeInPlanning: row.includeInPlanning,
              ownershipType: row.ownershipType,
              ownershipShare: row.ownershipShareBps === null ? null : row.ownershipShareBps / 10000,
              accountRevision: row.contextualRevision.toString(),
            })),
            income: income.slice(0, 1000).map((row) => ({
              accountId: row.accountId,
              cadence: row.cadence,
              confidence: row.confidence / 10000,
              displayName: row.displayName,
              expectedAmount: row.expectedAmount / 100,
              id: row.id,
              lastObservedDate: row.lastObservedDate,
              nextExpectedDate: row.nextExpectedDate,
              payer: row.payer,
              source: row.source,
              status: row.status,
              revision: row.revision,
            })),
            obligations: obligations.slice(0, 1000).map((row) => ({
              accountId: row.accountId,
              cadence: row.cadence,
              confidence: row.confidence / 10000,
              displayName: row.displayName,
              expectedAmount: row.expectedAmount / 100,
              id: row.id,
              lastObservedDate: row.lastObservedDate,
              nextExpectedDate: row.nextExpectedDate,
              merchant: row.merchant,
              kind: row.kind,
              source: row.source,
              status: row.status,
              revision: row.revision,
            })),
            transactions: data.transactions.map((row) => ({
              id: row.id,
              accountId: row.accountId,
              merchant: row.merchant,
              date: row.transactionDate,
              amountCents: row.amount,
              currencyCode:
                row.currencyCode ??
                data.accounts.find((account) => account.id === row.accountId)?.currencyCode ??
                null,
              direction: row.direction,
              pending: row.pending,
              transactionRevision: row.contextualRevision.toString(),
              incomeEligibility: data.eligibility(row, "income"),
              allocations: data.allocations
                .filter(
                  (allocation) =>
                    allocation.transactionId === row.id && allocation.state === "active",
                )
                .map((allocation) => ({
                  id: allocation.id,
                  revision: allocation.revision,
                  amountCents: allocation.amount,
                  treatment: allocation.treatment,
                  expenseEligibility: data.eligibility(row, "expense", allocation),
                })),
            })),
            coverage: {
              truncated: data.truncated || income.length > 1000 || obligations.length > 1000,
              transactionLimit: LIMIT,
            },
          };
        },
        { isolationLevel: "repeatable read", accessMode: "read only" },
      );
    },
    async confirmFinanceBalanceBasis(
      raw: ConfirmFinanceBalanceBasisInput,
      context: FinanceMutationContext,
    ) {
      requireExplicitUser(context);
      const input = confirmFinanceBalanceBasisInputSchema.parse(raw);
      if (Date.parse(input.asOf) > now().getTime())
        throw new AppError(
          "invalid_request",
          "Balance statement as-of time cannot be in the future.",
        );
      return executeFinanceIdempotently(
        db,
        context,
        {
          operation: "finance.balance_basis.confirm",
          idempotencyKey: input.idempotencyKey,
          payload: input,
          lockIdentities: [`finance-reimbursement-topology:${context.userId}`],
        },
        async (tx) => {
          await lockReimbursementTopology(tx, context.userId);
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
          if (!account) throw new AppError("not_found", "Cash account not found.");
          if (
            account.kind !== "cash" ||
            account.contextualRevision.toString() !== input.expectedAccountRevision
          )
            throw new AppError(
              "conflict",
              "Account changed or is not a cash account; reload its current revision.",
            );
          if (account.currencyCode !== null && account.currencyCode !== input.currencyCode)
            throw new AppError("invalid_request", "Statement and account currency differ.");
          const [previous] = await tx
            .select()
            .from(financeCashBalanceBases)
            .where(
              and(
                eq(financeCashBalanceBases.userId, context.userId),
                eq(financeCashBalanceBases.accountId, account.id),
              ),
            )
            .orderBy(desc(financeCashBalanceBases.basisRevision))
            .limit(1);
          if ((previous?.basisRevision ?? 0) !== input.expectedBasisRevision)
            throw new AppError("conflict", "A newer balance statement exists; reload it.");
          const ids = input.reflections.map((row) => row.transactionId).sort();
          const transactions = ids.length
            ? await tx
                .select()
                .from(financeTransactions)
                .where(
                  and(
                    eq(financeTransactions.userId, context.userId),
                    eq(financeTransactions.accountId, account.id),
                    inArray(financeTransactions.id, ids),
                  ),
                )
                .orderBy(financeTransactions.id)
                .for("update")
            : [];
          if (
            transactions.length !== ids.length ||
            transactions.some(
              (row) =>
                input.reflections.find((ref) => ref.transactionId === row.id)
                  ?.transactionRevision !== row.contextualRevision.toString(),
            )
          )
            throw new AppError(
              "conflict",
              "A reflected transaction is unavailable or changed; reload the actuals.",
            );
          const [saved] = await tx
            .insert(financeCashBalanceBases)
            .values({
              userId: context.userId,
              actorUserId: context.userId,
              recordedAt: now(),
              accountId: account.id,
              basisRevision: input.expectedBasisRevision + 1,
              accountContextualRevision: account.contextualRevision,
              kind: input.kind,
              amountCents: input.amountCents,
              currencyCode: input.currencyCode,
              asOf: new Date(input.asOf),
              validUntil: new Date(input.validUntil),
              protectedFloorCents: input.protectedFloorCents,
            })
            .returning();
          if (!saved)
            throw new AppError("internal_error", "Balance statement could not be recorded.");
          const reflections = input.reflections.length
            ? await tx
                .insert(financeBalanceInclusions)
                .values(
                  input.reflections.map((ref) => ({
                    userId: context.userId,
                    basisId: saved.id,
                    transactionId: ref.transactionId,
                    transactionContextualRevision: BigInt(ref.transactionRevision),
                    reflection: ref.reflection,
                  })),
                )
                .returning()
            : [];
          await tx.insert(auditEvents).values(
            auditValues({
              action: "finance.balance_basis.confirmed",
              before: { basisRevision: previous?.basisRevision ?? 0 },
              after: {
                basisId: saved.id,
                basisRevision: saved.basisRevision,
                reflectionCount: reflections.length,
              },
              entityId: account.id,
              entityType: "finance_account",
              principal: context,
              requestId: context.requestId,
            }),
          );
          return cashflowResult(
            basisValue(saved, reflections),
            "Your balance statement and exact transaction reflections were recorded.",
          );
        },
      );
    },
    async getFinanceCashflowProjection(
      userId: string,
      raw: FinanceCashflowProjectionQuery,
    ): Promise<FinanceCashflowProjectionView> {
      const query = financeCashflowProjectionQuerySchema.parse(raw);
      return db.transaction(
        async (tx) => {
          const schedule = await readOccurrences(userId, query, tx);
          const unavailable = (
            code:
              | "balance_basis_unavailable"
              | "actual_review_required"
              | "unconfirmed_schedule"
              | "unknown_amount",
          ): FinanceCashflowProjectionView => ({
            schedule,
            projection: { status: "unavailable", reasons: [{ code, evidenceId: null }] },
          });
          if (schedule.unavailableSources.length) return unavailable("unconfirmed_schedule");
          const data = await readCashflowActuals(tx, userId, {
            ...query,
            from: "0001-01-01",
            to: "9999-12-31",
          });
          const bases = await listFinanceBalanceBases(userId, query.accountIds, tx);
          const selected = data.accounts.filter((row) => row.includeInPlanning);
          if (
            data.truncated ||
            !selected.length ||
            selected.some(
              (account) =>
                !bases.some(
                  (basis) =>
                    basis.accountId === account.id &&
                    basis.accountRevision === account.contextualRevision.toString(),
                ),
            )
          )
            return unavailable("balance_basis_unavailable");
          // The complete visible actual range must have exact current reflection evidence; new or revised rows fail closed.
          const movements: PaydayActualMovement[] = [];
          for (const row of data.transactions.filter((entry) =>
            selected.some((account) => account.id === entry.accountId),
          )) {
            const basis = bases.find((entry) => entry.accountId === row.accountId);
            const reflection = basis?.reflections.find(
              (ref) =>
                ref.transactionId === row.id &&
                ref.transactionRevision === row.contextualRevision.toString(),
            );
            if (!reflection) return unavailable("actual_review_required");
            const eligible = data.eligibility(
              row,
              row.direction === "income" ? "income" : "expense",
            );
            if (!eligible.eligible) return unavailable("actual_review_required");
            movements.push({
              id: row.id,
              version: row.contextualRevision.toString(),
              localDate: row.transactionDate,
              amountMinorUnits: row.amount,
              currencyCode: row.currencyCode ?? basis?.currencyCode ?? "",
              accountId: row.accountId,
              direction: row.direction === "income" ? "incoming" : "outgoing",
              classification: row.direction === "income" ? "external_income" : "external_expense",
              pairedMovementId: null,
              postingStatus: row.pending ? "pending" : "posted",
              balanceReflection: reflection.reflection,
            });
          }
          const occurrences: PaydayOccurrence[] = schedule.occurrences
            .filter((row) => row.inCurrentSchedule)
            .map((row) => ({
              id: row.key,
              version: row.scheduleVersionId,
              localDate: row.localDate,
              amountMinorUnits: row.expectedAmountCents,
              currencyCode: row.currencyCode,
              accountId: row.accountId ?? "",
              direction: row.source.kind === "income" ? "incoming" : "outgoing",
              classification: row.source.kind === "income" ? "external_income" : "external_expense",
              incomeStreamId: row.source.kind === "income" ? row.source.id : null,
              pairedOccurrenceId: null,
              remainingExpectedMinorUnits: row.remainingExpectedCents,
              matches: schedule.matchEvents
                .filter((event) => row.matchIds.includes(event.id) && event.kind === "match")
                .map((event) => ({
                  actualMovementId:
                    event.incomeTransactionId ??
                    data.allocations.find((allocation) => allocation.id === event.allocationId)
                      ?.transactionId ??
                    "",
                  replacedExpectedMinorUnits: event.amountCents,
                })),
            }));
          if (
            schedule.occurrences.some(
              (row) =>
                row.amountBasis !== "fixed" ||
                row.matchState === "invalidated" ||
                row.expectedAmountCents === null,
            )
          )
            return unavailable("unknown_amount");
          const payday = occurrences
            .filter(
              (row) =>
                row.incomeStreamId === query.selectedIncomeStreamId &&
                row.localDate !== null &&
                row.localDate >= query.from,
            )
            .sort((a, b) => (a.localDate ?? "").localeCompare(b.localDate ?? ""))[0];
          const asOf = now();
          const timezone = await tx.query.users.findFirst({
            where: (table, { eq }) => eq(table.id, userId),
            columns: { planningTimezone: true },
          });
          if (!timezone) return unavailable("balance_basis_unavailable");
          const chosen = bases.filter((basis) =>
            selected.some((account) => account.id === basis.accountId),
          );
          const floors = chosen.map((basis) => basis.protectedFloorCents);
          const floorKnown = floors.every((value) => value !== null);
          const projection = projectPaydayCycle({
            periodStartLocalDate: query.from,
            asOfLocalDate: localDateToIso(localDateAt(asOf, timezone.planningTimezone)),
            asOfInstant: asOf.toISOString(),
            selectedIncomeStreamId: query.selectedIncomeStreamId,
            nextPayday: {
              occurrenceId: payday?.id ?? "",
              localDate: payday?.localDate ?? null,
              dateBasis: payday ? "authoritative" : "unknown",
            },
            balances: chosen.map((basis) => {
              const account = selected.find((row) => row.id === basis.accountId);
              return {
                accountId: basis.accountId,
                accountKind: account?.kind === "cash" ? "cash" : "other",
                basis: basis.kind,
                amountMinorUnits: basis.amountCents,
                currencyCode: basis.currencyCode,
                asOfInstant: basis.asOf,
                validUntilInstant: basis.validUntil,
                sourceRevision: `${basis.id}:${basis.basisRevision}`,
                included: true,
                ownershipFraction:
                  account?.ownershipType === "individual"
                    ? 1
                    : account?.ownershipShareBps === null
                      ? 0
                      : (account?.ownershipShareBps ?? 0) / 10000,
              };
            }),
            occurrences,
            actualMovements: movements,
            ...(floorKnown && chosen.length
              ? {
                  protectedFloor: {
                    amountMinorUnits: floors.reduce<number>((sum, value) => sum + (value ?? 0), 0),
                    currencyCode: chosen[0]?.currencyCode ?? "",
                    accountIds: chosen.map((basis) => basis.accountId),
                    confirmed: true,
                    asOfLocalDate: query.from,
                    sourceRevision: chosen.map((basis) => basis.id).join(":"),
                  },
                }
              : {}),
          });
          return { schedule, projection };
        },
        { isolationLevel: "repeatable read", accessMode: "read only" },
      );
    },
  };
}
