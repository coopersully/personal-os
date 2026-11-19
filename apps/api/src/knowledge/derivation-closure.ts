import { knowledgeClaimContent } from "@personal-os/domain";
import { type SQL, sql } from "drizzle-orm";
import type { KnowledgeRevision } from "./access.js";

/**
 * The one definition of "derived from" for Trash, purge and restore: every stored derivation
 * edge of any revision, except
 * - the `content_evidence` edges from a relationship revision to its own subject or object. A
 *   relationship only links its endpoints (spec §5.6); an endpoint the same revision also cites
 *   as evidence still counts through that evidence edge;
 * - `revision_proposal` edges once the proposal is resolved. Only a pending proposal (current
 *   status `proposed`) depends on the record it proposes to change. An accepted proposal is an
 *   independent record linked by supersession, and a rejected one is superseded.
 *
 * Yields `counted(record_id, revision, source_record_id)` for one owner.
 */
function countedDerivations(userId: string): SQL {
  return sql`counted AS MATERIALIZED (
    SELECT d.record_id, d.revision, d.source_record_id
    FROM knowledge_derivations d
    JOIN knowledge_revisions v ON v.user_id = d.user_id AND v.record_id = d.record_id
      AND v.revision = d.revision
    LEFT JOIN knowledge_revision_metadata m ON m.user_id = v.user_id
      AND m.record_id = v.record_id AND m.revision = v.revision
    JOIN knowledge_records cr ON cr.user_id = d.user_id AND cr.id = d.record_id
    JOIN knowledge_revisions cv ON cv.user_id = cr.user_id AND cv.record_id = cr.id
      AND cv.revision = cr.revision
    CROSS JOIN LATERAL (
      SELECT CASE
        WHEN v.snapshot->'content'->>'kind' = 'inference'
          AND (m.metadata->>'generatedInference')::boolean
        THEN (v.snapshot->'content'->'value'->>'proposition')::jsonb
        ELSE v.snapshot->'content'
      END AS claim
    ) c
    WHERE d.user_id = ${userId} AND NOT (
      d.kind = 'content_evidence'
      AND c.claim->>'kind' = 'relationship'
      AND d.source_record_id IN (
        (c.claim->'value'->>'subjectId')::uuid,
        (c.claim->'value'->>'objectId')::uuid
      )
    ) AND NOT (
      d.kind = 'revision_proposal' AND cv.snapshot->>'status' IS DISTINCT FROM 'proposed'
    )
  )`;
}

/**
 * `WITH RECURSIVE ... closure(id)`: the roots and, transitively, every record derived from one
 * of them. With `untrashedOnly`, the walk stops at records already in Trash.
 */
export function knowledgeDerivedClosure(
  userId: string,
  roots: string[],
  { untrashedOnly }: { untrashedOnly: boolean },
): SQL {
  return sql`
    WITH RECURSIVE ${countedDerivations(userId)}, closure(id) AS (
      SELECT root::uuid FROM jsonb_array_elements_text(${JSON.stringify(roots)}::jsonb) AS roots(root)
      UNION
      SELECT e.record_id FROM closure
      JOIN counted e ON e.source_record_id = closure.id
      JOIN knowledge_records r ON r.user_id = ${userId} AND r.id = e.record_id
        ${untrashedOnly ? sql`AND r.trashed_at IS NULL` : sql``}
    )`;
}

/** Sources of a trash group's members that are in Trash under another group. */
export function knowledgeSourcesTrashedOutsideGroup(userId: string, groupId: string): SQL {
  return sql`
    WITH ${countedDerivations(userId)}
    SELECT DISTINCT e.source_record_id AS id FROM counted e
    JOIN knowledge_records member ON member.user_id = ${userId} AND member.id = e.record_id
      AND member.trash_group_id = ${groupId}::uuid
    JOIN knowledge_records source ON source.user_id = ${userId} AND source.id = e.source_record_id
      AND source.trashed_at IS NOT NULL
      AND source.trash_group_id IS DISTINCT FROM ${groupId}::uuid`;
}

/**
 * The same rule read from an immutable revision, for sources whose edges a purge removed:
 * knowledge evidence, the entity-meaning target and decision/inference evidence records.
 * Relationship endpoints count only when also cited as evidence, as in `countedDerivations`.
 * A revision proposal's original is omitted: purging it purges a pending proposal too, and a
 * resolved proposal no longer depends on it.
 */
export function knowledgeRevisionSources({ snapshot, metadata }: KnowledgeRevision) {
  const sources = new Set<string>();
  for (const { evidence } of snapshot.sources) {
    if (evidence.type === "domain_record" && evidence.domain === "knowledge")
      sources.add(evidence.id.toLowerCase());
  }
  const claim = knowledgeClaimContent(snapshot, metadata.generatedInference);
  if (claim.kind === "entity_meaning") sources.add(claim.value.recordId.toLowerCase());
  if (claim.kind === "decision" || claim.kind === "inference") {
    const related = new Set(snapshot.relatedRecordIds.map((id) => id.toLowerCase()));
    for (const id of claim.value.evidenceIds)
      if (related.has(id.toLowerCase())) sources.add(id.toLowerCase());
  }
  return sources;
}
