import { createHash, randomUUID } from "node:crypto";
import {
  auditEvents,
  type Database,
  knowledgeDerivations,
  knowledgeReceipts,
  knowledgeRecords,
  knowledgeRelationships,
  knowledgeRevisionMetadata,
  knowledgeRevisions,
  knowledgeSources,
  knowledgeTombstones,
} from "@personal-os/database";
import {
  type AccessScope,
  type KnowledgeForgottenRecord,
  type KnowledgeMutationInput,
  type KnowledgeReadInput,
  type KnowledgeRecord,
  type KnowledgeRecordSnapshot,
  type KnowledgeRevisionMetadata,
  type KnowledgeSaveResult,
  type KnowledgeSource,
  knowledgeClaimContent,
  knowledgeClaimKey,
  knowledgeMutationInputSchema,
  knowledgeReadInputSchema,
  knowledgeRecordSnapshotSchema,
  knowledgeValiditySchema,
} from "@personal-os/domain";
import { and, eq } from "drizzle-orm";
import { auditValues } from "../audit.js";
import { AppError } from "../errors.js";
import type { Principal } from "../types.js";
import {
  bumpKnowledgeEpoch,
  createKnowledgeAccess,
  emptyKnowledgeMetadata,
  findOwnedKnowledgeRevision,
  type KnowledgeDerivation,
  type KnowledgeRevision,
  type KnowledgeTransaction,
  knowledgeReferences,
  knowledgeRevisionDerivations,
  knowledgeSourceReferences,
  ownedKnowledgeRevision,
  preserveKnowledgeDisclosure,
} from "./access.js";

type KnowledgeAccess = ReturnType<typeof createKnowledgeAccess>;
type StoredReceipt = typeof knowledgeReceipts.$inferSelect;
type RevisionWrite = {
  snapshot: KnowledgeRecordSnapshot;
  metadata: KnowledgeRevisionMetadata;
  claimKey: string | null;
  derivations: KnowledgeDerivation[];
  newSources: KnowledgeSource[];
};

export const knowledgeWriteScopes: AccessScope[] = ["knowledge:read", "knowledge:write"];

export function knowledgeRequestHash(principal: Principal, input: unknown) {
  return createHash("sha256")
    .update(JSON.stringify({ actorId: principal.actorId, input }))
    .digest("hex");
}

export async function findKnowledgeReceipt(
  tx: KnowledgeTransaction,
  principal: Principal,
  mutationKey: string,
  requestHash: string,
) {
  const [receipt] = await tx
    .select()
    .from(knowledgeReceipts)
    .where(
      and(
        eq(knowledgeReceipts.userId, principal.userId),
        eq(knowledgeReceipts.mutationKey, mutationKey),
      ),
    );
  if (!receipt) return;
  if (receipt.requestHash !== requestHash)
    throw new AppError("conflict", "This mutation key was used for another request.");
  return receipt;
}

/** Where a record ID stands now: readable content, the owner's Trash, or purged. */
async function knowledgeRecordPresence(tx: KnowledgeTransaction, userId: string, recordId: string) {
  const [record] = await tx
    .select({ trashedAt: knowledgeRecords.trashedAt })
    .from(knowledgeRecords)
    .where(and(eq(knowledgeRecords.userId, userId), eq(knowledgeRecords.id, recordId)));
  if (record) return record.trashedAt ? ("trashed" as const) : ("live" as const);
  const [tombstone] = await tx
    .select({ recordId: knowledgeTombstones.recordId })
    .from(knowledgeTombstones)
    .where(and(eq(knowledgeTombstones.userId, userId), eq(knowledgeTombstones.recordId, recordId)));
  return tombstone ? ("purged" as const) : ("missing" as const);
}

export async function presentKnowledgeReceipt(
  tx: KnowledgeTransaction,
  access: KnowledgeAccess,
  principal: Principal,
  receipt: StoredReceipt,
  purposes?: KnowledgeReadInput["purpose"][],
): Promise<KnowledgeSaveResult> {
  const presence = await knowledgeRecordPresence(tx, principal.userId, receipt.recordId);
  if (presence !== "live") {
    // Replay never returns content once the record left the default view. Agents never
    // learn whether a record is in Trash or purged.
    const outcome =
      presence === "trashed" && principal.actorType === "user" ? "trashed" : "forgotten";
    return { receiptId: receipt.id, recordId: receipt.recordId, outcome };
  }
  const revision = await ownedKnowledgeRevision(tx, principal, receipt.recordId);
  const allowedPurposes = purposes ?? revision.snapshot.purposes;
  const purpose = allowedPurposes[0];
  if (!purpose) throw new AppError("forbidden", "The knowledge record has no permitted purpose.");
  if (receipt.privateProposal) {
    for (const currentPurpose of allowedPurposes)
      await access.disclose(tx, principal, revision, currentPurpose, { pendingReceipt: true });
    return { receiptId: receipt.id, recordId: receipt.recordId, outcome: "pending_owner_review" };
  }
  for (const currentPurpose of allowedPurposes.slice(1))
    await access.disclose(tx, principal, revision, currentPurpose);
  return {
    receiptId: receipt.id,
    recordId: receipt.recordId,
    outcome: "readable",
    record: await access.present(tx, principal, revision, purpose),
  };
}

export function ownerKnowledgeAcceptance(
  principal: Principal,
  sources: KnowledgeSource[],
  at: Date,
): KnowledgeRevisionMetadata["acceptance"] {
  return {
    kind: "owner",
    actorId: principal.actorId,
    acceptedAt: at.toISOString(),
    evidenceIds: sources.map((source) => source.id),
  };
}

function uniqueDerivations(derivations: KnowledgeDerivation[]) {
  const key = ({ sourceRecordId, sourceRevision, kind }: KnowledgeDerivation) =>
    JSON.stringify([sourceRecordId, sourceRevision, kind]);
  return [...new Map(derivations.map((edge) => [key(edge), edge])).values()];
}

async function assertReferenceAcyclic(
  tx: KnowledgeTransaction,
  userId: string,
  source: KnowledgeRevision,
  blockedId: string,
) {
  const visited = new Set<string>();
  const queue = [source];
  for (let next = queue.pop(); next; next = queue.pop()) {
    if (next.snapshot.id === blockedId)
      throw new AppError("conflict", "Knowledge disclosure dependencies cannot form a cycle.");
    if (visited.has(next.snapshot.id)) continue;
    visited.add(next.snapshot.id);
    const refs = knowledgeReferences(next);
    for (const edge of await knowledgeRevisionDerivations(tx, userId, next))
      refs.add(edge.sourceRecordId);
    for (const id of refs) {
      // Integrity, not disclosure: a restore must not complete a cycle through Trash.
      const reference = await findOwnedKnowledgeRevision(tx, userId, id, false, {
        includeTrashed: true,
      });
      if (reference) queue.push(reference);
    }
  }
}

export async function prepareKnowledgeRevision({
  tx,
  access,
  principal,
  input,
  at,
  current,
  replaceEvidence = true,
  asProposal = false,
}: {
  tx: KnowledgeTransaction;
  access: KnowledgeAccess;
  principal: Principal;
  input: KnowledgeMutationInput;
  at: Date;
  current?: KnowledgeRevision;
  replaceEvidence?: boolean;
  asProposal?: boolean;
}): Promise<RevisionWrite> {
  const snapshot = current?.snapshot;
  const requiredReadScopes = new Set<AccessScope>([
    "knowledge:read",
    ...(snapshot?.requiredReadScopes ?? []),
  ]);
  const { content: submitted } = input;
  const sameContent =
    current !== undefined &&
    JSON.stringify(knowledgeClaimContent(current.snapshot, current.metadata.generatedInference)) ===
      JSON.stringify(submitted);
  const retainSupport = sameContent && !replaceEvidence && !asProposal;
  const inheritedEdges = current
    ? await knowledgeRevisionDerivations(tx, principal.userId, current)
    : [];
  const derivations = retainSupport ? [...inheritedEdges] : [];
  const references = new Map<string, KnowledgeRevision>();
  async function reference(id: string, kind?: KnowledgeDerivation["kind"], exactRevision?: number) {
    let source = references.get(id);
    if (!source) {
      source = await ownedKnowledgeRevision(tx, principal, id);
      if (snapshot) await assertReferenceAcyclic(tx, principal.userId, source, snapshot.id);
      preserveKnowledgeDisclosure(input, source.snapshot);
      for (const purpose of input.purposes) await access.disclose(tx, principal, source, purpose);
      references.set(id, source);
    }
    if (exactRevision !== undefined && source.snapshot.revision !== exactRevision)
      throw new AppError("conflict", "The knowledge source revision changed.");
    if (kind) {
      for (const scope of source.snapshot.requiredReadScopes) requiredReadScopes.add(scope);
      derivations.push({ sourceRecordId: id, sourceRevision: source.snapshot.revision, kind });
    }
    return source;
  }

  if (input.scope.workspace) requiredReadScopes.add(`${input.scope.workspace}:read`);
  const newSources: KnowledgeSource[] = [];
  if (replaceEvidence) {
    for (const evidence of input.evidence) {
      let classification: KnowledgeSource["classification"];
      if (evidence.type === "statement") {
        if (principal.actorType === "agent" && (!evidence.sessionRef || !evidence.messageRef))
          throw new AppError(
            "invalid_request",
            "An agent-recorded statement requires original wording and session/message references.",
          );
        classification =
          principal.actorType === "user" ? "owner_statement" : "agent_recorded_statement";
      } else if (evidence.type === "observation") {
        classification = "agent_observation";
      } else if (evidence.type === "signed_inbound_message") {
        await access.authorize(tx, principal, ["texting:read"]);
        if (!(await access.liveSource(tx, principal.userId, evidence)))
          throw new AppError("forbidden", "The source is not a verified owned inbound message.");
        requiredReadScopes.add("texting:read");
        classification = "signed_inbound_message";
      } else {
        if (evidence.domain === "goals") {
          await access.authorize(tx, principal, ["goals:read"]);
          if (!(await access.goalAvailable(tx, principal.userId, evidence.id)))
            throw new AppError("not_found", "The source goal was not found.");
          throw new AppError("invalid_request", "Goal revision sources are not supported yet.");
        }
        await reference(evidence.id, "source_record", evidence.revision);
        classification = "domain_record";
      }
      newSources.push({
        id: randomUUID(),
        classification,
        evidence,
        actorType: principal.actorType,
        actorId: principal.actorId,
      });
    }
  }
  const sources = retainSupport ? (snapshot?.sources ?? []) : newSources;

  for (const id of input.relatedRecordIds) {
    // The shared read projection omits an unchanged link if its target is no longer visible.
    if (!snapshot?.relatedRecordIds.includes(id)) await reference(id);
  }
  if (submitted.kind === "relationship") {
    await reference(submitted.value.subjectId, "content_evidence");
    await reference(submitted.value.objectId, "content_evidence");
  }
  if (submitted.kind === "goal") {
    await access.authorize(tx, principal, ["goals:read"]);
    if (!(await access.goalAvailable(tx, principal.userId, submitted.value.goalId)))
      throw new AppError("not_found", "The canonical goal was not found.");
    requiredReadScopes.add("goals:read");
  }
  if (submitted.kind === "entity_meaning") {
    const { recordId, purpose } = submitted.value;
    const source = await reference(recordId, "entity_meaning");
    await access.disclose(tx, principal, source, purpose);
  }
  if (submitted.kind === "decision" || submitted.kind === "inference") {
    for (const id of submitted.value.evidenceIds) {
      if (sources.some((source) => source.id === id)) continue;
      if (!input.relatedRecordIds.includes(id))
        throw new AppError("invalid_request", "Evidence must name an owned related record.");
      await reference(id, "content_evidence");
    }
  }

  const stated =
    replaceEvidence &&
    sources.some(
      (source) =>
        source.actorId === principal.actorId &&
        (source.classification === "owner_statement" ||
          source.classification === "agent_recorded_statement"),
    );
  // An unchanged owner revision does not turn an inference into an explicit statement.
  const retainedInference =
    retainSupport && principal.actorType === "user" && current.metadata.origin === "inferred"
      ? current
      : undefined;
  const sameGeneratedInference =
    sameContent &&
    !asProposal &&
    principal.actorType === "user" &&
    current.metadata.generatedInference;
  const origin =
    retainedInference !== undefined ||
    sameGeneratedInference ||
    submitted.kind === "inference" ||
    (principal.actorType === "agent" && !stated)
      ? "inferred"
      : "stated";
  const generatedInference =
    retainedInference?.metadata.generatedInference ??
    (origin === "inferred" && submitted.kind !== "inference");
  const content: KnowledgeRecordSnapshot["content"] =
    retainedInference?.snapshot.content ??
    (generatedInference
      ? {
          kind: "inference",
          value: {
            subject: "owner",
            proposition: JSON.stringify(submitted),
            uncertainty: "Agent interpretation; not confirmed by the owner.",
            evidenceIds: sources.map((source) => source.id),
            reviewCondition: "Explicit owner review required.",
          },
        }
      : submitted);
  const privateProposal = principal.actorType === "agent" && input.sensitivity === "sensitive";
  const status =
    retainedInference?.snapshot.status ??
    (privateProposal ||
    origin === "inferred" ||
    asProposal ||
    (snapshot !== undefined && principal.actorType === "agent")
      ? "proposed"
      : "active");
  const metadata: KnowledgeRevisionMetadata = {
    ...emptyKnowledgeMetadata,
    origin,
    generatedInference,
    acceptance: retainedInference
      ? retainedInference.metadata.acceptance
      : status === "active" && principal.actorType === "user"
        ? ownerKnowledgeAcceptance(principal, sources, at)
        : null,
    disputedBy: retainedInference?.metadata.disputedBy ?? null,
    inheritedRecordIds: current
      ? [
          ...new Set([
            ...knowledgeSourceReferences(current),
            ...inheritedEdges.map((edge) => edge.sourceRecordId),
          ]),
        ]
      : [],
    inheritedSourceIds: current && !asProposal ? current.metadata.inheritedSourceIds : [],
  };

  if (asProposal && snapshot) {
    metadata.inheritedRecordIds.push(snapshot.id);
    derivations.push({
      sourceRecordId: snapshot.id,
      sourceRevision: snapshot.revision,
      kind: "revision_proposal",
    });
  }
  const validity = input.validity ??
    (submitted.kind === "constraint" || submitted.kind === "routine" ? submitted.value : null) ??
    snapshot ?? { validFrom: null, validUntil: null };
  const dates = knowledgeValiditySchema.parse({
    validFrom: validity.validFrom,
    validUntil: validity.validUntil,
  });
  const record = knowledgeRecordSnapshotSchema.parse({
    author: retainedInference?.snapshot.author ?? {
      actorId: principal.actorId,
      actorType: principal.actorType,
    },
    requiredReadScopes: [...requiredReadScopes].sort(),
    ...dates,
    reviewAt: retainedInference?.snapshot.reviewAt ?? null,
    id: asProposal ? randomUUID() : (snapshot?.id ?? randomUUID()),
    schemaVersion: 1,
    content,
    scope: input.scope,
    sensitivity: input.sensitivity,
    purposes: input.purposes,
    confidence: retainedInference?.snapshot.confidence ?? (stated ? 1 : 0),
    status,
    revision: asProposal ? 1 : (snapshot?.revision ?? 0) + 1,
    sources,
    relatedRecordIds: input.relatedRecordIds,
    createdAt: asProposal ? at.toISOString() : (snapshot?.createdAt ?? at.toISOString()),
  });
  return {
    snapshot: record,
    metadata,
    claimKey: knowledgeClaimKey(input.scope.workspace, submitted),
    derivations: uniqueDerivations(derivations),
    newSources,
  };
}

export async function saveKnowledgeSidecar(
  tx: KnowledgeTransaction,
  userId: string,
  { snapshot, metadata, claimKey }: Pick<KnowledgeRevision, "snapshot" | "metadata" | "claimKey">,
  derivations: KnowledgeDerivation[] = [],
) {
  await tx
    .insert(knowledgeRevisionMetadata)
    .values({ userId, recordId: snapshot.id, revision: snapshot.revision, metadata, claimKey });
  for (const edge of derivations) {
    const [source] = await tx
      .select({ id: knowledgeRevisions.id })
      .from(knowledgeRevisions)
      .where(
        and(
          eq(knowledgeRevisions.userId, userId),
          eq(knowledgeRevisions.recordId, edge.sourceRecordId),
          eq(knowledgeRevisions.revision, edge.sourceRevision),
        ),
      );
    if (source)
      await tx
        .insert(knowledgeDerivations)
        .values({
          ...edge,
          userId,
          recordId: snapshot.id,
          revision: snapshot.revision,
        })
        .onConflictDoNothing();
  }
}

export async function writeKnowledgeRevision(
  tx: KnowledgeTransaction,
  principal: Principal,
  write: RevisionWrite,
  at: Date,
) {
  const { snapshot, metadata, claimKey, derivations, newSources } = write;
  const { userId } = principal;
  const { id: recordId, revision } = snapshot;
  if (revision === 1) {
    await tx.insert(knowledgeRecords).values({ id: recordId, userId, revision, createdAt: at });
  } else {
    await tx
      .update(knowledgeRecords)
      .set({ revision })
      .where(and(eq(knowledgeRecords.userId, userId), eq(knowledgeRecords.id, recordId)));
    await tx
      .delete(knowledgeRelationships)
      .where(
        and(
          eq(knowledgeRelationships.userId, userId),
          eq(knowledgeRelationships.recordId, recordId),
        ),
      );
  }
  await tx.insert(knowledgeRevisions).values({ userId, recordId, revision, snapshot });
  await saveKnowledgeSidecar(tx, userId, { snapshot, metadata, claimKey }, derivations);
  if (newSources.length)
    await tx
      .insert(knowledgeSources)
      .values(newSources.map((source) => ({ id: source.id, userId, recordId, source })));
  if (snapshot.relatedRecordIds.length)
    await tx
      .insert(knowledgeRelationships)
      .values(
        snapshot.relatedRecordIds.map((relatedRecordId) => ({ userId, recordId, relatedRecordId })),
      );
}

export async function writeKnowledgeReceipt(
  tx: KnowledgeTransaction,
  principal: Principal,
  input: { mutationKey: string; requestHash: string; action: string; privateProposal?: boolean },
  record: KnowledgeRecordSnapshot,
) {
  const receipt = {
    id: randomUUID(),
    userId: principal.userId,
    recordId: record.id,
    mutationKey: input.mutationKey,
    requestHash: input.requestHash,
    actorId: principal.actorId,
    privateProposal: input.privateProposal ?? false,
  };
  await tx.insert(knowledgeReceipts).values(receipt);
  await tx.insert(auditEvents).values(
    auditValues({
      action: `knowledge.${input.action}`,
      entityType: "knowledge",
      entityId: record.id,
      principal,
      requestId: input.mutationKey,
      before: null,
      after: {
        revision: record.revision,
        status: record.status,
        receiptId: receipt.id,
        policy: "approved_rule",
        sourceIds: record.sources.map((source) => source.id),
      },
    }),
  );
  return receipt;
}

/** Storage and disclosure authority stay in the API, including exact retries. */
export function createKnowledgeRecordService({ db, now }: { db: Database; now: () => Date }) {
  const access = createKnowledgeAccess(now);
  return {
    /** The owner may read a trashed record by ID and sees a purged ID as forgotten. */
    async get(
      principal: Principal,
      raw: KnowledgeReadInput,
    ): Promise<KnowledgeRecord | KnowledgeForgottenRecord> {
      const input = knowledgeReadInputSchema.parse(raw);
      return db.transaction(async (tx) => {
        await access.admit(tx, principal, ["knowledge:read"], "read");
        const owner = principal.actorType === "user";
        const record = await findOwnedKnowledgeRevision(tx, principal.userId, input.id, false, {
          includeTrashed: owner,
        });
        if (record) return access.present(tx, principal, record, input.purpose);
        const [tombstone] = owner
          ? await tx
              .select()
              .from(knowledgeTombstones)
              .where(
                and(
                  eq(knowledgeTombstones.userId, principal.userId),
                  eq(knowledgeTombstones.recordId, input.id),
                ),
              )
          : [];
        if (!tombstone) throw new AppError("not_found", "The knowledge record was not found.");
        return {
          id: tombstone.recordId,
          state: "forgotten",
          trashedAt: tombstone.trashedAt.toISOString(),
          purgedAt: tombstone.purgedAt.toISOString(),
        };
      });
    },
    async create(principal: Principal, raw: KnowledgeMutationInput): Promise<KnowledgeSaveResult> {
      const input = knowledgeMutationInputSchema.parse(raw);
      const requestHash = knowledgeRequestHash(principal, input);
      return db.transaction(async (tx) => {
        const scopes = [...knowledgeWriteScopes];
        if (input.scope.workspace) scopes.push(`${input.scope.workspace}:read`);
        await access.admit(tx, principal, scopes);
        const prior = await findKnowledgeReceipt(tx, principal, input.mutationKey, requestHash);
        if (prior) return presentKnowledgeReceipt(tx, access, principal, prior, input.purposes);
        const at = now();
        const write = await prepareKnowledgeRevision({ tx, access, principal, input, at });
        await writeKnowledgeRevision(tx, principal, write, at);
        const receipt = await writeKnowledgeReceipt(
          tx,
          principal,
          {
            action: "created",
            mutationKey: input.mutationKey,
            requestHash,
            privateProposal: principal.actorType === "agent" && input.sensitivity === "sensitive",
          },
          write.snapshot,
        );
        const result = await presentKnowledgeReceipt(
          tx,
          access,
          principal,
          receipt,
          input.purposes,
        );
        await bumpKnowledgeEpoch(tx, principal.userId);
        return result;
      });
    },
  };
}
