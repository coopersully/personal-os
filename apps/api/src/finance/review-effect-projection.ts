import {
  type Database,
  financeTransactionRelationships,
  financeTransactionRevisions,
} from "@personal-os/database";
import type { AgentAccessWorkItem } from "@personal-os/domain";
import { eq, sql } from "drizzle-orm";
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
    const revisions = await tx
      .select({
        id: financeTransactionRevisions.id,
        createdAt: financeTransactionRevisions.createdAt,
      })
      .from(financeTransactionRevisions)
      .where(eq(financeTransactionRevisions.userId, userId));
    const relationships = await tx
      .select({
        id: financeTransactionRelationships.id,
        createdAt: financeTransactionRelationships.createdAt,
      })
      .from(financeTransactionRelationships)
      .where(eq(financeTransactionRelationships.userId, userId));
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
