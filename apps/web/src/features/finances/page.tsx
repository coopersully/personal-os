import type {
  FinanceAccount,
  FinanceBudgetPacePeriod,
  FinanceBudgetStatus,
  FinanceForecast,
  FinanceGuidedSetupContext,
  FinanceLedgerHealth,
  FinanceRecurringObligation,
  FinanceReviewCase,
  FinanceTransaction,
  FinanceTransactionQuery,
  FinanceWealthSummary,
} from "@personal-os/domain";
import { addMonths, formatDateOnly, formatMonth } from "@personal-os/domain";
import { EmptyState, Spinner } from "@personal-os/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type ColumnDef, flexRender, getCoreRowModel, useReactTable } from "@tanstack/react-table";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  CircleCheck,
  CircleHelp,
  Download,
} from "lucide-react";
import { Fragment, type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { Badge as ShadcnBadge } from "@/components/ui/badge";
import { Button as ShadcnButton } from "@/components/ui/button";
import {
  Card as ShadcnCard,
  CardAction as ShadcnCardAction,
  CardContent as ShadcnCardContent,
  CardDescription as ShadcnCardDescription,
  CardHeader as ShadcnCardHeader,
  CardTitle as ShadcnCardTitle,
} from "@/components/ui/card";
import { Checkbox as ShadcnCheckbox } from "@/components/ui/checkbox";
import {
  Dialog as ShadcnDialog,
  DialogContent as ShadcnDialogContent,
  DialogDescription as ShadcnDialogDescription,
  DialogFooter as ShadcnDialogFooter,
  DialogHeader as ShadcnDialogHeader,
  DialogTitle as ShadcnDialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu as ShadcnDropdownMenu,
  DropdownMenuContent as ShadcnDropdownMenuContent,
  DropdownMenuItem as ShadcnDropdownMenuItem,
  DropdownMenuLabel as ShadcnDropdownMenuLabel,
  DropdownMenuSeparator as ShadcnDropdownMenuSeparator,
  DropdownMenuTrigger as ShadcnDropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Field as ShadcnField,
  FieldDescription as ShadcnFieldDescription,
  FieldGroup as ShadcnFieldGroup,
  FieldLabel as ShadcnFieldLabel,
} from "@/components/ui/field";
import { Input as ShadcnInput } from "@/components/ui/input";
import {
  Item as ShadcnItem,
  ItemActions as ShadcnItemActions,
  ItemContent as ShadcnItemContent,
  ItemDescription as ShadcnItemDescription,
  ItemGroup as ShadcnItemGroup,
  ItemTitle as ShadcnItemTitle,
} from "@/components/ui/item";
import {
  NativeSelectOption,
  NativeSelect as ShadcnNativeSelect,
} from "@/components/ui/native-select";
import { Switch as ShadcnSwitch } from "@/components/ui/switch";
import {
  Table as ShadcnTable,
  TableBody as ShadcnTableBody,
  TableCell as ShadcnTableCell,
  TableHead as ShadcnTableHead,
  TableHeader as ShadcnTableHeader,
  TableRow as ShadcnTableRow,
} from "@/components/ui/table";
import { api } from "../../api.js";
import { InlineError } from "../../components/async-state.js";
import { WorkspaceSkeleton } from "../../components/workspace-skeleton.js";
import { BudgetPaceGraph } from "./budget-pace-graph.js";
import { formatMoney } from "./format.js";
import { financeSectionFromPath } from "./navigation.js";
import { PlaidConnectButton } from "./plaid-connect.js";

const financeHumanOnlyActionLabels = {
  add_manual_transaction: "add manual transactions",
  apply_categorization: "apply category decisions",
  confirm_ambiguous_transfer: "confirm ambiguous transfers",
  connect_or_disconnect_source: "connect or disconnect sources",
  create_merchant_rule: "create permanent merchant rules",
  import_transactions: "import transactions",
  manage_accounts: "manage accounts",
  manage_budgets: "manage budgets",
  manage_financial_profile: "manage the financial profile",
  manage_merchants: "rename or merge merchants",
  refresh_provider_data: "refresh provider data",
  resolve_alert: "resolve or dismiss alerts",
  review_recurring_obligation: "change recurring-obligation review state",
} satisfies Record<FinanceGuidedSetupContext["humanOnlyActions"][number], string>;

export function FinancesPage() {
  const location = useLocation();
  const section = financeSectionFromPath(location.pathname);
  const queryClient = useQueryClient();
  const currentMonth = new Date().toISOString().slice(0, 7);
  const [budgetMonth, setBudgetMonth] = useState(currentMonth);
  const [budgetPacePeriod, setBudgetPacePeriod] = useState<FinanceBudgetPacePeriod>("week");
  const [accountScopes, setAccountScopes] = useState<Record<string, string[]>>({});
  const [profileForm, setProfileForm] = useState({
    effectiveDate: `${currentMonth}-01`,
    employer: "",
    employmentType: "" as
      | ""
      | "contract"
      | "full_time"
      | "part_time"
      | "self_employed"
      | "unemployed",
    expectedNetPay: "",
    grossAnnualIncome: "",
    nextPayday: "",
    payAccountId: "",
    payFrequency: "" as "" | "biweekly" | "irregular" | "monthly" | "semimonthly" | "weekly",
    role: "",
  });
  const overview = useQuery({
    queryFn: () =>
      section === "budgets"
        ? api.getFinanceOverviewForMonth(budgetMonth)
        : api.getFinanceOverview(),
    queryKey: ["finance-overview", section === "budgets" ? budgetMonth : currentMonth],
  });
  const scopedSpendAccountIds = overview.data
    ? (accountScopes.spend ??
      readSessionAccountScope("spend") ??
      overview.data.accounts.map((account) => account.id))
    : [];
  const hasCustomSpendScope =
    overview.data !== undefined &&
    (scopedSpendAccountIds.length !== overview.data.accounts.length ||
      scopedSpendAccountIds.some(
        (id) => !overview.data.accounts.some((account) => account.id === id),
      ));
  const scopedSpending = useQuery({
    enabled: section === "overview" && hasCustomSpendScope,
    queryFn: () => api.getFinanceOverviewForAccounts(currentMonth, scopedSpendAccountIds),
    queryKey: ["finance-spending-scope", currentMonth, scopedSpendAccountIds],
  });
  const wealth = useQuery({
    enabled: section === "overview" || section === "budgets",
    queryFn: api.getFinanceWealthSummary,
    queryKey: ["finance-wealth"],
  });
  const ledgerHealth = useQuery({
    enabled: section === "health" || section === "overview",
    queryFn: api.getFinanceLedgerHealth,
    queryKey: ["finance-ledger-health"],
  });
  const profile = useQuery({
    enabled: section === "profile" || section === "cashflow" || section === "overview",
    queryFn: api.getFinanceProfile,
    queryKey: ["finance-profile"],
  });
  const agentSetup = useQuery({
    enabled: section === "profile",
    queryFn: () => api.getFinanceGuidedSetup(),
    queryKey: ["finance-guided-setup"],
  });
  const agentProfile = useQuery({
    enabled: section === "profile",
    queryFn: () => api.getDomainProfile("finances"),
    queryKey: ["domain-profile", "finances"],
  });
  const activateAgentProfile = useMutation({
    mutationFn: async () => {
      const current = agentProfile.data;
      if (!current) throw new Error("No Finance guidance draft is available to activate.");
      return api.upsertDomainProfile({
        categories: current.categories,
        domain: "finances",
        expectedVersion: current.version,
        instructions: current.instructions,
        objective: current.objective,
        preferences: current.preferences,
        sourceContexts: current.sourceContexts,
        status: "active",
        summary: current.summary,
      });
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["domain-profile", "finances"] }),
        queryClient.invalidateQueries({ queryKey: ["finance-guided-setup"] }),
      ]);
    },
  });
  const incomeStreams = useQuery({
    enabled: section === "cashflow" || section === "profile" || section === "overview",
    queryFn: api.listFinanceIncomeStreams,
    queryKey: ["finance-income-streams"],
  });
  const recurring = useQuery({
    enabled: section === "cashflow" || section === "subscriptions" || section === "overview",
    queryFn: api.listFinanceRecurringObligations,
    queryKey: ["finance-recurring"],
  });
  const alerts = useQuery({
    enabled: section === "cashflow" || section === "overview",
    queryFn: api.listFinanceAlerts,
    queryKey: ["finance-alerts"],
  });
  const forecast = useQuery({
    enabled: section === "cashflow" || section === "overview",
    queryFn: api.getFinanceForecast,
    queryKey: ["finance-forecast"],
  });
  const budgetStatus = useQuery({
    enabled: section === "budgets",
    queryFn: () => api.getFinanceBudgetStatus(budgetMonth),
    queryKey: ["finance-budget-status", budgetMonth],
  });
  const budgetPace = useQuery({
    enabled: section === "overview",
    queryFn: () => api.getFinanceBudgetPace(budgetPacePeriod),
    queryKey: ["finance-budget-pace", budgetPacePeriod],
  });
  const categories = useQuery({
    queryFn: api.getFinanceCategories,
    queryKey: ["finance-categories"],
  });
  const reviewQueue = useQuery({
    enabled: section === "review",
    queryFn: () => api.getFinanceReviewQueue(),
    queryKey: ["finance-review-queue"],
  });
  const [reviewOnly, setReviewOnly] = useState(true);
  const [institution, setInstitution] = useState("");
  const [accountName, setAccountName] = useState("");
  const [balance, setBalance] = useState("");
  const [accountProvider, setAccountProvider] = useState<"manual" | "paypal" | "venmo" | "zelle">(
    "manual",
  );
  const [accountKind, setAccountKind] = useState<"cash" | "investment" | "debt" | "other">("cash");
  const [accountId, setAccountId] = useState("");
  const [importAccountId, setImportAccountId] = useState("");
  const [importCsv, setImportCsv] = useState<string | null>(null);
  const [importFileName, setImportFileName] = useState("");
  const [importProvider, setImportProvider] = useState<"paypal" | "venmo" | "zelle">("paypal");
  const [merchant, setMerchant] = useState("");
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState("");
  const [budgetCategory, setBudgetCategory] = useState("");
  const [budgetLimit, setBudgetLimit] = useState("");
  const [showAccountForm, setShowAccountForm] = useState(false);
  const [showBudgetForm, setShowBudgetForm] = useState(false);
  const [budgetDetail, setBudgetDetail] = useState<{
    category?: string;
    kind: "category" | "overages" | "planned" | "spent";
  } | null>(null);
  const [showTransactionForm, setShowTransactionForm] = useState(false);
  const [scopeDialog, setScopeDialog] = useState<"spend" | "cash" | "investments" | null>(null);
  const [learnMerchant, setLearnMerchant] = useState(false);
  const [categorizing, setCategorizing] = useState<{
    category: string;
    expectedTransactionUpdatedAt: string;
    id: string;
    merchant: string;
    reviewId?: string;
  } | null>(null);
  const [transactionCursor, setTransactionCursor] = useState<string | null>(null);
  const [transactionCursorHistory, setTransactionCursorHistory] = useState<Array<string | null>>(
    [],
  );
  const [transactionSort, setTransactionSort] = useState<{
    sortBy: FinanceTransactionQuery["sortBy"];
    sortDirection: FinanceTransactionQuery["sortDirection"];
  }>({ sortBy: "date", sortDirection: "desc" });
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ["finance-overview"] }),
      queryClient.invalidateQueries({ queryKey: ["finance-review-queue"] }),
      queryClient.invalidateQueries({ queryKey: ["finance-transactions"] }),
      queryClient.invalidateQueries({ queryKey: ["finance-wealth"] }),
      queryClient.invalidateQueries({ queryKey: ["finance-ledger-health"] }),
      queryClient.invalidateQueries({ queryKey: ["finance-budget-status"] }),
      queryClient.invalidateQueries({ queryKey: ["finance-spending-scope"] }),
      queryClient.invalidateQueries({ queryKey: ["finance-profile"] }),
      queryClient.invalidateQueries({ queryKey: ["finance-income-streams"] }),
      queryClient.invalidateQueries({ queryKey: ["finance-recurring"] }),
      queryClient.invalidateQueries({ queryKey: ["finance-alerts"] }),
      queryClient.invalidateQueries({ queryKey: ["finance-forecast"] }),
    ]);
  const transactionList = useQuery({
    enabled: section === "transactions",
    queryFn: () =>
      api.listFinanceTransactions({
        cursor: transactionCursor ?? undefined,
        limit: 50,
        sortBy: transactionSort.sortBy,
        sortDirection: transactionSort.sortDirection,
      }),
    queryKey: ["finance-transactions", transactionCursor, transactionSort],
  });
  const addAccount = useMutation({
    mutationFn: () =>
      api.createFinanceAccount({
        balance: balance ? Number(balance) : null,
        institution: institution.trim(),
        kind: accountKind,
        name: accountName.trim(),
        provider: accountProvider,
      }),
    onSuccess: () => {
      setInstitution("");
      setAccountName("");
      setBalance("");
      setAccountProvider("manual");
      setAccountKind("cash");
      setShowAccountForm(false);
      return refresh();
    },
  });
  const saveProfile = useMutation({
    mutationFn: () =>
      api.updateFinanceProfile({
        effectiveDate: profileForm.effectiveDate,
        employer: profileForm.employer.trim() || null,
        employmentType: profileForm.employmentType || null,
        expectedNetPay: profileForm.expectedNetPay ? Number(profileForm.expectedNetPay) : null,
        grossAnnualIncome: profileForm.grossAnnualIncome
          ? Number(profileForm.grossAnnualIncome)
          : null,
        nextPayday: profileForm.nextPayday || null,
        payAccountId: profileForm.payAccountId || null,
        payFrequency: profileForm.payFrequency || null,
        role: profileForm.role.trim() || null,
      }),
    onSuccess: refresh,
  });
  const updateRecurring = useMutation({
    mutationFn: ({ id, status }: { id: string; status: "active" | "cancelled" | "paused" }) =>
      api.updateFinanceRecurringObligation(id, { status }),
    onSuccess: refresh,
  });
  const updateIncomeStream = useMutation({
    mutationFn: ({ id, status }: { id: string; status: "active" | "paused" }) =>
      api.updateFinanceIncomeStream(id, { status }),
    onSuccess: refresh,
  });
  const resolveAlert = useMutation({
    mutationFn: ({ id, action }: { action: "dismiss" | "resolve"; id: string }) =>
      api.resolveFinanceAlert(id, { action, rationale: null }),
    onSuccess: refresh,
  });
  const refreshInsights = useMutation({
    mutationFn: api.refreshFinanceInsights,
    onSuccess: refresh,
  });
  useEffect(() => {
    if (!profile.data) return;
    setProfileForm({
      effectiveDate: profile.data.effectiveDate,
      employer: profile.data.employer ?? "",
      employmentType: profile.data.employmentType ?? "",
      expectedNetPay: profile.data.expectedNetPay?.toString() ?? "",
      grossAnnualIncome: profile.data.grossAnnualIncome?.toString() ?? "",
      nextPayday: profile.data.nextPayday ?? "",
      payAccountId: profile.data.payAccountId ?? "",
      payFrequency: profile.data.payFrequency ?? "",
      role: profile.data.role ?? "",
    });
  }, [profile.data]);
  const addTransaction = useMutation({
    mutationFn: () =>
      api.createFinanceTransaction({
        accountId,
        amount: Number(amount),
        category: category.trim() || null,
        categoryConfidence: null,
        date: new Date().toISOString().slice(0, 10),
        direction: "expense",
        merchant: merchant.trim(),
        notes: null,
      }),
    onSuccess: () => {
      setMerchant("");
      setAmount("");
      setCategory("");
      setShowTransactionForm(false);
      return refresh();
    },
  });
  const addBudget = useMutation({
    mutationFn: () =>
      api.createFinanceBudget({
        category: budgetCategory.trim(),
        limit: Number(budgetLimit),
        month: budgetMonth,
      }),
    onSuccess: () => {
      setBudgetCategory("");
      setBudgetLimit("");
      setShowBudgetForm(false);
      return refresh();
    },
  });
  const importHistory = useMutation({
    mutationFn: () =>
      api.importFinanceCsv({
        accountId: importAccountId,
        csv: importCsv as string,
        provider: importProvider,
      }),
    onSuccess: async () => {
      setImportCsv(null);
      setImportFileName("");
      await refresh();
    },
  });
  const categorize = useMutation({
    mutationFn: ({ id, value }: { id: string; value: string }) =>
      api.updateFinanceTransaction(id, { category: value }),
    onSuccess: refresh,
  });
  const resolveReview = useMutation({
    mutationFn: ({
      action,
      categoryId,
      expectedTransactionUpdatedAt,
      id,
      learnMerchant,
      rationale,
    }: {
      action: "approve" | "defer" | "not_purchase" | "recategorize";
      categoryId?: string;
      expectedTransactionUpdatedAt?: string;
      id: string;
      learnMerchant?: "always" | "never" | "suggest";
      rationale?: string;
    }) =>
      api.resolveFinanceReview(id, {
        action,
        categoryId,
        expectedTransactionUpdatedAt,
        learnMerchant: learnMerchant ?? "suggest",
        rationale: rationale ?? null,
      }),
    onSuccess: refresh,
  });
  const openCategorize = useCallback((item: FinanceTransaction) => {
    setLearnMerchant(false);
    setCategorizing({
      category: item.category ?? "",
      expectedTransactionUpdatedAt: item.updatedAt,
      id: item.id,
      merchant: item.merchant,
    });
  }, []);
  const sortTransactions = useCallback((sortBy: FinanceTransactionQuery["sortBy"]) => {
    setTransactionSort((current) => ({
      sortBy,
      sortDirection: current.sortBy === sortBy && current.sortDirection === "desc" ? "asc" : "desc",
    }));
    setTransactionCursor(null);
    setTransactionCursorHistory([]);
  }, []);
  const nextTransactionPage = useCallback(() => {
    const nextCursor = transactionList.data?.nextCursor;
    if (!nextCursor) return;
    setTransactionCursorHistory((current) => [...current, transactionCursor]);
    setTransactionCursor(nextCursor);
  }, [transactionCursor, transactionList.data?.nextCursor]);
  const previousTransactionPage = useCallback(() => {
    const previousCursor = transactionCursorHistory.at(-1) ?? null;
    setTransactionCursorHistory((current) => current.slice(0, -1));
    setTransactionCursor(previousCursor);
  }, [transactionCursorHistory]);
  if (overview.isPending) return <FinancePageSkeleton />;
  if (overview.isError) return <InlineError error={overview.error} />;
  const finance = overview.data;
  const budgetHasPlan = finance.budgets.length > 0;
  const selectedAccounts = (scope: "spend" | "cash" | "investments") => {
    const eligible = finance.accounts.filter((account) =>
      scope === "spend" ? true : account.kind === (scope === "cash" ? "cash" : "investment"),
    );
    const saved = accountScopes[scope] ?? readSessionAccountScope(scope);
    return saved ?? eligible.map((account) => account.id);
  };
  const spentThisMonth = hasCustomSpendScope
    ? (scopedSpending.data?.spendingThisMonth ?? 0)
    : finance.spendingThisMonth;
  const scopedBalance = (scope: "cash" | "investments") =>
    finance.accounts
      .filter((account) => selectedAccounts(scope).includes(account.id))
      .reduce((sum, account) => sum + (account.balance ?? 0), 0);
  const visibleTransactions =
    section === "transactions"
      ? finance.transactions
      : reviewOnly
        ? finance.transactions.filter((item) => item.needsReview)
        : finance.transactions;
  const formError =
    addAccount.error ??
    addTransaction.error ??
    addBudget.error ??
    categorize.error ??
    importHistory.error ??
    resolveReview.error;
  return (
    <div
      className={`wide-page flex w-full max-w-6xl flex-col gap-5 pb-8${section === "budgets" ? " wide-page--compact" : ""}`}
    >
      {section === "budgets" ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <FinanceMonthNavigator
            month={budgetMonth}
            onNext={() => setBudgetMonth((value) => addMonths(value, 1))}
            onPrevious={() => setBudgetMonth((value) => addMonths(value, -1))}
          />
          <div className="flex items-center gap-2">
            <FinanceExportMenu />
            <ShadcnButton
              onClick={() => setShowBudgetForm(true)}
              size="sm"
              variant={budgetHasPlan ? "outline" : "default"}
            >
              {budgetHasPlan ? "Edit budget" : "Set a budget"}
            </ShadcnButton>
          </div>
        </div>
      ) : null}
      {section === "profile" ? (
        <>
          <FinanceAgentGuidancePanel
            activating={activateAgentProfile.isPending}
            activationEligible={
              agentProfile.data?.status === "draft" && agentProfile.data.sourceContexts.length > 0
            }
            error={agentSetup.error ?? agentProfile.error ?? activateAgentProfile.error}
            loading={agentSetup.isPending || agentProfile.isPending}
            onActivate={() => activateAgentProfile.mutate()}
            profileStatus={agentProfile.data?.status ?? null}
            setup={agentSetup.data}
          />
          <FinancialProfilePanel
            accounts={overview.data?.accounts ?? []}
            form={profileForm}
            onChange={setProfileForm}
            onSave={() => saveProfile.mutate()}
            saving={saveProfile.isPending}
          />
        </>
      ) : null}
      {section === "cashflow" ? (
        <CashflowPanel
          alerts={alerts.data ?? []}
          forecast={forecast.data}
          incomeStreams={incomeStreams.data ?? []}
          onRefresh={() => refreshInsights.mutate()}
          onResolveAlert={(id, action) => resolveAlert.mutate({ action, id })}
          onUpdateIncome={(id, status) => updateIncomeStream.mutate({ id, status })}
          onUpdateRecurring={(id, status) => updateRecurring.mutate({ id, status })}
          recurring={recurring.data ?? []}
        />
      ) : null}
      {section === "subscriptions" ? (
        <SubscriptionsPanel
          items={(recurring.data ?? []).filter((item) => item.kind === "subscription")}
          onUpdate={(id, status) => updateRecurring.mutate({ id, status })}
        />
      ) : null}
      <section className="grid gap-4 md:grid-cols-3" hidden={section !== "overview"}>
        <FinanceMetric
          label="Spent this month"
          onClick={() => setScopeDialog("spend")}
          value={formatMoney(spentThisMonth)}
        />
        <FinanceMetric label="Accounts tracked" value={String(finance.accounts.length)} />
        <FinanceMetric label="Needs your judgment" value={String(finance.reviewCount)} />
      </section>
      {section === "overview" && wealth.data ? (
        <FinanceWealthSummaryCard
          cash={scopedBalance("cash")}
          investments={scopedBalance("investments")}
          onConfigure={setScopeDialog}
          wealth={wealth.data}
        />
      ) : null}
      {section === "overview" ? (
        <BudgetPaceGraph
          data={budgetPace.data}
          onPeriodChange={setBudgetPacePeriod}
          period={budgetPacePeriod}
        />
      ) : null}
      {section === "overview" ? <FinanceOverviewLinks reviewCount={finance.reviewCount} /> : null}
      {section === "overview" && ledgerHealth.data ? (
        <FinanceLedgerHealthCard health={ledgerHealth.data} />
      ) : null}
      <section
        className={
          section === "budgets" ? "grid gap-6" : "grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]"
        }
        hidden={
          section === "overview" ||
          section === "profile" ||
          section === "cashflow" ||
          section === "subscriptions"
        }
      >
        <div className="flex min-w-0 flex-col gap-6">
          <ShadcnCard hidden={section !== "health"}>
            <ShadcnCardHeader>
              <ShadcnCardTitle>Ledger health</ShadcnCardTitle>
              <ShadcnCardDescription>
                Totals use posted, net activity. These checks make any uncertainty explicit before
                it reaches your budget or cash-flow decisions.
              </ShadcnCardDescription>
            </ShadcnCardHeader>
            <ShadcnCardContent>
              {ledgerHealth.isPending ? <Spinner label="Loading ledger health" /> : null}
              {ledgerHealth.isError ? <InlineError error={ledgerHealth.error} /> : null}
              {ledgerHealth.data ? <FinanceLedgerHealthCard health={ledgerHealth.data} /> : null}
            </ShadcnCardContent>
          </ShadcnCard>
          <ShadcnCard
            className="min-w-0"
            hidden={section !== "review" && section !== "transactions"}
          >
            <ShadcnCardHeader>
              <ShadcnCardTitle>
                {section === "transactions" ? "Transactions" : "Review queue"}
              </ShadcnCardTitle>
              <ShadcnCardDescription>
                {section === "transactions"
                  ? "One row per transaction, with normalized names and category evidence."
                  : "Review only the categories the system cannot safely infer."}
              </ShadcnCardDescription>
              <ShadcnCardAction>
                {section === "transactions" ? (
                  <ShadcnButton onClick={() => setShowTransactionForm(true)} size="sm">
                    New transaction
                  </ShadcnButton>
                ) : (
                  <ShadcnButton
                    onClick={() => setReviewOnly((value) => !value)}
                    size="sm"
                    variant="outline"
                  >
                    {reviewOnly ? "View all" : "Review queue"}
                  </ShadcnButton>
                )}
              </ShadcnCardAction>
            </ShadcnCardHeader>
            <ShadcnCardContent className={section === "transactions" ? "min-w-0" : undefined}>
              {section === "transactions" ? (
                <FinanceTransactionsTable
                  hasPreviousPage={transactionCursorHistory.length > 0}
                  isCategorizing={categorize.isPending}
                  isLoading={transactionList.isPending}
                  nextCursor={transactionList.data?.nextCursor ?? null}
                  onCategorize={openCategorize}
                  onNextPage={nextTransactionPage}
                  onPreviousPage={previousTransactionPage}
                  onSort={sortTransactions}
                  sort={transactionSort}
                  transactions={transactionList.data?.items ?? []}
                />
              ) : section === "review" && reviewQueue.data && reviewQueue.data.length > 0 ? (
                <FinanceReviewItems
                  cases={reviewQueue.data}
                  isPending={resolveReview.isPending}
                  onApprove={(review) =>
                    resolveReview.mutate({
                      action: "approve",
                      expectedTransactionUpdatedAt: review.transaction.updatedAt,
                      id: review.id,
                    })
                  }
                  onCategorize={(review) => {
                    setLearnMerchant(false);
                    setCategorizing({
                      category: review.transaction.category ?? "",
                      expectedTransactionUpdatedAt: review.transaction.updatedAt,
                      id: review.transaction.id,
                      merchant: review.transaction.merchant,
                      reviewId: review.id,
                    });
                  }}
                  onConfirmTransfer={(review) =>
                    resolveReview.mutate({
                      action: "not_purchase",
                      expectedTransactionUpdatedAt: review.transaction.updatedAt,
                      id: review.id,
                    })
                  }
                  onDefer={(id) => resolveReview.mutate({ action: "defer", id })}
                />
              ) : visibleTransactions.length === 0 ? (
                <EmptyState
                  icon={<CheckCircle2 />}
                  title={reviewOnly ? "Everything is categorized" : "No transactions yet"}
                >
                  Add one manually now; connected providers will populate this list after sync.
                </EmptyState>
              ) : (
                <ShadcnItemGroup>
                  {visibleTransactions.map((item) => (
                    <ShadcnItem key={item.id} variant="outline">
                      <ShadcnItemContent>
                        <ShadcnItemTitle>{item.merchant}</ShadcnItemTitle>
                        <ShadcnItemDescription>
                          {item.rawMerchant && item.rawMerchant !== item.merchant
                            ? `${item.rawMerchant} · `
                            : ""}
                          {item.date} · {item.category ?? "Uncategorized"}
                          {item.categoryConfidence !== null
                            ? ` · ${Math.round(item.categoryConfidence * 100)}% confidence`
                            : ""}
                        </ShadcnItemDescription>
                      </ShadcnItemContent>
                      <ShadcnItemActions>
                        <span className="text-sm font-medium">{formatMoney(item.amount)}</span>
                        {item.needsReview ? (
                          <ShadcnButton
                            disabled={categorize.isPending}
                            onClick={() => openCategorize(item)}
                            size="sm"
                            variant="outline"
                          >
                            Categorize
                          </ShadcnButton>
                        ) : null}
                      </ShadcnItemActions>
                    </ShadcnItem>
                  ))}
                </ShadcnItemGroup>
              )}
            </ShadcnCardContent>
          </ShadcnCard>
          <section aria-label={`${formatMonth(budgetMonth)} budget`} hidden={section !== "budgets"}>
            <FinanceBudgetSummary
              budgets={finance.budgets}
              month={budgetMonth}
              onOpenDetail={setBudgetDetail}
              statuses={budgetStatus.data}
              transactions={finance.transactions}
            />
            {wealth.data && budgetMonth === currentMonth ? (
              <FinanceBudgetContext wealth={wealth.data} />
            ) : null}
            {finance.budgets.length === 0 ? (
              <EmptyState icon={<CircleHelp />} title={`No budget for ${formatMonth(budgetMonth)}`}>
                {budgetMonth > currentMonth
                  ? "This future month has not been planned yet. Set a budget now or come back when you are ready."
                  : "No category limits were set for this month. You can still inspect raw transactions or create a plan."}
                <div className="mt-4">
                  <ShadcnButton onClick={() => setShowBudgetForm(true)}>
                    Set a budget for {formatMonth(budgetMonth)}
                  </ShadcnButton>
                </div>
              </EmptyState>
            ) : (
              <ShadcnItemGroup className="gap-3">
                {finance.budgets.map((item) => (
                  <ShadcnItem key={item.id} variant="outline">
                    <ShadcnItemContent>
                      <ShadcnButton
                        className="h-auto justify-start p-0 text-left text-base font-medium"
                        onClick={() =>
                          setBudgetDetail({ category: item.category, kind: "category" })
                        }
                        variant="ghost"
                      >
                        {transactionCategoryLabel(item.category)}
                      </ShadcnButton>
                      <ShadcnItemDescription>
                        <BudgetProgress
                          budget={item}
                          status={budgetStatus.data?.find((status) => status.budget.id === item.id)}
                          transactions={finance.transactions}
                        />
                      </ShadcnItemDescription>
                    </ShadcnItemContent>
                    <ShadcnItemActions className="shrink-0 text-right text-sm">
                      <span className="block font-medium">{formatMoney(item.limit)}</span>
                      <span className="text-muted-foreground">monthly limit</span>
                    </ShadcnItemActions>
                  </ShadcnItem>
                ))}
              </ShadcnItemGroup>
            )}
          </section>
          <ShadcnCard hidden={section !== "imports"}>
            <ShadcnCardHeader>
              <ShadcnCardTitle>Import account history</ShadcnCardTitle>
              <ShadcnCardDescription>
                Upload a CSV exported from PayPal, Venmo, or Zelle. Duplicate rows are skipped.
              </ShadcnCardDescription>
            </ShadcnCardHeader>
            <ShadcnCardContent>
              <ShadcnFieldGroup>
                <ShadcnField>
                  <ShadcnFieldLabel htmlFor="finance-import-account">
                    Destination account
                  </ShadcnFieldLabel>
                  <ShadcnNativeSelect
                    id="finance-import-account"
                    onChange={(event) => setImportAccountId(event.target.value)}
                    value={importAccountId}
                  >
                    <NativeSelectOption value="">Select account</NativeSelectOption>
                    {finance.accounts
                      .filter((item) => item.provider === importProvider)
                      .map((item) => (
                        <NativeSelectOption key={item.id} value={item.id}>
                          {item.name}
                        </NativeSelectOption>
                      ))}
                  </ShadcnNativeSelect>
                </ShadcnField>
                <ShadcnField>
                  <ShadcnFieldLabel htmlFor="finance-import-provider">
                    Export provider
                  </ShadcnFieldLabel>
                  <ShadcnNativeSelect
                    id="finance-import-provider"
                    onChange={(event) => {
                      setImportProvider(event.target.value as "paypal" | "venmo" | "zelle");
                      setImportAccountId("");
                    }}
                    value={importProvider}
                  >
                    <NativeSelectOption value="paypal">PayPal</NativeSelectOption>
                    <NativeSelectOption value="venmo">Venmo</NativeSelectOption>
                    <NativeSelectOption value="zelle">Zelle</NativeSelectOption>
                  </ShadcnNativeSelect>
                </ShadcnField>
                <ShadcnField>
                  <ShadcnFieldLabel htmlFor="finance-import-file">CSV export</ShadcnFieldLabel>
                  <ShadcnInput
                    accept="text/csv,.csv"
                    id="finance-import-file"
                    onChange={async (event) => {
                      const file = event.currentTarget.files?.[0];
                      if (!file) return;
                      setImportCsv(await file.text());
                      setImportFileName(file.name);
                    }}
                    type="file"
                  />
                  {importFileName ? (
                    <ShadcnFieldDescription>
                      {importFileName} ready to import
                    </ShadcnFieldDescription>
                  ) : null}
                </ShadcnField>
                <ShadcnButton
                  disabled={importHistory.isPending || !importAccountId || !importCsv}
                  onClick={() => importHistory.mutate()}
                >
                  {importHistory.isPending ? "Importing" : "Import CSV"}
                </ShadcnButton>
                {importHistory.data ? (
                  <ShadcnFieldDescription>
                    Imported {importHistory.data.imported}; skipped {importHistory.data.skipped}{" "}
                    duplicates.
                  </ShadcnFieldDescription>
                ) : null}
              </ShadcnFieldGroup>
            </ShadcnCardContent>
          </ShadcnCard>
        </div>
        <div className="flex flex-col gap-6">
          <ShadcnCard hidden={section !== "accounts"}>
            <ShadcnCardHeader>
              <ShadcnCardTitle>Accounts</ShadcnCardTitle>
              <ShadcnCardDescription>
                Plaid securely links bank accounts. Venmo and Zelle do not provide a supported
                consumer-history API, so they are tracked by imports or manual entries.
              </ShadcnCardDescription>
              <ShadcnCardAction>
                <div className="flex items-center gap-2">
                  <ShadcnButton asChild size="sm" variant="ghost">
                    <Link to="/finances/imports">Import history</Link>
                  </ShadcnButton>
                  <ShadcnButton
                    onClick={() => setShowAccountForm(true)}
                    size="sm"
                    variant="outline"
                  >
                    Track account
                  </ShadcnButton>
                  <PlaidConnectButton onConnected={refresh} />
                </div>
              </ShadcnCardAction>
            </ShadcnCardHeader>
            <ShadcnCardContent>
              {finance.accounts.length === 0 ? (
                <p className="text-sm text-muted-foreground">No accounts added.</p>
              ) : (
                <ShadcnItemGroup>
                  {finance.accounts.map((item) => (
                    <ShadcnItem key={item.id} variant="outline">
                      <ShadcnItemContent>
                        <ShadcnItemTitle>{item.name}</ShadcnItemTitle>
                        <ShadcnItemDescription>
                          {item.institution} · {accountKindLabel(item.kind)} · {item.provider}
                        </ShadcnItemDescription>
                      </ShadcnItemContent>
                      <ShadcnItemActions>
                        {item.balance === null ? "—" : formatMoney(item.balance)}
                        {item.provider === "plaid" ? (
                          <ShadcnButton
                            onClick={() => api.syncFinanceAccount(item.id).then(refresh)}
                            size="sm"
                            variant="outline"
                          >
                            Sync
                          </ShadcnButton>
                        ) : null}
                      </ShadcnItemActions>
                    </ShadcnItem>
                  ))}
                </ShadcnItemGroup>
              )}
            </ShadcnCardContent>
          </ShadcnCard>
          <ShadcnCard hidden={section !== "accounts" || !showAccountForm}>
            <ShadcnCardHeader>
              <ShadcnCardTitle>Track an account</ShadcnCardTitle>
              <ShadcnCardDescription>
                Cash, Venmo, Zelle, PayPal exports, or an account before Plaid is configured.
              </ShadcnCardDescription>
            </ShadcnCardHeader>
            <ShadcnCardContent>
              <ShadcnFieldGroup>
                <FinanceTextField
                  id="finance-institution"
                  label="Institution"
                  onChange={setInstitution}
                  value={institution}
                />
                <FinanceTextField
                  id="finance-account"
                  label="Account name"
                  onChange={setAccountName}
                  value={accountName}
                />
                <ShadcnField>
                  <ShadcnFieldLabel htmlFor="finance-provider">Source</ShadcnFieldLabel>
                  <ShadcnNativeSelect
                    id="finance-provider"
                    onChange={(event) =>
                      setAccountProvider(
                        event.target.value as "manual" | "paypal" | "venmo" | "zelle",
                      )
                    }
                    value={accountProvider}
                  >
                    <NativeSelectOption value="manual">Manual or cash</NativeSelectOption>
                    <NativeSelectOption value="paypal">PayPal manual</NativeSelectOption>
                    <NativeSelectOption value="venmo">Venmo manual</NativeSelectOption>
                    <NativeSelectOption value="zelle">Zelle manual</NativeSelectOption>
                  </ShadcnNativeSelect>
                </ShadcnField>
                <ShadcnField>
                  <ShadcnFieldLabel htmlFor="finance-account-kind">Account type</ShadcnFieldLabel>
                  <ShadcnNativeSelect
                    id="finance-account-kind"
                    onChange={(event) =>
                      setAccountKind(event.target.value as "cash" | "investment" | "debt" | "other")
                    }
                    value={accountKind}
                  >
                    <NativeSelectOption value="cash">Cash or checking</NativeSelectOption>
                    <NativeSelectOption value="investment">Investment</NativeSelectOption>
                    <NativeSelectOption value="debt">Debt or credit</NativeSelectOption>
                    <NativeSelectOption value="other">Other asset</NativeSelectOption>
                  </ShadcnNativeSelect>
                </ShadcnField>
                <FinanceTextField
                  id="finance-balance"
                  inputMode="decimal"
                  label="Current balance"
                  onChange={setBalance}
                  value={balance}
                />
                <ShadcnButton
                  disabled={addAccount.isPending || !institution.trim() || !accountName.trim()}
                  onClick={() => addAccount.mutate()}
                >
                  Add account
                </ShadcnButton>
              </ShadcnFieldGroup>
            </ShadcnCardContent>
          </ShadcnCard>
          <ShadcnCard hidden={section !== "transactions" || !showTransactionForm}>
            <ShadcnCardHeader>
              <ShadcnCardTitle>Add a transaction</ShadcnCardTitle>
            </ShadcnCardHeader>
            <ShadcnCardContent>
              <ShadcnFieldGroup>
                <ShadcnField>
                  <ShadcnFieldLabel htmlFor="finance-account-select">Account</ShadcnFieldLabel>
                  <ShadcnNativeSelect
                    id="finance-account-select"
                    onChange={(event) => setAccountId(event.target.value)}
                    value={accountId}
                  >
                    <NativeSelectOption value="">Select account</NativeSelectOption>
                    {finance.accounts.map((item) => (
                      <NativeSelectOption key={item.id} value={item.id}>
                        {item.name}
                      </NativeSelectOption>
                    ))}
                  </ShadcnNativeSelect>
                </ShadcnField>
                <FinanceTextField
                  id="finance-merchant"
                  label="Merchant"
                  onChange={setMerchant}
                  value={merchant}
                />
                <FinanceTextField
                  id="finance-amount"
                  inputMode="decimal"
                  label="Amount"
                  onChange={setAmount}
                  value={amount}
                />
                <FinanceTextField
                  id="finance-category"
                  label="Category (optional)"
                  onChange={setCategory}
                  value={category}
                />
                <ShadcnButton
                  disabled={
                    addTransaction.isPending || !accountId || !merchant.trim() || !Number(amount)
                  }
                  onClick={() => addTransaction.mutate()}
                >
                  Add transaction
                </ShadcnButton>
              </ShadcnFieldGroup>
            </ShadcnCardContent>
          </ShadcnCard>
          <ShadcnCard hidden={section !== "budgets" || !showBudgetForm}>
            <ShadcnCardHeader>
              <ShadcnCardTitle>Set a budget</ShadcnCardTitle>
            </ShadcnCardHeader>
            <ShadcnCardContent>
              <ShadcnFieldGroup>
                <FinanceTextField
                  id="finance-budget-category"
                  label="Category"
                  onChange={setBudgetCategory}
                  value={budgetCategory}
                />
                <FinanceTextField
                  id="finance-budget-limit"
                  inputMode="decimal"
                  label="Monthly limit"
                  onChange={setBudgetLimit}
                  value={budgetLimit}
                />
                <ShadcnButton
                  disabled={addBudget.isPending || !budgetCategory.trim() || !Number(budgetLimit)}
                  onClick={() => addBudget.mutate()}
                >
                  Save budget
                </ShadcnButton>
              </ShadcnFieldGroup>
            </ShadcnCardContent>
          </ShadcnCard>
        </div>
      </section>
      <ShadcnDialog
        open={categorizing !== null}
        onOpenChange={(open) => {
          if (!open) {
            setCategorizing(null);
            setLearnMerchant(false);
          }
        }}
      >
        <ShadcnDialogContent>
          <ShadcnDialogHeader>
            <ShadcnDialogTitle>
              Categorize {categorizing?.merchant ?? "transaction"}
            </ShadcnDialogTitle>
            <ShadcnDialogDescription>
              Categorize this charge. Future matching charges stay in review unless you explicitly
              choose to make this a reusable merchant rule.
            </ShadcnDialogDescription>
          </ShadcnDialogHeader>
          {categorizing ? (
            <ShadcnFieldGroup>
              <FinanceTextField
                id="finance-review-category"
                label="Category"
                onChange={(value) => setCategorizing({ ...categorizing, category: value })}
                value={categorizing.category}
              />
              {categorizing.reviewId ? (
                <ShadcnField orientation="horizontal">
                  <ShadcnFieldLabel htmlFor="finance-review-merchant-rule">
                    Always use this category for {categorizing.merchant}
                  </ShadcnFieldLabel>
                  <ShadcnSwitch
                    checked={learnMerchant}
                    id="finance-review-merchant-rule"
                    onCheckedChange={setLearnMerchant}
                  />
                </ShadcnField>
              ) : null}
              {categorizing.reviewId ? (
                <ShadcnFieldDescription>
                  Leave this off for a one-time charge. Turn it on only when this merchant should
                  reliably use the same category in the future.
                </ShadcnFieldDescription>
              ) : null}
            </ShadcnFieldGroup>
          ) : null}
          <ShadcnDialogFooter>
            <ShadcnButton onClick={() => setCategorizing(null)} variant="outline">
              Cancel
            </ShadcnButton>
            <ShadcnButton
              disabled={
                categorize.isPending ||
                resolveReview.isPending ||
                !categorizing?.category.trim() ||
                (categorizing?.reviewId !== undefined &&
                  !categories.data?.some(
                    (item) =>
                      item.name.toLowerCase() === categorizing.category.trim().toLowerCase(),
                  ))
              }
              onClick={() => {
                if (!categorizing) return;
                const categoryId = categories.data?.find(
                  (item) => item.name.toLowerCase() === categorizing.category.trim().toLowerCase(),
                )?.id;
                if (categorizing.reviewId && categoryId) {
                  resolveReview.mutate(
                    {
                      action: "recategorize",
                      categoryId,
                      expectedTransactionUpdatedAt: categorizing.expectedTransactionUpdatedAt,
                      id: categorizing.reviewId,
                      learnMerchant: learnMerchant ? "always" : "suggest",
                      rationale: "Reviewed and recategorized by the user.",
                    },
                    {
                      onSuccess: () => {
                        setCategorizing(null);
                        setLearnMerchant(false);
                      },
                    },
                  );
                } else
                  categorize.mutate(
                    { id: categorizing.id, value: categorizing.category.trim() },
                    {
                      onSuccess: () => {
                        setCategorizing(null);
                        setLearnMerchant(false);
                      },
                    },
                  );
              }}
            >
              Save category
            </ShadcnButton>
          </ShadcnDialogFooter>
        </ShadcnDialogContent>
      </ShadcnDialog>
      <AccountScopeDialog
        accounts={finance.accounts}
        onChange={(scope, ids) => {
          setAccountScopes((current) => ({ ...current, [scope]: ids }));
          sessionStorage.setItem(`finance-account-scope:${scope}`, JSON.stringify(ids));
        }}
        onOpenChange={(open) => !open && setScopeDialog(null)}
        scope={scopeDialog}
        selectedIds={scopeDialog ? selectedAccounts(scopeDialog) : []}
        transactions={finance.transactions}
      />
      <FinanceBudgetDetailDialog
        budgets={finance.budgets}
        detail={budgetDetail}
        month={budgetMonth}
        onOpenChange={(open) => !open && setBudgetDetail(null)}
        statuses={budgetStatus.data}
        transactions={finance.transactions}
      />
      {formError ? <InlineError error={formError} /> : null}
    </div>
  );
}

function FinanceMetric({
  detail,
  label,
  onClick,
  value,
}: {
  detail?: string;
  label: string;
  onClick?: () => void;
  value: string;
}) {
  return (
    <ShadcnCard>
      <ShadcnCardHeader>
        <ShadcnCardDescription>{label}</ShadcnCardDescription>
        {onClick ? (
          <ShadcnButton
            aria-label={`${label}: configure included accounts`}
            className="h-auto justify-start p-0 text-2xl"
            onClick={onClick}
            variant="ghost"
          >
            {value}
          </ShadcnButton>
        ) : (
          <ShadcnCardTitle>{value}</ShadcnCardTitle>
        )}
        {detail ? <ShadcnCardDescription>{detail}</ShadcnCardDescription> : null}
      </ShadcnCardHeader>
    </ShadcnCard>
  );
}

function FinanceWealthSummaryCard({
  cash,
  investments,
  onConfigure,
  wealth,
}: {
  cash: number;
  investments: number;
  onConfigure: (scope: "cash" | "investments") => void;
  wealth: FinanceWealthSummary;
}) {
  return (
    <section className="grid gap-4 md:grid-cols-4" aria-label="Wealth summary">
      <FinanceMetric label="Net worth" value={formatMoney(wealth.netWorth)} />
      <FinanceMetric
        label="Investments"
        onClick={() => onConfigure("investments")}
        value={formatMoney(investments)}
      />
      <FinanceMetric label="Cash" onClick={() => onConfigure("cash")} value={formatMoney(cash)} />
      <FinanceMetric
        detail={
          wealth.statedAnnualIncome === null
            ? "Observed in the trailing 12 months"
            : `${formatMoney(wealth.observedAnnualIncome)} observed in the trailing 12 months`
        }
        label={wealth.incomeBasis === "stated" ? "Stated annual income" : "Observed annual income"}
        value={formatMoney(wealth.annualIncome)}
      />
    </section>
  );
}

function AccountScopeDialog({
  accounts,
  onChange,
  onOpenChange,
  scope,
  selectedIds,
  transactions,
}: {
  accounts: FinanceAccount[];
  onChange: (scope: "spend" | "cash" | "investments", ids: string[]) => void;
  onOpenChange: (open: boolean) => void;
  scope: "spend" | "cash" | "investments" | null;
  selectedIds: string[];
  transactions: FinanceTransaction[];
}) {
  if (!scope) return null;
  const eligible = accounts.filter(
    (account) => scope === "spend" || account.kind === (scope === "cash" ? "cash" : "investment"),
  );
  const title =
    scope === "spend" ? "Accounts included in spending" : `Accounts included in ${scope ?? ""}`;
  const month = new Date().toISOString().slice(0, 7);
  return (
    <ShadcnDialog onOpenChange={onOpenChange} open={scope !== null}>
      <ShadcnDialogContent>
        <ShadcnDialogHeader>
          <ShadcnDialogTitle>{title}</ShadcnDialogTitle>
          <ShadcnDialogDescription>
            Selections are saved for this browser session.
          </ShadcnDialogDescription>
        </ShadcnDialogHeader>
        <ShadcnFieldGroup>
          {eligible.map((account) => {
            const value =
              scope === "spend"
                ? transactions
                    .filter(
                      (item) =>
                        item.accountId === account.id &&
                        item.direction === "expense" &&
                        item.date.startsWith(month),
                    )
                    .reduce((sum, item) => sum + item.amount, 0)
                : (account.balance ?? 0);
            return (
              <ShadcnField key={account.id} orientation="horizontal">
                <ShadcnCheckbox
                  checked={selectedIds.includes(account.id)}
                  id={`scope-${scope}-${account.id}`}
                  onCheckedChange={(checked) =>
                    onChange(
                      scope,
                      checked
                        ? [...selectedIds, account.id]
                        : selectedIds.filter((id) => id !== account.id),
                    )
                  }
                />
                <ShadcnFieldLabel htmlFor={`scope-${scope}-${account.id}`}>
                  {account.name} · {formatMoney(value)}
                </ShadcnFieldLabel>
              </ShadcnField>
            );
          })}
        </ShadcnFieldGroup>
      </ShadcnDialogContent>
    </ShadcnDialog>
  );
}

function FinanceBudgetContext({ wealth }: { wealth: FinanceWealthSummary }) {
  const incomeKnown = wealth.annualIncome > 0;
  return (
    <div className="mb-5 rounded-md border bg-muted/30 p-4 text-sm">
      <p className="font-medium">Plan from your real capacity</p>
      <p className="mt-1 text-muted-foreground">
        {incomeKnown
          ? `${formatMoney(wealth.monthlyIncome)} ${wealth.incomeBasis === "stated" ? "stated" : "observed"} monthly income · ${formatMoney(wealth.plannedThisMonth)} already allocated · ${formatMoney(wealth.monthlyPlanRemaining ?? 0)} left to assign.`
          : `Net worth is ${formatMoney(wealth.netWorth)} (${formatMoney(wealth.investments)} invested). No non-transfer income has been detected yet, so budget limits will not be inferred from transfers.`}
      </p>
    </div>
  );
}

function FinanceBudgetSummary({
  budgets,
  month,
  onOpenDetail,
  statuses,
  transactions,
}: {
  budgets: Array<{ category: string; limit: number; month: string }>;
  month: string;
  onOpenDetail: (detail: { kind: "overages" | "planned" | "spent" }) => void;
  statuses?: FinanceBudgetStatus[] | undefined;
  transactions: FinanceTransaction[];
}) {
  const planned = budgets
    .filter((item) => item.month === month)
    .reduce((sum, item) => sum + item.limit, 0);
  const spent = statuses
    ? statuses.reduce((sum, item) => sum + item.spent, 0)
    : transactions
        .filter((item) => item.direction === "expense" && item.date.startsWith(month))
        .reduce((sum, item) => sum + item.amount, 0);
  const remaining = planned - spent;
  const spentPercentage = planned > 0 ? Math.round((spent / planned) * 100) : 0;
  const currentMonth = new Date().toISOString().slice(0, 7);
  const monthProgress =
    month === currentMonth
      ? new Date().getUTCDate() /
        new Date(
          Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() + 1, 0),
        ).getUTCDate()
      : null;
  const paceLabel =
    monthProgress === null || planned === 0
      ? undefined
      : spentPercentage <= Math.round(monthProgress * 100) + 8
        ? "On pace"
        : "Over pace";

  return (
    <section
      aria-label={`${formatMonth(month)} budget plan`}
      className="mb-5 grid gap-3 sm:grid-cols-3"
    >
      <BudgetMetricCard
        aside={<ShadcnBadge variant="secondary">{budgets.length} categories</ShadcnBadge>}
        label="Planned"
        onClick={() => onOpenDetail({ kind: "planned" })}
        value={formatMoney(planned)}
      />
      <BudgetMetricCard
        aside={
          <ShadcnBadge variant={spentPercentage > 100 ? "destructive" : "secondary"}>
            {spentPercentage}% of plan
          </ShadcnBadge>
        }
        label="Spent"
        onClick={() => onOpenDetail({ kind: "spent" })}
        tone="destructive"
        value={formatMoney(spent)}
      />
      <BudgetMetricCard
        aside={
          paceLabel ? (
            <ShadcnBadge variant={paceLabel === "On pace" ? "secondary" : "destructive"}>
              {paceLabel}
            </ShadcnBadge>
          ) : undefined
        }
        label={remaining >= 0 ? "Left to spend" : "Over plan"}
        onClick={() => onOpenDetail({ kind: remaining < 0 ? "overages" : "spent" })}
        tone={remaining >= 0 ? "success" : "destructive"}
        value={formatMoney(Math.abs(remaining))}
      />
    </section>
  );
}

function BudgetMetricCard({
  aside,
  label,
  onClick,
  tone,
  value,
}: {
  aside?: ReactNode;
  label: string;
  onClick?: (() => void) | undefined;
  tone?: "destructive" | "success" | undefined;
  value: string;
}) {
  return (
    <div className="rounded-md border bg-muted/30">
      {onClick ? (
        <ShadcnButton
          aria-label={`${label}: view contributing transactions`}
          className="h-auto w-full justify-start px-4 py-3 text-left"
          onClick={onClick}
          variant="ghost"
        >
          <BudgetMetricCardContent aside={aside} label={label} tone={tone} value={value} />
        </ShadcnButton>
      ) : (
        <div className="px-4 py-3">
          <BudgetMetricCardContent aside={aside} label={label} tone={tone} value={value} />
        </div>
      )}
    </div>
  );
}

function BudgetMetricCardContent({
  aside,
  label,
  tone,
  value,
}: {
  aside?: ReactNode;
  label: string;
  tone?: "destructive" | "success" | undefined;
  value: string;
}) {
  return (
    <span className="block">
      <span className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </span>
        {aside ? <span className="shrink-0">{aside}</span> : null}
      </span>
      <span
        className={
          tone === "success"
            ? "mt-1 block text-xl font-semibold text-success"
            : tone === "destructive"
              ? "mt-1 block text-xl font-semibold text-destructive"
              : "mt-1 block text-xl font-semibold"
        }
      >
        {value}
      </span>
    </span>
  );
}

function FinanceMonthNavigator({
  month,
  onNext,
  onPrevious,
}: {
  month: string;
  onNext: () => void;
  onPrevious: () => void;
}) {
  return (
    <fieldset className="flex items-center rounded-md border bg-background">
      <legend className="sr-only">Budget month</legend>
      <ShadcnButton aria-label="Previous month" onClick={onPrevious} size="icon-sm" variant="ghost">
        <ChevronLeft />
      </ShadcnButton>
      <span className="min-w-28 px-2 text-center text-sm font-medium tabular-nums">
        {formatMonth(month)}
      </span>
      <ShadcnButton aria-label="Next month" onClick={onNext} size="icon-sm" variant="ghost">
        <ChevronRight />
      </ShadcnButton>
    </fieldset>
  );
}

function FinanceExportMenu() {
  return (
    <ShadcnDropdownMenu>
      <ShadcnDropdownMenuTrigger asChild>
        <ShadcnButton size="sm" variant="outline">
          <Download data-icon="inline-start" />
          Export data
        </ShadcnButton>
      </ShadcnDropdownMenuTrigger>
      <ShadcnDropdownMenuContent align="end">
        <ShadcnDropdownMenuLabel>Raw finance data (CSV)</ShadcnDropdownMenuLabel>
        <ShadcnDropdownMenuSeparator />
        <ShadcnDropdownMenuItem
          onSelect={() =>
            void api
              .exportFinanceData()
              .then((value) => downloadFinanceCsv("transactions", value.transactions))
          }
        >
          Transactions
        </ShadcnDropdownMenuItem>
        <ShadcnDropdownMenuItem
          onSelect={() =>
            void api
              .exportFinanceData()
              .then((value) => downloadFinanceCsv("accounts", value.accounts))
          }
        >
          Accounts
        </ShadcnDropdownMenuItem>
        <ShadcnDropdownMenuItem
          onSelect={() =>
            void api
              .exportFinanceData()
              .then((value) => downloadFinanceCsv("budgets", value.budgets))
          }
        >
          Budget plan
        </ShadcnDropdownMenuItem>
        <ShadcnDropdownMenuItem
          onSelect={() =>
            void api
              .exportFinanceData()
              .then((value) => downloadFinanceCsv("categories", value.categories))
          }
        >
          Categories
        </ShadcnDropdownMenuItem>
      </ShadcnDropdownMenuContent>
    </ShadcnDropdownMenu>
  );
}

function FinanceBudgetAllocationChart({
  budgets,
}: {
  budgets: Array<{ category: string; limit: number }>;
}) {
  const colors = ["#2563eb", "#0891b2", "#7c3aed", "#db2777", "#d97706", "#16a34a"];
  const data = budgets.map((budget) => ({
    name: transactionCategoryLabel(budget.category),
    value: budget.limit,
  }));
  if (data.length === 0) {
    return (
      <EmptyState icon={<CircleHelp />} title="No planned categories">
        Set a category limit to see its allocation.
      </EmptyState>
    );
  }
  return (
    <section aria-label="Planned allocation chart" className="pt-4">
      <div className="h-64">
        <ResponsiveContainer height="100%" width="100%">
          <PieChart>
            <Pie data={data} dataKey="value" innerRadius={54} outerRadius={88} paddingAngle={2}>
              {data.map((item, index) => (
                <Cell fill={colors[index % colors.length]} key={item.name} />
              ))}
            </Pie>
            <Tooltip formatter={(value: number) => formatMoney(value)} />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <ShadcnTable aria-label="Planned allocation by category" className="mt-2">
        <ShadcnTableHeader>
          <ShadcnTableRow>
            <ShadcnTableHead>Category</ShadcnTableHead>
            <ShadcnTableHead className="text-right">Planned</ShadcnTableHead>
          </ShadcnTableRow>
        </ShadcnTableHeader>
        <ShadcnTableBody>
          {data.map((item, index) => (
            <ShadcnTableRow key={item.name}>
              <ShadcnTableCell>
                <span
                  className="mr-2 inline-block size-2 rounded-full"
                  style={{ backgroundColor: colors[index % colors.length] }}
                />
                {item.name}
              </ShadcnTableCell>
              <ShadcnTableCell className="text-right font-medium">
                {formatMoney(item.value)}
              </ShadcnTableCell>
            </ShadcnTableRow>
          ))}
        </ShadcnTableBody>
      </ShadcnTable>
    </section>
  );
}

function BudgetProgress({
  budget,
  status,
  transactions,
}: {
  budget: { category: string; limit: number; month: string };
  status?: FinanceBudgetStatus | undefined;
  transactions: FinanceTransaction[];
}) {
  const spent =
    status?.spent ??
    transactions
      .filter(
        (transaction) =>
          transaction.direction === "expense" &&
          transaction.category === budget.category &&
          transaction.date.startsWith(budget.month),
      )
      .reduce((sum, transaction) => sum + transaction.amount, 0);
  const percentage = budget.limit > 0 ? Math.min(100, Math.round((spent / budget.limit) * 100)) : 0;
  const remaining = budget.limit - spent;
  return (
    <span className="mt-1 block space-y-1.5">
      <span className="block">
        {formatMonth(budget.month)} · {formatMoney(spent)} spent ·{" "}
        {formatMoney(Math.abs(remaining))} {remaining >= 0 ? "left" : "over"}
      </span>
      <span
        aria-label={`${transactionCategoryLabel(budget.category)} budget progress`}
        aria-valuemax={budget.limit}
        aria-valuemin={0}
        aria-valuenow={Math.min(spent, budget.limit)}
        className="block h-1.5 overflow-hidden rounded-full bg-muted"
        role="progressbar"
      >
        <span
          className={remaining < 0 ? "block h-full bg-destructive" : "block h-full bg-primary"}
          style={{ width: `${percentage}%` }}
        />
      </span>
    </span>
  );
}

function FinanceBudgetDetailDialog({
  budgets,
  detail,
  month,
  onOpenChange,
  statuses,
  transactions,
}: {
  budgets: Array<{ category: string; limit: number; month: string }>;
  detail: { category?: string; kind: "category" | "overages" | "planned" | "spent" } | null;
  month: string;
  onOpenChange: (open: boolean) => void;
  statuses?: FinanceBudgetStatus[] | undefined;
  transactions: FinanceTransaction[];
}) {
  if (!detail) return null;
  const monthlyBudgets = budgets.filter((item) => item.month === month);
  const budgetsByCategory = new Map(monthlyBudgets.map((item) => [item.category, item]));
  const expenses = transactions.filter(
    (item) =>
      item.date.startsWith(month) &&
      (item.direction === "expense" ||
        (item.direction === "income" && item.category !== "INCOME" && item.category !== "OTHER")),
  );
  const spentByCategory = new Map<string, number>();
  for (const item of expenses) {
    if (item.category) {
      spentByCategory.set(item.category, (spentByCategory.get(item.category) ?? 0) + item.amount);
    }
  }
  const authoritativeSpent = new Map(
    (statuses ?? []).map((status) => [status.budget.category, status.spent]),
  );
  const overBudgetCategories = monthlyBudgets
    .filter(
      (item) =>
        (authoritativeSpent.get(item.category) ?? spentByCategory.get(item.category) ?? 0) >
        item.limit,
    )
    .map((item) => item.category);
  const detailTransactions =
    detail.kind === "category"
      ? expenses.filter((item) => item.category === detail.category)
      : detail.kind === "overages"
        ? expenses.filter((item) => item.category && overBudgetCategories.includes(item.category))
        : detail.kind === "planned"
          ? []
          : expenses;
  const selectedBudget = detail.category ? budgetsByCategory.get(detail.category) : undefined;
  const selectedSpent = detail.category
    ? (authoritativeSpent.get(detail.category) ??
      detailTransactions.reduce(
        (sum, item) => sum + (item.direction === "expense" ? item.amount : -item.amount),
        0,
      ))
    : detailTransactions.reduce(
        (sum, item) => sum + (item.direction === "expense" ? item.amount : -item.amount),
        0,
      );
  const allocationSignals = expenses.filter(
    (item) => item.needsReview || !item.category || !budgetsByCategory.has(item.category),
  );
  const title =
    detail.kind === "category"
      ? `${transactionCategoryLabel(detail.category ?? null)} activity`
      : detail.kind === "overages"
        ? "Over-plan activity"
        : detail.kind === "planned"
          ? "Planned allocation"
          : "Spending this month";
  const description =
    detail.kind === "category" && selectedBudget
      ? `${formatMonth(month)} · ${formatMoney(selectedSpent)} spent against a ${formatMoney(selectedBudget.limit)} limit.`
      : detail.kind === "overages"
        ? `${formatMonth(month)} · transactions in the categories currently over their monthly limits.`
        : detail.kind === "planned"
          ? `${formatMonth(month)} · how your monthly plan is divided across categories.`
          : `${formatMonth(month)} · all expense transactions included in this budget view.`;

  return (
    <ShadcnDialog onOpenChange={onOpenChange} open>
      <ShadcnDialogContent className="max-h-[85vh] overflow-hidden p-0 sm:max-w-3xl">
        <ShadcnDialogHeader>
          <div className="p-4 pr-12">
            <ShadcnDialogTitle>{title}</ShadcnDialogTitle>
            <ShadcnDialogDescription className="mt-2">{description}</ShadcnDialogDescription>
          </div>
        </ShadcnDialogHeader>
        <div className="app-scrollbar min-h-0 overflow-y-auto px-4 pb-4">
          {detail.kind === "planned" ? (
            <FinanceBudgetAllocationChart budgets={monthlyBudgets} />
          ) : null}
          {detail.kind === "overages" ? (
            <details aria-label="Over-plan categories" className="rounded-md border" open>
              <summary className="cursor-pointer px-3 py-2 text-sm font-medium">
                Over-plan categories ({overBudgetCategories.length})
              </summary>
              <div className="space-y-2 border-t p-3">
                {overBudgetCategories.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No categories are over plan.</p>
                ) : (
                  overBudgetCategories.map((category) => {
                    const budget = budgetsByCategory.get(category);
                    const overage =
                      (authoritativeSpent.get(category) ?? spentByCategory.get(category) ?? 0) -
                      (budget?.limit ?? 0);
                    return (
                      <div
                        className="flex items-center justify-between gap-4 rounded-md border p-3"
                        key={category}
                      >
                        <span className="font-medium">{transactionCategoryLabel(category)}</span>
                        <span className="shrink-0 text-sm text-destructive">
                          {formatMoney(overage)} over
                        </span>
                      </div>
                    );
                  })
                )}
              </div>
            </details>
          ) : null}
          {detail.kind !== "planned" ? (
            <details aria-label="Contributing transactions" className="mt-4 rounded-md border" open>
              <summary className="cursor-pointer px-3 py-2 text-sm font-medium">
                Contributing transactions ({detailTransactions.length})
              </summary>
              <div className="border-t">
                {detailTransactions.length === 0 ? (
                  <p className="p-3 text-sm text-muted-foreground">
                    No expense transactions match this view yet.
                  </p>
                ) : (
                  <ShadcnTable aria-label="Contributing transactions" className="min-w-[34rem]">
                    <ShadcnTableHeader>
                      <ShadcnTableRow>
                        <ShadcnTableHead>Merchant</ShadcnTableHead>
                        <ShadcnTableHead>Date</ShadcnTableHead>
                        <ShadcnTableHead>Category</ShadcnTableHead>
                        <ShadcnTableHead className="text-right">Amount</ShadcnTableHead>
                      </ShadcnTableRow>
                    </ShadcnTableHeader>
                    <ShadcnTableBody>
                      {detailTransactions.map((item) => (
                        <ShadcnTableRow key={item.id}>
                          <ShadcnTableCell className="font-medium">{item.merchant}</ShadcnTableCell>
                          <ShadcnTableCell>
                            {formatDateOnly(item.date, {
                              day: "numeric",
                              month: "short",
                              year: "numeric",
                            })}
                          </ShadcnTableCell>
                          <ShadcnTableCell>
                            {transactionCategoryLabel(item.category)}
                          </ShadcnTableCell>
                          <ShadcnTableCell
                            className={
                              item.direction === "income"
                                ? "text-right font-medium text-success"
                                : "text-right font-medium text-destructive"
                            }
                          >
                            {item.direction === "income" ? "+" : "−"}
                            {formatMoney(item.amount)}
                          </ShadcnTableCell>
                        </ShadcnTableRow>
                      ))}
                    </ShadcnTableBody>
                  </ShadcnTable>
                )}
              </div>
            </details>
          ) : null}
          {detail.kind !== "planned" ? (
            <details aria-label="Potential allocation issues" className="mt-4 rounded-md border">
              <summary className="cursor-pointer px-3 py-2 text-sm font-medium">
                <span>Potential allocation issues</span>
                <span className="ml-1 text-muted-foreground">({allocationSignals.length})</span>
              </summary>
              <div className="border-t p-3">
                <p className="text-sm text-muted-foreground">
                  These are signals to review, not automatic corrections: uncategorized
                  transactions, transactions awaiting review, or spending without a matching monthly
                  budget.
                </p>
                {allocationSignals.length === 0 ? (
                  <p className="mt-2 text-sm text-success">Nothing needs allocation review.</p>
                ) : (
                  <ShadcnItemGroup className="mt-3">
                    {allocationSignals.map((item) => (
                      <ShadcnItem key={item.id} variant="outline">
                        <ShadcnItemContent>
                          <ShadcnItemTitle>{item.merchant}</ShadcnItemTitle>
                          <ShadcnItemDescription>
                            {item.needsReview
                              ? "Needs category review"
                              : item.category
                                ? "No monthly limit"
                                : "Uncategorized"}
                          </ShadcnItemDescription>
                        </ShadcnItemContent>
                        <ShadcnItemActions>{formatMoney(item.amount)}</ShadcnItemActions>
                      </ShadcnItem>
                    ))}
                  </ShadcnItemGroup>
                )}
              </div>
            </details>
          ) : null}
        </div>
      </ShadcnDialogContent>
    </ShadcnDialog>
  );
}

function FinanceAgentGuidancePanel({
  activating,
  activationEligible,
  error,
  loading,
  onActivate,
  profileStatus,
  setup,
}: {
  activating: boolean;
  activationEligible: boolean;
  error: Error | null;
  loading: boolean;
  onActivate: () => void;
  profileStatus: "active" | "draft" | null;
  setup: FinanceGuidedSetupContext | undefined;
}) {
  const availableWorkflows =
    setup?.suggestedWorkflows.filter((workflow) => workflow.available).length ?? 0;
  const humanOnlyActionLabels =
    setup?.humanOnlyActions
      .map((action) => financeHumanOnlyActionLabels[action])
      .filter((label): label is string => Boolean(label)) ?? [];
  return (
    <ShadcnCard>
      <ShadcnCardHeader>
        <ShadcnCardTitle>Agent guidance</ShadcnCardTitle>
        <ShadcnCardDescription>
          Durable source meanings, review preferences, terminology, thresholds, and safety
          constraints for Claude, Codex, and other scoped hosts.
        </ShadcnCardDescription>
        <ShadcnCardAction>
          <ShadcnBadge variant={profileStatus === "active" ? "default" : "secondary"}>
            {profileStatus === "active"
              ? "Active"
              : profileStatus === "draft"
                ? "Draft"
                : "Not configured"}
          </ShadcnBadge>
        </ShadcnCardAction>
      </ShadcnCardHeader>
      <ShadcnCardContent className="flex flex-col gap-4">
        {loading ? <Spinner label="Loading Finance agent guidance" /> : null}
        {error ? <InlineError error={error} /> : null}
        {setup ? (
          <ShadcnItemGroup>
            <ShadcnItem size="sm" variant="muted">
              <ShadcnItemContent>
                <ShadcnItemTitle>Sources ready</ShadcnItemTitle>
                <ShadcnItemDescription>
                  {setup.accountSources.length} account
                  {setup.accountSources.length === 1 ? "" : "s"} available for a short,
                  example-based interview. Profile source meanings guide interpretation; they do not
                  restrict the accounts an authorized token can read.
                </ShadcnItemDescription>
              </ShadcnItemContent>
            </ShadcnItem>
            <ShadcnItem size="sm" variant="muted">
              <ShadcnItemContent>
                <ShadcnItemTitle>Suggested workflows</ShadcnItemTitle>
                <ShadcnItemDescription>
                  {availableWorkflows} available now. Ledger health and evidence come before
                  categorization, cash-flow, or monthly-review guidance.
                </ShadcnItemDescription>
              </ShadcnItemContent>
            </ShadcnItem>
            <ShadcnItem size="sm" variant="muted">
              <ShadcnItemContent>
                <ShadcnItemTitle>Human-only boundaries</ShadcnItemTitle>
                <ShadcnItemDescription>
                  {humanOnlyActionLabels.length > 0
                    ? `${humanOnlyActionLabels.join(", ")} stay in Finance.`
                    : "Consequential finance actions stay in Finance."}
                </ShadcnItemDescription>
              </ShadcnItemContent>
              <ShadcnItemActions>
                <ShadcnButton asChild size="sm" variant="outline">
                  <Link to="/settings?section=agent-access">Connect an agent</Link>
                </ShadcnButton>
              </ShadcnItemActions>
            </ShadcnItem>
            {profileStatus === "draft" ? (
              <ShadcnItem size="sm" variant="muted">
                <ShadcnItemContent>
                  <ShadcnItemTitle>Draft activation</ShadcnItemTitle>
                  <ShadcnItemDescription>
                    {activationEligible
                      ? "Review the recorded source meanings, thresholds, terminology, and safety constraints before activating this guidance."
                      : "Add at least one owned account source to the draft before activation."}
                  </ShadcnItemDescription>
                </ShadcnItemContent>
                <ShadcnItemActions>
                  <ShadcnButton
                    disabled={!activationEligible || activating}
                    onClick={onActivate}
                    size="sm"
                  >
                    {activating ? "Activating…" : "Activate guidance"}
                  </ShadcnButton>
                </ShadcnItemActions>
              </ShadcnItem>
            ) : null}
          </ShadcnItemGroup>
        ) : null}
      </ShadcnCardContent>
    </ShadcnCard>
  );
}

function FinancialProfilePanel({
  accounts,
  form,
  onChange,
  onSave,
  saving,
}: {
  accounts: FinanceAccount[];
  form: {
    effectiveDate: string;
    employer: string;
    employmentType: "" | "contract" | "full_time" | "part_time" | "self_employed" | "unemployed";
    expectedNetPay: string;
    grossAnnualIncome: string;
    nextPayday: string;
    payAccountId: string;
    payFrequency: "" | "biweekly" | "irregular" | "monthly" | "semimonthly" | "weekly";
    role: string;
  };
  onChange: React.Dispatch<React.SetStateAction<typeof form>>;
  onSave: () => void;
  saving: boolean;
}) {
  return (
    <ShadcnCard>
      <ShadcnCardHeader>
        <ShadcnCardTitle>Financial profile</ShadcnCardTitle>
        <ShadcnCardDescription>
          Your private baseline for paycheck and cash-flow checks. It is never inferred as a job
          change without your confirmation.
        </ShadcnCardDescription>
        <ShadcnCardAction>
          <ShadcnButton disabled={saving} onClick={onSave}>
            {saving ? "Saving…" : "Save profile"}
          </ShadcnButton>
        </ShadcnCardAction>
      </ShadcnCardHeader>
      <ShadcnCardContent>
        <ShadcnFieldGroup className="grid gap-4 md:grid-cols-2">
          <ShadcnField>
            <ShadcnFieldLabel htmlFor="finance-employer">Employer</ShadcnFieldLabel>
            <ShadcnInput
              id="finance-employer"
              onChange={(event) =>
                onChange((value) => ({ ...value, employer: event.target.value }))
              }
              value={form.employer}
            />
          </ShadcnField>
          <ShadcnField>
            <ShadcnFieldLabel htmlFor="finance-role">Role</ShadcnFieldLabel>
            <ShadcnInput
              id="finance-role"
              onChange={(event) => onChange((value) => ({ ...value, role: event.target.value }))}
              value={form.role}
            />
          </ShadcnField>
          <ShadcnField>
            <ShadcnFieldLabel htmlFor="finance-employment-type">Employment type</ShadcnFieldLabel>
            <ShadcnNativeSelect
              id="finance-employment-type"
              onChange={(event) =>
                onChange((value) => ({
                  ...value,
                  employmentType: event.target.value as typeof form.employmentType,
                }))
              }
              value={form.employmentType}
            >
              <NativeSelectOption value="">Not set</NativeSelectOption>
              <NativeSelectOption value="full_time">Full time</NativeSelectOption>
              <NativeSelectOption value="part_time">Part time</NativeSelectOption>
              <NativeSelectOption value="contract">Contract</NativeSelectOption>
              <NativeSelectOption value="self_employed">Self-employed</NativeSelectOption>
              <NativeSelectOption value="unemployed">Not employed</NativeSelectOption>
            </ShadcnNativeSelect>
          </ShadcnField>
          <ShadcnField>
            <ShadcnFieldLabel htmlFor="finance-effective-date">Effective date</ShadcnFieldLabel>
            <ShadcnInput
              id="finance-effective-date"
              onChange={(event) =>
                onChange((value) => ({ ...value, effectiveDate: event.target.value }))
              }
              type="date"
              value={form.effectiveDate}
            />
          </ShadcnField>
          <ShadcnField>
            <ShadcnFieldLabel htmlFor="finance-gross-income">Gross annual income</ShadcnFieldLabel>
            <ShadcnInput
              id="finance-gross-income"
              inputMode="decimal"
              onChange={(event) =>
                onChange((value) => ({ ...value, grossAnnualIncome: event.target.value }))
              }
              placeholder="0.00"
              value={form.grossAnnualIncome}
            />
          </ShadcnField>
          <ShadcnField>
            <ShadcnFieldLabel htmlFor="finance-net-pay">Expected net paycheck</ShadcnFieldLabel>
            <ShadcnInput
              id="finance-net-pay"
              inputMode="decimal"
              onChange={(event) =>
                onChange((value) => ({ ...value, expectedNetPay: event.target.value }))
              }
              placeholder="0.00"
              value={form.expectedNetPay}
            />
          </ShadcnField>
          <ShadcnField>
            <ShadcnFieldLabel htmlFor="finance-pay-frequency">Pay frequency</ShadcnFieldLabel>
            <ShadcnNativeSelect
              id="finance-pay-frequency"
              onChange={(event) =>
                onChange((value) => ({
                  ...value,
                  payFrequency: event.target.value as typeof form.payFrequency,
                }))
              }
              value={form.payFrequency}
            >
              <NativeSelectOption value="">Not set</NativeSelectOption>
              <NativeSelectOption value="weekly">Weekly</NativeSelectOption>
              <NativeSelectOption value="biweekly">Every two weeks</NativeSelectOption>
              <NativeSelectOption value="semimonthly">Twice monthly</NativeSelectOption>
              <NativeSelectOption value="monthly">Monthly</NativeSelectOption>
              <NativeSelectOption value="irregular">Irregular</NativeSelectOption>
            </ShadcnNativeSelect>
          </ShadcnField>
          <ShadcnField>
            <ShadcnFieldLabel htmlFor="finance-next-payday">Next payday</ShadcnFieldLabel>
            <ShadcnInput
              id="finance-next-payday"
              onChange={(event) =>
                onChange((value) => ({ ...value, nextPayday: event.target.value }))
              }
              type="date"
              value={form.nextPayday}
            />
          </ShadcnField>
          <ShadcnField>
            <ShadcnFieldLabel htmlFor="finance-pay-account">Pay account</ShadcnFieldLabel>
            <ShadcnNativeSelect
              id="finance-pay-account"
              onChange={(event) =>
                onChange((value) => ({ ...value, payAccountId: event.target.value }))
              }
              value={form.payAccountId}
            >
              <NativeSelectOption value="">Not set</NativeSelectOption>
              {accounts.map((account) => (
                <NativeSelectOption key={account.id} value={account.id}>
                  {account.institution} · {account.name}
                </NativeSelectOption>
              ))}
            </ShadcnNativeSelect>
          </ShadcnField>
        </ShadcnFieldGroup>
      </ShadcnCardContent>
    </ShadcnCard>
  );
}

function CashflowPanel({
  alerts,
  forecast,
  incomeStreams,
  onRefresh,
  onResolveAlert,
  onUpdateIncome,
  onUpdateRecurring,
  recurring,
}: {
  alerts: Array<{ body: string; id: string; severity: "info" | "warning"; title: string }>;
  forecast: FinanceForecast | undefined;
  incomeStreams: Array<{
    confidence: number;
    displayName: string;
    expectedAmount: number;
    id: string;
    nextExpectedDate: string | null;
    status: "active" | "needs_review" | "paused";
  }>;
  onRefresh: () => void;
  onResolveAlert: (id: string, action: "dismiss" | "resolve") => void;
  onUpdateIncome: (id: string, status: "active" | "paused") => void;
  onUpdateRecurring: (id: string, status: "active" | "cancelled" | "paused") => void;
  recurring: FinanceRecurringObligation[];
}) {
  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="space-y-5">
        <section className="grid gap-3 sm:grid-cols-3">
          <FinanceMetric label="Safe to spend" value={formatMoney(forecast?.safeToSpend ?? 0)} />
          <FinanceMetric
            label="Expected income"
            value={formatMoney(forecast?.upcomingIncome ?? 0)}
          />
          <FinanceMetric
            label="Upcoming obligations"
            value={formatMoney(forecast?.upcomingObligations ?? 0)}
          />
        </section>
        <ShadcnCard>
          <ShadcnCardHeader>
            <ShadcnCardTitle>Expected income</ShadcnCardTitle>
            <ShadcnCardDescription>
              Only consistent deposits are activated automatically. Confirm candidates before
              relying on them.
            </ShadcnCardDescription>
            <ShadcnCardAction>
              <ShadcnButton onClick={onRefresh} size="sm" variant="outline">
                Refresh patterns
              </ShadcnButton>
            </ShadcnCardAction>
          </ShadcnCardHeader>
          <ShadcnCardContent>
            <ShadcnItemGroup>
              {incomeStreams.length ? (
                incomeStreams.map((stream) => (
                  <ShadcnItem key={stream.id} variant="outline">
                    <ShadcnItemContent>
                      <ShadcnItemTitle>{stream.displayName}</ShadcnItemTitle>
                      <ShadcnItemDescription>
                        {formatMoney(stream.expectedAmount)} · {Math.round(stream.confidence * 100)}
                        % confidence
                        {stream.nextExpectedDate
                          ? ` · next ${formatDateOnly(stream.nextExpectedDate, { day: "numeric", month: "short" })}`
                          : ""}
                      </ShadcnItemDescription>
                    </ShadcnItemContent>
                    <ShadcnItemActions>
                      {stream.status === "needs_review" ? (
                        <ShadcnButton
                          onClick={() => onUpdateIncome(stream.id, "active")}
                          size="sm"
                          variant="outline"
                        >
                          Confirm
                        </ShadcnButton>
                      ) : (
                        <ShadcnBadge variant="secondary">{stream.status}</ShadcnBadge>
                      )}
                    </ShadcnItemActions>
                  </ShadcnItem>
                ))
              ) : (
                <p className="text-sm text-muted-foreground">
                  No stable income stream has enough evidence yet.
                </p>
              )}
            </ShadcnItemGroup>
          </ShadcnCardContent>
        </ShadcnCard>
        <ShadcnCard>
          <ShadcnCardHeader>
            <ShadcnCardTitle>Recurring payments</ShadcnCardTitle>
            <ShadcnCardDescription>
              Confirmed payments are in the forecast. Candidates remain outside it until you
              confirm.
            </ShadcnCardDescription>
          </ShadcnCardHeader>
          <ShadcnCardContent>
            <ShadcnItemGroup>
              {recurring.length ? (
                recurring.slice(0, 12).map((item) => (
                  <ShadcnItem key={item.id} variant="outline">
                    <ShadcnItemContent>
                      <ShadcnItemTitle>{item.displayName}</ShadcnItemTitle>
                      <ShadcnItemDescription>
                        {formatMoney(item.expectedAmount)} · {item.cadence}
                        {item.nextExpectedDate
                          ? ` · next ${formatDateOnly(item.nextExpectedDate, { day: "numeric", month: "short" })}`
                          : ""}
                      </ShadcnItemDescription>
                    </ShadcnItemContent>
                    <ShadcnItemActions>
                      {item.status === "needs_review" ? (
                        <ShadcnButton
                          onClick={() => onUpdateRecurring(item.id, "active")}
                          size="sm"
                          variant="outline"
                        >
                          Confirm
                        </ShadcnButton>
                      ) : (
                        <ShadcnBadge variant="secondary">{item.status}</ShadcnBadge>
                      )}
                    </ShadcnItemActions>
                  </ShadcnItem>
                ))
              ) : (
                <p className="text-sm text-muted-foreground">
                  No recurring payments have enough evidence yet.
                </p>
              )}
            </ShadcnItemGroup>
          </ShadcnCardContent>
        </ShadcnCard>
      </div>
      <ShadcnCard>
        <ShadcnCardHeader>
          <ShadcnCardTitle>Alerts</ShadcnCardTitle>
          <ShadcnCardDescription>
            Evidence-based checks, delivered only in this workspace.
          </ShadcnCardDescription>
        </ShadcnCardHeader>
        <ShadcnCardContent>
          <ShadcnItemGroup>
            {alerts.length ? (
              alerts.map((alert) => (
                <ShadcnItem key={alert.id} variant="outline">
                  <ShadcnItemContent>
                    <ShadcnItemTitle>{alert.title}</ShadcnItemTitle>
                    <ShadcnItemDescription>{alert.body}</ShadcnItemDescription>
                  </ShadcnItemContent>
                  <ShadcnItemActions>
                    <ShadcnButton
                      onClick={() => onResolveAlert(alert.id, "resolve")}
                      size="sm"
                      variant="outline"
                    >
                      Review
                    </ShadcnButton>
                  </ShadcnItemActions>
                </ShadcnItem>
              ))
            ) : (
              <p className="text-sm text-muted-foreground">No open financial alerts.</p>
            )}
          </ShadcnItemGroup>
        </ShadcnCardContent>
      </ShadcnCard>
    </div>
  );
}

function SubscriptionsPanel({
  items,
  onUpdate,
}: {
  items: FinanceRecurringObligation[];
  onUpdate: (id: string, status: "active" | "cancelled" | "paused") => void;
}) {
  return (
    <ShadcnCard>
      <ShadcnCardHeader>
        <ShadcnCardTitle>Subscriptions</ShadcnCardTitle>
        <ShadcnCardDescription>
          Detected recurring services. High-confidence matches are active; candidates wait for your
          confirmation.
        </ShadcnCardDescription>
      </ShadcnCardHeader>
      <ShadcnCardContent>
        <ShadcnItemGroup>
          {items.length ? (
            items.map((item) => (
              <ShadcnItem key={item.id} variant="outline">
                <ShadcnItemContent>
                  <ShadcnItemTitle>{item.displayName}</ShadcnItemTitle>
                  <ShadcnItemDescription>
                    {formatMoney(item.expectedAmount)} · {item.cadence} ·{" "}
                    {Math.round(item.confidence * 100)}% confidence
                    {item.nextExpectedDate
                      ? ` · next ${formatDateOnly(item.nextExpectedDate, { day: "numeric", month: "short" })}`
                      : ""}
                  </ShadcnItemDescription>
                </ShadcnItemContent>
                <ShadcnItemActions>
                  {item.status === "needs_review" ? (
                    <ShadcnButton
                      onClick={() => onUpdate(item.id, "active")}
                      size="sm"
                      variant="outline"
                    >
                      Confirm
                    </ShadcnButton>
                  ) : (
                    <ShadcnButton
                      onClick={() =>
                        onUpdate(item.id, item.status === "paused" ? "active" : "paused")
                      }
                      size="sm"
                      variant="outline"
                    >
                      {item.status === "paused" ? "Resume" : "Pause"}
                    </ShadcnButton>
                  )}
                  <ShadcnButton
                    onClick={() => onUpdate(item.id, "cancelled")}
                    size="sm"
                    variant="ghost"
                  >
                    Cancel
                  </ShadcnButton>
                </ShadcnItemActions>
              </ShadcnItem>
            ))
          ) : (
            <EmptyState icon={<CircleHelp />} title="No subscriptions detected">
              We need at least three consistent charges to suggest a subscription.
            </EmptyState>
          )}
        </ShadcnItemGroup>
      </ShadcnCardContent>
    </ShadcnCard>
  );
}

function FinanceOverviewLinks({ reviewCount }: { reviewCount: number }) {
  const links: Array<{ description: string; label: string; path: string }> = [
    {
      description: "Set your expected income, pay cadence, and private employment baseline.",
      label: "Financial profile",
      path: "/finances/profile",
    },
    {
      description:
        "See verified income, upcoming obligations, alerts, and your safe-to-spend forecast.",
      label: "Cash flow",
      path: "/finances/cashflow",
    },
    {
      description: "Review recurring services and take action on subscription changes.",
      label: "Subscriptions",
      path: "/finances/subscriptions",
    },
    {
      description: "See pending activity, transfer candidates, duplicates, and coverage gaps.",
      label: "Ledger health",
      path: "/finances/health",
    },
    {
      description: reviewCount
        ? `${reviewCount} transactions need a category.`
        : "No categories need attention.",
      label: "Review queue",
      path: "/finances/review",
    },
    {
      description: "See balances, sync status, and account connections.",
      label: "Accounts",
      path: "/finances/accounts",
    },
    {
      description: "Set category limits and monitor monthly progress.",
      label: "Budgets",
      path: "/finances/budgets",
    },
    {
      description: "Browse transactions or add a manual entry.",
      label: "Transactions",
      path: "/finances/transactions",
    },
  ];
  return (
    <section aria-label="Finance workspaces" className="grid gap-4 md:grid-cols-2">
      {links.map((item) => (
        <ShadcnCard key={item.path}>
          <ShadcnCardHeader>
            <ShadcnCardTitle>{item.label}</ShadcnCardTitle>
            <ShadcnCardDescription>{item.description}</ShadcnCardDescription>
            <ShadcnCardAction>
              <ShadcnButton asChild size="sm" variant="outline">
                <Link to={item.path}>Open {item.label.toLowerCase()}</Link>
              </ShadcnButton>
            </ShadcnCardAction>
          </ShadcnCardHeader>
        </ShadcnCard>
      ))}
    </section>
  );
}

function FinanceLedgerHealthCard({ health }: { health: FinanceLedgerHealth }) {
  const checks = [
    ["Needs review", health.unresolvedReviews, "Open decisions the system will not guess."],
    [
      "Transfer candidates",
      health.candidateTransfers,
      "Movements without a proven internal counterpart.",
    ],
    [
      "Possible duplicates",
      health.possibleDuplicates,
      "Exact same-account matches; never removed automatically.",
    ],
    [
      "Pending activity",
      health.pendingTransactions,
      "Excluded from posted spend until it settles.",
    ],
    [
      "Stale connections",
      health.staleAccounts,
      "Connected accounts not refreshed in the past 24 hours.",
    ],
    [
      "Balance-only accounts",
      health.balanceOnlyAccounts,
      "Accounts whose balance is tracked without transaction history.",
    ],
    [
      "Missing provenance",
      health.missingProvenance,
      "Historic classifications without a recorded source.",
    ],
  ] as const;
  return (
    <ShadcnItemGroup aria-label="Ledger integrity checks" className="gap-3">
      {checks.map(([label, count, description]) => (
        <ShadcnItem key={label} variant="outline">
          <ShadcnItemContent>
            <ShadcnItemTitle>{label}</ShadcnItemTitle>
            <ShadcnItemDescription>{description}</ShadcnItemDescription>
          </ShadcnItemContent>
          <ShadcnItemActions>
            <ShadcnBadge variant={count > 0 ? "destructive" : "secondary"}>{count}</ShadcnBadge>
          </ShadcnItemActions>
        </ShadcnItem>
      ))}
    </ShadcnItemGroup>
  );
}

function FinanceTransactionsTable({
  hasPreviousPage,
  isCategorizing,
  isLoading,
  nextCursor,
  onCategorize,
  onNextPage,
  onPreviousPage,
  onSort,
  sort,
  transactions,
}: {
  hasPreviousPage: boolean;
  isCategorizing: boolean;
  isLoading: boolean;
  nextCursor: string | null;
  onCategorize: (transaction: FinanceTransaction) => void;
  onNextPage: () => void;
  onPreviousPage: () => void;
  onSort: (sortBy: FinanceTransactionQuery["sortBy"]) => void;
  sort: {
    sortBy: FinanceTransactionQuery["sortBy"];
    sortDirection: FinanceTransactionQuery["sortDirection"];
  };
  transactions: FinanceTransaction[];
}) {
  const [expandedTransactionId, setExpandedTransactionId] = useState<string | null>(null);
  const columns = useMemo<Array<ColumnDef<FinanceTransaction>>>(
    () => [
      {
        accessorKey: "date",
        cell: ({ getValue }) => formatTransactionDate(getValue<string>()),
        header: () => (
          <TransactionSortButton label="Date" onSort={onSort} sort={sort} sortBy="date" />
        ),
      },
      {
        accessorKey: "merchant",
        cell: ({ row }) => {
          const item = row.original;
          const isKnownMerchant = item.merchantId !== null && item.merchantId !== undefined;
          return (
            <div className="flex min-w-0 items-center gap-2">
              {isKnownMerchant ? (
                <span aria-label="Merchant entity found" role="img" title="Merchant entity found">
                  <CircleCheck
                    aria-hidden="true"
                    className="shrink-0 text-muted-foreground"
                    data-icon="inline-start"
                  />
                </span>
              ) : (
                <span
                  aria-label="Merchant entity needs review"
                  role="img"
                  title="Merchant entity needs review"
                >
                  <CircleHelp
                    aria-hidden="true"
                    className="shrink-0 text-muted-foreground"
                    data-icon="inline-start"
                  />
                </span>
              )}
              <div className="min-w-0">
                <p className="truncate font-medium" title={item.merchant}>
                  {item.merchant}
                </p>
              </div>
            </div>
          );
        },
        header: () => (
          <TransactionSortButton label="Merchant" onSort={onSort} sort={sort} sortBy="merchant" />
        ),
      },
      {
        accessorFn: (item) => transactionCategoryLabel(item.category),
        id: "category",
        cell: ({ getValue }) => (
          <ShadcnBadge className="max-w-full truncate" title={getValue<string>()} variant="outline">
            {getValue<string>()}
          </ShadcnBadge>
        ),
        header: "Category",
      },
      {
        accessorKey: "amount",
        cell: ({ row }) => (
          <span
            className={`font-medium tabular-nums ${transactionAmountTone(row.original.direction)}`}
          >
            {formatTransactionAmount(row.original.amount, row.original.direction)}
          </span>
        ),
        header: () => (
          <TransactionSortButton
            align="right"
            label="Amount"
            onSort={onSort}
            sort={sort}
            sortBy="amount"
          />
        ),
      },
      {
        cell: ({ row }) => {
          const isExpanded = expandedTransactionId === row.original.id;
          return (
            <ShadcnButton
              aria-controls={`transaction-details-${row.original.id}`}
              aria-expanded={isExpanded}
              onClick={() => setExpandedTransactionId(isExpanded ? null : row.original.id)}
              size="sm"
              variant="ghost"
            >
              {isExpanded ? "Hide" : "Details"}
              {isExpanded ? (
                <ChevronUp data-icon="inline-end" />
              ) : (
                <ChevronDown data-icon="inline-end" />
              )}
            </ShadcnButton>
          );
        },
        enableSorting: false,
        header: "",
        id: "details",
      },
    ],
    [expandedTransactionId, onSort, sort],
  );
  const table = useReactTable({
    columns,
    data: transactions,
    getCoreRowModel: getCoreRowModel(),
    getRowId: (row) => row.id,
    manualSorting: true,
  });

  if (isLoading)
    return (
      <div className="flex min-h-48 items-center justify-center">
        <Spinner />
      </div>
    );

  if (transactions.length === 0)
    return (
      <EmptyState icon={<CheckCircle2 />} title="No transactions yet">
        Add one manually now; connected providers will populate this ledger after sync.
      </EmptyState>
    );

  return (
    <div className="flex flex-col gap-3">
      <ShadcnTable aria-label="Transactions" className="min-w-[33rem] table-fixed">
        <ShadcnTableHeader>
          {table.getHeaderGroups().map((headerGroup) => (
            <ShadcnTableRow key={headerGroup.id}>
              {headerGroup.headers.map((header) => (
                <ShadcnTableHead
                  className={transactionTableColumnClass(header.column.id)}
                  key={header.id}
                >
                  {header.isPlaceholder
                    ? null
                    : flexRender(header.column.columnDef.header, header.getContext())}
                </ShadcnTableHead>
              ))}
            </ShadcnTableRow>
          ))}
        </ShadcnTableHeader>
        <ShadcnTableBody>
          {table.getRowModel().rows.map((row) => {
            const isExpanded = expandedTransactionId === row.original.id;
            return (
              <Fragment key={row.id}>
                <ShadcnTableRow data-state={isExpanded ? "selected" : undefined}>
                  {row.getVisibleCells().map((cell) => (
                    <ShadcnTableCell
                      className={transactionTableColumnClass(cell.column.id)}
                      key={cell.id}
                    >
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </ShadcnTableCell>
                  ))}
                </ShadcnTableRow>
                {isExpanded ? (
                  <ShadcnTableRow id={`transaction-details-${row.original.id}`}>
                    <ShadcnTableCell
                      className="whitespace-normal"
                      colSpan={row.getVisibleCells().length}
                    >
                      <TransactionDetails
                        isCategorizing={isCategorizing}
                        onCategorize={onCategorize}
                        transaction={row.original}
                      />
                    </ShadcnTableCell>
                  </ShadcnTableRow>
                ) : null}
              </Fragment>
            );
          })}
        </ShadcnTableBody>
      </ShadcnTable>
      <div className="flex items-center justify-between gap-3 border-t pt-3">
        <p className="font-mono text-xs text-muted-foreground">
          {transactions.length} transactions
        </p>
        <div className="flex items-center gap-2">
          <ShadcnButton
            disabled={!hasPreviousPage}
            onClick={onPreviousPage}
            size="sm"
            variant="outline"
          >
            Previous
          </ShadcnButton>
          <ShadcnButton
            disabled={nextCursor === null}
            onClick={onNextPage}
            size="sm"
            variant="outline"
          >
            Next
          </ShadcnButton>
        </div>
      </div>
    </div>
  );
}

function TransactionSortButton({
  align,
  label,
  onSort,
  sort,
  sortBy,
}: {
  align?: "right";
  label: string;
  onSort: (sortBy: FinanceTransactionQuery["sortBy"]) => void;
  sort: {
    sortBy: FinanceTransactionQuery["sortBy"];
    sortDirection: FinanceTransactionQuery["sortDirection"];
  };
  sortBy: FinanceTransactionQuery["sortBy"];
}) {
  const isActive = sort.sortBy === sortBy;
  const Icon = !isActive ? ArrowUpDown : sort.sortDirection === "asc" ? ArrowUp : ArrowDown;
  return (
    <ShadcnButton
      aria-label={`Sort by ${label.toLowerCase()}`}
      className={align === "right" ? "ml-auto" : "-ml-2"}
      onClick={() => onSort(sortBy)}
      size="sm"
      variant="ghost"
    >
      {label}
      <Icon aria-hidden="true" data-icon="inline-end" />
    </ShadcnButton>
  );
}

function transactionTableColumnClass(columnId: string) {
  return {
    amount: "w-24 text-right",
    category: "w-24",
    date: "w-20",
    details: "w-20 text-right",
    merchant: "w-44",
  }[columnId];
}

function TransactionDetails({
  isCategorizing,
  onCategorize,
  transaction,
}: {
  isCategorizing: boolean;
  onCategorize: (transaction: FinanceTransaction) => void;
  transaction: FinanceTransaction;
}) {
  return (
    <dl className="grid gap-x-6 gap-y-3 py-1 text-sm sm:grid-cols-2 lg:grid-cols-4">
      <TransactionDetail label="Direction" value={directionLabel(transaction.direction)} />
      <TransactionDetail
        label="Confidence"
        value={formatConfidence(transaction.categoryConfidence)}
      />
      <TransactionDetail label="Source" value={transaction.categorySource ?? "Not categorized"} />
      <TransactionDetail
        label="Raw description"
        value={transaction.rawMerchant ?? transaction.merchant}
      />
      {transaction.notes ? <TransactionDetail label="Notes" value={transaction.notes} /> : null}
      {transaction.needsReview ? (
        <div className="flex items-end">
          <ShadcnButton
            disabled={isCategorizing}
            onClick={() => onCategorize(transaction)}
            size="sm"
          >
            Categorize
          </ShadcnButton>
        </div>
      ) : null}
    </dl>
  );
}

function TransactionDetail({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="font-mono text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 break-words" title={value}>
        {value}
      </dd>
    </div>
  );
}

function FinanceReviewItems({
  cases,
  isPending,
  onApprove,
  onCategorize,
  onConfirmTransfer,
  onDefer,
}: {
  cases: FinanceReviewCase[];
  isPending: boolean;
  onApprove: (review: FinanceReviewCase) => void;
  onCategorize: (review: FinanceReviewCase) => void;
  onConfirmTransfer: (review: FinanceReviewCase) => void;
  onDefer: (id: string) => void;
}) {
  if (cases.length === 0)
    return (
      <EmptyState icon={<CheckCircle2 />} title="Nothing needs your judgment">
        New uncertain transactions will appear here with the evidence behind each suggestion.
      </EmptyState>
    );
  return (
    <ShadcnItemGroup>
      {cases.map((review) => {
        const item = review.transaction;
        const isPossibleTransfer = review.reason === "possible_transfer";
        const canApprove =
          !isPossibleTransfer && item.categoryId !== null && item.category !== null;
        return (
          <ShadcnItem key={review.id} variant="outline">
            <ShadcnItemContent>
              <ShadcnItemTitle>{item.merchant}</ShadcnItemTitle>
              <ShadcnItemDescription>
                {item.rawMerchant && item.rawMerchant !== item.merchant
                  ? `${item.rawMerchant} · `
                  : ""}
                {review.reason.replaceAll("_", " ")}
                {review.rationale ? ` · ${review.rationale}` : ""}
              </ShadcnItemDescription>
            </ShadcnItemContent>
            <ShadcnItemActions>
              <span className="text-sm font-medium">{formatMoney(item.amount)}</span>
              {canApprove ? (
                <ShadcnButton disabled={isPending} onClick={() => onApprove(review)} size="sm">
                  Approve
                </ShadcnButton>
              ) : null}
              {isPossibleTransfer ? (
                <ShadcnButton
                  disabled={isPending}
                  onClick={() => onConfirmTransfer(review)}
                  size="sm"
                >
                  Confirm transfer
                </ShadcnButton>
              ) : null}
              <ShadcnButton
                disabled={isPending}
                onClick={() => onCategorize(review)}
                size="sm"
                variant="outline"
              >
                Change
              </ShadcnButton>
              <ShadcnButton
                disabled={isPending}
                onClick={() => onDefer(review.id)}
                size="sm"
                variant="ghost"
              >
                Set aside
              </ShadcnButton>
            </ShadcnItemActions>
          </ShadcnItem>
        );
      })}
    </ShadcnItemGroup>
  );
}

function FinanceTextField({
  id,
  inputMode,
  label,
  onChange,
  value,
}: {
  id: string;
  inputMode?: "decimal";
  label: string;
  onChange: (value: string) => void;
  value: string;
}) {
  return (
    <ShadcnField>
      <ShadcnFieldLabel htmlFor={id}>{label}</ShadcnFieldLabel>
      <ShadcnInput
        id={id}
        inputMode={inputMode}
        onChange={(event) => onChange(event.target.value)}
        value={value}
      />
    </ShadcnField>
  );
}

function downloadFinanceCsv(name: string, rows: Array<Record<string, unknown>>) {
  const columns = Array.from(new Set(rows.flatMap((row) => Object.keys(row))));
  const csvCell = (value: unknown) => {
    const raw = value === null || value === undefined ? "" : String(value);
    return /[",\n]/.test(raw) ? `"${raw.replaceAll('"', '""')}"` : raw;
  };
  const csv = [
    columns.join(","),
    ...rows.map((row) => columns.map((column) => csvCell(row[column])).join(",")),
  ].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const href = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = href;
  link.download = `personal-os-finances-${name}-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(href);
}

function accountKindLabel(kind: "cash" | "investment" | "debt" | "other") {
  return { cash: "Cash", debt: "Debt", investment: "Investment", other: "Other asset" }[kind];
}

function readSessionAccountScope(scope: "spend" | "cash" | "investments"): string[] | null {
  try {
    const value: unknown = JSON.parse(
      sessionStorage.getItem(`finance-account-scope:${scope}`) ?? "null",
    );
    return Array.isArray(value) && value.every((item) => typeof item === "string") ? value : null;
  } catch {
    return null;
  }
}

function formatTransactionDate(value: string) {
  return formatDateOnly(value, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function transactionCategoryLabel(category: string | null) {
  if (category === null) return "Uncategorized";
  const providerLabels: Record<string, string> = {
    FOOD_AND_DRINK: "Food & Drink",
    GENERAL_MERCHANDISE: "Shopping",
    TRANSFER_IN: "Transfers",
    TRANSFER_OUT: "Transfers",
  };
  if (providerLabels[category]) return providerLabels[category];
  return category
    .toLowerCase()
    .split(/[_-]+/)
    .map((word) => `${word.slice(0, 1).toUpperCase()}${word.slice(1)}`)
    .join(" ");
}

function directionLabel(direction: FinanceTransaction["direction"]) {
  return { expense: "Expense", income: "Income", transfer: "Transfer" }[direction];
}

function formatConfidence(confidence: number | null) {
  return confidence === null ? "—" : `${Math.round(confidence * 100)}%`;
}

function formatTransactionAmount(amount: number, direction: FinanceTransaction["direction"]) {
  const sign = direction === "income" ? "+" : direction === "transfer" ? "↔ " : "−";
  return `${sign}${formatMoney(amount)}`;
}

function transactionAmountTone(direction: FinanceTransaction["direction"]) {
  return direction === "income"
    ? "text-success"
    : direction === "expense"
      ? "text-destructive"
      : "text-muted-foreground";
}

function FinancePageSkeleton() {
  return <WorkspaceSkeleton kind="finances" />;
}
