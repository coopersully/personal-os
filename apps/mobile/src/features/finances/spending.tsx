import type {
  FinanceSpendingQuery,
  FinanceSpendingReferenceFilter,
  FinanceSpendingScope,
} from "@personal-os/domain";
import {
  type InfiniteData,
  keepPreviousData,
  useInfiniteQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, Alert, TextInput, View } from "react-native";
import { toast } from "sonner-native";
import { FilterChip } from "../../components/filter-chip";
import { EntityPicker } from "../../components/forms/entity-picker";
import { Action, Actions } from "../../components/forms/form-rows";
import { SettingsAccentProvider } from "../../components/settings-accent";
import { radius, spacing, useTheme, workspaceColor } from "../../theme";
import { categoryIcon, categoryLabel } from "./category-presentation";
import { useFinance, useFinanceRead } from "./data";
import { financeLabel, formatLocalDate, formatMoney, recordAmount } from "./presentation";
import { SpendingChart } from "./spending-chart";
import { spendingBasisLine, useSpendingPreferences } from "./spending-data";
import {
  customRangeProblem,
  type SpendingPeriod,
  spendingComparisonScopes,
  spendingRange,
  spendingToday,
} from "./spending-math";
import {
  CustomRange,
  type OpenSpendingEvidence,
  SpendingList,
  SpendingRhythm,
  SpendingTrends,
} from "./spending-views";
import { selectionLimit, useBulkCategorize } from "./transaction-bulk";
import { ExportTransactions } from "./transaction-export";
import {
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
  onAdd,
}: {
  /** Shown as Add beside Select and Filters, so no floating control sits over row amounts. */
  onAdd?: () => void;
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
    // The automatic reload is silent when it works and raises one error when it does not.
    if (result.isError)
      toast.error(
        "Transactions could not reload. Reload again before selecting.",
        id === undefined ? undefined : { id },
      );
    else if (id !== undefined) toast.success("Transactions reloaded", { id });
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
  const accent = workspaceColor(t, "finances");
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
                <FilterChip
                  selected
                  color={accent}
                  label={`Category: ${activeCategory ? categoryLabel(activeCategory.name) : "selected"}`}
                  onPress={() => setView({ ...view, categoryId: null })}
                />
              )}
              {view.review !== "all" && (
                <FilterChip
                  selected
                  color={accent}
                  label={reviewLabel(view.review)}
                  onPress={() => setView({ ...view, review: "all" })}
                />
              )}
              {sorted && (
                <FilterChip
                  selected
                  color={accent}
                  label={`Sorted by ${sortSummary(view).toLowerCase()}`}
                  onPress={() => setView({ ...view, sortBy: "date", sortDirection: "desc" })}
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
                {onAdd && (
                  <Action label="Add" accessibilityLabel="Add transaction" onPress={onAdd} />
                )}
                <Action
                  label="Select"
                  accessibilityLabel="Select transactions"
                  disabled={bulk.pending || !selectable}
                  onPress={() => setSelection([])}
                />
                <ExportTransactions
                  view={filterKey}
                  disabled={bulk.pending || query.isPending}
                  page={(cursor) =>
                    api.listFinanceTransactions({ ...filters, accountId, cursor, limit: 100 })
                  }
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
const periodLabels = {
  today: "Today",
  week: "Week",
  month: "Month",
  custom: "Custom",
} as const satisfies Record<SpendingPeriod, string>;
const periods = Object.keys(periodLabels) as SpendingPeriod[];
const viewLabels = { list: "List", trends: "Trends", rhythm: "Rhythm" } as const;
const views = Object.values(viewLabels);
type SpendingView = (typeof views)[number];
const isPeriod = (value: unknown): value is SpendingPeriod =>
  periods.includes(value as SpendingPeriod);

export function FinanceSpendingScreen() {
  const { timezone } = useFinance();
  const [mode, setMode] = useState<"Summary" | "Transactions">("Summary");
  // Null follows the saved default view and period; a choice here lasts for this visit only.
  const [chosenView, setView] = useState<SpendingView | null>(null);
  const [chosen, setChosen] = useState<SpendingPeriod | null>(null);
  const [custom, setCustom] = useState<{ from: string; through: string } | null>(null);
  // The last custom range that could be read, kept while the fields hold one that cannot.
  const [usable, setUsable] = useState<{ from: string; through: string } | null>(null);
  const [evidence, setEvidence] = useState<{
    title: string;
    reference: FinanceSpendingReferenceFilter;
  } | null>(null);
  const { period: routePeriod, mode: routeMode } = useLocalSearchParams<{
    period?: string;
    mode?: string;
  }>();
  useEffect(() => {
    if (isPeriod(routePeriod)) {
      setChosen(routePeriod);
      setEvidence(null);
    }
    if (routeMode === "Summary" || routeMode === "Transactions") setMode(routeMode);
  }, [routePeriod, routeMode]);
  const preferences = useSpendingPreferences();
  const saved = preferences.data;
  const period = chosen ?? saved?.period ?? "week";
  const view = chosenView ?? (saved ? viewLabels[saved.view] : "List");
  const today = timezone ? spendingToday(timezone) : null;
  const dates = custom ?? (today ? { from: today, through: today } : null);
  const problem =
    period === "custom" && dates ? customRangeProblem(dates.from, dates.through) : null;
  const range =
    today && saved && !problem
      ? spendingRange(period, today, saved.weekStartsOn, dates ?? undefined)
      : null;
  // Transactions keeps its list on the last usable range; only the fields show the correction.
  const listed = range ?? (problem && today ? (usable ?? { from: today, through: today }) : null);
  const scope: FinanceSpendingScope | null =
    range && saved && timezone
      ? {
          ...range,
          timezone,
          accountIds: null,
          categoryIds: null,
          basis: saved.basis,
          includePending: saved.includePending,
          subtractRefunds: saved.subtractRefunds,
        }
      : null;
  // Trends measures the period so far against the equal span before it.
  const comparison =
    scope && today && mode === "Summary" && view === "Trends"
      ? spendingComparisonScopes(scope, period, today)
      : null;
  const request: FinanceSpendingQuery | null =
    scope && saved
      ? {
          scope: comparison?.current ?? scope,
          grouping: "auto",
          includeUncategorized: saved.includeUncategorized,
        }
      : null;
  const query = useFinanceRead(
    ["spending", request],
    (api) => {
      if (!request) throw new Error("Spending needs a period.");
      return api.getFinanceSpending(request);
    },
    !!request,
  );
  const previousRequest = request && comparison ? { ...request, scope: comparison.previous } : null;
  const previous = useFinanceRead(
    ["spending", previousRequest],
    (api) => {
      if (!previousRequest) throw new Error("Spending needs a comparison period.");
      return api.getFinanceSpending(previousRequest);
    },
    !!previousRequest,
  );
  const revision = query.data?.referenceRevision;
  const open: OpenSpendingEvidence | undefined =
    request && revision
      ? (title, from, through, groupId) =>
          setEvidence({
            title,
            reference: {
              query: request,
              referenceRevision: revision,
              groupId: groupId ?? null,
              from,
              through,
            },
          })
      : undefined;
  const add = () => router.push("/finance-transaction-edit");
  // Adding needs nothing from the spending read, so it stays reachable while that loads or fails.
  const addAction = (
    <SettingsAccentProvider workspace="finances">
      <Actions inset={false}>
        <Action label="Add" accessibilityLabel="Add transaction" onPress={add} />
      </Actions>
    </SettingsAccentProvider>
  );
  // Preferences come first: without them there is no honest period or basis to read.
  const waiting = !timezone
    ? { ...preferences, configurationMissing: true }
    : !saved
      ? preferences
      : null;
  return (
    <FinanceScreen title="Spending" tabBar>
      <Segments
        value={mode}
        options={["Summary", "Transactions"]}
        onChange={(next) => {
          setMode(next);
          router.setParams({ mode: next });
        }}
      />
      <Segments
        value={periodLabels[period]}
        options={periods.map((item) => periodLabels[item])}
        onChange={(next) => {
          const value = periods.find((item) => periodLabels[item] === next) ?? "week";
          setChosen(value);
          router.setParams({ period: value });
          setEvidence(null);
        }}
      />
      {period === "custom" && dates && (
        <CustomRange
          from={dates.from}
          through={dates.through}
          problem={problem}
          shown={mode === "Transactions" && problem ? listed : null}
          onChange={(from, through) => {
            setCustom({ from, through });
            if (!customRangeProblem(from, through)) setUsable({ from, through });
            setEvidence(null);
          }}
        />
      )}
      {mode === "Summary" && (
        <Segments
          value={view}
          options={views}
          onChange={(next) => {
            setView(next);
            setEvidence(null);
          }}
        />
      )}
      {mode === "Transactions" && listed ? (
        <Transactions from={listed.from} through={listed.through} onAdd={add} />
      ) : (
        <>
          {addAction}
          {waiting ? (
            <ReadState query={waiting}>{null}</ReadState>
          ) : mode === "Summary" && !problem ? (
            <ReadState query={query}>
              {query.data && saved && request && (
                <>
                  <Metric
                    accent
                    label={
                      request.scope.from === request.scope.through
                        ? formatLocalDate(request.scope.from)
                        : `${formatLocalDate(request.scope.from)} – ${formatLocalDate(request.scope.through)}`
                    }
                    value={formatMoney(query.data.snapshot.netCents / 100, "USD")}
                    hint={spendingBasisLine(saved)}
                  >
                    {view === "List" && <SpendingChart bins={query.data.snapshot.bins} />}
                  </Metric>
                  <Copy secondary>
                    {financeLabel(query.data.snapshot.coverage)} coverage ·{" "}
                    {query.data.source.freshness === "unknown"
                      ? "freshness not confirmed"
                      : financeLabel(query.data.source.freshness)}
                    {query.data.currency.unsupported.length ? " · other currencies excluded" : ""}
                  </Copy>
                  {evidence ? (
                    <>
                      <FinanceRow
                        title={view === "List" ? "All categories" : `Back to ${view.toLowerCase()}`}
                        icon="views"
                        onPress={() => setEvidence(null)}
                      />
                      <Copy>{evidence.title}</Copy>
                      <Transactions reference={evidence.reference} />
                    </>
                  ) : view === "Trends" ? (
                    <SpendingTrends
                      dashboard={query.data}
                      previous={previous}
                      comparisonLabel={comparison?.label ?? "Previous period"}
                      onOpen={open}
                    />
                  ) : view === "Rhythm" ? (
                    <SpendingRhythm
                      dashboard={query.data}
                      weekStartsOn={saved.weekStartsOn}
                      onOpen={open}
                    />
                  ) : (
                    <SpendingList
                      dashboard={query.data}
                      from={request.scope.from}
                      through={request.scope.through}
                      onOpen={open}
                    />
                  )}
                </>
              )}
            </ReadState>
          ) : null}
        </>
      )}
    </FinanceScreen>
  );
}
