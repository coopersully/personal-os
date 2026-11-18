import { describe, expect, it } from "vitest";
import { budgetPace, categoryIcon, categoryLabel } from "./category-presentation";

describe("budget pacing", () => {
  const midmonth = new Date("2026-11-15T20:00:00Z");
  it("distinguishes normal, ahead-of-pace, and overspent", () => {
    expect(budgetPace(50, 100, "America/New_York", midmonth)).toBe("normal");
    expect(budgetPace(60, 100, "America/New_York", midmonth)).toBe("high");
    expect(budgetPace(101, 100, "America/New_York", midmonth)).toBe("over");
  });
  it("uses the user day and actual month length", () => {
    const midnight = new Date("2026-12-01T01:00:00Z");
    expect(budgetPace(90, 100, "America/New_York", midnight)).toBe("normal");
    expect(budgetPace(90, 100, "UTC", midnight)).toBe("high");
    expect(budgetPace(50, 100, "UTC", new Date("2028-02-14T12:00:00Z"))).toBe("high");
  });
  it("does not warn for refunds or invent a pace without a valid limit/timezone", () => {
    expect(budgetPace(-5, 100, "UTC", midmonth)).toBe("normal");
    expect(budgetPace(10, 0, "UTC", midmonth)).toBe("unknown");
    expect(budgetPace(10, 100, null, midmonth)).toBe("unknown");
  });
});
it("reuses semantic category identities for rows and allocations", () => {
  expect(categoryIcon("Groceries")).toBe("categoryGroceryCart");
  expect(categoryIcon("Dining")).toBe("categoryDining");
  expect(categoryIcon("Subscriptions")).toBe("receipt");
  expect(categoryIcon("Custom envelope")).toBe("categoryTags");
});

it("honors authoritative group icons and custom bucket fallback", () => {
  expect(categoryIcon("Custom group", "travel")).toBe("categoryTravel");
  expect(categoryIcon("Custom group", undefined, "bucket")).toBe("categoryLayers");
});

describe("category labels", () => {
  it("reads a provider-coded name as words, matching web", () => {
    expect(categoryLabel("RENT_AND_UTILITIES")).toBe("Rent And Utilities");
    expect(categoryLabel("FOOD_AND_DRINK")).toBe("Food & Drink");
    expect(categoryLabel("TRANSFER_OUT")).toBe("Transfers");
    // One-word provider codes are codes too.
    expect(categoryLabel("ENTERTAINMENT")).toBe("Entertainment");
    expect(categoryLabel("MEDICAL")).toBe("Medical");
    expect(categoryLabel("TRANSPORTATION")).toBe("Transportation");
    expect(categoryLabel("TRAVEL")).toBe("Travel");
    expect(categoryLabel("INCOME")).toBe("Income");
    expect(categoryLabel("OTHER")).toBe("Other");
    expect(categoryLabel("GOVERNMENT_AND_NON_PROFIT")).toBe("Government And Non Profit");
  });
  it("leaves names a person wrote untouched and names a missing category", () => {
    expect(categoryLabel("Pet care")).toBe("Pet care");
    expect(categoryLabel("HSA")).toBe("HSA");
    expect(categoryLabel("401k_rollover")).toBe("401k_rollover");
    // Capitals alone do not make a name a provider code.
    expect(categoryLabel("IRA")).toBe("IRA");
    expect(categoryLabel("KIDS_SCHOOL")).toBe("KIDS_SCHOOL");
    expect(categoryLabel(null)).toBe("Uncategorized");
  });
});
