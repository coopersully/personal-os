import type { FinanceAccount } from "@personal-os/domain";
import {
  financeAccountNeedsAttention,
  financeAccountNeedsConnectionAttention,
  financeProfileNeedsAttention,
} from "./attention";

const now = Date.parse("2026-10-06T12:00:00Z");
const account = {
  provider: "plaid",
  status: "connected",
  synchronization: { state: "current" },
  lastSyncedAt: "2026-10-06T11:00:00Z",
} as FinanceAccount;
it("flags disconnected, never-synced, and older-than-24-hour bank connections", () => {
  expect(financeAccountNeedsConnectionAttention(account, now)).toBe(false);
  expect(
    financeAccountNeedsConnectionAttention(
      { ...account, lastSyncedAt: "2026-10-05T12:00:00Z" },
      now,
    ),
  ).toBe(false);
  expect(
    financeAccountNeedsConnectionAttention(
      { ...account, lastSyncedAt: "2026-10-05T11:59:59Z" },
      now,
    ),
  ).toBe(true);
  expect(financeAccountNeedsConnectionAttention({ ...account, status: "needs_reauth" }, now)).toBe(
    true,
  );
  expect(financeAccountNeedsConnectionAttention({ ...account, lastSyncedAt: null }, now)).toBe(
    true,
  );
  expect(
    financeAccountNeedsConnectionAttention(
      { ...account, provider: "manual", lastSyncedAt: null },
      now,
    ),
  ).toBe(false);
});
it("does not treat a missing profile as completed", () =>
  expect(financeProfileNeedsAttention(null)).toBe(true));

it("includes manual account completeness and duplicate concerns in attention", () => {
  const manual = {
    ...account,
    provider: "manual",
    status: "manual",
    balance: 0,
    ownershipType: "individual",
    ownershipShare: 1,
  } as FinanceAccount;
  expect(financeAccountNeedsAttention(manual)).toBe(false);
  expect(financeAccountNeedsAttention({ ...manual, ownershipType: "unknown" })).toBe(true);
  expect(financeAccountNeedsAttention({ ...manual, ownershipShare: null })).toBe(true);
  expect(financeAccountNeedsAttention({ ...manual, balance: null })).toBe(true);
  expect(financeAccountNeedsAttention(manual, true)).toBe(true);
});
