import type { FinanceRecurringOccurrence } from "@personal-os/domain";
import { Stack, useLocalSearchParams } from "expo-router";
import {
  cashflowPage,
  useCashflowAccounts,
  useOccurrences,
  useRecurringItems,
} from "./cashflow-data";
import {
  occurrenceStateLabel,
  type RecurringItem,
  type RecurringKind,
  recurringStatusLabel,
  recurringSummary,
  shiftDate,
} from "./cashflow-rules";
import { useFinance, useUpcoming } from "./data";
import { localToday } from "./mutations";
import { FinanceOccurrenceMatch, FinanceOccurrenceScreen } from "./occurrence";
import {
  expectedAmount,
  financeLabel,
  formatLocalDate,
  formatMoney,
  upcomingScope,
} from "./presentation";
import { FinanceRecurringCost } from "./recurring-cost-editor";
import { FinanceRecurringItemScreen } from "./recurring-item";
import { FinanceRecurringScheduleEditor } from "./recurring-schedule-editor";
import { FinanceScenarios } from "./scenarios";
import { Card, Copy, FinanceRow, FinanceScreen, ReadState, Section } from "./ui";
import { upcomingCategory, useUpcomingCategories } from "./upcoming-category";

const page = cashflowPage;
const openOccurrence = (item: FinanceRecurringOccurrence, range: { from: string; to: string }) =>
  page("occurrence", { key: item.key, ...range });

/**
 * Plan › Cash flow: the outlook of expected income and bills, and the way into income, bills
 * and subscriptions, recent expected items and scenarios.
 */
export function FinanceCashflow() {
  const { timezone } = useFinance();
  const query = useUpcoming();
  const range = timezone ? upcomingScope(timezone) : null;
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
    <>
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
                onPress={range ? () => openOccurrence(item, range) : undefined}
              />
            ))
          ) : (
            <Copy secondary>No scheduled income or bills in the next 30 days.</Copy>
          )}
        </Card>
        {!!query.data?.unavailableSources.length && (
          <Copy secondary>
            {query.data.unavailableSources.length} sources need schedule confirmation before they
            can appear here.
          </Copy>
        )}
      </ReadState>
      <Section title="Recurring">
        <Card rows>
          <FinanceRow
            centered
            title="Income"
            icon="categoryDollar"
            onPress={() => page("income")}
          />
          <FinanceRow
            centered
            title="Bills & subscriptions"
            icon="wallet"
            onPress={() => page("bills")}
          />
          <FinanceRow
            centered
            title="Recent expected items"
            icon="history"
            onPress={() => page("recent")}
          />
          <FinanceRow centered title="Scenarios" icon="views" onPress={() => page("scenarios")} />
        </Card>
      </Section>
    </>
  );
}

function useItemCurrency() {
  const accounts = useCashflowAccounts();
  return (item: RecurringItem) =>
    accounts.data?.accounts.find((account) => account.id === item.accountId)?.currencyCode;
}

function ItemRows({ items, kind }: { items: readonly RecurringItem[]; kind: RecurringKind }) {
  const currency = useItemCurrency();
  return (
    <Card rows>
      {items.map((item) => (
        <FinanceRow
          key={item.id}
          title={item.displayName}
          subtitle={`${recurringStatusLabel(item.status)} · ${recurringSummary(item)}`}
          value={formatMoney(item.expectedAmount, currency(item))}
          valueTone={item.status === "needs_review" ? "attention" : undefined}
          icon={kind === "income" ? "categoryDollar" : "wallet"}
          onPress={() => page("item", { kind, id: item.id })}
        />
      ))}
    </Card>
  );
}

function IncomePage() {
  const query = useRecurringItems();
  const income = query.data?.data.income ?? [];
  return (
    <FinanceScreen title="Income">
      <Copy secondary>
        Each row is a pattern of deposits and where it stands: needing confirmation, active or
        paused. Transfers and reimbursements belong to their original activity.
      </Copy>
      <ReadState query={query}>
        {income.length ? (
          <ItemRows items={income} kind="income" />
        ) : (
          <Card>
            <Copy>No income patterns yet</Copy>
            <Copy secondary>Income appears when there is enough account history.</Copy>
          </Card>
        )}
      </ReadState>
    </FinanceScreen>
  );
}

const billGroups = [
  { kind: "bill", title: "Bills" },
  { kind: "subscription", title: "Subscriptions" },
  { kind: "savings", title: "Savings" },
] as const;
function BillsPage() {
  const query = useRecurringItems();
  const obligations = query.data?.data.obligations ?? [];
  return (
    <FinanceScreen title="Bills & subscriptions">
      <Copy secondary>
        Changing a pattern updates its next expected record. It does not cancel a subscription or
        change a payment with its provider.
      </Copy>
      <ReadState query={query}>
        {obligations.length ? (
          billGroups.map((group) => {
            const items = obligations.filter((item) => item.kind === group.kind);
            return items.length ? (
              <Section key={group.kind} title={group.title}>
                <ItemRows items={items} kind="obligation" />
              </Section>
            ) : null;
          })
        ) : (
          <Card>
            <Copy>No bills or subscriptions yet</Copy>
            <Copy secondary>Recurring activity appears when there is enough account history.</Copy>
          </Card>
        )}
      </ReadState>
    </FinanceScreen>
  );
}

/** The last 30 days of expected items: where a posted transaction can be matched. */
function RecentPage() {
  const { timezone } = useFinance();
  const today = timezone ? localToday(timezone) : null;
  const range = today ? { from: shiftDate(today, -30), to: today } : null;
  const query = useOccurrences(range);
  const occurrences = [...(query.data?.occurrences ?? [])].sort(
    (a, b) => b.localDate.localeCompare(a.localDate) || a.key.localeCompare(b.key),
  );
  return (
    <FinanceScreen title="Recent expected items">
      <Copy secondary>
        Expected income and bills from the last 30 days, from schedules you confirmed. Open one to
        match it to a posted transaction or to reverse a match.
      </Copy>
      {!timezone && <Copy>Set your account timezone in Settings to see dated items.</Copy>}
      <ReadState query={{ ...query, configurationMissing: !timezone }}>
        {occurrences.length ? (
          <Card rows>
            {occurrences.map((item) => (
              <FinanceRow
                key={item.key}
                title={item.displayName}
                subtitle={`${formatLocalDate(item.localDate)} · ${occurrenceStateLabel(item.matchState)}${item.inCurrentSchedule ? "" : " · Earlier schedule"}`}
                value={
                  item.expectedAmountCents == null
                    ? "Unavailable"
                    : formatMoney(item.expectedAmountCents / 100, item.currencyCode)
                }
                icon={item.source.kind === "income" ? "categoryDollar" : "wallet"}
                onPress={range ? () => openOccurrence(item, range) : undefined}
              />
            ))}
          </Card>
        ) : (
          <Card>
            <Copy secondary>No expected items in the last 30 days.</Copy>
          </Card>
        )}
        {!!query.data?.unavailableSources.length && (
          <Copy secondary>
            {query.data.unavailableSources.length} sources need schedule confirmation before they
            can appear here.
          </Copy>
        )}
      </ReadState>
    </FinanceScreen>
  );
}

const titles: Record<string, string> = {
  income: "income",
  bills: "bills & subscriptions",
  recent: "recent expected items",
};
/** One route for every Cash flow page; `view` names the page. */
export function FinanceCashflowRoute() {
  const { view } = useLocalSearchParams<{ view?: string }>();
  switch (view) {
    case "item":
      return <FinanceRecurringItemScreen />;
    case "schedule":
      return <FinanceRecurringScheduleEditor />;
    case "cost":
      return <FinanceRecurringCost />;
    case "occurrence":
      return <FinanceOccurrenceScreen />;
    case "match":
      return <FinanceOccurrenceMatch />;
    case "scenarios":
      return <FinanceScenarios />;
    default:
      return (
        <>
          <Stack.Screen options={{ title: titles[view ?? ""] ?? "cash flow" }} />
          {view === "income" ? (
            <IncomePage />
          ) : view === "bills" ? (
            <BillsPage />
          ) : view === "recent" ? (
            <RecentPage />
          ) : (
            <FinanceScreen title="Cash flow">
              <Copy secondary>This page is unavailable.</Copy>
            </FinanceScreen>
          )}
        </>
      );
  }
}
