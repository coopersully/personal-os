import {
  financeActionFingerprint,
  financeCandidateActionFingerprint,
} from "./finance-action-identity.js";

describe("Finance action identity", () => {
  it("uses one order-independent identity for reviews and candidates", () => {
    const left = { id: "00000000-0000-4000-8000-000000000001", nested: { b: 2, a: 1 } };
    const right = { nested: { a: 1, b: 2 }, id: "00000000-0000-4000-8000-000000000001" };
    const review = financeActionFingerprint("merchant", left);
    expect(review).toBe(financeActionFingerprint("merchant", right));
    expect(financeCandidateActionFingerprint("merchant", left)).toBe(`sha256:${review}`);
  });
});
