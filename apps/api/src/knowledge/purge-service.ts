import {
  type Database,
  knowledgeDerivations,
  knowledgeReceipts,
  knowledgeRecords,
  knowledgeRelationships,
  knowledgeRevisionMetadata,
  knowledgeRevisions,
  knowledgeSources,
  knowledgeTombstones,
  users,
} from "@personal-os/database";
import { knowledgeTrashRetentionMs } from "@personal-os/domain";
import { and, asc, eq, inArray, isNotNull, lt, or, sql } from "drizzle-orm";
import { bumpKnowledgeEpoch, type KnowledgeTransaction, lockKnowledgeOwner } from "./access.js";
import { knowledgeDerivedClosure } from "./derivation-closure.js";

const maxPurgeBatch = 100;

/**
 * Erase trashed records, and every record derived from them in any trash group, down to a
 * content-free tombstone, so no derived copy outlives its source. The caller holds the owner's
 * knowledge write lock. Other records' immutable revisions keep any reference to these IDs;
 * those IDs resolve to the tombstone. Rows already purged are skipped, so a rerun is safe.
 */
export async function purgeTrashedKnowledge(
  tx: KnowledgeTransaction,
  userId: string,
  recordIds: string[],
  at: Date,
  trashedBefore?: Date,
) {
  if (!recordIds.length) return 0;
  const due = await tx
    .select({ id: knowledgeRecords.id, trashedAt: knowledgeRecords.trashedAt })
    .from(knowledgeRecords)
    .where(
      and(
        eq(knowledgeRecords.userId, userId),
        inArray(knowledgeRecords.id, recordIds),
        trashedBefore
          ? lt(knowledgeRecords.trashedAt, trashedBefore)
          : isNotNull(knowledgeRecords.trashedAt),
      ),
    )
    .for("update");
  if (!due.length) return 0;
  // Derived records are found before any derivation edge is deleted.
  const { rows: derived } = await tx.execute<{ id: string }>(sql`
    ${knowledgeDerivedClosure(
      userId,
      due.map(({ id }) => id),
      { untrashedOnly: false },
    )}
    SELECT id FROM closure`);
  const erased = await tx
    .select({ id: knowledgeRecords.id, trashedAt: knowledgeRecords.trashedAt })
    .from(knowledgeRecords)
    .where(
      and(
        eq(knowledgeRecords.userId, userId),
        inArray(
          knowledgeRecords.id,
          derived.map(({ id }) => id),
        ),
      ),
    )
    .for("update");
  const ids = erased.map(({ id }) => id);

  await tx
    .insert(knowledgeTombstones)
    .values(
      erased.map(({ id, trashedAt }) => ({
        userId,
        recordId: id,
        trashedAt: trashedAt ?? at,
        purgedAt: at,
      })),
    )
    .onConflictDoNothing();
  // Receipts stay so a retry is still recognized; replay then finds the tombstone and answers
  // without content. The private-proposal flag is the only receipt detail cleared here.
  await tx
    .update(knowledgeReceipts)
    .set({ privateProposal: false })
    .where(and(eq(knowledgeReceipts.userId, userId), inArray(knowledgeReceipts.recordId, ids)));
  await tx
    .delete(knowledgeRelationships)
    .where(
      and(
        eq(knowledgeRelationships.userId, userId),
        or(
          inArray(knowledgeRelationships.recordId, ids),
          inArray(knowledgeRelationships.relatedRecordId, ids),
        ),
      ),
    );
  await tx
    .delete(knowledgeDerivations)
    .where(
      and(
        eq(knowledgeDerivations.userId, userId),
        or(
          inArray(knowledgeDerivations.recordId, ids),
          inArray(knowledgeDerivations.sourceRecordId, ids),
        ),
      ),
    );
  await tx
    .delete(knowledgeRevisionMetadata)
    .where(
      and(
        eq(knowledgeRevisionMetadata.userId, userId),
        inArray(knowledgeRevisionMetadata.recordId, ids),
      ),
    );
  await tx
    .delete(knowledgeRevisions)
    .where(and(eq(knowledgeRevisions.userId, userId), inArray(knowledgeRevisions.recordId, ids)));
  await tx
    .delete(knowledgeSources)
    .where(and(eq(knowledgeSources.userId, userId), inArray(knowledgeSources.recordId, ids)));
  // Record-owned links without explicit cleanup above (such as tags) cascade from this row.
  await tx
    .delete(knowledgeRecords)
    .where(and(eq(knowledgeRecords.userId, userId), inArray(knowledgeRecords.id, ids)));
  return ids.length;
}

/** Purges records whose Trash retention has passed, one owner transaction per record. */
export function createKnowledgePurgeService({ db, now }: { db: Database; now: () => Date }) {
  return {
    async purgeExpired({
      limit,
      signal,
    }: {
      limit: number;
      signal?: AbortSignal;
    }): Promise<{ purged: number; selected: number }> {
      const at = now();
      const trashedBefore = new Date(at.getTime() - knowledgeTrashRetentionMs);
      const due = await db
        .select({ userId: knowledgeRecords.userId, id: knowledgeRecords.id })
        .from(knowledgeRecords)
        .where(lt(knowledgeRecords.trashedAt, trashedBefore))
        .orderBy(asc(knowledgeRecords.trashedAt), asc(knowledgeRecords.id))
        .limit(Math.max(0, Math.min(limit, maxPurgeBatch)));
      let purged = 0;
      for (const { userId, id } of due) {
        if (signal?.aborted) break;
        purged += await db.transaction(async (tx) => {
          await lockKnowledgeOwner(tx, userId);
          // Take the account row before record rows, matching owner sessions, so account
          // deletion waits for this purge instead of deadlocking with it.
          const [owner] = await tx
            .select({ id: users.id })
            .from(users)
            .where(eq(users.id, userId))
            .for("key share");
          if (!owner) return 0;
          const count = await purgeTrashedKnowledge(tx, userId, [id], at, trashedBefore);
          if (count) await bumpKnowledgeEpoch(tx, userId);
          return count;
        });
      }
      return { purged, selected: due.length };
    },
  };
}
