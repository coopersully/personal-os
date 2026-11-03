import { projectPaydayCycle } from "@personal-os/domain";
import {
  type BudgetRoomSources,
  budgetRoomCommunication,
  projectFinanceBudgetRoom,
} from "./budget-room.js";
import { buildFinancePosition } from "./position.js";
import { buildFinanceSpendingDashboard } from "./spending-service.js";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const asOf = "2026-11-02T16:00:00.000Z";
function fixture(): BudgetRoomSources {
  const account = {
    id: id(2),
    userId: id(1),
    balance: 20000,
    currencyCode: "USD",
    includeInPlanning: true,
    kind: "cash" as const,
    ownershipType: "individual" as const,
    ownershipShareBps: 10000,
    reasons: [],
    source: { id: id(2), revision: "cash-1" },
  };
  const evidence = {
    userId: id(1),
    accounts: [account],
    transactions: [
      {
        id: id(3),
        userId: id(1),
        accountId: id(2),
        categoryId: id(4),
        amount: 1000,
        currencyCode: "USD",
        category: "FOOD",
        direction: "expense" as const,
        providerDirection: "expense" as const,
        pending: false,
        pendingTransactionId: null,
        providerTransactionId: "purchase",
        reconciliationStatus: "not_applicable" as const,
        transactionDate: "2026-11-01",
        transferGroupId: null,
      },
    ],
    allocations: [],
    matches: [],
    reimbursements: [],
    relationships: [],
  };
  const scope = {
    from: "2026-11-01",
    through: "2026-11-02",
    timezone: "America/New_York",
    accountIds: [id(2)],
    categoryIds: null,
    basis: "personal_cost" as const,
    includePending: true,
    subtractRefunds: true,
  };
  const spending = buildFinanceSpendingDashboard(
    { ...evidence, asOf, coverage: "complete" },
    { scope, grouping: "categories", includeUncategorized: true },
    {
      accounts: [{ id: id(2), label: "Cash" }],
      categories: [{ id: id(4), label: "Food" }],
      buckets: [],
      transactions: [],
      source: { freshness: "current", lastSyncedAt: asOf, reasons: [] },
    },
  );
  const reserve = (n: number, amount: number) => ({
    cents: amount,
    currency: "USD" as const,
    quality: "verified" as const,
    reasons: [],
    sources: [{ id: id(n), revision: "confirmed-1" }],
  });
  const position = buildFinancePosition({
    ...evidence,
    asOf,
    scope: { from: scope.from, through: scope.through, accountIds: [id(2)] },
    activitySource: { id: id(1), revision: "ledger-1" },
    committed: reserve(8, 17000),
    protected: reserve(9, 1000),
  }).position;
  const budget = {
    id: id(5),
    planId: id(6),
    version: 2,
    effectiveFrom: "2026-11",
    status: "active" as const,
    approvedAt: "2026-11-01T12:00:00.000Z",
    createdAt: "2026-11-01T11:00:00.000Z",
    profileVersionId: null,
    expectedResources: 100,
    allocatedTotal: 100,
    balanceDelta: 0,
    assumptions: [],
    rationale: "Approved fixture",
    resources: [{ key: "income", kind: "income" as const, amount: 100, sourceId: id(10) }],
    allocations: [{ key: "food", kind: "spending" as const, categoryId: id(4), amount: 100 }],
  };
  const projection = projectPaydayCycle({
    periodStartLocalDate: "2026-11-02",
    asOfLocalDate: "2026-11-02",
    asOfInstant: asOf,
    selectedIncomeStreamId: id(10),
    nextPayday: { occurrenceId: id(11), localDate: "2026-11-10", dateBasis: "authoritative" },
    balances: [
      {
        accountId: id(2),
        accountKind: "cash",
        basis: "current",
        amountMinorUnits: 20000,
        currencyCode: "USD",
        asOfInstant: asOf,
        validUntilInstant: "2026-11-03T16:00:00.000Z",
        sourceRevision: "basis-1",
        included: true,
        ownershipFraction: 1,
      },
    ],
    occurrences: [
      {
        id: id(11),
        version: "payday-1",
        localDate: "2026-11-10",
        amountMinorUnits: 50000,
        currencyCode: "USD",
        accountId: id(2),
        direction: "incoming",
        classification: "external_income",
        incomeStreamId: id(10),
        pairedOccurrenceId: null,
        remainingExpectedMinorUnits: 50000,
        matches: [],
      },
      {
        id: id(12),
        version: "bill-1",
        localDate: "2026-11-05",
        amountMinorUnits: 17000,
        currencyCode: "USD",
        accountId: id(2),
        direction: "outgoing",
        classification: "external_expense",
        incomeStreamId: null,
        pairedOccurrenceId: null,
        remainingExpectedMinorUnits: 17000,
        matches: [],
      },
    ],
    actualMovements: [],
    protectedFloor: {
      amountMinorUnits: 1000,
      currencyCode: "USD",
      accountIds: [id(2)],
      confirmed: true,
      asOfLocalDate: "2026-11-02",
      sourceRevision: "floor-1",
    },
  });
  return {
    ownerUserId: id(1),
    asOf,
    budget,
    context: {
      month: "2026-11",
      timezone: scope.timezone,
      state: "approved",
      recovery: "none",
      current: { ...budget, spendingTotal: 100 },
      previous: null,
      upcoming: null,
    },
    qualification: {
      state: "qualified",
      qualification: {
        id: id(7),
        revision: 1,
        month: "2026-11",
        period: { from: "2026-11-01", through: "2026-11-30", timezone: scope.timezone },
        accountIds: [id(2)],
        currency: "USD",
        allocations: [
          {
            key: "food",
            categoryId: id(4),
            legacyCategory: null,
            label: "Food",
            amountCents: 10000,
          },
        ],
        budgetVersionId: id(15),
        budgetVersion: 1,
        planId: id(6),
        sourceBaselineId: null,
        confirmedAt: "2026-11-01T13:00:00.000Z",
        confirmedByActorId: id(1),
        qualificationKind: "current",
        originalApproval: {
          approvedAt: "2026-11-01T12:00:00.000Z",
          actorType: "user",
          actorId: id(1),
        },
      },
    },
    spending,
    position,
    cashflow: {
      projection,
      schedule: {
        from: "2026-11-02",
        to: "2026-11-30",
        occurrences: [],
        matchEvents: [],
        unavailableSources: [],
      },
    },
    fundingAccountIds: [id(2)],
  };
}
function required<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error("Missing fixture");
  return value;
}
describe("Qualified category room", () => {
  it("reserves confirmed obligations/floor before room without double subtracting or counting a future paycheck as cash", () => {
    const result = projectFinanceBudgetRoom(fixture());
    expect(result).toMatchObject({
      state: "estimated",
      reasons: [],
      categories: [
        {
          budgetCents: 10000,
          observedCents: 1000,
          observedRemainingCents: 9000,
          estimatedUsableCents: 2000,
        },
      ],
    });
    expect(result.assumptions).toContain("Future cashflow is estimated, not permission to spend.");
  });
  it.each([
    "partial",
    "unknown",
  ] as const)("retains observed amounts but withholds room for %s coverage", (coverage) => {
    const input = fixture();
    required(input.spending).snapshot.coverage = coverage;
    const result = projectFinanceBudgetRoom(input);
    expect(result.reasons).toContain("transaction_history_incomplete");
    expect(result.categories[0]).toMatchObject({
      observedRemainingCents: 9000,
      estimatedUsableCents: null,
    });
  });
  it("never treats unknown commitments or protected floor as zero", () => {
    const input = fixture();
    const position = required(input.position);
    position.committed = {
      cents: null,
      currency: "USD",
      quality: "unavailable",
      reasons: ["missing_commitments"],
      sources: [],
    };
    const forecast = required(input.cashflow).projection;
    if (forecast.status !== "estimated") throw new Error("Fixture forecast missing");
    forecast.protectedFloor = { status: "unknown" };
    const result = projectFinanceBudgetRoom(input);
    expect(result.reasons).toEqual(
      expect.arrayContaining(["obligation_completeness_unknown", "protection_unknown"]),
    );
    expect(result.categories[0]?.estimatedUsableCents).toBeNull();
  });
  it("preserves unknown payday reasons and never converts an unavailable forecast into zero", () => {
    const input = fixture();
    required(input.cashflow).projection = {
      status: "unavailable",
      reasons: [{ code: "income_selection_required", evidenceId: null }],
    };
    const result = projectFinanceBudgetRoom(input);
    expect(result.reasons).toContain("payday:income_selection_required");
    expect(result.categories[0]?.estimatedUsableCents).toBeNull();
  });
  it.each([
    "source",
    "recognition",
    "revision",
    "scope",
    "instant",
  ])("withholds usable room for incompatible %s evidence", (kind) => {
    const input = fixture();
    const spending = required(input.spending);
    if (kind === "source") spending.source.freshness = "stale";
    if (kind === "recognition")
      spending.snapshot.qualifications.push({ code: "ownership_unknown", sourceIds: [id(2)] });
    if (kind === "revision") delete spending.referenceRevision;
    if (kind === "scope") spending.snapshot.scope.accountIds = [id(99)];
    if (kind === "instant") spending.snapshot.asOf = "2026-11-01T16:00:00.000Z";
    expect(projectFinanceBudgetRoom(input).categories[0]?.estimatedUsableCents).toBeNull();
  });
  it("keeps a shortfall negative and uses the current allocation instead of an immutable older comparison target", () => {
    const input = fixture();
    required(input.budget.allocations[0]).amount = 5;
    required(input.budget.resources[0]).amount = 5;
    input.budget.expectedResources = 5;
    input.budget.allocatedTotal = 5;
    const result = projectFinanceBudgetRoom(input);
    expect(result.categories[0]).toMatchObject({
      budgetCents: 500,
      observedRemainingCents: -500,
      estimatedUsableCents: -500,
    });
  });
  it("binds each actual producer revision and owner into the read snapshot", () => {
    const input = fixture();
    const old = projectFinanceBudgetRoom(input).revision;
    required(input.spending).referenceRevision = "changed-ledger";
    expect(projectFinanceBudgetRoom(input).revision).not.toBe(old);
    const next = projectFinanceBudgetRoom(input).revision;
    input.ownerUserId = id(99);
    expect(projectFinanceBudgetRoom(input).revision).not.toBe(next);
  });
  it("rejects prior-month approval as current room and labels unknown usage honestly", () => {
    const input = fixture();
    input.budget.effectiveFrom = "2026-10";
    const room = projectFinanceBudgetRoom(input);
    expect(room.reasons).toContain("current_approved_budget_required");
    expect(room.categories[0]?.observedCents).toBeNull();
    expect(budgetRoomCommunication(room).disclosures[0]).toContain(
      "Usable category room is unavailable",
    );
  });
  it.each([
    "different",
    "missing",
  ])("rejects a payday whose income identity is %s from the approved resources", (kind) => {
    const input = fixture();
    const forecast = required(input.cashflow).projection;
    if (forecast.status !== "estimated") throw new Error("Missing fixture forecast");
    if (kind === "different") forecast.selectedIncomeStreamId = id(99);
    else delete required(input.budget.resources[0]).sourceId;
    const room = projectFinanceBudgetRoom(input);
    expect(room.reasons).toContain("income_scope_unqualified");
    expect(room.categories[0]?.estimatedUsableCents).toBeNull();
  });
  it("keeps estimated communication qualified and exposes the shared-funding assumption", () => {
    const room = projectFinanceBudgetRoom(fixture());
    const message = budgetRoomCommunication(room);
    expect(message.optionalDetails[0]).toContain("Estimated usable room before payday: $20.00");
    expect(message.disclosures).toContain("Future cashflow is estimated, not permission to spend.");
    expect(message.disclosures).toContain(
      "Category estimates share the same funding and must not be added together.",
    );
    expect(message.disclosures.join(" ")).not.toContain("verified");
  });
  it("withholds room when the forecast belongs to another funding account scope", () => {
    const input = fixture();
    const forecast = required(input.cashflow).projection;
    if (forecast.status !== "estimated") throw new Error("Missing forecast");
    forecast.evidence.balances[0] = {
      ...required(forecast.evidence.balances[0]),
      accountId: id(99),
    };
    const room = projectFinanceBudgetRoom(input);
    expect(room.reasons).toContain("payday_scope_mismatch");
    expect(room.categories[0]?.estimatedUsableCents).toBeNull();
  });
  it("does not borrow observed spending from a differently qualified planning timezone", () => {
    const input = fixture();
    if (input.qualification.state !== "qualified") throw new Error("Missing qualification");
    input.qualification.qualification.period.timezone = "UTC";
    const room = projectFinanceBudgetRoom(input);
    expect(room.reasons).toContain("scope_mismatch");
    expect(room.categories[0]).toMatchObject({ observedCents: null, estimatedUsableCents: null });
  });
  it("withholds usable room when the source contains unsupported currency", () => {
    const input = fixture();
    required(input.spending).currency.unsupported = [{ code: "EUR", transactionIds: [id(99)] }];
    const room = projectFinanceBudgetRoom(input);
    expect(room.reasons).toContain("unsupported_currency");
    expect(room.categories[0]?.estimatedUsableCents).toBeNull();
  });
});
