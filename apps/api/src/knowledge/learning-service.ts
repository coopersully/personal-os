import { randomUUID } from "node:crypto";
import {
  auditEvents,
  type Database,
  knowledgeLearningReceipts,
  knowledgeLearningSettings,
  knowledgeLearningSuppressions,
  knowledgeReceipts,
  knowledgeSelectionInteractions,
  knowledgeSources,
} from "@personal-os/database";
import {
  type KnowledgePreferenceKey,
  type KnowledgeSelectionInput,
  type KnowledgeSelectionInteraction,
  type KnowledgeSelectionResult,
  type KnowledgeSettings,
  type KnowledgeSettingsInput,
  type KnowledgeSource,
  type KnowledgeSuppressionResetInput,
  type KnowledgeSuppressionResetResult,
  knowledgeClaimContent,
  knowledgeClaimValue,
  knowledgePreferenceClaimKey,
  knowledgePreferenceContent,
  knowledgePreferenceKeySchema,
  knowledgePreferenceSelectionSchema,
  knowledgeSelectionInputSchema,
  knowledgeSettingsInputSchema,
  knowledgeSuppressionResetInputSchema,
  localDateAt,
  localDateToIso,
  preferenceKeyForClaim,
} from "@personal-os/domain";
import { and, eq, inArray, isNull, lte, sql } from "drizzle-orm";
import { auditValues } from "../audit.js";
import { AppError } from "../errors.js";
import type { Principal } from "../types.js";
import {
  admitHumanKnowledgeContent,
  assertForgetMutationKeyUnused,
  bumpKnowledgeEpoch,
  createKnowledgeAccess,
  emptyKnowledgeMetadata,
  type KnowledgeTransaction,
  knowledgeClaimRevisions,
  knowledgeRevisionDerivations,
  knowledgeSelectionSupport,
  knowledgeValidityOverlaps,
  readKnowledgeEpoch,
  requireKnowledgeOwner,
} from "./access.js";
import { hasKnowledgeForgetSuppression } from "./forget-suppression.js";
import {
  selectionEvidence,
  selectionMinimumDates,
  selectionPurposes,
  selectionReviewMs,
  selectionRuleSupports,
  selectionRuleVersion,
  selectionSuppression,
} from "./learning-evidence.js";
import {
  knowledgeRequestHash,
  presentKnowledgeReceipt,
  writeKnowledgeReceipt,
  writeKnowledgeRevision,
} from "./record-service.js";

const admissionMs = 15 * 60_000;
const interactions = knowledgeSelectionInteractions;
const recorded = { outcome: "recorded" } as const;

async function readSettings(tx: KnowledgeTransaction, userId: string): Promise<KnowledgeSettings> {
  const [row] = await tx
    .select({
      automaticPreferenceAcceptance: knowledgeLearningSettings.automaticPreferenceAcceptance,
      revision: knowledgeLearningSettings.revision,
    })
    .from(knowledgeLearningSettings)
    .where(eq(knowledgeLearningSettings.userId, userId));
  return row ?? { automaticPreferenceAcceptance: true, revision: 0 };
}

async function replayLearningMutation(
  tx: KnowledgeTransaction,
  userId: string,
  mutationKey: string,
  requestHash: string,
) {
  await assertForgetMutationKeyUnused(tx, userId, mutationKey);
  const [row] = await tx
    .select()
    .from(knowledgeLearningReceipts)
    .where(
      and(
        eq(knowledgeLearningReceipts.userId, userId),
        eq(knowledgeLearningReceipts.mutationKey, mutationKey),
      ),
    );
  if (row && row.requestHash !== requestHash)
    throw new AppError("conflict", "This mutation key was used for another request.");
  return Boolean(row);
}

/** Caller holds the owner's write lock. Only this writer authors rule provenance. */
async function evaluatePreference(
  tx: KnowledgeTransaction,
  principal: Principal,
  key: KnowledgePreferenceKey,
  enabled: boolean,
  at: Date,
  suppressionKey: Uint8Array | undefined,
) {
  const { userId } = principal;
  const suppression = await selectionSuppression(tx, userId, key);
  const claimKey = knowledgePreferenceClaimKey(key);
  if (await hasKnowledgeForgetSuppression(tx, userId, suppressionKey, claimKey)) return;
  const candidates = (await knowledgeClaimRevisions(tx, userId, claimKey)).filter(
    ({ snapshot }) =>
      snapshot.status !== "superseded" &&
      snapshot.status !== "expired" &&
      (snapshot.validUntil === null || Date.parse(snapshot.validUntil) > at.getTime()),
  );
  const current = candidates.find(({ metadata }) => metadata.selectionGeneration !== undefined);
  const previousStart = current?.snapshot.validFrom;
  const validity = {
    validFrom:
      previousStart && Date.parse(previousStart) > at.getTime() ? previousStart : at.toISOString(),
    validUntil: current?.snapshot.validUntil ?? null,
  };
  const overlapping = candidates.filter(({ snapshot }) =>
    knowledgeValidityOverlaps(validity, snapshot),
  );
  if (
    overlapping.some(
      ({ snapshot, metadata }) =>
        snapshot.status === "active" && metadata.acceptance?.kind === "owner",
    )
  )
    return;
  if (current?.metadata.disputedBy === "agent") return;
  if (suppression.suppressed && current?.snapshot.status !== "active") return;
  const evidence = await selectionEvidence(tx, userId, key, suppression.generation, at);
  const currentValue =
    current?.snapshot.content.kind === "preference" &&
    current.snapshot.content.value.value.type === "string"
      ? current.snapshot.content.value.value.value
      : undefined;

  if (
    current &&
    current.snapshot.status === "active" &&
    current.metadata.acceptance?.kind === "evidence_rule"
  ) {
    const contrary = evidence.some(({ value }) => value !== currentValue);
    if (contrary || !(await knowledgeSelectionSupport(tx, userId, current))) {
      const write = {
        snapshot: {
          ...current.snapshot,
          revision: current.snapshot.revision + 1,
          status: "disputed" as const,
        },
        metadata: current.metadata,
        claimKey,
        derivations: await knowledgeRevisionDerivations(tx, userId, current),
        newSources: [],
      };
      await writeKnowledgeRevision(tx, principal, write, at);
      return write.snapshot;
    }
    // Disablement leaves existing acceptance intact. Refresh only when review is due.
    if (!current.snapshot.reviewAt || Date.parse(current.snapshot.reviewAt) > at.getTime()) return;
  }

  if (suppression.suppressed) return;
  // Reset only changes learning eligibility; it cannot change the record's disclosure.
  if (
    current &&
    (current.snapshot.scope.workspace !== null ||
      current.snapshot.sensitivity !== "standard" ||
      selectionPurposes.some((purpose) => !current.snapshot.purposes.includes(purpose)))
  )
    return;

  const values = new Set(evidence.map((event) => event.value));
  if (values.size !== 1) return;
  const selection = knowledgePreferenceSelectionSchema.parse({ key, value: evidence[0]?.value });
  const content = knowledgePreferenceContent(selection);
  const otherValue = JSON.stringify(content.value.value);
  const conflicts = overlapping.some(
    ({ snapshot, metadata }) =>
      snapshot.id !== current?.snapshot.id &&
      JSON.stringify(
        knowledgeClaimValue(knowledgeClaimContent(snapshot, metadata.generatedInference)),
      ) !== otherValue,
  );
  const accepts = enabled && !conflicts && selectionRuleSupports(evidence, selection.value);
  if (
    !accepts &&
    current &&
    (current.snapshot.status === "active" || current.snapshot.status === "disputed")
  )
    return;

  const sources: KnowledgeSource[] = evidence.slice(0, selectionMinimumDates).map(({ id }) => ({
    id,
    classification: "first_party_selection",
    evidence: { type: "first_party_selection", id },
    actorType: "user",
    actorId: principal.actorId,
  }));
  if (
    !accepts &&
    currentValue === selection.value &&
    current?.snapshot.sources.map(({ id }) => id).join() === sources.map(({ id }) => id).join()
  )
    return;
  const recordId = current?.snapshot.id ?? randomUUID();
  const knownSources = current
    ? await tx
        .select({ id: knowledgeSources.id })
        .from(knowledgeSources)
        .where(
          and(
            eq(knowledgeSources.userId, userId),
            eq(knowledgeSources.recordId, recordId),
            inArray(
              knowledgeSources.id,
              sources.map(({ id }) => id),
            ),
          ),
        )
    : [];
  const knownIds = new Set(knownSources.map(({ id }) => id));
  const snapshot = {
    id: recordId,
    author: { actorId: principal.actorId, actorType: "user" as const },
    requiredReadScopes: current?.snapshot.requiredReadScopes ?? ["knowledge:read" as const],
    schemaVersion: 1 as const,
    content,
    scope: { workspace: null },
    sensitivity: "standard" as const,
    purposes: [...selectionPurposes],
    confidence: 0,
    status: accepts ? ("active" as const) : ("proposed" as const),
    ...validity,
    reviewAt: accepts ? new Date(at.getTime() + selectionReviewMs).toISOString() : null,
    revision: (current?.snapshot.revision ?? 0) + 1,
    sources,
    relatedRecordIds: current?.snapshot.relatedRecordIds ?? [],
    createdAt: current?.snapshot.createdAt ?? at.toISOString(),
  };
  await writeKnowledgeRevision(
    tx,
    principal,
    {
      snapshot,
      metadata: {
        ...emptyKnowledgeMetadata,
        inheritedRecordIds: current?.metadata.inheritedRecordIds ?? [],
        inheritedSourceIds: current?.metadata.inheritedSourceIds ?? [],
        origin: "inferred",
        selectionGeneration: suppression.generation,
        acceptance: accepts
          ? {
              kind: "evidence_rule",
              ruleVersion: selectionRuleVersion,
              acceptedAt: at.toISOString(),
              evidenceIds: sources.map(({ id }) => id),
            }
          : null,
      },
      claimKey,
      derivations: current ? await knowledgeRevisionDerivations(tx, userId, current) : [],
      newSources: sources.filter(({ id }) => !knownIds.has(id)),
    },
    at,
  );
  return snapshot;
}

export function createKnowledgeLearningService({
  db,
  now,
  suppressionKey,
}: {
  db: Database;
  now: () => Date;
  suppressionKey?: Uint8Array;
}) {
  const access = createKnowledgeAccess(now);
  return {
    async issueSelectionInteraction(principal: Principal): Promise<KnowledgeSelectionInteraction> {
      requireKnowledgeOwner(principal);
      return db.transaction(async (tx) => {
        const { at: issuedAt, sessionId } = await admitHumanKnowledgeContent(tx, principal, now);
        await tx
          .delete(interactions)
          .where(
            and(
              eq(interactions.userId, principal.userId),
              isNull(interactions.occurredAt),
              lte(interactions.expiresAt, issuedAt),
            ),
          );
        const sourceEventId = randomUUID();
        const expiresAt = new Date(issuedAt.getTime() + admissionMs);
        await tx
          .insert(interactions)
          .values({ id: sourceEventId, userId: principal.userId, sessionId, issuedAt, expiresAt });
        return { sourceEventId, expiresAt: expiresAt.toISOString() };
      });
    },

    async recordSelection(
      principal: Principal,
      raw: KnowledgeSelectionInput,
    ): Promise<KnowledgeSelectionResult> {
      requireKnowledgeOwner(principal);
      const input = knowledgeSelectionInputSchema.parse(raw);
      const requestHash = knowledgeRequestHash(principal, { selection: input });
      return db.transaction(async (tx) => {
        const { userId } = principal;
        const { at, sessionId, timeZone } = await admitHumanKnowledgeContent(tx, principal, now);
        const match = and(
          eq(interactions.id, input.sourceEventId),
          eq(interactions.userId, userId),
          eq(interactions.sessionId, sessionId),
        );
        const [interaction] = await tx.select().from(interactions).where(match).for("update");
        if (!interaction)
          throw new AppError("not_found", "The selection interaction was not found.");
        const [receipt] = await tx
          .select()
          .from(knowledgeReceipts)
          .where(
            and(
              eq(knowledgeReceipts.userId, userId),
              eq(knowledgeReceipts.mutationKey, input.sourceEventId),
            ),
          );
        if (interaction.occurredAt) {
          if (interaction.key !== input.key || interaction.value !== input.value)
            throw new AppError(
              "conflict",
              "This interaction already recorded a different selection.",
            );
          // The committed event owns replay. Ignore an unrelated record mutation with the same key.
          return receipt?.requestHash === requestHash
            ? presentKnowledgeReceipt(tx, access, principal, receipt)
            : recorded;
        }
        if (at < interaction.issuedAt || at >= interaction.expiresAt)
          throw new AppError(
            "conflict",
            "This selection interaction is outside its admission window.",
          );
        if (receipt)
          throw new AppError("conflict", "This interaction ID was used for another mutation.");
        await assertForgetMutationKeyUnused(tx, userId, input.sourceEventId);
        const { generation } = await selectionSuppression(tx, userId, input.key);
        await tx
          .update(interactions)
          .set({
            occurredAt: at,
            localDate: localDateToIso(localDateAt(at, timeZone)),
            timeZone,
            key: input.key,
            value: input.value,
            generation,
          })
          .where(match);
        const settings = await readSettings(tx, userId);
        const revision = await evaluatePreference(
          tx,
          principal,
          input.key,
          settings.automaticPreferenceAcceptance,
          at,
          suppressionKey,
        );
        await bumpKnowledgeEpoch(tx, userId);
        if (!revision) return recorded;
        const selectionReceipt = await writeKnowledgeReceipt(
          tx,
          principal,
          {
            mutationKey: input.sourceEventId,
            requestHash,
            action: "preference_evaluated",
          },
          revision,
        );
        return presentKnowledgeReceipt(tx, access, principal, selectionReceipt);
      });
    },

    async getSettings(principal: Principal): Promise<KnowledgeSettings> {
      requireKnowledgeOwner(principal);
      return db.transaction(async (tx) => {
        await admitHumanKnowledgeContent(tx, principal, now, "read");
        return readSettings(tx, principal.userId);
      });
    },

    async updateSettings(
      principal: Principal,
      raw: KnowledgeSettingsInput,
    ): Promise<KnowledgeSettings> {
      requireKnowledgeOwner(principal);
      const input = knowledgeSettingsInputSchema.parse(raw);
      const requestHash = knowledgeRequestHash(principal, { settings: input });
      return db.transaction(async (tx) => {
        const { userId } = principal;
        const { at } = await admitHumanKnowledgeContent(tx, principal, now);
        const current = await readSettings(tx, userId);
        if (await replayLearningMutation(tx, userId, input.mutationKey, requestHash))
          return current;
        if (current.revision !== input.expectedRevision)
          throw new AppError("conflict", "The learning settings changed.", { current });
        const updated = {
          automaticPreferenceAcceptance: input.automaticPreferenceAcceptance,
          revision: current.revision + 1,
        };
        await tx
          .insert(knowledgeLearningSettings)
          .values({ userId, ...updated })
          .onConflictDoUpdate({
            target: knowledgeLearningSettings.userId,
            set: updated,
          });
        for (const key of knowledgePreferenceKeySchema.options)
          await evaluatePreference(
            tx,
            principal,
            key,
            updated.automaticPreferenceAcceptance,
            at,
            suppressionKey,
          );
        await tx
          .insert(knowledgeLearningReceipts)
          .values({ userId, mutationKey: input.mutationKey, requestHash });
        await tx.insert(auditEvents).values(
          auditValues({
            action: "knowledge.learning_settings_changed",
            entityType: "knowledge",
            entityId: userId,
            principal,
            requestId: input.mutationKey,
            before: current,
            after: updated,
          }),
        );
        await bumpKnowledgeEpoch(tx, userId);
        return updated;
      });
    },

    async resetSuppression(
      principal: Principal,
      raw: KnowledgeSuppressionResetInput,
    ): Promise<KnowledgeSuppressionResetResult> {
      requireKnowledgeOwner(principal);
      const input = knowledgeSuppressionResetInputSchema.parse(raw);
      const key = preferenceKeyForClaim(input.claimKey);
      if (!key)
        throw new AppError("invalid_request", "This claim does not support automatic learning.");
      const requestHash = knowledgeRequestHash(principal, { reset: input });
      return db.transaction(async (tx) => {
        const { userId } = principal;
        await admitHumanKnowledgeContent(tx, principal, now);
        const epoch = await readKnowledgeEpoch(tx, userId);
        if (await replayLearningMutation(tx, userId, input.mutationKey, requestHash))
          return { epoch };
        if (epoch !== input.expectedEpoch)
          throw new AppError("conflict", "The knowledge state changed.", { epoch });
        const updated = await tx
          .update(knowledgeLearningSuppressions)
          .set({
            suppressed: false,
            generation: sql`${knowledgeLearningSuppressions.generation} + 1`,
          })
          .where(
            and(
              eq(knowledgeLearningSuppressions.userId, userId),
              eq(knowledgeLearningSuppressions.key, key),
              eq(knowledgeLearningSuppressions.suppressed, true),
            ),
          )
          .returning({ key: knowledgeLearningSuppressions.key });
        await tx
          .insert(knowledgeLearningReceipts)
          .values({ userId, mutationKey: input.mutationKey, requestHash });
        if (!updated.length) return { epoch };
        const nextEpoch = await bumpKnowledgeEpoch(tx, userId);
        await tx.insert(auditEvents).values(
          auditValues({
            action: "knowledge.learning_suppression_reset",
            entityType: "knowledge",
            entityId: userId,
            principal,
            requestId: input.mutationKey,
            before: { epoch },
            after: { epoch: nextEpoch },
          }),
        );
        return { epoch: nextEpoch };
      });
    },
  };
}
