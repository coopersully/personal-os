import { ApiClientError } from "@personal-os/api-client";
import { expect, it } from "vitest";
import { appliedTransaction, confirmedRejection, parseBalance, trackingStopped } from "./mutations";

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
