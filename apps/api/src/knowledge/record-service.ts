import { createHash, randomUUID } from "node:crypto";
import {
  accessTokens,
  auditEvents,
  type Database,
  goals,
  knowledgeReceipts,
  knowledgeRecords,
  knowledgeRelationships,
  knowledgeRevisions,
  knowledgeSources,
  textInboundClaims,
} from "@personal-os/database";
import {
  type AccessScope,
  type KnowledgeMutationInput,
  type KnowledgeReadInput,
  type KnowledgeReceipt,
  type KnowledgeRecord,
  type KnowledgeSource,
  knowledgeMutationInputSchema,
  knowledgeReadInputSchema,
  knowledgeRecordSchema,
} from "@personal-os/domain";
import { and, eq, sql } from "drizzle-orm";
import { auditValues } from "../audit.js";
import { AppError } from "../errors.js";
import type { Principal } from "../types.js";

type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];
/** Storage and disclosure authority stay in the API, including exact retries. */
export function createKnowledgeRecordService({ db, now }: { db: Database; now: () => Date }) {
  async function authorize(tx: Tx, principal: Principal, required: AccessScope[]) {
    if (principal.actorType === "user") return;
    // The current credential, not a saved principal or prior receipt, owns authorization.
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
  }
  async function owned(tx: Tx, principal: Principal, id: string): Promise<KnowledgeRecord> {
    const [row] = await tx
      .select({ snapshot: knowledgeRevisions.snapshot })
      .from(knowledgeRecords)
      .innerJoin(
        knowledgeRevisions,
        and(
          eq(knowledgeRevisions.userId, knowledgeRecords.userId),
          eq(knowledgeRevisions.recordId, knowledgeRecords.id),
          eq(knowledgeRevisions.revision, knowledgeRecords.revision),
        ),
      )
      .where(and(eq(knowledgeRecords.userId, principal.userId), eq(knowledgeRecords.id, id)));
    if (!row) throw new AppError("not_found", "The knowledge record was not found.");
    return knowledgeRecordSchema.parse(row.snapshot);
  }
  async function disclose(
    tx: Tx,
    principal: Principal,
    record: KnowledgeRecord,
    purpose: KnowledgeReadInput["purpose"],
  ) {
    const required: AccessScope[] = ["knowledge:read", ...record.requiredReadScopes];
    if (record.content.kind === "goal") required.push("goals:read");
    if (record.scope.workspace) required.push(`${record.scope.workspace}:read`);
    for (const source of record.sources) {
      if (source.evidence.type === "domain_record" && source.evidence.domain === "goals")
        required.push("goals:read");
      if (source.evidence.type === "signed_inbound_message") required.push("texting:read");
    }
    await authorize(tx, principal, required);
    if (!record.purposes.includes(purpose))
      throw new AppError("forbidden", "This record is unavailable for that purpose.");
    if (principal.actorType === "agent" && record.sensitivity === "sensitive")
      throw new AppError(
        "forbidden",
        "Sensitive knowledge requires owner review until disclosure settings are available.",
      );
  }
  function preserveDisclosure(input: KnowledgeMutationInput, source: KnowledgeRecord) {
    if (
      (source.scope.workspace && input.scope.workspace !== source.scope.workspace) ||
      (source.sensitivity === "sensitive" && input.sensitivity !== "sensitive") ||
      input.purposes.some((purpose) => !source.purposes.includes(purpose))
    ) {
      throw new AppError("forbidden", "A derived record cannot broaden source disclosure.");
    }
  }
  async function resolveEvidence(
    tx: Tx,
    principal: Principal,
    input: KnowledgeMutationInput,
  ): Promise<KnowledgeSource[]> {
    const sources: KnowledgeSource[] = [];
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
      } else if (evidence.type === "observation") classification = "agent_observation";
      else if (evidence.type === "signed_inbound_message") {
        await authorize(tx, principal, ["texting:read"]);
        const [claim] = await tx
          .select()
          .from(textInboundClaims)
          .where(
            and(
              eq(textInboundClaims.userId, principal.userId),
              eq(textInboundClaims.messageId, evidence.id),
            ),
          );
        if (!claim)
          throw new AppError("forbidden", "The source is not a verified owned inbound message.");
        classification = "signed_inbound_message";
      } else {
        if (evidence.domain === "knowledge") {
          const source = await owned(tx, principal, evidence.id);
          preserveDisclosure(input, source);
          for (const purpose of input.purposes) await disclose(tx, principal, source, purpose);
          if (source.revision !== evidence.revision)
            throw new AppError("conflict", "The knowledge source revision changed.");
        } else {
          await authorize(tx, principal, ["goals:read"]);
          const [goal] = await tx
            .select()
            .from(goals)
            .where(and(eq(goals.userId, principal.userId), eq(goals.id, evidence.id)));
          if (!goal) throw new AppError("not_found", "The source goal was not found.");
          // Goals have no public revision contract yet; do not manufacture one.
          throw new AppError("invalid_request", "Goal revision sources are not supported yet.");
        }
        classification = "domain_record";
      }
      sources.push({
        id: randomUUID(),
        classification,
        evidence,
        actorType: principal.actorType,
        actorId: principal.actorId,
      });
    }
    return sources;
  }
  return {
    async get(principal: Principal, raw: KnowledgeReadInput): Promise<KnowledgeRecord> {
      const input = knowledgeReadInputSchema.parse(raw);
      return db.transaction(async (tx) => {
        await authorize(tx, principal, ["knowledge:read"]);
        const record = await owned(tx, principal, input.id);
        await disclose(tx, principal, record, input.purpose);
        return record;
      });
    },
    async create(principal: Principal, raw: KnowledgeMutationInput): Promise<KnowledgeReceipt> {
      const input = knowledgeMutationInputSchema.parse(raw);
      const requestHash = createHash("sha256")
        .update(JSON.stringify({ actorId: principal.actorId, input }))
        .digest("hex");
      return db.transaction(async (tx) => {
        // All knowledge admissions use owner lock -> credential -> identity/revision rows.
        await tx.execute(
          sql`SELECT pg_advisory_xact_lock(hashtextextended(${`knowledge:${principal.userId}`}, 0))`,
        );
        await authorize(tx, principal, [
          "knowledge:read",
          "knowledge:write",
          ...(input.scope.workspace ? [`${input.scope.workspace}:read` as AccessScope] : []),
        ]);
        const [prior] = await tx
          .select()
          .from(knowledgeReceipts)
          .where(
            and(
              eq(knowledgeReceipts.userId, principal.userId),
              eq(knowledgeReceipts.mutationKey, input.mutationKey),
            ),
          );
        if (prior) {
          if (prior.requestHash !== requestHash)
            throw new AppError("conflict", "This mutation key was used for another request.");
          const record = await owned(tx, principal, prior.recordId);
          for (const purpose of input.purposes) await disclose(tx, principal, record, purpose);
          return { receiptId: prior.id, record };
        }
        const sources = await resolveEvidence(tx, principal, input);
        for (const id of input.relatedRecordIds) {
          const related = await owned(tx, principal, id);
          preserveDisclosure(input, related);
          for (const purpose of input.purposes) await disclose(tx, principal, related, purpose);
        }
        if (input.content.kind === "relationship") {
          for (const id of [input.content.value.subjectId, input.content.value.objectId]) {
            const related = await owned(tx, principal, id);
            preserveDisclosure(input, related);
            for (const purpose of input.purposes) await disclose(tx, principal, related, purpose);
          }
        }
        if (input.content.kind === "goal") {
          await authorize(tx, principal, ["goals:read"]);
          const [goal] = await tx
            .select()
            .from(goals)
            .where(
              and(eq(goals.userId, principal.userId), eq(goals.id, input.content.value.goalId)),
            );
          if (!goal) throw new AppError("not_found", "The canonical goal was not found.");
        }
        if (input.content.kind === "entity_meaning") {
          const source = await owned(tx, principal, input.content.value.recordId);
          preserveDisclosure(input, source);
          await disclose(tx, principal, source, input.content.value.purpose);
        }
        const stated = sources.some((source) =>
          ["owner_statement", "agent_recorded_statement"].includes(source.classification),
        );
        // Evidence and signed messages never turn an agent's interpretation into a user fact.
        const inferred = principal.actorType === "agent" && !stated;
        const content: KnowledgeRecord["content"] =
          inferred && input.content.kind !== "inference"
            ? {
                kind: "inference",
                value: {
                  subject: "owner",
                  proposition: JSON.stringify(input.content),
                  uncertainty: "Agent interpretation; not confirmed by the owner.",
                  evidenceIds: sources.map((source) => source.id),
                  reviewCondition: "Explicit owner review required.",
                },
              }
            : input.content;
        if (content.kind === "decision" || content.kind === "inference") {
          if (
            content.value.evidenceIds.some(
              (id) =>
                !input.relatedRecordIds.includes(id) && !sources.some((source) => source.id === id),
            )
          )
            throw new AppError("invalid_request", "Evidence must name an owned related record.");
        }
        const requiredReadScopes = new Set<AccessScope>(["knowledge:read"]);
        if (input.scope.workspace) requiredReadScopes.add(`${input.scope.workspace}:read`);
        if (input.content.kind === "goal") requiredReadScopes.add("goals:read");
        const referenceIds = new Set(input.relatedRecordIds);
        for (const source of sources) {
          if (source.evidence.type === "signed_inbound_message")
            requiredReadScopes.add("texting:read");
          if (source.evidence.type === "domain_record" && source.evidence.domain === "knowledge")
            referenceIds.add(source.evidence.id);
        }
        if (input.content.kind === "relationship") {
          referenceIds.add(input.content.value.subjectId);
          referenceIds.add(input.content.value.objectId);
        }
        if (input.content.kind === "entity_meaning") referenceIds.add(input.content.value.recordId);
        for (const id of referenceIds) {
          const source = await owned(tx, principal, id);
          for (const scope of source.requiredReadScopes) requiredReadScopes.add(scope);
        }
        const record = knowledgeRecordSchema.parse({
          author: { actorId: principal.actorId, actorType: principal.actorType },
          requiredReadScopes: [...requiredReadScopes].sort(),
          validFrom: null,
          validUntil: null,
          reviewAt: null,
          id: randomUUID(),
          schemaVersion: 1,
          content,
          scope: input.scope,
          sensitivity: input.sensitivity,
          purposes: input.purposes,
          confidence: stated ? 1 : 0,
          status: inferred || content.kind === "inference" ? "proposed" : "active",
          revision: 1,
          sources,
          relatedRecordIds: input.relatedRecordIds,
          createdAt: now().toISOString(),
        });
        for (const purpose of input.purposes) await disclose(tx, principal, record, purpose);
        await tx
          .insert(knowledgeRecords)
          .values({ id: record.id, userId: principal.userId, revision: 1, createdAt: now() });
        await tx
          .insert(knowledgeRevisions)
          .values({ userId: principal.userId, recordId: record.id, revision: 1, snapshot: record });
        if (sources.length)
          await tx.insert(knowledgeSources).values(
            sources.map((source) => ({
              id: source.id,
              userId: principal.userId,
              recordId: record.id,
              source,
            })),
          );
        if (input.relatedRecordIds.length)
          await tx.insert(knowledgeRelationships).values(
            input.relatedRecordIds.map((relatedRecordId) => ({
              userId: principal.userId,
              recordId: record.id,
              relatedRecordId,
            })),
          );
        const receiptId = randomUUID();
        await tx.insert(knowledgeReceipts).values({
          id: receiptId,
          userId: principal.userId,
          recordId: record.id,
          mutationKey: input.mutationKey,
          requestHash,
        });
        await tx.insert(auditEvents).values(
          auditValues({
            action: "knowledge.created",
            entityType: "knowledge",
            entityId: record.id,
            principal,
            requestId: input.mutationKey,
            before: null,
            after: {
              revision: record.revision,
              status: record.status,
              receiptId,
              policy: "approved_rule",
              sourceIds: sources.map((source) => source.id),
            },
          }),
        );
        return { receiptId, record };
      });
    },
  };
}
