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
import type { Principal } from "./types.js";

export function deriveReimbursementStatus({
  cancelledAt,
  dueDate,
  expectedCents,
  receivedCents,
  now,
}: {
  cancelledAt: Date | null;
  dueDate: string | null;
  expectedCents: number;
  receivedCents: number;
  now: Date;
}): FinanceReimbursementStatus {
  if (cancelledAt) return "cancelled";
  if (receivedCents >= expectedCents) return "received";
  if (dueDate && dueDate < now.toISOString().slice(0, 10)) return "overdue";
  return receivedCents > 0 ? "partially_received" : "expected";
}

type Context = { principal: Principal; requestId: string };

function serialize(
  row: typeof financeReimbursements.$inferSelect,
  matches: Array<typeof financeReimbursementMatches.$inferSelect>,
): FinanceReimbursement {
  return {
    allocationId: row.allocationId,
    cancelledAt: row.cancelledAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    dueDate: row.dueDate,
    evidence: row.evidence as Record<string, unknown>,
    expectedAmount: row.expectedAmount / 100,
    id: row.id,
    matches: matches.map((match) => ({
      amount: match.amount / 100,
      creditTransactionId: match.creditTransactionId,
      createdAt: match.createdAt.toISOString(),
      id: match.id,
      reimbursementId: match.reimbursementId,
    })),
    payer: row.payer,
    receivedAmount: row.receivedAmount / 100,
    revision: row.revision,
    status: row.status,
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
          id: financeTransactions.id,
          amount: financeTransactions.amount,
          date: financeTransactions.transactionDate,
        })
        .from(financeTransactions)
        .where(
          and(eq(financeTransactions.userId, userId), eq(financeTransactions.direction, "income")),
        );
      const matchedByCredit = new Map<string, number>();
      for (const match of matches) {
        matchedByCredit.set(
          match.creditTransactionId,
          (matchedByCredit.get(match.creditTransactionId) ?? 0) + match.amount,
        );
      }
      return {
        reimbursements: rows.map((row) => serialize(row, matchesByReimbursement.get(row.id) ?? [])),
        unmatchedCredits: credits
          .map((credit) => ({
            ...credit,
            unmatchedAmount: credit.amount - (matchedByCredit.get(credit.id) ?? 0),
          }))
          .filter((credit) => credit.unmatchedAmount > 0)
          .map((credit) => ({
            amount: credit.unmatchedAmount / 100,
            date: credit.date,
            transactionId: credit.id,
          })),
      };
    },

    async reconcile(input: ReconcileFinanceReimbursementInput, context: Context) {
      return db.transaction(async (tx) => {
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
            .select({ amount: financeReimbursements.expectedAmount })
            .from(financeReimbursements)
            .where(
              and(
                eq(financeReimbursements.userId, userId),
                eq(financeReimbursements.allocationId, allocation.id),
              ),
            )
            .for("update");
          const expectedAmount = toCents(input.expectedAmount);
          if (
            expectedAmount + existing.reduce((sum, item) => sum + item.amount, 0) >
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
              userId,
            })
            .returning();
          if (!created) throw new AppError("conflict", "The reimbursement could not be created.");
          await tx.insert(auditEvents).values(
            auditValues({
              action: "finance.reimbursement_created",
              after: { expectedAmount, payer: input.payer },
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
          if (row.status === "cancelled") return serialize(row, matches);
          if (row.revision !== input.expectedRevision)
            throw new AppError("conflict", "The reimbursement changed before cancellation.");
          const [cancelled] = await tx
            .update(financeReimbursements)
            .set({
              cancelledAt: now(),
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
              after: { unmatchedAmount: row.expectedAmount - row.receivedAmount },
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
        if (existingMatch && existingMatch.amount === amount) return serialize(row, matches);
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
        if (credit?.direction !== "income")
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
            after: { amount, creditTransactionId: credit.id, status },
            before: { receivedAmount: row.receivedAmount },
            entityId: row.id,
            entityType: "finance_reimbursement",
            ...context,
          }),
        );
        return serialize(updated, [...matches, match]);
      });
    },
  };
}
