import type { PlaidTransactionHistoryEvidence } from "@personal-os/connectors";
import type { Database } from "@personal-os/database";
import { describe, expect, it, vi } from "vitest";
import type { Principal } from "../types.js";
import { createFinanceProviderTransactionEvidenceService } from "./provider-transaction-evidence-service.js";

const id = "11111111-1111-4111-8111-111111111111",
  accountId = "22222222-2222-4222-8222-222222222222";
const date = new Date("2026-11-05T12:00:00.000Z");
const rawSource: {
  amount: number;
  currencyCode: string | null;
  providerDirection: "income" | "expense" | null;
} = { amount: 1000, currencyCode: null, providerDirection: null };
const row = {
  ...rawSource,
  transactionId: id,
  transactionRevision: 1n,
  transactionUpdatedAt: date,
  providerTransactionId: "private-tx-canary",
  date: "2026-11-01",
  accountId,
  accountRevision: 2n,
  accountUpdatedAt: date,
  providerAccountId: "private-account-canary",
  accountProviderItemId: "private-item-canary",
  accountStatus: "connected",
  provider: "plaid",
  itemRecordId: id,
  providerItemId: "private-item-canary",
  itemUpdatedAt: date,
  itemProvider: "plaid",
};
const principal: Principal = {
  actorType: "user",
  actorId: id,
  userId: id,
  scopes: new Set(["finances:read"]),
};
function fixture(after = row, firstRows = [row]) {
  const queue: unknown[][] = [
    [{ id }],
    [{ expiresAt: new Date("2027-01-01") }],
    firstRows,
    [{ id }],
    [{ expiresAt: new Date("2027-01-01") }],
    [after],
  ];
  const writes = vi.fn();
  const executor = {
    select: vi.fn(() => ({
      from: () => ({
        where: () => Promise.resolve(queue.shift()),
        innerJoin: () => ({ innerJoin: () => ({ where: () => Promise.resolve(queue.shift()) }) }),
      }),
    })),
    insert: writes,
    update: writes,
    delete: writes,
  };
  const transaction = vi.fn(async (fn: (tx: typeof executor) => Promise<unknown>) => fn(executor));
  const evidence: PlaidTransactionHistoryEvidence = {
    observedAt: date.toISOString(),
    providerUpdatedAt: null,
    snapshotConsistency: "not_atomic",
    coverage: {
      state: "partial",
      scope: "provider_available_window",
      reason: "page_limit",
      pages: 5,
      returnedTransactions: 500,
    },
    entries: [
      {
        accountId: "private-account-canary",
        transactionId: "private-tx-canary",
        status: "found",
        sourceAmount: -10,
        normalizedAmount: 10,
        economicDirection: "inflow",
        currencyCode: "USD",
        date: "2026-11-01",
      },
    ],
  };
  const readTransactionHistory = vi.fn(async () => evidence);
  const service = createFinanceProviderTransactionEvidenceService({
    db: { transaction } as unknown as Database,
    now: () => date,
    providerItems: { readTransactionHistory },
  });
  return { service, readTransactionHistory, evidence, writes, transaction, queue };
}
describe("historical provider reader", () => {
  it("maps exact native identities and signed provider evidence, preserves partial without writes", async () => {
    const f = fixture();
    const value = await f.service.read(principal, { transactionIds: [id] }, "session-hash");
    expect(value).toMatchObject({
      coverage: "partial",
      reason: "page_limit",
      entries: [
        {
          transactionId: id,
          accountId,
          sourceAmount: -10,
          normalizedAmount: 10,
          economicDirection: "inflow",
          currencyCode: "USD",
        },
      ],
    });
    expect(JSON.stringify(value)).not.toContain("private-");
    expect(f.writes).not.toHaveBeenCalled();
    expect(f.transaction).toHaveBeenCalledTimes(2);
    expect(f.readTransactionHistory).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: id,
        itemRecordId: id,
        expectedUpdatedAt: date.toISOString(),
        targets: [{ accountId: "private-account-canary", transactionId: "private-tx-canary" }],
      }),
    );
  });
  it("denies missing scope before any source/provider access", async () => {
    const f = fixture();
    await expect(
      f.service.read({ ...principal, scopes: new Set() }, { transactionIds: [id] }, "session-hash"),
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(f.transaction).not.toHaveBeenCalled();
    expect(f.readTransactionHistory).not.toHaveBeenCalled();
  });
  it("denies foreign or absent native selections before provider access", async () => {
    const f = fixture(row, []);
    await expect(
      f.service.read(principal, { transactionIds: [id] }, "session-hash"),
    ).rejects.toMatchObject({ code: "not_found" });
    expect(f.readTransactionHistory).not.toHaveBeenCalled();
  });
  it.each([
    "transactionRevision",
    "accountRevision",
  ] as const)("rejects concurrent %s changes", async (key) => {
    const f = fixture({ ...row, [key]: 3n });
    await expect(
      f.service.read(principal, { transactionIds: [id] }, "session-hash"),
    ).rejects.toMatchObject({ code: "conflict" });
    expect(f.writes).not.toHaveBeenCalled();
  });
  it("limits one read to a single connection and a window shorter than 366 days", async () => {
    const second = { ...row, transactionId: accountId, providerTransactionId: "second-tx" };
    const twoConnections = fixture(row, [row, { ...second, itemRecordId: accountId }]);
    await expect(
      twoConnections.service.read(principal, { transactionIds: [id, accountId] }, "session-hash"),
    ).rejects.toMatchObject({
      code: "invalid_request",
      message: expect.stringContaining("one Finance connection"),
    });
    const longWindow = fixture(row, [row, { ...second, date: "2025-10-01" }]);
    await expect(
      longWindow.service.read(principal, { transactionIds: [id, accountId] }, "session-hash"),
    ).rejects.toMatchObject({
      code: "invalid_request",
      message: expect.stringContaining("shorter than 366 days"),
    });
    for (const f of [twoConnections, longWindow]) {
      expect(f.readTransactionHistory).not.toHaveBeenCalled();
      expect(f.writes).not.toHaveBeenCalled();
    }
  });
  it.each([
    ["expired", { expiresAt: new Date("2026-01-01"), authorizationConnectionId: accountId }],
    ["revoked", { revokedAt: date, authorizationConnectionId: accountId }],
    ["issued to another connection", { authorizationConnectionId: id }],
    ["without Finance read access", { scopes: [], authorizationConnectionId: accountId }],
  ])("denies an agent whose grant is %s before any provider access", async (_case, grant) => {
    const f = fixture();
    f.queue[1] = [{ revokedAt: null, expiresAt: null, scopes: ["finances:read"], ...grant }];
    await expect(
      f.service.read(
        { ...principal, actorType: "agent", authorizationConnectionId: accountId },
        { transactionIds: [id] },
      ),
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(f.readTransactionHistory).not.toHaveBeenCalled();
  });
  it("rejects a relinked account after the external read", async () => {
    const f = fixture({ ...row, itemRecordId: accountId });
    await expect(
      f.service.read(principal, { transactionIds: [id] }, "session-hash"),
    ).rejects.toMatchObject({ code: "conflict" });
  });
  it("denies disconnected sources before credentials are requested", async () => {
    const f = fixture(row, [{ ...row, accountStatus: "needs_reauth" }]);
    await expect(
      f.service.read(principal, { transactionIds: [id] }, "session-hash"),
    ).rejects.toMatchObject({ code: "conflict" });
    expect(f.readTransactionHistory).not.toHaveBeenCalled();
  });
  it("does not infer missing from incomplete target coverage", async () => {
    const f = fixture();
    f.evidence.entries = [];
    const result = await f.service.read(principal, { transactionIds: [id] }, "session-hash");
    expect(result).toMatchObject({
      coverage: "conflict",
      reason: "identity_mismatch",
      entries: [{ status: "unobserved", sourceAmount: null, currencyCode: null }],
    });
  });
  it("preserves explicit invalid currency without account fallback", async () => {
    const f = fixture();
    const e = f.evidence.entries[0];
    if (!e) throw Error("fixture");
    e.status = "invalid_currency";
    e.currencyCode = null;
    e.normalizedAmount = null;
    const value = await f.service.read(principal, { transactionIds: [id] }, "session-hash");
    expect(value.entries[0]).toMatchObject({
      status: "invalid_currency",
      currencyCode: null,
      normalizedAmount: null,
    });
  });
  it("rejects malformed outward evidence without reflecting a canary", async () => {
    const f = fixture();
    f.evidence.observedAt = "secret-canary";
    await expect(
      f.service.read(principal, { transactionIds: [id] }, "session-hash"),
    ).rejects.toThrow("Historical provider evidence is invalid.");
  });
  it("denies revoked current authority after network completion", async () => {
    const f = fixture();
    f.queue.splice(3, 3, []);
    await expect(
      f.service.read(principal, { transactionIds: [id] }, "session-hash"),
    ).rejects.toMatchObject({ code: "forbidden" });
  });
  it.each([
    "revoked",
    "scope_removed",
    "connection_changed",
  ])("revalidates presenting agent authority after provider read: %s", async (change) => {
    const f = fixture();
    const token = {
      userId: id,
      revokedAt: null,
      expiresAt: null,
      scopes: ["finances:read"],
      authorizationConnectionId: id,
    };
    const afterToken = {
      ...token,
      ...(change === "revoked"
        ? { revokedAt: date }
        : change === "scope_removed"
          ? { scopes: [] }
          : { authorizationConnectionId: accountId }),
    };
    f.queue.splice(0, 6, [{ id }], [token], [row], [{ id }], [afterToken], [row]);
    await expect(
      f.service.read(
        { ...principal, actorType: "agent", authorizationConnectionId: id },
        { transactionIds: [id] },
      ),
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(f.readTransactionHistory).toHaveBeenCalledTimes(1);
    expect(f.writes).not.toHaveBeenCalled();
  });
  it("rechecks exact human-session expiry after provider completion", async () => {
    const f = fixture();
    f.queue[4] = [{ expiresAt: new Date(0) }];
    await expect(
      f.service.read(principal, { transactionIds: [id] }, "session-hash"),
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(f.readTransactionHistory).toHaveBeenCalledTimes(1);
  });
});

describe("server-private source fact acquisition prerequisite", () => {
  const targets = [
    { transactionId: id, expectedTransactionRevision: "1", expectedAccountRevision: "2" },
  ];
  function ready(after = row, firstRows = [row]) {
    const f = fixture(after, firstRows);
    f.evidence.coverage = {
      state: "complete",
      scope: "provider_available_window",
      reason: "exhausted",
      pages: 1,
      returnedTransactions: 1,
    };
    return f;
  }
  it("acquires fresh signed source facts with native revision/content fences without writing", async () => {
    const f = ready();
    const result = await f.service.acquireSourceFacts(principal, targets, "session-hash");
    expect(result.facts).toEqual([
      {
        transactionId: id,
        accountId,
        transactionRevision: "1",
        accountRevision: "2",
        currencyCode: "USD",
        providerDirection: "income",
        sourceAmount: -10,
        date: "2026-11-01",
      },
    ]);
    expect(result.nativeSnapshot[0]).toMatchObject({
      amount: 1000,
      currencyCode: null,
      providerDirection: null,
    });
    expect(result.snapshotConsistency).toBe("not_atomic");
    expect(f.readTransactionHistory).toHaveBeenCalledTimes(1);
    expect(f.writes).not.toHaveBeenCalled();
  });
  it("derives expense ONLY from positive provider sign, not native economic direction", async () => {
    const f = ready();
    const entry = f.evidence.entries[0];
    if (!entry) throw Error("fixture");
    entry.sourceAmount = 10;
    entry.economicDirection = "outflow";
    expect(
      (await f.service.acquireSourceFacts(principal, targets, "session-hash")).facts[0]
        ?.providerDirection,
    ).toBe("expense");
  });
  it("permits already identical native raw facts without rewriting them", async () => {
    const identical = { ...row, currencyCode: "USD", providerDirection: "income" as const };
    const f = ready(identical, [identical]);
    await expect(
      f.service.acquireSourceFacts(principal, targets, "session-hash"),
    ).resolves.toMatchObject({ facts: [{ currencyCode: "USD", providerDirection: "income" }] });
    expect(f.writes).not.toHaveBeenCalled();
  });
  it.each([
    "expectedTransactionRevision",
    "expectedAccountRevision",
  ] as const)("rejects stale %s before provider access", async (key) => {
    const f = ready();
    await expect(
      f.service.acquireSourceFacts(
        principal,
        [
          {
            ...targets[0],
            transactionId: id,
            expectedTransactionRevision: "1",
            expectedAccountRevision: "2",
            [key]: "9",
          },
        ],
        "session-hash",
      ),
    ).rejects.toMatchObject({ code: "conflict" });
    expect(f.readTransactionHistory).not.toHaveBeenCalled();
  });
  it.each([
    "partial",
    "conflict",
    "unavailable",
  ] as const)("does not promote %s advisory evidence to admission candidates", async (state) => {
    const f = ready();
    f.evidence.coverage.state = state;
    await expect(
      f.service.acquireSourceFacts(principal, targets, "session-hash"),
    ).rejects.toMatchObject({ code: "conflict" });
    expect(f.writes).not.toHaveBeenCalled();
  });
  it.each([
    "missing",
    "unobserved",
    "conflict",
    "invalid_currency",
  ] as const)("rejects target status %s", async (status) => {
    const f = ready();
    const entry = f.evidence.entries[0];
    if (!entry) throw Error("fixture");
    entry.status = status;
    await expect(
      f.service.acquireSourceFacts(principal, targets, "session-hash"),
    ).rejects.toMatchObject({ code: "conflict" });
  });
  it.each([
    0,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    -10.001,
  ])("rejects unproven or inexact source amount %s", async (sourceAmount) => {
    const f = ready();
    const entry = f.evidence.entries[0];
    if (!entry) throw Error("fixture");
    entry.sourceAmount = sourceAmount;
    entry.normalizedAmount = Math.abs(sourceAmount);
    await expect(
      f.service.acquireSourceFacts(principal, targets, "session-hash"),
    ).rejects.toMatchObject({ code: "conflict" });
  });
  it.each([
    { currencyCode: "EUR" },
    { providerDirection: "expense" as const },
    { amount: 1001 },
  ])("rejects incompatible existing source facts/content", async (delta) => {
    const changed = { ...row, ...delta };
    const f = ready(changed, [changed]);
    await expect(
      f.service.acquireSourceFacts(principal, targets, "session-hash"),
    ).rejects.toMatchObject({ code: "conflict" });
    expect(f.writes).not.toHaveBeenCalled();
  });
  it("rejects a source date mismatch without changing the native date", async () => {
    const f = ready();
    const entry = f.evidence.entries[0];
    if (!entry) throw Error("fixture");
    entry.date = "2026-11-02";
    await expect(
      f.service.acquireSourceFacts(principal, targets, "session-hash"),
    ).rejects.toMatchObject({ code: "conflict" });
    expect(f.writes).not.toHaveBeenCalled();
  });
  it("rejects duplicate source identities and native content changes after network", async () => {
    const f = ready();
    const entry = f.evidence.entries[0];
    if (!entry) throw Error("fixture");
    f.evidence.entries.push({ ...entry });
    await expect(
      f.service.acquireSourceFacts(principal, targets, "session-hash"),
    ).rejects.toMatchObject({ code: "conflict" });
    const raced = ready({ ...row, amount: 1001 });
    await expect(
      raced.service.acquireSourceFacts(principal, targets, "session-hash"),
    ).rejects.toMatchObject({ code: "conflict" });
    expect(raced.writes).not.toHaveBeenCalled();
  });
  it("requires current presenting read authority even for a private acquisition", async () => {
    const f = ready();
    await expect(f.service.acquireSourceFacts(principal, targets)).rejects.toMatchObject({
      code: "forbidden",
    });
    expect(f.readTransactionHistory).not.toHaveBeenCalled();
  });
  it("validates a conflicting second requested target before returning any candidates", async () => {
    const second = {
      ...row,
      transactionId: "33333333-3333-4333-8333-333333333333",
      providerTransactionId: "private-second",
      currencyCode: "USD",
    };
    const f = ready(row, [row, second]);
    f.queue[5] = [row, second];
    f.evidence.entries.push({
      accountId: "private-account-canary",
      transactionId: "private-second",
      status: "found",
      sourceAmount: 10,
      normalizedAmount: 10,
      economicDirection: "outflow",
      currencyCode: "EUR",
      date: "2026-11-01",
    });
    await expect(
      f.service.acquireSourceFacts(
        principal,
        [
          ...targets,
          {
            ...targets[0],
            transactionId: second.transactionId,
            expectedTransactionRevision: "1",
            expectedAccountRevision: "2",
          },
        ],
        "session-hash",
      ),
    ).rejects.toMatchObject({ code: "conflict" });
    expect(f.writes).not.toHaveBeenCalled();
  });
  it.each([
    null,
    "ZZZ",
  ])("rejects unproven currency without any native fallback", async (currencyCode) => {
    const f = ready();
    const entry = f.evidence.entries[0];
    if (!entry) throw Error("fixture");
    entry.currencyCode = currencyCode;
    await expect(
      f.service.acquireSourceFacts(principal, targets, "session-hash"),
    ).rejects.toMatchObject({ code: "conflict" });
  });
});
