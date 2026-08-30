import type {
  FinanceBudgetVersion,
  FinanceInboxCase,
  FinancePeriodReview,
  FinanceReviewReason,
  FinanceSnapshot,
  FinanceStatus,
  FinanceToolResult,
  FinanceWealthSummary,
} from "@personal-os/domain";

const reviewReasonLabels: Record<FinanceReviewReason, string> = {
  budget_variance: "The observed spending differs from the budget.",
  category_ambiguity: "The transaction category is ambiguous.",
  merchant_identity: "The merchant identity is uncertain.",
  missing_provenance: "The transaction is missing source provenance.",
  possible_duplicate: "The transaction may be a duplicate.",
  possible_transfer: "The transaction may be a transfer between owned accounts.",
  profile_fact: "A financial profile fact needs confirmation.",
  recurring_status: "The recurring status needs confirmation.",
  refund_or_reversal: "The transaction may be a refund or reversal.",
  reimbursement: "The reimbursement relationship needs confirmation.",
  source_freshness: "A financial source may be stale.",
  unusual_amount: "The transaction amount is unusual.",
};

function resultWithPresentation<T>(
  source: FinanceToolResult<T>,
  presentation: NonNullable<FinanceToolResult<T>["presentation"]>,
): FinanceToolResult<T> {
  return { ...source, presentation };
}

function snapshotGaps(
  status: FinanceStatus,
  wealth: FinanceWealthSummary,
): { displayed: string[]; total: number } {
  const close = status.details.closeReadiness;
  const all = [
    ...status.freshness.blockers.map((blocker) => blocker.message),
    ...(close.missingProvenance > 0
      ? [`${close.missingProvenance} ledger item(s) are missing provenance.`]
      : []),
    ...(close.possibleDuplicates > 0
      ? [`${close.possibleDuplicates} possible duplicate(s) remain.`]
      : []),
    ...(close.unmatchedTransfers > 0
      ? [`${close.unmatchedTransfers} transfer(s) remain unmatched.`]
      : []),
    ...(close.uncategorized > 0
      ? [`${close.uncategorized} transaction(s) remain uncategorized.`]
      : []),
    ...(status.details.wealth.cash === null ? ["Cash position is unavailable."] : []),
    ...(status.details.wealth.debt === null ? ["Debt position is unavailable."] : []),
    ...(status.details.wealth.investments === null ? ["Investment position is unavailable."] : []),
    ...(status.details.wealth.netWorth === null ? ["Net worth is unavailable."] : []),
    ...(wealth.accountSemantics.unresolvedOwnershipAccountIds.length > 0
      ? [
          `${wealth.accountSemantics.unresolvedOwnershipAccountIds.length} account(s) have unresolved ownership semantics.`,
        ]
      : []),
    ...(wealth.accountSemantics.possibleDuplicateGroups.length > 0
      ? [
          `${wealth.accountSemantics.possibleDuplicateGroups.length} possible duplicate account group(s) remain.`,
        ]
      : []),
  ];
  if (all.length <= 20) return { displayed: all, total: all.length };
  return {
    displayed: [
      ...all.slice(0, 19),
      `${all.length - 19} additional Finance evidence gap(s) remain.`,
    ],
    total: all.length,
  };
}

export function buildFinanceSnapshotResult(
  status: FinanceStatus,
  budget: FinanceToolResult<FinanceBudgetVersion | null>,
  wealth: FinanceWealthSummary,
): FinanceToolResult<FinanceSnapshot> {
  const close = status.details.closeReadiness;
  const gaps = snapshotGaps(status, wealth);
  const trustworthy =
    status.freshness.state === "current" && gaps.total === 0 && wealth.accountSemantics.trustworthy;
  const data = {
    accounts: {
      current: status.details.accounts.current,
      needingAttention:
        status.details.accounts.blocked +
        status.details.accounts.retrying +
        status.details.accounts.stale,
    },
    asOf: status.freshness.observedAt,
    budget: {
      activeVersionId: budget.data?.status === "active" ? budget.data.id : null,
      allocated: budget.data?.allocatedTotal ?? null,
      remaining: status.details.plan.capacity,
      spent: status.details.month.spending,
    },
    cash: status.details.wealth.cash === null ? null : wealth.cash,
    debt: status.details.wealth.debt,
    inbox: {
      awaitingInput: status.work.awaitingInput,
      open: status.details.review.total,
    },
    investments: status.details.wealth.investments === null ? null : wealth.investments,
    ledger: { reconciledThrough: close.reconciledThrough, trustworthy },
    netWorth: status.details.wealth.netWorth === null ? null : wealth.netWorth,
  } satisfies FinanceSnapshot;

  return {
    changes: [],
    communication: {
      headline: trustworthy
        ? "Your financial snapshot is current."
        : "Your financial snapshot has unresolved evidence gaps.",
      optionalDetails: [],
      requiredDisclosures: gaps.displayed.map((message) => ({ importance: "important", message })),
    },
    data,
    outcome: status.work.awaitingInput > 0 ? "user_input_required" : "completed",
    presentation: {
      asOf: data.asOf,
      destination: status.recommendedNextOperation?.href
        ? {
            href: status.recommendedNextOperation.href,
            label: status.recommendedNextOperation.label,
          }
        : { href: "/finances", label: "Open Finances" },
      diagnosticFacts: [
        { label: "Current accounts", value: data.accounts.current },
        { label: "Accounts needing attention", value: data.accounts.needingAttention },
        { label: "Reconciled through", value: data.ledger.reconciledThrough },
      ],
      disclosures: gaps.displayed.map((message) => ({ importance: "important", message })),
      eyebrow: "Finance",
      kind: "finance_snapshot",
      position: {
        cash: data.cash,
        debt: data.debt,
        investments: data.investments,
        netWorth: data.netWorth,
      },
      summary: trustworthy
        ? "Connected financial evidence is current and the ledger has no unresolved close-readiness gaps."
        : "Some financial values or ledger assertions remain incomplete; unavailable values are not treated as zero.",
      title: "Financial snapshot",
      trust: { gaps: gaps.displayed, state: status.freshness.state, trustworthy },
    },
    remainingWork: {
      categories: gaps.total > 0 ? ["finance_evidence"] : [],
      count: gaps.total,
    },
    schemaVersion: 1,
  };
}

export function withFinanceBudgetPresentation<T extends FinanceBudgetVersion | null>(
  source: FinanceToolResult<T>,
): FinanceToolResult<T> {
  const budget = source.data;
  if (!budget) return source;
  return resultWithPresentation(source, {
    allocations: budget.allocations.map((allocation) => ({
      amount: allocation.amount,
      description: allocation.description ?? null,
      key: allocation.key,
      kind: allocation.kind,
    })),
    assumptions: budget.assumptions,
    balance: budget.balanceDelta,
    destination: { href: "/finances/budgets", label: "Open budget" },
    diagnosticFacts: [
      { label: "Effective month", value: budget.effectiveFrom },
      { label: "Version", value: budget.version },
      { label: "Approved at", value: budget.approvedAt },
    ],
    disclosures: source.communication.requiredDisclosures,
    eyebrow: "Finance budget",
    expectedResources: budget.expectedResources,
    kind: "finance_budget",
    status: budget.status,
    summary: source.communication.headline,
    title: `Budget for ${budget.effectiveFrom}`,
    totalAllocated: budget.allocatedTotal,
  });
}

export function withFinanceInboxPresentation(
  source: FinanceToolResult<FinanceInboxCase[]>,
): FinanceToolResult<FinanceInboxCase[]> {
  const question = source.communication.nextQuestion;
  if (!question) return source;
  const review = source.data.find((candidate) => candidate.id === question.id);
  if (!review) return source;
  return resultWithPresentation(source, {
    destination: { href: "/finances/review", label: "Open review queue" },
    diagnosticFacts: [
      { label: "First seen", value: review.firstSeenAt },
      { label: "Status", value: review.status },
    ],
    disclosures: source.communication.requiredDisclosures,
    evidenceCount: Math.min(Object.keys(review.evidence).length, 50),
    eyebrow: "Finance review",
    impactAmount: review.impactAmount,
    kind: "finance_review",
    prompt: question.prompt,
    reason: reviewReasonLabels[review.reason],
    summary: "Ilo needs one answer before it can resolve this item safely.",
    title: "A transaction needs your input",
  });
}

export function buildFinancePeriodReviewResult(
  review: FinancePeriodReview,
): FinanceToolResult<FinancePeriodReview> {
  const hasQuestions = review.status === "completed_with_questions";
  return {
    changes: [],
    communication: {
      headline: hasQuestions
        ? "The period verification completed with unresolved questions."
        : "The period verification completed.",
      optionalDetails: [],
      requiredDisclosures: hasQuestions
        ? [
            {
              importance: "important",
              message: `${review.work.questions} question(s) remain unresolved.`,
            },
          ]
        : [],
    },
    data: review,
    outcome: hasQuestions ? "user_input_required" : "completed",
    presentation: {
      cutoff: review.cutoff,
      destination: { href: review.monitoring.href, label: "Open period review" },
      diagnosticFacts: [
        { label: "Approvals", value: review.work.approvals },
        { label: "Exceptions", value: review.work.exceptions },
        { label: "Questions", value: review.work.questions },
        { label: "Rules and actions", value: review.work.rulesAndActions },
      ],
      disclosures: hasQuestions
        ? [
            {
              importance: "important",
              message: `${review.work.questions} question(s) remain unresolved.`,
            },
          ]
        : [],
      eyebrow: "Finance verification",
      kind: "finance_period_verification",
      period: review.period,
      recommendations: review.recommendations.map(({ disposition, recommendation }) => ({
        disposition,
        recommendation,
      })),
      status: review.status,
      summary: hasQuestions
        ? "The verification ran successfully, but the ledger still needs user input."
        : "The verification ran successfully with no outstanding questions.",
      title: "Period verification",
      work: review.work,
    },
    remainingWork: {
      categories: hasQuestions ? ["finance_questions"] : [],
      count: review.work.questions,
    },
    schemaVersion: 1,
  };
}
