import { describe, expect, it } from "vitest";
import { detectFinanceAnomalies } from "./finance-anomaly-service.js";

const sourceRef = (remoteId: string) => ({
  accountId: "00000000-0000-4000-8000-000000000099",
  provider: "plaid" as const,
  remoteId,
  revision: "2026-08-17T12:00:00.000Z",
  sourceType: "finance_transaction" as const,
});

describe("detectFinanceAnomalies", () => {
  it("uses a merchant baseline and flags a material reimbursable dinner", () => {
    const result = detectFinanceAnomalies({
      transaction: {
        amountCents: 31_000,
        category: "Dining",
        date: "2026-08-17",
        id: "00000000-0000-4000-8000-000000000001",
        merchant: "Dinner House",
        sourceRef: sourceRef("current-dinner"),
      },
      history: [42, 44, 45, 45, 46].map((amountCents, index) => ({
        amountCents: amountCents * 100,
        category: "Dining",
        date: `2026-0${index + 1}-10`,
        id: `00000000-0000-4000-8000-00000000000${index + 2}`,
        merchant: "Dinner House",
        sourceRef: sourceRef(`dinner-${index}`),
      })),
      budgetMaterialityCents: 10_000,
      reimbursementExpectedCents: 22_000,
    });

    expect(result).not.toBeNull();
    expect(result).toMatchObject({ baselineSource: "merchant", severity: "warning" });
    expect(result?.rationale).toContain("reimbursement");
    expect(result?.sourceRefs).toHaveLength(6);
    expect(result?.sourceRefs[0]).toMatchObject({ provider: "plaid", remoteId: "current-dinner" });
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
          sourceRef: sourceRef("current-rent"),
        },
        history: [180_000, 180_000, 180_000, 180_000, 180_000].map((amountCents, index) => ({
          amountCents,
          category: "Housing",
          date: `2026-0${index + 1}-01`,
          id: `00000000-0000-4000-8000-00000000000${index + 2}`,
          merchant: "Landlord",
          sourceRef: sourceRef(`rent-${index}`),
        })),
        budgetMaterialityCents: 10_000,
        expectedRecurring: {
          expectedAmountCents: 180_000,
          expectedDate: "2026-08-01",
          toleranceCents: 500,
          windowDays: 3,
        },
      }),
    ).toBeNull();
  });

  it("does not suppress a recurring-looking charge without an expected date", () => {
    expect(
      detectFinanceAnomalies({
        transaction: {
          amountCents: 220_000,
          category: "Housing",
          date: "2026-08-01",
          id: "00000000-0000-4000-8000-000000000001",
          merchant: "Landlord",
          sourceRef: sourceRef("undated-rent"),
        },
        history: [180_000, 180_000, 180_000, 180_000, 180_000].map((amountCents, index) => ({
          amountCents,
          category: "Housing",
          date: `2026-0${index + 1}-01`,
          id: `00000000-0000-4000-8000-00000000000${index + 2}`,
          merchant: "Landlord",
          sourceRef: sourceRef(`undated-rent-${index}`),
        })),
        budgetMaterialityCents: 1_000,
        expectedRecurring: {
          expectedAmountCents: 220_000,
          expectedDate: null,
          toleranceCents: 500,
          windowDays: 3,
        },
      }),
    ).toMatchObject({ severity: "warning" });
  });

  it("flags a changed recurring charge instead of suppressing it wholesale", () => {
    const result = detectFinanceAnomalies({
      transaction: {
        amountCents: 220_000,
        category: "Housing",
        date: "2026-08-01",
        id: "00000000-0000-4000-8000-000000000001",
        merchant: "Landlord",
        sourceRef: sourceRef("changed-rent"),
      },
      history: [180_000, 180_000, 180_000, 180_000, 180_000].map((amountCents, index) => ({
        amountCents,
        category: "Housing",
        date: `2026-0${index + 1}-01`,
        id: `00000000-0000-4000-8000-00000000000${index + 2}`,
        merchant: "Landlord",
        sourceRef: sourceRef(`rent-${index}`),
      })),
      budgetMaterialityCents: 10_000,
      expectedRecurring: {
        expectedAmountCents: 180_000,
        expectedDate: "2026-08-01",
        toleranceCents: 500,
        windowDays: 3,
      },
    });
    expect(result).toMatchObject({ baselineCents: 180_000, severity: "warning" });
  });

  it("flags an off-cycle recurring duplicate even when its amount is normal", () => {
    const recurring = {
      expectedAmountCents: 180_000,
      expectedDate: "2026-08-01",
      toleranceCents: 500,
      windowDays: 3,
    };
    expect(
      detectFinanceAnomalies({
        transaction: {
          amountCents: 180_000,
          category: "Housing",
          date: "2026-08-17",
          id: "00000000-0000-4000-8000-000000000001",
          merchant: "Landlord",
          sourceRef: sourceRef("off-cycle-rent"),
        },
        history: [180_000, 180_000, 180_000, 180_000, 180_000].map((amountCents, index) => ({
          amountCents,
          category: "Housing",
          date: `2026-0${index + 1}-01`,
          id: `00000000-0000-4000-8000-00000000000${index + 2}`,
          merchant: "Landlord",
          sourceRef: sourceRef(`rent-${index}`),
        })),
        budgetMaterialityCents: 1_000,
        expectedRecurring: recurring,
      }),
    ).toMatchObject({ rationale: expect.stringContaining("cadence window") });
  });

  it("uses a category baseline and ignores sparse or immaterial history", () => {
    const transaction = {
      amountCents: 20_000,
      category: "Pharmacy",
      date: "2026-08-17",
      id: "00000000-0000-4000-8000-000000000001",
      merchant: "CVS",
      sourceRef: sourceRef("current-pharmacy"),
    };
    expect(
      detectFinanceAnomalies({ budgetMaterialityCents: 1_000, history: [], transaction }),
    ).toBeNull();
    expect(
      detectFinanceAnomalies({
        budgetMaterialityCents: 1_000,
        history: [9_000, 10_000, 10_000, 11_000].map((amountCents, index) => ({
          amountCents,
          category: "Pharmacy",
          date: `2026-0${index + 1}-10`,
          id: `00000000-0000-4000-8000-00000000001${index}`,
          merchant: `Other pharmacy ${index}`,
          sourceRef: sourceRef(`pharmacy-${index}`),
        })),
        transaction,
      }),
    ).toBeNull();
    const categoryHistory = [9_000, 10_000, 10_000, 11_000, 12_000].map((amountCents, index) => ({
      amountCents,
      category: "Pharmacy",
      date: `2026-0${index + 1}-10`,
      id: `00000000-0000-4000-8000-00000000002${index}`,
      merchant: `Other pharmacy ${index}`,
      sourceRef: sourceRef(`category-pharmacy-${index}`),
    }));
    expect(
      detectFinanceAnomalies({
        budgetMaterialityCents: 1_000,
        history: categoryHistory,
        transaction,
      }),
    ).toMatchObject({ baselineCents: 10_000, baselineSource: "category" });
    expect(
      detectFinanceAnomalies({
        budgetMaterialityCents: 20_000,
        history: categoryHistory,
        transaction,
      }),
    ).toBeNull();
  });

  it("uses the midpoint of an even-sized history without overstating an anomaly", () => {
    const history = [9_000, 10_000, 10_000, 11_000, 12_000, 12_000].map((amountCents, index) => ({
      amountCents,
      category: "Pharmacy",
      date: `2026-0${index + 1}-10`,
      id: `00000000-0000-4000-8000-00000000001${index}`,
      merchant: "Different merchant",
      sourceRef: sourceRef(`even-${index}`),
    }));
    expect(
      detectFinanceAnomalies({
        budgetMaterialityCents: 1_000,
        history,
        transaction: {
          amountCents: 11_500,
          category: "Pharmacy",
          date: "2026-08-17",
          id: "00000000-0000-4000-8000-000000000001",
          merchant: "CVS",
          sourceRef: sourceRef("current-even"),
        },
      }),
    ).toBeNull();
    expect(
      detectFinanceAnomalies({
        budgetMaterialityCents: 1_000,
        history,
        transaction: {
          amountCents: 14_500,
          category: "Pharmacy",
          date: "2026-08-18",
          id: "00000000-0000-4000-8000-000000000002",
          merchant: "CVS",
          sourceRef: sourceRef("anomalous-even"),
        },
      }),
    ).toMatchObject({ baselineCents: 10_500 });
  });
});
