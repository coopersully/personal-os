import {
  type KnowledgeHistoryInput,
  type KnowledgePage,
  type KnowledgeQuery,
  type KnowledgeRecord,
  knowledgeClaimContent,
  knowledgeHistoryInputSchema,
  knowledgeQuerySchema,
  normalizeKnowledgeTag,
} from "@personal-os/domain";
import { sql } from "drizzle-orm";
import { AppError } from "../errors.js";
import type { Principal } from "../types.js";
import {
  currentKnowledgeForRetrieval,
  findOwnedKnowledgeRevision,
  isKnowledgeVisibleToAgent,
  knowledgeValidityOverlaps,
  ownedKnowledgeRevision,
  projectKnowledgeRevision,
  revisionIsCurrent,
} from "./access.js";
import { pageKnowledgeHistory } from "./history-page.js";
import {
  createKnowledgeRetrievalSession,
  type KnowledgeRetrievalDependencies,
  type KnowledgeRetrievalSession,
  knowledgeQueryFilter,
  pageRecords,
} from "./retrieval-session.js";
import { lookupKnowledgeTags } from "./tag-service.js";

function sourcePriority(record: KnowledgeRecord) {
  let priority = 0;
  for (const source of record.sources) {
    if (source.availability === "unavailable") continue;
    const rank = {
      owner_statement: 5,
      signed_inbound_message: 3,
      domain_record: 3,
      agent_recorded_statement: 2,
      agent_observation: 1,
    }[source.classification];
    priority = Math.max(priority, rank);
  }
  return priority;
}

function entityMatches(
  record: KnowledgeRecord,
  content: KnowledgeRecord["content"],
  refs: Set<string>,
) {
  if (!refs.size) return { exact: 0, related: 0 };
  const entities = new Set([record.id]);
  if (content.kind === "goal") entities.add(content.value.goalId);
  if (content.kind === "entity_meaning") entities.add(content.value.recordId);
  if (content.kind === "relationship") {
    entities.add(content.value.subjectId);
    entities.add(content.value.objectId);
  }
  const exactIds = new Set([...entities].map((id) => id.toLowerCase()));
  const relatedIds = new Set(record.relatedRecordIds.map((id) => id.toLowerCase()));
  for (const { availability, evidence } of record.sources) {
    if (!availability && evidence.type === "domain_record")
      relatedIds.add(evidence.id.toLowerCase());
  }
  const exact = [...exactIds].filter((id) => refs.has(id)).length;
  const related = [...relatedIds].filter((id) => refs.has(id) && !exactIds.has(id)).length;
  return { exact, related };
}

async function validateEntityRefs(
  { tx, access, authorizedScopes }: KnowledgeRetrievalSession,
  principal: Principal,
  refs: Set<string>,
) {
  for (const id of refs) {
    const revision = await findOwnedKnowledgeRevision(tx, principal.userId, id);
    if (revision) {
      const projection = await access.projectForRetrieval(tx, principal, revision);
      if (projection.state === "available") continue;
    } else if (
      (principal.actorType === "user" || authorizedScopes.includes("goals:read")) &&
      (await access.goalAvailable(tx, principal.userId, id))
    ) {
      continue;
    }
    throw new AppError("not_found", "A requested memory entity was not found.");
  }
}

/** At most this many words of a text query are checked as exact tags. */
const textTagCandidates = 20;

type Candidate = {
  record: KnowledgeRecord;
  content: KnowledgeRecord["content"];
  /** Requested tags the record carries. */
  requestedTags: number;
  /** Tags the record carries that the text names exactly; these rank above text-only matches. */
  textTags: number;
  /** 1 when the record was saved for the requested purpose; purpose only ranks. */
  purpose: number;
  exact: number;
  related: number;
  current: number;
  freshness: number;
  source: number;
};

async function fullTextRanks(
  { tx }: KnowledgeRetrievalSession,
  candidates: Candidate[],
  text: string,
) {
  const ranks = new Map<string, number>();
  // PostgreSQL sees only live, authorized content. Batch the transient input
  // rather than keeping an independently recoverable index of personal values.
  for (let i = 0; i < candidates.length; i += 100) {
    const documents = candidates.slice(i, i + 100).map(({ record, content }) => ({
      id: record.id,
      value: content.value,
      tags: record.tags.join(" "),
    }));
    const { rows } = await tx.execute<{ id: string; score: number }>(sql`
      WITH query AS (SELECT websearch_to_tsquery('english', ${text}) AS words),
      documents AS (
        SELECT document->>'id' AS id,
          setweight(to_tsvector('english', document->>'tags'), 'A') ||
          jsonb_to_tsvector('english', document->'value', '["string","numeric","boolean"]'::jsonb) AS terms
        FROM jsonb_array_elements(${JSON.stringify(documents)}::jsonb) AS document
      )
      SELECT id, ts_rank(terms, words) AS score FROM documents CROSS JOIN query
      WHERE terms @@ words
    `);
    for (const { id, score } of rows) ranks.set(id, score);
  }
  return ranks;
}

function matchesReviewView(record: KnowledgeRecord, view: KnowledgeQuery["reviewView"], at: Date) {
  if (!view) return true;
  if (view === "accepted") return record.status === "active" && revisionIsCurrent(record, at);
  return record.status === "proposed" || record.status === "disputed";
}

export async function selectKnowledgeCandidates(
  session: KnowledgeRetrievalSession,
  principal: Principal,
  query: KnowledgeQuery,
  /** Leaves out records that are sensitive themselves or through a source. */
  { excludeSensitive = false }: { excludeSensitive?: boolean } = {},
) {
  const { tx, access, at, authorizedScopes } = session;
  // `trashed` selects the owner's Trash (row selection enforces owner-only); it is a record
  // state, not a revision status.
  const status = query.status === "trashed" ? undefined : query.status;
  const refs = new Set(query.entityRefs);
  await validateEntityRefs(session, principal, refs);
  // Requested tags resolve through aliases and plurals; so do the words of the text, which
  // rank a record above text-only matches when one of them is exactly a tag it carries.
  const requested = query.tags ? await lookupKnowledgeTags(tx, principal.userId, query.tags) : [];
  const textWords = query.text
    ? [
        ...new Set(
          [query.text, ...query.text.split(/\s+/u)].flatMap(
            (word) => normalizeKnowledgeTag(word) ?? [],
          ),
        ),
      ].slice(0, textTagCandidates)
    : [];
  const textTags = new Set(
    textWords.length ? await lookupKnowledgeTags(tx, principal.userId, textWords) : [],
  );
  const carriedTags = (tags: readonly string[]) =>
    requested.filter((tag) => tags.includes(tag)).length;
  const matchesTags = (tags: readonly string[]) =>
    !requested.length ||
    (query.tagMatch === "all" ? carriedTags(tags) === requested.length : carriedTags(tags) > 0);
  const rows = await currentKnowledgeForRetrieval(tx, principal, query, authorizedScopes);
  const candidates: Candidate[] = [];
  let unavailable = false;
  for (const row of rows) {
    const revision = projectKnowledgeRevision(row);
    const { snapshot, metadata } = revision;
    if (
      query.timeWindow &&
      !knowledgeValidityOverlaps(snapshot, {
        validFrom: query.timeWindow.from,
        validUntil: query.timeWindow.to,
      })
    )
      continue;
    const projection = await access.projectForRetrieval(tx, principal, revision);
    if (projection.state !== "available") {
      // We cannot text-match or inspect an unavailable body. Report an
      // incomplete source result only after current authorization passed.
      if (
        projection.state === "unavailable" &&
        !refs.size &&
        matchesTags(revision.tags) &&
        (status
          ? status === snapshot.status || status === "disputed"
          : snapshot.status !== "archived") &&
        (!query.origin || query.origin === metadata.origin) &&
        query.hasConflict !== true
      )
        unavailable = true;
      continue;
    }
    if (excludeSensitive && projection.effectiveSensitivity === "sensitive") continue;
    const { record } = projection;
    const content = knowledgeClaimContent(record, metadata.generatedInference);
    const { exact, related } = entityMatches(record, content, refs);
    if (
      (refs.size && !exact && !related) ||
      !matchesTags(record.tags) ||
      // Archived memory is left out unless the caller asks for it.
      (status ? status !== record.status : record.status === "archived") ||
      (query.origin && query.origin !== record.origin) ||
      !matchesReviewView(record, query.reviewView, at) ||
      (query.hasConflict !== undefined && query.hasConflict !== record.conflictRecordIds.length > 0)
    )
      continue;
    candidates.push({
      record,
      content,
      requestedTags: carriedTags(record.tags),
      textTags: record.tags.filter((tag) => textTags.has(tag)).length,
      purpose: Number(query.purpose !== undefined && record.purposes.includes(query.purpose)),
      exact,
      related,
      current: Number(record.status === "active" && revisionIsCurrent(record, at)),
      freshness: Date.parse(record.acceptance?.acceptedAt ?? record.createdAt),
      source: sourcePriority(record),
    });
  }

  const ranks = query.text ? await fullTextRanks(session, candidates, query.text) : null;
  const matches = ranks
    ? candidates.filter(({ record, textTags }) => textTags > 0 || ranks.has(record.id))
    : candidates;
  matches.sort(
    (a, b) =>
      b.requestedTags + b.textTags - (a.requestedTags + a.textTags) ||
      b.purpose - a.purpose ||
      (ranks?.get(b.record.id) ?? 0) - (ranks?.get(a.record.id) ?? 0) ||
      b.exact - a.exact ||
      b.current - a.current ||
      b.freshness - a.freshness ||
      b.source - a.source ||
      a.record.id.localeCompare(b.record.id),
  );
  return { records: matches.map(({ record }) => record), unavailable };
}

export function createKnowledgeSearchService(dependencies: KnowledgeRetrievalDependencies) {
  const run = createKnowledgeRetrievalSession(dependencies);
  return {
    async search(principal: Principal, raw: KnowledgeQuery): Promise<KnowledgePage> {
      const input = knowledgeQuerySchema.parse(raw);
      return run(
        principal,
        {
          operation: "search",
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
          return pageRecords(session, records, unavailable, input.limit ?? 20);
        },
      );
    },
    async history(principal: Principal, raw: KnowledgeHistoryInput): Promise<KnowledgePage> {
      const input = knowledgeHistoryInputSchema.parse(raw);
      return run(
        principal,
        {
          operation: "history",
          filter: [input.purpose ?? null, input.recordId],
          cursor: input.cursor,
        },
        async (session) => {
          const { tx, access } = session;
          const current = await ownedKnowledgeRevision(tx, principal, input.recordId, false, {
            includeTrashed: principal.actorType === "user",
          });
          // A record hidden from this agent reads as missing, never as merely denied.
          if (
            principal.actorType === "agent" &&
            !isKnowledgeVisibleToAgent(current, principal.scopes)
          )
            throw new AppError("not_found", "The knowledge record was not found.");
          const disclosure = await access.retrievalDisclosure(tx, principal, current);
          // An agent that cannot read the record (e.g. through a narrower source) finds nothing.
          if (disclosure.state === "denied")
            throw principal.actorType === "agent"
              ? new AppError("not_found", "The knowledge record was not found.")
              : new AppError("forbidden", "The memory history is unavailable to this caller.");
          return pageKnowledgeHistory(
            session,
            principal.userId,
            input.recordId,
            () => (row) => access.projectForRetrieval(tx, principal, projectKnowledgeRevision(row)),
          );
        },
      );
    },
  };
}
