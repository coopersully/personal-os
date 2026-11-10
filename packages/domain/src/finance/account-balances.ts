import { z } from "zod";
import type { FinanceAccount, FinanceAccountSemantics } from "../finance.js";

export const accountBalanceMetricSchema = z.object({
  amount: z.number().finite().nullable(),
  currency: z.string().nullable(),
  issues: z.array(
    z.object({
      reason: z.enum([
        "no_accounts",
        "ownership",
        "duplicate",
        "balance",
        "reconnect",
        "sync",
        "currency",
      ]),
      accountIds: z.array(z.string()),
    }),
  ),
});
export const financeAccountBalancesSchema = z.object({
  cash: accountBalanceMetricSchema,
  investments: accountBalanceMetricSchema,
  debt: accountBalanceMetricSchema,
  otherAssets: accountBalanceMetricSchema,
  netWorth: accountBalanceMetricSchema,
});
export type AccountBalanceMetric = z.infer<typeof accountBalanceMetricSchema>;
export type BalanceReason = AccountBalanceMetric["issues"][number]["reason"];

/** Qualify each position independently. Never turn unavailable balances into zero or net currencies. */
export function financeAccountBalances(
  accounts: readonly FinanceAccount[],
  semantics: FinanceAccountSemantics,
) {
  const included = accounts.filter((account) => account.includeInPlanning);
  const includedIds = new Set(included.map((account) => account.id));
  const duplicates = new Set(
    semantics.possibleDuplicateGroups
      .filter((group) => group.accountIds.filter((id) => includedIds.has(id)).length > 1)
      .flatMap((group) => group.accountIds),
  );
  const metric = (kind?: FinanceAccount["kind"]): AccountBalanceMetric => {
    const selected = included.filter((account) => !kind || account.kind === kind);
    const issues: AccountBalanceMetric["issues"] = [];
    const add = (reason: BalanceReason, ids: string[]) => {
      if (ids.length) issues.push({ reason, accountIds: ids });
    };
    if (!included.length)
      return { amount: null, currency: null, issues: [{ reason: "no_accounts", accountIds: [] }] };
    add(
      "ownership",
      selected
        .filter((a) => a.ownershipType === "unknown" || a.ownershipShare == null)
        .map((a) => a.id),
    );
    add(
      "duplicate",
      selected.filter((a) => duplicates.has(a.id)).map((a) => a.id),
    );
    add(
      "balance",
      selected.filter((a) => a.balance == null || !Number.isFinite(a.balance)).map((a) => a.id),
    );
    add(
      "reconnect",
      selected.filter((a) => a.status === "needs_reauth").map((a) => a.id),
    );
    add(
      "sync",
      selected
        .filter(
          (a) =>
            a.status !== "needs_reauth" &&
            (a.synchronization.state !== "current" ||
              (a.provider === "plaid" && !a.synchronization.lastSuccessAt)),
        )
        .map((a) => a.id),
    );
    const currencies = new Set((selected.length ? selected : included).map((a) => a.currencyCode));
    const currency = currencies.size === 1 ? ([...currencies][0] ?? null) : null;
    if (!currency) issues.push({ reason: "currency", accountIds: selected.map((a) => a.id) });
    // Provider balances use positive liabilities; a negative liability is a credit.
    // Preserve negative assets and overdrafts rather than inflating them with abs().
    const amount = issues.length
      ? null
      : selected.reduce(
          (sum, a) =>
            sum +
            (a.balance as number) *
              (a.ownershipShare as number) *
              (!kind && a.kind === "debt" ? -1 : 1),
          0,
        );
    return { amount, currency, issues };
  };
  return {
    cash: metric("cash"),
    investments: metric("investment"),
    debt: metric("debt"),
    otherAssets: metric("other"),
    netWorth: metric(),
  };
}
