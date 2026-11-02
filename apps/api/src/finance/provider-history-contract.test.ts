import { describe, expect, expectTypeOf, it } from "vitest";
import {
  type HistoricalReadCapability,
  type HistoricalReadObservation,
  historicalProviderExchangeSchema,
  historicalProviderPageSchema,
  historicalProviderRequestSchema,
  historicalReadFailureCodeSchema,
  historicalReadHeldReasonSchema,
  historicalReadLimits,
  historicalReadManifestSnapshotSchema,
  historicalReadObservationBindingSchema,
  historicalReadObservationSchema,
  historicalReadPageRequestSchema,
} from "./provider-history-contract.js";

const owner = "a1050000-0000-4000-8000-000000000001";
const account = "a1050000-0000-4000-8000-000000000002";
const transaction = "a1050000-0000-4000-8000-000000000003";
const item = "a1050000-0000-4000-8000-000000000004";
const acquisition = "a1050000-0000-4000-8000-000000000005";
const attempt = "a1050000-0000-4000-8000-000000000006";
const other = "a1050000-0000-4000-8000-000000000007";
const hash = "a".repeat(64);
const startDate = "2026-01-01";
const endDate = "2026-01-31";
function providerRequest() {
  return {
    accessToken: "private-provider-credential",
    accountIds: ["provider-account"],
    startDate,
    endDate,
    count: 500,
    offset: 0,
  };
}
function providerRow() {
  return {
    accountId: "provider-account",
    amount: -12.34,
    currencyCode: "USD",
    date: "2026-01-15",
    merchantName: null,
    name: "Provider source",
    pending: false,
    pendingTransactionId: null,
    personalFinanceCategory: null,
    transactionId: "provider-transaction",
  };
}
function providerPage() {
  return {
    itemId: "provider-item",
    transactions: [providerRow()],
    totalTransactions: 1,
    requestId: "request-id",
    hasMore: false,
  };
}
function manifest() {
  return {
    schemaVersion: 1,
    ownerId: owner,
    actorType: "user",
    actorId: owner,
    authorizationConnectionId: null,
    localItemId: item,
    itemFingerprint: hash,
    accounts: [
      { localAccountId: account, providerAccountId: "provider-account", nativeFingerprint: hash },
    ],
    targets: [
      {
        transactionId: transaction,
        localAccountId: account,
        providerAccountId: "provider-account",
        providerTransactionId: "provider-transaction",
        nativeFingerprint: hash,
        date: "2026-01-15",
        absoluteAmountCents: 1234,
        currencyCode: null,
        providerDirection: null,
        missingFields: ["currencyCode", "providerDirection"],
      },
    ],
    groups: [{ localAccountIds: [account], startDate, endDate }],
    incrementalClaim: null,
  };
}
function observation() {
  return {
    schemaVersion: 1,
    acquisitionId: acquisition,
    attemptId: attempt,
    attemptGeneration: 1,
    manifestHash: hash,
    sourceFingerprint: hash,
    observedAt: "2026-11-02T00:00:00.000Z",
    page: {
      groupIndex: 0,
      count: 500,
      offset: 0,
      startDate,
      endDate,
      requestedLocalAccountIds: [account],
      returnedCount: 1,
      totalTransactions: 1,
      hasMore: false,
      requestId: "request-id",
      contentHash: hash,
    },
    targets: [
      {
        transactionId: transaction,
        localAccountId: account,
        providerTransactionId: "provider-transaction",
        signedAmount: "-12.34",
        absoluteAmountCents: 1234,
        currencyCode: "USD",
        date: "2026-01-15",
        pending: false,
      },
    ],
    held: [],
  };
}
function binding() {
  return {
    manifest: manifest(),
    request: { groupIndex: 0, count: 500, offset: 0 },
    observation: observation(),
  };
}

describe("historical provider read data contracts (no runtime admission)", () => {
  it("does not turn parsed source data into an opaque runtime capability", () => {
    expectTypeOf<HistoricalReadObservation>().not.toMatchTypeOf<HistoricalReadCapability>();
    expectTypeOf<
      ReturnType<typeof historicalReadManifestSnapshotSchema.parse>
    >().not.toMatchTypeOf<HistoricalReadCapability>();
    expect(
      historicalReadObservationSchema.safeParse({ ...observation(), admitted: true }).success,
    ).toBe(false);
  });

  it("retains signed provider evidence and validates the exact requested source", () => {
    const parsed = historicalProviderExchangeSchema.parse({
      request: providerRequest(),
      response: providerPage(),
    });
    expect(parsed.response.transactions[0]?.amount).toBe(-12.34);
    expect(parsed.response.transactions[0]?.currencyCode).toBe("USD");
    expect(historicalReadObservationBindingSchema.safeParse(binding()).success).toBe(true);
    const wrongAccount = providerPage();
    wrongAccount.transactions[0]!.accountId = "different-provider-account";
    expect(
      historicalProviderExchangeSchema.safeParse({
        request: providerRequest(),
        response: wrongAccount,
      }).success,
    ).toBe(false);
  });

  it.each([0, 501, 1.5, Number.POSITIVE_INFINITY])("rejects unsupported page count %s", (count) => {
    expect(historicalProviderRequestSchema.safeParse({ ...providerRequest(), count }).success).toBe(
      false,
    );
    expect(
      historicalReadPageRequestSchema.safeParse({ groupIndex: 0, count, offset: 0 }).success,
    ).toBe(false);
  });

  it.each([-1, 0.5, Number.MAX_SAFE_INTEGER + 1])("rejects invalid page offset %s", (offset) => {
    expect(
      historicalProviderRequestSchema.safeParse({ ...providerRequest(), offset }).success,
    ).toBe(false);
  });

  it("rejects calendar-invalid dates, range expansion, duplicate accounts and request extras", () => {
    for (const change of [
      { startDate: "2026-02-30" },
      { endDate: "2025-12-31" },
      { accountIds: ["provider-account", "provider-account"] },
      { cursor: "not-a-history-cursor" },
    ])
      expect(
        historicalProviderRequestSchema.safeParse({ ...providerRequest(), ...change }).success,
      ).toBe(false);
    const response = providerPage();
    response.transactions[0]!.date = "2026-02-01";
    expect(
      historicalProviderExchangeSchema.safeParse({ request: providerRequest(), response }).success,
    ).toBe(false);
  });

  it("rejects duplicate IDs, nonfinite amount and inconsistent page totals without guessing", () => {
    const page = providerPage();
    expect(
      historicalProviderPageSchema.safeParse({
        ...page,
        transactions: [providerRow(), providerRow()],
        totalTransactions: 2,
      }).success,
    ).toBe(false);
    expect(
      historicalProviderPageSchema.safeParse({
        ...page,
        transactions: [{ ...providerRow(), amount: Number.NaN }],
      }).success,
    ).toBe(false);
    for (const response of [
      { ...page, hasMore: true },
      { ...page, totalTransactions: 0 },
      { ...page, transactions: [], totalTransactions: 1, hasMore: true },
    ])
      expect(
        historicalProviderExchangeSchema.safeParse({ request: providerRequest(), response })
          .success,
      ).toBe(false);
  });

  it("keeps absent currency held and rejects defaults or unrecognized currency", () => {
    const source = {
      ...observation(),
      targets: [{ ...observation().targets[0]!, currencyCode: null }],
    };
    expect(historicalReadObservationSchema.safeParse(source).success).toBe(false);
    expect(
      historicalReadObservationSchema.safeParse({
        ...source,
        held: [{ transactionId: transaction, reason: "missing_or_invalid_currency" }],
      }).success,
    ).toBe(true);
    expect(
      historicalProviderPageSchema.safeParse({
        ...providerPage(),
        transactions: [{ ...providerRow(), currencyCode: "usd" }],
      }).success,
    ).toBe(false);
    expect(
      historicalReadObservationSchema.safeParse({
        ...observation(),
        accountCurrencyFallback: "USD",
      }).success,
    ).toBe(false);
  });

  it("rejects credentials, Principal JSON and provider account selectors in retained observations", () => {
    for (const extra of [
      { accessToken: "private" },
      { principal: { actorType: "user", actorId: owner } },
      { providerAccountIds: ["provider-account"] },
      { capability: {} },
    ])
      expect(
        historicalReadObservationSchema.safeParse({ ...observation(), ...extra }).success,
      ).toBe(false);
    expect(JSON.stringify(historicalReadObservationSchema.parse(observation()))).not.toContain(
      "private-provider-credential",
    );
  });

  it("rejects duplicate/unbound targets, overlapping groups and non-missing target fields", () => {
    const original = manifest();
    for (const change of [
      { targets: [original.targets[0], original.targets[0]] },
      { targets: [{ ...original.targets[0], localAccountId: other }] },
      { targets: [{ ...original.targets[0], currencyCode: "USD" }] },
      { groups: [original.groups[0], original.groups[0]] },
      { actorId: other },
      { actorType: "agent", actorId: other },
    ])
      expect(
        historicalReadManifestSnapshotSchema.safeParse({ ...original, ...change }).success,
      ).toBe(false);
  });

  it("checks target sign/cents and exact page group without treating hashes as authority", () => {
    const source = observation();
    expect(
      historicalReadObservationSchema.safeParse({
        ...source,
        targets: [{ ...source.targets[0], signedAmount: "12.34" }],
      }).success,
    ).toBe(true);
    expect(
      historicalReadObservationSchema.safeParse({
        ...source,
        targets: [{ ...source.targets[0], absoluteAmountCents: 1235 }],
      }).success,
    ).toBe(false);
    expect(
      historicalReadObservationBindingSchema.safeParse({
        ...binding(),
        request: { groupIndex: 1, count: 500, offset: 0 },
      }).success,
    ).toBe(false);
    expect(
      historicalReadObservationBindingSchema.safeParse({
        ...binding(),
        observation: {
          ...source,
          targets: [{ ...source.targets[0], providerTransactionId: "other-transaction" }],
        },
      }).success,
    ).toBe(false);
    const changed = {
      ...source,
      targets: [{ ...source.targets[0], signedAmount: "-12.35", absoluteAmountCents: 1235 }],
    };
    expect(
      historicalReadObservationBindingSchema.safeParse({ ...binding(), observation: changed })
        .success,
    ).toBe(false);
    expect(
      historicalReadObservationBindingSchema.safeParse({
        ...binding(),
        observation: {
          ...changed,
          held: [{ transactionId: transaction, reason: "amount_mismatch" }],
        },
      }).success,
    ).toBe(true);
  });

  it("enforces complete target and UTF-8 evidence size bounds with explicit failure vocabularies", () => {
    const source = observation();
    const expanded = {
      ...source,
      targets: Array.from({ length: historicalReadLimits.targets + 1 }, (_, index) => ({
        ...source.targets[0],
        transactionId: `a1050000-0000-4000-8000-${String(index + 100).padStart(12, "0")}`,
        providerTransactionId: `provider-${index}`,
      })),
      page: { ...source.page, returnedCount: 101, totalTransactions: 101 },
    };
    expect(historicalReadObservationSchema.safeParse(expanded).success).toBe(false);
    const large = manifest();
    const accounts = Array.from({ length: 100 }, (_, index) => ({
      localAccountId: `a1050000-0000-4000-8000-${String(index + 100).padStart(12, "0")}`,
      providerAccountId: `${index}-${"a".repeat(1990)}`,
      nativeFingerprint: hash,
    }));
    const targets = accounts.map((row, index) => ({
      ...large.targets[0]!,
      localAccountId: row.localAccountId,
      providerAccountId: row.providerAccountId,
      transactionId: `a1050000-0000-4000-8000-${String(index + 200).padStart(12, "0")}`,
      providerTransactionId: `${index}-${"b".repeat(1990)}`,
    }));
    const groups = [
      { localAccountIds: accounts.map((row) => row.localAccountId), startDate, endDate },
    ];
    expect(
      historicalReadManifestSnapshotSchema.safeParse({ ...large, accounts, targets, groups })
        .success,
    ).toBe(true);
    const unicodeAccounts = accounts.map((row) => ({
      ...row,
      providerAccountId: row.providerAccountId.replaceAll("a", "界"),
    }));
    const unicodeTargets = targets.map((row, index) => ({
      ...row,
      providerAccountId: unicodeAccounts[index]!.providerAccountId,
      providerTransactionId: row.providerTransactionId.replaceAll("b", "界"),
    }));
    const oversized = historicalReadManifestSnapshotSchema.safeParse({
      ...large,
      accounts: unicodeAccounts,
      targets: unicodeTargets,
      groups,
    });
    expect(oversized.success).toBe(false);
    if (!oversized.success)
      expect(oversized.error.issues.some((issue) => issue.message.includes("byte bound"))).toBe(
        true,
      );
    expect(historicalReadFailureCodeSchema.parse("unsupported")).toBe("unsupported");
    expect(historicalReadHeldReasonSchema.parse("coverage_not_established")).toBe(
      "coverage_not_established",
    );
    expect(historicalReadHeldReasonSchema.safeParse("assume_usd").success).toBe(false);
  });
});
