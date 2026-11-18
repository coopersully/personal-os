import { describe, expect, it } from "vitest";
import {
  financeProviderSourceAdmissionInputSchema as admission,
  financeProviderSourceActionInputSchema,
  financeProviderSourceAdmissionResultSchema,
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

describe("source admission selection (not source proof)", () => {
  const target = {
    transactionId: id,
    expectedTransactionRevision: "1",
    expectedAccountRevision: "2",
  };
  const request = { idempotencyKey: "source-admission-1", targets: [target] };
  it("accepts only native selection, expected revisions and replay identity", () =>
    expect(admission.parse(request)).toEqual(request));
  it.each([
    "currencyCode",
    "providerDirection",
    "evidence",
    "providerItemId",
    "userId",
    "accessToken",
  ])("rejects caller source/authority %s", (key) =>
    expect(admission.safeParse({ ...request, [key]: "canary" }).success).toBe(false));
  it("rejects source values nested in a target", () =>
    expect(
      admission.safeParse({ ...request, targets: [{ ...target, currencyCode: "USD" }] }).success,
    ).toBe(false));
  it.each([
    "0",
    "01",
    "-1",
    "1.5",
    "9223372036854775808",
  ])("rejects noncanonical/out-of-range revision %s", (value) =>
    expect(
      admission.safeParse({
        ...request,
        targets: [{ ...target, expectedTransactionRevision: value }],
      }).success,
    ).toBe(false));
  it("rejects duplicate native targets independently of the cap", () =>
    expect(admission.safeParse({ ...request, targets: [target, target] }).success).toBe(false));
  it("accepts twenty distinct targets and rejects twenty-one", () => {
    const targets = Array.from({ length: 21 }, (_, i) => ({
      ...target,
      transactionId: `${String(i).padStart(8, "0")}-1111-4111-8111-111111111111`,
    }));
    expect(admission.safeParse({ ...request, targets: targets.slice(0, 20) }).success).toBe(true);
    expect(admission.safeParse({ ...request, targets }).success).toBe(false);
  });
  it.each(["", " ", "key\n", "x".repeat(201)])("rejects invalid replay key", (idempotencyKey) =>
    expect(admission.safeParse({ ...request, idempotencyKey }).success).toBe(false));
});

describe("source fact action and receipt contract", () => {
  const target = {
    transactionId: id,
    expectedTransactionRevision: "1",
    expectedAccountRevision: "2",
  };
  it("requires the honest source suboperation and rejects economic fields", () => {
    const input = { operation: "admit_source_facts", idempotencyKey: "exact", targets: [target] };
    expect(financeProviderSourceActionInputSchema.parse(input)).toEqual(input);
    for (const extra of [
      { amount: 1 },
      { providerDirection: "income" },
      { operation: "update" },
      { sourceHash: "fake" },
    ])
      expect(financeProviderSourceActionInputSchema.safeParse({ ...input, ...extra }).success).toBe(
        false,
      );
  });
  it("keeps the outward durable result strictly native and rejects secret-bearing extras", () => {
    const receipt = {
      sourceHash: `sha256:${"a".repeat(64)}`,
      observedAt: "2026-11-06T10:00:00.000Z",
      providerUpdatedAt: null,
      snapshotConsistency: "not_atomic",
      entries: [
        {
          transactionId: id,
          accountId: id,
          changed: true,
          source: { amount: -1, currencyCode: "USD", date: "2026-07-19" },
          before: { currencyCode: null, providerDirection: null, transactionRevision: "1" },
          after: { currencyCode: "USD", providerDirection: "income", transactionRevision: "2" },
        },
      ],
    };
    expect(financeProviderSourceAdmissionResultSchema.parse(receipt)).toEqual(receipt);
    expect(
      financeProviderSourceAdmissionResultSchema.safeParse({
        ...receipt,
        providerItemId: "private",
      }).success,
    ).toBe(false);
    expect(
      financeProviderSourceAdmissionResultSchema.safeParse({
        ...receipt,
        entries: [
          {
            ...receipt.entries[0],
            source: { ...receipt.entries[0]?.source, accessToken: "private" },
          },
        ],
      }).success,
    ).toBe(false);
  });
});
