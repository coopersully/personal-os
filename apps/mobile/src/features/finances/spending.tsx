import type { FinanceSpendingReferenceFilter } from "@personal-os/domain";
import { useInfiniteQuery } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { useFinance, useSpending } from "./data";
import { formatLocalDate, formatMoney, recordAmount } from "./presentation";
import { SpendingChart } from "./spending-chart";
import { Card, Copy, FinanceRow, FinanceScreen, Metric, ReadState, Segments } from "./ui";

export function Transactions({
  accountId,
  reference,
}: {
  accountId?: string;
  reference?: FinanceSpendingReferenceFilter;
}) {
  const { api, owner } = useFinance();
  const query = useInfiniteQuery({
    queryKey: ["finances", owner, "transactions", accountId, reference],
    enabled: !!owner,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      reference
        ? api.listFinanceSpendingTransactions(reference, pageParam)
        : api.listFinanceTransactions({ accountId, cursor: pageParam, limit: 50 }),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
  const rows = query.data?.pages.flatMap((page) => page.items) ?? [];
  const firstPage = query.data?.pages[0];
  const contribution = firstPage && "netCents" in firstPage ? (firstPage.netCents as number) : null;
  return (
    <ReadState
      query={{
        ...query,
        feedbackKey: JSON.stringify(["finances", owner, "transactions", accountId, reference]),
      }}
    >
      <Card rows={rows.length > 0 && !reference}>
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
              subtitle={[
                formatLocalDate(item.date),
                item.category ?? "Uncategorized",
                item.pending ? "Pending" : null,
                !item.currencyCode ? "Currency unknown" : null,
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
        {query.hasNextPage && (
          <FinanceRow
            title={query.isFetchingNextPage ? "Loading…" : "Load more transactions"}
            onPress={query.isFetchingNextPage ? undefined : () => void query.fetchNextPage()}
          />
        )}
      </Card>
    </ReadState>
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
      {mode === "Transactions" ? (
        <Transactions />
      ) : (
        <>
          <Segments
            value={period}
            options={["This week", "This month"]}
            onChange={(next) => {
              setPeriod(next);
              router.setParams({ period: next === "This month" ? "month" : "week" });
              setGroup(null);
            }}
          />
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
                  {query.data.snapshot.coverage} coverage · sources {query.data.source.freshness}
                  {query.data.currency.unsupported.length ? " · other currencies excluded" : ""}
                </Copy>
                {group ? (
                  <>
                    <FinanceRow
                      title="All categories"
                      icon="views"
                      onPress={() => setGroup(null)}
                    />
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
        </>
      )}
    </FinanceScreen>
  );
}
