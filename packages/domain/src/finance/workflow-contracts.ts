import { z } from "zod";
import { idSchema, isoDateTimeSchema } from "../common.js";

const revisionSchema = z.string().trim().min(1).max(200);
const centsSchema = z.number().int().safe();

export const financeRevisionRefSchema = z
  .object({ id: idSchema, revision: revisionSchema })
  .strict();
export type FinanceRevisionRef = z.infer<typeof financeRevisionRefSchema>;

/** Public evidence classifications only; never provider messages or private source text. */
export const financeMoneyFactReasonCodeSchema = z.enum([
  "dependency_unavailable",
  "source_unavailable",
  "stale_evidence",
  "incomplete_evidence",
  "pending_transactions",
  "unresolved_allocation",
  "unresolved_reimbursement",
  "missing_commitments",
  "missing_protection_policy",
  "unsupported_account_type",
]);
export type FinanceMoneyFactReasonCode = z.infer<typeof financeMoneyFactReasonCodeSchema>;

export const financeMoneyFactSchema = z
  .object({
    cents: centsSchema.nullable(),
    currency: z.literal("USD"),
    quality: z.enum(["verified", "qualified", "unavailable"]),
    reasons: z.array(financeMoneyFactReasonCodeSchema).max(20),
    sources: z.array(financeRevisionRefSchema).max(100),
  })
  .strict();
export type FinanceMoneyFact = z.infer<typeof financeMoneyFactSchema>;

export const financePositionEvidenceSchema = z
  .object({
    revision: revisionSchema,
    asOf: isoDateTimeSchema,
    scope: z
      .object({
        accountIds: z.array(idSchema).max(100),
        from: z.iso.date(),
        through: z.iso.date(),
      })
      .strict(),
    cash: financeMoneyFactSchema,
    postedSpend: financeMoneyFactSchema,
    pendingExposure: financeMoneyFactSchema,
    committed: financeMoneyFactSchema,
    protected: financeMoneyFactSchema,
    spendable: financeMoneyFactSchema,
    debt: financeMoneyFactSchema,
    investments: financeMoneyFactSchema,
    netWorth: financeMoneyFactSchema,
  })
  .strict();
export type FinancePositionEvidence = z.infer<typeof financePositionEvidenceSchema>;

export const financeHumanWorkRefSchema = financeRevisionRefSchema.extend({
  domain: z.literal("finances"),
  kind: z.enum(["question", "approval", "repair"]),
  actionRevision: revisionSchema,
});
export type FinanceHumanWorkRef = z.infer<typeof financeHumanWorkRefSchema>;

export const financeAnswerSchema = z
  .object({
    operationId: idSchema,
    work: financeHumanWorkRefSchema,
    text: z.string().trim().min(1).max(10_000),
    source: z
      .object({
        kind: z.enum(["app", "agent", "sms"]),
        messageId: z.string().trim().min(1).max(200).nullable(),
      })
      .strict(),
  })
  .strict();
export type FinanceAnswer = z.infer<typeof financeAnswerSchema>;

/** Internal command only: local provenance identities do not themselves confer authority. */
export const financeSmsAnswerCommandSchema = z
  .object({
    operationId: idSchema.toLowerCase(),
    work: financeHumanWorkRefSchema.extend({ id: idSchema.toLowerCase() }),
    text: financeAnswerSchema.shape.text,
    inboundMessageId: idSchema.toLowerCase(),
    replyBindingId: idSchema.toLowerCase(),
  })
  .strict();
export type FinanceSmsAnswerCommand = z.infer<typeof financeSmsAnswerCommandSchema>;

export const financeContextSchema = z
  .object({
    id: idSchema,
    revision: revisionSchema,
    text: z.string().trim().min(1).max(10_000),
    validFrom: isoDateTimeSchema.nullable(),
    validThrough: isoDateTimeSchema.nullable(),
    participants: z.array(z.string().trim().min(1).max(200)).max(50),
    categoryId: idSchema.nullable(),
    paymentChannel: z.string().trim().min(1).max(100).nullable(),
    expectedCents: centsSchema.nullable(),
    transactionIds: z.array(idSchema).max(500),
    source: financeRevisionRefSchema,
    status: z.enum(["active", "partially_matched", "matched", "disputed", "expired", "cancelled"]),
  })
  .strict();
export type FinanceContext = z.infer<typeof financeContextSchema>;

export const financeOutcomeReasonCodeSchema = z.enum([
  "blocked_by_policy",
  "dependency_unavailable",
  "dispatch_uncertain",
  "host_unavailable",
  "operation_replayed",
  "permission_denied",
  "producer_not_registered",
  "stale_revision",
]);
export type FinanceOutcomeReasonCode = z.infer<typeof financeOutcomeReasonCodeSchema>;

export const financeDomainOutcomeSchema = z
  .object({
    operationId: idSchema,
    state: z.enum([
      "applied",
      "accepted",
      "pending",
      "uncertain",
      "needs_input",
      "pending_review",
      "blocked",
      "failed",
      "unavailable",
    ]),
    work: z.array(financeHumanWorkRefSchema).max(100),
    resultRevision: revisionSchema.nullable(),
    reasonCode: financeOutcomeReasonCodeSchema.nullable(),
  })
  .strict();
export type FinanceDomainOutcome = z.infer<typeof financeDomainOutcomeSchema>;

export const financeContinuationRequestSchema = z
  .object({
    id: idSchema,
    connectionId: idSchema,
    runId: idSchema.nullable(),
    inboundMessageId: z.string().trim().min(1).max(200),
    work: z.array(financeHumanWorkRefSchema).min(1).max(100),
  })
  .strict();
export type FinanceContinuationRequest = z.infer<typeof financeContinuationRequestSchema>;

export const financeWorkflowPortNames = [
  "readPosition",
  "captureContext",
  "answerWork",
  "evaluateBudget",
  "publishNotification",
  "requestContinuation",
  "resumeFinance",
] as const;
export const financeWorkflowPortNameSchema = z.enum(financeWorkflowPortNames);
export type FinanceWorkflowPortName = z.infer<typeof financeWorkflowPortNameSchema>;

const financeWorkflowRouteSchema = z
  .object({
    method: z.enum(["GET", "POST", "PATCH"]),
    path: z.string().startsWith("/v1/").max(200),
  })
  .strict();

export const financeWorkflowPortRegistrationSchema = z.discriminatedUnion("state", [
  z
    .object({
      port: financeWorkflowPortNameSchema,
      state: z.literal("available"),
      producer: z.string().trim().min(1).max(100),
      route: financeWorkflowRouteSchema,
    })
    .strict(),
  z
    .object({
      port: financeWorkflowPortNameSchema,
      state: z.literal("unavailable"),
      reasonCode: z.literal("producer_not_registered"),
      producer: z.null(),
      route: z.null(),
    })
    .strict(),
]);
export type FinanceWorkflowPortRegistration = z.infer<typeof financeWorkflowPortRegistrationSchema>;

export const financeWorkflowPortManifest = financeWorkflowPortNames.map((port) =>
  financeWorkflowPortRegistrationSchema.parse(
    port === "resumeFinance"
      ? {
          port,
          state: "available",
          producer: "finances",
          route: { method: "POST", path: "/v1/finances/maintenance" },
        }
      : {
          port,
          state: "unavailable",
          reasonCode: "producer_not_registered",
          producer: null,
          route: null,
        },
  ),
);

export const financeWorkflowUnavailableSchema = z
  .object({
    state: z.literal("unavailable"),
    reasonCode: financeOutcomeReasonCodeSchema,
    retryable: z.boolean(),
  })
  .strict();
export type FinanceWorkflowUnavailable = z.infer<typeof financeWorkflowUnavailableSchema>;

/** Producer adapters must validate their boundary result before exposing it to another domain. */
export function financeWorkflowPortResultSchema<T extends z.ZodType>(payload: T) {
  return z.discriminatedUnion("state", [
    z.object({ state: z.literal("available"), value: payload }).strict(),
    financeWorkflowUnavailableSchema,
  ]);
}

// Short aliases match the architecture contract while the Finance prefix keeps root exports clear.
export const revisionRefSchema = financeRevisionRefSchema;
export type RevisionRef = FinanceRevisionRef;
export const moneyFactSchema = financeMoneyFactSchema;
export type MoneyFact = FinanceMoneyFact;
export const positionEvidenceSchema = financePositionEvidenceSchema;
export type PositionEvidence = FinancePositionEvidence;
export const humanWorkRefSchema = financeHumanWorkRefSchema;
export type HumanWorkRef = FinanceHumanWorkRef;
export const domainOutcomeSchema = financeDomainOutcomeSchema;
export type DomainOutcome = FinanceDomainOutcome;
export const continuationRequestSchema = financeContinuationRequestSchema;
export type ContinuationRequest = FinanceContinuationRequest;
