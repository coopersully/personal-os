import {
  financeBudgetBaselineQualificationReadSchema,
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
