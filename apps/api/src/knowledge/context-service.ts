import { randomUUID } from "node:crypto";
import { knowledgeContextUses, knowledgeSelectionInteractions } from "@personal-os/database";
import {
  type KnowledgeContextExplanation,
  type KnowledgeContextPack,
  type KnowledgeContextReason,
  type KnowledgeContextReference,
  type KnowledgeExplainInput,
  type KnowledgeQuery,
  type KnowledgeRecentSelection,
  type KnowledgeRecord,
  knowledgeContextMaxBytes,
  knowledgeContextReferenceSchema,
  knowledgeExplainInputSchema,
  knowledgePreferenceSelectionSchema,
  knowledgeQuerySchema,
} from "@personal-os/domain";
import { and, asc, desc, eq, gt, inArray, lte } from "drizzle-orm";
import type { Principal } from "../types.js";
import { findOwnedKnowledgeRevision, revisionIsCurrent } from "./access.js";
import { selectionDayMs, selectionPurposes } from "./learning-evidence.js";
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
  if (record.status !== "active" || record.stale || !revisionIsCurrent(record, at))
    return "tentative";
  return record.origin === "inferred" ? "inferred" : "stated";
}

function recentSelectionWindow(at: Date) {
  const occurredAt = knowledgeSelectionInteractions.occurredAt;
  return and(gt(occurredAt, new Date(at.getTime() - selectionDayMs)), lte(occurredAt, at));
}

function canUseSelections(purpose: KnowledgeQuery["purpose"]) {
  return selectionPurposes.some((allowed) => allowed === purpose);
}

function selectionReference(sourceEventId: string, occurredAt: Date) {
  return {
    sourceEventId,
    validUntil: new Date(occurredAt.getTime() + selectionDayMs).toISOString(),
  };
}

async function recentSelections(
  { at, tx }: KnowledgeRetrievalSession,
  userId: string,
): Promise<KnowledgeRecentSelection[]> {
  const events = knowledgeSelectionInteractions;
  const rows = await tx
    .selectDistinctOn([events.key], {
      key: events.key,
      value: events.value,
      sourceEventId: events.id,
      occurredAt: events.occurredAt,
    })
    .from(events)
    .where(and(eq(events.userId, userId), recentSelectionWindow(at)))
    .orderBy(asc(events.key), desc(events.occurredAt), desc(events.id));
  return rows.flatMap(({ key, value, sourceEventId, occurredAt }) => {
    const selection = knowledgePreferenceSelectionSchema.safeParse({ key, value });
    return occurredAt && selection.success
      ? [
          {
            ...selection.data,
            ...selectionReference(sourceEventId, occurredAt),
          },
        ]
      : [];
  });
}

async function explainSelections(
  { tx, at }: KnowledgeRetrievalSession,
  userId: string,
  purpose: KnowledgeQuery["purpose"],
  ids: string[],
) {
  if (!ids.length || !canUseSelections(purpose)) return [];
  const events = knowledgeSelectionInteractions;
  const rows = await tx
    .select({ id: events.id, occurredAt: events.occurredAt })
    .from(events)
    .where(and(eq(events.userId, userId), inArray(events.id, ids), recentSelectionWindow(at)));
  const byId = new Map(rows.map(({ id, occurredAt }) => [id, occurredAt]));
  return ids.flatMap((id) => {
    const occurredAt = byId.get(id);
    return occurredAt ? [selectionReference(id, occurredAt)] : [];
  });
}

function reference(record: KnowledgeRecord) {
  return { recordId: record.id, revision: record.revision };
}

function contextPage(
  session: KnowledgeRetrievalSession,
  records: KnowledgeRecord[],
  unavailable: boolean,
  selections: KnowledgeRecentSelection[],
  limit: number,
) {
  const ranked = records.map((record) => ({ record, reason: contextReason(record, session.at) }));
  const page = session.cursor(
    retrievalFingerprint([
      unavailable,
      ranked.map(({ record, reason }) => [knowledgeRecordVisibility(record), reason]),
      selections.map(({ sourceEventId }) => sourceEventId),
    ]),
  );
  const pack: KnowledgeContextPack = {
    schemaVersion: 1,
    contextUseId: randomUUID(),
    stated: [],
    inferred: [],
    tentative: [],
    conflicts: [],
    recentSelections: selections,
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
          const selections = canUseSelections(input.purpose)
            ? await recentSelections(session, principal.userId)
            : [];
          const { pack, references } = contextPage(
            session,
            records,
            unavailable,
            selections,
            input.limit ?? 20,
          );
          await session.tx.insert(knowledgeContextUses).values({
            id: pack.contextUseId,
            userId: principal.userId,
            actorId: principal.actorId,
            actorType: principal.actorType,
            purpose: input.purpose,
            workspace: input.workspace ?? null,
            epoch: session.epoch,
            references,
            selectionEventIds: selections.map(({ sourceEventId }) => sourceEventId),
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
        const selectionIds = receipt.selectionEventIds ?? [];
        const selectionReferences = await explainSelections(
          session,
          principal.userId,
          receipt.purpose,
          selectionIds,
        );
        let changed =
          receipt.epoch !== epoch ||
          receipt.selectionEventIds === null ||
          selectionReferences.length !== selectionIds.length;
        let visible = selectionReferences.length > 0;
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
          const projection = await access.projectForRetrieval(
            tx,
            principal,
            revision,
            receipt.purpose,
          );
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
        // Pre-0145 receipts cannot prove which selections were disclosed.
        if (
          !visible &&
          (receipt.references.length || selectionIds.length || receipt.selectionEventIds === null)
        )
          return unavailable;
        return {
          contextUseId,
          state: changed ? "changed" : "available",
          references,
          selectionReferences,
        };
      });
    },
  };
}
