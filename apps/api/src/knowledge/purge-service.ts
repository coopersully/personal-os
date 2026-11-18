import {
  type Database,
  knowledgeDerivations,
  knowledgeRecords,
  knowledgeRecordTags,
  knowledgeRelationships,
  knowledgeRevisionMetadata,
  knowledgeRevisions,
  knowledgeSources,
  knowledgeTagAliases,
  knowledgeTagMerges,
  knowledgeTags,
  knowledgeTombstones,
  users,
} from "@personal-os/database";
import { knowledgeTrashRetentionMs } from "@personal-os/domain";
import { and, asc, eq, inArray, isNotNull, lt, or, sql } from "drizzle-orm";
import { AppError } from "../errors.js";
import { bumpKnowledgeEpoch, type KnowledgeTransaction, lockKnowledgeOwner } from "./access.js";
import { knowledgeDerivedClosure } from "./derivation-closure.js";
import { knowledgeFailureFields } from "./workflow-memory.js";

const maxPurgeBatch = 100;

/** The scheduler's failure line: the error's name, code and stack frames, never its message. */
export function knowledgePurgeFailureLine(error: unknown) {
  return `[personal-os] Memory Trash purge pass failed: ${JSON.stringify(knowledgeFailureFields(error))}\n`;
}

/**
 * Erase trashed records, and every record derived from them in any trash group, down to a
 * content-free tombstone, so no derived copy outlives its source. Throws, erasing nothing,
 * if that closure reaches a record that is not in Trash. The caller holds the owner's
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
  // Restore refuses while a source is in Trash elsewhere, so every derived record should be in
  // Trash. If one is not, stop before erasing anything rather than delete live memory.
  const live = erased.filter(({ trashedAt }) => trashedAt === null).map(({ id }) => id);
  if (live.length)
    throw new AppError("internal_error", "Purge reached memory that is not in Trash.", {
      recordIds: live.sort(),
    });
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
  // without content.
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
  const tagIds = (
    await tx
      .selectDistinct({ tagId: knowledgeRecordTags.tagId })
      .from(knowledgeRecordTags)
      .where(
        and(eq(knowledgeRecordTags.userId, userId), inArray(knowledgeRecordTags.recordId, ids)),
      )
  ).map(({ tagId }) => tagId);
  // Record-owned links without explicit cleanup above (such as tags) cascade from this row.
  await tx
    .delete(knowledgeRecords)
    .where(and(eq(knowledgeRecords.userId, userId), inArray(knowledgeRecords.id, ids)));
  await deleteUnreferencedKnowledgeTags(tx, userId, tagIds);
  return ids.length;
}

/**
 * A tag only purged memory carried is gone with it, so its name cannot surface again through
 * the trailing-`s` fold. A tag a merge or alias still names stays: undo needs its row and name.
 */
async function deleteUnreferencedKnowledgeTags(
  tx: KnowledgeTransaction,
  userId: string,
  tagIds: string[],
) {
  if (!tagIds.length) return;
  await tx.execute(sql`
    DELETE FROM ${knowledgeTags} AS tag
    WHERE tag.user_id = ${userId}
      AND tag.id IN (${sql.join(
        tagIds.map((id) => sql`${id}::uuid`),
        sql`, `,
      )})
      AND NOT EXISTS (
        SELECT 1 FROM ${knowledgeRecordTags} AS link
        WHERE link.user_id = tag.user_id AND link.tag_id = tag.id
      )
      AND NOT EXISTS (
        SELECT 1 FROM ${knowledgeTagAliases} AS alias
        WHERE alias.user_id = tag.user_id AND (alias.tag_id = tag.id OR alias.alias = tag.name)
      )
      AND NOT EXISTS (
        SELECT 1 FROM ${knowledgeTagMerges} AS merge
        WHERE merge.user_id = tag.user_id
          AND (
            merge.into_tag_id = tag.id
            OR merge.from_name = tag.name
            OR tag.name = ANY (merge.carried_aliases)
          )
      )`);
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
      let failure: unknown;
      for (const { userId, id } of due) {
        if (signal?.aborted) break;
        // One record that cannot be purged safely must not hold back everyone else's.
        purged += await db
          .transaction(async (tx) => {
            await lockKnowledgeOwner(tx, userId);
            // Shutdown may have begun while this waited for the lock; a purge not yet started
            // is left for the next pass, and one already started finishes atomically.
            if (signal?.aborted) return 0;
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
          })
          .catch((error: unknown) => {
            failure ??= error;
            return 0;
          });
      }
      if (failure) throw failure;
      return { purged, selected: due.length };
    },
  };
}
