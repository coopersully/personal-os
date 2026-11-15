import {
  accessTokens,
  type Database,
  goals,
  knowledgeDerivations,
  knowledgeOwnerEpochs,
  knowledgeRecords,
  knowledgeRevisionMetadata,
  knowledgeRevisions,
  knowledgeSources,
  sessions,
  textInboundClaims,
  users,
} from "@personal-os/database";
import {
  type AccessScope,
  type KnowledgeAgentAccess,
  type KnowledgeDerivationKind,
  type KnowledgeQuery,
  type KnowledgeRecord,
  type KnowledgeRecordSnapshot,
  type KnowledgeRevisionMetadata,
  type KnowledgeSource,
  knowledgeClaimContent,
  knowledgeClaimKey,
  knowledgeClaimValue,
  knowledgeContentSchema,
  knowledgeRecordSnapshotSchema,
  knowledgeRevisionMetadataSchema,
} from "@personal-os/domain";
import { and, desc, eq, gt, inArray, isNotNull, isNull, lt, lte, ne, or, sql } from "drizzle-orm";
import { AppError } from "../errors.js";
import type { Principal } from "../types.js";

export type KnowledgeTransaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Disclosure = Pick<KnowledgeRecordSnapshot, "scope" | "sensitivity">;
/** Record-level state that is not part of an immutable revision. */
export type KnowledgeRecordState = {
  /** Trash state; a trashed record is never disclosed to an agent. */
  trashedAt: Date | null;
  trashGroupId: string | null;
  ownerHeld: boolean;
  agentAccess: KnowledgeAgentAccess;
  core: boolean;
  lastConfirmedAt: Date | null;
};
export type KnowledgeRevision = KnowledgeRecordState & {
  snapshot: KnowledgeRecordSnapshot;
  metadata: KnowledgeRevisionMetadata;
  claimKey: string | null;
  hasSidecar: boolean;
};
/** Default reads exclude Trash. Only the owner may opt in, by ID or the Trash view. */
export type KnowledgeTrashVisibility = { includeTrashed?: boolean };
export type KnowledgeDerivation = {
  sourceRecordId: string;
  sourceRevision: number;
  kind: KnowledgeDerivationKind;
};

export const emptyKnowledgeMetadata = {
  schemaVersion: 1,
  generatedInference: false,
  disputedBy: null,
  supersededBy: null,
  inheritedRecordIds: [],
  inheritedSourceIds: [],
} as const;

export function requireKnowledgeOwner(principal: Principal) {
  if (principal.actorType !== "user")
    throw new AppError("forbidden", "This change requires the account owner.");
}

/** Caller has already acquired the owner knowledge lock. */
export async function requireLiveKnowledgeHumanSession(
  tx: KnowledgeTransaction,
  principal: Principal,
  at: Date,
) {
  requireKnowledgeOwner(principal);
  if (!principal.sessionId || principal.actorId !== principal.userId)
    throw new AppError("forbidden", "A signed-in human session is required.");
  // Take the account row before the session so account deletion cannot wait
  // on this session while a subsequent knowledge insert waits on the account.
  const [owner] = await tx
    .select({ timeZone: users.planningTimezone })
    .from(users)
    .where(eq(users.id, principal.userId))
    .for("key share");
  if (!owner) throw new AppError("forbidden", "A signed-in human session is required.");
  const [session] = await tx
    .select({ sessionId: sessions.id })
    .from(sessions)
    .where(
      and(
        eq(sessions.id, principal.sessionId),
        eq(sessions.userId, principal.userId),
        gt(sessions.expiresAt, at),
      ),
    )
    .for("share");
  if (!session) throw new AppError("forbidden", "A signed-in human session is required.");
  return { ...session, timeZone: owner.timeZone };
}

export function lockKnowledgeOwner(
  tx: KnowledgeTransaction,
  userId: string,
  mode: "write" | "read" = "write",
) {
  const lockKey = `knowledge:${userId}`;
  return mode === "write"
    ? tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`)
    : tx.execute(sql`SELECT pg_advisory_xact_lock_shared(hashtextextended(${lockKey}, 0))`);
}

async function lockKnowledgeContent<T>(
  tx: KnowledgeTransaction,
  userId: string,
  reauthorize: () => Promise<T>,
  mode: "read" | "write" = "write",
) {
  await lockKnowledgeOwner(tx, userId, mode);
  return reauthorize();
}

export function admitHumanKnowledgeContent(
  tx: KnowledgeTransaction,
  principal: Principal,
  now: () => Date,
  mode: "read" | "write" = "write",
) {
  return lockKnowledgeContent(
    tx,
    principal.userId,
    async () => {
      const at = now();
      const session = await requireLiveKnowledgeHumanSession(tx, principal, at);
      return { ...session, at };
    },
    mode,
  );
}

export async function readKnowledgeEpoch(tx: KnowledgeTransaction, userId: string) {
  const [row] = await tx
    .select()
    .from(knowledgeOwnerEpochs)
    .where(eq(knowledgeOwnerEpochs.userId, userId));
  return row?.epoch ?? 0;
}

export async function bumpKnowledgeEpoch(tx: KnowledgeTransaction, userId: string) {
  const [row] = await tx
    .insert(knowledgeOwnerEpochs)
    .values({ userId, epoch: 1 })
    .onConflictDoUpdate({
      target: knowledgeOwnerEpochs.userId,
      set: { epoch: sql`${knowledgeOwnerEpochs.epoch} + 1` },
    })
    .returning({ epoch: knowledgeOwnerEpochs.epoch });
  if (!row) throw new AppError("internal_error", "The knowledge epoch was not updated.");
  return row.epoch;
}

export function preserveKnowledgeDisclosure(input: Disclosure, source: Disclosure) {
  if (
    (source.scope.workspace && input.scope.workspace !== source.scope.workspace) ||
    (source.sensitivity === "sensitive" && input.sensitivity !== "sensitive")
  ) {
    throw new AppError("forbidden", "A derived record cannot broaden source disclosure.");
  }
}

/** Recognize the old writer's envelope for restriction checks only. */
function hasLegacyGeneratedEnvelope(snapshot: KnowledgeRecordSnapshot) {
  const { author, content, sources } = snapshot;
  if (
    author.actorType !== "agent" ||
    content.kind !== "inference" ||
    sources.some((source) => source.classification === "agent_recorded_statement")
  )
    return false;
  const { subject, proposition, uncertainty, reviewCondition, evidenceIds } = content.value;
  if (
    subject !== "owner" ||
    uncertainty !== "Agent interpretation; not confirmed by the owner." ||
    reviewCondition !== "Explicit owner review required." ||
    evidenceIds.length !== sources.length ||
    evidenceIds.some((id, index) => id !== sources[index]?.id)
  )
    return false;
  try {
    const parsed = knowledgeContentSchema.safeParse(JSON.parse(proposition));
    return (
      parsed.success &&
      parsed.data.kind !== "inference" &&
      JSON.stringify(parsed.data) === proposition
    );
  } catch {
    return false;
  }
}

function legacyMetadata(snapshot: KnowledgeRecordSnapshot): KnowledgeRevisionMetadata {
  const origin =
    snapshot.content.kind === "inference" ||
    (snapshot.author.actorType === "agent" &&
      !snapshot.sources.some((source) => source.classification === "agent_recorded_statement"))
      ? "inferred"
      : "stated";
  const statementIds = snapshot.sources
    .filter(
      (source) =>
        source.classification === "owner_statement" &&
        source.actorType === "user" &&
        source.actorId === snapshot.author.actorId,
    )
    .map((source) => source.id);
  return {
    ...emptyKnowledgeMetadata,
    generatedInference: hasLegacyGeneratedEnvelope(snapshot),
    inheritedRecordIds: [],
    inheritedSourceIds: [],
    origin,
    acceptance:
      snapshot.status === "active" &&
      origin === "stated" &&
      snapshot.author.actorType === "user" &&
      statementIds.length > 0
        ? {
            kind: "owner",
            actorId: snapshot.author.actorId,
            acceptedAt: snapshot.createdAt,
            evidenceIds: statementIds,
          }
        : null,
  };
}

const revisionSelection = {
  snapshot: knowledgeRevisions.snapshot,
  metadata: knowledgeRevisionMetadata.metadata,
  claimKey: knowledgeRevisionMetadata.claimKey,
  trashedAt: knowledgeRecords.trashedAt,
  trashGroupId: knowledgeRecords.trashGroupId,
  ownerHeld: knowledgeRecords.ownerHeld,
  agentAccess: knowledgeRecords.agentAccess,
  core: knowledgeRecords.core,
  lastConfirmedAt: knowledgeRecords.lastConfirmedAt,
};

/**
 * The one agent visibility rule: not in Trash, not blocked by the person, and not restricted to
 * a workspace the caller cannot read. Sensitivity and purpose never hide a record from an agent.
 * SQL readers use `knowledgeVisibleToAgent`.
 */
export function isKnowledgeVisibleToAgent(
  record: Pick<KnowledgeRevision, "trashedAt" | "agentAccess" | "snapshot">,
  scopes: ReadonlySet<AccessScope>,
) {
  const { workspace } = record.snapshot.scope;
  return (
    record.trashedAt === null &&
    record.agentAccess === "allowed" &&
    (workspace === null || scopes.has(`${workspace}:read`))
  );
}
export const knowledgeNotTrashed = isNull(knowledgeRecords.trashedAt);
/** Record state for a revision read on its own, where only its content matters. */
export const detachedKnowledgeRecordState: KnowledgeRecordState = {
  trashedAt: null,
  trashGroupId: null,
  ownerHeld: false,
  agentAccess: "allowed",
  core: false,
  lastConfirmedAt: null,
};
/** SQL twin of `isKnowledgeVisibleToAgent`; requires the current revision to be joined. */
export function knowledgeVisibleToAgent(scopes: readonly AccessScope[]) {
  const workspace = sql`(${knowledgeRevisions.snapshot}->'scope'->>'workspace')`;
  return and(
    knowledgeNotTrashed,
    eq(knowledgeRecords.agentAccess, "allowed"),
    sql`(${workspace} IS NULL OR ${JSON.stringify(scopes)}::jsonb ? (${workspace} || ':read'))`,
  );
}

function currentRevisions(tx: KnowledgeTransaction) {
  return tx
    .select(revisionSelection)
    .from(knowledgeRecords)
    .innerJoin(
      knowledgeRevisions,
      and(
        eq(knowledgeRevisions.userId, knowledgeRecords.userId),
        eq(knowledgeRevisions.recordId, knowledgeRecords.id),
        eq(knowledgeRevisions.revision, knowledgeRecords.revision),
      ),
    )
    .leftJoin(
      knowledgeRevisionMetadata,
      and(
        eq(knowledgeRevisionMetadata.userId, knowledgeRevisions.userId),
        eq(knowledgeRevisionMetadata.recordId, knowledgeRevisions.recordId),
        eq(knowledgeRevisionMetadata.revision, knowledgeRevisions.revision),
      ),
    );
}

/** Owner-scoped rows only; callers still project live disclosure before ranking. */
export function currentKnowledgeForRetrieval(
  tx: KnowledgeTransaction,
  principal: Principal,
  query: Pick<KnowledgeQuery, "workspace" | "kind" | "status">,
  authorizedScopes: AccessScope[],
) {
  const snapshot = knowledgeRevisions.snapshot;
  const workspace = sql`(${snapshot}->'scope'->>'workspace')`;
  const kind = sql`(${snapshot}->'content'->>'kind')`;
  const scopes = sql`${JSON.stringify(authorizedScopes)}::jsonb`;
  if (query.status === "trashed" && principal.actorType !== "user")
    throw new AppError("forbidden", "Trash is available to the account owner.");
  return currentRevisions(tx).where(
    and(
      eq(knowledgeRecords.userId, principal.userId),
      query.status === "trashed" ? isNotNull(knowledgeRecords.trashedAt) : knowledgeNotTrashed,
      query.workspace
        ? or(sql`${workspace} IS NULL`, sql`${workspace} = ${query.workspace}`)
        : undefined,
      query.kind ? sql`${kind} = ${query.kind}` : undefined,
      principal.actorType === "agent"
        ? and(
            knowledgeVisibleToAgent(authorizedScopes),
            sql`(${snapshot}->'requiredReadScopes') <@ ${scopes}`,
            authorizedScopes.includes("goals:read") ? undefined : sql`${kind} <> 'goal'`,
          )
        : undefined,
    ),
  );
}

export function ownedKnowledgeHistoryRecordIds(
  tx: KnowledgeTransaction,
  userId: string,
  start: { id: string; inclusive: boolean } | null,
  limit: number,
) {
  return tx
    .select({ id: knowledgeRecords.id })
    .from(knowledgeRecords)
    .innerJoin(
      knowledgeRevisions,
      and(
        eq(knowledgeRevisions.userId, knowledgeRecords.userId),
        eq(knowledgeRevisions.recordId, knowledgeRecords.id),
        eq(knowledgeRevisions.revision, knowledgeRecords.revision),
      ),
    )
    .where(
      and(
        eq(knowledgeRecords.userId, userId),
        knowledgeNotTrashed,
        start
          ? start.inclusive
            ? lte(knowledgeRecords.id, start.id)
            : lt(knowledgeRecords.id, start.id)
          : undefined,
      ),
    )
    .orderBy(desc(knowledgeRecords.id))
    .limit(limit);
}

export type KnowledgeHistorySeek = { revision: number; inclusive: boolean };

function knowledgeHistoryWhere(
  userId: string,
  recordId: string,
  seek: KnowledgeHistorySeek | null,
) {
  return and(
    eq(knowledgeRevisions.userId, userId),
    eq(knowledgeRevisions.recordId, recordId),
    seek
      ? seek.inclusive
        ? lte(knowledgeRevisions.revision, seek.revision)
        : lt(knowledgeRevisions.revision, seek.revision)
      : undefined,
  );
}

export function ownedKnowledgeHistory(
  tx: KnowledgeTransaction,
  userId: string,
  options: { recordId: string; seek: KnowledgeHistorySeek | null; limit: number },
) {
  return tx
    .select({ ...revisionSelection, revision: knowledgeRevisions.revision })
    .from(knowledgeRevisions)
    .innerJoin(
      knowledgeRecords,
      and(
        eq(knowledgeRecords.userId, knowledgeRevisions.userId),
        eq(knowledgeRecords.id, knowledgeRevisions.recordId),
      ),
    )
    .leftJoin(
      knowledgeRevisionMetadata,
      and(
        eq(knowledgeRevisionMetadata.userId, knowledgeRevisions.userId),
        eq(knowledgeRevisionMetadata.recordId, knowledgeRevisions.recordId),
        eq(knowledgeRevisionMetadata.revision, knowledgeRevisions.revision),
      ),
    )
    .where(knowledgeHistoryWhere(userId, options.recordId, options.seek))
    .orderBy(desc(knowledgeRevisions.revision))
    .limit(options.limit);
}

export async function hasMoreKnowledgeHistory(
  tx: KnowledgeTransaction,
  userId: string,
  recordId: string,
  seek: KnowledgeHistorySeek | null,
) {
  const [remaining] = await tx
    .select({ revision: knowledgeRevisions.revision })
    .from(knowledgeRevisions)
    .where(knowledgeHistoryWhere(userId, recordId, seek))
    .limit(1);
  return remaining !== undefined;
}

export async function knowledgeClaimRevisions(
  tx: KnowledgeTransaction,
  userId: string,
  claimKey: string,
  exceptId?: string,
) {
  const [, kind, subject] = JSON.parse(claimKey) as [string | null, string, string];
  // Older structural keys persisted the submitted UUID casing. Match that
  // field case-insensitively, then compare the full projected key below.
  const storedKey = sql`CASE WHEN ${knowledgeRevisionMetadata.claimKey} IS JSON ARRAY
    THEN ${knowledgeRevisionMetadata.claimKey}::jsonb END`;
  const legacyStructural =
    kind === "relationship" || kind === "goal" || kind === "entity_meaning"
      ? sql`(${storedKey}->>1 = ${kind} AND lower(${storedKey}->>2) = ${subject})`
      : undefined;
  const candidates = await currentRevisions(tx).where(
    and(
      eq(knowledgeRecords.userId, userId),
      knowledgeNotTrashed,
      exceptId ? ne(knowledgeRecords.id, exceptId) : undefined,
      or(
        sql`md5(${knowledgeRevisionMetadata.claimKey}) = md5(${claimKey})`,
        isNull(knowledgeRevisionMetadata.claimKey),
        legacyStructural,
      ),
    ),
  );
  return candidates
    .map(projectKnowledgeRevision)
    .filter((candidate) => candidate.claimKey === claimKey);
}

export function projectKnowledgeRevision(
  row: KnowledgeRecordState & {
    snapshot: KnowledgeRecordSnapshot;
    metadata: KnowledgeRevisionMetadata | null;
    claimKey: string | null;
  },
): KnowledgeRevision {
  const snapshot = knowledgeRecordSnapshotSchema.parse(row.snapshot);
  const metadata = row.metadata
    ? knowledgeRevisionMetadataSchema.parse(row.metadata)
    : legacyMetadata(snapshot);
  return {
    snapshot,
    metadata,
    hasSidecar: row.metadata !== null,
    trashedAt: row.trashedAt,
    trashGroupId: row.trashGroupId,
    ownerHeld: row.ownerHeld,
    agentAccess: row.agentAccess,
    core: row.core,
    lastConfirmedAt: row.lastConfirmedAt,
    claimKey: knowledgeClaimKey(
      snapshot.scope.workspace,
      knowledgeClaimContent(snapshot, metadata.generatedInference),
    ),
  };
}

export async function findOwnedKnowledgeRevision(
  tx: KnowledgeTransaction,
  userId: string,
  id: string,
  lock = false,
  { includeTrashed = false }: KnowledgeTrashVisibility = {},
) {
  const query = currentRevisions(tx).where(
    and(
      eq(knowledgeRecords.userId, userId),
      eq(knowledgeRecords.id, id),
      includeTrashed ? undefined : knowledgeNotTrashed,
    ),
  );
  const [row] = await (lock ? query.for("update", { of: knowledgeRecords }) : query);
  return row ? projectKnowledgeRevision(row) : null;
}

export async function ownedKnowledgeRevision(
  tx: KnowledgeTransaction,
  principal: Principal,
  id: string,
  lock = false,
  visibility: KnowledgeTrashVisibility = {},
) {
  if (visibility.includeTrashed) requireKnowledgeOwner(principal);
  const record = await findOwnedKnowledgeRevision(tx, principal.userId, id, lock, visibility);
  if (!record) throw new AppError("not_found", "The knowledge record was not found.");
  return record;
}

export function knowledgeSourceReferences(revision: KnowledgeRevision) {
  return new Set([...directSourceReferences(revision), ...revision.metadata.inheritedRecordIds]);
}

function directSourceReferences({ snapshot, metadata }: KnowledgeRevision) {
  const content = knowledgeClaimContent(snapshot, metadata.generatedInference);
  const referenced = new Set(copiedRecordIds(content, snapshot.relatedRecordIds));
  for (const source of snapshot.sources) {
    if (source.evidence.type === "domain_record" && source.evidence.domain === "knowledge")
      referenced.add(source.evidence.id);
  }
  if (content.kind === "relationship") {
    referenced.add(content.value.subjectId);
    referenced.add(content.value.objectId);
  }
  return referenced;
}

export function knowledgeReferences(revision: KnowledgeRevision) {
  return new Set([...revision.snapshot.relatedRecordIds, ...knowledgeSourceReferences(revision)]);
}

async function historicalCopyReferences(
  tx: KnowledgeTransaction,
  userId: string,
  revision: KnowledgeRevision,
  alreadyKnown: ReadonlySet<string>,
) {
  const ids = [
    ...new Set(revision.metadata.inheritedRecordIds.map((id) => id.toLowerCase())),
  ].filter((id) => !alreadyKnown.has(id));
  if (!ids.length) return [];
  const { id, revision: revisionNumber } = revision.snapshot;
  const edges = await tx
    .selectDistinct({ id: knowledgeDerivations.sourceRecordId })
    .from(knowledgeDerivations)
    .where(
      and(
        eq(knowledgeDerivations.userId, userId),
        eq(knowledgeDerivations.recordId, id),
        lte(knowledgeDerivations.revision, revisionNumber),
        inArray(knowledgeDerivations.sourceRecordId, ids),
      ),
    );
  const sources = new Set(edges.map((edge) => edge.id));
  const unresolved = ids.filter((id) => !sources.has(id));
  if (!unresolved.length) return [...sources];

  // Old metadata inherited ordinary links too. The writer before derivation
  // edges only created revision 1, which can still prove a structural copy.
  const snapshot = knowledgeRevisions.snapshot;
  const [legacy] = await tx
    .select({ snapshot })
    .from(knowledgeRevisions)
    .where(
      and(
        eq(knowledgeRevisions.userId, userId),
        eq(knowledgeRevisions.recordId, id),
        eq(knowledgeRevisions.revision, 1),
        sql`EXISTS (
      SELECT 1 FROM jsonb_array_elements_text(${JSON.stringify(unresolved)}::jsonb) AS candidate(id)
      WHERE strpos(lower(concat(${snapshot}->'content', ${snapshot}->'sources')), candidate.id) > 0
    )`,
      ),
    );
  if (legacy) {
    const possible = new Set(unresolved);
    const old: KnowledgeRevision = {
      ...detachedKnowledgeRecordState,
      snapshot: legacy.snapshot,
      metadata: legacyMetadata(legacy.snapshot),
      claimKey: null,
      hasSidecar: false,
    };
    for (const reference of directSourceReferences(old)) {
      const key = reference.toLowerCase();
      if (possible.has(key)) sources.add(key);
    }
  }
  return [...sources];
}

export async function knowledgeRevisionDerivations(
  tx: KnowledgeTransaction,
  userId: string,
  revision: KnowledgeRevision,
): Promise<KnowledgeDerivation[]> {
  const { snapshot, hasSidecar } = revision;
  if (hasSidecar) {
    return tx
      .select({
        sourceRecordId: knowledgeDerivations.sourceRecordId,
        sourceRevision: knowledgeDerivations.sourceRevision,
        kind: knowledgeDerivations.kind,
      })
      .from(knowledgeDerivations)
      .where(
        and(
          eq(knowledgeDerivations.userId, userId),
          eq(knowledgeDerivations.recordId, snapshot.id),
          eq(knowledgeDerivations.revision, snapshot.revision),
        ),
      );
  }
  const edges: KnowledgeDerivation[] = [];
  for (const source of snapshot.sources) {
    const evidence = source.evidence;
    if (evidence.type === "domain_record" && evidence.domain === "knowledge") {
      edges.push({
        sourceRecordId: evidence.id,
        sourceRevision: evidence.revision,
        kind: "source_record",
      });
    }
  }
  return edges;
}

function copiedRecordIds(content: KnowledgeRecordSnapshot["content"], relatedRecordIds: string[]) {
  if (content.kind === "entity_meaning") return [content.value.recordId];
  if (content.kind === "decision" || content.kind === "inference")
    return content.value.evidenceIds.filter((id) =>
      relatedRecordIds.some((relatedId) => relatedId.toLowerCase() === id.toLowerCase()),
    );
  return [];
}

/** Older implicit copies have an owned target ID but did not record a source revision. */
export function legacyKnowledgeCopiedRecordIds(snapshot: KnowledgeRecordSnapshot): string[] {
  const content = knowledgeClaimContent(snapshot, hasLegacyGeneratedEnvelope(snapshot));
  return copiedRecordIds(content, snapshot.relatedRecordIds);
}

type DisclosureProjection = {
  sources: KnowledgeSource[];
  relatedRecordIds: string[];
  structuralAvailable: boolean;
  evidenceAvailable: boolean;
  supportStale: boolean;
};
type ReferenceState = { revision: KnowledgeRevision; projection: DisclosureProjection };

function supportsClaim(
  reference: ReferenceState | undefined,
  expectedRevision: number | undefined,
  at: Date | undefined,
) {
  return (
    reference?.projection.evidenceAvailable === true &&
    (!at || revisionIsCurrent(reference.revision.snapshot, at)) &&
    (expectedRevision === undefined || reference.revision.snapshot.revision === expectedRevision) &&
    !["disputed", "expired", "superseded"].includes(reference.revision.snapshot.status)
  );
}

function supportChanged(reference: ReferenceState | undefined, expectedRevision?: number) {
  return (
    reference !== undefined &&
    (reference.projection.supportStale ||
      (expectedRevision !== undefined && reference.revision.snapshot.revision !== expectedRevision))
  );
}

/**
 * The other side of a pending agent proposal: for a proposal, the record it proposes to change;
 * for any other record, the pending proposals that name it. Trashed records are left out.
 */
export async function linkedProposalIds(
  tx: KnowledgeTransaction,
  userId: string,
  { snapshot }: KnowledgeRevision,
) {
  const status = sql`(${knowledgeRevisions.snapshot}->>'status')`;
  if (snapshot.status === "proposed") {
    const rows = await tx
      .selectDistinct({ id: knowledgeDerivations.sourceRecordId })
      .from(knowledgeDerivations)
      .where(
        and(
          eq(knowledgeDerivations.userId, userId),
          eq(knowledgeDerivations.recordId, snapshot.id),
          eq(knowledgeDerivations.revision, snapshot.revision),
          eq(knowledgeDerivations.kind, "revision_proposal"),
        ),
      );
    return rows.map(({ id }) => id);
  }
  if (snapshot.status === "superseded") return [];
  const rows = await currentRevisions(tx)
    .innerJoin(
      knowledgeDerivations,
      and(
        eq(knowledgeDerivations.userId, knowledgeRecords.userId),
        eq(knowledgeDerivations.recordId, knowledgeRecords.id),
        eq(knowledgeDerivations.revision, knowledgeRecords.revision),
      ),
    )
    .where(
      and(
        eq(knowledgeRecords.userId, userId),
        knowledgeNotTrashed,
        eq(knowledgeDerivations.sourceRecordId, snapshot.id),
        eq(knowledgeDerivations.kind, "revision_proposal"),
        sql`${status} = 'proposed'`,
      ),
    );
  return [...new Set(rows.map(({ snapshot: proposal }) => proposal.id))];
}

export function createKnowledgeAccess(now: () => Date) {
  async function authorize(
    tx: KnowledgeTransaction,
    principal: Principal,
    required: AccessScope[],
  ) {
    // Content admission checks human sessions. Source scopes narrow agent grants.
    if (principal.actorType === "user") return { scopes: [], connectionId: null };
    const [token] = await tx
      .select()
      .from(accessTokens)
      .where(and(eq(accessTokens.id, principal.actorId), eq(accessTokens.userId, principal.userId)))
      .for("share");
    if (!token || token.revokedAt || (token.expiresAt && token.expiresAt <= now()))
      throw new AppError("forbidden", "The knowledge credential is no longer active.");
    if (required.some((scope) => !principal.scopes.has(scope) || !token.scopes.includes(scope)))
      throw new AppError(
        "forbidden",
        "This credential lacks the required knowledge or source scope.",
      );
    return {
      scopes: [...new Set(token.scopes.filter((scope) => principal.scopes.has(scope)))].sort(),
      connectionId: token.authorizationConnectionId,
    };
  }

  function admit(
    tx: KnowledgeTransaction,
    principal: Principal,
    required: AccessScope[],
    mode: "read" | "write" = "write",
  ) {
    return lockKnowledgeContent(
      tx,
      principal.userId,
      async () => {
        const at = now();
        if (principal.actorType === "user")
          await requireLiveKnowledgeHumanSession(tx, principal, at);
        const authority = await authorize(tx, principal, required);
        return { at, authority };
      },
      mode,
    );
  }

  async function liveSource(
    tx: KnowledgeTransaction,
    userId: string,
    evidence: KnowledgeSource["evidence"],
  ) {
    if (evidence.type === "signed_inbound_message") {
      const [claim] = await tx
        .select({ id: textInboundClaims.id })
        .from(textInboundClaims)
        .where(
          and(eq(textInboundClaims.userId, userId), eq(textInboundClaims.messageId, evidence.id)),
        )
        .for("share");
      return Boolean(claim);
    }
    if (evidence.type === "domain_record") {
      if (evidence.domain === "goals") return false;
      const source = await findOwnedKnowledgeRevision(tx, userId, evidence.id);
      return source?.snapshot.revision === evidence.revision;
    }
    return true;
  }

  async function goalAvailable(tx: KnowledgeTransaction, userId: string, id: string) {
    const [goal] = await tx
      .select({ id: goals.id })
      .from(goals)
      .where(and(eq(goals.userId, userId), eq(goals.id, id)))
      .for("share");
    return Boolean(goal);
  }

  async function disclose(
    tx: KnowledgeTransaction,
    principal: Principal,
    revision: KnowledgeRevision,
    options: {
      retrieval?: boolean;
      includeOrdinaryLinks?: boolean;
      ancestors?: ReadonlySet<string>;
      checked?: Map<string, DisclosureProjection>;
    } = {},
  ): Promise<DisclosureProjection> {
    const { snapshot, metadata } = revision;
    if (principal.actorType === "agent" && !isKnowledgeVisibleToAgent(revision, principal.scopes))
      throw new AppError("not_found", "The knowledge record was not found.");
    // A trashed record shown in the owner's Trash may still cite records trashed with it.
    const trashVisibility = trashReferenceVisibility(principal, revision);
    if (options.ancestors?.has(snapshot.id))
      throw new AppError("conflict", "Knowledge disclosure dependencies cannot form a cycle.");
    const checked = options.checked ?? new Map();
    const prior = checked.get(snapshot.id);
    if (prior) return prior;
    const ancestors = new Set([...(options.ancestors ?? []), snapshot.id]);
    const scopes: AccessScope[] = ["knowledge:read", ...snapshot.requiredReadScopes];
    const content = knowledgeClaimContent(snapshot, metadata.generatedInference);
    if (content.kind === "goal") scopes.push("goals:read");
    if (snapshot.scope.workspace) scopes.push(`${snapshot.scope.workspace}:read`);
    await authorize(tx, principal, scopes);

    const inherited = metadata.inheritedSourceIds.length
      ? await tx
          .select({ source: knowledgeSources.source })
          .from(knowledgeSources)
          .where(
            and(
              eq(knowledgeSources.userId, principal.userId),
              eq(knowledgeSources.recordId, snapshot.id),
              inArray(knowledgeSources.id, metadata.inheritedSourceIds),
            ),
          )
      : [];
    const sourcesById = new Set(
      [...directSourceReferences(revision)].map((id) => id.toLowerCase()),
    );
    for (const { source } of inherited) {
      if (source.evidence.type === "domain_record" && source.evidence.domain === "knowledge")
        sourcesById.add(source.evidence.id.toLowerCase());
    }
    const edges = await knowledgeRevisionDerivations(tx, principal.userId, revision);
    for (const edge of edges) sourcesById.add(edge.sourceRecordId.toLowerCase());
    for (const id of await historicalCopyReferences(tx, principal.userId, revision, sourcesById))
      sourcesById.add(id);
    const ordinaryLinks = options.includeOrdinaryLinks === false ? [] : snapshot.relatedRecordIds;
    const references = new Set([...sourcesById, ...ordinaryLinks.map((id) => id.toLowerCase())]);

    const structuralIds =
      content.kind === "relationship"
        ? [content.value.subjectId, content.value.objectId]
        : content.kind === "entity_meaning"
          ? [content.value.recordId]
          : [];
    const referenceStates = new Map<string, ReferenceState>();
    // IDs with no record in this view: trashed (outside the owner's Trash view) or purged.
    const forgotten = new Set<string>();
    for (const id of references) {
      const source = await findOwnedKnowledgeRevision(
        tx,
        principal.userId,
        id,
        false,
        trashVisibility,
      );
      if (!source) {
        forgotten.add(id);
        continue;
      }
      try {
        preserveKnowledgeDisclosure(snapshot, source.snapshot);
        const projection = await disclose(tx, principal, source, {
          ancestors,
          checked,
          includeOrdinaryLinks: false,
          ...(options.retrieval ? { retrieval: true } : {}),
        });
        referenceStates.set(id, { revision: source, projection });
      } catch (error) {
        if (sourcesById.has(id) || !isKnowledgeDisclosureError(error)) throw error;
      }
    }

    // Historical sources keep their live disclosure restrictions. Only this
    // revision's supporting sources decide whether the claim remains eligible.
    const activeEdges = edges.filter(
      (edge) => edge.kind !== "revision_proposal" || metadata.acceptance?.kind !== "owner",
    );
    const implicitCopies = copiedRecordIds(content, snapshot.relatedRecordIds).filter(
      (id) => !activeEdges.some((edge) => edge.sourceRecordId === id),
    );
    const sources: KnowledgeSource[] = [];
    const evidenceAt = options.retrieval ? now() : undefined;
    let availableSupport =
      activeEdges.some((edge) =>
        supportsClaim(
          referenceStates.get(edge.sourceRecordId.toLowerCase()),
          edge.sourceRevision,
          evidenceAt,
        ),
      ) ||
      implicitCopies.some((id) =>
        supportsClaim(referenceStates.get(id.toLowerCase()), undefined, evidenceAt),
      );
    let supportStale =
      activeEdges.some((edge) =>
        supportChanged(referenceStates.get(edge.sourceRecordId.toLowerCase()), edge.sourceRevision),
      ) || implicitCopies.some((id) => supportChanged(referenceStates.get(id.toLowerCase())));
    for (const source of snapshot.sources) {
      const evidence = source.evidence;
      let available: boolean;
      if (evidence.type === "domain_record" && evidence.domain === "knowledge") {
        const referenced = referenceStates.get(evidence.id.toLowerCase());
        available = supportsClaim(referenced, evidence.revision, evidenceAt);
        supportStale ||= supportChanged(referenced, evidence.revision);
      } else {
        available = await liveSource(tx, principal.userId, evidence);
      }
      availableSupport ||= available;
      sources.push(available ? source : { ...source, availability: "unavailable" });
    }
    const missingGoal =
      content.kind === "goal" && !(await goalAvailable(tx, principal.userId, content.value.goalId));
    const structuralAvailable =
      !missingGoal &&
      structuralIds.every(
        (id) =>
          referenceStates.get(id.toLowerCase())?.projection.structuralAvailable === true ||
          // A relationship is linked, not derived: a trashed or purged endpoint reads as
          // forgotten by ID and discloses none of its content.
          (content.kind === "relationship" && forgotten.has(id.toLowerCase())),
      );
    if (
      principal.actorType === "agent" &&
      !options.ancestors &&
      !structuralAvailable &&
      !options.retrieval
    )
      throw new AppError("not_found", "The knowledge source is unavailable.");
    const needsSupport = activeEdges.length > 0 || implicitCopies.length > 0 || sources.length > 0;
    const independentlyStated =
      metadata.origin === "stated" &&
      sources.some(
        (source) => source.classification === "owner_statement" && source.actorType === "user",
      );
    const result = {
      sources,
      relatedRecordIds: ordinaryLinks.filter((id) => {
        const source = referenceStates.get(id.toLowerCase())?.projection;
        return (
          source?.structuralAvailable &&
          (sourcesById.has(id.toLowerCase()) || source.evidenceAvailable)
        );
      }),
      structuralAvailable,
      evidenceAvailable:
        structuralAvailable &&
        (independentlyStated || (!supportStale && (!needsSupport || availableSupport))),
      supportStale: !independentlyStated && supportStale,
    };
    checked.set(snapshot.id, result);
    return result;
  }

  async function present(
    tx: KnowledgeTransaction,
    principal: Principal,
    revision: KnowledgeRevision,
  ): Promise<KnowledgeRecord> {
    return presentProjection(tx, principal, revision, await disclose(tx, principal, revision));
  }

  async function presentProjection(
    tx: KnowledgeTransaction,
    principal: Principal,
    revision: KnowledgeRevision,
    { sources, relatedRecordIds, evidenceAvailable }: DisclosureProjection,
    retrieval = false,
  ): Promise<KnowledgeRecord> {
    const { snapshot, metadata, claimKey } = revision;
    const conflictRecordIds = new Set<string>();
    if (claimKey && snapshot.status !== "superseded" && snapshot.status !== "expired") {
      const candidates = await knowledgeClaimRevisions(tx, principal.userId, claimKey, snapshot.id);
      const value = JSON.stringify(
        knowledgeClaimValue(knowledgeClaimContent(snapshot, metadata.generatedInference)),
      );
      for (const other of candidates) {
        if (
          other.snapshot.status === "superseded" ||
          other.snapshot.status === "expired" ||
          !knowledgeValidityOverlaps(snapshot, other.snapshot) ||
          JSON.stringify(
            knowledgeClaimValue(
              knowledgeClaimContent(other.snapshot, other.metadata.generatedInference),
            ),
          ) === value
        )
          continue;
        if (await isDisclosable(tx, principal, other, retrieval))
          conflictRecordIds.add(other.snapshot.id);
      }
    }
    for (const id of await linkedProposalIds(tx, principal.userId, revision)) {
      const linked = await findOwnedKnowledgeRevision(tx, principal.userId, id);
      if (linked && (await isDisclosable(tx, principal, linked, retrieval)))
        conflictRecordIds.add(linked.snapshot.id);
    }
    const replacement = metadata.supersededBy
      ? await findOwnedKnowledgeRevision(
          tx,
          principal.userId,
          metadata.supersededBy,
          false,
          trashReferenceVisibility(principal, revision),
        )
      : null;
    const supersededBy =
      replacement && (await isDisclosable(tx, principal, replacement, retrieval))
        ? replacement.snapshot.id
        : null;
    return {
      ...snapshot,
      status:
        !evidenceAvailable && (snapshot.status === "active" || snapshot.status === "proposed")
          ? "disputed"
          : snapshot.status,
      sources,
      relatedRecordIds,
      evidenceAvailable,
      origin: metadata.origin,
      acceptance: metadata.acceptance,
      claimKey,
      supersededBy,
      conflictRecordIds: [...conflictRecordIds].sort(),
      ownerHeld: revision.ownerHeld,
      agentAccess: revision.agentAccess,
      core: revision.core,
      lastConfirmedAt: revision.lastConfirmedAt?.toISOString() ?? null,
      trashedAt: revision.trashedAt?.toISOString() ?? null,
      trashGroupId: revision.trashGroupId,
    };
  }

  async function isDisclosable(
    tx: KnowledgeTransaction,
    principal: Principal,
    revision: KnowledgeRevision,
    retrieval = false,
  ) {
    try {
      const projection = await disclose(tx, principal, revision, { retrieval });
      return (
        !retrieval || (projection.evidenceAvailable && revisionIsCurrent(revision.snapshot, now()))
      );
    } catch (error) {
      if (isKnowledgeDisclosureError(error)) return false;
      throw error;
    }
  }

  async function retrievalDisclosure(
    tx: KnowledgeTransaction,
    principal: Principal,
    revision: KnowledgeRevision,
  ) {
    try {
      const projection = await disclose(tx, principal, revision, { retrieval: true });
      return projection.evidenceAvailable
        ? { state: "available" as const, projection }
        : { state: "unavailable" as const };
    } catch (error) {
      if (isKnowledgeDisclosureError(error)) return { state: "denied" as const };
      throw error;
    }
  }

  async function projectForRetrieval(
    tx: KnowledgeTransaction,
    principal: Principal,
    revision: KnowledgeRevision,
  ): Promise<
    { state: "denied" | "unavailable" } | { state: "available"; record: KnowledgeRecord }
  > {
    const disclosure = await retrievalDisclosure(tx, principal, revision);
    if (disclosure.state !== "available") return disclosure;
    const record = await presentProjection(tx, principal, revision, disclosure.projection, true);
    if (
      record.validUntil &&
      Date.parse(record.validUntil) <= now().getTime() &&
      (record.status === "active" || record.status === "proposed")
    )
      record.status = "expired";
    return { state: "available", record };
  }

  return {
    admit,
    authorize,
    disclose,
    goalAvailable,
    isDisclosable,
    liveSource,
    present,
    projectForRetrieval,
    retrievalDisclosure,
  };
}

function trashReferenceVisibility(
  principal: Principal,
  revision: KnowledgeRevision,
): KnowledgeTrashVisibility {
  return { includeTrashed: principal.actorType === "user" && revision.trashedAt !== null };
}

function isKnowledgeDisclosureError(error: unknown) {
  return (
    error instanceof AppError &&
    (error.status === 403 || error.status === 404 || error.status === 409)
  );
}

export function knowledgeValidityOverlaps(
  left: Pick<KnowledgeRecordSnapshot, "validFrom" | "validUntil">,
  right: Pick<KnowledgeRecordSnapshot, "validFrom" | "validUntil">,
) {
  const start = (value: string | null) => (value ? Date.parse(value) : Number.NEGATIVE_INFINITY);
  const end = (value: string | null) => (value ? Date.parse(value) : Number.POSITIVE_INFINITY);
  return (
    start(left.validFrom) < end(right.validUntil) && start(right.validFrom) < end(left.validUntil)
  );
}

export function revisionIsCurrent(
  revision: Pick<KnowledgeRecordSnapshot, "validFrom" | "validUntil">,
  at: Date,
) {
  return (
    (!revision.validFrom || Date.parse(revision.validFrom) <= at.getTime()) &&
    (!revision.validUntil || Date.parse(revision.validUntil) > at.getTime())
  );
}
