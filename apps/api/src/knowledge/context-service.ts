import {
  type KnowledgeContextPack,
  type KnowledgeContextReason,
  type KnowledgePurpose,
  type KnowledgeQuery,
  type KnowledgeRecord,
  knowledgeContextMaxBytes,
  knowledgeQuerySchema,
  knowledgeRetrievalMaxRecords,
  knowledgeWorkflowMemoryMaxBytes,
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

type RankedContext = { record: KnowledgeRecord; reason: KnowledgeContextReason }[];
/** Where a pack starts and how it names its continuation; a workflow section has none. */
type ContextPaging = { offset: number; encode(offset: number): string | null };
const unpaged: ContextPaging = { offset: 0, encode: () => null };

function rankContext(session: KnowledgeRetrievalSession, records: KnowledgeRecord[]) {
  return records.map((record) => ({ record, reason: contextReason(record, session.at) }));
}

function contextPage(
  session: KnowledgeRetrievalSession,
  records: KnowledgeRecord[],
  unavailable: boolean,
  limit: number,
) {
  const ranked = rankContext(session, records);
  const page = session.cursor(
    retrievalFingerprint([
      unavailable,
      ranked.map(({ record, reason }) => [knowledgeRecordVisibility(record), reason]),
    ]),
  );
  return packContext(session, {
    ranked,
    unavailable,
    limit,
    page,
    maxBytes: knowledgeContextMaxBytes,
  });
}

/**
 * Fills the pack in ranked order until `limit` records or `maxBytes` of UTF-8 JSON. The first
 * record that does not fit ends the pack whole; nothing is cut mid-record.
 */
function packContext(
  session: KnowledgeRetrievalSession,
  {
    ranked,
    unavailable,
    limit,
    page,
    maxBytes,
  }: {
    ranked: RankedContext;
    unavailable: boolean;
    limit: number;
    page: ContextPaging;
    maxBytes: number;
  },
) {
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
    if (Buffer.byteLength(JSON.stringify(pack), "utf8") > maxBytes) {
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
    /**
     * The memory a maintenance workflow loads when it starts, ranked with `purpose` first,
     * within 16 KiB. A record qualifies when its effective workspaces (its own scope plus every
     * source's) are a subset of `{ workspace }` and it is not effectively sensitive. Null when
     * the caller cannot read memory.
     */
    async workflowSection(
      principal: Principal,
      { workspace, purpose }: { workspace: "finances" | "mail"; purpose: KnowledgePurpose },
    ): Promise<KnowledgeContextPack | null> {
      if (!principal.scopes.has("knowledge:read")) return null;
      const input = knowledgeQuerySchema.parse({
        workspace,
        purpose,
        limit: knowledgeRetrievalMaxRecords,
      });
      // Admission needs only `knowledge:read`; per-record visibility still hides memory scoped
      // to a workspace this caller cannot read.
      return run(
        principal,
        { operation: "context", filter: ["workflow", ...knowledgeQueryFilter(input)] },
        async (session) => {
          const { records, unavailable } = await selectKnowledgeCandidates(
            session,
            principal,
            input,
            { workflow: { workspace } },
          );
          return packContext(session, {
            ranked: rankContext(session, records),
            unavailable,
            limit: knowledgeRetrievalMaxRecords,
            page: unpaged,
            maxBytes: knowledgeWorkflowMemoryMaxBytes,
          });
        },
      );
    },
  };
}
