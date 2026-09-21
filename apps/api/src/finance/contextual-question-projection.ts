import { type Database, financeContextualQuestions } from "@personal-os/database";
import type { AgentAccessWorkItem } from "@personal-os/domain";
import { and, eq, lte } from "drizzle-orm";
import {
  admitContextualOwner,
  contextualTransaction,
  currentContextualParents,
  lockContextualQuestion,
} from "./contextual-question-store.js";

/** Each question has its own transaction: never accumulate domain locks across a batch. */
export async function readFinanceContextualWork(
  db: Database,
  { userId, snapshotAt }: { userId: string; snapshotAt: Date },
): Promise<AgentAccessWorkItem[]> {
  const candidates = await db
    .select({ id: financeContextualQuestions.id })
    .from(financeContextualQuestions)
    .where(
      and(
        eq(financeContextualQuestions.userId, userId),
        eq(financeContextualQuestions.state, "open"),
        lte(financeContextualQuestions.updatedAt, snapshotAt),
      ),
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
      },
    );
    if (item) items.push(item);
  }
  return items;
}
