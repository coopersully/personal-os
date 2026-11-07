import { router } from "expo-router";
import { View } from "react-native";
import { useFinanceRead, useSpending, useUpcoming } from "./data";
import { aggregateCurrency, expectedAmount, formatLocalDate, formatMoney } from "./presentation";
import { Card, Copy, FinanceRow, FinanceScreen, Metric, ReadState, Section } from "./ui";

export function FinanceOverviewScreen() {
  const spending = useSpending("month");
  const upcoming = useUpcoming();
  const accounts = useFinanceRead(["accounts"], (api) => api.listFinanceAccounts());
  const currency = aggregateCurrency(accounts.data);
  const activity = useFinanceRead(["recent-activity"], (api) =>
    api.listFinanceActivity({ limit: 3 }),
  );
  return (
    <FinanceScreen title="Overview">
      <ReadState query={spending}>
        {spending.data && (
          <Metric
            label="Spent this month"
            accent
            value={formatMoney(spending.data.snapshot.netCents / 100, "USD")}
            hint={`Your share · includes pending · ${spending.data.snapshot.coverage} coverage`}
            onPress={() =>
              router.navigate({
                pathname: "/finances/spending",
                params: { period: "month", mode: "Summary" },
              })
            }
          />
        )}
      </ReadState>
      {spending.data &&
        (spending.data.currency.unsupported.length > 0 ||
          spending.data.source.freshness !== "current") && (
          <Copy secondary>
            USD totals only. Source freshness: {spending.data.source.freshness}. Open Spending for
            coverage details.
          </Copy>
        )}
      <ReadState query={accounts}>
        {accounts.data && (
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
            <View style={{ flex: 1, minWidth: 140 }}>
              <Metric
                label="Cash"
                value={
                  currency ? formatMoney(accounts.data.totals.cash, currency) : "View by account"
                }
                hint={
                  accounts.data.accountSemantics.trustworthy
                    ? "Included accounts"
                    : "Account details need review"
                }
                onPress={() => router.navigate("/finances/accounts")}
                compact
              />
            </View>
            <View style={{ flex: 1, minWidth: 140 }}>
              <Metric
                label="Net worth"
                value={
                  currency
                    ? formatMoney(accounts.data.totals.netWorth, currency)
                    : "View by account"
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
          <Card rows>
            {upcoming.data?.occurrences
              .filter(
                (item) =>
                  item.inCurrentSchedule &&
                  (item.matchState === "expected" || item.matchState === "partially_matched"),
              )
              .slice(0, 3)
              .map((item) => (
                <FinanceRow
                  key={item.key}
                  title={item.displayName}
                  subtitle={`${formatLocalDate(item.localDate)} · expected`}
                  value={expectedAmount(item)}
                  icon="calendar"
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
                  title={entry.action}
                  subtitle={entry.explanation}
                  value={entry.status}
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
