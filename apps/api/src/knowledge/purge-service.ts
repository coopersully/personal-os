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
import { and, asc, eq, inArray, isNotNull, lt, or } from "drizzle-orm";
import { bumpKnowledgeEpoch, type KnowledgeTransaction, lockKnowledgeOwner } from "./access.js";

const maxPurgeBatch = 100;

/**
 * Erase trashed records down to a content-free tombstone. The caller holds the owner's
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
  const ids = due.map(({ id }) => id);
  if (!ids.length) return 0;

  await tx
    .insert(knowledgeTombstones)
    .values(
      due.map(({ id, trashedAt }) => ({
        userId,
        recordId: id,
        trashedAt: trashedAt ?? at,
        purgedAt: at,
      })),
    )
    .onConflictDoNothing();
  // Receipts keep only their key, request hash and record ID, so a retry stays content-free.
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
    }): Promise<{ purged: number }> {
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
      return { purged };
    },
  };
}
