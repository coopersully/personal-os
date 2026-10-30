import type {
  FinanceAccount,
  FinanceAccountList,
  FinanceAccountQuery,
  FinanceAccountTotals,
  FinanceProviderAccountType,
} from "@personal-os/domain";

export function financeAccountKindFromProviderType(
  type: FinanceProviderAccountType | undefined,
): FinanceAccount["kind"] {
  if (type === "depository") return "cash";
  if (type === "investment" || type === "brokerage") return "investment";
  if (type === "credit" || type === "loan") return "debt";
  return type === "other" ? "other" : "cash";
}

function duplicateKey(account: FinanceAccount): string {
  return `${account.institution}:${account.name}`
    .normalize("NFKD")
    .toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9]+/gu, " ")
    .trim();
}

export function summarizeFinanceAccounts(
  accounts: FinanceAccount[],
  providerDuplicateGroups: string[][] = [],
): {
  accountSemantics: FinanceAccountList["accountSemantics"];
  totals: FinanceAccountTotals;
} {
  const totals: FinanceAccountTotals = {
    cash: 0,
    debt: 0,
    investments: 0,
    netWorth: 0,
    otherAssets: 0,
  };
  const duplicateIds = new Map<string, string[]>();
  const excludedAccountIds: string[] = [];
  const unresolvedOwnershipAccountIds: string[] = [];
  for (const account of accounts) {
    const ids = duplicateIds.get(duplicateKey(account)) ?? [];
    ids.push(account.id);
    duplicateIds.set(duplicateKey(account), ids);
    if (!account.includeInPlanning) {
      excludedAccountIds.push(account.id);
      continue;
    }
    const share = account.ownershipType === "unknown" ? 1 : (account.ownershipShare as number);
    if (account.ownershipType === "unknown") unresolvedOwnershipAccountIds.push(account.id);
    const value = Math.abs(account.balance ?? 0) * share;
    if (account.kind === "debt") totals.debt += value;
    else if (account.kind === "investment") totals.investments += value;
    else if (account.kind === "other") totals.otherAssets += value;
    else totals.cash += (account.balance ?? 0) * share;
  }
  totals.netWorth = totals.cash + totals.investments + totals.otherAssets - totals.debt;
  const roots = new Map(accounts.map((account) => [account.id, account.id]));
  const root = (id: string): string => {
    let current = id;
    while (roots.get(current) && roots.get(current) !== current)
      current = roots.get(current) as string;
    return current;
  };
  for (const ids of [...duplicateIds.values(), ...providerDuplicateGroups]) {
    const valid = ids.filter((id) => roots.has(id));
    const first = valid[0];
    if (!first) continue;
    for (const id of valid) roots.set(root(id), root(first));
  }
  const groups = new Map<string, string[]>();
  for (const account of accounts) {
    const key = root(account.id);
    groups.set(key, [...(groups.get(key) ?? []), account.id]);
  }
  const possibleDuplicateGroups = [...groups.values()]
    .filter((accountIds) => accountIds.length > 1)
    .map((accountIds) => ({ accountIds: accountIds.sort() }));
  const includedIds = new Set(
    accounts.filter((account) => account.includeInPlanning).map((account) => account.id),
  );
  return {
    accountSemantics: {
      excludedAccountIds: excludedAccountIds.sort(),
      possibleDuplicateGroups,
      trustworthy:
        includedIds.size > 0 &&
        unresolvedOwnershipAccountIds.length === 0 &&
        !possibleDuplicateGroups.some(
          (group) => group.accountIds.filter((id) => includedIds.has(id)).length > 1,
        ) &&
        accounts.every(
          (account) =>
            !account.includeInPlanning ||
            (account.balance !== null &&
              account.status !== "needs_reauth" &&
              (account.provider !== "plaid" || account.synchronization.lastSuccessAt !== null) &&
              account.synchronization.state === "current"),
        ),
      unresolvedOwnershipAccountIds: unresolvedOwnershipAccountIds.sort(),
    },
    totals,
  };
}

export function accountMatchesQuery(account: FinanceAccount, query: FinanceAccountQuery): boolean {
  if (query.kind && account.kind !== query.kind) return false;
  if (query.status && account.status !== query.status) return false;
  if (!query.query) return true;
  const needle = query.query.toLocaleLowerCase("en-US");
  return `${account.institution} ${account.name}`.toLocaleLowerCase("en-US").includes(needle);
}
