import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { BalanceAttention, balanceHint, balancesFor } from "./balances";
import { BudgetOverview } from "./budget-overview";
import { categoryIcon } from "./category-presentation";
import { useFinanceRead, useUpcoming } from "./data";
import { expectedAmount, financeLabel, formatLocalDate, formatMoney } from "./presentation";
import { Card, Copy, FinanceRow, FinanceScreen, Metric, ReadState, Section, Segments } from "./ui";
import { upcomingCategory, useUpcomingCategories } from "./upcoming-category";

function Budget() {
  const query = useFinanceRead(["budget"], (api) => api.getFinanceBudget());
  const budget = query.data?.data;
  return (
    <>
      <BudgetOverview />
      <ReadState query={query}>
        {budget ? (
          <>
            <Card>
              <Copy>{budget.rationale}</Copy>
              {budget.allocations.map((item) => (
                <FinanceRow
                  key={item.key}
                  title={item.description ?? item.key}
                  subtitle={financeLabel(item.kind)}
                  value={formatMoney(item.amount, "USD")}
                  icon={
                    item.kind === "spending"
                      ? categoryIcon(`${item.legacyCategory ?? item.key} ${item.description ?? ""}`)
                      : item.kind === "goal"
                        ? "target"
                        : "wallet"
                  }
                />
              ))}
            </Card>
            <Section title="Resources">
              <Card>
                {budget.resources.map((item) => (
                  <FinanceRow
                    key={item.key}
                    title={item.description ?? item.key}
                    subtitle={financeLabel(item.kind)}
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
        ) : null}
      </ReadState>
    </>
  );
}
function Cashflow() {
  const query = useUpcoming();
  const categories = useUpcomingCategories(
    !!query.data?.occurrences.some((item) => item.source?.kind === "obligation"),
  );
  const occurrences =
    query.data?.occurrences
      .filter(
        (item) =>
          item.inCurrentSchedule &&
          (item.matchState === "expected" || item.matchState === "partially_matched"),
      )
      .sort((a, b) => a.localDate.localeCompare(b.localDate)) ?? [];
  return (
    <ReadState query={query}>
      {categories.isError && <ReadState query={categories}>{null}</ReadState>}
      <Copy secondary>
        Expected income and bills · next 30 days. This is an upcoming schedule, not a projected
        account balance.
      </Copy>
      <Card>
        {occurrences.length ? (
          occurrences.map((item) => (
            <FinanceRow
              key={item.key}
              title={item.displayName}
              subtitle={`${formatLocalDate(item.localDate)} · ${upcomingCategory(item, categories.data).label} · ${financeLabel(item.matchState)}`}
              value={expectedAmount(item)}
              valueTone={item.remainingExpectedCents == null ? "attention" : undefined}
              icon={upcomingCategory(item, categories.data).icon}
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
  const balances = query.data ? balancesFor(query.data) : null;
  const goals = useFinanceRead(["goals"], (api) => api.listFinanceGoals());
  return (
    <>
      <ReadState query={query}>
        {query.data && (
          <>
            <Metric
              label="Net worth"
              value={formatMoney(balances?.netWorth.amount, balances?.netWorth.currency)}
              hint={balances ? balanceHint(balances.netWorth) : undefined}
            />
            <BalanceAttention data={query.data} />
            <Card>
              {(["cash", "investments", "debt", "otherAssets"] as const).map((key) => (
                <FinanceRow
                  key={key}
                  title={
                    key === "otherAssets" ? "Other assets" : key[0].toUpperCase() + key.slice(1)
                  }
                  value={formatMoney(balances?.[key].amount, balances?.[key].currency)}
                  subtitle={balances?.[key].issues.length ? balanceHint(balances[key]) : undefined}
                  valueTone={balances?.[key].issues.length ? "attention" : undefined}
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
                <FinanceRow
                  key={goal.id}
                  title={goal.name}
                  subtitle={`${formatMoney(goal.currentAmount, "USD")} of ${formatMoney(goal.targetAmount, "USD")}${goal.deadline ? ` · by ${formatLocalDate(goal.deadline)}` : ""}`}
                  value={
                    goal.targetAmount > 0
                      ? `${Math.round((goal.currentAmount / goal.targetAmount) * 100)}%`
                      : undefined
                  }
                  icon="target"
                />
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
