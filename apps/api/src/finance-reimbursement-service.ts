import {
  auditEvents,
  type Database,
  financeReimbursementMatches,
  financeReimbursements,
  financeTransactionAllocations,
  financeTransactions,
} from "@personal-os/database";
import {
  type FinanceReimbursement,
  type FinanceReimbursementStatus,
  type ReconcileFinanceReimbursementInput,
  toCents,
} from "@personal-os/domain";
import { and, eq, inArray } from "drizzle-orm";
import { auditValues } from "./audit.js";
import { AppError } from "./errors.js";
import { selectPlausibleReimbursementCredits } from "./finance-reimbursement-candidates.js";
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
type ReimbursementWriter = Pick<Database, "insert" | "select" | "update">;

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
  const selection = db
    .select()
    .from(financeReimbursements)
    .where(and(eq(financeReimbursements.id, id), eq(financeReimbursements.userId, userId)));
  const [row] = lock ? await selection.for("update").limit(1) : await selection.limit(1);
  if (!row) throw new AppError("not_found", "The reimbursement was not found.");
  const matches = await db
    .select()
    .from(financeReimbursementMatches)
    .where(
      and(
        eq(financeReimbursementMatches.userId, userId),
        eq(financeReimbursementMatches.reimbursementId, row.id),
      ),
    )
    .orderBy(financeReimbursementMatches.createdAt, financeReimbursementMatches.id);
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
      const matchesByReimbursement = new Map<string, typeof matches>();
      for (const match of matches) {
        const items = matchesByReimbursement.get(match.reimbursementId) ?? [];
        items.push(match);
        matchesByReimbursement.set(match.reimbursementId, items);
      }
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
          and(eq(financeTransactions.userId, userId), eq(financeTransactions.direction, "income")),
        );
      const candidates = selectPlausibleReimbursementCredits({
        credits,
        matches,
        reimbursements: rows,
      });
      const creditById = new Map(credits.map((credit) => [credit.id, credit]));
      return {
        reimbursements: rows.map((row) =>
          serialize(row, matchesByReimbursement.get(row.id) ?? [], now()),
        ),
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
      const write = async (tx: ReimbursementWriter) => {
        const userId = context.principal.userId;
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
            input.expectedRevision === row.revision - 1 &&
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
      return executor ? write(executor) : db.transaction(write);
    },
  };
}
