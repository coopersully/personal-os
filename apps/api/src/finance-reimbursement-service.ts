import {
  auditEvents,
  type Database,
  financeAccounts,
  financeReimbursementMatches,
  financeReimbursements,
  financeTransactionAllocations,
  financeTransactions,
} from "@personal-os/database";
import {
  type FinanceReimbursement,
  type FinanceReimbursementStatus,
  financeReimbursementCorrectionSchema,
  type ReconcileFinanceReimbursementInput,
  toCents,
} from "@personal-os/domain";
import { and, desc, eq, gte, inArray } from "drizzle-orm";
import { auditValues } from "./audit.js";
import { AppError } from "./errors.js";
import { executeFinanceIdempotently, loadFinanceAuthorization } from "./finance/context.js";
import { selectPlausibleReimbursementCredits } from "./finance-reimbursement-candidates.js";
import {
  lockReimbursementCases,
  lockReimbursementMatches,
  lockReimbursementTopology,
} from "./finance-reimbursement-locks.js";
import type { Principal } from "./types.js";

export function deriveReimbursementStatus({
  cancelledAt,
  dueDate,
  expectedCents,
  receivedCents,
  now,
  status,
}: {
  cancelledAt: Date | null;
  dueDate: string | null;
  expectedCents: number;
  receivedCents: number;
  now: Date;
  status?: FinanceReimbursementStatus;
}): FinanceReimbursementStatus {
  // An explicit evidence/ownership conflict must remain actionable rather
  // than being hidden by a calendar-derived lifecycle state.
  if (status === "needs_input") return "needs_input";
  if (cancelledAt) return "cancelled";
  if (receivedCents >= expectedCents) return "received";
  if (dueDate && dueDate < now.toISOString().slice(0, 10)) return "overdue";
  return receivedCents > 0 ? "partially_received" : "expected";
}

type Context = { principal: Principal; requestId: string };
type ReimbursementWriter = Parameters<Parameters<Database["transaction"]>[0]>[0];

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

function serialize(
  row: typeof financeReimbursements.$inferSelect,
  matches: Array<typeof financeReimbursementMatches.$inferSelect>,
  now?: Date,
): FinanceReimbursement {
  return {
    allocationId: row.allocationId,
    cancelledAt: row.cancelledAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    dueDate: row.dueDate,
    cancelledEvidence: row.cancelledEvidence as FinanceReimbursement["cancelledEvidence"],
    cancelledRationale: row.cancelledRationale,
    evidence: row.evidence as FinanceReimbursement["evidence"],
    expectedAmount: row.expectedAmount / 100,
    id: row.id,
    matches: matches.map((match) => ({
      amount: match.amount / 100,
      creditTransactionId: match.creditTransactionId,
      createdAt: match.createdAt.toISOString(),
      evidence: match.evidence as FinanceReimbursement["matches"][number]["evidence"],
      id: match.id,
      rationale: match.rationale,
      reimbursementId: match.reimbursementId,
    })),
    payer: row.payer,
    rationale: row.rationale,
    receivedAmount: row.receivedAmount / 100,
    revision: row.revision,
    status: now
      ? deriveReimbursementStatus({
          cancelledAt: row.cancelledAt,
          dueDate: row.dueDate,
          expectedCents: row.expectedAmount,
          now,
          receivedCents: row.receivedAmount,
          status: row.status,
        })
      : row.status,
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function readReimbursement(
  db: Pick<Database, "select">,
  userId: string,
  id: string,
  lock = false,
) {
  const [row] = await lockReimbursementCases(db, userId, [id], lock);
  if (!row) throw new AppError("not_found", "The reimbursement was not found.");
  const matches = await lockReimbursementMatches(db, userId, { reimbursementIds: [row.id] }, lock);
  return { matches, row };
}

export function createFinanceReimbursementService({ db, now }: { db: Database; now: () => Date }) {
  return {
    async list(userId: string) {
      const rows = await db
        .select()
        .from(financeReimbursements)
        .where(eq(financeReimbursements.userId, userId))
        .orderBy(financeReimbursements.dueDate, financeReimbursements.createdAt);
      const ids = rows.map((row) => row.id);
      const matches = ids.length
        ? await db
            .select()
            .from(financeReimbursementMatches)
            .where(
              and(
                eq(financeReimbursementMatches.userId, userId),
                inArray(financeReimbursementMatches.reimbursementId, ids),
              ),
            )
        : [];
      const correctionAudits = ids.length
        ? await db
            .select()
            .from(auditEvents)
            .where(
              and(
                eq(auditEvents.userId, userId),
                eq(auditEvents.entityType, "finance_reimbursement"),
                inArray(auditEvents.entityId, ids),
                inArray(auditEvents.action, [
                  "finance.reimbursement_corrected",
                  "finance.reimbursement_credit_unmatched",
                ]),
              ),
            )
            .orderBy(auditEvents.createdAt, auditEvents.id)
        : [];
      const matchesByReimbursement = new Map<string, typeof matches>();
      for (const match of matches) {
        const items = matchesByReimbursement.get(match.reimbursementId) ?? [];
        items.push(match);
        matchesByReimbursement.set(match.reimbursementId, items);
      }
      // Read current owned source facts separately from immutable match-recorded evidence.
      const allocationIds = [...new Set(rows.map((row) => row.allocationId))];
      const expenseSources = allocationIds.length
        ? await db
            .select({
              allocationId: financeTransactionAllocations.id,
              allocationAmount: financeTransactionAllocations.amount,
              allocationRevision: financeTransactionAllocations.revision,
              allocationState: financeTransactionAllocations.state,
              allocationTreatment: financeTransactionAllocations.treatment,
              transactionId: financeTransactions.id,
              amount: financeTransactions.amount,
              currency: financeTransactions.currencyCode,
              date: financeTransactions.transactionDate,
              merchant: financeTransactions.merchant,
              pending: financeTransactions.pending,
            })
            .from(financeTransactionAllocations)
            .innerJoin(
              financeTransactions,
              and(
                eq(financeTransactions.id, financeTransactionAllocations.transactionId),
                eq(financeTransactions.userId, userId),
              ),
            )
            .innerJoin(
              financeAccounts,
              and(
                eq(financeAccounts.id, financeTransactions.accountId),
                eq(financeAccounts.userId, userId),
              ),
            )
            .where(
              and(
                eq(financeTransactionAllocations.userId, userId),
                inArray(financeTransactionAllocations.id, allocationIds),
              ),
            )
        : [];
      const expenseByAllocation = new Map(
        expenseSources.map((source) => [source.allocationId, source]),
      );
      const creditIds = [...new Set(matches.map((match) => match.creditTransactionId))];
      const receiptSources = creditIds.length
        ? await db
            .select({
              transactionId: financeTransactions.id,
              amount: financeTransactions.amount,
              currency: financeTransactions.currencyCode,
              date: financeTransactions.transactionDate,
              merchant: financeTransactions.merchant,
              pending: financeTransactions.pending,
            })
            .from(financeTransactions)
            .innerJoin(
              financeAccounts,
              and(
                eq(financeAccounts.id, financeTransactions.accountId),
                eq(financeAccounts.userId, userId),
              ),
            )
            .where(
              and(
                eq(financeTransactions.userId, userId),
                inArray(financeTransactions.id, creditIds),
              ),
            )
        : [];
      const receiptById = new Map(receiptSources.map((source) => [source.transactionId, source]));
      const openAllocationIds = rows
        .filter((row) => row.status !== "cancelled" && row.status !== "received")
        .map((row) => row.allocationId);
      const openAllocations = openAllocationIds.length
        ? await db
            .select({ transactionId: financeTransactionAllocations.transactionId })
            .from(financeTransactionAllocations)
            .where(
              and(
                eq(financeTransactionAllocations.userId, userId),
                inArray(financeTransactionAllocations.id, openAllocationIds),
              ),
            )
        : [];
      const openTransactionIds = openAllocations.map((row) => row.transactionId);
      const openExpenseDates = openTransactionIds.length
        ? await db
            .select({ date: financeTransactions.transactionDate })
            .from(financeTransactions)
            .where(
              and(
                eq(financeTransactions.userId, userId),
                inArray(financeTransactions.id, openTransactionIds),
              ),
            )
        : [];
      const oldestOpenAnchor = openExpenseDates.map((row) => row.date).toSorted()[0];
      const credits = await db
        .select({
          category: financeTransactions.category,
          id: financeTransactions.id,
          amount: financeTransactions.amount,
          date: financeTransactions.transactionDate,
          merchant: financeTransactions.merchant,
          pending: financeTransactions.pending,
        })
        .from(financeTransactions)
        .where(
          and(
            eq(financeTransactions.userId, userId),
            eq(financeTransactions.direction, "income"),
            oldestOpenAnchor
              ? gte(financeTransactions.transactionDate, oldestOpenAnchor)
              : undefined,
          ),
        )
        .orderBy(desc(financeTransactions.transactionDate), desc(financeTransactions.id))
        .limit(500);
      const candidates = selectPlausibleReimbursementCredits({
        credits,
        matches,
        reimbursements: rows,
      });
      const creditById = new Map(credits.map((credit) => [credit.id, credit]));
      return {
        reimbursements: rows.map((row): FinanceReimbursement => {
          const item = serialize(row, matchesByReimbursement.get(row.id) ?? [], now());
          const source = expenseByAllocation.get(row.allocationId);
          return {
            ...item,
            corrections: correctionAudits
              .filter((audit) => audit.entityId === row.id)
              .flatMap((audit) => {
                const parsed = financeReimbursementCorrectionSchema.safeParse({
                  ...(audit.after?.correction as Record<string, unknown> | undefined),
                  id: audit.id,
                  recordedAt: audit.createdAt.toISOString(),
                });
                return parsed.success ? [parsed.data] : [];
              }),
            sourceExpense: source
              ? {
                  transactionId: source.transactionId,
                  amount: source.amount / 100,
                  currency: source.currency,
                  date: source.date,
                  merchant: source.merchant,
                  pending: source.pending,
                  allocationAmount: source.allocationAmount / 100,
                  allocationRevision: source.allocationRevision,
                  allocationState: source.allocationState,
                  allocationTreatment: source.allocationTreatment,
                }
              : null,
            matches: item.matches.map((match) => {
              const credit = receiptById.get(match.creditTransactionId);
              return {
                ...match,
                creditTransaction: credit ? { ...credit, amount: credit.amount / 100 } : null,
              };
            }),
          };
        }),
        unmatchedCredits: candidates.flatMap((candidate) => {
          const credit = creditById.get(candidate.transactionId);
          return credit
            ? [
                {
                  amount: candidate.remainingAmount / 100,
                  date: credit.date,
                  transactionId: credit.id,
                },
              ]
            : [];
        }),
      };
    },

    async reconcile(
      input: ReconcileFinanceReimbursementInput,
      context: Context,
      executor?: ReimbursementWriter,
    ) {
      const correction =
        input.operation === "correct_expected" || input.operation === "unmatch_credit";
      if (
        correction &&
        (context.principal.actorType !== "user" ||
          context.principal.actorId !== context.principal.userId)
      )
        throw new AppError(
          "forbidden",
          "Reimbursement corrections require your explicit confirmation.",
        );
      const write = async (tx: ReimbursementWriter) => {
        const userId = context.principal.userId;
        await lockReimbursementTopology(tx, userId);
        if (input.operation === "create") {
          const [allocation] = await tx
            .select()
            .from(financeTransactionAllocations)
            .where(
              and(
                eq(financeTransactionAllocations.id, input.allocationId),
                eq(financeTransactionAllocations.userId, userId),
              ),
            )
            .for("update")
            .limit(1);
          if (allocation?.state !== "active" || allocation.treatment !== "reimbursable")
            throw new AppError(
              "invalid_request",
              "A reimbursement must use one of your active reimbursable allocations.",
            );
          const existing = await tx
            .select()
            .from(financeReimbursements)
            .where(
              and(
                eq(financeReimbursements.userId, userId),
                eq(financeReimbursements.allocationId, allocation.id),
              ),
            )
            .orderBy(financeReimbursements.id)
            .for("update");
          const expectedAmount = toCents(input.expectedAmount);
          const replay = existing.find(
            (item) =>
              item.expectedAmount === expectedAmount &&
              item.payer === input.payer &&
              item.dueDate === input.dueDate &&
              item.rationale === input.rationale &&
              stableJson(item.evidence) === stableJson(input.evidence),
          );
          if (replay) {
            const replayMatches = await tx
              .select()
              .from(financeReimbursementMatches)
              .where(eq(financeReimbursementMatches.reimbursementId, replay.id));
            return serialize(replay, replayMatches);
          }
          if (
            expectedAmount +
              existing.reduce(
                (sum, item) =>
                  sum + (item.status === "cancelled" ? item.receivedAmount : item.expectedAmount),
                0,
              ) >
            allocation.amount
          )
            throw new AppError(
              "invalid_request",
              "Expected reimbursements cannot exceed the reimbursable allocation.",
            );
          const [created] = await tx
            .insert(financeReimbursements)
            .values({
              allocationId: allocation.id,
              createdAt: now(),
              dueDate: input.dueDate,
              evidence: input.evidence,
              expectedAmount,
              payer: input.payer,
              rationale: input.rationale,
              userId,
            })
            .returning();
          if (!created) throw new AppError("conflict", "The reimbursement could not be created.");
          await tx.insert(auditEvents).values(
            auditValues({
              action: "finance.reimbursement_created",
              after: { matchCount: 0, revision: created.revision, status: created.status },
              before: null,
              entityId: created.id,
              entityType: "finance_reimbursement",
              ...context,
            }),
          );
          return serialize(created, []);
        }

        // The owner topology lock serializes absent matches and crossed case/credit writes.
        // Corrections preserve the original case and record removed evidence in its audit history.
        if (input.operation === "correct_expected" || input.operation === "unmatch_credit") {
          const [row] = await lockReimbursementCases(tx, userId, [input.reimbursementId], true);
          if (!row) throw new AppError("not_found", "The reimbursement was not found.");
          if (row.revision !== input.expectedRevision)
            throw new AppError(
              "conflict",
              "The reimbursement changed; refresh before correcting it.",
            );
          const [allocation] = await tx
            .select()
            .from(financeTransactionAllocations)
            .where(
              and(
                eq(financeTransactionAllocations.id, row.allocationId),
                eq(financeTransactionAllocations.userId, userId),
              ),
            )
            .limit(1);
          if (!allocation) throw new AppError("not_found", "The source allocation was not found.");
          const preliminaryMatches = await lockReimbursementMatches(tx, userId, {
            reimbursementIds: [row.id],
          });
          const transactionIds = [
            ...new Set([
              allocation.transactionId,
              ...preliminaryMatches.map((match) => match.creditTransactionId),
            ]),
          ].sort();
          const transactions = await tx
            .select()
            .from(financeTransactions)
            .where(
              and(
                eq(financeTransactions.userId, userId),
                inArray(financeTransactions.id, transactionIds),
              ),
            );
          const accountIds = [...new Set(transactions.map((item) => item.accountId))].sort();
          if (accountIds.length)
            await tx
              .select()
              .from(financeAccounts)
              .where(
                and(eq(financeAccounts.userId, userId), inArray(financeAccounts.id, accountIds)),
              )
              .orderBy(financeAccounts.id)
              .for("update");
          const lockedTransactions = await tx
            .select()
            .from(financeTransactions)
            .where(
              and(
                eq(financeTransactions.userId, userId),
                inArray(financeTransactions.id, transactionIds),
              ),
            )
            .orderBy(financeTransactions.id)
            .for("update");
          const [lockedAllocation] = await tx
            .select()
            .from(financeTransactionAllocations)
            .where(
              and(
                eq(financeTransactionAllocations.userId, userId),
                eq(financeTransactionAllocations.id, allocation.id),
              ),
            )
            .for("update");
          if (!lockedAllocation || lockedAllocation.revision !== allocation.revision)
            throw new AppError(
              "conflict",
              "The source allocation changed; refresh before correcting it.",
            );
          const matches = await lockReimbursementMatches(
            tx,
            userId,
            { reimbursementIds: [row.id] },
            true,
          );
          const matchedCreditId =
            input.operation === "unmatch_credit"
              ? matches.find((match) => match.id === input.matchId)?.creditTransactionId
              : undefined;
          const canonicalEvidence: FinanceReimbursement["evidence"] = {
            summary: input.evidence.summary,
            sourceRefs: lockedTransactions
              .filter(
                (transaction) =>
                  transaction.id === allocation.transactionId || transaction.id === matchedCreditId,
              )
              .map((transaction) => ({
                accountId: transaction.accountId,
                provider: "local",
                remoteId: transaction.id,
                revision: transaction.updatedAt.toISOString(),
                sourceType: "finance_transaction",
              })),
          };
          if (
            !canonicalEvidence.sourceRefs.some(
              (source) => source.remoteId === allocation.transactionId,
            )
          )
            throw new AppError(
              "conflict",
              "The source expense is unavailable; refresh before correcting it.",
            );
          let remainingMatches = matches;
          let expectedAmount = row.expectedAmount;
          if (input.operation === "correct_expected") {
            if (row.cancelledAt)
              throw new AppError("conflict", "Cancelled expectations cannot be edited.");
            if (allocation.state !== "active" || allocation.treatment !== "reimbursable")
              throw new AppError(
                "conflict",
                "Review the source expense allocation before correcting this expectation.",
              );
            expectedAmount = toCents(input.expectedAmount);
            const siblings = await tx
              .select()
              .from(financeReimbursements)
              .where(
                and(
                  eq(financeReimbursements.userId, userId),
                  eq(financeReimbursements.allocationId, allocation.id),
                ),
              );
            const reserved = siblings
              .filter((item) => item.id !== row.id)
              .reduce(
                (sum, item) => sum + (item.cancelledAt ? item.receivedAmount : item.expectedAmount),
                0,
              );
            if (
              expectedAmount < row.receivedAmount ||
              expectedAmount + reserved > allocation.amount
            )
              throw new AppError(
                "invalid_request",
                "The expectation must cover recorded receipts and fit the source allocation's remaining capacity.",
              );
          } else {
            const match = matches.find((item) => item.id === input.matchId);
            if (!match)
              throw new AppError(
                "conflict",
                "This receipt is no longer matched; refresh its history.",
              );
            await tx
              .delete(financeReimbursementMatches)
              .where(
                and(
                  eq(financeReimbursementMatches.id, match.id),
                  eq(financeReimbursementMatches.userId, userId),
                ),
              );
            remainingMatches = matches.filter((item) => item.id !== match.id);
          }
          if (matches.reduce((sum, item) => sum + item.amount, 0) !== row.receivedAmount)
            throw new AppError(
              "conflict",
              "The recorded receipts need review before this reimbursement can be corrected.",
            );
          const receivedAmount = remainingMatches.reduce((sum, item) => sum + item.amount, 0);
          const dueDate = input.operation === "correct_expected" ? input.dueDate : row.dueDate;
          const status = deriveReimbursementStatus({
            cancelledAt: row.cancelledAt,
            dueDate,
            expectedCents: expectedAmount,
            receivedCents: receivedAmount,
            now: now(),
            status: row.status,
          });
          const [updated] = await tx
            .update(financeReimbursements)
            .set({
              expectedAmount,
              receivedAmount,
              dueDate,
              ...(input.operation === "correct_expected"
                ? { payer: input.payer, evidence: canonicalEvidence, rationale: input.rationale }
                : {}),
              revision: row.revision + 1,
              status,
              updatedAt: now(),
            })
            .where(
              and(
                eq(financeReimbursements.id, row.id),
                eq(financeReimbursements.userId, userId),
                eq(financeReimbursements.revision, input.expectedRevision),
              ),
            )
            .returning();
          if (!updated)
            throw new AppError(
              "conflict",
              "The reimbursement changed before the correction was recorded.",
            );
          await tx.insert(auditEvents).values(
            auditValues({
              action:
                input.operation === "correct_expected"
                  ? "finance.reimbursement_corrected"
                  : "finance.reimbursement_credit_unmatched",
              before: { reimbursement: serialize(row, matches), matches },
              after: {
                reimbursement: serialize(updated, remainingMatches),
                evidence: canonicalEvidence,
                rationale: input.rationale,
                correction: {
                  operation: input.operation,
                  rationale: input.rationale,
                  evidence: canonicalEvidence,
                  previousExpectedAmount: row.expectedAmount / 100,
                  expectedAmount: updated.expectedAmount / 100,
                  removedMatch:
                    input.operation === "unmatch_credit"
                      ? (serialize(row, matches).matches.find(
                          (match) => match.id === input.matchId,
                        ) ?? null)
                      : null,
                },
              },
              entityId: row.id,
              entityType: "finance_reimbursement",
              ...context,
            }),
          );
          return serialize(updated, remainingMatches);
        }
        const { row, matches } = await readReimbursement(tx, userId, input.reimbursementId, true);
        if (input.operation === "cancel") {
          if (row.status === "cancelled") {
            if (
              input.expectedRevision === row.revision - 1 &&
              input.rationale === row.cancelledRationale &&
              stableJson(input.evidence) === stableJson(row.cancelledEvidence)
            )
              return serialize(row, matches);
            throw new AppError(
              "conflict",
              "The cancellation replay differs from the recorded input.",
            );
          }
          if (row.revision !== input.expectedRevision)
            throw new AppError("conflict", "The reimbursement changed before cancellation.");
          const [cancelled] = await tx
            .update(financeReimbursements)
            .set({
              cancelledAt: now(),
              cancelledEvidence: input.evidence,
              cancelledRationale: input.rationale,
              revision: row.revision + 1,
              status: "cancelled",
              updatedAt: now(),
            })
            .where(eq(financeReimbursements.id, row.id))
            .returning();
          if (!cancelled)
            throw new AppError("conflict", "The reimbursement could not be cancelled.");
          await tx.insert(auditEvents).values(
            auditValues({
              action: "finance.reimbursement_cancelled",
              after: {
                matchCount: matches.length,
                revision: cancelled.revision,
                status: cancelled.status,
              },
              before: { status: row.status },
              entityId: row.id,
              entityType: "finance_reimbursement",
              ...context,
            }),
          );
          return serialize(cancelled, matches);
        }

        if (row.status === "cancelled")
          throw new AppError("invalid_request", "Cancelled reimbursements cannot receive credits.");
        const amount = toCents(input.amount);
        const existingMatch = matches.find(
          (match) => match.creditTransactionId === input.creditTransactionId,
        );
        if (existingMatch && existingMatch.amount === amount) {
          if (
            input.rationale === existingMatch.rationale &&
            stableJson(input.evidence) === stableJson(existingMatch.evidence)
          )
            return serialize(row, matches);
          throw new AppError(
            "conflict",
            "The credit-match replay differs from the recorded input.",
          );
        }
        if (row.revision !== input.expectedRevision)
          throw new AppError("conflict", "The reimbursement changed before reconciliation.");
        if (existingMatch)
          throw new AppError("conflict", "This credit is already matched at a different amount.");
        if (amount > row.expectedAmount - row.receivedAmount)
          throw new AppError(
            "invalid_request",
            "A credit match cannot exceed the reimbursement remaining amount.",
          );
        const [credit] = await tx
          .select()
          .from(financeTransactions)
          .where(
            and(
              eq(financeTransactions.id, input.creditTransactionId),
              eq(financeTransactions.userId, userId),
            ),
          )
          .for("update")
          .limit(1);
        if (credit?.direction !== "income" || credit.pending)
          throw new AppError("invalid_request", "Choose one of your income credits to match.");
        const creditMatches = await tx
          .select({ amount: financeReimbursementMatches.amount })
          .from(financeReimbursementMatches)
          .where(
            and(
              eq(financeReimbursementMatches.userId, userId),
              eq(financeReimbursementMatches.creditTransactionId, credit.id),
            ),
          )
          .for("update");
        if (amount + creditMatches.reduce((sum, item) => sum + item.amount, 0) > credit.amount)
          throw new AppError(
            "invalid_request",
            "A credit cannot be matched for more than its amount.",
          );
        const receivedAmount = row.receivedAmount + amount;
        const status = deriveReimbursementStatus({
          cancelledAt: null,
          dueDate: row.dueDate,
          expectedCents: row.expectedAmount,
          receivedCents: receivedAmount,
          now: now(),
        });
        const [match] = await tx
          .insert(financeReimbursementMatches)
          .values({
            amount,
            creditTransactionId: credit.id,
            evidence: input.evidence,
            rationale: input.rationale,
            reimbursementId: row.id,
            userId,
          })
          .returning();
        const [updated] = await tx
          .update(financeReimbursements)
          .set({
            receivedAmount,
            revision: row.revision + 1,
            status,
            updatedAt: now(),
          })
          .where(eq(financeReimbursements.id, row.id))
          .returning();
        if (!updated || !match)
          throw new AppError("conflict", "The reimbursement could not be reconciled.");
        await tx.insert(auditEvents).values(
          auditValues({
            action: "finance.reimbursement_reconciled",
            after: { matchCount: matches.length + 1, revision: updated.revision, status },
            before: { status: row.status },
            entityId: row.id,
            entityType: "finance_reimbursement",
            ...context,
          }),
        );
        return serialize(updated, [...matches, match]);
      };
      if (input.operation === "correct_expected" || input.operation === "unmatch_credit") {
        const authorization = await loadFinanceAuthorization({
          db: executor ?? db,
          principal: context.principal,
          requestId: context.requestId,
        });
        return executeFinanceIdempotently(
          db,
          authorization,
          {
            idempotencyKey: input.idempotencyKey,
            operation: `reimbursement:${input.operation}`,
            payload: input,
            requireUserAdmission: true,
            lockIdentities: [`finance-reimbursement-topology:${context.principal.userId}`],
          },
          write,
          executor,
        );
      }
      return executor ? write(executor) : db.transaction(write);
    },
  };
}
