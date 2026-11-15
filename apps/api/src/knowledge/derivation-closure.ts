import { knowledgeClaimContent } from "@personal-os/domain";
import { type SQL, sql } from "drizzle-orm";
import { type KnowledgeRevision, knowledgeSourceReferences } from "./access.js";

/**
 * `WITH RECURSIVE closure(id)`: the roots and, transitively, every record with a revision derived
 * from one of them. A relationship only links its subject and object, so those edges are not
 * followed (spec §5.6). With `untrashedOnly`, the walk stops at records already in Trash.
 */
export function knowledgeDerivedClosure(
  userId: string,
  roots: string[],
  { untrashedOnly }: { untrashedOnly: boolean },
): SQL {
  return sql`
    WITH RECURSIVE closure(id) AS (
      SELECT root::uuid FROM jsonb_array_elements_text(${JSON.stringify(roots)}::jsonb) AS roots(root)
      UNION
      SELECT d.record_id FROM closure
      JOIN knowledge_derivations d ON d.user_id = ${userId} AND d.source_record_id = closure.id
      JOIN knowledge_records r ON r.user_id = d.user_id AND r.id = d.record_id
        ${untrashedOnly ? sql`AND r.trashed_at IS NULL` : sql``}
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
      WHERE NOT (
        d.kind = 'content_evidence'
        AND c.claim->>'kind' = 'relationship'
        AND d.source_record_id IN (
          (c.claim->'value'->>'subjectId')::uuid,
          (c.claim->'value'->>'objectId')::uuid
        )
      )
    )`;
}

/**
 * Record IDs a revision is derived from, as recorded in its own snapshot and provenance
 * metadata (these survive the purge of a source, unlike derivation edges). Relationship
 * endpoints the record ever named are excluded: they are links, not sources.
 */
export function knowledgeDerivedSources(revisions: KnowledgeRevision[]) {
  const sources = new Set<string>();
  const endpoints = new Set<string>();
  for (const revision of revisions) {
    const content = knowledgeClaimContent(revision.snapshot, revision.metadata.generatedInference);
    if (content.kind === "relationship") {
      endpoints.add(content.value.subjectId.toLowerCase());
      endpoints.add(content.value.objectId.toLowerCase());
    }
    for (const id of knowledgeSourceReferences(revision)) sources.add(id.toLowerCase());
  }
  for (const id of endpoints) sources.delete(id);
  return sources;
}
