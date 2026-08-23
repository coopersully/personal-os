import { parseSetupJurisdiction, parseSetupMoney, setupProfileChange } from "./setup-service.js";

describe("Finance setup answer parsing", () => {
  it.each([
    ["Brooklyn, New York", "US-NY"],
    ["California", "US-CA"],
    ["Austin, Texas", "US-TX"],
    ["Miami, Florida", "US-FL"],
    ["Toronto, Ontario", "Toronto, Ontario"],
  ])("normalizes %s to %s", (answer, expected) => {
    expect(parseSetupJurisdiction(answer)).toBe(expected);
  });

  it("parses formatted money and rejects invalid or negative amounts", () => {
    expect(parseSetupMoney("$8,000.25")).toBe(8000.25);
    expect(parseSetupMoney("0")).toBe(0);
    expect(() => parseSetupMoney("unknown")).toThrow("non-negative");
    expect(() => parseSetupMoney("-1")).toThrow("non-negative");
  });

  it("maps each deterministic question to exactly one profile fact", () => {
    expect(setupProfileChange("profile:location", "New York")).toEqual({
      jurisdiction: "US-NY",
    });
    expect(setupProfileChange("profile:household_size", "2")).toEqual({ householdSize: 2 });
    expect(setupProfileChange("profile:monthly_take_home", "5000")).toEqual({
      expectedMonthlyTakeHome: 5000,
    });
    expect(setupProfileChange("profile:liquid_reserves", "10000")).toEqual({
      liquidReserves: 10000,
    });
    expect(() => setupProfileChange("profile:household_size", "0")).toThrow("positive");
    expect(() => setupProfileChange("profile:household_size", "1.5")).toThrow("whole");
    expect(() => setupProfileChange("profile:household_size", "101")).toThrow("positive");
  });
});
