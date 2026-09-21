import {
  auditEvents,
  type Database,
  financeBudgetPeriodBaselines,
  financeBudgetPolicies,
  financeBudgetPolicyPreviews,
  financeBudgetPolicyVersions,
  financeBudgetRevisionProposals,
} from "@personal-os/database";
import {
  createFinanceBudgetPolicySchema,
  createFinanceBudgetRevisionProposalSchema,
  designateFinanceBudgetBaselineSchema,
  type FinanceBudgetPolicyPlanSnapshot,
  type FinanceBudgetPolicyRevisionTuple,
  type FinanceBudgetPolicyTerms,
  financeBudgetPeriodBaselineRecordSchema,
  financeBudgetPolicyEvaluationSchema,
  financeBudgetPolicyLifecycleSchema,
  financeBudgetPolicyListSchema,
  financeBudgetPolicyPreviewRecordSchema,
  financeBudgetPolicyRecordSchema,
  financeBudgetRevisionProposalRecordSchema,
  previewFinanceBudgetPolicySchema,
  reviseFinanceBudgetPolicySchema,
  saveFinanceBudgetPolicyPreviewSchema,
} from "@personal-os/domain";
import { and, desc, eq, lt } from "drizzle-orm";
import { auditValues } from "../audit.js";
import { AppError } from "../errors.js";
import { evaluateFinanceBudgetPolicy } from "./budget-policy-evaluator.js";
import {
  policyBaseline,
  policyBudget,
  policyCurrent,
  policyDependenciesAvailable,
  policyHash,
  policyPlan,
  policyRef,
  policyRoot,
  policySnapshot,
  policyTerms,
  samePolicyValue,
  validatePolicyCandidate,
} from "./budget-policy-evidence.js";
import {
  executeFinanceIdempotently,
  type FinanceMutationContext,
  type FinanceTransaction,
} from "./context.js";

const capability = {
  executionAvailable: false as const,
  executionUnavailableReasons: ["authority_not_wired", "position_commit_fence_not_wired"] as const,
};
const unavailable = { state: "unavailable" as const, reason: "producer_not_registered" as const };
type Policy = typeof financeBudgetPolicies.$inferSelect;
type Version = typeof financeBudgetPolicyVersions.$inferSelect;
type Proposal = typeof financeBudgetRevisionProposals.$inferSelect;

function conflict(
  condition: boolean,
  message = "The reviewed Finance state changed. Read it again before saving.",
) {
  if (condition) throw new AppError("conflict", message);
}
function requirePerson(context: FinanceMutationContext) {
  if (context.actorType !== "user" || !context.canMutate)
    throw new AppError(
      "forbidden",
      "Budget policy management requires a person with finances:write.",
    );
}

function nextPolicyRevision(revision: number): number {
  conflict(revision >= 2_147_483_647, "This Finance revision reached its supported limit.");
  return revision + 1;
}

function persistedRow<T>(row: T | undefined): T {
  // PostgreSQL RETURNING yields the inserted row, or the row held under this transaction's
  // update lock. The schema has no write-suppressing triggers on these tables.
  /* v8 ignore next -- defensive protection for a future database contract change. */
  if (!row) throw new AppError("internal_error", "The Finance write did not return its row.");
  return row;
}

/** Management only. Every mutation uses owner admission and the shared profile mutex. */
export function createFinanceBudgetPolicyService({ db, now }: { db: Database; now: () => Date }) {
  const read = <T>(fn: (tx: FinanceTransaction) => Promise<T>) =>
    db.transaction(fn, { isolationLevel: "repeatable read", accessMode: "read only" });
  const mutate = <T extends Record<string, unknown>>(
    context: FinanceMutationContext,
    operation: string,
    payload: { idempotencyKey: string } & Record<string, unknown>,
    fn: (tx: FinanceTransaction) => Promise<T>,
  ) => {
    requirePerson(context);
    return executeFinanceIdempotently(
      db,
      context,
      {
        operation: `budget_policy.${operation}`,
        payload,
        idempotencyKey: payload.idempotencyKey,
        requireUserAdmission: true,
        lockIdentities: [`finance-profile:${context.userId}`],
      },
      fn,
    );
  };
  async function audit(
    tx: FinanceTransaction,
    context: FinanceMutationContext,
    action: string,
    id: string,
    after: Record<string, unknown>,
  ) {
    await tx.insert(auditEvents).values(
      auditValues({
        action: `finances.budget_policy.${action}`,
        entityType: "finance_budget_policy_management",
        entityId: id,
        principal: context,
        requestId: context.requestId,
        before: null,
        after,
      }),
    );
  }
  async function record(tx: FinanceTransaction, row: Policy, version: Version) {
    return financeBudgetPolicyRecordSchema.parse({
      ...capability,
      id: row.id,
      planId: row.planId,
      state: row.state,
      lifecycleRevision: row.lifecycleRevision,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      latestVersion: {
        id: version.id,
        version: version.version,
        terms: await policyTerms(tx, version),
        createdAt: version.createdAt.toISOString(),
      },
    });
  }
  function proposalRecord(row: Proposal) {
    return financeBudgetRevisionProposalRecordSchema.parse({
      ...capability,
      id: row.id,
      policyId: row.policyId,
      policyVersionId: row.policyVersionId,
      state: row.state,
      lifecycleRevision: row.lifecycleRevision,
      candidate: row.candidateSnapshot,
      candidateHash: row.candidateHash,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    });
  }
  async function ownedProposal(tx: FinanceTransaction, userId: string, id: string, lock = false) {
    const query = tx
      .select()
      .from(financeBudgetRevisionProposals)
      .where(
        and(
          eq(financeBudgetRevisionProposals.userId, userId),
          eq(financeBudgetRevisionProposals.id, id),
        ),
      )
      .limit(1);
    const [row] = await (lock ? query.for("update") : query);
    if (!row) throw new AppError("not_found", "Budget revision proposal not found.");
    return row;
  }
  async function assertContext(
    tx: FinanceTransaction,
    userId: string,
    planId: string,
    terms: FinanceBudgetPolicyTerms,
    expectedProfile: unknown,
    expectedLatestBudget: unknown,
  ) {
    const plan = await policyPlan(tx, userId, planId);
    conflict(plan.status !== "active", "Archived plans cannot receive policy terms.");
    const current = await policyCurrent(tx, userId, planId, terms.period.from.slice(0, 7));
    conflict(
      !samePolicyValue(policyRef(current.profile), expectedProfile) ||
        !samePolicyValue(policyRef(current.latest), expectedLatestBudget),
    );
    conflict(
      !(await policyBaseline(tx, userId, planId, terms)),
      "Confirm the exact human-approved period baseline first.",
    );
    conflict(now().getTime() >= new Date(terms.expiresAt).getTime(), "Policy terms have expired.");
  }
  async function appendVersion(
    tx: FinanceTransaction,
    context: FinanceMutationContext,
    policyId: string,
    planId: string,
    version: number,
    terms: FinanceBudgetPolicyTerms,
  ) {
    const row = await tx
      .insert(financeBudgetPolicyVersions)
      .values({
        userId: context.userId,
        policyId,
        planId,
        version,
        baselineBudgetVersionId: terms.baseline.id,
        periodMonth: terms.period.from.slice(0, 7),
        periodFrom: terms.period.from,
        periodThrough: terms.period.through,
        timezone: terms.period.timezone,
        expiresAt: new Date(terms.expiresAt),
        perChangeCapCents: terms.perChangeCapCents,
        monthlyCapCents: terms.monthlyCapCents,
        currency: terms.currency,
        rollover: terms.rollover,
        accounting: terms.accounting,
        usageScope: terms.usageScope,
        directions: terms.directions,
        protections: terms.protections,
        createdByActorId: context.actorId,
        createdAt: now(),
      })
      .returning()
      .then(([row]) => persistedRow(row));
    return row;
  }
  async function evaluation(
    tx: FinanceTransaction,
    userId: string,
    policy: Policy,
    version: Version,
    expected: FinanceBudgetPolicyRevisionTuple,
    candidate: FinanceBudgetPolicyPlanSnapshot,
    lockDependencies = false,
  ) {
    const terms = await policyTerms(tx, version);
    const plan = await policyPlan(tx, userId, policy.planId);
    await validatePolicyCandidate(
      tx,
      userId,
      policy.planId,
      version.periodMonth,
      candidate,
      lockDependencies,
    );
    const current = await policyCurrent(tx, userId, policy.planId, version.periodMonth);
    const baseline = await policyBaseline(tx, userId, policy.planId, terms);
    const observed: FinanceBudgetPolicyRevisionTuple = {
      userId,
      planId: policy.planId,
      policy: { id: version.id, revision: String(version.version) },
      policyLifecycleRevision: policy.lifecycleRevision,
      profile: policyRef(current.profile),
      baseline: terms.baseline,
      activeBudget: policyRef(current.active),
      latestBudget: policyRef(current.latest),
      positionRevision: null,
      usageRevision: null,
    };
    return evaluateFinanceBudgetPolicy({
      evaluatedAt: now().toISOString(),
      terms,
      policyState: plan.status !== "active" ? "unknown" : policy.state,
      expected,
      observed,
      baseline: await policySnapshot(tx, baseline ?? undefined),
      current: await policySnapshot(tx, current.active),
      candidate,
      position: unavailable,
      usage: unavailable,
    });
  }
  function assertProposalCurrent(
    proposal: Proposal,
    policy: Policy,
    version: Version,
    observed: FinanceBudgetPolicyRevisionTuple,
  ) {
    conflict(
      proposal.state !== "inactive" ||
        policy.state !== "draft" ||
        proposal.policyVersionId !== version.id ||
        proposal.profileVersionId !== (observed.profile?.id ?? null) ||
        proposal.baselineBudgetVersionId !== observed.baseline.id ||
        proposal.activeBudgetVersionId !== (observed.activeBudget?.id ?? null) ||
        proposal.latestBudgetVersionId !== (observed.latestBudget?.id ?? null),
    );
  }
  async function previewRecord(
    tx: FinanceTransaction,
    userId: string,
    proposal: Proposal,
    saved: typeof financeBudgetPolicyPreviews.$inferSelect,
  ) {
    const packet = financeBudgetPolicyEvaluationSchema.parse(saved.resultSnapshot);
    const { row: policy, version } = await policyRoot(tx, userId, proposal.policyId);
    // Inspect current references separately; the persisted packet is never evaluated again.
    const plan = await policyPlan(tx, userId, policy.planId);
    const terms = await policyTerms(tx, version);
    const current = await policyCurrent(tx, userId, policy.planId, version.periodMonth);
    const baseline = await policyBaseline(tx, userId, policy.planId, terms);
    const observed: FinanceBudgetPolicyRevisionTuple = {
      userId,
      planId: policy.planId,
      policy: { id: version.id, revision: String(version.version) },
      policyLifecycleRevision: policy.lifecycleRevision,
      profile: policyRef(current.profile),
      baseline: terms.baseline,
      activeBudget: policyRef(current.active),
      latestBudget: policyRef(current.latest),
      positionRevision: null,
      usageRevision: null,
    };
    const stale =
      !(await policyDependenciesAvailable(tx, userId, packet.input.candidate)) ||
      !samePolicyValue(packet.revisions, observed) ||
      !samePolicyValue(packet.input.terms, terms) ||
      proposal.lifecycleRevision !== saved.proposalLifecycleRevision ||
      saved.policyVersionId !== version.id ||
      policy.lifecycleRevision !== saved.policyLifecycleRevision ||
      !samePolicyValue(packet.input.baseline, await policySnapshot(tx, baseline ?? undefined)) ||
      !samePolicyValue(packet.input.current, await policySnapshot(tx, current.active)) ||
      plan.status !== "active";
    return financeBudgetPolicyPreviewRecordSchema.parse({
      ...capability,
      id: saved.id,
      proposalId: proposal.id,
      previewHash: saved.previewHash,
      result: packet,
      expiresAt: saved.expiresAt.toISOString(),
      createdAt: saved.createdAt.toISOString(),
      assessment: {
        stale,
        expired:
          now().getTime() >=
          Math.min(saved.expiresAt.getTime(), new Date(packet.input.terms.expiresAt).getTime()),
        proposalWithdrawn: proposal.state === "withdrawn",
        policyDisabled: policy.state === "disabled",
      },
    });
  }
  return {
    async listPolicies(userId: string, value: unknown) {
      const input = financeBudgetPolicyListSchema.parse(value);
      return read(async (tx) => {
        const rows = await tx
          .select()
          .from(financeBudgetPolicies)
          .where(
            and(
              eq(financeBudgetPolicies.userId, userId),
              input.beforeId ? lt(financeBudgetPolicies.id, input.beforeId) : undefined,
            ),
          )
          .orderBy(desc(financeBudgetPolicies.id))
          .limit(input.limit);
        return Promise.all(
          rows.map(async (row) => {
            const found = await policyRoot(tx, userId, row.id);
            return record(tx, row, found.version);
          }),
        );
      });
    },
    async getPolicy(userId: string, id: string) {
      return read(async (tx) => {
        const { row, version } = await policyRoot(tx, userId, id);
        return record(tx, row, version);
      });
    },
    async createPolicy(context: FinanceMutationContext, value: unknown) {
      const input = createFinanceBudgetPolicySchema.parse(value);
      return mutate(context, "create", input, async (tx) => {
        await assertContext(
          tx,
          context.userId,
          input.planId,
          input.terms,
          input.expectedProfile,
          input.expectedLatestBudget,
        );
        const row = await tx
          .insert(financeBudgetPolicies)
          .values({
            userId: context.userId,
            planId: input.planId,
            state: "draft",
            lifecycleRevision: 1,
            createdByActorId: context.actorId,
            createdAt: now(),
            updatedAt: now(),
          })
          .returning()
          .then(([row]) => persistedRow(row));
        const version = await appendVersion(tx, context, row.id, row.planId, 1, input.terms);
        await audit(tx, context, "created", row.id, {
          state: "draft",
          versionId: version.id,
          executionAvailable: false,
        });
        return record(tx, row, version);
      });
    },
    async revisePolicy(context: FinanceMutationContext, id: string, value: unknown) {
      const input = reviseFinanceBudgetPolicySchema.parse(value);
      return mutate(context, "revise", { ...input, policyId: id }, async (tx) => {
        const { row, version } = await policyRoot(tx, context.userId, id, true);
        conflict(
          row.state !== "draft" ||
            row.lifecycleRevision !== input.expectedLifecycleRevision ||
            version.version !== input.expectedLatestVersion,
        );
        await assertContext(
          tx,
          context.userId,
          row.planId,
          input.terms,
          input.expectedProfile,
          input.expectedLatestBudget,
        );
        const next = await appendVersion(
          tx,
          context,
          id,
          row.planId,
          nextPolicyRevision(version.version),
          input.terms,
        );
        const updated = await tx
          .update(financeBudgetPolicies)
          .set({ updatedAt: now() })
          .where(eq(financeBudgetPolicies.id, id))
          .returning()
          .then(([row]) => persistedRow(row));
        await audit(tx, context, "revised", id, {
          versionId: next.id,
          version: next.version,
          executionAvailable: false,
        });
        return record(tx, updated, next);
      });
    },
    async disablePolicy(context: FinanceMutationContext, id: string, value: unknown) {
      const input = financeBudgetPolicyLifecycleSchema.parse(value);
      return mutate(context, "disable", { ...input, policyId: id }, async (tx) => {
        const { row, version } = await policyRoot(tx, context.userId, id, true);
        conflict(row.lifecycleRevision !== input.expectedLifecycleRevision);
        if (row.state === "disabled") return record(tx, row, version);
        const updated = await tx
          .update(financeBudgetPolicies)
          .set({
            state: "disabled",
            lifecycleRevision: nextPolicyRevision(row.lifecycleRevision),
            disabledAt: now(),
            disabledByActorId: context.actorId,
            updatedAt: now(),
          })
          .where(eq(financeBudgetPolicies.id, id))
          .returning()
          .then(([row]) => persistedRow(row));
        await audit(tx, context, "disabled", id, {
          state: "disabled",
          lifecycleRevision: updated.lifecycleRevision,
        });
        return record(tx, updated, version);
      });
    },
    async designateBaseline(context: FinanceMutationContext, value: unknown) {
      const input = designateFinanceBudgetBaselineSchema.parse(value);
      return mutate(context, "baseline", input, async (tx) => {
        const plan = await policyPlan(tx, context.userId, input.planId, true);
        conflict(
          plan.status !== "active",
          "Archived plans cannot consume the monthly baseline slot.",
        );
        const current = await policyCurrent(
          tx,
          context.userId,
          input.planId,
          input.period.from.slice(0, 7),
        );
        conflict(
          !samePolicyValue(policyRef(current.profile), input.expectedProfile) ||
            !samePolicyValue(policyRef(current.latest), input.expectedLatestBudget),
        );
        const budget = await policyBudget(tx, context.userId, input.budget.id);
        const snapshot = await policySnapshot(tx, budget);
        conflict(
          !budget ||
            !snapshot ||
            !samePolicyValue(policyRef(budget), input.budget) ||
            budget.planId !== input.planId ||
            budget.effectiveFrom !== input.period.from.slice(0, 7) ||
            !budget.approvedAt ||
            budget.approvedByActorType !== "user" ||
            !budget.approvedByActorId ||
            !["active", "retired"].includes(budget.status) ||
            budget.balanceDelta !== 0 ||
            budget.expectedResources !== budget.allocatedTotal ||
            snapshot.resources.length === 0 ||
            snapshot.allocations.length === 0 ||
            snapshot.resources.reduce((n, r) => n + r.amountCents, 0) !==
              budget.expectedResources ||
            snapshot.allocations.reduce((n, a) => n + a.amountCents, 0) !== budget.allocatedTotal,
          "Baseline must be an exact, complete, human-approved budget for this plan and period.",
        );
        const existing = await tx.query.financeBudgetPeriodBaselines.findFirst({
          where: and(
            eq(financeBudgetPeriodBaselines.userId, context.userId),
            eq(financeBudgetPeriodBaselines.periodMonth, input.period.from.slice(0, 7)),
          ),
        });
        conflict(!!existing, "This month's baseline is already confirmed and cannot be replaced.");
        const row = await tx
          .insert(financeBudgetPeriodBaselines)
          .values({
            userId: context.userId,
            planId: input.planId,
            periodMonth: input.period.from.slice(0, 7),
            periodFrom: input.period.from,
            periodThrough: input.period.through,
            timezone: input.period.timezone,
            budgetVersionId: input.budget.id,
            confirmedByActorId: context.actorId,
            confirmedAt: now(),
          })
          .returning()
          .then(([row]) => persistedRow(row));
        await audit(tx, context, "baseline_confirmed", row.id, {
          budgetVersionId: input.budget.id,
          periodMonth: row.periodMonth,
        });
        return financeBudgetPeriodBaselineRecordSchema.parse({
          ...capability,
          id: row.id,
          planId: row.planId,
          period: input.period,
          budget: input.budget,
          confirmedAt: row.confirmedAt.toISOString(),
        });
      });
    },
    async previewPolicy(userId: string, value: unknown) {
      const input = previewFinanceBudgetPolicySchema.parse(value);
      return read(async (tx) => {
        const { row, version } = await policyRoot(tx, userId, input.policyId);
        return evaluation(tx, userId, row, version, input.expected, input.candidate);
      });
    },
    async createProposal(context: FinanceMutationContext, value: unknown) {
      const input = createFinanceBudgetRevisionProposalSchema.parse(value);
      return mutate(context, "propose", input, async (tx) => {
        const { row: policy, version } = await policyRoot(tx, context.userId, input.policyId, true);
        const result = await evaluation(
          tx,
          context.userId,
          policy,
          version,
          input.expected,
          input.candidate,
          true,
        );
        conflict(
          policy.state !== "draft" ||
            !samePolicyValue(result.revisions, input.expected) ||
            result.input.policyState !== "draft" ||
            !result.input.baseline ||
            (result.input.current !== null && result.input.current.planId !== policy.planId) ||
            now().getTime() >= version.expiresAt.getTime(),
        );
        const candidate = {
          ...input.candidate,
          resources: [...input.candidate.resources].sort((a, b) => a.key.localeCompare(b.key)),
          allocations: [...input.candidate.allocations].sort((a, b) => a.key.localeCompare(b.key)),
        };
        const proposal = await tx
          .insert(financeBudgetRevisionProposals)
          .values({
            userId: context.userId,
            policyId: policy.id,
            policyVersionId: version.id,
            planId: policy.planId,
            profileVersionId: result.revisions.profile?.id ?? null,
            baselineBudgetVersionId: result.revisions.baseline.id,
            activeBudgetVersionId: result.revisions.activeBudget?.id ?? null,
            latestBudgetVersionId: result.revisions.latestBudget?.id ?? null,
            candidateSnapshot: candidate,
            candidateHash: policyHash(candidate),
            state: "inactive",
            lifecycleRevision: 1,
            createdByActorId: context.actorId,
            createdAt: now(),
            updatedAt: now(),
          })
          .returning()
          .then(([row]) => persistedRow(row));
        await audit(tx, context, "proposed", proposal.id, {
          policyId: policy.id,
          policyVersionId: version.id,
          candidateHash: proposal.candidateHash,
          state: "inactive",
        });
        return proposalRecord(proposal);
      });
    },
    async getProposal(userId: string, id: string) {
      return read(async (tx) => proposalRecord(await ownedProposal(tx, userId, id)));
    },
    async withdrawProposal(context: FinanceMutationContext, id: string, value: unknown) {
      const input = financeBudgetPolicyLifecycleSchema.parse(value);
      return mutate(context, "withdraw", { ...input, proposalId: id }, async (tx) => {
        const initial = await ownedProposal(tx, context.userId, id);
        await policyRoot(tx, context.userId, initial.policyId, true);
        const proposal = await ownedProposal(tx, context.userId, id, true);
        conflict(proposal.lifecycleRevision !== input.expectedLifecycleRevision);
        if (proposal.state === "withdrawn") return proposalRecord(proposal);
        const updated = await tx
          .update(financeBudgetRevisionProposals)
          .set({
            state: "withdrawn",
            lifecycleRevision: nextPolicyRevision(proposal.lifecycleRevision),
            withdrawnAt: now(),
            withdrawnByActorId: context.actorId,
            updatedAt: now(),
          })
          .where(eq(financeBudgetRevisionProposals.id, id))
          .returning()
          .then(([row]) => persistedRow(row));
        await audit(tx, context, "withdrawn", id, {
          state: "withdrawn",
          lifecycleRevision: updated.lifecycleRevision,
        });
        return proposalRecord(updated);
      });
    },
    async savePreview(context: FinanceMutationContext, id: string, value: unknown) {
      const input = saveFinanceBudgetPolicyPreviewSchema.parse(value);
      const saved = await mutate(
        context,
        "save_preview",
        { ...input, proposalId: id },
        async (tx) => {
          const initial = await ownedProposal(tx, context.userId, id);
          const { row: policy, version } = await policyRoot(
            tx,
            context.userId,
            initial.policyId,
            true,
          );
          const proposal = await ownedProposal(tx, context.userId, id, true);
          const candidate = proposalRecord(proposal).candidate;
          const result = await evaluation(
            tx,
            context.userId,
            policy,
            version,
            input.expected,
            candidate,
            true,
          );
          assertProposalCurrent(proposal, policy, version, result.revisions);
          const expiry = new Date(input.expiresAt);
          conflict(
            proposal.lifecycleRevision !== input.expectedProposalRevision ||
              !samePolicyValue(input.expected, result.revisions) ||
              result.input.policyState !== "draft" ||
              !result.input.baseline ||
              expiry.getTime() <= new Date(result.evaluatedAt).getTime() ||
              expiry > version.expiresAt,
          );
          const previewHash = policyHash({
            proposalId: id,
            proposalLifecycleRevision: proposal.lifecycleRevision,
            policyLifecycleRevision: policy.lifecycleRevision,
            result,
            expiresAt: expiry.toISOString(),
          });
          const row = await tx
            .insert(financeBudgetPolicyPreviews)
            .values({
              userId: context.userId,
              proposalId: id,
              policyVersionId: version.id,
              policyLifecycleRevision: policy.lifecycleRevision,
              proposalLifecycleRevision: proposal.lifecycleRevision,
              inputSnapshot: result.input,
              resultSnapshot: result,
              previewHash,
              evaluatedAt: new Date(result.evaluatedAt),
              expiresAt: expiry,
              createdByActorId: context.actorId,
              createdAt: now(),
            })
            .returning()
            .then(([row]) => persistedRow(row));
          await audit(tx, context, "preview_saved", row.id, {
            proposalId: id,
            previewHash,
            executionAvailable: false,
          });
          return previewRecord(tx, context.userId, proposal, row);
        },
      );
      return financeBudgetPolicyPreviewRecordSchema.parse(saved);
    },
    async getPreview(userId: string, proposalId: string, id: string) {
      return read(async (tx) => {
        const proposal = await ownedProposal(tx, userId, proposalId);
        const saved = await tx.query.financeBudgetPolicyPreviews.findFirst({
          where: and(
            eq(financeBudgetPolicyPreviews.userId, userId),
            eq(financeBudgetPolicyPreviews.proposalId, proposalId),
            eq(financeBudgetPolicyPreviews.id, id),
          ),
        });
        if (!saved) throw new AppError("not_found", "Saved budget policy preview not found.");
        return previewRecord(tx, userId, proposal, saved);
      });
    },
  };
}
