import { describe, expect, it } from "vitest";
import {
  evaluateMerchantEvidence,
  minimumMerchantOnlyConfirmations,
} from "./finance-merchant-evidence.js";

describe("evaluateMerchantEvidence", () => {
  it("does not auto-apply a broad retailer from two CVS Health confirmations", () => {
    const evidence = evaluateMerchantEvidence({
      merchantName: "CVS Health",
      observations: [
        { category: "Health", outcome: "confirmed" },
        { category: "Health", outcome: "confirmed" },
      ],
    });

    expect(evidence).toMatchObject({
      behavior: "mixed",
      category: "Health",
      merchantOnlyEligible: false,
    });
  });

  it("treats category diversity and corrections as a durable mixed signal", () => {
    const evidence = evaluateMerchantEvidence({
      merchantName: "Neighborhood shop",
      observations: [
        { category: "Health", outcome: "confirmed" },
        { category: "Groceries", outcome: "confirmed" },
        { category: "Health", outcome: "corrected" },
      ],
    });

    expect(evidence).toMatchObject({ behavior: "mixed", merchantOnlyEligible: false });
    expect(evidence.confidence).toBeLessThan(0.9);
  });

  it("honors explicit mixed behavior even with consistent history", () => {
    expect(
      evaluateMerchantEvidence({
        behavior: "mixed",
        merchantName: "Small pharmacy",
        observations: Array.from({ length: minimumMerchantOnlyConfirmations + 3 }, () => ({
          category: "Health",
          outcome: "confirmed" as const,
        })),
      }),
    ).toMatchObject({ behavior: "mixed", merchantOnlyEligible: false });
  });

  it("requires the documented number of uncorrected confirmations before merchant-only evidence is eligible", () => {
    const belowThreshold = evaluateMerchantEvidence({
      merchantName: "Local pharmacy",
      observations: Array.from({ length: minimumMerchantOnlyConfirmations - 1 }, () => ({
        category: "Health",
        outcome: "confirmed" as const,
      })),
    });
    expect(belowThreshold).toMatchObject({ behavior: "unknown", merchantOnlyEligible: false });

    const evidence = evaluateMerchantEvidence({
      merchantName: "Local pharmacy",
      observations: Array.from({ length: minimumMerchantOnlyConfirmations }, () => ({
        category: "Health",
        outcome: "confirmed" as const,
      })),
    });

    expect(evidence).toMatchObject({
      behavior: "consistent",
      category: "Health",
      merchantOnlyEligible: true,
    });
    expect(evidence.rationale).toContain(String(minimumMerchantOnlyConfirmations));
  });

  it("keeps a dominant category with diverse transaction history out of merchant-only automation", () => {
    const evidence = evaluateMerchantEvidence({
      merchantName: "Local market",
      observations: [
        ...Array.from({ length: minimumMerchantOnlyConfirmations + 4 }, () => ({
          category: "Groceries",
          outcome: "confirmed" as const,
        })),
        { category: "Dining", outcome: "confirmed" },
      ],
    });

    expect(evidence).toMatchObject({
      behavior: "mixed",
      category: "Groceries",
      merchantOnlyEligible: false,
    });
  });

  it("keeps many corrected confirmations out of merchant-only automation", () => {
    const evidence = evaluateMerchantEvidence({
      merchantName: "Local pharmacy",
      observations: [
        ...Array.from({ length: minimumMerchantOnlyConfirmations + 4 }, () => ({
          category: "Health",
          outcome: "confirmed" as const,
        })),
        { category: "Health", outcome: "corrected" },
      ],
    });

    expect(evidence).toMatchObject({
      behavior: "consistent",
      category: "Health",
      merchantOnlyEligible: false,
    });
  });

  it("keeps empty evidence unknown without inventing a category or confidence", () => {
    expect(
      evaluateMerchantEvidence({ merchantName: "New merchant", observations: [] }),
    ).toMatchObject({
      behavior: "unknown",
      category: null,
      confidence: 0,
      merchantOnlyEligible: false,
    });
  });

  it("honors a confirmed consistent classification while requiring more observations", () => {
    expect(
      evaluateMerchantEvidence({
        behavior: "consistent",
        merchantName: "Local cafe",
        observations: [{ category: "Dining", outcome: "confirmed" }],
      }),
    ).toMatchObject({
      behavior: "consistent",
      category: "Dining",
      merchantOnlyEligible: false,
    });
  });
});
