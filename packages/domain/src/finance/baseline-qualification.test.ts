import {
  financeBudgetBaselineQualificationReadSchema,
  financeBudgetBaselineSnapshotSchema,
  prepareFinanceBudgetBaselineQualificationInputSchema,
} from "./baseline-qualification.js";

describe("monthly budget qualification", () => {
  const input = {
    accountIds: [crypto.randomUUID()],
    budgetVersionId: crypto.randomUUID(),
    currency: "USD",
    idempotencyKey: "preview",
    month: "2026-10",
    timezone: "America/New_York",
  };
  it("requires an explicit nonempty account universe, currency and timezone", () => {
    expect(prepareFinanceBudgetBaselineQualificationInputSchema.safeParse(input).success).toBe(
      true,
    );
    for (const change of [
      { accountIds: [] },
      { accountIds: [...input.accountIds, ...input.accountIds] },
      { currency: "" },
      { currency: "usd" },
      { timezone: "invented/zone" },
    ])
      expect(
        prepareFinanceBudgetBaselineQualificationInputSchema.safeParse({ ...input, ...change })
          .success,
      ).toBe(false);
  });
  it("preserves explicit zero spending allocations without inventing missing limits", () => {
    const snapshot = {
      accountIds: input.accountIds,
      allocations: [
        {
          key: "food",
          categoryId: crypto.randomUUID(),
          legacyCategory: null,
          label: "Food",
          amountCents: 0,
        },
      ],
      budgetVersionId: input.budgetVersionId,
      budgetVersion: 1,
      planId: crypto.randomUUID(),
      sourceBaselineId: null,
      currency: input.currency,
      month: input.month,
      period: { from: "2026-10-01", through: "2026-10-31", timezone: input.timezone },
      originalApproval: { approvedAt: null, actorId: null, actorType: null },
    };
    expect(financeBudgetBaselineSnapshotSchema.parse(snapshot).allocations).toEqual(
      snapshot.allocations,
    );
    for (const amountCents of [-1, 0.5, null, undefined]) {
      expect(
        financeBudgetBaselineSnapshotSchema.safeParse({
          ...snapshot,
          allocations: [{ ...snapshot.allocations[0], amountCents }],
        }).success,
      ).toBe(false);
    }
    expect(
      financeBudgetBaselineSnapshotSchema.safeParse({ ...snapshot, allocations: [] }).success,
    ).toBe(false);
  });
  it("keeps qualification unavailable until explicit confirmation", () => {
    expect(
      financeBudgetBaselineQualificationReadSchema.parse({
        state: "unavailable",
        reason: "qualification_required",
        qualificationRequired: true,
      }),
    ).toMatchObject({ state: "unavailable" });
    expect(
      financeBudgetBaselineQualificationReadSchema.safeParse({
        state: "qualified",
        qualification: input,
      }).success,
    ).toBe(false);
  });
});
