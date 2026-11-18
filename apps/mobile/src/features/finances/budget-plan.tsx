import { router, useLocalSearchParams } from "expo-router";
import { BudgetBucketEditor, BudgetBuckets } from "./budget-buckets";
import { BudgetPlanEditor } from "./budget-plan-editor";
import { BudgetScope } from "./budget-qualification";
import { budgetMonth } from "./budget-write";
import { useFinance, useFinanceRead } from "./data";
import { spendingMonth } from "./spending-math";
import { Card, Copy, FinanceRow, FinanceScreen, ReadState, Section } from "./ui";

const route = "/finance-budget-plan" as const;

/** The Budget tab's way into revising the plan, its buckets and the month's scope. */
export function BudgetPlanDestinations() {
  const { timezone } = useFinance();
  const query = useFinanceRead(["budget"], (api) => api.getFinanceBudget());
  const plan = query.data?.data;
  const month = timezone ? spendingMonth(timezone) : plan?.effectiveFrom;
  return (
    <Section title="Manage plan">
      <ReadState query={query}>
        <Card rows>
          {plan?.status === "proposed" && (
            <FinanceRow
              title="Review proposal"
              subtitle={`Version ${plan.version} · not approved`}
              icon="check"
              onPress={() =>
                router.push({
                  pathname: "/finance-chat-reference",
                  params: { kind: "budget_plan", id: plan.planId, versionId: plan.id },
                })
              }
            />
          )}
          <FinanceRow
            title={plan ? "Revise plan" : "Create plan"}
            subtitle="Saved as a proposal for your approval"
            icon="edit"
            onPress={() => router.push({ pathname: route, params: { view: "edit" } })}
          />
          {month && (
            <>
              <FinanceRow
                title="Budget buckets"
                subtitle="Group categories for planning"
                icon="categoryLayers"
                onPress={() => router.push({ pathname: route, params: { view: "buckets", month } })}
              />
              <FinanceRow
                title="Confirm budget scope"
                subtitle="Accounts and currency this month is measured against"
                icon="calendar"
                onPress={() => router.push({ pathname: route, params: { view: "scope", month } })}
              />
            </>
          )}
        </Card>
      </ReadState>
    </Section>
  );
}

/** One route for the budget plan's pages; `view` names the page. */
export function FinanceBudgetPlanScreen() {
  const params = useLocalSearchParams<{ view?: string; id?: string; month?: string }>();
  const { owner, timezone } = useFinance();
  const month =
    budgetMonth(params.month) ??
    (timezone ? spendingMonth(timezone) : undefined);
  if (params.view === "edit") return <BudgetPlanEditor key={owner} />;
  if (params.view === "buckets" && month) return <BudgetBuckets month={month} />;
  if (params.view === "bucket" && month)
    return (
      <BudgetBucketEditor key={`${owner}:${params.id ?? "new"}`} id={params.id} month={month} />
    );
  if (params.view === "scope" && month) return <BudgetScope key={owner} month={month} />;
  return (
    <FinanceScreen title="Budget">
      <Copy>This page is unavailable.</Copy>
    </FinanceScreen>
  );
}
