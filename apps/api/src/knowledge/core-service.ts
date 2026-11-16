import type { Database } from "@personal-os/database";
import {
  type KnowledgeCore,
  type KnowledgeCoreEntry,
  knowledgeClaimContent,
  knowledgeCoreHint,
  knowledgeCoreMaxBytes,
  knowledgeCoreMaxRecords,
  knowledgeCoreMaxTags,
  knowledgeCoreRecordMaxBytes,
  knowledgeCoreTagBytes,
  knowledgeSummary,
} from "@personal-os/domain";
import type { Principal } from "../types.js";
import {
  createKnowledgeAccess,
  currentKnowledgeForRetrieval,
  type KnowledgeRevision,
  knowledgeProposalTargetIds,
  projectKnowledgeRevision,
  revisionIsCurrent,
} from "./access.js";
import type { createKnowledgeTagService } from "./tag-service.js";

type KnowledgeTags = Pick<ReturnType<typeof createKnowledgeTagService>, "index">;
type CoreCandidate = { revision: KnowledgeRevision; updatedAt: Date };
type TagCount = KnowledgeCore["tagIndex"][number];

const byteLength = (value: unknown) => Buffer.byteLength(JSON.stringify(value), "utf8");

/** Owner-held first, then stated, then inferred; within each, most recently updated first. */
function coreRank({ revision }: CoreCandidate) {
  if (revision.ownerHeld) return 0;
  return revision.metadata.origin === "stated" ? 1 : 2;
}

function coreEntry({ revision, updatedAt }: CoreCandidate): KnowledgeCoreEntry {
  const { snapshot, metadata } = revision;
  const { title, text } = knowledgeSummary(
    knowledgeClaimContent(snapshot, metadata.generatedInference),
  );
  const readable = `${title}: ${text}`;
  if (Buffer.byteLength(readable, "utf8") > knowledgeCoreRecordMaxBytes)
    return { id: snapshot.id, label: title.replace(/\s+/gu, " ").trim() };
  return {
    id: snapshot.id,
    text: readable,
    tags: revision.tags,
    origin: metadata.origin,
    ownerHeld: revision.ownerHeld,
    updatedAt: updatedAt.toISOString(),
  };
}

/**
 * Fills the tag index within its reserved share, then core records within what remains of the
 * whole section. Every budget is UTF-8 bytes of the final JSON. An entry that does not fit is
 * skipped, never cut, and a smaller one after it may still fit.
 */
export function packKnowledgeCore(
  tags: readonly TagCount[],
  entries: readonly KnowledgeCoreEntry[],
  counts: KnowledgeCore["counts"],
): KnowledgeCore {
  const memory: KnowledgeCore = {
    records: [],
    tagIndex: [],
    counts,
    truncated: { records: false, tags: false },
    hint: knowledgeCoreHint,
  };
  let tagsSkipped = false;
  for (const tag of tags) {
    if (memory.tagIndex.length === knowledgeCoreMaxTags) {
      tagsSkipped = true;
      break;
    }
    memory.tagIndex.push(tag);
    if (byteLength(memory.tagIndex) > knowledgeCoreTagBytes) {
      memory.tagIndex.pop();
      tagsSkipped = true;
    }
  }
  // Records are measured with both flags still false; `true` serializes one byte shorter.
  let skipped = false;
  for (const entry of entries) {
    if (memory.records.length === knowledgeCoreMaxRecords) {
      skipped = true;
      break;
    }
    memory.records.push(entry);
    if (byteLength(memory) > knowledgeCoreMaxBytes) {
      memory.records.pop();
      skipped = true;
    }
  }
  memory.truncated = { records: skipped, tags: tagsSkipped };
  return memory;
}

export function createKnowledgeCoreService({
  db,
  now,
  tags,
}: {
  db: Database;
  now: () => Date;
  tags: KnowledgeTags;
}) {
  const admission = createKnowledgeAccess(now);

  /** Core candidates and counts over the memory this caller may read, in one pass. */
  function select(principal: Principal) {
    return db.transaction(async (tx) => {
      const { at, authority } = await admission.admit(tx, principal, ["knowledge:read"], "read");
      const access = createKnowledgeAccess(() => at);
      const rows = await currentKnowledgeForRetrieval(tx, principal, {}, authority.scopes);
      const revisions = rows.map((row) => ({
        revision: projectKnowledgeRevision(row),
        updatedAt: row.updatedAt,
      }));
      // Only a record sharing a claim with another readable record, or on either side of a
      // pending proposal, can list conflicts; only those pay for full presentation.
      const claims = new Map<string, number>();
      for (const { revision } of revisions)
        if (revision.claimKey)
          claims.set(revision.claimKey, (claims.get(revision.claimKey) ?? 0) + 1);
      const proposalTargets = await knowledgeProposalTargetIds(tx, principal.userId);
      const counts = { active: 0, conflicts: 0, archived: 0 };
      const candidates: CoreCandidate[] = [];
      for (const { revision, updatedAt } of revisions) {
        const { snapshot } = revision;
        // The same disclosure as search: hidden or unsupported memory never counts.
        const disclosure = await access.retrievalDisclosure(tx, principal, revision);
        if (disclosure.state !== "available") continue;
        const live = !["superseded", "expired"].includes(snapshot.status);
        const mayConflict =
          snapshot.status === "proposed" ||
          (live && proposalTargets.has(snapshot.id.toLowerCase())) ||
          (live && revision.claimKey !== null && (claims.get(revision.claimKey) ?? 0) > 1);
        let conflicted = false;
        if (mayConflict) {
          const presented = await access.projectForRetrieval(tx, principal, revision);
          conflicted =
            presented.state === "available" && presented.record.conflictRecordIds.length > 0;
        }
        const active = snapshot.status === "active" && revisionIsCurrent(snapshot, at);
        if (active) counts.active += 1;
        if (snapshot.status === "archived") counts.archived += 1;
        else if (conflicted) counts.conflicts += 1;
        // Sources can make a standard record effectively sensitive; that keeps it out too.
        if (active && revision.core && disclosure.projection.effectiveSensitivity === "standard")
          candidates.push({ revision, updatedAt });
      }
      candidates.sort(
        (a, b) =>
          coreRank(a) - coreRank(b) ||
          b.updatedAt.getTime() - a.updatedAt.getTime() ||
          a.revision.snapshot.id.localeCompare(b.revision.snapshot.id),
      );
      return { counts, candidates };
    });
  }

  return {
    async build(principal: Principal): Promise<KnowledgeCore> {
      const [{ counts, candidates }, index] = await Promise.all([
        select(principal),
        // One more than the cap shows whether the index overflowed it.
        tags.index(principal, { limit: knowledgeCoreMaxTags + 1 }),
      ]);
      return packKnowledgeCore(
        index.tags.map(({ name, count }) => ({ name, count })),
        candidates.map(coreEntry),
        counts,
      );
    },
  };
}
