import {
  type FinanceBudgetPolicyEvaluation,
  type FinanceBudgetPolicyPlanSnapshot,
  financeBudgetPolicyEvaluationInputSchema,
  financeBudgetPolicyEvaluationSchema,
} from "@personal-os/domain";

const maximumCents = 2_147_483_647;
const equal = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
const ordered = <T extends { key: string }>(items: readonly T[]) =>
  [...items].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

function balanced(plan: FinanceBudgetPolicyPlanSnapshot): boolean {
  return (
    plan.resources.length > 0 &&
    plan.allocations.length > 0 &&
    plan.resources.reduce((sum, item) => sum + item.amountCents, 0) ===
      plan.allocations.reduce((sum, item) => sum + item.amountCents, 0)
  );
}

/** Pure evaluation of supplied evidence: no clock, IO, authority, registration, or state mutation. */
export function evaluateFinanceBudgetPolicy(value: unknown): FinanceBudgetPolicyEvaluation {
  const input = financeBudgetPolicyEvaluationInputSchema.parse(value);
  const { terms, observed, current, baseline, candidate, position, usage } = input;
  const reasons = new Set<FinanceBudgetPolicyEvaluation["reasons"][number]>();
  if (!equal(input.expected, observed)) reasons.add("stale_revision");
  if (
    !observed.profile ||
    !observed.activeBudget ||
    !observed.latestBudget ||
    !observed.positionRevision ||
    !observed.usageRevision ||
    !baseline ||
    !current
  )
    reasons.add("missing_evidence");
  if (
    !equal(terms.baseline, observed.baseline) ||
    (baseline && !equal(baseline.revision, observed.baseline)) ||
    (current && !equal(current.revision, observed.activeBudget)) ||
    !equal(observed.activeBudget, observed.latestBudget)
  )
    reasons.add("stale_revision");

  if (input.policyState === "disabled") reasons.add("policy_disabled");
  if (input.policyState === "unknown") reasons.add("policy_unknown");
  const evaluatedAt = new Date(input.evaluatedAt).getTime();
  if (input.policyState === "expired" || evaluatedAt >= new Date(terms.expiresAt).getTime())
    reasons.add("policy_expired");
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: terms.period.timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(evaluatedAt));
  const date = ["year", "month", "day"]
    .map((name) => parts.find((part) => part.type === name)?.value)
    .join("-");
  if (date < terms.period.from || date > terms.period.through) reasons.add("outside_period");

  for (const plan of [baseline, current, candidate]) {
    if (!plan) continue;
    if (
      plan.userId !== observed.userId ||
      plan.planId !== observed.planId ||
      plan.month !== terms.period.from.slice(0, 7)
    )
      reasons.add("scope_mismatch");
    if (!balanced(plan)) reasons.add("unbalanced_plan");
  }

  if (position.state === "unavailable") reasons.add("position_unavailable");
  else {
    const evidence = position.evidence;
    if (
      evidence.revision !== observed.positionRevision ||
      new Date(evidence.asOf).getTime() > evaluatedAt
    )
      reasons.add("stale_revision");
    if (
      position.userId !== observed.userId ||
      evidence.scope.from !== terms.period.from ||
      evidence.scope.through !== terms.period.through ||
      new Set(evidence.scope.accountIds).size !== evidence.scope.accountIds.length
    )
      reasons.add("scope_mismatch");
    for (const fact of [
      evidence.cash,
      evidence.postedSpend,
      evidence.pendingExposure,
      evidence.committed,
      evidence.protected,
      evidence.spendable,
      evidence.debt,
      evidence.investments,
      evidence.netWorth,
    ]) {
      if (
        fact.cents === null ||
        fact.quality !== "verified" ||
        fact.reasons.length > 0 ||
        fact.sources.length === 0
      )
        reasons.add("position_unqualified");
    }
  }
  if (usage.state === "unavailable") reasons.add("usage_unavailable");
  else {
    if (usage.revision !== observed.usageRevision) reasons.add("stale_revision");
    if (
      usage.userId !== observed.userId ||
      !equal(usage.period, terms.period) ||
      usage.accounting !== terms.accounting ||
      usage.scope !== terms.usageScope
    )
      reasons.add("scope_mismatch");
  }

  let deltas: FinanceBudgetPolicyEvaluation["deltas"] = [];
  let grossMovedCents: number | null = null;
  if (current) {
    if (!equal(ordered(current.resources), ordered(candidate.resources)))
      reasons.add("resource_changed");
    const currentByKey = new Map(current.allocations.map((item) => [item.key, item]));
    const candidateByKey = new Map(candidate.allocations.map((item) => [item.key, item]));
    const identitiesMatch =
      currentByKey.size === candidateByKey.size &&
      current.allocations.every((before) => {
        const after = candidateByKey.get(before.key);
        return after && before.kind === after.kind && before.targetId === after.targetId;
      });
    if (!identitiesMatch) reasons.add("allocation_identity_changed");
    else {
      deltas = ordered(candidate.allocations).map((after) => {
        const before = currentByKey.get(after.key);
        // The identity comparison above establishes this mapping without defaulting a missing amount.
        if (!before) throw new Error("Budget allocation identity invariant failed.");
        return {
          allocationKey: after.key,
          beforeCents: before.amountCents,
          afterCents: after.amountCents,
          deltaCents: after.amountCents - before.amountCents,
        };
      });
      grossMovedCents = deltas.reduce((sum, delta) => sum + Math.max(0, delta.deltaCents), 0);
      const directions = new Map(
        terms.directions.map((item) => [item.allocationKey, item.direction]),
      );
      for (const delta of deltas) {
        if (delta.deltaCents === 0) continue;
        const direction = directions.get(delta.allocationKey);
        if (direction !== "both" && direction !== (delta.deltaCents > 0 ? "increase" : "decrease"))
          reasons.add("direction_not_permitted");
      }
      if (grossMovedCents > terms.perChangeCapCents) reasons.add("per_change_cap");
    }
    for (const direction of terms.directions)
      if (!currentByKey.has(direction.allocationKey)) reasons.add("allocation_identity_changed");
    for (const protection of terms.protections) {
      const before = currentByKey.get(protection.allocationKey);
      const after = candidateByKey.get(protection.allocationKey);
      if (!before || !after) {
        reasons.add("allocation_identity_changed");
        continue;
      }
      if (after.amountCents < before.amountCents) reasons.add("protected_release");
      if (after.amountCents < protection.minimumCents) reasons.add("protection_floor");
    }
  }
  let projectedMonthlyUsageCents =
    usage.state === "available" && grossMovedCents !== null
      ? usage.consumedCents + grossMovedCents
      : null;
  if (projectedMonthlyUsageCents !== null && projectedMonthlyUsageCents > terms.monthlyCapCents)
    reasons.add("monthly_cap");
  if (
    (grossMovedCents !== null && grossMovedCents > maximumCents) ||
    (projectedMonthlyUsageCents !== null && projectedMonthlyUsageCents > maximumCents)
  ) {
    // Preserve full source snapshots, but do not publish out-of-range or clamped output amounts.
    reasons.add("amount_overflow");
    deltas = [];
    grossMovedCents = null;
    projectedMonthlyUsageCents = null;
  }
  return financeBudgetPolicyEvaluationSchema.parse({
    kind: reasons.size ? "denied" : "hypothetical_preview",
    executionAvailable: false,
    executionUnavailableReasons: ["authority_not_wired", "position_commit_fence_not_wired"],
    evaluatedAt: input.evaluatedAt,
    input,
    revisions: observed,
    reasons: [...reasons].sort(),
    grossMovedCents,
    projectedMonthlyUsageCents,
    deltas,
  });
}
