import {
  accessTokens,
  type Database,
  goals,
  knowledgeDerivations,
  knowledgeForgetOperations,
  knowledgeForgetReplayBindings,
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
  type KnowledgeDerivationKind,
  type KnowledgeQuery,
  type KnowledgeReadInput,
  type KnowledgeRecord,
  type KnowledgeRecordSnapshot,
  type KnowledgeRevisionMetadata,
  type KnowledgeSource,
  knowledgeClaimContent,
  knowledgeClaimKey,
  knowledgeClaimValue,
  knowledgeContentSchema,
  knowledgeErasurePendingReason,
  knowledgeRecordSnapshotSchema,
  knowledgeRevisionMetadataSchema,
} from "@personal-os/domain";
import { and, desc, eq, gt, inArray, isNull, lt, lte, ne, or, sql } from "drizzle-orm";
import { AppError } from "../errors.js";
import type { Principal } from "../types.js";

export type KnowledgeTransaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Purpose = KnowledgeReadInput["purpose"];
type Disclosure = Pick<KnowledgeRecordSnapshot, "scope" | "sensitivity" | "purposes">;
export type KnowledgeRevision = {
  snapshot: KnowledgeRecordSnapshot;
  metadata: KnowledgeRevisionMetadata;
  claimKey: string | null;
  hasSidecar: boolean;
};
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

export async function assertKnowledgeContentAvailable(tx: KnowledgeTransaction, userId: string) {
  const [active] = await tx
    .select({ id: knowledgeForgetOperations.id })
    .from(knowledgeForgetOperations)
    .where(
      and(
        eq(knowledgeForgetOperations.userId, userId),
        ne(knowledgeForgetOperations.status, "completed"),
      ),
    )
    .limit(1);
  if (active)
    throw new AppError(
      "service_unavailable",
      "Memory is unavailable while forgetting is in progress.",
      { reason: knowledgeErasurePendingReason },
    );
}

/** Check authority under the owner lock before revealing an erasure fence. */
async function lockKnowledgeContent<T>(
  tx: KnowledgeTransaction,
  userId: string,
  reauthorize: () => Promise<T>,
  mode: "read" | "write" = "write",
) {
  await lockKnowledgeOwner(tx, userId, mode);
  const authority = await reauthorize();
  await assertKnowledgeContentAvailable(tx, userId);
  return authority;
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

export async function assertForgetMutationKeyUnused(
  tx: KnowledgeTransaction,
  userId: string,
  mutationKey: string,
) {
  const [forget] = await tx
    .select({ id: knowledgeForgetOperations.id })
    .from(knowledgeForgetOperations)
    .where(
      and(
        eq(knowledgeForgetOperations.userId, userId),
        eq(knowledgeForgetOperations.mutationKey, mutationKey),
      ),
    );
  const [repeat] = await tx
    .select({ key: knowledgeForgetReplayBindings.mutationKey })
    .from(knowledgeForgetReplayBindings)
    .where(
      and(
        eq(knowledgeForgetReplayBindings.userId, userId),
        eq(knowledgeForgetReplayBindings.mutationKey, mutationKey),
      ),
    );
  if (forget || repeat)
    throw new AppError("conflict", "This mutation key was used for another request.");
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
    (source.sensitivity === "sensitive" && input.sensitivity !== "sensitive") ||
    input.purposes.some((purpose) => !source.purposes.includes(purpose))
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
};

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
  query: Pick<KnowledgeQuery, "purpose" | "workspace" | "kind">,
  authorizedScopes: AccessScope[],
) {
  const snapshot = knowledgeRevisions.snapshot;
  const workspace = sql`(${snapshot}->'scope'->>'workspace')`;
  const kind = sql`(${snapshot}->'content'->>'kind')`;
  const scopes = sql`${JSON.stringify(authorizedScopes)}::jsonb`;
  return currentRevisions(tx).where(
    and(
      eq(knowledgeRecords.userId, principal.userId),
      sql`${snapshot}->'purposes' @> ${JSON.stringify([query.purpose])}::jsonb`,
      query.workspace
        ? or(sql`${workspace} IS NULL`, sql`${workspace} = ${query.workspace}`)
        : undefined,
      query.kind ? sql`${kind} = ${query.kind}` : undefined,
      principal.actorType === "agent"
        ? and(
            sql`${snapshot}->>'sensitivity' = 'standard'`,
            sql`(${snapshot}->'requiredReadScopes') <@ ${scopes}`,
            sql`(${workspace} IS NULL OR ${scopes} ? (${workspace} || ':read'))`,
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

export function projectKnowledgeRevision(row: {
  snapshot: KnowledgeRecordSnapshot;
  metadata: KnowledgeRevisionMetadata | null;
  claimKey: string | null;
}): KnowledgeRevision {
  const snapshot = knowledgeRecordSnapshotSchema.parse(row.snapshot);
  const metadata = row.metadata
    ? knowledgeRevisionMetadataSchema.parse(row.metadata)
    : legacyMetadata(snapshot);
  return {
    snapshot,
    metadata,
    hasSidecar: row.metadata !== null,
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
) {
  const query = currentRevisions(tx).where(
    and(eq(knowledgeRecords.userId, userId), eq(knowledgeRecords.id, id)),
  );
  const [row] = await (lock ? query.for("update", { of: knowledgeRecords }) : query);
  return row ? projectKnowledgeRevision(row) : null;
}

export async function ownedKnowledgeRevision(
  tx: KnowledgeTransaction,
  principal: Principal,
  id: string,
  lock = false,
) {
  const record = await findOwnedKnowledgeRevision(tx, principal.userId, id, lock);
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
    const old = {
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
  stale: boolean;
};
type ReferenceState = { revision: KnowledgeRevision; projection: DisclosureProjection };

function supportsClaim(
  reference: ReferenceState | undefined,
  expectedRevision: number | undefined,
  at: Date | undefined,
) {
  return (
    reference?.projection.evidenceAvailable === true &&
    !reference.projection.stale &&
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
    purpose: Purpose,
    options: {
      pendingReceipt?: boolean;
      retrieval?: boolean;
      includeOrdinaryLinks?: boolean;
      ancestors?: ReadonlySet<string>;
      checked?: Map<string, DisclosureProjection>;
    } = {},
  ): Promise<DisclosureProjection> {
    const { snapshot, metadata } = revision;
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
    if (!snapshot.purposes.includes(purpose))
      throw new AppError("forbidden", "This record is unavailable for that purpose.");
    if (
      principal.actorType === "agent" &&
      snapshot.sensitivity === "sensitive" &&
      !options.pendingReceipt
    )
      throw new AppError("forbidden", "Sensitive knowledge is available to the owner.");

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
    for (const id of references) {
      const source = await findOwnedKnowledgeRevision(tx, principal.userId, id);
      if (!source) continue;
      try {
        preserveKnowledgeDisclosure({ ...snapshot, purposes: [purpose] }, source.snapshot);
        if (
          content.kind === "entity_meaning" &&
          content.value.recordId.toLowerCase() === id &&
          !source.snapshot.purposes.includes(content.value.purpose)
        )
          throw new AppError("forbidden", "The entity source is unavailable for that purpose.");
        const projection = await disclose(tx, principal, source, purpose, {
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
        (id) => referenceStates.get(id.toLowerCase())?.projection.structuralAvailable === true,
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
      stale: false,
    };
    checked.set(snapshot.id, result);
    return result;
  }

  async function present(
    tx: KnowledgeTransaction,
    principal: Principal,
    revision: KnowledgeRevision,
    purpose: Purpose,
  ): Promise<KnowledgeRecord> {
    return presentProjection(
      tx,
      principal,
      revision,
      purpose,
      await disclose(tx, principal, revision, purpose),
    );
  }

  async function presentProjection(
    tx: KnowledgeTransaction,
    principal: Principal,
    revision: KnowledgeRevision,
    purpose: Purpose,
    { sources, relatedRecordIds, evidenceAvailable, stale }: DisclosureProjection,
    retrieval = false,
  ): Promise<KnowledgeRecord> {
    const { snapshot, metadata, claimKey } = revision;
    const conflictRecordIds: string[] = [];
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
        if (await isDisclosable(tx, principal, other, purpose, retrieval))
          conflictRecordIds.push(other.snapshot.id);
      }
    }
    const replacement = metadata.supersededBy
      ? await findOwnedKnowledgeRevision(tx, principal.userId, metadata.supersededBy)
      : null;
    const supersededBy =
      replacement && (await isDisclosable(tx, principal, replacement, purpose, retrieval))
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
      stale,
      origin: metadata.origin,
      acceptance: metadata.acceptance,
      claimKey,
      supersededBy,
      conflictRecordIds: conflictRecordIds.sort(),
    };
  }

  async function isDisclosable(
    tx: KnowledgeTransaction,
    principal: Principal,
    revision: KnowledgeRevision,
    purpose: Purpose,
    retrieval = false,
  ) {
    try {
      const projection = await disclose(tx, principal, revision, purpose, { retrieval });
      return (
        !retrieval ||
        (projection.evidenceAvailable &&
          !projection.stale &&
          revisionIsCurrent(revision.snapshot, now()))
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
    purpose: Purpose,
  ) {
    try {
      const projection = await disclose(tx, principal, revision, purpose, { retrieval: true });
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
    purpose: Purpose,
  ): Promise<
    { state: "denied" | "unavailable" } | { state: "available"; record: KnowledgeRecord }
  > {
    const disclosure = await retrievalDisclosure(tx, principal, revision, purpose);
    if (disclosure.state !== "available") return disclosure;
    const record = await presentProjection(
      tx,
      principal,
      revision,
      purpose,
      disclosure.projection,
      true,
    );
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
