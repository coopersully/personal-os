import { describe, expect, it } from "vitest";
import { detectFinanceAnomalies } from "./finance-anomaly-service.js";

describe("detectFinanceAnomalies", () => {
  it("uses a merchant baseline and flags a material reimbursable dinner", () => {
    const result = detectFinanceAnomalies({
      transaction: {
        amountCents: 31_000,
        category: "Dining",
        date: "2026-08-17",
        id: "00000000-0000-4000-8000-000000000001",
        merchant: "Dinner House",
      },
      history: [42, 44, 45, 45, 46].map((amountCents, index) => ({
        amountCents: amountCents * 100,
        category: "Dining",
        date: `2026-0${index + 1}-10`,
        id: `00000000-0000-4000-8000-00000000000${index + 2}`,
        merchant: "Dinner House",
      })),
      budgetMaterialityCents: 10_000,
      reimbursementExpectedCents: 22_000,
    });

    expect(result).not.toBeNull();
    expect(result).toMatchObject({ baselineSource: "merchant", severity: "warning" });
    expect(result?.rationale).toContain("reimbursement");
    expect(result?.sourceRefs).toHaveLength(5);
  });

  it("suppresses an expected recurring housing charge", () => {
    expect(
      detectFinanceAnomalies({
        transaction: {
          amountCents: 180_000,
          category: "Housing",
          date: "2026-08-01",
          id: "00000000-0000-4000-8000-000000000001",
          merchant: "Landlord",
        },
        history: [180_000, 180_000, 180_000, 180_000, 180_000].map((amountCents, index) => ({
          amountCents,
          category: "Housing",
          date: `2026-0${index + 1}-01`,
          id: `00000000-0000-4000-8000-00000000000${index + 2}`,
          merchant: "Landlord",
        })),
        budgetMaterialityCents: 10_000,
        expectedRecurring: true,
      }),
    ).toBeNull();
  });
});
