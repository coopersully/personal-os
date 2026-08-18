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
        expectedRecurring: { expectedAmountCents: 180_000, toleranceCents: 500 },
      }),
    ).toBeNull();
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
      expectedRecurring: { expectedAmountCents: 180_000, toleranceCents: 500 },
    });
    expect(result).toMatchObject({ baselineCents: 180_000, severity: "warning" });
  });
});
