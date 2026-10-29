import {
  type Database,
  financeAccounts,
  type financeAgentActionReviews,
  financeTransactions,
} from "@personal-os/database";
import { applyFinanceCategorizationsInputSchema, financeQuestionSchema } from "@personal-os/domain";
import { and, eq, inArray } from "drizzle-orm";

/** Repair the read projection only. Current references are navigation, never approval evidence. */
export async function projectFinanceActionQuestion(
  db: Pick<Database, "select">,
  row: typeof financeAgentActionReviews.$inferSelect,
) {
  const payload = row.privatePayload as {
    question?: unknown;
    original?: { actionKind?: unknown; input?: unknown };
  };
  const question = financeQuestionSchema.parse({ ...(payload.question as object), id: row.id });
  if (
    question.actionKind !== "categorization" ||
    question.sourceRefs.length > 0 ||
    payload.original?.actionKind !== "categorization"
  )
    return question;
  const input = applyFinanceCategorizationsInputSchema.safeParse(payload.original.input);
  if (!input.success) return question;
  const ids = [...new Set(input.data.decisions.map((decision) => decision.transactionId))];
  const rows = await db
    .select({ transaction: financeTransactions, account: financeAccounts })
    .from(financeTransactions)
    .innerJoin(
      financeAccounts,
      and(
        eq(financeAccounts.id, financeTransactions.accountId),
        eq(financeAccounts.userId, row.userId),
      ),
    )
    .where(and(eq(financeTransactions.userId, row.userId), inArray(financeTransactions.id, ids)))
    .orderBy(financeTransactions.id);
  // A missing or foreign target cannot be reconstructed from an old private payload.
  if (rows.length !== ids.length) return question;
  return {
    ...question,
    prompt:
      "Review the referenced transactions and provide verified categorization evidence using answer_finance_question. An ambiguous transfer needs an explicit financial decision in Finance; do not guess a category or confidence.",
    sourceRefs: rows.map(({ transaction, account }) => ({
      accountId: account.id,
      provider: account.provider === "manual" ? "local" : account.provider,
      remoteId: account.provider === "manual" ? transaction.id : transaction.providerTransactionId,
      revision: transaction.updatedAt.toISOString(),
      sourceType: "finance_transaction" as const,
    })),
  };
}
