import { z } from "zod";
import { automationHostTriggerSchema } from "../automation-host-continuation.js";
import { idSchema, isoDateTimeSchema } from "../common.js";
import { maintenanceRunStatusSchema } from "../maintenance.js";

/** Decimal strings preserve PostgreSQL bigint sequences across JSON clients. */
export const financeConversationSequenceSchema = z
  .string()
  .max(19)
  .regex(/^(0|[1-9][0-9]*)$/u)
  .refine(
    (value) => value.length < 19 || value <= "9223372036854775807",
    "Sequence exceeds PostgreSQL bigint range.",
  );
export const FINANCE_CONVERSATION_PROTOCOL_VERSION = "1";

export const financeConversationReadinessSchema = z
  .object({
    historyReadable: z.literal(true),
    registrationState: z.enum(["missing", "active", "paused", "revoked"]),
    connectionState: z.enum(["missing", "live", "disconnected", "revoked"]),
    messageProtocolVersion: z.string().min(1).max(100),
    messageCapability: z.enum(["unverified", "verified", "expired", "protocol_upgrade_required"]),
    canSend: z.boolean(),
    /** The server-selected host; older clients may omit this additive projection. */
    host: z
      .object({
        scheduleId: idSchema,
        connectionId: idSchema,
        label: z.string().min(1).max(100),
        trigger: automationHostTriggerSchema,
        nextExpectedAt: isoDateTimeSchema.nullable(),
        latestRun: z
          .object({
            id: idSchema,
            status: maintenanceRunStatusSchema,
            updatedAt: isoDateTimeSchema,
            failureMessage: z.string().max(1000).nullable().optional(),
          })
          .strict()
          .nullable(),
      })
      .strict()
      .optional(),
    reason: z.enum([
      "ready",
      "registration_missing",
      "registration_paused",
      "registration_revoked",
      "connection_missing",
      "connection_disconnected",
      "connection_revoked",
      "message_protocol_unavailable",
      "challenge_required",
      "challenge_expired",
      "protocol_upgrade_required",
      "execution_not_authorized",
    ]),
    recovery: z.enum([
      "none",
      "register_host",
      "resume_registration",
      "reconnect",
      "verify_message_protocol",
      "authorize_execution",
    ]),
  })
  .strict();
export type FinanceConversationReadiness = z.infer<typeof financeConversationReadinessSchema>;

export const financeConversationRecordReferenceSchema = z
  .object({
    kind: z.enum(["transaction", "account", "review_case", "contextual_question"]),
    id: idSchema,
  })
  .strict();
export const financeConversationMessageSchema = z
  .object({
    id: idSchema,
    sequence: financeConversationSequenceSchema,
    authorKind: z.enum(["user", "agent"]),
    text: z.string().trim().min(1).max(10_000),
    caseId: idSchema.nullable(),
    recordRefs: z.array(financeConversationRecordReferenceSchema).max(100),
    runId: idSchema.nullable(),
    sourceMessageIds: z.array(idSchema).max(100),
    smsProvenance: z
      .object({
        claimId: idSchema,
        inboundMessageId: idSchema,
        contextId: idSchema,
        contextRevision: z.string().regex(/^[1-9][0-9]*$/u),
      })
      .strict()
      .optional(),
    createdAt: isoDateTimeSchema,
  })
  .strict();
export type FinanceConversationMessage = z.infer<typeof financeConversationMessageSchema>;
export const financeConversationSendInputSchema = z
  .object({
    text: z.string().trim().min(1).max(10_000),
    idempotencyKey: z.string().trim().min(1).max(200),
    caseId: idSchema.nullable().default(null),
    recordRefs: z.array(financeConversationRecordReferenceSchema).max(100).default([]),
  })
  .strict();
export type FinanceConversationSendInput = z.infer<typeof financeConversationSendInputSchema>;
export const financeConversationBatchSchema = z
  .object({
    runId: idSchema,
    automationScheduleId: idSchema.nullable(),
    authorizationConnectionId: idSchema.nullable(),
    cutoffSequence: financeConversationSequenceSchema,
    capturedAt: isoDateTimeSchema,
  })
  .strict();
export type FinanceConversationBatch = z.infer<typeof financeConversationBatchSchema>;
export const financeConversationBatchPageSchema = z
  .object({
    batch: financeConversationBatchSchema,
    messages: z.array(financeConversationMessageSchema).max(100),
    nextCursor: z.string().min(1).max(2000).nullable(),
  })
  .strict();
export type FinanceConversationBatchPage = z.infer<typeof financeConversationBatchPageSchema>;

/** This projection accepts verified server state only, never host self-report fields. */
export function projectFinanceConversationReadiness(input: {
  registrationState: FinanceConversationReadiness["registrationState"];
  connectionState: FinanceConversationReadiness["connectionState"];
  messageCapability: FinanceConversationReadiness["messageCapability"];
  messageProtocolVersion?: string;
  executionAuthorized: boolean;
}): FinanceConversationReadiness {
  const { executionAuthorized, ...state } = input;
  const base = {
    ...state,
    historyReadable: true as const,
    messageProtocolVersion: input.messageProtocolVersion ?? FINANCE_CONVERSATION_PROTOCOL_VERSION,
  };
  const blocked = (
    reason: FinanceConversationReadiness["reason"],
    recovery: FinanceConversationReadiness["recovery"],
  ): FinanceConversationReadiness => ({ ...base, canSend: false, reason, recovery });
  if (input.registrationState === "missing")
    return blocked("registration_missing", "register_host");
  if (input.registrationState === "paused")
    return blocked("registration_paused", "resume_registration");
  if (input.registrationState === "revoked")
    return blocked("registration_revoked", "register_host");
  if (input.connectionState === "missing") return blocked("connection_missing", "reconnect");
  if (input.connectionState === "disconnected")
    return blocked("connection_disconnected", "reconnect");
  if (input.connectionState === "revoked") return blocked("connection_revoked", "reconnect");
  if (!executionAuthorized) return blocked("execution_not_authorized", "authorize_execution");
  if (input.messageCapability === "expired")
    return blocked("challenge_expired", "verify_message_protocol");
  if (input.messageCapability === "protocol_upgrade_required")
    return blocked("protocol_upgrade_required", "verify_message_protocol");
  if (input.messageCapability !== "verified")
    return blocked("challenge_required", "verify_message_protocol");
  return { ...base, canSend: true, reason: "ready", recovery: "none" };
}

export const financeConversationHistoryPageSchema = z
  .object({
    messages: z.array(financeConversationMessageSchema).max(100),
    nextCursor: financeConversationSequenceSchema.nullable(),
  })
  .strict();
export type FinanceConversationHistoryPage = z.infer<typeof financeConversationHistoryPageSchema>;
export const financeConversationRenderedInputSchema = z
  .object({ throughSequence: financeConversationSequenceSchema })
  .strict();
export const financeConversationAcknowledgmentInputSchema = z
  .object({ messageIds: z.array(idSchema).max(100) })
  .strict();
export type FinanceConversationAcknowledgmentInput = z.infer<
  typeof financeConversationAcknowledgmentInputSchema
>;
export const financeConversationReplyInputSchema = z
  .object({
    text: z.string().trim().min(1).max(10_000),
    idempotencyKey: z.string().trim().min(1).max(200),
    caseId: idSchema.nullable().default(null),
    sourceMessageIds: z.array(idSchema).min(1).max(100),
  })
  .strict();
export type FinanceConversationReplyInput = z.infer<typeof financeConversationReplyInputSchema>;
export const financeConversationProofOperationSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("fetch") }).strict(),
  z
    .object({
      kind: z.literal("acknowledge"),
      challengeId: idSchema,
      nonce: z
        .string()
        .min(1)
        .max(256)
        .refine((value) => value.length <= 256, "Nonce exceeds the length limit."),
    })
    .strict(),
  z
    .object({
      kind: z.literal("respond"),
      challengeId: idSchema,
      response: z
        .string()
        .trim()
        .min(1)
        .max(1000)
        .refine((value) => value.length <= 1000, "Response exceeds the length limit."),
    })
    .strict(),
]);
export type FinanceConversationProofOperation = z.infer<
  typeof financeConversationProofOperationSchema
>;
export const financeConversationChallengeSchema = z
  .object({
    challengeId: idSchema,
    nonce: z
      .string()
      .min(1)
      .max(256)
      .refine((value) => value.length <= 256, "Nonce exceeds the length limit."),
    protocolVersion: z.string().min(1).max(100),
    expiresAt: isoDateTimeSchema,
  })
  .strict();
export type FinanceConversationChallenge = z.infer<typeof financeConversationChallengeSchema>;
export const financeConversationProofResultSchema = z
  .object({
    challengeId: idSchema,
    protocolVersion: z.string().min(1).max(100),
    verified: z.boolean(),
    nonce: z
      .string()
      .max(256)
      .refine((value) => value.length <= 256, "Nonce exceeds the length limit.")
      .optional(),
  })
  .strict();
export type FinanceConversationProofResult = z.infer<typeof financeConversationProofResultSchema>;

/** This is a causal claim, never approval or financial execution authority. */
export const financeConversationCausalClaimSchema = z
  .object({
    sourceMessageIds: z
      .array(idSchema)
      .min(1)
      .max(100)
      .refine((ids) => new Set(ids).size === ids.length, "Source message IDs must be unique."),
    explanation: z.string().trim().min(1).max(4000),
  })
  .strict();
export type FinanceConversationCausalClaim = z.infer<typeof financeConversationCausalClaimSchema>;
export const financeConversationEffectReceiptSchema = z
  .object({
    id: idSchema,
    runId: idSchema,
    candidateId: idSchema,
    candidateRevision: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
    automationScheduleId: idSchema.nullable(),
    authorizationConnectionId: idSchema.nullable(),
    committedAt: isoDateTimeSchema,
    requestId: z.string().min(1).max(1000),
    originRequestId: z.string().min(1).max(1000),
    actor: z.object({ type: z.enum(["user", "agent"]), id: z.string().min(1).max(240) }).strict(),
    authorityBasis: z.enum([
      "original_live_grant",
      "authenticated_owner",
      "legacy_unbound_context",
    ]),
    humanApproval: z.object({ actorId: idSchema, reviewId: idSchema }).strict().nullable(),
    sourceMessageIds: z.array(idSchema).max(100),
    explanation: z.string().min(1).max(4000),
    auditEventIds: z.array(idSchema).max(10000),
    recordRefs: z
      .array(z.object({ kind: z.string().min(1).max(100), id: idSchema }).strict())
      .max(10000),
    outcome: z.literal("committed"),
    actionFamilies: z.array(z.string().min(1).max(100)).max(100),
    status: z.enum(["applied", "no_changes"]),
    significance: z.enum(["routine", "budget_decision"]),
  })
  .strict();
export type FinanceConversationEffectReceipt = z.infer<
  typeof financeConversationEffectReceiptSchema
>;
export const financeConversationEvidenceReadInputSchema = z
  .object({
    candidateId: idSchema,
    candidateRevision: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
    cursor: z.string().min(1).max(3000).optional(),
  })
  .strict();
export type FinanceConversationEvidenceReadInput = z.infer<
  typeof financeConversationEvidenceReadInputSchema
>;
export const financeConversationEvidenceReadResultSchema = z.discriminatedUnion("state", [
  z
    .object({
      state: z.literal("available"),
      receipt: financeConversationEffectReceiptSchema.extend({
        auditEventIds: z.array(idSchema).max(100),
        recordRefs: z
          .array(z.object({ kind: z.string().min(1).max(100), id: idSchema }).strict())
          .max(100),
      }),
      nextCursor: z.string().max(3000).nullable(),
    })
    .strict(),
  z
    .object({
      state: z.literal("unavailable"),
      reason: z.enum([
        "run_has_no_original_host",
        "no_committed_effect_receipt",
        "original_run_binding_changed",
      ]),
    })
    .strict(),
]);
export type FinanceConversationEvidenceReadResult = z.infer<
  typeof financeConversationEvidenceReadResultSchema
>;
