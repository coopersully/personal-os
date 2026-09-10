import { describe, expect, it } from "vitest";
import {
  effectiveSynchronization,
  isFinanceTargetType,
  latestProfile,
  nextMonth,
  stableJson,
  synchronization,
  transactionIsInScope,
} from "./finance-status-service.js";

const source = {
  lastSyncAttemptAt: new Date("2026-08-20T10:00:00.000Z"),
  lastSyncedAt: new Date("2026-08-20T11:00:00.000Z"),
  nextSyncAt: new Date("2026-08-21T11:00:00.000Z"),
  syncError: "Retry later",
  syncErrorCode: "TEMPORARY",
  syncFailureCount: 1,
  syncRecovery: "automatic",
  syncState: "current",
};

describe("Finance status deterministic helpers", () => {
  it("recognizes only supported Finance targets and produces stable evidence JSON", () => {
    expect(isFinanceTargetType("finance_account")).toBe(true);
    expect(isFinanceTargetType("finance_review_case")).toBe(true);
    expect(isFinanceTargetType("finance_transaction")).toBe(true);
    expect(isFinanceTargetType("finance_budget")).toBe(false);
    expect(stableJson({ z: 1, nested: { b: 2, a: 1 }, a: 0 })).toBe(
      '{"a":0,"nested":{"a":1,"b":2},"z":1}',
    );
  });

  it("keeps synchronization failures, stale evidence, and manual sources distinct", () => {
    expect(synchronization(source as never)).toMatchObject({
      failureCount: 1,
      nextRetryAt: "2026-08-21T11:00:00.000Z",
      state: "current",
    });
    expect(
      effectiveSynchronization(source as never, new Date("2026-08-22T12:00:00.000Z")),
    ).toMatchObject({
      state: "stale",
    });
    expect(
      effectiveSynchronization(source as never, new Date("2026-08-22T12:00:00.000Z"), true),
    ).toMatchObject({ state: "current" });
    expect(synchronization({ ...source, syncFailureCount: 0 } as never)).toMatchObject({
      nextRetryAt: null,
    });
  });

  it("scopes ledger transactions for windows, targets, reviews, and current month", () => {
    const row = { accountId: "account", id: "transaction", transactionDate: "2026-08-15" } as never;
    expect(nextMonth("2026-12")).toBe("2027-01");
    expect(
      transactionIsInScope(
        row,
        { end: "2026-08-31", start: "2026-08-01", type: "window" },
        "2026-08",
        null,
      ),
    ).toBe(true);
    expect(
      transactionIsInScope(
        row,
        { end: "2026-08-14", start: "2026-08-01", type: "window" },
        "2026-08",
        null,
      ),
    ).toBe(false);
    expect(
      transactionIsInScope(
        row,
        { entityType: "finance_transaction", id: "transaction", type: "target" },
        "2026-08",
        null,
      ),
    ).toBe(true);
    expect(
      transactionIsInScope(
        row,
        { entityType: "finance_account", id: "account", type: "target" },
        "2026-08",
        null,
      ),
    ).toBe(true);
    expect(
      transactionIsInScope(
        row,
        { entityType: "finance_review_case", id: "review", type: "target" },
        "2026-08",
        "transaction",
      ),
    ).toBe(true);
    expect(
      transactionIsInScope(
        row,
        { entityType: "finance_review_case", id: "review", type: "target" },
        "2026-08",
        null,
      ),
    ).toBe(false);
    expect(transactionIsInScope(row, { type: "all_outstanding" }, "2026-08", null)).toBe(true);
  });

  it("selects the newest profile effective at the requested date", () => {
    expect(
      latestProfile(
        [
          { effectiveDate: "2026-07-01" },
          { effectiveDate: "2026-08-01" },
          { effectiveDate: "2026-09-01" },
        ] as never,
        "2026-08-15",
      ),
    ).toMatchObject({ effectiveDate: "2026-08-01" });
    expect(latestProfile([{ effectiveDate: "2026-09-01" }] as never, "2026-08-15")).toBeUndefined();
  });
});
