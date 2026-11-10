import type { FinanceSpendingReferenceFilter } from "@personal-os/domain";
import { type InfiniteData, keepPreviousData, useInfiniteQuery } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, TextInput } from "react-native";
import { radius, spacing, useTheme } from "../../theme";
import { categoryIcon } from "./category-presentation";
import { useFinance, useSpending } from "./data";
import { financeLabel, formatLocalDate, formatMoney, recordAmount } from "./presentation";
import { SpendingChart } from "./spending-chart";
import { Card, Copy, FinanceRow, FinanceScreen, Metric, ReadState, Segments } from "./ui";

export function Transactions({
  budgetId,
  accountId,
  reference,
  from,
  through,
}: {
  budgetId?: string;
  from?: string;
  through?: string;
  accountId?: string;
  reference?: FinanceSpendingReferenceFilter;
}) {
  const { api, owner } = useFinance();
  const t = useTheme();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<"All" | "Posted" | "Pending">("All");
  const [term, setTerm] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setTerm(search.trim()), 250);
    return () => clearTimeout(timer);
  }, [search]);
  const filters = {
    budgetId,
    from,
    to: through,
    search: term || undefined,
    pending: status === "All" ? undefined : status === "Pending",
  };
  type TransactionPage =
    | Awaited<ReturnType<typeof api.listFinanceTransactions>>
    | Awaited<ReturnType<typeof api.listFinanceSpendingTransactions>>;
  const query = useInfiniteQuery<
    TransactionPage,
    Error,
    InfiniteData<TransactionPage>,
    readonly unknown[],
    string | undefined
  >({
    meta: { scopedReadFeedback: true },
    queryKey: ["finances", owner, "transactions", accountId, reference, filters],
    enabled: !!owner,
    staleTime: 30_000,
    placeholderData: (previous, previousQuery) =>
      previousQuery &&
      previousQuery.queryKey[1] === owner &&
      previousQuery.queryKey[3] === accountId &&
      previousQuery.queryKey[4] === reference &&
      (previousQuery.queryKey[5] as typeof filters).budgetId === budgetId
        ? keepPreviousData(previous)
        : undefined,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      reference
        ? api.listFinanceSpendingTransactions(reference, pageParam)
        : api.listFinanceTransactions({ ...filters, accountId, cursor: pageParam, limit: 50 }),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
  const rows = query.data?.pages.flatMap((page) => page.items) ?? [];
  const firstPage = query.data?.pages[0];
  const contribution = firstPage && "netCents" in firstPage ? (firstPage.netCents as number) : null;
  return (
    <>
      {!reference && (
        <>
          <TextInput
            accessibilityLabel="Search transactions"
            placeholder="Groceries, coffee, rent"
            value={search}
            onChangeText={setSearch}
            placeholderTextColor={t.secondary}
            style={{
              color: t.ink,
              backgroundColor: t.surface,
              borderRadius: radius.menu,
              padding: spacing.lg,
              minHeight: 44,
            }}
          />
          {!budgetId && (
            <Segments value={status} options={["All", "Posted", "Pending"]} onChange={setStatus} />
          )}
        </>
      )}
      <ReadState
        query={{
          ...query,
          feedbackKey: JSON.stringify([
            "finances",
            owner,
            "transactions",
            accountId,
            reference,
            filters,
          ]),
        }}
      >
        <Card rows={rows.length > 0 && !reference}>
          {query.isPlaceholderData && (
            <ActivityIndicator accessibilityLabel="Updating transactions" color={t.secondary} />
          )}
          {reference && (
            <>
              <Copy>
                Spending contribution:{" "}
                {formatMoney(contribution == null ? null : contribution / 100, "USD")}
              </Copy>
              <Copy secondary>Transaction amounts below show the full records.</Copy>
            </>
          )}
          {rows.length === 0 ? (
            <Copy secondary>No transactions in this view.</Copy>
          ) : (
            rows.map((item) => (
              <FinanceRow
                key={item.id}
                title={item.merchant}
                icon={categoryIcon(item.category ?? "Uncategorized")}
                subtitle={[
                  formatLocalDate(item.date),
                  item.category ?? "Uncategorized",
                  item.pending ? "Pending" : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
                value={`${item.direction === "expense" ? "−" : item.direction === "income" ? "+" : ""}${recordAmount(item.amount, item.currencyCode)}`}
                onPress={() =>
                  router.push({ pathname: "/finance-transaction", params: { id: item.id } })
                }
              />
            ))
          )}
          {query.hasNextPage && !query.isPlaceholderData && (
            <FinanceRow
              title={query.isFetchingNextPage ? "Loading…" : "Load more transactions"}
              onPress={query.isFetchingNextPage ? undefined : () => void query.fetchNextPage()}
            />
          )}
        </Card>
      </ReadState>
    </>
  );
}
export function FinanceSpendingScreen() {
  const [mode, setMode] = useState<"Summary" | "Transactions">("Summary");
  const [period, setPeriod] = useState<"This week" | "This month">("This week");
  const [group, setGroup] = useState<{
    title: string;
    reference: FinanceSpendingReferenceFilter;
  } | null>(null);
  const { period: routePeriod, mode: routeMode } = useLocalSearchParams<{
    period?: string;
    mode?: string;
  }>();
  useEffect(() => {
    if (routePeriod === "month" || routePeriod === "week") {
      setPeriod(routePeriod === "month" ? "This month" : "This week");
      setGroup(null);
    }
    if (routeMode === "Summary" || routeMode === "Transactions") setMode(routeMode);
  }, [routePeriod, routeMode]);
  const query = useSpending(period === "This week" ? "week" : "month");
  return (
    <FinanceScreen title="Spending">
      <Segments
        value={mode}
        options={["Summary", "Transactions"]}
        onChange={(next) => {
          setMode(next);
          router.setParams({ mode: next });
        }}
      />
      <Segments
        value={period}
        options={["This week", "This month"]}
        onChange={(next) => {
          setPeriod(next);
          router.setParams({ period: next === "This month" ? "month" : "week" });
          setGroup(null);
        }}
      />

      {mode === "Transactions" ? (
        query.scope ? (
          <Transactions from={query.scope.from} through={query.scope.through} />
        ) : (
          <ReadState query={query}>{null}</ReadState>
        )
      ) : (
        <ReadState query={query}>
          {query.data && query.scope && (
            <>
              <Metric
                accent
                label={`${formatLocalDate(query.scope.from)} – ${formatLocalDate(query.scope.through)}`}
                value={formatMoney(query.data.snapshot.netCents / 100, "USD")}
                hint="Your share · pending included · refunds subtracted"
              >
                <SpendingChart bins={query.data.snapshot.bins} />
              </Metric>
              <Copy secondary>
                {financeLabel(query.data.snapshot.coverage)} coverage ·{" "}
                {query.data.source.freshness === "unknown"
                  ? "freshness not confirmed"
                  : financeLabel(query.data.source.freshness)}
                {query.data.currency.unsupported.length ? " · other currencies excluded" : ""}
              </Copy>
              {group ? (
                <>
                  <FinanceRow title="All categories" icon="views" onPress={() => setGroup(null)} />
                  <Copy>{group.title}</Copy>
                  <Transactions reference={group.reference} />
                </>
              ) : (
                <Card rows={query.data.groups.length > 0}>
                  {query.data.groups.length ? (
                    query.data.groups.map((item) => (
                      <FinanceRow
                        key={item.id}
                        title={item.label}
                        icon={categoryIcon(item.label, item.visual?.icon, item.kind ?? "category")}
                        value={formatMoney(item.netCents / 100, "USD")}
                        onPress={
                          query.data?.referenceRevision
                            ? () => {
                                if (!query.scope || !query.data?.referenceRevision) return;
                                setGroup({
                                  title: item.label,
                                  reference: {
                                    query: {
                                      scope: query.scope,
                                      grouping: "auto",
                                      includeUncategorized: true,
                                    },
                                    referenceRevision: query.data.referenceRevision,
                                    groupId: item.id,
                                    from: query.scope.from,
                                    through: query.scope.through,
                                  },
                                });
                              }
                            : undefined
                        }
                      />
                    ))
                  ) : (
                    <Copy secondary>No spending in this period.</Copy>
                  )}
                </Card>
              )}
            </>
          )}
        </ReadState>
      )}
    </FinanceScreen>
  );
}
