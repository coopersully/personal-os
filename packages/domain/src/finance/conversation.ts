import { z } from "zod";
import { idSchema, isoDateTimeSchema } from "../common.js";

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
      nonce: z.string().min(1).max(256),
    })
    .strict(),
  z
    .object({
      kind: z.literal("respond"),
      challengeId: idSchema,
      response: z.string().trim().min(1).max(1000),
    })
    .strict(),
]);
export type FinanceConversationProofOperation = z.infer<
  typeof financeConversationProofOperationSchema
>;
export const financeConversationChallengeSchema = z
  .object({
    challengeId: idSchema,
    nonce: z.string().min(1).max(256),
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
    nonce: z.string().max(256).optional(),
  })
  .strict();
export type FinanceConversationProofResult = z.infer<typeof financeConversationProofResultSchema>;
