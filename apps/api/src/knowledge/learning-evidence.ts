import {
  knowledgeLearningSuppressions,
  knowledgeSelectionInteractions,
} from "@personal-os/database";
import {
  type KnowledgePreferenceKey,
  type KnowledgePreferenceSelection,
  preferenceKeyForClaim,
} from "@personal-os/domain";
import { and, asc, eq, gte, isNotNull, lte } from "drizzle-orm";
import type { KnowledgeTransaction } from "./access.js";

export const selectionPurposes = ["planning", "review", "communication"] as const;
export const selectionRuleVersion = "presentation-v1";
export const selectionMinimumDates = 3;
export const selectionDayMs = 24 * 60 * 60 * 1_000;
export const selectionReviewMs = 90 * selectionDayMs;

const interactions = knowledgeSelectionInteractions;

export function availableSelectionEvent(tx: KnowledgeTransaction, userId: string, id: string) {
  return tx
    .select({ id: interactions.id })
    .from(interactions)
    .where(
      and(
        eq(interactions.userId, userId),
        eq(interactions.id, id),
        isNotNull(interactions.occurredAt),
      ),
    )
    .then((rows) => rows.length > 0);
}

/** Choose one event per value and local date. Events keep the date assigned on admission. */
export function selectionEvidence(
  tx: KnowledgeTransaction,
  userId: string,
  key: KnowledgePreferenceKey,
  generation: number,
  through: Date,
) {
  return tx
    .selectDistinctOn([interactions.value, interactions.localDate], {
      id: interactions.id,
      value: interactions.value,
    })
    .from(interactions)
    .where(
      and(
        eq(interactions.userId, userId),
        eq(interactions.key, key),
        eq(interactions.generation, generation),
        gte(interactions.occurredAt, new Date(through.getTime() - 30 * selectionDayMs)),
        lte(interactions.occurredAt, through),
      ),
    )
    .orderBy(
      asc(interactions.value),
      asc(interactions.localDate),
      asc(interactions.occurredAt),
      asc(interactions.id),
    );
}

export function selectionRuleSupports(
  evidence: Awaited<ReturnType<typeof selectionEvidence>>,
  value: KnowledgePreferenceSelection["value"],
) {
  return (
    evidence.length >= selectionMinimumDates && evidence.every((event) => event.value === value)
  );
}

export async function selectionSuppression(
  tx: KnowledgeTransaction,
  userId: string,
  key: KnowledgePreferenceKey,
) {
  const [row] = await tx
    .select()
    .from(knowledgeLearningSuppressions)
    .where(
      and(
        eq(knowledgeLearningSuppressions.userId, userId),
        eq(knowledgeLearningSuppressions.key, key),
      ),
    );
  return row ?? { suppressed: false, generation: 0 };
}

/** Call under the owner write lock, as part of the explicit lifecycle change. */
export async function suppressSelectionLearning(
  tx: KnowledgeTransaction,
  userId: string,
  claimKey: string | null,
) {
  const key = preferenceKeyForClaim(claimKey);
  if (!key) return;
  await tx
    .insert(knowledgeLearningSuppressions)
    .values({ userId, key, suppressed: true })
    .onConflictDoUpdate({
      target: [knowledgeLearningSuppressions.userId, knowledgeLearningSuppressions.key],
      set: { suppressed: true },
    });
}
