import {
  parseSetupJurisdiction,
  parseSetupMoney,
  setupProfileChange,
  setupResult,
} from "./setup-service.js";

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

  it("parses formatted money and rejects empty or negative amounts", () => {
    expect(parseSetupMoney("$8,000.25")).toBe(8000.25);
    expect(parseSetupMoney("0")).toBe(0);
    expect(() => parseSetupMoney("   ")).toThrow("non-negative");
    expect(() => parseSetupMoney("unknown")).toThrow("non-negative");
    expect(() => parseSetupMoney("-1")).toThrow("non-negative");
  });

  it.each([
    "1.001",
    "1e3",
    "0x10",
    "Infinity",
    "100000000.01",
    "1,00",
    "1 00",
    "$$10",
  ])("rejects ambiguous or out-of-range money without inventing cents: %s", (answer) => {
    expect(() => parseSetupMoney(answer)).toThrow();
  });

  it.each([
    ["$8,000.25", 8000.25],
    [" 100.01 ", 100.01],
    ["0.01", 0.01],
    ["100000000", 100000000],
    ["0", 0],
  ])("preserves explicitly entered cents for %s", (answer, expected) => {
    expect(parseSetupMoney(answer)).toBe(expected);
  });

  it("maps each deterministic question to exactly one profile fact", () => {
    expect(setupProfileChange("profile:location", "New York")).toEqual({
      jurisdiction: "US-NY",
    });
    expect(setupProfileChange("profile:household_size", "2")).toEqual({ householdSize: 2 });
    expect(setupProfileChange("profile:monthly_take_home", "5000")).toEqual({
      expectedMonthlyTakeHome: 5000,
    });
    expect(setupProfileChange("profile:monthly_take_home", "0")).toEqual({
      expectedMonthlyTakeHome: 0,
    });
    expect(setupProfileChange("profile:liquid_reserves", "10000")).toEqual({
      liquidReserves: 10000,
    });
    expect(() => setupProfileChange("profile:household_size", "0")).toThrow("positive");
    expect(() => setupProfileChange("profile:household_size", "1.5")).toThrow("whole");
    expect(() => setupProfileChange("profile:household_size", "101")).toThrow("positive");
  });

  it("validates structured facts and preserves authenticated source and unknown timing", () => {
    const provenance = {
      actorId: "person",
      actorType: "user" as const,
      confidence: 1,
      evidence: {},
      maintenanceRunId: null,
      observedAt: "2026-09-18T00:00:00.000Z",
      requestId: "answer",
      sourceId: null,
    };
    expect(
      setupProfileChange(
        "planning:recurringIncome",
        JSON.stringify({ amountCents: 0, nextDate: null, provenance: { actorId: "forged" } }),
        null,
        provenance,
      ),
    ).toMatchObject({
      planning: { recurringIncome: { amountCents: 0, nextDate: null, provenance } },
    });
    expect(setupProfileChange("planning:obligations", "[]", null, provenance)).toMatchObject({
      planning: { obligations: [] },
    });
    expect(setupProfileChange("profile:debts", "[]")).toEqual({ debts: [] });
    expect(setupProfileChange("profile:income_stability", " Stable ")).toEqual({
      incomeStability: "stable",
    });
    expect(setupProfileChange("profile:buffer_target", "0")).toMatchObject({
      preferences: { bufferTarget: 0 },
    });
    expect(() => setupProfileChange("planning:recurringIncome", "{oops")).toThrow(
      "structured setup",
    );
    expect(() => setupProfileChange("planning:unknown", "[]")).toThrow("Unknown planning");
    expect(() => setupProfileChange("unknown", "0")).toThrow("Unknown setup");
    expect(() => setupProfileChange("planning:obligations", "[null]", null, provenance)).toThrow();
  });

  it("reports completed, question, and caller-driven next-action states", () => {
    const base = {
      budgetVersionId: null,
      headline: "Setup state",
      sessionId: "11111111-1111-4111-8111-111111111111",
      stage: "collecting_profile" as const,
      version: 1,
    };
    expect(setupResult(base)).toMatchObject({
      outcome: "completed",
      remainingWork: { categories: [], count: 0 },
    });
    expect(
      setupResult({
        ...base,
        nextAction: {
          arguments: { operation: "start" },
          reason: "Maintain the ledger.",
          tool: "maintain_finances",
        },
        stage: "initial_maintenance",
      }),
    ).toMatchObject({
      outcome: "work_remaining",
      remainingWork: { categories: ["maintenance"], count: 1 },
    });
    expect(
      setupResult({
        ...base,
        question: { answerType: "text", id: "profile:test", prompt: "One question?" },
      }),
    ).toMatchObject({
      outcome: "user_input_required",
      remainingWork: { categories: ["collecting_profile"], count: 1 },
    });
  });
});
