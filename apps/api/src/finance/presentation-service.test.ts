import type {
  FinanceBudgetVersion,
  FinanceInboxCase,
  FinancePeriodReview,
  FinanceStatus,
  FinanceToolResult,
  FinanceWealthSummary,
} from "@personal-os/domain";
import {
  buildFinancePeriodReviewResult,
  buildFinanceSnapshotResult,
  withFinanceBudgetPresentation,
  withFinanceInboxPresentation,
} from "./presentation-service.js";

const now = "2026-08-28T12:00:00.000Z";
const id = "11111111-1111-4111-8111-111111111111";

function result<T>(data: T): FinanceToolResult<T> {
  return {
    changes: [],
    communication: {
      headline: "Finance result",
      optionalDetails: [],
      requiredDisclosures: [],
    },
    data,
    outcome: "completed",
    remainingWork: { categories: [], count: 0 },
    schemaVersion: 1,
  };
}

function statusFixture(
  overrides: {
    freshnessState?: FinanceStatus["freshness"]["state"];
    wealth?: FinanceStatus["details"]["wealth"];
  } = {},
): FinanceStatus {
  return {
    asOf: now,
    details: {
      accounts: { blocked: 0, current: 2, retrying: 0, stale: 0 },
      closeReadiness: {
        missingProvenance: 0,
        possibleDuplicates: 0,
        reconciledThrough: "2026-08-27",
        uncategorized: 0,
        unmatchedTransfers: 0,
      },
      month: { spending: 2_000 },
      plan: { capacity: 1_000 },
      review: { total: 0 },
      wealth: overrides.wealth ?? {
        cash: 12_000,
        debt: 2_000,
        investments: 10_000,
        netWorth: 20_000,
      },
    },
    freshness: {
      blockers: [],
      observedAt: now,
      state: overrides.freshnessState ?? "current",
    },
    recommendedNextOperation: {
      href: "/finances/health",
      label: "Review ledger health",
      operation: "review_health",
    },
    work: { awaitingInput: 0 },
  } as unknown as FinanceStatus;
}

function budgetFixture(changes: Partial<FinanceBudgetVersion> = {}): FinanceBudgetVersion {
  return {
    allocatedTotal: 5_000,
    allocations: [
      { amount: 2_000, description: "Housing", key: "rent", kind: "spending" },
      { amount: 3_000, key: "retirement", kind: "savings" },
    ],
    approvedAt: null,
    assumptions: ["Income remains stable."],
    balanceDelta: 0,
    createdAt: now,
    effectiveFrom: "2026-08",
    expectedResources: 5_000,
    id,
    planId: "22222222-2222-4222-8222-222222222222",
    rationale: "Balanced plan.",
    resources: [{ amount: 5_000, key: "income", kind: "income" }],
    status: "proposed",
    version: 1,
    ...changes,
  };
}

function wealthFixture(changes: Partial<FinanceWealthSummary> = {}): FinanceWealthSummary {
  return {
    accountSemantics: {
      excludedAccountIds: [],
      possibleDuplicateGroups: [],
      trustworthy: true,
      unresolvedOwnershipAccountIds: [],
    },
    annualIncome: 60_000,
    cash: 12_000,
    debt: 2_000,
    incomeBasis: "stated",
    investments: 10_000,
    monthlyIncome: 5_000,
    monthlyPlanRemaining: 1_000,
    netWorth: 20_000,
    observedAnnualIncome: 60_000,
    otherAssets: 0,
    plannedThisMonth: 4_000,
    statedAnnualIncome: 60_000,
    ...changes,
  };
}

function inboxCase(): FinanceInboxCase {
  return {
    economicEventId: "33333333-3333-4333-8333-333333333333",
    evidence: { merchant: "CVS", receipt: "mail:receipt" },
    firstSeenAt: now,
    id,
    impactAmount: 42,
    lastSeenAt: now,
    proposedResolution: null,
    reason: "category_ambiguity",
    reopenedFromId: null,
    resolvedAt: null,
    stableKey: "event:category_ambiguity",
    status: "open",
  };
}

describe("Finance presentation builders", () => {
  it("builds a snapshot without replacing unavailable wealth with zero", () => {
    const built = buildFinanceSnapshotResult(
      statusFixture({
        freshnessState: "partial",
        wealth: { cash: null, debt: 2_300, investments: null, netWorth: null },
      }),
      result<FinanceBudgetVersion | null>(null),
      wealthFixture(),
    );
    expect(built.data).toMatchObject({ cash: null, investments: null, netWorth: null });
    expect(built.presentation).toMatchObject({
      kind: "finance_snapshot",
      position: { cash: null, debt: 2_300, investments: null, netWorth: null },
      trust: { state: "partial", trustworthy: false },
    });
  });

  it("names every close-readiness gap and preserves an active budget and pending input", () => {
    const status = statusFixture();
    status.details.closeReadiness.missingProvenance = 1;
    status.details.closeReadiness.possibleDuplicates = 2;
    status.details.closeReadiness.unmatchedTransfers = 3;
    status.details.closeReadiness.uncategorized = 4;
    status.details.wealth.debt = null;
    status.freshness.blockers = [
      { code: "source_stale", message: "A source is stale.", recovery: null },
    ];
    status.recommendedNextOperation = null;
    status.work.awaitingInput = 2;

    const built = buildFinanceSnapshotResult(
      status,
      result<FinanceBudgetVersion | null>(budgetFixture({ status: "active" })),
      wealthFixture(),
    );

    expect(built.data.budget.activeVersionId).toBe(id);
    expect(built.outcome).toBe("user_input_required");
    expect(built.presentation).toMatchObject({
      destination: { href: "/finances" },
      trust: {
        gaps: [
          "A source is stale.",
          "1 ledger item(s) are missing provenance.",
          "2 possible duplicate(s) remain.",
          "3 transfer(s) remain unmatched.",
          "4 transaction(s) remain uncategorized.",
          "Debt position is unavailable.",
        ],
        trustworthy: false,
      },
    });
  });

  it("caps displayed gaps while preserving their full count and account trust state", () => {
    const status = statusFixture();
    status.freshness.blockers = Array.from({ length: 25 }, (_, index) => ({
      code: `blocker_${index}`,
      message: `Evidence gap ${index}.`,
      recovery: null,
    }));
    const built = buildFinanceSnapshotResult(
      status,
      result<FinanceBudgetVersion | null>(null),
      wealthFixture({
        accountSemantics: {
          excludedAccountIds: [],
          possibleDuplicateGroups: [{ accountIds: [id, "44444444-4444-4444-8444-444444444444"] }],
          trustworthy: false,
          unresolvedOwnershipAccountIds: [id],
        },
        cash: 9_000,
        investments: 11_000,
        netWorth: 18_000,
      }),
    );

    expect(built.data).toMatchObject({ cash: 9_000, investments: 11_000, netWorth: 18_000 });
    expect(built.remainingWork.count).toBe(27);
    expect(built.presentation).toMatchObject({
      trust: { trustworthy: false },
    });
    expect(
      built.presentation?.kind === "finance_snapshot" && built.presentation.trust.gaps,
    ).toHaveLength(20);
    expect(
      built.presentation?.kind === "finance_snapshot" && built.presentation.trust.gaps.at(-1),
    ).toContain("additional Finance evidence gap(s)");
  });

  it("uses the budget values already accepted by the API", () => {
    const input = result<FinanceBudgetVersion | null>(budgetFixture());
    expect(withFinanceBudgetPresentation(input).presentation).toMatchObject({
      balance: 0,
      expectedResources: input.data?.expectedResources,
      kind: "finance_budget",
      totalAllocated: input.data?.allocatedTotal,
    });
  });

  it("does not invent a budget or review presentation for empty results", () => {
    expect(withFinanceBudgetPresentation(result(null))).not.toHaveProperty("presentation");
    expect(withFinanceInboxPresentation(result([]))).not.toHaveProperty("presentation");
  });

  it("presents only the first inbox case and counts bounded evidence keys", () => {
    const first = inboxCase();
    const input = {
      ...result([first, { ...first, id: "44444444-4444-4444-8444-444444444444" }]),
      communication: {
        headline: "Two reviews need input.",
        nextQuestion: { answerType: "text", id: first.id, prompt: "What did you buy?" },
        optionalDetails: [],
        requiredDisclosures: [],
      },
    } satisfies FinanceToolResult<FinanceInboxCase[]>;
    expect(withFinanceInboxPresentation(input).presentation).toMatchObject({
      evidenceCount: 2,
      impactAmount: 42,
      kind: "finance_review",
      prompt: "What did you buy?",
    });
  });

  it("does not present an Inbox question that has no matching owned case", () => {
    const input = {
      ...result([inboxCase()]),
      communication: {
        headline: "A review needs input.",
        nextQuestion: {
          answerType: "text",
          id: "44444444-4444-4444-8444-444444444444",
          prompt: "What was this?",
        },
        optionalDetails: [],
        requiredDisclosures: [],
      },
    } satisfies FinanceToolResult<FinanceInboxCase[]>;

    expect(withFinanceInboxPresentation(input)).not.toHaveProperty("presentation");
  });

  it("copies period verification counts and recommendations", () => {
    const review = {
      cutoff: now,
      id,
      monitoring: { href: `/finances/reviews/${id}`, responsibility: "Review changes." },
      period: { end: "2026-08-28", start: "2026-08-01" },
      recommendations: [
        {
          assumptions: [],
          disposition: "needs_input",
          evidence: [],
          recommendation: "Confirm the unmatched transfer.",
          tradeoffs: [],
        },
      ],
      status: "completed_with_questions",
      work: { approvals: 1, exceptions: 2, questions: 3, rulesAndActions: 4 },
    } as unknown as FinancePeriodReview;
    expect(buildFinancePeriodReviewResult(review).presentation).toMatchObject({
      kind: "finance_period_verification",
      recommendations: [
        { disposition: "needs_input", recommendation: "Confirm the unmatched transfer." },
      ],
      status: "completed_with_questions",
      work: review.work,
    });
  });

  it("reports a completed period with no remaining work", () => {
    const review = {
      cutoff: now,
      monitoring: { href: `/finances/reviews/${id}`, responsibility: "Review changes." },
      period: { end: "2026-08-28", start: "2026-08-01" },
      recommendations: [],
      status: "completed",
      work: { approvals: 0, exceptions: 0, questions: 0, rulesAndActions: 1 },
    } as unknown as FinancePeriodReview;

    expect(buildFinancePeriodReviewResult(review)).toMatchObject({
      communication: { requiredDisclosures: [] },
      outcome: "completed",
      presentation: { disclosures: [], status: "completed" },
      remainingWork: { categories: [], count: 0 },
    });
  });
});
