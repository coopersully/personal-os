import { type Database, knowledgeRecords } from "@personal-os/database";
import {
  type KnowledgeMutationResult,
  type KnowledgeTrashAction,
  type KnowledgeTrashInput,
  knowledgeTrashInputSchema,
  knowledgeTrashRetentionMs,
} from "@personal-os/domain";
import { and, eq, sql } from "drizzle-orm";
import { AppError } from "../errors.js";
import type { Principal } from "../types.js";
import {
  admitHumanKnowledgeContent,
  bumpKnowledgeEpoch,
  createKnowledgeAccess,
  type KnowledgeRevision,
  type KnowledgeTransaction,
  ownedKnowledgeRevision,
  requireKnowledgeOwner,
} from "./access.js";
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
    WITH RECURSIVE closure(id) AS (
      SELECT ${recordId}::uuid
      UNION
      SELECT d.record_id FROM closure
      JOIN knowledge_derivations d ON d.user_id = ${userId} AND d.source_record_id = closure.id
      JOIN knowledge_records r ON r.user_id = d.user_id AND r.id = d.record_id
        AND r.trashed_at IS NULL
      JOIN knowledge_revisions v ON v.user_id = d.user_id AND v.record_id = d.record_id
        AND v.revision = d.revision
      LEFT JOIN knowledge_revision_metadata m ON m.user_id = v.user_id
        AND m.record_id = v.record_id AND m.revision = v.revision
      CROSS JOIN LATERAL (
        SELECT CASE
          WHEN v.snapshot->'content'->>'kind' = 'inference'
            AND (m.metadata->>'generatedInference')::boolean
          THEN (v.snapshot->'content'->'value'->>'proposition')::jsonb
          ELSE v.snapshot->'content'
        END AS claim
      ) c
      -- A relationship only links its subject and object; it is not derived from them.
      WHERE NOT (
        d.kind = 'content_evidence'
        AND c.claim->>'kind' = 'relationship'
        AND d.source_record_id IN (
          (c.claim->'value'->>'subjectId')::uuid,
          (c.claim->'value'->>'objectId')::uuid
        )
      )
    )
    UPDATE knowledge_records r SET
      trashed_at = ${at.toISOString()}::timestamptz,
      trash_group_id = ${recordId}::uuid,
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
    raw: KnowledgeTrashInput,
    apply: (tx: KnowledgeTransaction, current: KnowledgeRevision, at: Date) => Promise<void>,
  ): Promise<KnowledgeMutationResult> {
    requireKnowledgeOwner(principal);
    const input = knowledgeTrashInputSchema.parse(raw);
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
    trash(principal: Principal, input: KnowledgeTrashInput) {
      return run("trash", principal, input, async (tx, current, at) => {
        if (current.trashedAt !== null)
          throw new AppError("conflict", "This memory is already in Trash.");
        await trashDerivationClosure(tx, principal.userId, current.snapshot.id, at);
      });
    },
    restore(principal: Principal, input: KnowledgeTrashInput) {
      return run("restore", principal, input, async (tx, current, at) => {
        requireTrashGroupRoot(current);
        if (at.getTime() - (current.trashedAt?.getTime() ?? 0) > knowledgeTrashRetentionMs)
          throw new AppError("conflict", "This memory is past its Trash retention.");
        await tx
          .update(knowledgeRecords)
          .set({ trashedAt: null, trashGroupId: null, statusBeforeTrash: null })
          .where(
            and(
              eq(knowledgeRecords.userId, principal.userId),
              eq(knowledgeRecords.trashGroupId, current.snapshot.id),
            ),
          );
      });
    },
    deleteNow(principal: Principal, input: KnowledgeTrashInput) {
      return run("delete_now", principal, input, async (tx, current, at) => {
        const { userId } = principal;
        const groupId = current.snapshot.id;
        if (current.trashedAt === null) await trashDerivationClosure(tx, userId, groupId, at);
        else requireTrashGroupRoot(current);
        await purgeTrashedKnowledge(tx, userId, await trashGroupMembers(tx, userId, groupId), at);
      });
    },
  };
}
