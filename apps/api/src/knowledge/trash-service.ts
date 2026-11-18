import {
  type Database,
  knowledgeRecords,
  knowledgeRevisionMetadata,
  knowledgeRevisions,
  knowledgeTombstones,
} from "@personal-os/database";
import {
  type KnowledgeDeleteNowInput,
  type KnowledgeMutationResult,
  type KnowledgeTrashAction,
  type KnowledgeTrashInput,
  knowledgeDeleteNowInputSchema,
  knowledgeTrashInputSchema,
  knowledgeTrashRetentionMs,
} from "@personal-os/domain";
import { and, eq, inArray, sql } from "drizzle-orm";
import { AppError } from "../errors.js";
import type { Principal } from "../types.js";
import {
  admitHumanKnowledgeContent,
  bumpKnowledgeEpoch,
  createKnowledgeAccess,
  detachedKnowledgeRecordState,
  type KnowledgeRevision,
  type KnowledgeTransaction,
  ownedKnowledgeRevision,
  projectKnowledgeRevision,
  requireKnowledgeOwner,
} from "./access.js";
import {
  knowledgeDerivedClosure,
  knowledgeRevisionSources,
  knowledgeSourcesTrashedOutsideGroup,
} from "./derivation-closure.js";
import { purgeTrashedKnowledge } from "./purge-service.js";
import {
  findKnowledgeReceipt,
  knowledgeRequestHash,
  presentKnowledgeReceipt,
  writeKnowledgeReceipt,
} from "./record-service.js";

/**
 * Move the record and, transitively, every untrashed record derived from it into one trash
 * group named by the target. Already trashed records keep their own group. Relationship
 * records that merely name a trashed record as subject or object stay where they are.
 */
async function trashDerivationClosure(
  tx: KnowledgeTransaction,
  userId: string,
  recordId: string,
  at: Date,
) {
  const { rows } = await tx.execute<{ id: string }>(sql`
    ${knowledgeDerivedClosure(userId, [recordId], { untrashedOnly: true })}
    UPDATE knowledge_records r SET
      trashed_at = ${at.toISOString()}::timestamptz,
      trash_group_id = ${recordId}::uuid,
      trash_version = r.trash_version + 1,
      status_before_trash = (
        SELECT v.snapshot->>'status' FROM knowledge_revisions v
        WHERE v.user_id = r.user_id AND v.record_id = r.id AND v.revision = r.revision
      )
    FROM closure
    WHERE r.user_id = ${userId} AND r.id = closure.id AND r.trashed_at IS NULL
    RETURNING r.id
  `);
  return rows.map(({ id }) => id);
}

async function trashGroupMembers(tx: KnowledgeTransaction, userId: string, groupId: string) {
  const rows = await tx
    .select({ id: knowledgeRecords.id })
    .from(knowledgeRecords)
    .where(and(eq(knowledgeRecords.userId, userId), eq(knowledgeRecords.trashGroupId, groupId)));
  return rows.map(({ id }) => id);
}

/**
 * A restored record must not outlive a source it was derived from. Sources trashed in another
 * group or already purged block the restore; the caller restores or deletes those first.
 */
async function restoreBlockers(tx: KnowledgeTransaction, userId: string, groupId: string) {
  const rows = await tx
    .select({
      recordId: knowledgeRevisions.recordId,
      snapshot: knowledgeRevisions.snapshot,
      metadata: knowledgeRevisionMetadata.metadata,
      claimKey: knowledgeRevisionMetadata.claimKey,
    })
    .from(knowledgeRevisions)
    .innerJoin(
      knowledgeRecords,
      and(
        eq(knowledgeRecords.userId, knowledgeRevisions.userId),
        eq(knowledgeRecords.id, knowledgeRevisions.recordId),
      ),
    )
    .leftJoin(
      knowledgeRevisionMetadata,
      and(
        eq(knowledgeRevisionMetadata.userId, knowledgeRevisions.userId),
        eq(knowledgeRevisionMetadata.recordId, knowledgeRevisions.recordId),
        eq(knowledgeRevisionMetadata.revision, knowledgeRevisions.revision),
      ),
    )
    .where(and(eq(knowledgeRevisions.userId, userId), eq(knowledgeRecords.trashGroupId, groupId)));
  const members = new Set(rows.map(({ recordId }) => recordId.toLowerCase()));
  const named = new Set<string>();
  for (const row of rows) {
    const revision = projectKnowledgeRevision({ ...row, ...detachedKnowledgeRecordState });
    for (const source of knowledgeRevisionSources(revision))
      if (!members.has(source)) named.add(source);
  }
  const { rows: trashed } = await tx.execute<{ id: string }>(
    knowledgeSourcesTrashedOutsideGroup(userId, groupId),
  );
  const purged = named.size
    ? await tx
        .select({ id: knowledgeTombstones.recordId })
        .from(knowledgeTombstones)
        .where(
          and(
            eq(knowledgeTombstones.userId, userId),
            inArray(knowledgeTombstones.recordId, [...named]),
          ),
        )
    : [];
  return [...new Set([...trashed, ...purged].map(({ id }) => id))].sort();
}

function requireTrashGroupRoot(current: KnowledgeRevision) {
  if (current.trashedAt === null) throw new AppError("conflict", "This memory is not in Trash.");
  if (current.trashGroupId !== current.snapshot.id)
    throw new AppError("conflict", "This memory moved to Trash with another memory.", {
      trashGroupId: current.trashGroupId,
    });
}

/** Person-only Trash actions. Each writes a receipt and invalidates open cursors. */
export function createKnowledgeTrashService({ db, now }: { db: Database; now: () => Date }) {
  const access = createKnowledgeAccess(now);

  function run(
    action: KnowledgeTrashAction,
    principal: Principal,
    input: KnowledgeTrashInput,
    apply: (tx: KnowledgeTransaction, current: KnowledgeRevision, at: Date) => Promise<void>,
  ): Promise<KnowledgeMutationResult> {
    requireKnowledgeOwner(principal);
    const requestHash = knowledgeRequestHash(principal, { ...input, action });
    return db.transaction(async (tx) => {
      const { at } = await admitHumanKnowledgeContent(tx, principal, now);
      const prior = await findKnowledgeReceipt(tx, principal, input.mutationKey, requestHash);
      if (prior) return presentKnowledgeReceipt(tx, access, principal, prior);
      const current = await ownedKnowledgeRevision(tx, principal, input.recordId, true, {
        includeTrashed: true,
      });
      if (current.snapshot.revision !== input.expectedRevision)
        throw new AppError("conflict", "The knowledge revision changed.");
      await apply(tx, current, at);
      const receipt = await writeKnowledgeReceipt(
        tx,
        principal,
        { mutationKey: input.mutationKey, requestHash, action },
        current.snapshot,
      );
      const result = await presentKnowledgeReceipt(tx, access, principal, receipt);
      await bumpKnowledgeEpoch(tx, principal.userId);
      return result;
    });
  }

  return {
    trash(principal: Principal, raw: KnowledgeTrashInput) {
      const input = knowledgeTrashInputSchema.parse(raw);
      return run("trash", principal, input, async (tx, current, at) => {
        if (current.trashedAt !== null)
          throw new AppError("conflict", "This memory is already in Trash.");
        await trashDerivationClosure(tx, principal.userId, current.snapshot.id, at);
      });
    },
    restore(principal: Principal, raw: KnowledgeTrashInput) {
      const input = knowledgeTrashInputSchema.parse(raw);
      return run("restore", principal, input, async (tx, current, at) => {
        requireTrashGroupRoot(current);
        if (at.getTime() - (current.trashedAt?.getTime() ?? 0) > knowledgeTrashRetentionMs)
          throw new AppError("conflict", "This memory is past its Trash retention.");
        const blockedBy = await restoreBlockers(tx, principal.userId, current.snapshot.id);
        if (blockedBy.length)
          throw new AppError(
            "conflict",
            "This memory was derived from memory that is in Trash or deleted.",
            { blockedBy },
          );
        await tx
          .update(knowledgeRecords)
          .set({
            trashedAt: null,
            trashGroupId: null,
            statusBeforeTrash: null,
            trashVersion: sql`${knowledgeRecords.trashVersion} + 1`,
          })
          .where(
            and(
              eq(knowledgeRecords.userId, principal.userId),
              eq(knowledgeRecords.trashGroupId, current.snapshot.id),
            ),
          );
      });
    },
    deleteNow(principal: Principal, raw: KnowledgeDeleteNowInput) {
      const input = knowledgeDeleteNowInputSchema.parse(raw);
      return run("delete_now", principal, input, async (tx, current, at) => {
        // A confirmation prepared before a Trash or restore no longer describes what would be
        // erased, even when the record is back in the state it was in (live, say, with a new
        // derived record); only the exact Trash state the person confirmed is deleted.
        if (current.trashVersion !== input.expectedTrashVersion)
          throw new AppError("conflict", "This memory's Trash state changed.", {
            trashVersion: current.trashVersion,
            trashedAt: current.trashedAt?.toISOString() ?? null,
          });
        const { userId } = principal;
        const groupId = current.snapshot.id;
        if (current.trashedAt === null) await trashDerivationClosure(tx, userId, groupId, at);
        else requireTrashGroupRoot(current);
        await purgeTrashedKnowledge(tx, userId, await trashGroupMembers(tx, userId, groupId), at);
      });
    },
  };
}
