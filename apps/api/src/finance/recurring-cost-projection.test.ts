import { describe, expect, it } from "vitest";
import { projectRecurringCosts, type RecurringCostEvidence } from "./recurring-cost-projection.js";

const fixture = (changes: Partial<RecurringCostEvidence> = {}): RecurringCostEvidence => ({
  id: "record-1",
  serviceId: "service-1",
  kind: "subscription",
  status: "active",
  cadence: "monthly",
  amountCents: 101,
  amountBasis: "fixed",
  currencyCode: "USD",
  confirmation: "confirmed",
  ...changes,
});

describe("projectRecurringCosts", () => {
  it.each([
    ["weekly", 52],
    ["biweekly", 26],
    ["semimonthly", 24],
    ["monthly", 12],
    ["quarterly", 4],
    ["yearly", 1],
  ] as const)("normalizes %s without rounding", (cadence, factor) => {
    const result = projectRecurringCosts([fixture({ cadence })]);
    expect(result.records[0]?.normalized).toEqual({
      annualCents: 101 * factor,
      monthlyCents: { numerator: 101 * factor, denominator: 12 },
    });
  });

  it("keeps currencies and uncertain confirmation separate", () => {
    const result = projectRecurringCosts([
      fixture(),
      fixture({ id: "review", status: "needs_review" }),
      fixture({ id: "suspected", confirmation: "suspected" }),
      fixture({ id: "euro", currencyCode: "EUR" }),
      fixture({ currencyCode: null }),
    ]);
    expect(
      result.totals.map((g) => [
        g.currencyCode,
        g.confirmed?.annualCents,
        g.suspected?.annualCents,
      ]),
    ).toEqual([
      ["USD", 1212, 2424],
      ["EUR", 1212, 0],
    ]);
    expect(result.coverage).toEqual({ totalRecords: 5, normalizedRecords: 4, excludedRecords: 1 });
  });

  it.each([
    [{ kind: "savings" }, "savings"],
    [{ status: "paused" }, "paused"],
    [{ status: "cancelled" }, "cancelled"],
    [{ amountCents: null }, "missing_amount"],
    [{ amountBasis: "variable" }, "variable_amount"],
    [{ amountBasis: "unknown" }, "unknown_amount_basis"],
    [{ cadence: "irregular" }, "irregular_cadence"],
    [{ cadence: "unknown" }, "unknown_cadence"],
    [{ currencyCode: null }, "missing_currency"],
    [{ currencyCode: "usd" }, "invalid_currency"],
  ] satisfies [
    Partial<RecurringCostEvidence>,
    string,
  ][])("excludes unsupported evidence %j", (changes, reason) => {
    const result = projectRecurringCosts([fixture(changes)]);
    expect(result.records[0]?.exclusionReasons).toContain(reason);
    expect(result.records[0]?.normalized).toBeNull();
    expect(result.totals).toEqual([]);
  });

  it.each([
    -1,
    1.5,
    NaN,
    Infinity,
    Number.MAX_SAFE_INTEGER + 1,
  ])("rejects invalid cents %s", (amountCents) => {
    expect(
      projectRecurringCosts([fixture({ amountCents })]).records[0]?.exclusionReasons,
    ).toContain("invalid_amount");
  });

  it("distinguishes zero from unknown and bounds products and total sums", () => {
    expect(
      projectRecurringCosts([fixture({ amountCents: 0 })]).records[0]?.normalized?.annualCents,
    ).toBe(0);
    expect(
      projectRecurringCosts([fixture({ amountCents: Number.MAX_SAFE_INTEGER })]).records[0]
        ?.exclusionReasons,
    ).toContain("annual_amount_overflow");
    const result = projectRecurringCosts([
      fixture({ amountCents: Number.MAX_SAFE_INTEGER, cadence: "yearly" }),
      fixture({ amountCents: 1, cadence: "yearly" }),
    ]);
    expect(result.totals[0]?.confirmed).toBeNull();
    expect(result.totals[0]?.overflow.confirmed).toBe(true);
  });

  it("preserves independent source identity and provenance without price claims", () => {
    const source = fixture({ sourceReferences: ["manual:123"], asOf: "2026-10-18" });
    const result = projectRecurringCosts([
      source,
      fixture({ id: "other" }),
      fixture({ id: "standalone", serviceId: null }),
    ]);
    expect(result.records.map((r) => r.source.id)).toEqual(["record-1", "other", "standalone"]);
    expect(result.totals[0]?.confirmed?.annualCents).toBe(3636);
    expect(result.records[0]?.source).toEqual(source);
    expect(result.records[0]?.priceComparison).toEqual({
      available: false,
      reason: "no_price_history",
    });
    expect(result.records[2]?.priceComparison).toEqual({
      available: false,
      reason: "missing_service_identity",
    });
    expect(result.records[2]?.normalized?.annualCents).toBe(1212);
  });

  it("exposes all coverage gaps and suspected overflow independently", () => {
    const result = projectRecurringCosts([
      fixture({
        kind: "savings",
        status: "paused",
        cadence: "unknown",
        amountCents: null,
        amountBasis: "unknown",
        currencyCode: null,
      }),
      fixture({
        confirmation: "suspected",
        cadence: "yearly",
        amountCents: Number.MAX_SAFE_INTEGER,
      }),
      fixture({ confirmation: "suspected", cadence: "yearly", amountCents: 1 }),
    ]);
    expect(result.records[0]?.exclusionReasons).toEqual([
      "savings",
      "paused",
      "missing_amount",
      "unknown_amount_basis",
      "unknown_cadence",
      "missing_currency",
    ]);
    expect(result.totals[0]?.suspected).toBeNull();
    expect(result.totals[0]?.overflow).toEqual({ confirmed: false, suspected: true });
    expect(result.totals[0]?.confirmed?.annualCents).toBe(0);
  });

  it("copies provenance and treats blank service identity as unavailable", () => {
    const sourceReferences = ["manual:1"];
    const input = fixture({ serviceId: "  ", sourceReferences });
    const result = projectRecurringCosts([input]);
    sourceReferences.push("later");
    input.amountCents = 500;
    expect(result.records[0]?.source.sourceReferences).toEqual(["manual:1"]);
    expect(result.records[0]?.source.amountCents).toBe(101);
    expect(result.records[0]?.priceComparison.reason).toBe("missing_service_identity");
  });

  it("handles an empty collection", () => {
    expect(projectRecurringCosts([])).toEqual({
      records: [],
      totals: [],
      coverage: { totalRecords: 0, normalizedRecords: 0, excludedRecords: 0 },
    });
  });
});
