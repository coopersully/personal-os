import { createFinanceBudgetVersionInputSchema } from "./budget.js";
import {
  financeSetupPlanningSchema,
  nextFinancePlanningQuestion,
  summarizeFinancePlanning,
} from "./setup-planning.js";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const source = {
  actorId: id(1),
  actorType: "user",
  confidence: 1,
  evidence: {},
  maintenanceRunId: null,
  observedAt: "2026-09-16T00:00:00Z",
  requestId: "setup",
  sourceId: null,
} as const;
const item = (n: number, amountCents: number | null) => ({
  id: id(n),
  name: "Stated need",
  amountCents,
  dueDay: 1,
  provenance: source,
});
const complete = () =>
  financeSetupPlanningSchema.parse({
    recurringIncome: { amountCents: 100001, nextDate: "2026-10-01", provenance: source },
    uncertainIncome: [],
    exceptionalResources: [],
    obligations: [],
    contributions: [],
    priorities: [],
  });

describe("progressive Finance planning", () => {
  it("preserves unknowns separately from confirmed empty lists", () => {
    const planning = financeSetupPlanningSchema.parse({});
    expect(planning.obligations).toBeNull();
    expect(summarizeFinancePlanning(planning)).toMatchObject({
      recurringFloorCents: null,
      knownMonthlyNeedsCents: 0,
      balanceCents: null,
      deficitCents: null,
      requiresPositionEvidence: true,
    });
    expect(nextFinancePlanningQuestion(planning, [], 3)?.id).toBe("planning:recurringIncome");
    expect(nextFinancePlanningQuestion(complete(), [], 3)).toBeNull();
  });

  it("scopes skipped questions to the displayed profile revision without confirming a fact", () => {
    const planning = financeSetupPlanningSchema.parse({});
    const skipped = [{ questionId: "planning:recurringIncome" as const, profileVersion: 3 }];
    expect(nextFinancePlanningQuestion(planning, skipped, 3)?.id).toBe("planning:uncertainIncome");
    expect(nextFinancePlanningQuestion(planning, skipped, 4)?.id).toBe("planning:recurringIncome");
    expect(planning.recurringIncome).toBeNull();
  });

  it("keeps uncertain income and exceptional resources out of recurring funding", () => {
    const planning = complete();
    planning.uncertainIncome = [
      {
        id: id(2),
        name: "Uncertain",
        amountCents: 50000,
        expectedDate: "2026-10-01",
        provenance: source,
      },
    ];
    planning.exceptionalResources = [
      {
        id: id(3),
        name: "One-time",
        amountCents: 250000,
        expectedDate: "2026-10-01",
        provenance: source,
      },
    ];
    planning.obligations = [{ ...item(4, 110001), debtAccountId: null }];
    expect(summarizeFinancePlanning(planning)).toMatchObject({
      recurringFloorCents: 100001,
      knownMonthlyNeedsCents: 110001,
      balanceCents: -10000,
      deficitCents: 10000,
      requiresPositionEvidence: true,
    });
  });

  it("adds stated needs in exact cents and never claims a planned goal contribution was funded", () => {
    const planning = complete();
    planning.obligations = [{ ...item(4, 80000), debtAccountId: null }];
    planning.contributions = [{ ...item(5, 10000), goalId: id(50) }];
    planning.priorities = [{ ...item(6, 10001), categoryId: id(60), protected: true }];
    const before = structuredClone(planning);
    expect(summarizeFinancePlanning(planning)).toEqual({
      recurringFloorCents: 100001,
      knownMonthlyNeedsCents: 100001,
      balanceCents: 0,
      deficitCents: 0,
      unknownFields: [],
      requiresPositionEvidence: true,
    });
    expect(planning).toEqual(before);
    expect(planning.contributions[0]).not.toHaveProperty("fundedCents");
  });

  it("does not publish a balance when a need amount remains unknown", () => {
    const planning = complete();
    planning.obligations = [{ ...item(4, null), debtAccountId: null }];
    expect(summarizeFinancePlanning(planning)).toMatchObject({
      balanceCents: null,
      deficitCents: null,
      unknownFields: ["obligations"],
    });
  });

  it("keeps missing timing explicit and accepts confirmed zero income", () => {
    const planning = complete();
    if (!planning.recurringIncome) throw new Error("Fixture income missing.");
    planning.recurringIncome.amountCents = 0;
    expect(summarizeFinancePlanning(planning).balanceCents).toBe(0);
    planning.recurringIncome.nextDate = null;
    expect(nextFinancePlanningQuestion(planning, [], 1)?.id).toBe("planning:recurringIncome");
    planning.recurringIncome.nextDate = "2026-10-01";
    planning.obligations = [{ ...item(4, 100), dueDay: null, debtAccountId: null }];
    expect(summarizeFinancePlanning(planning)).toMatchObject({
      balanceCents: null,
      unknownFields: ["obligations"],
    });
  });

  it("validates stored facts and progress again before producing a question or summary", () => {
    expect(() => nextFinancePlanningQuestion(complete(), [], -1)).toThrow();
    expect(() =>
      nextFinancePlanningQuestion(
        complete(),
        [{ questionId: "planning:priorities", profileVersion: -1 }],
        1,
      ),
    ).toThrow();
    const planning = complete();
    planning.priorities = [{ ...item(4, -1), categoryId: null, protected: true }];
    expect(() => summarizeFinancePlanning(planning)).toThrow();
    expect(() => nextFinancePlanningQuestion(planning, [], 1)).toThrow();
  });

  it("rejects repeated identities and duplicate debt/goal references rather than reserving twice", () => {
    const planning = complete();
    planning.obligations = [
      { ...item(4, 100), debtAccountId: id(70) },
      { ...item(5, 100), debtAccountId: id(70) },
    ];
    expect(financeSetupPlanningSchema.safeParse(planning).success).toBe(false);
    planning.obligations = [];
    planning.contributions = [
      { ...item(4, 100), goalId: id(50) },
      { ...item(5, 100), goalId: id(50) },
    ];
    expect(financeSetupPlanningSchema.safeParse(planning).success).toBe(false);
    planning.contributions = [];
    planning.priorities = [
      { ...item(4, 100), categoryId: null, protected: false },
      { ...item(4, 100), categoryId: null, protected: false },
    ];
    expect(financeSetupPlanningSchema.safeParse(planning).success).toBe(false);
  });

  it.each([
    -1,
    0.5,
    Number.MAX_SAFE_INTEGER,
    Number.POSITIVE_INFINITY,
  ])("rejects invalid cent amounts %s", (amountCents) => {
    expect(
      financeSetupPlanningSchema.safeParse({
        recurringIncome: { amountCents, nextDate: null, provenance: source },
      }).success,
    ).toBe(false);
  });
});

it("allows unknown first-plan resources without making an empty proposal approvable", () => {
  const draft = {
    allocations: [],
    assumptions: ["Income unknown"],
    effectiveFrom: "2026-09",
    resources: [],
    rationale: "Incomplete first plan",
    idempotencyKey: "first-plan",
  };
  expect(
    createFinanceBudgetVersionInputSchema.safeParse({ ...draft, status: "incomplete" }).success,
  ).toBe(true);
  expect(createFinanceBudgetVersionInputSchema.safeParse(draft).success).toBe(false);
  expect(
    createFinanceBudgetVersionInputSchema.safeParse({ ...draft, status: "proposed" }).success,
  ).toBe(false);
});
