import {
  type AccountBalanceMetric,
  type FinanceAccountList,
  financeAccountBalances,
} from "@personal-os/domain";
import { router } from "expo-router";
import { Card, FinanceRow } from "./ui";

export function balancesFor(value: FinanceAccountList) {
  return value.balances ?? financeAccountBalances(value.accounts, value.accountSemantics);
}
export function balanceHint(metric: AccountBalanceMetric) {
  const reason = metric.issues[0]?.reason;
  return reason
    ? {
        no_accounts: "No included accounts",
        ownership: "Confirm account ownership",
        duplicate: "Review possible duplicate accounts",
        balance: "Balance unavailable",
        reconnect: "Reconnect account",
        sync: "Waiting for current balances",
        currency: "Currencies cannot be combined",
      }[reason]
    : "Included account balances";
}
export function BalanceAttention({ data }: { data: FinanceAccountList }) {
  const issues = balancesFor(data).netWorth.issues;
  const ids = new Set(issues.flatMap((issue) => issue.accountIds));
  if (!issues.length) return null;
  return (
    <Card rows>
      {data.accounts
        .filter((a) => ids.has(a.id))
        .map((account) => (
          <FinanceRow
            key={account.id}
            title={account.name}
            icon="attention"
            subtitle={balanceHint({
              amount: null,
              currency: null,
              issues: issues.filter((issue) => issue.accountIds.includes(account.id)),
            })}
            onPress={() =>
              router.push({ pathname: "/finance-account", params: { id: account.id } })
            }
          />
        ))}
      {!ids.size && (
        <FinanceRow
          title="No included accounts"
          subtitle="Include an account in planning to see your totals."
          icon="finances"
          onPress={() => router.navigate("/finances/accounts")}
        />
      )}
    </Card>
  );
}
