import { describe, expect, it } from "vitest";
import { budgetPace, categoryIcon } from "./category-presentation";

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
