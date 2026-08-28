import type {
  FinanceBudgetVersion,
  FinanceInboxCase,
  FinancePeriodReview,
  FinanceStatus,
  FinanceToolResult,
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
    );
    expect(built.data).toMatchObject({ cash: null, investments: null, netWorth: null });
    expect(built.presentation).toMatchObject({
      kind: "finance_snapshot",
      position: { cash: null, debt: 2_300, investments: null, netWorth: null },
      trust: { state: "partial", trustworthy: false },
    });
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
});
