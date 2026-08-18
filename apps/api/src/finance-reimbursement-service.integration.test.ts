import { describe, expect, it } from "vitest";
import { deriveReimbursementStatus } from "./finance-reimbursement-service.js";

describe("reimbursement lifecycle", () => {
  it("keeps a partial reimbursement outstanding and marks late expected money overdue", () => {
    expect(
      deriveReimbursementStatus({
        cancelledAt: null,
        dueDate: "2026-08-16",
        expectedCents: 22_000,
        receivedCents: 10_000,
        now: new Date("2026-08-17T12:00:00Z"),
      }),
    ).toBe("overdue");
  });
});
