import { router } from "expo-router";
import { View } from "react-native";
import { balanceHint, balancesFor } from "./balances";
import { useFinanceRead, useSpending, useUpcoming } from "./data";
import { OverviewMetric } from "./overview-metric";
import { expectedAmount, financeLabel, formatLocalDate, formatMoney } from "./presentation";
import { Card, Copy, FinanceRow, FinanceScreen, ReadState, Section } from "./ui";
import { upcomingCategory, useUpcomingCategories } from "./upcoming-category";

export function FinanceOverviewScreen() {
  const spending = useSpending("month");
  const upcoming = useUpcoming();
  const categories = useUpcomingCategories(
    !!upcoming.data?.occurrences.some((item) => item.source?.kind === "obligation"),
  );
  const accounts = useFinanceRead(["accounts"], (api) => api.listFinanceAccounts());
  const balances = accounts.data ? balancesFor(accounts.data) : null;
  const activity = useFinanceRead(["recent-activity"], (api) =>
    api.listFinanceActivity({ limit: 3 }),
  );
  const accountDetails = (kind: "cash" | "netWorth") => (
    <>
      <Copy>
        {kind === "cash"
          ? "Balances in your included cash accounts, adjusted for your ownership share."
          : "Your included cash, investments and other assets, minus debt, adjusted for your ownership share."}
      </Copy>
      {!!balances?.[kind].issues.length && (
        <Copy>
          {balanceHint(balances[kind])}. Review the accounts below for the source of this
          limitation.
        </Copy>
      )}
      <Section title="Included accounts">
        <Card rows>
          {accounts.data?.accounts
            .filter(
              (account) =>
                account.includeInPlanning && (kind === "netWorth" || account.kind === "cash"),
            )
            .map((account) => (
              <FinanceRow
                key={account.id}
                title={account.name}
                value={formatMoney(account.balance, account.currencyCode)}
                subtitle={
                  balances?.[kind].issues
                    .filter((issue) => issue.accountIds.includes(account.id))
                    .map((issue) => balanceHint({ amount: null, currency: null, issues: [issue] }))
                    .join(" · ") || account.institution
                }
                icon="finances"
              />
            ))}
          {!accounts.data?.accounts.some(
            (account) =>
              account.includeInPlanning && (kind === "netWorth" || account.kind === "cash"),
          ) && <Copy secondary>No accounts included.</Copy>}
        </Card>
      </Section>
    </>
  );
  return (
    <FinanceScreen title="Overview">
      <ReadState query={spending}>
        {spending.data && (
          <OverviewMetric
            label="Spent this month"
            accent
            value={formatMoney(spending.data.snapshot.netCents / 100, "USD")}
            status={
              spending.data.snapshot.coverage !== "complete" ||
              spending.data.currency.unsupported.length
                ? "Partial total"
                : spending.data.source.freshness !== "current"
                  ? "Needs update"
                  : undefined
            }
            details={
              <>
                <Copy>
                  Your share of spending this month. Includes pending transactions and subtracts
                  refunds.
                </Copy>
                <Section title="Coverage">
                  <Copy>
                    {spending.data.snapshot.coverage === "complete"
                      ? "All spending in this scope is covered."
                      : spending.data.snapshot.coverage === "partial"
                        ? "Only part of this month's spending is covered. The total may change as more data becomes available."
                        : "Coverage hasn’t been confirmed. This total may be incomplete."}
                  </Copy>
                  {!!spending.data.currency.unsupported.length && (
                    <Copy>Other currencies are excluded from this dollar total.</Copy>
                  )}
                </Section>
                <Section title="Updates">
                  <Copy>
                    {spending.data.source.freshness === "current"
                      ? "Sources are up to date."
                      : spending.data.source.freshness === "unknown"
                        ? "Source freshness hasn’t been confirmed."
                        : "Some sources need an update."}
                  </Copy>
                </Section>
              </>
            }
            onPress={() =>
              router.navigate({
                pathname: "/finances/spending",
                params: { period: "month", mode: "Summary" },
              })
            }
          />
        )}
      </ReadState>
      <ReadState query={accounts}>
        {accounts.data && (
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
            <View style={{ flex: 1, minWidth: 140 }}>
              <OverviewMetric
                label="Cash"
                value={
                  balances?.cash.amount == null
                    ? "—"
                    : formatMoney(balances.cash.amount, balances.cash.currency)
                }
                status={balances?.cash.issues.length ? "Unavailable" : undefined}
                details={accountDetails("cash")}
                onPress={() => router.navigate("/finances/accounts")}
                compact
              />
            </View>
            <View style={{ flex: 1, minWidth: 140 }}>
              <OverviewMetric
                label="Net worth"
                status={balances?.netWorth.issues.length ? "Unavailable" : undefined}
                details={accountDetails("netWorth")}
                value={
                  balances?.netWorth.amount == null
                    ? "—"
                    : formatMoney(balances.netWorth.amount, balances.netWorth.currency)
                }
                onPress={() =>
                  router.navigate({ pathname: "/finances/plan", params: { view: "Wealth" } })
                }
                compact
              />
            </View>
          </View>
        )}
      </ReadState>
      <Section title="Coming next">
        <ReadState query={upcoming}>
          {categories.isError && <ReadState query={categories}>{null}</ReadState>}
          <Card rows>
            {upcoming.data?.occurrences
              .filter(
                (item) =>
                  item.inCurrentSchedule &&
                  (item.matchState === "expected" || item.matchState === "partially_matched"),
              )
              .sort((a, b) => a.localDate.localeCompare(b.localDate))
              .slice(0, 3)
              .map((item) => (
                <FinanceRow
                  key={item.key}
                  title={item.displayName}
                  subtitle={`${formatLocalDate(item.localDate)} · ${upcomingCategory(item, categories.data).label} · expected`}
                  value={expectedAmount(item)}
                  valueTone={item.remainingExpectedCents == null ? "attention" : undefined}
                  icon={upcomingCategory(item, categories.data).icon}
                />
              ))}
            <FinanceRow
              title="See upcoming income and bills"
              subtitle="Next 30 days · expected amounts"
              icon="calendar"
              onPress={() =>
                router.navigate({ pathname: "/finances/plan", params: { view: "Cash flow" } })
              }
            />
          </Card>
        </ReadState>
      </Section>
      <Section title="What changed">
        <ReadState query={activity}>
          <Card rows={!!activity.data?.entries.length}>
            {activity.data?.entries.length ? (
              activity.data.entries.map((entry) => (
                <FinanceRow
                  key={entry.id}
                  title={financeLabel(entry.action)}
                  subtitle={entry.explanation}
                  value={financeLabel(entry.status)}
                  icon="history"
                  onPress={() =>
                    router.navigate({
                      pathname: "/finances/assistant",
                      params: { view: "Activity" },
                    })
                  }
                />
              ))
            ) : (
              <Copy secondary>No recorded activity yet.</Copy>
            )}
          </Card>
        </ReadState>
      </Section>
    </FinanceScreen>
  );
}
