import {
  type Database,
  financeTransactionRelationships,
  financeTransactionRevisions,
} from "@personal-os/database";
import type { AgentAccessWorkItem } from "@personal-os/domain";
import { and, eq, inArray, sql } from "drizzle-orm";
import { findUnverifiedLegacyFinanceEffects } from "./legacy-maintenance-evidence.js";

/** Project authoritative repair evidence without changing or reinterpreting ledger truth. */
export async function readFinanceEffectWork(
  db: Database,
  { userId, snapshotAt }: { userId: string; snapshotAt: Date },
): Promise<AgentAccessWorkItem[]> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ`);
    const effects = await findUnverifiedLegacyFinanceEffects(tx, userId, {
      type: "all_outstanding",
    });
    if (!effects.length) return [];
    const revisionIds = effects
      .filter((effect) => effect.kind !== "relationship")
      .map((effect) => effect.effectId);
    const relationshipIds = effects
      .filter((effect) => effect.kind === "relationship")
      .map((effect) => effect.effectId);
    const revisions = revisionIds.length
      ? await tx
          .select({
            id: financeTransactionRevisions.id,
            createdAt: financeTransactionRevisions.createdAt,
          })
          .from(financeTransactionRevisions)
          .where(
            and(
              eq(financeTransactionRevisions.userId, userId),
              inArray(financeTransactionRevisions.id, revisionIds),
            ),
          )
      : [];
    const relationships = relationshipIds.length
      ? await tx
          .select({
            id: financeTransactionRelationships.id,
            createdAt: financeTransactionRelationships.createdAt,
          })
          .from(financeTransactionRelationships)
          .where(
            and(
              eq(financeTransactionRelationships.userId, userId),
              inArray(financeTransactionRelationships.id, relationshipIds),
            ),
          )
      : [];
    const observed = new Map(
      [...revisions, ...relationships].map((row) => [row.id, row.createdAt]),
    );
    const work = new Map<string, AgentAccessWorkItem>();
    // Deterministic representative when multiple effects require the identical manual repair.
    for (const effect of effects.toSorted((a, b) => a.effectId.localeCompare(b.effectId))) {
      const createdAt = observed.get(effect.effectId);
      if (!createdAt || createdAt > snapshotAt) continue;
      const key = JSON.stringify([
        effect.repair.operation,
        effect.repair.href,
        [...effect.transactionIds].sort(),
      ]);
      if (work.has(key)) continue;
      work.set(key, {
        action: { label: effect.repair.label, to: effect.repair.href },
        actionAt: null,
        domain: "finances",
        id: `finance-effect:${effect.kind}:${effect.effectId}`,
        kind: "review",
        priority: "blocked",
        source: null,
        summary:
          "A historical financial change has not been verified. A note or unrelated correction does not verify this effect.",
        title: "Verify a historical Finance change",
        updatedAt: createdAt.toISOString(),
      });
    }
    return [...work.values()];
  });
}
