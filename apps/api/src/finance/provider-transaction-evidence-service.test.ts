import type { PlaidTransactionHistoryEvidence } from "@personal-os/connectors";
import type { Database } from "@personal-os/database";
import { describe, expect, it, vi } from "vitest";
import type { Principal } from "../types.js";
import { createFinanceProviderTransactionEvidenceService } from "./provider-transaction-evidence-service.js";

const id = "11111111-1111-4111-8111-111111111111",
  accountId = "22222222-2222-4222-8222-222222222222";
const date = new Date("2026-11-05T12:00:00.000Z");
const row = {
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
});
