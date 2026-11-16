import {
  type KnowledgeContextPack,
  type KnowledgeContextReason,
  type KnowledgeQuery,
  type KnowledgeRecord,
  knowledgeContextMaxBytes,
  knowledgeQuerySchema,
} from "@personal-os/domain";
import type { Principal } from "../types.js";
import { revisionIsCurrent } from "./access.js";
import {
  createKnowledgeRetrievalSession,
  type KnowledgeRetrievalDependencies,
  type KnowledgeRetrievalSession,
  knowledgeQueryFilter,
  knowledgeRecordVisibility,
  retrievalFingerprint,
} from "./retrieval-session.js";
import { selectKnowledgeCandidates } from "./search-service.js";

function contextReason(record: KnowledgeRecord, at: Date): KnowledgeContextReason {
  if (record.status === "disputed" || record.conflictRecordIds.length > 0) return "conflicts";
  if (record.status !== "active" || !revisionIsCurrent(record, at)) return "tentative";
  return record.origin === "inferred" ? "inferred" : "stated";
}

function reference(record: KnowledgeRecord) {
  return { recordId: record.id, revision: record.revision };
}

function contextPage(
  session: KnowledgeRetrievalSession,
  records: KnowledgeRecord[],
  unavailable: boolean,
  limit: number,
) {
  const ranked = records.map((record) => ({ record, reason: contextReason(record, session.at) }));
  const page = session.cursor(
    retrievalFingerprint([
      unavailable,
      ranked.map(({ record, reason }) => [knowledgeRecordVisibility(record), reason]),
    ]),
  );
  const pack: KnowledgeContextPack = {
    schemaVersion: 1,
    stated: [],
    inferred: [],
    tentative: [],
    conflicts: [],
    missingInputs: unavailable
      ? ["source_unavailable", "no_current_memory"]
      : ["no_current_memory"],
    truncated: false,
    nextCursor: null,
    nextFetchRefs: [],
    epoch: session.epoch,
  };
  const end = Math.min(ranked.length, page.offset + limit);
  for (let i = page.offset; i < end; i++) {
    const item = ranked[i];
    if (!item) break;
    const { record, reason } = item;
    pack[reason].push(record);
    const next = ranked[i + 1];
    // Include the real continuation and truncation fields in the byte test.
    pack.truncated = next !== undefined;
    pack.nextCursor = next ? page.encode(i + 1) : null;
    pack.nextFetchRefs = next ? [reference(next.record)] : [];
    if (Buffer.byteLength(JSON.stringify(pack), "utf8") > knowledgeContextMaxBytes) {
      pack[reason].pop();
      pack.truncated = true;
      pack.nextFetchRefs = [reference(record)];
      // A single oversized record can be fetched by ID; advance past it
      // so callers can still reach the remainder of the ranked results.
      pack.nextCursor = i > page.offset ? page.encode(i) : next ? page.encode(i + 1) : null;
      break;
    }
  }
  if (pack.stated.length || pack.inferred.length)
    pack.missingInputs = pack.missingInputs.filter((input) => input !== "no_current_memory");
  return pack;
}

export function createKnowledgeContextService(dependencies: KnowledgeRetrievalDependencies) {
  const run = createKnowledgeRetrievalSession(dependencies);
  return {
    async context(principal: Principal, raw: KnowledgeQuery): Promise<KnowledgeContextPack> {
      const input = knowledgeQuerySchema.parse(raw);
      return run(
        principal,
        {
          operation: "context",
          filter: knowledgeQueryFilter(input),
          cursor: input.cursor,
          workspace: input.workspace,
        },
        async (session) => {
          const { records, unavailable } = await selectKnowledgeCandidates(
            session,
            principal,
            input,
          );
          return contextPage(session, records, unavailable, input.limit ?? 20);
        },
      );
    },
  };
}
