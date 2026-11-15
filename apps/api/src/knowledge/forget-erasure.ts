import {
  auditEvents,
  knowledgeForgetSuppressions,
  knowledgeReceipts,
  knowledgeRecords,
  knowledgeRelationships,
  knowledgeRevisionMetadata,
  knowledgeRevisions,
  knowledgeSources,
  knowledgeForgetOperations as operations,
  knowledgeForgetTargets as targets,
} from "@personal-os/database";
import {
  type KnowledgeForgetPreview,
  type KnowledgeRecordSnapshot,
  type KnowledgeSource,
  knowledgeClaimContent,
  knowledgeRecordSnapshotSchema,
} from "@personal-os/domain";
import { and, asc, eq, gt, inArray, isNull, or, sql } from "drizzle-orm";
import {
  type KnowledgeTransaction,
  legacyKnowledgeCopiedRecordIds,
  projectKnowledgeRevision,
} from "./access.js";
import { knowledgeForgetFingerprint, knowledgeForgetReplayVerifier } from "./forget-suppression.js";

export const knowledgeForgetBatchSize = 100;
export type KnowledgeForgetOperation = typeof operations.$inferSelect;

function revisionPage(tx: KnowledgeTransaction) {
  return tx
    .select({
      id: knowledgeRevisions.id,
      recordId: knowledgeRevisions.recordId,
      revision: knowledgeRevisions.revision,
      snapshot: knowledgeRevisions.snapshot,
      metadata: knowledgeRevisionMetadata.metadata,
      claimKey: knowledgeRevisionMetadata.claimKey,
    })
    .from(knowledgeRevisions)
    .leftJoin(
      knowledgeRevisionMetadata,
      and(
        eq(knowledgeRevisionMetadata.userId, knowledgeRevisions.userId),
        eq(knowledgeRevisionMetadata.recordId, knowledgeRevisions.recordId),
        eq(knowledgeRevisionMetadata.revision, knowledgeRevisions.revision),
      ),
    );
}

/** Older revisions can have copied or structural references without edge rows,
 * even if a subsequent lifecycle mutation added a provenance sidecar. */
async function supplementalEdges(tx: KnowledgeTransaction, userId: string) {
  const edges: { record_id: string; source_id: string }[] = [];
  let cursor: { recordId: string; revision: number } | undefined;
  for (;;) {
    const page = await revisionPage(tx)
      .where(
        and(
          eq(knowledgeRevisions.userId, userId),
          or(
            isNull(knowledgeRevisionMetadata.revision),
            sql`${knowledgeRevisions.snapshot}->'content'->>'kind' IN
              ('relationship', 'entity_meaning', 'inference', 'decision')`,
          ),
          cursor
            ? sql`(${knowledgeRevisions.recordId}, ${knowledgeRevisions.revision}) > (${cursor.recordId}::uuid, ${cursor.revision})`
            : undefined,
        ),
      )
      .orderBy(knowledgeRevisions.recordId, knowledgeRevisions.revision)
      .limit(knowledgeForgetBatchSize);
    for (const row of page) {
      const { snapshot, metadata, hasSidecar } = projectKnowledgeRevision(row);
      const content = knowledgeClaimContent(snapshot, metadata.generatedInference);
      const ids = new Set(legacyKnowledgeCopiedRecordIds(snapshot));
      if (!hasSidecar) {
        for (const { evidence } of snapshot.sources) {
          if (evidence.type === "domain_record" && evidence.domain === "knowledge")
            ids.add(evidence.id);
        }
      }
      if (content.kind === "relationship") {
        ids.add(content.value.subjectId);
        ids.add(content.value.objectId);
      }
      for (const id of ids) edges.push({ record_id: snapshot.id, source_id: id });
    }
    if (page.length < knowledgeForgetBatchSize) return edges;
    cursor = page.at(-1);
  }
}

async function derivationClosure(tx: KnowledgeTransaction, userId: string, recordId: string) {
  const legacy = await supplementalEdges(tx, userId);
  return sql`
    WITH RECURSIVE supplemental AS MATERIALIZED (
      SELECT record_id, source_id
      FROM jsonb_to_recordset(${JSON.stringify(legacy)}::jsonb) AS refs(record_id uuid, source_id uuid)
    ), closure(id) AS (
      SELECT ${recordId}::uuid
      UNION
      SELECT dependent.record_id FROM closure
      CROSS JOIN LATERAL (
        SELECT d.record_id FROM knowledge_derivations d
        WHERE d.user_id = ${userId} AND d.source_record_id = closure.id
        UNION ALL
        SELECT s.record_id FROM supplemental s WHERE s.source_id = closure.id
      ) dependent
    )`;
}

type PreviewCursor = NonNullable<KnowledgeForgetPreview["nextCursor"]>;

export async function readForgetImpact(
  tx: KnowledgeTransaction,
  userId: string,
  recordId: string,
  cursor: PreviewCursor | undefined,
) {
  const closure = await derivationClosure(tx, userId, recordId);
  const [row] = (
    await tx.execute<{
      copies: number;
      revisions: number;
      affected: KnowledgeForgetPreview["affected"];
    }>(sql`${closure}, affected AS MATERIALIZED (
    SELECT r.record_id, r.revision
    FROM closure JOIN knowledge_revisions r ON r.user_id = ${userId} AND r.record_id = closure.id
  ), page AS (
    SELECT record_id, revision FROM affected
    ${cursor ? sql`WHERE (record_id, revision) > (${cursor.recordId}::uuid, ${cursor.revision})` : sql``}
    ORDER BY record_id, revision LIMIT 51
  )
  SELECT
    (SELECT count(*)::int FROM closure) - 1 AS copies,
    (SELECT count(*)::int FROM affected) AS revisions,
    COALESCE((SELECT jsonb_agg(jsonb_build_object('recordId', record_id, 'revision', revision)
      ORDER BY record_id, revision) FROM page), '[]'::jsonb) AS affected
  `)
  ).rows;
  const page = row?.affected ?? [];
  return {
    affected: page.slice(0, 50),
    dependentCopyCount: row?.copies ?? 0,
    historyCount: row?.revisions ?? 0,
    more: page.length > 50,
  };
}

export async function planForgetErasure(tx: KnowledgeTransaction, op: KnowledgeForgetOperation) {
  const closure = await derivationClosure(tx, op.userId, op.recordId);
  await tx.execute(sql`${closure}
    INSERT INTO knowledge_forget_targets (user_id, operation_id, record_id)
    SELECT ${op.userId}::uuid, ${op.id}::uuid, closure.id FROM closure
  `);
  await tx.update(operations).set({ phase: "erase" }).where(eq(operations.id, op.id));
}

export async function eraseForgetBatch(
  tx: KnowledgeTransaction,
  op: KnowledgeForgetOperation,
  suppressionKey: Uint8Array,
) {
  const pending = and(
    eq(targets.userId, op.userId),
    eq(targets.operationId, op.id),
    eq(targets.erased, false),
  );
  const batch = await tx
    .select({ id: targets.recordId })
    .from(targets)
    .where(pending)
    .orderBy(asc(targets.recordId))
    .limit(knowledgeForgetBatchSize);
  const ids = batch.map(({ id }) => id);
  const fingerprints = new Set(op.suppressionFingerprints);
  if (ids.length) {
    const claims = new Set(
      (
        await revisionPage(tx).where(
          and(eq(knowledgeRevisions.userId, op.userId), inArray(knowledgeRevisions.recordId, ids)),
        )
      )
        .map((row) => projectKnowledgeRevision(row).claimKey)
        .filter((key) => key !== null),
    );
    for (const claimKey of claims) {
      const fingerprint = knowledgeForgetFingerprint(suppressionKey, op.userId, claimKey);
      fingerprints.add(fingerprint);
    }
    const newFingerprints = [...fingerprints].filter(
      (fingerprint) => !op.suppressionFingerprints.includes(fingerprint),
    );
    if (newFingerprints.length) {
      await tx
        .insert(knowledgeForgetSuppressions)
        .values(
          newFingerprints.map((fingerprint) => ({
            userId: op.userId,
            fingerprint,
            keyProof: op.keyProof,
          })),
        )
        .onConflictDoNothing();
    }

    // Keep only the receipt/record identity; deleting revisions also cascades
    // provenance sidecars and both directions of explicit derivation edges.
    await tx
      .delete(knowledgeRevisions)
      .where(
        and(eq(knowledgeRevisions.userId, op.userId), inArray(knowledgeRevisions.recordId, ids)),
      );
    await tx
      .delete(knowledgeSources)
      .where(and(eq(knowledgeSources.userId, op.userId), inArray(knowledgeSources.recordId, ids)));
    await tx
      .delete(knowledgeRelationships)
      .where(
        and(
          eq(knowledgeRelationships.userId, op.userId),
          or(
            inArray(knowledgeRelationships.recordId, ids),
            inArray(knowledgeRelationships.relatedRecordId, ids),
          ),
        ),
      );
    const receipts = await tx
      .select({
        id: knowledgeReceipts.id,
        mutationKey: knowledgeReceipts.mutationKey,
        hash: knowledgeReceipts.requestHash,
      })
      .from(knowledgeReceipts)
      .where(
        and(eq(knowledgeReceipts.userId, op.userId), inArray(knowledgeReceipts.recordId, ids)),
      );
    const verifiers = receipts.flatMap(({ id, mutationKey, hash }) =>
      hash === null
        ? []
        : [
            {
              id,
              verifier: knowledgeForgetReplayVerifier(suppressionKey, op.userId, mutationKey, hash),
            },
          ],
    );
    // Preserve only a keyed verifier of the actor-bound digest. Older receipts
    // also need their actor identity from the corresponding audit event.
    await tx.execute(sql`
      UPDATE knowledge_receipts r SET request_hash = NULL, private_proposal = false,
        replay_verifier = v.verifier,
        actor_id = COALESCE(r.actor_id, (
          SELECT CASE WHEN pg_input_is_valid(a.actor_id, 'uuid') THEN a.actor_id::uuid END
          FROM audit_events a
          WHERE a.user_id = r.user_id AND a.entity_type = 'knowledge' AND a.entity_id = r.record_id
            AND lower(a.request_id) = r.mutation_key::text
          ORDER BY a.created_at, a.id LIMIT 1
        ))
      FROM jsonb_to_recordset(${JSON.stringify(verifiers)}::jsonb) AS v(id uuid, verifier text)
      WHERE r.user_id = ${op.userId} AND r.id = v.id
    `);
    await tx
      .update(auditEvents)
      .set({ before: null, after: null })
      .where(
        and(
          eq(auditEvents.userId, op.userId),
          eq(auditEvents.entityType, "knowledge"),
          inArray(auditEvents.entityId, ids),
        ),
      );
    await tx
      .update(targets)
      .set({ erased: true })
      .where(and(pending, inArray(targets.recordId, ids)));
  }
  const [remaining] = await tx
    .select({ id: targets.recordId })
    .from(targets)
    .where(pending)
    .limit(1);
  await tx
    .update(operations)
    .set({
      phase: remaining ? "erase" : "scrub",
      suppressionFingerprints: [...fingerprints].sort(),
    })
    .where(eq(operations.id, op.id));
}

function removedSource(source: KnowledgeSource, forgotten: Set<string>) {
  const { evidence } = source;
  return (
    evidence.type === "domain_record" &&
    evidence.domain === "knowledge" &&
    forgotten.has(evidence.id.toLowerCase())
  );
}

function stripEvidenceIds(
  content: KnowledgeRecordSnapshot["content"],
  removed: (id: string) => boolean,
): KnowledgeRecordSnapshot["content"] {
  if (content.kind === "decision")
    return {
      ...content,
      value: {
        ...content.value,
        evidenceIds: content.value.evidenceIds.filter((id) => !removed(id)),
      },
    };
  if (content.kind === "inference")
    return {
      ...content,
      value: {
        ...content.value,
        evidenceIds: content.value.evidenceIds.filter((id) => !removed(id)),
      },
    };
  return content;
}

export async function scrubForgetBatch(tx: KnowledgeTransaction, op: KnowledgeForgetOperation) {
  const batch = await tx
    .select({ id: knowledgeRecords.id })
    .from(knowledgeRecords)
    .where(
      and(
        eq(knowledgeRecords.userId, op.userId),
        op.scrubCursor ? gt(knowledgeRecords.id, op.scrubCursor) : undefined,
        sql`EXISTS (
      SELECT 1 FROM knowledge_revisions r
      WHERE r.user_id = ${knowledgeRecords.userId} AND r.record_id = ${knowledgeRecords.id}
        AND r.revision = ${knowledgeRecords.revision}
    )`,
      ),
    )
    .orderBy(asc(knowledgeRecords.id))
    .limit(knowledgeForgetBatchSize + 1);
  const ids = batch.slice(0, knowledgeForgetBatchSize).map(({ id }) => id);
  if (ids.length) {
    const forgotten = new Set(
      (
        await tx
          .select({ id: targets.recordId })
          .from(targets)
          .where(and(eq(targets.userId, op.userId), eq(targets.operationId, op.id)))
      ).map(({ id }) => id.toLowerCase()),
    );
    const removedSources = new Set<string>();
    const sourceRows = await tx
      .select({ source: knowledgeSources.source })
      .from(knowledgeSources)
      .where(and(eq(knowledgeSources.userId, op.userId), inArray(knowledgeSources.recordId, ids)));
    for (const { source } of sourceRows) {
      if (removedSource(source, forgotten)) removedSources.add(source.id.toLowerCase());
    }
    const revisions = await revisionPage(tx).where(
      and(eq(knowledgeRevisions.userId, op.userId), inArray(knowledgeRevisions.recordId, ids)),
    );
    for (const { snapshot } of revisions) {
      for (const source of snapshot.sources) {
        if (removedSource(source, forgotten)) removedSources.add(source.id.toLowerCase());
      }
    }
    const removed = (id: string) => {
      const normalized = id.toLowerCase();
      return forgotten.has(normalized) || removedSources.has(normalized);
    };
    for (const row of revisions) {
      const { snapshot, metadata, hasSidecar } = projectKnowledgeRevision(row);
      const sources = snapshot.sources.filter(({ id }) => !removed(id));
      const relatedRecordIds = snapshot.relatedRecordIds.filter(
        (id) => !forgotten.has(id.toLowerCase()),
      );
      let content = stripEvidenceIds(snapshot.content, removed);
      if (content.kind === "inference" && metadata.generatedInference) {
        const declared = knowledgeClaimContent(snapshot, true);
        const sanitized = stripEvidenceIds(declared, removed);
        if (JSON.stringify(declared) !== JSON.stringify(sanitized))
          content = {
            ...content,
            value: { ...content.value, proposition: JSON.stringify(sanitized) },
          };
      }
      if (
        sources.length !== snapshot.sources.length ||
        relatedRecordIds.length !== snapshot.relatedRecordIds.length ||
        JSON.stringify(content) !== JSON.stringify(snapshot.content)
      ) {
        await tx
          .update(knowledgeRevisions)
          .set({
            snapshot: knowledgeRecordSnapshotSchema.parse({
              ...snapshot,
              content,
              sources,
              relatedRecordIds,
            }),
          })
          .where(and(eq(knowledgeRevisions.userId, op.userId), eq(knowledgeRevisions.id, row.id)));
      }
      if (!hasSidecar) continue;
      const inheritedRecordIds = metadata.inheritedRecordIds.filter(
        (id) => !forgotten.has(id.toLowerCase()),
      );
      const inheritedSourceIds = metadata.inheritedSourceIds.filter((id) => !removed(id));
      const supersededBy =
        metadata.supersededBy && !forgotten.has(metadata.supersededBy.toLowerCase())
          ? metadata.supersededBy
          : null;
      const evidenceIds = metadata.acceptance?.evidenceIds.filter((id) => !removed(id));
      const acceptance =
        metadata.acceptance && evidenceIds ? { ...metadata.acceptance, evidenceIds } : null;
      if (
        inheritedRecordIds.length !== metadata.inheritedRecordIds.length ||
        inheritedSourceIds.length !== metadata.inheritedSourceIds.length ||
        supersededBy !== metadata.supersededBy ||
        JSON.stringify(acceptance) !== JSON.stringify(metadata.acceptance)
      ) {
        await tx
          .update(knowledgeRevisionMetadata)
          .set({
            metadata: {
              ...metadata,
              inheritedRecordIds,
              inheritedSourceIds,
              supersededBy,
              acceptance,
            },
          })
          .where(
            and(
              eq(knowledgeRevisionMetadata.userId, op.userId),
              eq(knowledgeRevisionMetadata.recordId, row.recordId),
              eq(knowledgeRevisionMetadata.revision, row.revision),
            ),
          );
      }
    }
    if (removedSources.size) {
      await tx
        .delete(knowledgeSources)
        .where(
          and(
            eq(knowledgeSources.userId, op.userId),
            inArray(knowledgeSources.id, [...removedSources]),
          ),
        );
      const sourceIds = JSON.stringify([...removedSources]);
      await tx.execute(sql`
        UPDATE audit_events
        SET after = jsonb_set(after, '{sourceIds}', COALESCE((
          SELECT jsonb_agg(source.id) FROM jsonb_array_elements_text(after->'sourceIds') source(id)
          WHERE NOT (${sourceIds}::jsonb ? lower(source.id))
        ), '[]'::jsonb))
        WHERE user_id = ${op.userId} AND entity_type = 'knowledge'
          AND jsonb_typeof(after->'sourceIds') = 'array'
          AND entity_id IN (${sql.join(
            ids.map((id) => sql`${id}::uuid`),
            sql`, `,
          )})
          AND EXISTS (
            SELECT 1 FROM jsonb_array_elements_text(after->'sourceIds') source(id)
            WHERE ${sourceIds}::jsonb ? lower(source.id)
          )
      `);
    }
  }
  const more = batch.length > knowledgeForgetBatchSize;
  await tx
    .update(operations)
    .set(more ? { scrubCursor: ids.at(-1) } : { phase: "ledger", scrubCursor: null })
    .where(eq(operations.id, op.id));
}
