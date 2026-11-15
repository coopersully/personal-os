import type { FinanceSpendingReferenceFilter } from "@personal-os/domain";
import {
  type InfiniteData,
  keepPreviousData,
  useInfiniteQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, Alert, Platform, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { toast } from "sonner-native";
import { EntityPicker } from "../../components/forms/entity-picker";
import { Action, Actions } from "../../components/forms/form-rows";
import { FormSave } from "../../components/forms/form-save";
import { SettingsAccentProvider } from "../../components/settings-accent";
import { radius, spacing, useTheme } from "../../theme";
import { categoryIcon, categoryLabel } from "./category-presentation";
import { useFinance, useFinanceRead, useSpending } from "./data";
import { financeLabel, formatLocalDate, formatMoney, recordAmount } from "./presentation";
import { SpendingChart } from "./spending-chart";
import { selectionLimit, useBulkCategorize } from "./transaction-bulk";
import {
  ActiveFilter,
  defaultTransactionView,
  reviewLabel,
  sortSummary,
  TransactionFilters,
  transactionViewQuery,
} from "./transaction-filters";
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
  const client = useQueryClient();
  const t = useTheme();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<"All" | "Posted" | "Pending">("All");
  const [term, setTerm] = useState("");
  const [view, setView] = useState(defaultTransactionView);
  const [filtering, setFiltering] = useState(false);
  // `null` is browsing; an array is selection mode, holding the chosen record identities.
  const [selection, setSelection] = useState<string[] | null>(null);
  const [categorizing, setCategorizing] = useState(false);
  // After a categorization the displayed revisions are suspect until a reload succeeds.
  const [reload, setReload] = useState<"current" | "reloading" | "failed">("current");
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
    ...transactionViewQuery(view, !budgetId),
  };
  const filterKey = JSON.stringify([accountId, filters]);
  // A selection describes the records on screen; a different list starts a new one.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the key is the trigger.
  useEffect(() => {
    setSelection(null);
    setCategorizing(false);
  }, [filterKey]);
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
  const categories = useFinanceRead(
    ["categories"],
    (api) => api.getFinanceCategories(),
    // A budget-scoped list has no category filter, so it reads categories only to categorize.
    !reference && (categorizing || (!budgetId && (filtering || view.categoryId !== null))),
  );
  const rows = query.data?.pages.flatMap((page) => page.items) ?? [];
  const firstPage = query.data?.pages[0];
  const contribution = firstPage && "netCents" in firstPage ? (firstPage.netCents as number) : null;
  const selected = selection ? rows.filter((item) => selection.includes(item.id)) : [];
  // Records are selectable only as an authoritative, current read of this exact list.
  const selectable =
    !reference &&
    reload === "current" &&
    rows.length > 0 &&
    !query.isPending &&
    !query.isError &&
    !query.isPlaceholderData;

  async function reloadTransactions(announce: boolean) {
    setReload("reloading");
    const id = announce ? toast.loading("Reloading transactions…") : undefined;
    // Everything derived from these records is stale; this list's own reload is the one awaited.
    void client.invalidateQueries({ queryKey: ["finances", owner], refetchType: "none" });
    void client.refetchQueries({
      queryKey: ["finances", owner],
      type: "active",
      predicate: (entry) => entry.queryKey[2] !== "transactions",
    });
    const result = await query.refetch();
    setReload(result.isError ? "failed" : "current");
    if (id === undefined) return;
    if (result.isError)
      toast.error("Transactions could not reload. Reload again before selecting.", { id });
    else toast.success("Transactions reloaded", { id });
  }
  const bulk = useBulkCategorize(() => {
    setSelection(null);
    void reloadTransactions(false);
  });
  const toggle = (id: string) =>
    setSelection((current) => {
      if (!current) return current;
      if (current.includes(id)) return current.filter((value) => value !== id);
      if (current.length >= selectionLimit) {
        toast.info(`Select up to ${selectionLimit} transactions at a time.`);
        return current;
      }
      return [...current, id];
    });
  const activeCategory = categories.data?.find((item) => item.id === view.categoryId);
  const activeCount = (view.categoryId && !budgetId ? 1 : 0) + (view.review === "all" ? 0 : 1);
  const sorted = view.sortBy !== "date" || view.sortDirection !== "desc";
  return (
    <>
      {!reference && (
        <SettingsAccentProvider workspace="finances">
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
          {(activeCount > 0 || sorted) && (
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
              {view.categoryId && !budgetId && (
                <ActiveFilter
                  label={`Category: ${activeCategory ? categoryLabel(activeCategory.name) : "selected"}`}
                  onRemove={() => setView({ ...view, categoryId: null })}
                />
              )}
              {view.review !== "all" && (
                <ActiveFilter
                  label={reviewLabel(view.review)}
                  onRemove={() => setView({ ...view, review: "all" })}
                />
              )}
              {sorted && (
                <ActiveFilter
                  label={`Sorted by ${sortSummary(view).toLowerCase()}`}
                  onRemove={() => setView({ ...view, sortBy: "date", sortDirection: "desc" })}
                />
              )}
            </View>
          )}
          <Actions inset={false}>
            {selection ? (
              <>
                <Action
                  label="Cancel"
                  accessibilityLabel="Cancel selection"
                  disabled={bulk.pending}
                  onPress={() => setSelection(null)}
                />
                <Action
                  label={`Categorize ${selected.length}`}
                  accessibilityLabel={`Categorize ${selected.length} selected ${selected.length === 1 ? "transaction" : "transactions"}`}
                  disabled={bulk.pending || !selectable || selected.length === 0}
                  onPress={() => setCategorizing(true)}
                />
              </>
            ) : (
              <>
                <Action
                  label="Select"
                  accessibilityLabel="Select transactions"
                  disabled={bulk.pending || !selectable}
                  onPress={() => setSelection([])}
                />
                <Action
                  label="Filters"
                  accessibilityLabel={`Filters and sort, ${activeCount} ${activeCount === 1 ? "filter" : "filters"} active, sorted by ${sortSummary(view).toLowerCase()}`}
                  onPress={() => setFiltering(true)}
                />
              </>
            )}
          </Actions>
          {reload === "failed" && (
            <FinanceRow
              title="Reload transactions"
              subtitle="These records may be out of date. Reload before selecting again."
              icon="refresh"
              onPress={() => void reloadTransactions(true)}
            />
          )}
          {filtering && (
            <TransactionFilters
              view={view}
              categories={categories}
              withCategory={!budgetId}
              onChange={setView}
              onClose={() => setFiltering(false)}
            />
          )}
          {categorizing && selected.length > 0 && (
            <ReadState query={categories}>
              <EntityPicker
                title="Categories"
                icon="grid"
                value={null}
                options={(categories.data ?? []).map((item) => ({
                  label: categoryLabel(item.name),
                  icon: categoryIcon(item.name),
                  value: item.id,
                }))}
                onChange={(value) => {
                  const category = categories.data?.find((item) => item.id === value);
                  if (!category) return;
                  const records = [...selected];
                  Alert.alert(
                    `Categorize ${records.length} ${records.length === 1 ? "transaction" : "transactions"} as ${categoryLabel(category.name)}?`,
                    "Their current categories are replaced. Merchant rules stay unchanged.",
                    [
                      { text: "Cancel", style: "cancel" },
                      { text: "Categorize", onPress: () => void bulk.apply(category, records) },
                    ],
                  );
                }}
                onClose={() => setCategorizing(false)}
              />
            </ReadState>
          )}
        </SettingsAccentProvider>
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
            rows.map((item) => {
              const chosen = !!selection && selection.includes(item.id);
              return (
                <FinanceRow
                  key={item.id}
                  title={item.merchant}
                  icon={chosen ? "check" : categoryIcon(item.category ?? "Uncategorized")}
                  subtitle={[
                    // State is written out, so it is not carried by the glyph or colour alone.
                    selection ? (chosen ? "Selected" : "Not selected") : null,
                    formatLocalDate(item.date),
                    categoryLabel(item.category),
                    item.pending ? "Pending" : null,
                    item.needsReview ? "Needs review" : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                  value={`${item.direction === "expense" ? "−" : item.direction === "income" ? "+" : ""}${recordAmount(item.amount, item.currencyCode)}`}
                  onPress={
                    selection
                      ? bulk.pending
                        ? undefined
                        : () => toggle(item.id)
                      : () =>
                          router.push({ pathname: "/finance-transaction", params: { id: item.id } })
                  }
                />
              );
            })
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
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1 }}>
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
                          icon={categoryIcon(
                            item.label,
                            item.visual?.icon,
                            item.kind ?? "category",
                          )}
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
        <View style={{ height: 80 }} />
      </FinanceScreen>
      {/* Clear the native tab bar, matching the Accounts add button. */}
      <View
        pointerEvents="box-none"
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: Platform.OS === "ios" ? 96 - Math.max(insets.bottom, 16) : 0,
        }}
      >
        <FormSave
          workspace="finances"
          keyboardOffset={0}
          label="Add transaction"
          icon="add"
          disabled={false}
          onPress={() => router.push("/finance-transaction-edit")}
        />
      </View>
    </View>
  );
}
