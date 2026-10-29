import { z } from "zod";
import { agentAccountSchema } from "../agent-account.js";
import { actorTypeSchema, idSchema, isoDateTimeSchema } from "../common.js";
import { financeConversationSequenceSchema } from "./conversation.js";

export const financeActivityKindSchema = z.enum(["human_answer_decision", "financial_action"]);
export const financeActivityStatusSchema = z.enum([
  "accepted",
  "proposed",
  "approved",
  "applied",
  "failed",
  "partial",
]);
export const financeActivityTargetSchema = z
  .object({
    kind: z.enum(["chat", "review_case", "transaction", "run"]),
    id: idSchema,
  })
  .strict();
export const financeActivitySourceMessageSchema = z
  .object({
    id: idSchema,
    sequence: financeConversationSequenceSchema,
    text: z.string().min(1).max(10_000),
    createdAt: isoDateTimeSchema,
    contentHash: z.string().regex(/^[a-f0-9]{64}$/u),
    // A missing historical excerpt stays missing. Full immutable source text remains available.
    excerpt: z
      .object({
        start: z.number().int().nonnegative(),
        end: z.number().int().positive(),
        text: z.string().min(1).max(10_000),
      })
      .strict()
      .nullable(),
  })
  .strict();
/** Activity preserves arbitrary canonical audit entity kinds; only known kinds get navigation. */
export const financeActivityRecordReferenceSchema = z
  .object({
    kind: z.string().min(1).max(100),
    id: idSchema,
    sourceKind: z.string().min(1).max(100).optional(),
  })
  .strict();
export const financeActivityEvidenceQuerySchema = z
  .object({
    cursor: z.string().min(1).max(3000).optional(),
  })
  .strict();
export type FinanceActivityEvidenceQuery = z.infer<typeof financeActivityEvidenceQuerySchema>;
export const financeActivityEvidenceStateSchema = z
  .object({
    totalChanges: z.number().int().min(1).max(10000),
    loadedChanges: z.number().int().min(1).max(100),
    nextCursor: z.string().min(1).max(3000).nullable(),
  })
  .strict()
  .refine(
    (state) =>
      state.loadedChanges <= state.totalChanges &&
      (state.nextCursor === null) === (state.loadedChanges === state.totalChanges),
    "Evidence completeness must match the loaded change count.",
  );
export const financeActivityEffectSchema = z
  .object({
    candidateId: idSchema,
    candidateRevision: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
    authorityBasis: z.enum([
      "original_live_grant",
      "authenticated_owner",
      "legacy_unbound_context",
    ]),
    actionFamilies: z.array(z.string().min(1).max(100)).max(100),
    significance: z.enum(["routine", "budget_decision"]),
    humanApproval: z.object({ actorId: idSchema, reviewId: idSchema }).strict().nullable(),
  })
  .strict();
export const financeActivityChangeSchema = z
  .object({
    id: idSchema,
    recordRef: financeActivityRecordReferenceSchema,
    sourceRecordRef: financeActivityRecordReferenceSchema.optional(),
    actor: z.object({ type: actorTypeSchema, id: z.string().nullable() }).strict().optional(),
    occurredAt: isoDateTimeSchema.optional(),
    action: z.string().min(1).max(160).optional(),
    before: z.record(z.string(), z.unknown()).nullable(),
    after: z.record(z.string(), z.unknown()).nullable(),
    auditEventIds: z.array(idSchema).max(100),
  })
  .strict();
export const financeActivityEntrySchema = z
  .object({
    agentAccount: agentAccountSchema.nullable().optional(),
    id: idSchema,
    occurredAt: isoDateTimeSchema,
    kind: financeActivityKindSchema,
    status: financeActivityStatusSchema,
    actor: z.object({ type: actorTypeSchema, id: z.string().min(1).max(240).nullable() }).strict(),
    action: z.string().min(1).max(160),
    explanation: z.string().min(1).max(4000),
    caseId: idSchema.nullable(),
    runId: idSchema.nullable(),
    actionId: z.string().min(1).max(200).nullable(),
    sourceOperationId: idSchema.nullable(),
    auditEventIds: z.array(idSchema).min(1).max(100),
    sourceMessages: z.array(financeActivitySourceMessageSchema).max(100),
    recordRefs: z.array(financeActivityRecordReferenceSchema).max(100),
    changes: z.array(financeActivityChangeSchema).max(100),
    targets: z.array(financeActivityTargetSchema).max(100),
    effect: financeActivityEffectSchema.optional(),
    evidence: financeActivityEvidenceStateSchema.optional(),
  })
  .strict()
  .refine(
    (entry) => !entry.evidence || entry.evidence.loadedChanges === entry.changes.length,
    "The entry must contain exactly its stated loaded evidence.",
  );
export type FinanceActivityEntry = z.infer<typeof financeActivityEntrySchema>;
export const financeActivityEvidencePageSchema = z
  .object({
    entryId: idSchema,
    changes: z.array(financeActivityChangeSchema).min(1).max(100),
    auditEventIds: z.array(idSchema).min(1).max(100),
    recordRefs: z.array(financeActivityRecordReferenceSchema).max(100),
    offset: z.number().int().min(0).max(9999),
    totalChanges: z.number().int().min(1).max(10000),
    nextCursor: z.string().min(1).max(3000).nullable(),
  })
  .strict()
  .refine(
    (page) =>
      page.offset + page.changes.length <= page.totalChanges &&
      (page.nextCursor === null) === (page.offset + page.changes.length === page.totalChanges),
    "Evidence continuation must match the exact bounded change count.",
  );
export type FinanceActivityEvidencePage = z.infer<typeof financeActivityEvidencePageSchema>;
export const financeActivityQuerySchema = z
  .object({
    cursor: z.string().min(1).max(3000).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    type: financeActivityKindSchema.optional(),
    actor: actorTypeSchema.optional(),
    recordId: idSchema.optional(),
    from: isoDateTimeSchema.optional(),
    through: isoDateTimeSchema.optional(),
  })
  .strict()
  .refine(
    (query) => !query.from || !query.through || Date.parse(query.from) <= Date.parse(query.through),
    "The date range must be ordered.",
  );
export type FinanceActivityQuery = z.infer<typeof financeActivityQuerySchema>;
export const financeActivityPageSchema = z
  .object({
    entries: z.array(financeActivityEntrySchema).max(100),
    nextCursor: z.string().min(1).max(3000).nullable(),
    capabilities: z
      .object({
        financialActions: z.discriminatedUnion("state", [
          z
            .object({
              state: z.literal("unavailable"),
              reason: z.literal("mutation_evidence_not_integrated"),
            })
            .strict(),
          z
            .object({
              state: z.literal("available"),
              scope: z.literal("committed_candidate_effects"),
            })
            .strict(),
        ]),
        humanDecisions: z.object({ state: z.literal("available") }).strict(),
      })
      .strict(),
    coverage: z
      .object({
        state: z.literal("partial"),
        reasons: z
          .array(
            z.enum([
              "financial_mutation_evidence_not_integrated",
              "historical_decisions_without_causal_message_not_projected",
              "financial_actions_outside_committed_candidate_receipts_not_projected",
              "committed_receipts_with_incomplete_evidence_not_projected",
            ]),
          )
          .min(1)
          .max(4),
      })
      .strict(),
  })
  .strict();
export type FinanceActivityPage = z.infer<typeof financeActivityPageSchema>;
