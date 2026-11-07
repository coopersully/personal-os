import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { useFinanceRead, useUpcoming } from "./data";
import { aggregateCurrency, expectedAmount, formatLocalDate, formatMoney } from "./presentation";
import { Card, Copy, FinanceRow, FinanceScreen, Metric, ReadState, Section, Segments } from "./ui";

function Budget() {
  const query = useFinanceRead(["budget"], (api) => api.getFinanceBudget());
  const budget = query.data?.data;
  return (
    <ReadState query={query}>
      {budget ? (
        <>
          <Metric
            label={`Budget · ${budget.effectiveFrom}`}
            value={formatMoney(budget.allocatedTotal, "USD")}
            hint={`${budget.status === "active" ? "Approved" : budget.status === "proposed" ? "Proposal — not approved" : budget.status} · revision ${budget.version}`}
          />
          <Card>
            <Copy>{budget.rationale}</Copy>
            {budget.allocations.map((item) => (
              <FinanceRow
                key={item.key}
                title={item.description ?? item.key}
                subtitle={item.kind}
                value={formatMoney(item.amount, "USD")}
                icon="wallet"
              />
            ))}
          </Card>
          <Section title="Resources">
            <Card>
              {budget.resources.map((item) => (
                <FinanceRow
                  key={item.key}
                  title={item.description ?? item.key}
                  subtitle={item.kind}
                  value={formatMoney(item.amount, "USD")}
                  icon="wallet"
                />
              ))}
            </Card>
          </Section>
          {budget.assumptions.length > 0 && (
            <Section title="Assumptions">
              <Card>
                {budget.assumptions.map((item, index) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: immutable text occurrences have no identity or local state; duplicate assumptions must stay visible.
                  <Copy key={`${index}:${item}`}>{item}</Copy>
                ))}
              </Card>
            </Section>
          )}
        </>
      ) : (
        <Card>
          <Copy secondary>No budget proposal yet.</Copy>
        </Card>
      )}
    </ReadState>
  );
}
function Cashflow() {
  const query = useUpcoming();
  const occurrences = query.data?.occurrences.filter((item) => item.inCurrentSchedule) ?? [];
  return (
    <ReadState query={query}>
      <Copy secondary>
        Expected income and bills · next 30 days. These amounts are forecasts, not recorded
        transactions.
      </Copy>
      <Card>
        {occurrences.length ? (
          occurrences.map((item) => (
            <FinanceRow
              key={item.key}
              title={item.displayName}
              subtitle={`${formatLocalDate(item.localDate)} · ${item.matchState.replaceAll("_", " ")}`}
              value={expectedAmount(item)}
              icon="calendar"
            />
          ))
        ) : (
          <Copy secondary>No scheduled income or bills in the next 30 days.</Copy>
        )}
      </Card>
      {!!query.data?.unavailableSources.length && (
        <Copy secondary>
          {query.data.unavailableSources.length} sources need schedule confirmation before they can
          appear here.
        </Copy>
      )}
    </ReadState>
  );
}
function Wealth() {
  const query = useFinanceRead(["accounts"], (api) => api.listFinanceAccounts());
  const currency = aggregateCurrency(query.data);
  const goals = useFinanceRead(["goals"], (api) => api.listFinanceGoals());
  return (
    <>
      <ReadState query={query}>
        {query.data && (
          <>
            <Metric
              label="Net worth"
              value={
                currency
                  ? formatMoney(query.data.totals.netWorth, currency)
                  : "View balances by account"
              }
              hint={
                query.data.accountSemantics.trustworthy
                  ? "Included account balances"
                  : "Account ownership or duplication needs review"
              }
            />
            <Card>
              {(["cash", "investments", "debt", "otherAssets"] as const).map((key) => (
                <FinanceRow
                  key={key}
                  title={
                    key === "otherAssets" ? "Other assets" : key[0].toUpperCase() + key.slice(1)
                  }
                  value={
                    currency
                      ? formatMoney(query.data?.totals[key], currency)
                      : "Mixed / unknown currency"
                  }
                  icon="finances"
                />
              ))}
            </Card>
          </>
        )}
      </ReadState>
      <Section title="Goals">
        <ReadState query={goals}>
          <Card>
            {goals.data?.data.length ? (
              goals.data.data.map((goal) => (
                <FinanceRow key={goal.id} title={goal.name} icon="target" />
              ))
            ) : (
              <Copy secondary>No goals yet.</Copy>
            )}
          </Card>
        </ReadState>
      </Section>
    </>
  );
}
export function FinancePlanScreen() {
  const [mode, setMode] = useState<"Budget" | "Cash flow" | "Wealth">("Budget");
  const { view } = useLocalSearchParams<{ view?: string }>();
  useEffect(() => {
    if (view === "Budget" || view === "Cash flow" || view === "Wealth") setMode(view);
  }, [view]);
  return (
    <FinanceScreen title="Plan">
      <Segments
        value={mode}
        options={["Budget", "Cash flow", "Wealth"]}
        onChange={(next) => {
          setMode(next);
          router.setParams({ view: next });
        }}
      />
      {mode === "Budget" ? <Budget /> : mode === "Cash flow" ? <Cashflow /> : <Wealth />}
    </FinanceScreen>
  );
}
