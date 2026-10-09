import { z } from "zod";
import { idSchema, isoDateTimeSchema } from "../common.js";
import { financeReviewReasonSchema } from "./inbox.js";

const revisionSchema = z.string().trim().min(1).max(200);
const centsSchema = z.number().int().safe();
const financeLifecycleIdSchema = idSchema.toLowerCase();
const positiveInt64RevisionSchema = z
  .string()
  .regex(/^[1-9]\d{0,18}$/)
  .refine((value) => value.length < 19 || value <= "9223372036854775807", {
    message: "Revision exceeds the positive bigint range.",
  });

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

export const financePositionFactNames = [
  "cash",
  "postedSpend",
  "pendingExposure",
  "committed",
  "protected",
  "spendable",
  "debt",
  "investments",
  "netWorth",
] as const;

const financePositionFactCheckpointSchema = financeMoneyFactSchema
  .pick({ quality: true, reasons: true })
  .strict();

const financeBudgetCheckpointReasonSchema = z.enum([
  "stale_revision",
  "missing_evidence",
  "position_unavailable",
  "position_unqualified",
  "usage_unavailable",
  "scope_mismatch",
  "policy_disabled",
  "policy_expired",
  "policy_unknown",
  "outside_period",
  "resource_changed",
  "allocation_identity_changed",
  "unbalanced_plan",
  "direction_not_permitted",
  "protected_release",
  "protection_floor",
  "per_change_cap",
  "monthly_cap",
  "amount_overflow",
]);

/** Safe durable identity for the exact canonical position evidence consumed by a workflow. */
export const financePositionEvidenceCheckpointSchema = z
  .object({
    revision: revisionSchema,
    scope: financePositionEvidenceSchema.shape.scope,
    facts: z
      .object({
        cash: financePositionFactCheckpointSchema,
        postedSpend: financePositionFactCheckpointSchema,
        pendingExposure: financePositionFactCheckpointSchema,
        committed: financePositionFactCheckpointSchema,
        protected: financePositionFactCheckpointSchema,
        spendable: financePositionFactCheckpointSchema,
        debt: financePositionFactCheckpointSchema,
        investments: financePositionFactCheckpointSchema,
        netWorth: financePositionFactCheckpointSchema,
      })
      .strict(),
  })
  .strict();
export type FinancePositionEvidenceCheckpoint = z.infer<
  typeof financePositionEvidenceCheckpointSchema
>;

/** Safe durable identity and decision metadata for maintenance-owned budget evaluation. */
export const financeBudgetEvaluationCheckpointSchema = z
  .object({
    positionRevision: revisionSchema,
    state: z.enum(["not_applicable", "evaluated", "unavailable"]),
    reasonCode: z.enum(["dependency_unavailable", "proposal_limit_exceeded"]).nullable(),
    evaluations: z
      .array(
        z
          .object({
            proposal: financeRevisionRefSchema,
            policy: financeRevisionRefSchema,
            plan: financeRevisionRefSchema,
            outcome: z.enum(["denied", "hypothetical_preview"]),
            reasons: z.array(financeBudgetCheckpointReasonSchema).max(20),
            executionAvailable: z.literal(false),
            executionUnavailableReasons: z.tuple([
              z.literal("authority_not_wired"),
              z.literal("position_commit_fence_not_wired"),
            ]),
          })
          .strict(),
      )
      .max(100),
  })
  .strict()
  .superRefine((checkpoint, context) => {
    if (checkpoint.state === "evaluated" && checkpoint.evaluations.length === 0)
      context.addIssue({ code: "custom", message: "Evaluated checkpoints require a result." });
    if (checkpoint.state !== "evaluated" && checkpoint.evaluations.length > 0)
      context.addIssue({ code: "custom", message: "Only evaluated checkpoints contain results." });
    if ((checkpoint.state === "unavailable") !== (checkpoint.reasonCode !== null))
      context.addIssue({ code: "custom", message: "Unavailable checkpoints require one reason." });
  });
export type FinanceBudgetEvaluationCheckpoint = z.infer<
  typeof financeBudgetEvaluationCheckpointSchema
>;

export const financePositionReadScopeSchema = z
  .object({
    accountIds: z.array(idSchema).max(100).optional(),
    from: z.iso.date(),
    through: z.iso.date(),
  })
  .strict()
  .refine(({ from, through }) => from <= through, {
    message: "Position scope dates are reversed.",
    path: ["through"],
  });
export type FinancePositionReadScope = z.infer<typeof financePositionReadScopeSchema>;

export const financeHumanWorkRefSchema = financeRevisionRefSchema.extend({
  domain: z.literal("finances"),
  kind: z.enum(["question", "approval", "repair"]),
  actionRevision: revisionSchema,
});
export type FinanceHumanWorkRef = z.infer<typeof financeHumanWorkRefSchema>;

/** A canonical Finance Inbox question target before a request revision is issued. */
export const financeReviewQuestionTargetSchema = z
  .object({
    id: financeLifecycleIdSchema,
    domain: z.literal("finances"),
    kind: z.literal("question"),
    revision: positiveInt64RevisionSchema,
  })
  .strict();
export type FinanceReviewQuestionTarget = z.infer<typeof financeReviewQuestionTargetSchema>;

/**
 * The only maintenance review action that free-form SMS may answer. Presentation and evidence
 * are deliberately absent, as are approval and repair authority.
 */
export const financeReviewHumanActionSchema = z
  .object({
    version: z.literal(1),
    kind: z.literal("question"),
    answerMode: z.literal("free_text"),
    purpose: z.literal("maintenance_clarification"),
  })
  .strict();
export type FinanceReviewHumanAction = z.infer<typeof financeReviewHumanActionSchema>;

/**
 * Durable semantic authority for a review request. Incidental evidence revisions and display
 * wording are excluded so rediscovery cannot create another request. Reimbursement questions
 * continue to identify their durable transaction subject; this contract never invents a
 * reimbursement entity identity.
 */
export const financeReviewActionBasisSchema = z
  .object({
    subject: z.object({ kind: z.literal("transaction"), id: financeLifecycleIdSchema }).strict(),
    source: z
      .object({ kind: z.literal("finance_review_case"), id: financeLifecycleIdSchema })
      .strict(),
    reason: financeReviewReasonSchema,
    consequence: z
      .object({
        kind: z.literal("resume_finance_maintenance"),
        target: z.literal("same_review_case"),
      })
      .strict(),
  })
  .strict();
export type FinanceReviewActionBasis = z.infer<typeof financeReviewActionBasisSchema>;

export const financeReviewActionCandidateSchema = z
  .object({
    action: financeReviewHumanActionSchema,
    basis: financeReviewActionBasisSchema,
    work: financeReviewQuestionTargetSchema,
  })
  .strict()
  .refine((candidate) => candidate.work.id === candidate.basis.source.id, {
    message: "The question target must identify the authoritative Finance review case.",
    path: ["work", "id"],
  })
  .refine((candidate) => candidate.basis.subject.id !== candidate.basis.source.id, {
    message: "Transaction subject and Finance review case identities must be distinct.",
    path: ["basis", "subject", "id"],
  });
export type FinanceReviewActionCandidate = z.infer<typeof financeReviewActionCandidateSchema>;

export const financeReviewActionRequestSchema = financeReviewActionCandidateSchema
  .safeExtend({
    authorityOperationId: financeLifecycleIdSchema,
    requestId: financeLifecycleIdSchema,
    work: financeReviewQuestionTargetSchema.safeExtend({
      actionRevision: positiveInt64RevisionSchema,
    }),
  })
  .refine((request) => request.work.id === request.basis.source.id, {
    message: "The question request must identify the authoritative Finance review case.",
    path: ["work", "id"],
  })
  .refine((request) => request.authorityOperationId !== request.requestId, {
    message: "Authority operation and request identities must be distinct.",
    path: ["authorityOperationId"],
  })
  .superRefine((request, context) => {
    const roles = [request.basis.subject.id, request.basis.source.id];
    if (roles.includes(request.requestId) || roles.includes(request.authorityOperationId))
      context.addIssue({
        code: "custom",
        message: "Request identities must be distinct from subject and review-case identities.",
      });
  });
export type FinanceReviewActionRequest = z.infer<typeof financeReviewActionRequestSchema>;

const financeReviewActionTerminalStateSchema = z
  .object({
    request: financeReviewActionRequestSchema,
    state: z.enum(["consumed", "withdrawn"]),
    terminal: z
      .object({
        requestId: financeLifecycleIdSchema,
        operationId: financeLifecycleIdSchema,
      })
      .strict(),
  })
  .strict()
  .refine((value) => value.terminal.requestId === value.request.requestId, {
    message: "The terminal operation must identify the retained request.",
    path: ["terminal", "requestId"],
  })
  .refine((value) => value.terminal.operationId !== value.request.requestId, {
    message: "Terminal operation and request identities must be distinct.",
    path: ["terminal", "operationId"],
  })
  .refine((value) => value.terminal.operationId !== value.request.authorityOperationId, {
    message: "Terminal and authority operation identities must be distinct.",
    path: ["terminal", "operationId"],
  })
  .superRefine((value, context) => {
    if (
      value.terminal.operationId === value.request.basis.subject.id ||
      value.terminal.operationId === value.request.basis.source.id
    )
      context.addIssue({
        code: "custom",
        message: "Terminal operation must be distinct from subject and review-case identities.",
      });
  });

/** Terminal states retain the exact request identity; consumption never collapses to absence. */
export const financeReviewActionStateSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("absent") }).strict(),
  z.object({ state: z.literal("open"), request: financeReviewActionRequestSchema }).strict(),
  financeReviewActionTerminalStateSchema,
]);
export type FinanceReviewActionState = z.infer<typeof financeReviewActionStateSchema>;

const financeReviewActionTransitionInputSchema = z
  .object({
    current: financeReviewActionStateSchema,
    desired: financeReviewActionCandidateSchema.nullable(),
    intent: z.enum(["observe", "reissue"]),
  })
  .strict();

const financeReviewActionPreserveSchema = z
  .object({ decision: z.literal("preserve"), current: financeReviewActionStateSchema })
  .strict();
const financeReviewActionNeedsIssueSchema = z
  .object({
    decision: z.literal("needs_issue"),
    desired: financeReviewActionCandidateSchema,
    prior: financeReviewActionStateSchema,
    cause: z.enum(["initial", "basis_changed", "explicit_reissue"]),
  })
  .strict()
  .superRefine((decision, context) => {
    if ((decision.prior.state === "absent") !== (decision.cause === "initial"))
      context.addIssue({
        code: "custom",
        message: "Only an absent prior state permits initial issuance.",
      });
    if (decision.prior.state === "open" && decision.cause !== "basis_changed")
      context.addIssue({
        code: "custom",
        message: "An open request can be replaced only when its authoritative basis changed.",
      });
    if (decision.cause === "explicit_reissue" && decision.prior.state === "open")
      context.addIssue({ code: "custom", message: "Only a terminal request may be reissued." });
  });
const financeReviewActionNeedsWithdrawSchema = z
  .object({ decision: z.literal("needs_withdraw"), request: financeReviewActionRequestSchema })
  .strict();
const financeReviewActionRejectedSchema = z
  .object({
    decision: z.literal("rejected"),
    reason: z.enum([
      "invalid_transition",
      "malformed_input",
      "request_identity_reused",
      "stale_request",
      "action_revision_mismatch",
      "action_revision_overflow",
    ]),
  })
  .strict();

export const financeReviewActionTransitionDecisionSchema = z.discriminatedUnion("decision", [
  financeReviewActionPreserveSchema,
  financeReviewActionNeedsIssueSchema,
  financeReviewActionNeedsWithdrawSchema,
  financeReviewActionRejectedSchema,
]);
export type FinanceReviewActionTransitionDecision = z.infer<
  typeof financeReviewActionTransitionDecisionSchema
>;

function sameReviewActionMeaning(
  left: FinanceReviewActionCandidate,
  right: FinanceReviewActionCandidate,
) {
  return (
    left.action.version === right.action.version &&
    left.action.kind === right.action.kind &&
    left.action.answerMode === right.action.answerMode &&
    left.action.purpose === right.action.purpose &&
    left.basis.subject.kind === right.basis.subject.kind &&
    left.basis.subject.id === right.basis.subject.id &&
    left.basis.source.kind === right.basis.source.kind &&
    left.basis.source.id === right.basis.source.id &&
    left.basis.reason === right.basis.reason &&
    left.basis.consequence.kind === right.basis.consequence.kind &&
    left.basis.consequence.target === right.basis.consequence.target &&
    left.work.id === right.work.id
  );
}

function requestCandidate(request: FinanceReviewActionRequest): FinanceReviewActionCandidate {
  return financeReviewActionCandidateSchema.parse({
    action: request.action,
    basis: request.basis,
    work: {
      id: request.work.id,
      domain: request.work.domain,
      kind: request.work.kind,
      revision: request.work.revision,
    },
  });
}

function sameReviewCase(
  request: FinanceReviewActionRequest,
  candidate: FinanceReviewActionCandidate,
) {
  return (
    request.work.id === candidate.work.id && request.basis.source.id === candidate.basis.source.id
  );
}

function reviewRoleIdentities(candidate: FinanceReviewActionCandidate) {
  return [candidate.basis.subject.id, candidate.basis.source.id];
}

function compareReviewWorkRevision(
  request: FinanceReviewActionRequest,
  candidate: FinanceReviewActionCandidate,
) {
  const prior = BigInt(request.work.revision);
  const desired = BigInt(candidate.work.revision);
  return desired < prior ? -1 : desired > prior ? 1 : 0;
}

/**
 * Decides whether durable state should be preserved or needs a later atomic write. This pure
 * decision does not admit an operation, prove historical request-ID uniqueness, or perform CAS.
 */
export function decideFinanceReviewActionTransition(
  input: unknown,
): FinanceReviewActionTransitionDecision {
  const parsed = financeReviewActionTransitionInputSchema.safeParse(input);
  if (!parsed.success) return { decision: "rejected", reason: "malformed_input" };
  const { current, desired, intent } = parsed.data;

  if (intent === "reissue" && (desired === null || current.state === "absent"))
    return { decision: "rejected", reason: "invalid_transition" };
  if (desired === null) {
    return current.state === "open"
      ? { decision: "needs_withdraw", request: current.request }
      : { decision: "preserve", current };
  }
  if (current.state === "absent") {
    return {
      decision: "needs_issue",
      desired,
      prior: current,
      cause: "initial",
    };
  }

  if (!sameReviewCase(current.request, desired))
    return { decision: "rejected", reason: "invalid_transition" };

  const sameMeaning = sameReviewActionMeaning(requestCandidate(current.request), desired);
  const revisionOrder = compareReviewWorkRevision(current.request, desired);
  if (revisionOrder < 0 || (!sameMeaning && revisionOrder === 0))
    return { decision: "rejected", reason: "invalid_transition" };
  if (sameMeaning && intent === "observe") return { decision: "preserve", current };
  if (sameMeaning && current.state === "open")
    return { decision: "rejected", reason: "invalid_transition" };
  return {
    decision: "needs_issue",
    desired,
    prior: current,
    cause: sameMeaning ? "explicit_reissue" : "basis_changed",
  };
}

const financeReviewActionIssueInputSchema = z
  .object({
    decision: financeReviewActionNeedsIssueSchema,
    authorityOperationId: financeLifecycleIdSchema,
    requestId: financeLifecycleIdSchema,
    retirementOperationId: financeLifecycleIdSchema.nullable(),
    actionRevision: positiveInt64RevisionSchema,
  })
  .strict()
  .superRefine((input, context) => {
    const requiresRetirement = input.decision.prior.state === "open";
    if (requiresRetirement !== (input.retirementOperationId !== null))
      context.addIssue({
        code: "custom",
        message: "Only an open replacement requires a retirement operation.",
      });
    const newIdentities = [
      input.requestId,
      input.authorityOperationId,
      ...(input.retirementOperationId === null ? [] : [input.retirementOperationId]),
    ];
    if (new Set(newIdentities).size !== newIdentities.length)
      context.addIssue({ code: "custom", message: "New lifecycle identities must be distinct." });
    const prior = input.decision.prior;
    const priorIdentities =
      prior.state === "absent"
        ? []
        : [
            prior.request.requestId,
            prior.request.authorityOperationId,
            ...(prior.state === "consumed" || prior.state === "withdrawn"
              ? [prior.terminal.operationId]
              : []),
          ];
    const roleIdentities = [
      ...reviewRoleIdentities(input.decision.desired),
      ...(prior.state === "absent" ? [] : reviewRoleIdentities(prior.request)),
    ];
    if (
      [...newIdentities, ...priorIdentities].some((identity) => roleIdentities.includes(identity))
    )
      context.addIssue({
        code: "custom",
        message: "Lifecycle identities must be distinct from subject and review-case identities.",
      });
  });

const financeReviewActionIssueSuccessSchema = z
  .object({
    decision: z.literal("issue"),
    request: financeReviewActionRequestSchema,
    previous: financeReviewActionStateSchema,
  })
  .strict()
  .superRefine((result, context) => {
    const prior = result.previous.state === "absent" ? null : result.previous.request;
    const roleIdentities = [
      ...reviewRoleIdentities(result.request),
      ...(prior === null ? [] : reviewRoleIdentities(prior)),
    ];
    const lifecycleIdentities = [
      result.request.requestId,
      result.request.authorityOperationId,
      ...(prior === null
        ? []
        : [
            prior.requestId,
            prior.authorityOperationId,
            ...(result.previous.state === "consumed" || result.previous.state === "withdrawn"
              ? [result.previous.terminal.operationId]
              : []),
          ]),
    ];
    if (lifecycleIdentities.some((identity) => roleIdentities.includes(identity)))
      context.addIssue({
        code: "custom",
        message: "Lifecycle identities must be distinct from subject and review-case identities.",
      });
    if (result.previous.state === "open") {
      context.addIssue({ code: "custom", message: "Issued results cannot retain an open prior." });
      return;
    }
    if (result.previous.state === "absent") {
      if (result.request.work.actionRevision !== "1")
        context.addIssue({ code: "custom", message: "Initial issuance starts at revision one." });
      return;
    }

    const priorRequest = result.previous.request;
    if (!sameReviewCase(priorRequest, result.request))
      context.addIssue({ code: "custom", message: "Issuance cannot cross a Finance review case." });
    const nextActionRevision = BigInt(priorRequest.work.actionRevision) + 1n;
    if (
      nextActionRevision > 9_223_372_036_854_775_807n ||
      result.request.work.actionRevision !== nextActionRevision.toString()
    )
      context.addIssue({ code: "custom", message: "Action revision must increment exactly once." });
    const sameMeaning = sameReviewActionMeaning(requestCandidate(priorRequest), result.request);
    const workRevisionOrder = compareReviewWorkRevision(priorRequest, result.request);
    if (workRevisionOrder < 0 || (!sameMeaning && workRevisionOrder === 0))
      context.addIssue({ code: "custom", message: "Review work revision is not monotonic." });
    const retainedIdentities = [
      priorRequest.requestId,
      priorRequest.authorityOperationId,
      result.previous.terminal.operationId,
    ];
    if (
      retainedIdentities.includes(result.request.requestId) ||
      retainedIdentities.includes(result.request.authorityOperationId)
    )
      context.addIssue({
        code: "custom",
        message: "Issued identities cannot reuse a retained prior identity.",
      });
  });

export const financeReviewActionIssueResultSchema = z.union([
  financeReviewActionIssueSuccessSchema,
  financeReviewActionRejectedSchema,
]);
export type FinanceReviewActionIssueResult = z.infer<typeof financeReviewActionIssueResultSchema>;

/**
 * Builds an issuance only after a caller persists the returned replacement atomically. A future
 * immutable ledger must prove all-history uniqueness for both issued identities.
 */
export function issueFinanceReviewAction(input: unknown): FinanceReviewActionIssueResult {
  const parsed = financeReviewActionIssueInputSchema.safeParse(input);
  if (!parsed.success) return { decision: "rejected", reason: "malformed_input" };
  const { decision, authorityOperationId, requestId, retirementOperationId, actionRevision } =
    parsed.data;
  const priorRequest = decision.prior.state === "absent" ? null : decision.prior.request;
  const priorIdentities =
    priorRequest === null
      ? []
      : [
          priorRequest.requestId,
          priorRequest.authorityOperationId,
          ...(decision.prior.state === "consumed" || decision.prior.state === "withdrawn"
            ? [decision.prior.terminal.operationId]
            : []),
        ];
  const newIdentities = [
    requestId,
    authorityOperationId,
    ...(retirementOperationId === null ? [] : [retirementOperationId]),
  ];
  if (priorIdentities.some((identity) => newIdentities.includes(identity)))
    return { decision: "rejected", reason: "request_identity_reused" };
  if (priorRequest !== null) {
    if (!sameReviewCase(priorRequest, decision.desired))
      return { decision: "rejected", reason: "invalid_transition" };
    const sameMeaning = sameReviewActionMeaning(requestCandidate(priorRequest), decision.desired);
    const revisionOrder = compareReviewWorkRevision(priorRequest, decision.desired);
    if (
      revisionOrder < 0 ||
      (!sameMeaning && revisionOrder === 0) ||
      (decision.cause === "basis_changed" && sameMeaning) ||
      (decision.cause === "explicit_reissue" && !sameMeaning)
    )
      return { decision: "rejected", reason: "invalid_transition" };
  }

  const expectedRevision =
    priorRequest === null ? 1n : BigInt(priorRequest.work.actionRevision) + 1n;
  if (expectedRevision > 9_223_372_036_854_775_807n)
    return { decision: "rejected", reason: "action_revision_overflow" };
  if (actionRevision !== expectedRevision.toString())
    return { decision: "rejected", reason: "action_revision_mismatch" };

  const request = financeReviewActionRequestSchema.parse({
    ...decision.desired,
    authorityOperationId,
    requestId,
    work: { ...decision.desired.work, actionRevision },
  });
  let previous = decision.prior;
  if (decision.prior.state === "open") {
    if (retirementOperationId === null) return { decision: "rejected", reason: "malformed_input" };
    previous = {
      state: "withdrawn",
      request: decision.prior.request,
      terminal: {
        requestId: decision.prior.request.requestId,
        operationId: retirementOperationId,
      },
    };
  }
  return {
    decision: "issue",
    request,
    previous,
  };
}

const financeReviewActionTerminalInputSchema = z
  .object({
    current: financeReviewActionStateSchema,
    expectedRequestId: financeLifecycleIdSchema,
    operationId: financeLifecycleIdSchema,
    transition: z.enum(["consume", "withdraw"]),
  })
  .strict()
  .superRefine((input, context) => {
    if (input.operationId === input.expectedRequestId)
      context.addIssue({
        code: "custom",
        message: "Terminal operation and request identities must be distinct.",
      });
    if (
      input.current.state !== "absent" &&
      (input.operationId === input.current.request.basis.subject.id ||
        input.operationId === input.current.request.basis.source.id)
    )
      context.addIssue({
        code: "custom",
        message: "Terminal operation must be distinct from subject and review-case identities.",
      });
  });

const financeReviewActionConsumedStateSchema = financeReviewActionTerminalStateSchema.refine(
  (state) => state.state === "consumed",
  { message: "A consume result requires consumed state." },
);
const financeReviewActionWithdrawnStateSchema = financeReviewActionTerminalStateSchema.refine(
  (state) => state.state === "withdrawn",
  { message: "A withdraw result requires withdrawn state." },
);

export const financeReviewActionTerminalResultSchema = z.union([
  z
    .object({
      decision: z.literal("consume"),
      state: financeReviewActionConsumedStateSchema,
    })
    .strict(),
  z
    .object({
      decision: z.literal("withdraw"),
      state: financeReviewActionWithdrawnStateSchema,
    })
    .strict(),
  financeReviewActionRejectedSchema,
]);
export type FinanceReviewActionTerminalResult = z.infer<
  typeof financeReviewActionTerminalResultSchema
>;

/** Validates an exact-current-request terminal transition; persistence must enforce the CAS. */
export function finishFinanceReviewAction(input: unknown): FinanceReviewActionTerminalResult {
  const parsed = financeReviewActionTerminalInputSchema.safeParse(input);
  if (!parsed.success) return { decision: "rejected", reason: "malformed_input" };
  const { current, expectedRequestId, operationId, transition } = parsed.data;
  if (current.state !== "open") return { decision: "rejected", reason: "invalid_transition" };
  if (current.request.requestId !== expectedRequestId)
    return { decision: "rejected", reason: "stale_request" };
  if (current.request.authorityOperationId === operationId)
    return { decision: "rejected", reason: "request_identity_reused" };
  return {
    decision: transition,
    state: {
      state: transition === "consume" ? "consumed" : "withdrawn",
      request: current.request,
      terminal: { requestId: current.request.requestId, operationId },
    },
  };
}

/**
 * Internal free-form clarification boundary. Later persistence must bind requestId and both work
 * revisions 1:1 before consuming the open request; that exact CAS remains a future persistence
 * prerequisite. Local SMS IDs are provenance, not authority.
 */
export const financeReviewSmsClarifyCommandSchema = z
  .object({
    operationId: financeLifecycleIdSchema,
    expectedRequestId: financeLifecycleIdSchema,
    work: financeReviewQuestionTargetSchema.safeExtend({
      id: financeLifecycleIdSchema,
      actionRevision: positiveInt64RevisionSchema,
    }),
    text: z.string().trim().min(1).max(10_000),
    inboundMessageId: financeLifecycleIdSchema,
    replyBindingId: financeLifecycleIdSchema,
  })
  .strict()
  .superRefine((command, context) => {
    const identities = [
      command.operationId,
      command.expectedRequestId,
      command.work.id,
      command.inboundMessageId,
      command.replyBindingId,
    ];
    if (new Set(identities).size !== identities.length)
      context.addIssue({
        code: "custom",
        message: "SMS command role identities must be pairwise distinct.",
      });
  });
export type FinanceReviewSmsClarifyCommand = z.infer<typeof financeReviewSmsClarifyCommandSchema>;

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
    // Existing snapshots remain readable and revisable; new capture uses the stricter write schema.
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
    port === "readPosition"
      ? {
          port,
          state: "available",
          producer: "finances",
          route: { method: "GET", path: "/v1/finances/position" },
        }
      : port === "resumeFinance"
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
