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
