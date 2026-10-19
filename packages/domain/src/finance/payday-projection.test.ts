import { describe, expect, it } from "vitest";
import {
  type PaydayActualMovement,
  type PaydayOccurrence,
  type PaydayProjectionInput,
  projectPaydayCycle,
} from "./payday-projection.js";

function occurrence(changes: Partial<PaydayOccurrence> = {}): PaydayOccurrence {
  return {
    id: "payday",
    version: "income:v2",
    localDate: "2026-10-30",
    amountMinorUnits: 1000,
    currencyCode: "USD",
    accountId: "cash",
    direction: "incoming",
    classification: "external_income",
    incomeStreamId: "job",
    pairedOccurrenceId: null,
    remainingExpectedMinorUnits: 1000,
    matches: [],
    ...changes,
  };
}
function actual(changes: Partial<PaydayActualMovement> = {}): PaydayActualMovement {
  return {
    id: "actual",
    version: "movement:v1",
    localDate: "2026-10-20",
    amountMinorUnits: 200,
    currencyCode: "USD",
    accountId: "cash",
    direction: "outgoing",
    classification: "external_expense",
    pairedMovementId: null,
    postingStatus: "posted",
    balanceReflection: "not_included",
    ...changes,
  };
}
function first<T>(rows: readonly T[]): T {
  const row = rows[0];
  if (row === undefined) throw new Error("Fixture requires a row.");
  return row;
}

function fixture(): PaydayProjectionInput {
  return {
    periodStartLocalDate: "2026-10-15",
    asOfLocalDate: "2026-10-18",
    asOfInstant: "2026-10-18T12:00:00Z",
    selectedIncomeStreamId: "job",
    nextPayday: { occurrenceId: "payday", localDate: "2026-10-30", dateBasis: "authoritative" },
    balances: [
      {
        accountId: "cash",
        accountKind: "cash",
        basis: "current",
        amountMinorUnits: 500,
        currencyCode: "USD",
        asOfInstant: "2026-10-18T11:00:00Z",
        validUntilInstant: "2026-10-18T13:00:00Z",
        sourceRevision: "balance:v1",
        included: true,
        ownershipFraction: 1,
      },
    ],
    occurrences: [
      occurrence(),
      occurrence({
        id: "bill",
        version: "bill:v1",
        localDate: "2026-10-20",
        amountMinorUnits: 600,
        remainingExpectedMinorUnits: 600,
        direction: "outgoing",
        classification: "external_expense",
        incomeStreamId: null,
      }),
    ],
    actualMovements: [],
  };
}
function reasons(input: PaydayProjectionInput) {
  const result = projectPaydayCycle(input);
  expect(result.status).toBe("unavailable");
  return result.status === "unavailable" ? result.reasons.map((item) => item.code) : [];
}

describe("projectPaydayCycle", () => {
  it("requires owned balance evidence and rejects duplicate account statements", () => {
    const input = fixture();
    input.balances = [];
    expect(reasons(input)).toContain("invalid_balance_basis");
    input.balances = [first(fixture().balances), first(fixture().balances)];
    expect(projectPaydayCycle(input)).toMatchObject({
      status: "unavailable",
      reasons: expect.arrayContaining([{ code: "duplicate_identity", evidenceId: "cash" }]),
    });
  });

  it.each([
    { label: "missing source revision", changes: { version: "" }, reason: "missing_revision" },
    { label: "missing account", changes: { accountId: "" }, reason: "invalid_scope" },
    {
      label: "unsupported currency",
      changes: { currencyCode: "ZZZ" },
      reason: "unsupported_currency",
    },
    { label: "mixed currency", changes: { currencyCode: "EUR" }, reason: "mixed_currency" },
    { label: "date after payday", changes: { localDate: "2026-10-31" }, reason: "invalid_period" },
    {
      label: "expense labeled incoming",
      changes: { classification: "external_expense" as const, direction: "incoming" as const },
      reason: "unclassified_movement",
    },
    {
      label: "external movement with transfer reference",
      changes: { pairedMovementId: "other" },
      reason: "unpaired_transfer",
    },
  ])("withholds cash estimates for $label actual evidence", ({ changes, reason }) => {
    const input = fixture();
    input.actualMovements = [actual(changes)];
    expect(reasons(input)).toContain(reason);
  });

  it("rejects duplicate expected identities and matches whose actual receipt is missing", () => {
    const input = fixture();
    input.occurrences = [occurrence(), occurrence()];
    expect(reasons(input)).toContain("duplicate_identity");
    input.occurrences = [
      occurrence({
        remainingExpectedMinorUnits: 800,
        matches: [{ actualMovementId: "missing", replacedExpectedMinorUnits: 200 }],
      }),
    ];
    expect(reasons(input)).toContain("invalid_match");
    input.occurrences = [
      occurrence({
        remainingExpectedMinorUnits: 1000,
        matches: [{ actualMovementId: "missing", replacedExpectedMinorUnits: -1 }],
      }),
    ];
    expect(reasons(input)).toContain("invalid_match");
  });

  it.each([
    { label: "future statement", changes: { asOfLocalDate: "2026-10-19" } },
    { label: "invalid date", changes: { asOfLocalDate: "2026-02-30" } },
    { label: "missing revision", changes: { sourceRevision: "" } },
    { label: "wrong currency", changes: { currencyCode: "EUR" } },
    { label: "missing amount", changes: { amountMinorUnits: null } },
    { label: "repeated account", changes: { accountIds: ["cash", "cash"] } },
  ])("refuses a protected floor with $label", ({ changes }) => {
    const input = fixture();
    input.protectedFloor = {
      amountMinorUnits: 100,
      currencyCode: "USD",
      accountIds: ["cash"],
      confirmed: true,
      asOfLocalDate: "2026-10-18",
      sourceRevision: "floor:1",
      ...changes,
    };
    expect(reasons(input)).toContain("invalid_floor");
  });

  it("keeps an already received payday and an included actual in opening cash without inventing another receipt", () => {
    const input = fixture();
    input.occurrences = [
      occurrence({
        remainingExpectedMinorUnits: 0,
        matches: [{ actualMovementId: "received", replacedExpectedMinorUnits: 1000 }],
      }),
    ];
    input.actualMovements = [
      actual({
        id: "received",
        direction: "incoming",
        classification: "external_income",
        amountMinorUnits: 1000,
        balanceReflection: "included",
      }),
    ];
    expect(projectPaydayCycle(input)).toMatchObject({
      status: "estimated",
      openingBalanceMinorUnits: 500,
      endingBalanceMinorUnits: 500,
      expectedEndPaydayIncomeMinorUnits: 0,
      days: [],
      lowestEndOfDayBalance: { amountMinorUnits: 500, basis: "opening" },
      evidence: { actualMovements: [{ id: "received", balanceReflection: "included" }] },
    });
  });
  it("projects explicit selected income, inclusive payday estimate and lowest end-of-day without mutation", () => {
    const input = fixture();
    input.occurrences = [
      ...input.occurrences,
      occurrence({
        id: "other-pay",
        incomeStreamId: "other-job",
        amountMinorUnits: 50,
        remainingExpectedMinorUnits: 50,
      }),
    ];
    const before = structuredClone(input);
    const result = projectPaydayCycle(input);
    expect(result.status).toBe("estimated");
    if (result.status !== "estimated") return;
    expect(result.openingBalanceMinorUnits).toBe(500);
    expect(result.endingBalanceMinorUnits).toBe(950);
    expect(result.expectedEndPaydayIncomeMinorUnits).toBe(1000);
    expect(result.lowestEndOfDayBalance).toEqual({
      amountMinorUnits: -100,
      localDate: "2026-10-20",
      basis: "end_of_day",
    });
    expect(result.protectedFloor).toEqual({ status: "unknown" });
    expect(result.assumptions.join(" ")).toContain("intraday lows are unknown");
    expect(result.evidence.balances[0]?.basis).toBe("current");
    first(result.evidence.balances).sourceRevision = "output edit";
    expect(input).toEqual(before);
  });

  it("never guesses income selection or next date for multiple/variable streams", () => {
    const input = fixture();
    input.selectedIncomeStreamId = null;
    expect(reasons(input)).toContain("income_selection_required");
    input.selectedIncomeStreamId = "other-job";
    expect(reasons(input)).toContain("next_payday_unavailable");
    input.selectedIncomeStreamId = "job";
    input.nextPayday.dateBasis = "variable";
    expect(reasons(input)).toContain("next_payday_unavailable");
    input.nextPayday.dateBasis = "unknown";
    input.nextPayday.localDate = null;
    expect(reasons(input)).toContain("invalid_period");
  });

  it("requires an explicit freshness interval, not merely the same calendar day", () => {
    const input = fixture();
    const balance = { ...first(input.balances) };
    input.balances = [balance];
    balance.validUntilInstant = "2026-10-18T11:59:59Z";
    expect(reasons(input)).toContain("stale_balance");
    balance.validUntilInstant = "2026-10-18T13:00:00Z";
    balance.asOfInstant = "2026-10-18T12:00:01Z";
    expect(reasons(input)).toContain("stale_balance");
    balance.asOfInstant = "not an instant";
    expect(reasons(input)).toContain("invalid_date");
  });

  it("withholds incomplete account basis, noncash scope, mixed currency and partial ownership", () => {
    for (const changes of [
      { basis: "unknown" as const },
      { amountMinorUnits: null },
      { ownershipFraction: 0.5 },
      { included: false },
      { accountKind: "other" as const },
      { currencyCode: "JPY" },
      { sourceRevision: "" },
    ]) {
      const input = fixture();
      input.balances = [{ ...first(input.balances), ...changes }];
      expect(reasons(input).length).toBeGreaterThan(0);
    }
    const input = fixture();
    input.balances = [
      ...input.balances,
      { ...first(input.balances), accountId: "euro", currencyCode: "EUR" },
    ];
    expect(reasons(input)).toContain("mixed_currency");
  });

  it.each([
    "current",
    "available",
  ] as const)("replaces matched expectations and respects explicit %s reflection independently of pending status", (basis) => {
    const input = fixture();
    input.balances = [{ ...first(input.balances), basis }];
    input.occurrences = [
      first(input.occurrences),
      occurrence({
        id: "bill",
        direction: "outgoing",
        classification: "external_expense",
        localDate: "2026-10-20",
        amountMinorUnits: 600,
        remainingExpectedMinorUnits: 400,
        matches: [{ actualMovementId: "actual", replacedExpectedMinorUnits: 200 }],
      }),
    ];
    input.actualMovements = [actual({ postingStatus: "pending" })];
    let result = projectPaydayCycle(input);
    expect(result.status === "estimated" && result.endingBalanceMinorUnits).toBe(900);
    expect(
      result.status === "estimated" && result.days[0]?.events.map((event) => event.kind),
    ).toEqual(["pending", "expected"]);
    input.actualMovements = [actual({ postingStatus: "pending", balanceReflection: "included" })];
    result = projectPaydayCycle(input);
    expect(result.status === "estimated" && result.endingBalanceMinorUnits).toBe(1100);
    input.actualMovements = [actual({ balanceReflection: "unknown" })];
    expect(reasons(input)).toContain("unknown_reflection");
  });

  it("rejects unknown residuals, invalid replacement and repeated actual identities", () => {
    const input = fixture();
    input.occurrences = [occurrence({ remainingExpectedMinorUnits: null })];
    expect(reasons(input)).toContain("unknown_residual");
    input.occurrences = [
      occurrence({
        remainingExpectedMinorUnits: 800,
        matches: [{ actualMovementId: "actual", replacedExpectedMinorUnits: 200 }],
      }),
    ];
    input.actualMovements = [actual()];
    expect(reasons(input)).toContain("invalid_match");
    const incomingActual = actual({ direction: "incoming", classification: "external_income" });
    input.actualMovements = [incomingActual, { ...incomingActual }];
    expect(reasons(input)).toContain("duplicate_identity");
    input.actualMovements = [incomingActual];
    input.occurrences = [
      ...input.occurrences,
      occurrence({
        id: "payday-other",
        remainingExpectedMinorUnits: 800,
        matches: [{ actualMovementId: "actual", replacedExpectedMinorUnits: 200 }],
      }),
    ];
    expect(reasons(input)).toContain("invalid_match");
  });

  it("withholds an estimate for an unpaid predecessor even when a successor commitment exists", () => {
    const input = fixture();
    input.occurrences = [
      first(input.occurrences),
      occurrence({
        id: "predecessor-bill",
        version: "bill:old",
        localDate: "2026-10-15",
        direction: "outgoing",
        classification: "external_expense",
        amountMinorUnits: 200,
        remainingExpectedMinorUnits: 200,
      }),
      occurrence({
        id: "successor-bill",
        version: "bill:new",
        localDate: "2026-10-20",
        direction: "outgoing",
        classification: "external_expense",
        amountMinorUnits: 300,
        remainingExpectedMinorUnits: 300,
      }),
    ];
    expect(reasons(input)).toContain("overdue_expected");
  });

  it("rejects duplicate references within one occurrence even when aggregate capacity remains", () => {
    const input = fixture();
    input.actualMovements = [actual()];
    input.occurrences = [
      first(input.occurrences),
      occurrence({
        id: "bill",
        localDate: "2026-10-20",
        direction: "outgoing",
        classification: "external_expense",
        amountMinorUnits: 200,
        remainingExpectedMinorUnits: 0,
        matches: [
          { actualMovementId: "actual", replacedExpectedMinorUnits: 100 },
          { actualMovementId: "actual", replacedExpectedMinorUnits: 100 },
        ],
      }),
    ];
    expect(reasons(input)).toContain("duplicate_identity");
  });

  it("shares an actual capacity across distinct occurrences without counting its cash twice", () => {
    const input = fixture();
    input.occurrences = [
      first(input.occurrences),
      occurrence({
        id: "bill-a",
        localDate: "2026-10-20",
        direction: "outgoing",
        classification: "external_expense",
        amountMinorUnits: 100,
        remainingExpectedMinorUnits: 0,
        matches: [{ actualMovementId: "actual", replacedExpectedMinorUnits: 100 }],
      }),
      occurrence({
        id: "bill-b",
        localDate: "2026-10-21",
        direction: "outgoing",
        classification: "external_expense",
        amountMinorUnits: 100,
        remainingExpectedMinorUnits: 0,
        matches: [{ actualMovementId: "actual", replacedExpectedMinorUnits: 100 }],
      }),
    ];
    input.actualMovements = [actual()];
    expect(projectPaydayCycle(input)).toMatchObject({
      status: "estimated",
      endingBalanceMinorUnits: 1300,
    });
    input.occurrences = [
      ...input.occurrences.slice(0, 2),
      occurrence({
        id: "bill-b",
        localDate: "2026-10-21",
        direction: "outgoing",
        classification: "external_expense",
        amountMinorUnits: 101,
        remainingExpectedMinorUnits: 0,
        matches: [{ actualMovementId: "actual", replacedExpectedMinorUnits: 101 }],
      }),
    ];
    expect(reasons(input)).toContain("invalid_match");
  });

  it("accepts historical included actual references but refuses unexplained historical cash", () => {
    const input = fixture();
    input.occurrences = [
      first(input.occurrences),
      occurrence({
        id: "bill",
        localDate: "2026-10-20",
        direction: "outgoing",
        classification: "external_expense",
        amountMinorUnits: 200,
        remainingExpectedMinorUnits: 0,
        matches: [{ actualMovementId: "actual", replacedExpectedMinorUnits: 200 }],
      }),
    ];
    input.actualMovements = [actual({ localDate: "2026-10-01", balanceReflection: "included" })];
    expect(projectPaydayCycle(input)).toMatchObject({
      status: "estimated",
      endingBalanceMinorUnits: 1500,
    });
    input.actualMovements = [
      actual({ localDate: "2026-10-01", balanceReflection: "not_included" }),
    ];
    expect(projectPaydayCycle(input).status).toBe("unavailable");
  });

  it.each([
    "internal_transfer",
    "card_payment",
  ] as const)("counts only scoped %s legs, exactly once", (classification) => {
    const input = fixture();
    input.occurrences = [first(input.occurrences)];
    input.actualMovements = [
      actual({ id: "debit", classification, pairedMovementId: "credit" }),
      actual({
        id: "credit",
        accountId: "outside",
        direction: "incoming",
        classification,
        pairedMovementId: "debit",
        balanceReflection: "unknown",
      }),
    ];
    let result = projectPaydayCycle(input);
    expect(result.status === "estimated" && result.endingBalanceMinorUnits).toBe(1300);
    input.balances = [
      ...input.balances,
      { ...first(input.balances), accountId: "outside", amountMinorUnits: 0 },
    ];
    input.actualMovements = input.actualMovements.map((row) => ({
      ...row,
      balanceReflection: "not_included" as const,
    }));
    result = projectPaydayCycle(input);
    expect(result.status === "estimated" && result.endingBalanceMinorUnits).toBe(1500);
    input.actualMovements = [first(input.actualMovements)];
    expect(reasons(input)).toContain("unpaired_transfer");
  });

  it("qualifies canonical expected transfer pairs and does not count an unscoped counterpart", () => {
    const input = fixture();
    input.occurrences = [
      first(input.occurrences),
      occurrence({
        id: "out",
        direction: "outgoing",
        classification: "internal_transfer",
        pairedOccurrenceId: "in",
        amountMinorUnits: 100,
        remainingExpectedMinorUnits: 100,
      }),
      occurrence({
        id: "in",
        accountId: "outside",
        classification: "internal_transfer",
        pairedOccurrenceId: "out",
        amountMinorUnits: 100,
        remainingExpectedMinorUnits: 100,
      }),
    ];
    const result = projectPaydayCycle(input);
    expect(result.status === "estimated" && result.endingBalanceMinorUnits).toBe(1400);
    input.occurrences = input.occurrences.map((row) =>
      row.id === "in" ? { ...row, pairedOccurrenceId: null } : row,
    );
    expect(reasons(input)).toContain("unpaired_transfer");
  });

  it("aggregates same-day flows without asserting an intraday low", () => {
    const input = fixture();
    input.occurrences = [
      first(input.occurrences),
      occurrence({
        id: "bill",
        direction: "outgoing",
        classification: "external_expense",
        amountMinorUnits: 1400,
        remainingExpectedMinorUnits: 1400,
      }),
    ];
    const result = projectPaydayCycle(input);
    expect(result.status === "estimated" && result.lowestEndOfDayBalance.amountMinorUnits).toBe(
      100,
    );
    expect(result.status === "estimated" && result.days).toHaveLength(1);
  });

  it("distinguishes absent floor from explicit confirmed zero and rejects unqualified floors", () => {
    const input = fixture();
    let result = projectPaydayCycle(input);
    expect(result.status === "estimated" && result.protectedFloor.status).toBe("unknown");
    input.protectedFloor = {
      amountMinorUnits: 0,
      currencyCode: "USD",
      accountIds: ["cash"],
      confirmed: true,
      asOfLocalDate: "2026-10-18",
      sourceRevision: "floor:v1",
    };
    result = projectPaydayCycle(input);
    expect(result.status === "estimated" && result.protectedFloor).toEqual({
      status: "confirmed",
      amountMinorUnits: 0,
      lowestEndOfDayMarginMinorUnits: -100,
      belowFloorAtEndOfDay: true,
      sourceRevision: "floor:v1",
    });
    input.protectedFloor.confirmed = false;
    expect(reasons(input)).toContain("invalid_floor");
    input.protectedFloor.confirmed = true;
    input.protectedFloor.accountIds = ["other"];
    expect(reasons(input)).toContain("invalid_floor");
  });

  it("bounds money, records, dates, missing classifications and overdue evidence", () => {
    for (const value of [NaN, Infinity, 0.1, -1, 10_000_000_001]) {
      const input = fixture();
      input.occurrences = [occurrence({ amountMinorUnits: value })];
      expect(reasons(input)).toContain("invalid_money");
    }
    let input = fixture();
    input.occurrences = [occurrence({ localDate: "2026-02-30" })];
    expect(reasons(input)).toContain("invalid_date");
    input = fixture();
    input.occurrences = [occurrence({ classification: "unknown" })];
    expect(reasons(input)).toContain("unclassified_movement");
    input = fixture();
    input.actualMovements = [actual({ localDate: "2026-10-16" })];
    expect(reasons(input)).toContain("past_unreflected_movement");
    input = fixture();
    input.occurrences = [
      ...input.occurrences,
      occurrence({ id: "overdue", localDate: "2026-10-16" }),
    ];
    expect(reasons(input)).toContain("overdue_expected");
    input = fixture();
    input.actualMovements = Array.from({ length: 1001 }, () => actual());
    expect(reasons(input)).toEqual(["exceeds_bounds"]);
    input = fixture();
    input.periodStartLocalDate = "2025-01-01";
    expect(reasons(input)).toContain("invalid_period");
  });
});
