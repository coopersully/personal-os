import { ApiClientError } from "@personal-os/api-client";
import { expect, it } from "vitest";
import {
  appliedTransaction,
  confirmedRejection,
  describeTally,
  localToday,
  matchesAttempt,
  parseAmount,
  parseBalance,
  tallyCategorizations,
  trackingStopped,
} from "./mutations";

const transaction = { id: "t", updatedAt: "2026-11-07T00:00:00Z" };
it("only treats authoritative application as saved", () => {
  expect(appliedTransaction(transaction)).toBe(transaction);
  expect(appliedTransaction({ status: "applied", result: transaction })).toBe(transaction);
  expect(appliedTransaction({ status: "pending_review" })).toBeNull();
  expect(appliedTransaction({ status: "needs_input" })).toBeNull();
});
it("only treats a definitive client rejection as proof nothing was written", () => {
  const rejection = (status: number) =>
    new ApiClientError({ code: "error", message: "rejected", status });
  expect(confirmedRejection(rejection(409))).toBe(true);
  expect(confirmedRejection(rejection(422))).toBe(true);
  expect(confirmedRejection(rejection(408))).toBe(false);
  expect(confirmedRejection(rejection(503))).toBe(false);
  expect(confirmedRejection(new Error("offline"))).toBe(false);
});
it("reads exact balances and keeps blank distinct from invalid", () => {
  expect(parseBalance(" 2,400.50 ")).toBe(2400.5);
  expect(parseBalance("-12")).toBe(-12);
  expect(parseBalance("  ")).toBeNull();
  expect(parseBalance("12.345")).toBeUndefined();
  expect(parseBalance("twelve")).toBeUndefined();
});
it("recognizes accounts whose tracking already stopped", () => {
  expect(
    trackingStopped({ synchronization: { failureCode: "finance_account_disconnected" } }),
  ).toBe(true);
  expect(trackingStopped({ synchronization: { failureCode: null } })).toBe(false);
  expect(trackingStopped({})).toBe(false);
});
it("reads only exact amounts above zero", () => {
  expect(parseAmount(" 1,250.5 ")).toBe(1250.5);
  expect(parseAmount("12.50")).toBe(12.5);
  expect(parseAmount("0")).toBeUndefined();
  expect(parseAmount("-4")).toBeUndefined();
  expect(parseAmount("4.999")).toBeUndefined();
  expect(parseAmount("")).toBeUndefined();
});
it("never reads a comma decimal as a hundred times its value", () => {
  // A comma is only thousands grouping; anything else is corrected, not guessed.
  expect(parseAmount("12,50")).toBeUndefined();
  expect(parseAmount("1,2")).toBeUndefined();
  expect(parseAmount("1,25")).toBeUndefined();
  expect(parseAmount(",50")).toBeUndefined();
  expect(parseAmount("12,345,6")).toBeUndefined();
  expect(parseAmount("1,250")).toBe(1250);
  expect(parseAmount("12,345,678.9")).toBe(12345678.9);
});
it("uses the planning timezone's calendar date, not the device's or UTC's", () => {
  const lateEvening = new Date("2026-11-04T03:30:00Z");
  expect(localToday("America/New_York", lateEvening)).toBe("2026-11-03");
  expect(localToday("Asia/Tokyo", lateEvening)).toBe("2026-11-04");
});
it("recognizes the record an earlier add would have left", () => {
  const attempt = {
    accountId: "a",
    amount: 8.4,
    date: "2026-11-03",
    direction: "expense",
    merchant: "Corner bakery",
  };
  expect(
    matchesAttempt({ ...attempt, merchant: " corner BAKERY", amount: 8.4000001 }, attempt),
  ).toBe(true);
  expect(matchesAttempt({ ...attempt, amount: 8.41 }, attempt)).toBe(false);
  expect(matchesAttempt({ ...attempt, date: "2026-11-04" }, attempt)).toBe(false);
  expect(matchesAttempt({ ...attempt, accountId: "b" }, attempt)).toBe(false);
  expect(matchesAttempt({ ...attempt, direction: "income" }, attempt)).toBe(false);
});
it("never counts an unreported or unapplied categorization as applied", () => {
  const result = (transactionId: string, status: string, applied: boolean, code?: string) => ({
    transactionId,
    status,
    applied,
    error: code ? { code } : null,
  });
  const tally = tallyCategorizations(
    ["a", "b", "c", "d", "e", "f"],
    [
      result("a", "applied", true),
      result("b", "review_required", false),
      result("c", "failed", false, "conflict"),
      result("d", "failed", false, "invalid_request"),
      // Reported as applied but not confirmed applied: not a success.
      result("e", "applied", false),
    ],
  );
  expect(tally).toEqual({ applied: 1, review: 1, changed: 1, failed: 2, unconfirmed: 1 });
  expect(describeTally(tally)).toBe(
    "1 sent to review, 1 changed elsewhere, 2 not changed, 1 unconfirmed",
  );
  expect(describeTally({ applied: 2, review: 0, changed: 0, failed: 0, unconfirmed: 0 })).toBe("");
});
