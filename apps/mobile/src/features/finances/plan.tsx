import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { BalanceAttention, balanceHint, balancesFor } from "./balances";
import { BudgetOverview } from "./budget-overview";
import { BudgetPace } from "./budget-pace";
import { BudgetPlanDestinations } from "./budget-plan";
import { FinanceCashflow } from "./cashflow";
import { categoryIcon } from "./category-presentation";
import { useFinanceRead } from "./data";
import { FinanceGoals } from "./goals";
import { financeLabel, formatMoney } from "./presentation";
import { Card, Copy, FinanceRow, FinanceScreen, Metric, ReadState, Section, Segments } from "./ui";

function Budget() {
  const query = useFinanceRead(["budget"], (api) => api.getFinanceBudget());
  const budget = query.data?.data;
  return (
    <>
      <BudgetOverview />
      <BudgetPace />
      <BudgetPlanDestinations />
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
function Wealth() {
  const query = useFinanceRead(["accounts"], (api) => api.listFinanceAccounts());
  const balances = query.data ? balancesFor(query.data) : null;
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
      <FinanceGoals />
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
    <FinanceScreen title="Plan" tabBar>
      <Segments
        value={mode}
        options={["Budget", "Cash flow", "Wealth"]}
        onChange={(next) => {
          setMode(next);
          router.setParams({ view: next });
        }}
      />
      {mode === "Budget" ? <Budget /> : mode === "Cash flow" ? <FinanceCashflow /> : <Wealth />}
    </FinanceScreen>
  );
}
