import { expect, it } from "vitest";
import { appliedTransaction } from "./mutations";

const transaction = { id: "t", updatedAt: "2026-11-07T00:00:00Z" };
it("only treats authoritative application as saved", () => {
  expect(appliedTransaction(transaction)).toBe(transaction);
  expect(appliedTransaction({ status: "applied", result: transaction })).toBe(transaction);
  expect(appliedTransaction({ status: "pending_review" })).toBeNull();
  expect(appliedTransaction({ status: "needs_input" })).toBeNull();
});
