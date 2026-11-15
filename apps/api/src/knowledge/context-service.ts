import { randomUUID } from "node:crypto";
import { knowledgeContextUses } from "@personal-os/database";
import {
  type KnowledgeContextExplanation,
  type KnowledgeContextPack,
  type KnowledgeContextReason,
  type KnowledgeContextReference,
  type KnowledgeExplainInput,
  type KnowledgeQuery,
  type KnowledgeRecord,
  knowledgeContextMaxBytes,
  knowledgeContextReferenceSchema,
  knowledgeExplainInputSchema,
  knowledgeQuerySchema,
} from "@personal-os/domain";
import { and, eq } from "drizzle-orm";
import type { Principal } from "../types.js";
import { findOwnedKnowledgeRevision, revisionIsCurrent } from "./access.js";
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
    contextUseId: randomUUID(),
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
  const references: KnowledgeContextReference[] = [];
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
    references.push({ ...reference(record), reason });
  }
  if (pack.stated.length || pack.inferred.length)
    pack.missingInputs = pack.missingInputs.filter((input) => input !== "no_current_memory");
  return { pack, references };
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
          const { pack, references } = contextPage(
            session,
            records,
            unavailable,
            input.limit ?? 20,
          );
          await session.tx.insert(knowledgeContextUses).values({
            id: pack.contextUseId,
            userId: principal.userId,
            actorId: principal.actorId,
            actorType: principal.actorType,
            purpose: input.purpose ?? null,
            workspace: input.workspace ?? null,
            epoch: session.epoch,
            references,
            createdAt: session.at,
          });
          return pack;
        },
      );
    },

    async explain(
      principal: Principal,
      raw: KnowledgeExplainInput,
    ): Promise<KnowledgeContextExplanation> {
      const { contextUseId } = knowledgeExplainInputSchema.parse(raw);
      const unavailable = { contextUseId, state: "unavailable" } as const;
      return run(principal, { operation: "explain" }, async (session) => {
        const { tx, access, epoch, authorizedScopes, at } = session;
        const [receipt] = await tx
          .select()
          .from(knowledgeContextUses)
          .where(
            and(
              eq(knowledgeContextUses.id, contextUseId),
              eq(knowledgeContextUses.userId, principal.userId),
              eq(knowledgeContextUses.actorId, principal.actorId),
              eq(knowledgeContextUses.actorType, principal.actorType),
            ),
          );
        if (
          !receipt ||
          (receipt.workspace &&
            principal.actorType === "agent" &&
            !authorizedScopes.includes(`${receipt.workspace}:read`))
        )
          return unavailable;
        let changed = receipt.epoch !== epoch;
        let visible = false;
        const references: (KnowledgeContextReference & { origin: KnowledgeRecord["origin"] })[] =
          [];
        for (const saved of receipt.references) {
          const selected = knowledgeContextReferenceSchema.parse(saved);
          const revision = await findOwnedKnowledgeRevision(
            tx,
            principal.userId,
            selected.recordId,
          );
          if (!revision) {
            changed = true;
            continue;
          }
          const projection = await access.projectForRetrieval(tx, principal, revision);
          if (projection.state !== "available") {
            changed = true;
            continue;
          }
          visible = true;
          if (
            projection.record.revision !== selected.revision ||
            contextReason(projection.record, at) !== selected.reason
          ) {
            changed = true;
            continue;
          }
          references.push({ ...selected, origin: projection.record.origin });
        }
        if (!visible && receipt.references.length) return unavailable;
        return {
          contextUseId,
          state: changed ? "changed" : "available",
          references,
        };
      });
    },
  };
}
