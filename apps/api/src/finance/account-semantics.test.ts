import type { FinanceAccount } from "@personal-os/domain";
import {
  accountMatchesQuery,
  financeAccountKindFromProviderType,
  summarizeFinanceAccounts,
} from "./account-semantics.js";

const now = "2026-08-27T12:00:00.000Z";

function account(overrides: Partial<FinanceAccount> = {}): FinanceAccount {
  return {
    balance: 100,
    createdAt: now,
    currencyCode: "USD",
    id: crypto.randomUUID(),
    includeInPlanning: true,
    institution: "Example Bank",
    kind: "cash",
    kindSource: "user",
    lastSyncedAt: null,
    name: "Checking",
    ownershipShare: 1,
    ownershipType: "individual",
    provider: "manual",
    providerSubtype: null,
    providerType: null,
    status: "manual",
    synchronization: {
      failureCode: null,
      failureCount: 0,
      lastAttemptAt: null,
      lastSuccessAt: null,
      message: null,
      nextRetryAt: null,
      recovery: null,
      state: "current",
    },
    updatedAt: now,
    ...overrides,
  };
}

describe("Finance account planning semantics", () => {
  it.each([
    "stale",
    "retrying",
    "blocked",
  ] as const)("qualifies totals for a %s source while preserving useful account balances", (state) => {
    const healthy = account({ name: "Healthy", balance: 250 });
    const failed = account({ name: "Failed", balance: 100 });
    failed.synchronization.state = state;
    expect(summarizeFinanceAccounts([healthy, failed])).toMatchObject({
      accountSemantics: { trustworthy: false },
      totals: { cash: 350 },
    });
    failed.includeInPlanning = false;
    expect(summarizeFinanceAccounts([healthy, failed])).toMatchObject({
      accountSemantics: { trustworthy: true },
      totals: { cash: 250 },
    });
  });

  it("does not verify a missing balance as zero", () => {
    expect(summarizeFinanceAccounts([account({ balance: null })])).toMatchObject({
      accountSemantics: { trustworthy: false },
    });
  });

  it("does not verify empty coverage or a connected source without a successful sync", () => {
    expect(summarizeFinanceAccounts([]).accountSemantics.trustworthy).toBe(false);
    expect(
      summarizeFinanceAccounts([account({ includeInPlanning: false })]).accountSemantics
        .trustworthy,
    ).toBe(false);
    expect(
      summarizeFinanceAccounts([account({ provider: "plaid", status: "connected" })])
        .accountSemantics.trustworthy,
    ).toBe(false);
  });

  it("keeps duplicate warnings but stops qualifying totals once the duplicate is excluded", () => {
    const included = account();
    const excluded = account({ includeInPlanning: false });
    expect(summarizeFinanceAccounts([included, excluded])).toMatchObject({
      accountSemantics: {
        trustworthy: true,
        possibleDuplicateGroups: [{ accountIds: [included.id, excluded.id].sort() }],
      },
      totals: { cash: 100 },
    });
  });

  it.each([
    ["depository", "cash"],
    ["investment", "investment"],
    ["brokerage", "investment"],
    ["credit", "debt"],
    ["loan", "debt"],
    ["other", "other"],
    [undefined, "cash"],
  ] as const)("maps provider type %s to %s", (providerType, kind) => {
    expect(financeAccountKindFromProviderType(providerType)).toBe(kind);
  });

  it("discloses normalized duplicates and unresolved ownership without inventing a balance", () => {
    const first = account({
      balance: null,
      institution: "Example-Bank",
      ownershipShare: null,
      ownershipType: "unknown",
    });
    const duplicate = account({
      id: crypto.randomUUID(),
      institution: "example bank",
      name: "CHECKING",
    });

    expect(summarizeFinanceAccounts([first, duplicate])).toEqual({
      accountSemantics: {
        excludedAccountIds: [],
        possibleDuplicateGroups: [{ accountIds: [first.id, duplicate.id].sort() }],
        trustworthy: false,
        unresolvedOwnershipAccountIds: [first.id],
      },
      totals: { cash: 100, debt: 0, investments: 0, netWorth: 100, otherAssets: 0 },
    });
  });

  it("applies every discovery filter independently", () => {
    const investment = account({ kind: "investment", name: "Roth IRA", status: "connected" });
    expect(accountMatchesQuery(investment, { includeExcluded: true })).toBe(true);
    expect(accountMatchesQuery(investment, { includeExcluded: true, kind: "cash" })).toBe(false);
    expect(accountMatchesQuery(investment, { includeExcluded: true, status: "manual" })).toBe(
      false,
    );
    expect(accountMatchesQuery(investment, { includeExcluded: true, query: "roth" })).toBe(true);
    expect(accountMatchesQuery(investment, { includeExcluded: true, query: "checking" })).toBe(
      false,
    );
  });
});
