import {
  type Database,
  financeAccounts,
  financeContextualQuestions,
  financeReviewCases,
  financeTransactions,
} from "@personal-os/database";
import type { AgentAccessWorkItem } from "@personal-os/domain";
import { and, eq, lte } from "drizzle-orm";
import {
  admitContextualOwner,
  contextualSubtype,
  contextualTransaction,
  currentContextualParents,
  lockContextualQuestion,
} from "./contextual-question-store.js";
import { readProjectionRows } from "./search-projection-bounds.js";

/** Each question has its own transaction: never accumulate domain locks across a batch. */
export async function readFinanceContextualWork(
  db: Database,
  { userId, snapshotAt }: { userId: string; snapshotAt: Date },
  searchLimit?: number,
): Promise<AgentAccessWorkItem[]> {
  if (searchLimit !== undefined) {
    // Search is a read-only snapshot: validate the complete joined parent evidence without
    // holding one question's domain locks while inspecting another question.
    const rows = await readProjectionRows(
      db
        .select({
          question: financeContextualQuestions,
          account: financeAccounts,
          transaction: financeTransactions,
          review: financeReviewCases,
        })
        .from(financeContextualQuestions)
        .innerJoin(
          financeAccounts,
          and(
            eq(financeAccounts.id, financeContextualQuestions.accountId),
            eq(financeAccounts.userId, userId),
          ),
        )
        .innerJoin(
          financeTransactions,
          and(
            eq(financeTransactions.id, financeContextualQuestions.transactionId),
            eq(financeTransactions.accountId, financeAccounts.id),
            eq(financeTransactions.userId, userId),
          ),
        )
        .innerJoin(
          financeReviewCases,
          and(
            eq(financeReviewCases.id, financeContextualQuestions.reviewCaseId),
            eq(financeReviewCases.transactionId, financeTransactions.id),
            eq(financeReviewCases.userId, userId),
          ),
        )
        .where(
          and(
            eq(financeContextualQuestions.userId, userId),
            eq(financeContextualQuestions.state, "open"),
            eq(financeContextualQuestions.subtype, contextualSubtype),
            lte(financeContextualQuestions.updatedAt, snapshotAt),
          ),
        ),
      searchLimit,
    );
    return rows.filter(currentContextualParents).map(({ question }) => projectQuestion(question));
  }
  const candidates = await readProjectionRows(
    db
      .select({ id: financeContextualQuestions.id })
      .from(financeContextualQuestions)
      .where(
        and(
          eq(financeContextualQuestions.userId, userId),
          eq(financeContextualQuestions.state, "open"),
          lte(financeContextualQuestions.updatedAt, snapshotAt),
        ),
      ),
    searchLimit,
  );
  const items: AgentAccessWorkItem[] = [];
  for (const candidate of candidates) {
    const item = await contextualTransaction(
      db,
      undefined,
      async (tx): Promise<AgentAccessWorkItem | null> => {
        await admitContextualOwner(tx, userId);
        const locked = await lockContextualQuestion(tx, userId, candidate.id, false);
        if (
          locked?.question.state !== "open" ||
          locked.question.updatedAt > snapshotAt ||
          !currentContextualParents(locked)
        )
          return null;
        const { question } = locked;
        return projectQuestion(question);
      },
    );
    if (item) items.push(item);
  }
  return items;
}

function projectQuestion(
  question: typeof financeContextualQuestions.$inferSelect,
): AgentAccessWorkItem {
  return {
    id: `finance-contextual:${question.id}`,
    domain: "finances",
    kind: "review",
    priority: "person_review",
    title: "Add transaction context",
    summary: question.prompt,
    action: {
      label: "Answer question",
      to: `/finances/review?contextualQuestion=${encodeURIComponent(question.id)}`,
    },
    actionAt: null,
    source: null,
    updatedAt: question.updatedAt.toISOString(),
  };
}
