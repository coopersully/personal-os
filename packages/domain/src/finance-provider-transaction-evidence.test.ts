import { describe, expect, it } from "vitest";
import {
  financeProviderTransactionEvidenceInputSchema as input,
  financeProviderTransactionEvidenceSchema as output,
} from "./finance-provider-transaction-evidence.js";

const id = "11111111-1111-4111-8111-111111111111";
describe("historical Finance evidence boundary", () => {
  it("accepts only native identifiers", () =>
    expect(input.parse({ transactionIds: [id] })).toEqual({ transactionIds: [id] }));
  it.each([
    [],
    Array(21).fill(id),
    [id, id],
    ["provider-id"],
  ])("rejects unbounded/duplicate/non-native targets %j", (transactionIds) =>
    expect(input.safeParse({ transactionIds }).success).toBe(false));
  it.each([
    "userId",
    "accessToken",
    "providerItemId",
    "initialize",
    "accountIds",
  ])("rejects caller authority %s", (key) =>
    expect(input.safeParse({ transactionIds: [id], [key]: "canary" }).success).toBe(false));
  it("rejects unexpected outward provider fields", () =>
    expect(
      output.safeParse({
        observedAt: "2026-11-05T12:00:00.000Z",
        snapshotConsistency: "not_atomic",
        coverage: "unavailable",
        reason: "not_initialized",
        providerUpdatedAt: null,
        entries: [],
        accessToken: "canary",
      }).success,
    ).toBe(false));
  it("retains honest unavailable/partial coverage", () => {
    for (const coverage of ["unavailable", "partial"])
      expect(
        output.parse({
          observedAt: "2026-11-05T12:00:00.000Z",
          snapshotConsistency: "not_atomic",
          coverage,
          reason: "page_limit",
          providerUpdatedAt: null,
          entries: [],
        }).coverage,
      ).toBe(coverage);
  });
});
