import { createHash } from "node:crypto";
import {
  answerFinanceReviewInputSchema,
  financeMonthSchema,
  financeReviewBatchDecisionSchema,
  financeReviewBatchOutcomeSchema,
  financeReviewResolutionSchema,
} from "@personal-os/domain";
import { z } from "zod";
import { AppError } from "../errors.js";
import type { Principal } from "../types.js";

// Independent source validators. Callers must load these projections from an owner-scoped
// database snapshot, never from an HTTP request's asserted satisfaction facts.
const id = z.uuid();
const revision = z
  .union([
    z
      .string()
      .regex(/^[1-9][0-9]{0,18}$/)
      .refine(
        (value) => /^[1-9][0-9]{0,18}$/.test(value) && BigInt(value) <= 9_223_372_036_854_775_807n,
      ),
    z.bigint().min(1n).max(9_223_372_036_854_775_807n),
  ])
  .transform((value) => value.toString());
// Drizzle rows carry Date/bigint; public projections carry ISO strings/decimal strings.
const stamp = z
  .union([z.iso.datetime({ offset: true }), z.date()])
  .transform((value) => (typeof value === "string" ? value : value.toISOString()));
const actor = z.enum(["user", "agent"]);
const auditSchema = z.object({
  id,
  userId: id,
  actorType: actor,
  actorId: id,
  requestId: z.string().min(1).max(240),
  action: z.string().min(1),
  entityType: z.string().min(1),
  entityId: id,
  before: z.record(z.string(), z.unknown()).nullable(),
  after: z.record(z.string(), z.unknown()).nullable(),
  createdAt: stamp,
});
type Audit = z.infer<typeof auditSchema>;
const budgetSchema = z.object({
  id,
  userId: id,
  planId: id,
  version: z.number().int().positive().safe(),
  effectiveFrom: financeMonthSchema,
  profileVersionId: id.nullable(),
  status: z.enum(["active", "incomplete", "proposed", "retired"]),
  approvedAt: stamp.nullable(),
  approvedByActorType: actor.nullable(),
  approvedByActorId: id.nullable(),
});
const budgetRequirementSchema = z.strictObject({
  versionId: id,
  planId: id,
  version: z.number().int().positive().safe(),
  effectiveFrom: financeMonthSchema,
});

/** HELD INTEGRATION GATE: these arguments are not an authentication capability or source proof.
 * The endpoint must derive authentication from its actual authenticateSession/access-token
 * branch, never from the body or actorType. A Principal alone carries no session proof.
 * This trusted argument does not replace endpoint session validation or prove a human act. */
export function admitFinanceCompletionOwner(
  principal: Principal,
  source: "labelled_relay" | "owner_endpoint_request",
  authentication: "session" | "access_token" | "unknown",
) {
  if (authentication !== "session")
    throw new AppError("forbidden", "Completion requests require an authenticated owner session.");
  if (
    principal.actorType !== "user" ||
    principal.actorId !== principal.userId ||
    !id.safeParse(principal.userId).success
  )
    throw new AppError("forbidden", "Only the authenticated owner can request a completion text.");
  if (source !== "labelled_relay" && source !== "owner_endpoint_request")
    throw new AppError(
      "invalid_request",
      "Preserve the completion instruction's source classification.",
    );
  return {
    userId: principal.userId,
    actorType: principal.actorType,
    actorId: principal.actorId,
    authorizationConnectionId: principal.authorizationConnectionId ?? null,
    sourceClassification: source,
    humanProof: "not_established" as const,
    authorityBasis: "authenticated_owner" as const,
    authenticationMethod: "session" as const,
  };
}

/** Select once at admission; pass the retained audit ID at later checks, never follow latest. */
export function validateFinanceCompletionBudget(input: {
  ownerId: string;
  requirement: unknown;
  budget: unknown;
  audits: readonly unknown[];
  approvalAuditId?: string;
}) {
  const owner = id.parse(input.ownerId);
  const requirement = budgetRequirementSchema.parse(input.requirement);
  const parsed = budgetSchema.safeParse(input.budget);
  if (!parsed.success)
    return { state: "unavailable", reason: "approval_evidence_missing" } as const;
  const budget = parsed.data;
  if (
    budget.userId !== owner ||
    budget.id !== requirement.versionId ||
    budget.planId !== requirement.planId ||
    budget.version !== requirement.version ||
    budget.effectiveFrom !== requirement.effectiveFrom
  )
    return { state: "unavailable", reason: "source_inconsistent" } as const;
  if (budget.status !== "active") return { state: "pending", reason: "budget_not_active" } as const;
  if (!budget.approvedAt || !budget.approvedByActorId || !budget.approvedByActorType)
    return { state: "unavailable", reason: "approval_evidence_missing" } as const;
  const action =
    budget.approvedByActorType === "user"
      ? "finance.budget.user_instruction_approved"
      : "finance.budget.agent_self_approved";
  const approvalSource =
    budget.approvedByActorType === "user" ? "user_instruction" : "agent_self_approval";
  if (budget.approvedByActorType === "user" && budget.approvedByActorId !== owner)
    return { state: "unavailable", reason: "source_inconsistent" } as const;
  if (input.audits.length > 1_000)
    return { state: "unavailable", reason: "evidence_too_large" } as const;
  const candidates: Audit[] = [];
  for (const raw of input.audits) {
    const audit = auditSchema.safeParse(raw);
    if (!audit.success) return { state: "unavailable", reason: "source_inconsistent" } as const;
    const row = audit.data;
    if (row.userId !== owner)
      return { state: "unavailable", reason: "source_inconsistent" } as const;
    if (input.approvalAuditId !== undefined && row.id !== input.approvalAuditId) continue;
    if (
      row.entityId !== budget.id ||
      row.entityType !== "finance_budget_version" ||
      row.action !== action
    )
      continue;
    const after = row.after;
    if (
      row.actorType !== budget.approvedByActorType ||
      row.actorId !== budget.approvedByActorId ||
      !after ||
      after.approvalSource !== approvalSource ||
      after.status !== "active" ||
      after.budgetVersionId !== budget.id ||
      after.budgetVersion !== budget.version ||
      after.profileVersionId !== budget.profileVersionId
    )
      return { state: "unavailable", reason: "source_inconsistent" } as const;
    candidates.push(row);
  }
  if (candidates.length === 0)
    return { state: "unavailable", reason: "approval_evidence_missing" } as const;
  if (candidates.length !== 1)
    return { state: "unavailable", reason: "source_inconsistent" } as const;
  const approval = candidates[0];
  if (!approval) return { state: "unavailable", reason: "approval_evidence_missing" } as const;
  return {
    state: "qualified",
    approvalAuditId: approval.id,
    budgetVersionId: budget.id,
    planId: budget.planId,
    version: budget.version,
    effectiveFrom: budget.effectiveFrom,
    approvedAt: budget.approvedAt,
    actorType: approval.actorType,
    actorId: approval.actorId,
  } as const;
}

const batchSchema = z.object({
  id,
  userId: id,
  actorType: actor,
  actorId: id,
  authorizationConnectionId: id.nullable(),
  fingerprint: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  manifest: z.array(financeReviewBatchDecisionSchema).min(1).max(100),
  outcomes: z.array(financeReviewBatchOutcomeSchema).max(100),
});
/** Do not trust the batch's aggregate completed label or an outcome detached from its manifest. */
export function validateFinanceCompletionBatch(
  ownerId: string,
  raw: unknown,
  expectedFingerprint: string,
) {
  const row = batchSchema.parse(raw);
  if (
    row.userId !== id.parse(ownerId) ||
    row.fingerprint !== expectedFingerprint ||
    row.fingerprint !==
      `sha256:${createHash("sha256").update(JSON.stringify(row.manifest)).digest("hex")}` ||
    (row.actorType === "user" && row.actorId !== row.userId)
  )
    throw new AppError("conflict", "The saved Finance batch source is inconsistent.");
  const seen = new Set<number>();
  for (const outcome of row.outcomes) {
    const decision = row.manifest[outcome.index];
    if (
      seen.has(outcome.index) ||
      !decision ||
      decision.transactionId !== outcome.transactionId ||
      (outcome.status === "applied" && (outcome.error !== null || outcome.recovery !== "none"))
    )
      throw new AppError("conflict", "The saved Finance batch outcome is inconsistent.");
    seen.add(outcome.index);
  }
  return row;
}

/** Recover real historical revisions from saved manifests, not from today's row or prose.
 * A review decision names its case; it does not imply a transaction flag existed. */
export function deriveFinanceCompletionBatchTargets(input: {
  ownerId: string;
  batch: unknown;
  fingerprint: string;
  knownFlagIds: readonly string[];
}) {
  if (input.knownFlagIds.length > 10_000)
    throw new AppError("invalid_request", "scope_exceeds_limit");
  const flags = new Set(input.knownFlagIds.map((value) => id.parse(value)));
  const batch = validateFinanceCompletionBatch(input.ownerId, input.batch, input.fingerprint);
  const targets: Array<{
    kind: "review_case" | "transaction_flag";
    id: string;
    transactionId: string;
    capturedRevision: string;
    sourceAnchors: Array<{
      kind: "review_batch";
      id: string;
      fingerprint: string;
      index: number;
      capturedRevision: string;
    }>;
  }> = [];
  for (const [index, decision] of batch.manifest.entries()) {
    const add = (
      kind: "review_case" | "transaction_flag",
      targetId: string,
      capturedRevision: string,
    ) =>
      targets.push({
        kind,
        id: targetId,
        transactionId: decision.transactionId,
        capturedRevision,
        sourceAnchors: [
          {
            kind: "review_batch",
            id: batch.id,
            fingerprint: batch.fingerprint,
            index,
            capturedRevision,
          },
        ],
      });
    if (decision.kind === "review")
      add("review_case", decision.reviewId, decision.expectedReviewRevision);
    if (flags.has(decision.transactionId))
      add("transaction_flag", decision.transactionId, decision.expectedTransactionRevision);
  }
  return targets;
}

const targetSchema = z.strictObject({
  kind: z.enum(["transaction_flag", "review_case"]),
  id,
  transactionId: id,
  capturedRevision: revision.nullable(),
});
const transactionSchema = z.object({
  id,
  userId: id,
  contextualRevision: revision,
  updatedAt: stamp,
  categoryId: id.nullable(),
  categorySource: z.string().nullable(),
  direction: z.enum(["expense", "income", "transfer"]),
  reconciliationStatus: z.string(),
  pending: z.boolean(),
  needsReview: z.boolean(),
});
const caseSchema = z.object({
  id,
  userId: id,
  transactionId: id,
  contextualRevision: revision,
  status: z.enum(["open", "deferred", "resolved"]),
  resolution: z.record(z.string(), z.unknown()).nullable(),
});

/** Qualifies ordinary categorization effects. Other financial families fail closed, not by heuristic.
 * Transfer/lineage families need their existing owning validators in the later integration slice. */
export function qualifyFinanceCompletionTarget(input: {
  ownerId: string;
  target: unknown;
  transaction: unknown;
  reviewCase?: unknown;
  audits: readonly unknown[];
  batchItem?: { batch: unknown; fingerprint: string; index: number };
}) {
  const owner = id.parse(input.ownerId);
  const target = targetSchema.parse(input.target);
  const unavailable = (reason: string) =>
    ({ state: "unavailable", reason, targetId: target.id }) as const;
  const pending = (reason: string) => ({ state: "pending", reason, targetId: target.id }) as const;
  if (target.kind === "transaction_flag" && target.id !== target.transactionId)
    return unavailable("source_inconsistent");
  const current = transactionSchema.safeParse(input.transaction);
  if (!current.success) return unavailable("source_unavailable");
  const transaction = current.data;
  if (transaction.userId !== owner || transaction.id !== target.transactionId)
    return unavailable("source_inconsistent");
  if (target.capturedRevision === null) return unavailable("historical_revision_unavailable");
  if (transaction.pending) return pending("transaction_pending");
  if (transaction.direction === "transfer" || transaction.reconciliationStatus !== "not_applicable")
    return unavailable("requires_financial_effect_validator");
  let observedRevision = transaction.contextualRevision;
  if (target.kind === "transaction_flag" && transaction.needsReview)
    return pending("flag_still_set");
  if (target.kind === "review_case") {
    const review = caseSchema.safeParse(input.reviewCase);
    if (!review.success) return unavailable("source_unavailable");
    if (
      review.data.userId !== owner ||
      review.data.id !== target.id ||
      review.data.transactionId !== transaction.id
    )
      return unavailable("source_inconsistent");
    observedRevision = review.data.contextualRevision;
    if (review.data.status !== "resolved") return pending("unresolved_case");
    // Only actual null can use exact batch linkage as a legacy effect. Validate every
    // non-null value with the persisted Inbox writer shape: { answer, ...resolution }.
    // Request-only classification objects have no established writer compatibility.
    if (review.data.resolution !== null) {
      const schema = financeReviewResolutionSchema.options.find(
        (option) => option.shape.type.value === review.data.resolution?.type,
      );
      if (!schema) return unavailable("source_inconsistent");
      const resolution = schema
        .extend({ answer: answerFinanceReviewInputSchema.shape.answer })
        .strict()
        .safeParse(review.data.resolution);
      if (!resolution.success) return unavailable("source_inconsistent");
      if (
        resolution.data.type !== "confirm_classification" &&
        resolution.data.type !== "classify_transaction"
      )
        return unavailable("nonqualifying_resolution");
      if (resolution.data.categoryId !== transaction.categoryId)
        return unavailable("source_inconsistent");
    }
    // Generic transaction audits do not identify which case the writer actually resolved.
    if (!input.batchItem) return unavailable("exact_case_effect_unavailable");
  }
  if (BigInt(observedRevision) <= BigInt(target.capturedRevision))
    return unavailable("source_inconsistent");
  if (input.audits.length > 8) return unavailable("evidence_too_large");
  let batchEvidence: {
    id: string;
    index: number;
    actorId: string;
    actorType: string;
    expectedUpdatedAt: string;
  } | null = null;
  if (input.batchItem) {
    let batch: ReturnType<typeof validateFinanceCompletionBatch>;
    try {
      batch = validateFinanceCompletionBatch(
        owner,
        input.batchItem.batch,
        input.batchItem.fingerprint,
      );
    } catch {
      return unavailable("source_inconsistent");
    }
    const index = input.batchItem.index;
    const decision = Number.isInteger(index) && index >= 0 ? batch.manifest[index] : undefined;
    const outcome = batch.outcomes.find((row) => row.index === index);
    if (!decision || decision.transactionId !== transaction.id || !outcome)
      return unavailable("source_unavailable");
    if (outcome.status !== "applied") return pending("nonapplied_outcome");
    if (
      decision.kind === "review" &&
      (decision.action === "defer" || decision.action === "confirm_transfer")
    )
      return unavailable("requires_financial_effect_validator");
    if (
      target.kind === "review_case" &&
      (decision.kind !== "review" || decision.reviewId !== target.id)
    )
      return unavailable("exact_case_effect_unavailable");
    const basis =
      target.kind === "review_case" && decision.kind === "review"
        ? decision.expectedReviewRevision
        : decision.expectedTransactionRevision;
    if (
      BigInt(basis) < BigInt(target.capturedRevision) ||
      BigInt(observedRevision) <= BigInt(basis) ||
      BigInt(transaction.contextualRevision) <= BigInt(decision.expectedTransactionRevision)
    )
      return unavailable("source_inconsistent");
    if (
      "categoryId" in decision &&
      decision.categoryId !== undefined &&
      decision.categoryId !== transaction.categoryId
    )
      return unavailable("source_inconsistent");
    batchEvidence = {
      id: batch.id,
      index,
      actorId: batch.actorId,
      actorType: batch.actorType,
      expectedUpdatedAt: decision.expectedTransactionUpdatedAt,
    };
  }
  const eligible: Audit[] = [];
  for (const raw of input.audits) {
    const parsed = auditSchema.safeParse(raw);
    if (!parsed.success || parsed.data.userId !== owner) return unavailable("source_inconsistent");
    const audit = parsed.data;
    if (
      audit.entityType !== "finance_transaction" ||
      audit.entityId !== transaction.id ||
      audit.action !== "finance.transaction_categorized"
    )
      continue;
    if (audit.actorType === "user" && audit.actorId !== owner)
      return unavailable("source_inconsistent");
    const after = audit.after;
    if (
      !after ||
      after.categoryId !== transaction.categoryId ||
      after.categorySource !== transaction.categorySource ||
      after.direction !== transaction.direction ||
      after.reconciliationStatus !== transaction.reconciliationStatus ||
      after.pending !== false
    )
      continue;
    if (
      target.kind === "transaction_flag" &&
      (after.needsReview !== false ||
        (!batchEvidence && after.updatedAt !== transaction.updatedAt) ||
        audit.before?.needsReview !== true)
    )
      continue;
    if (
      batchEvidence &&
      (audit.actorId !== batchEvidence.actorId ||
        audit.actorType !== batchEvidence.actorType ||
        audit.before?.updatedAt !== batchEvidence.expectedUpdatedAt)
    )
      continue;
    const effectTime = stamp.safeParse(after.updatedAt);
    if (!effectTime.success || Date.parse(effectTime.data) > Date.parse(transaction.updatedAt))
      continue;
    eligible.push(audit);
  }
  if (eligible.length === 0) return unavailable("qualifying_effect_unavailable");
  if (eligible.length !== 1) return unavailable("source_inconsistent");
  return {
    state: "qualified",
    targetId: target.id,
    kind: target.kind,
    observedRevision,
    qualifyingAuditIds: eligible.map((audit) => audit.id),
    batchItemRefs: batchEvidence ? [{ batchId: batchEvidence.id, index: batchEvidence.index }] : [],
  } as const;
}

const backlogRowSchema = z.strictObject({
  userId: id,
  kind: z.enum(["transaction_flag", "review_case"]),
  id,
  transactionId: id,
  contextualRevision: revision,
});
export const financeCompletionCaptureQueryVersion = "finance-completion-capture:v2" as const;
/** All reads must use the caller's one snapshot; this helper owns neither transactions nor writes. */
export async function captureFinanceCompletionBacklog(input: {
  ownerId: string;
  readPage: (after: string | null, limit: number) => Promise<readonly unknown[]>;
}) {
  const owner = id.parse(input.ownerId);
  const rows: Array<z.infer<typeof backlogRowSchema>> = [];
  let after: string | null = null;
  let pageCount = 0;
  let terminalPage: { after: string | null; rowCount: number };
  for (;;) {
    const requestedAfter = after;
    const page = await input.readPage(after, 500);
    pageCount++;
    if (page.length > 500)
      throw new AppError("conflict", "Backlog page exceeds its requested limit.");
    for (const raw of page) {
      const row = backlogRowSchema.parse(raw);
      const key = `${row.kind}:${row.id}`;
      if (
        row.userId !== owner ||
        (after !== null && key <= after) ||
        (row.kind === "transaction_flag" && row.id !== row.transactionId)
      )
        throw new AppError("conflict", "Backlog ownership or keyset order is inconsistent.");
      rows.push(row);
      if (rows.length > 10_000) throw new AppError("invalid_request", "scope_exceeds_limit");
      after = key;
    }
    if (page.length < 500) {
      terminalPage = { after: requestedAfter, rowCount: page.length };
      break;
    }
  }
  const snapshot = createHash("sha256")
    .update(JSON.stringify([financeCompletionCaptureQueryVersion, owner, rows]))
    .digest("hex");
  const targets = rows.map((row) => ({
    kind: row.kind,
    id: row.id,
    transactionId: row.transactionId,
    capturedRevision: row.contextualRevision,
    sourceAnchors: [
      { kind: "current_backlog" as const, snapshot, capturedRevision: row.contextualRevision },
    ],
  }));
  return {
    queryVersion: financeCompletionCaptureQueryVersion,
    ownerId: owner,
    snapshot,
    complete: true as const,
    targetCount: targets.length,
    counts: {
      transactionFlags: rows.filter((row) => row.kind === "transaction_flag").length,
      reviewCases: rows.filter((row) => row.kind === "review_case").length,
    },
    pageCount,
    terminalPage,
    targets,
  };
}
