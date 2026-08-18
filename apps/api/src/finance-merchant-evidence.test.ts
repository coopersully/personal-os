import { describe, expect, it } from "vitest";
import { evaluateMerchantEvidence } from "./finance-merchant-evidence.js";

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
        observations: [
          { category: "Health", outcome: "confirmed" },
          { category: "Health", outcome: "confirmed" },
          { category: "Health", outcome: "confirmed" },
        ],
      }),
    ).toMatchObject({ behavior: "mixed", merchantOnlyEligible: false });
  });

  it("allows uncorrected, consistent history to become eligible", () => {
    const evidence = evaluateMerchantEvidence({
      merchantName: "Local pharmacy",
      observations: [
        { category: "Health", outcome: "confirmed" },
        { category: "Health", outcome: "confirmed" },
        { category: "Health", outcome: "confirmed" },
      ],
    });

    expect(evidence).toMatchObject({
      behavior: "consistent",
      category: "Health",
      merchantOnlyEligible: true,
    });
  });
});
