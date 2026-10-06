import type {
  FinanceAccount,
  FinanceBudgetPacePeriod,
  FinanceBudgetStatus,
  FinanceForecast,
  FinanceLedgerHealth,
  FinancePlaybookResponse,
  FinanceRecurringObligation,
  FinanceReviewCase,
  FinanceStatus,
  FinanceTransaction,
  FinanceTransactionQuery,
  FinanceWealthSummary,
} from "@personal-os/domain";
import { addMonths, formatDateOnly, formatMonth } from "@personal-os/domain";
import { EmptyState, Spinner } from "@personal-os/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type ColumnDef, flexRender, getCoreRowModel, useReactTable } from "@tanstack/react-table";
import { Fragment, type ReactNode, useCallback, useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { ActionButton as ShadcnButton } from "@/components/action-button";
import { CurrencyInput } from "@/components/currency-input";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CircleCheckIcon,
  CircleHelpIcon,
  ClockIcon,
  DownloadIcon,
  MerchantIcon,
  ReceiptIcon,
  SortIcon,
} from "@/components/icons";
import {
  ResponsiveDialogBody as ImportBody,
  ResponsiveDialogContent as ImportContent,
  ResponsiveDialogDescription as ImportDescription,
  ResponsiveDialog as ImportDialog,
  ResponsiveDialogHeader as ImportHeader,
  ResponsiveDialogTitle as ImportTitle,
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/responsive-dialog";
import { Badge as ShadcnBadge } from "@/components/ui/badge";
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
  Collapsible as ShadcnCollapsible,
  CollapsibleContent as ShadcnCollapsibleContent,
  CollapsibleTrigger as ShadcnCollapsibleTrigger,
} from "@/components/ui/collapsible";
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
import { TooltipContent, TooltipTrigger, Tooltip as UiTooltip } from "@/components/ui/tooltip";
import { WorkspaceHeaderControls } from "@/components/workspace-header-controls";
import { api } from "../../api.js";
import { InlineError } from "../../components/async-state.js";
import { FeedbackForm } from "../../components/feedback-form.js";
import { MutationFeedback } from "../../components/mutation-feedback.js";
import { WorkspaceSkeleton } from "../../components/workspace-skeleton.js";
import { useFeedbackMutation } from "../../lib/use-feedback-mutation.js";
import { FinanceBudgetBucketManager } from "./bucket-manager.js";
import { FinanceCategoryDialog } from "./category-dialog";
import { AddTransactionContext } from "./contextual-question.js";
import { FinanceEntitySelector } from "./entity-selector";
import { useFinancePresentationParams } from "./presentation-preferences";
import { FinanceTransactionChecks } from "./transaction-checks";
import { groupTransactions } from "./transaction-groups";
import { TransactionContextEditor, TransactionContextMenu } from "./transaction-interactions";
import { FinanceTransactionItem } from "./transaction-item";

export { FinanceBudgetBucketManager } from "./bucket-manager.js";

import { BudgetPaceGraph } from "./budget-pace-graph.js";
import { formatMoney } from "./format.js";
import { financeSectionFromPath } from "./navigation.js";
import { PlaidConnectButton } from "./plaid-connect.js";
import { FinanceReimbursementList } from "./reimbursement-list.js";
import { FinanceAgentReviewQueue } from "./review-queue.js";
import { TransactionBreakdownDialog } from "./transaction-breakdown-dialog.js";
import { FinanceLinkedTransaction, FinanceTransactionControls } from "./transaction-controls.js";
import { financeTransactionFilters } from "./transaction-query.js";

export function FinancesPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const section =
    location.pathname === "/finances/budgets"
      ? "budgets"
      : financeSectionFromPath(location.pathname);
  const [categoryOpen, setCategoryOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(() =>
    new URLSearchParams(location.search).has("import"),
  );
  const transactionParams = new URLSearchParams(location.search);
  const transactionFilters = financeTransactionFilters(transactionParams);
  const linkedTransactionId = transactionParams.get("transactionId");
  const linkedReviewId = transactionParams.get("item") ?? undefined;
  const queryClient = useQueryClient();
  const currentMonth = new Date().toISOString().slice(0, 7);
  const [budgetMonth, setBudgetMonth] = useState(currentMonth);
  const [budgetPacePeriod, setBudgetPacePeriod] = useState<FinanceBudgetPacePeriod>("week");
  const [accountScopes, setAccountScopes] = useState<Record<string, string[]>>({});
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
  const financeStatus = useQuery({
    enabled: section === "overview",
    queryFn: () => api.getFinanceStatus(),
    queryKey: ["finance-status"],
  });
  const playbook = useQuery({
    enabled: section === "overview",
    queryFn: api.getFinancePlaybook,
    queryKey: ["finance-playbook"],
  });
  const ledgerHealth = useQuery({
    enabled: section === "transactions" || section === "overview",
    queryFn: api.getFinanceLedgerHealth,
    queryKey: ["finance-ledger-health"],
  });
  const incomeStreams = useQuery({
    enabled: section === "cashflow" || section === "overview",
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
  const merchants = useQuery({
    queryKey: ["finance-merchants"],
    queryFn: () => api.listFinanceMerchants(200),
    enabled: section === "transactions",
  });
  const categories = useQuery({
    queryFn: api.getFinanceCategories,
    queryKey: ["finance-categories"],
  });
  const reviewQueue = useQuery({
    enabled: section === "review",
    queryFn: () => api.getFinanceReviewQueue(50, linkedReviewId),
    queryKey: ["finance-review-queue", linkedReviewId],
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
  const showTransactionForm =
    section === "transactions" && location.hash === "#finance-add-transaction";
  const closeTransactionForm = () =>
    navigate({ pathname: location.pathname, search: location.search, hash: "" }, { replace: true });
  const [scopeDialog, setScopeDialog] = useState<"spend" | "cash" | "investments" | null>(null);
  const [learnMerchant, setLearnMerchant] = useState(false);
  const [categorizing, setCategorizing] = useState<{
    category: string;
    expectedTransactionUpdatedAt: string;
    id: string;
    merchant: string;
    nonTransferDirection?: "expense" | "income";
    possibleTransfer?: boolean;
    reviewId?: string;
    transaction: FinanceTransaction;
  } | null>(null);
  const [breakdownTransaction, setBreakdownTransaction] = useState<FinanceTransaction | null>(null);
  const [transactionCursor, setTransactionCursor] = useState<string | null>(null);
  const [transactionCursorHistory, setTransactionCursorHistory] = useState<Array<string | null>>(
    [],
  );
  const [transactionSort, setTransactionSort] = useState<{
    sortBy: FinanceTransactionQuery["sortBy"];
    sortDirection: FinanceTransactionQuery["sortDirection"];
  }>({ sortBy: "date", sortDirection: "desc" });
  const refresh = () =>
    queryClient.invalidateQueries({
      predicate: (query) =>
        String(query.queryKey[0]).startsWith("finance-") ||
        query.queryKey[0] === "agent-access-work-items",
    });
  const transactionList = useQuery({
    enabled: section === "transactions",
    queryFn: () =>
      api.listFinanceTransactions({
        ...transactionFilters,
        cursor: transactionCursor ?? undefined,
        limit: 50,
        sortBy: transactionSort.sortBy,
        sortDirection: transactionSort.sortDirection,
      }),
    queryKey: ["finance-transactions", transactionCursor, transactionSort, transactionFilters],
  });
  const syncAccount = useFeedbackMutation({
    feedback: { action: "sync this bank account", safeToRetry: true },
    mutationFn: (id: string) => api.syncFinanceAccount(id),
    onSuccess: refresh,
  });
  const addAccount = useFeedbackMutation({
    feedback: { action: "add this account", safeToRetry: false, form: true },
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
  const updateRecurring = useFeedbackMutation({
    feedback: { action: "update this recurring payment", safeToRetry: true, form: false },
    mutationFn: ({ id, status }: { id: string; status: "active" | "cancelled" | "paused" }) =>
      api.updateFinanceRecurringObligation(id, { status }),
    onSuccess: refresh,
  });
  const updateIncomeStream = useFeedbackMutation({
    feedback: { action: "update this income stream", safeToRetry: true, form: false },
    mutationFn: ({ id, status }: { id: string; status: "active" | "paused" }) =>
      api.updateFinanceIncomeStream(id, { status }),
    onSuccess: refresh,
  });
  const resolveAlert = useFeedbackMutation({
    feedback: { action: "update this financial alert", safeToRetry: true, form: false },
    mutationFn: ({ id, action }: { action: "dismiss" | "resolve"; id: string }) =>
      api.resolveFinanceAlert(id, { action, rationale: null }),
    onSuccess: refresh,
  });
  const refreshInsights = useFeedbackMutation({
    feedback: { action: "refresh financial insights", safeToRetry: true, form: false },
    mutationFn: api.refreshFinanceInsights,
    onSuccess: refresh,
  });
  const addTransaction = useFeedbackMutation({
    feedback: { action: "add this transaction", safeToRetry: false, form: true },
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
      closeTransactionForm();
      return refresh();
    },
  });
  const addBudget = useFeedbackMutation({
    feedback: { action: "save this budget", form: true, safeToRetry: false },
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
  const importHistory = useFeedbackMutation({
    feedback: { action: "import this history", form: true, safeToRetry: false },
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
  const categorize = useFeedbackMutation({
    feedback: { action: "save this category", form: true, safeToRetry: true },
    mutationFn: ({ id, value }: { id: string; value: string }) =>
      api.updateFinanceTransaction(id, { category: value }),
    onSuccess: refresh,
  });
  const resolveReview = useFeedbackMutation({
    feedback: { action: "save this transaction review", form: true, safeToRetry: true },
    mutationFn: ({
      action,
      categoryId,
      expectedTransactionUpdatedAt,
      id,
      learnMerchant,
      nonTransferDirection,
      rationale,
    }: {
      action: "approve" | "confirm_transfer" | "defer" | "recategorize";
      categoryId?: string;
      expectedTransactionUpdatedAt?: string;
      id: string;
      learnMerchant?: "always" | "never" | "suggest";
      nonTransferDirection?: "expense" | "income";
      rationale?: string;
    }) =>
      api.resolveFinanceReview(id, {
        action,
        categoryId,
        expectedTransactionUpdatedAt,
        learnMerchant: learnMerchant ?? "suggest",
        ...(nonTransferDirection ? { nonTransferDirection } : {}),
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
      transaction: item,
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
  if (overview.isError && !overview.data)
    return (
      <InlineError
        error={overview.error}
        title="Couldn’t load your finances."
        retry={() => overview.refetch()}
      />
    );
  if (!overview.data) return <FinancePageSkeleton />;
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
  return (
    <div
      className={`wide-page flex w-full max-w-6xl flex-col gap-5 pb-8${section === "budgets" ? " wide-page--compact" : ""}`}
    >
      {overview.isError ? (
        <InlineError
          error={overview.error}
          title="Couldn’t refresh your finances."
          stale
          retry={() => overview.refetch()}
        />
      ) : null}
      {incomeStreams.isError && ["cashflow", "profile", "overview"].includes(section) ? (
        <InlineError
          error={incomeStreams.error}
          title="Couldn’t load income streams."
          stale={Boolean(incomeStreams.data)}
          retry={() => incomeStreams.refetch()}
        />
      ) : null}
      {recurring.isError && ["cashflow", "subscriptions", "overview"].includes(section) ? (
        <InlineError
          error={recurring.error}
          title="Couldn’t load recurring payments."
          stale={Boolean(recurring.data)}
          retry={() => recurring.refetch()}
        />
      ) : null}
      {alerts.isError && ["cashflow", "overview"].includes(section) ? (
        <InlineError
          error={alerts.error}
          title="Couldn’t load financial alerts."
          stale={Boolean(alerts.data)}
          retry={() => alerts.refetch()}
        />
      ) : null}
      {forecast.isError && ["cashflow", "overview"].includes(section) ? (
        <InlineError
          error={forecast.error}
          title="Couldn’t load cash-flow forecast."
          stale={Boolean(forecast.data)}
          retry={() => forecast.refetch()}
        />
      ) : null}
      {budgetStatus.isError && section === "budgets" ? (
        <InlineError
          error={budgetStatus.error}
          title="Couldn’t load budget status."
          stale={Boolean(budgetStatus.data)}
          retry={() => budgetStatus.refetch()}
        />
      ) : null}
      {budgetPace.isError && ["overview"].includes(section) ? (
        <InlineError
          error={budgetPace.error}
          title="Couldn’t load budget pace."
          stale={Boolean(budgetPace.data)}
          retry={() => budgetPace.refetch()}
        />
      ) : null}
      {categories.isError ? (
        <InlineError
          error={categories.error}
          title="Couldn’t load categories."
          stale={Boolean(categories.data)}
          retry={() => categories.refetch()}
        />
      ) : null}
      {reviewQueue.isError && section === "review" ? (
        <InlineError
          error={reviewQueue.error}
          title="Couldn’t load transaction review queue."
          stale={Boolean(reviewQueue.data)}
          retry={() => reviewQueue.refetch()}
        />
      ) : null}
      {transactionList.isError && section === "transactions" ? (
        <InlineError
          error={transactionList.error}
          title="Couldn’t load transactions."
          stale={Boolean(transactionList.data)}
          retry={() => transactionList.refetch()}
        />
      ) : null}
      {wealth.isError && ["overview", "budgets"].includes(section) ? (
        <InlineError
          error={wealth.error}
          title="Couldn’t load wealth summary."
          stale={Boolean(wealth.data)}
          retry={() => wealth.refetch()}
        />
      ) : null}
      {scopedSpending.isError && section === "overview" ? (
        <InlineError
          error={scopedSpending.error}
          title="Couldn’t load account spending."
          stale={Boolean(scopedSpending.data)}
          retry={() => scopedSpending.refetch()}
        />
      ) : null}
      {section === "accounts" ? <MutationFeedback feedback={syncAccount.feedback} /> : null}
      {section === "cashflow" || section === "subscriptions" ? (
        <MutationFeedback feedback={updateRecurring.feedback} />
      ) : null}
      {section === "cashflow" ? <MutationFeedback feedback={updateIncomeStream.feedback} /> : null}
      {section === "cashflow" ? <MutationFeedback feedback={resolveAlert.feedback} /> : null}
      {section === "cashflow" ? <MutationFeedback feedback={refreshInsights.feedback} /> : null}
      {section === "review" && !categorizing ? (
        <MutationFeedback feedback={resolveReview.feedback} />
      ) : null}
      {section === "imports" ? (
        <WorkspaceHeaderControls label="Import controls">
          <ShadcnButton asChild size="icon" variant="ghost" title="Transactions">
            <Link to="/finances/transactions" aria-label="Transactions">
              <ReceiptIcon />
            </Link>
          </ShadcnButton>
        </WorkspaceHeaderControls>
      ) : null}
      {section === "transactions" ? (
        <FinanceTransactionControls
          onImport={() => setImportOpen(true)}
          onAddCategory={() => setCategoryOpen(true)}
          exportAction={<FinanceExportMenu />}
          accounts={finance.accounts}
          sort={`${transactionSort.sortBy}:${transactionSort.sortDirection}`}
          onSort={(value) => {
            const [sortBy, sortDirection] = value.split(":");
            setTransactionSort({
              sortBy: sortBy as FinanceTransactionQuery["sortBy"],
              sortDirection: sortDirection as FinanceTransactionQuery["sortDirection"],
            });
            setTransactionCursor(null);
            setTransactionCursorHistory([]);
          }}
          categories={categories.data ?? []}
        />
      ) : null}
      {categoryOpen ? <FinanceCategoryDialog onClose={() => setCategoryOpen(false)} /> : null}
      {section === "transactions" && linkedTransactionId ? (
        <FinanceLinkedTransaction
          id={linkedTransactionId}
          onBreakdown={setBreakdownTransaction}
          onCategorize={openCategorize}
        />
      ) : null}
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
      {section === "cashflow" &&
      ![alerts, forecast, recurring, incomeStreams].some(
        (query) => query.isError && query.data === undefined,
      ) ? (
        <div className="grid gap-6">
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
          <FinanceReimbursementList />
        </div>
      ) : null}
      {section === "subscriptions" && !(recurring.isError && !recurring.data) ? (
        <SubscriptionsPanel
          items={(recurring.data ?? []).filter((item) => item.kind === "subscription")}
          onUpdate={(id, status) => updateRecurring.mutate({ id, status })}
        />
      ) : null}
      {section === "overview" && wealth.data ? (
        <FinanceCurrentPosition
          cash={
            finance.accounts.some((account) => account.kind === "cash")
              ? scopedBalance("cash")
              : wealth.data.cash
          }
          onConfigureCash={() => setScopeDialog("cash")}
          onConfigureSpend={() => setScopeDialog("spend")}
          reviewCount={finance.reviewCount}
          spentThisMonth={spentThisMonth}
          wealth={wealth.data}
        />
      ) : null}
      {section === "overview" && financeStatus.data ? (
        <FinanceAtAGlance status={financeStatus.data} />
      ) : null}
      {section === "overview" && playbook.isError ? (
        <InlineError
          error={playbook.error}
          retry={() => playbook.refetch()}
          stale={playbook.data !== undefined}
        />
      ) : null}
      {section === "overview" ? <FinancePlaybookCard data={playbook.data} /> : null}
      {section === "overview" ? (
        <BudgetPaceGraph
          data={budgetPace.data}
          onPeriodChange={setBudgetPacePeriod}
          period={budgetPacePeriod}
        />
      ) : null}
      {section === "overview" && ledgerHealth.isError ? (
        <InlineError
          error={ledgerHealth.error}
          title="Couldn’t load account health."
          retry={() => ledgerHealth.refetch()}
          stale={Boolean(ledgerHealth.data)}
        />
      ) : null}
      {section === "overview" && ledgerHealth.data ? (
        <FinanceLedgerHealthDisclosure health={ledgerHealth.data} />
      ) : null}
      {section === "transactions" ? (
        <FinanceTransactionChecks
          health={ledgerHealth.data}
          error={ledgerHealth.isError}
          retry={() => void ledgerHealth.refetch()}
        />
      ) : null}
      {section === "review" && !location.pathname.endsWith("/legacy") ? (
        <FinanceAgentReviewQueue />
      ) : null}
      <section
        className={
          section === "budgets" ||
          section === "transactions" ||
          section === "health" ||
          section === "imports"
            ? "grid gap-6"
            : "grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]"
        }
        hidden={section === "overview" || section === "cashflow" || section === "subscriptions"}
      >
        <div className="flex min-w-0 flex-col gap-6">
          <TransactionSurface section={section}>
            {section === "review" ? (
              <ShadcnCardHeader>
                <ShadcnCardTitle>Review queue</ShadcnCardTitle>
                <ShadcnCardDescription>
                  Review only the categories the system cannot safely infer.
                </ShadcnCardDescription>
                <ShadcnCardAction>
                  <ShadcnButton
                    onClick={() => setReviewOnly((value) => !value)}
                    size="sm"
                    variant="outline"
                  >
                    {reviewOnly ? "View all" : "Review queue"}
                  </ShadcnButton>
                </ShadcnCardAction>
              </ShadcnCardHeader>
            ) : null}
            <div className={section === "review" ? "px-4 pb-4" : "min-w-0"}>
              {section === "transactions" && transactionList.isError && !transactionList.data
                ? null
                : null}
              {section === "transactions" ? (
                <FinanceTransactionsTable
                  hasPreviousPage={transactionCursorHistory.length > 0}
                  isCategorizing={categorize.isPending}
                  isLoading={transactionList.isPending}
                  nextCursor={transactionList.data?.nextCursor ?? null}
                  onBreakdown={setBreakdownTransaction}
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
                      ...(review.transaction.providerDirection
                        ? { nonTransferDirection: review.transaction.providerDirection }
                        : {}),
                      possibleTransfer: review.reason === "possible_transfer",
                      reviewId: review.id,
                      transaction: review.transaction,
                    });
                  }}
                  onConfirmTransfer={(review) =>
                    resolveReview.mutate({
                      action: "confirm_transfer",
                      expectedTransactionUpdatedAt: review.transaction.updatedAt,
                      id: review.id,
                    })
                  }
                  onDefer={(id) => resolveReview.mutate({ action: "defer", id })}
                />
              ) : section === "review" && linkedReviewId !== undefined ? (
                reviewQueue.isPending ? (
                  <p role="status">Loading requested review…</p>
                ) : reviewQueue.error ? null : (
                  <EmptyState icon={<CircleCheckIcon />} title="Requested review unavailable">
                    This item may have been resolved or may not belong to this account.
                  </EmptyState>
                )
              ) : visibleTransactions.length === 0 ? (
                <EmptyState
                  icon={<CircleCheckIcon />}
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
            </div>
          </TransactionSurface>
          <section aria-label={`${formatMonth(budgetMonth)} budget`} hidden={section !== "budgets"}>
            <FinanceBudgetBucketManager categories={categories.data ?? []} month={budgetMonth} />
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
              <EmptyState
                icon={<CircleHelpIcon />}
                title={`No budget for ${formatMonth(budgetMonth)}`}
              >
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
          <ImportDialog
            open={importOpen}
            onOpenChange={(open) => {
              if (importHistory.isPending) return;
              setImportOpen(open);
              if (!open && transactionParams.has("import")) {
                const next = new URLSearchParams(location.search);
                next.delete("import");
                navigate(
                  { pathname: location.pathname, search: next.toString() },
                  { replace: true },
                );
              }
            }}
          >
            <ImportContent>
              <ImportHeader>
                <ImportTitle>Import transactions</ImportTitle>
                <ImportDescription>
                  Upload a CSV exported from PayPal, Venmo, or Zelle. Duplicate rows are skipped.
                </ImportDescription>
              </ImportHeader>
              <ImportBody>
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
                  <MutationFeedback feedback={importHistory.feedback} />
                  {!importAccountId || !importCsv ? (
                    <p className="text-sm text-muted-foreground">
                      Choose an account and a CSV file to import.
                    </p>
                  ) : null}
                  {importHistory.data ? (
                    <ShadcnFieldDescription>
                      Imported {importHistory.data.imported}; skipped {importHistory.data.skipped}{" "}
                      duplicates.
                    </ShadcnFieldDescription>
                  ) : null}
                </ShadcnFieldGroup>
              </ImportBody>
            </ImportContent>
          </ImportDialog>
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
                    <ShadcnItem id={`account-${item.id}`} key={item.id} variant="outline">
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
                            disabled={syncAccount.isPending}
                            onClick={() => syncAccount.mutate(item.id)}
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
              <FeedbackForm
                feedback={addAccount.feedback}
                onSubmit={(event) => {
                  event.preventDefault();
                  addAccount.mutate();
                }}
              >
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
                      name="provider"
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
                      name="kind"
                      onChange={(event) =>
                        setAccountKind(
                          event.target.value as "cash" | "investment" | "debt" | "other",
                        )
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
                  <ShadcnButton disabled={addAccount.isPending} type="submit">
                    Add account
                  </ShadcnButton>
                </ShadcnFieldGroup>
              </FeedbackForm>
            </ShadcnCardContent>
          </ShadcnCard>
          <ResponsiveDialog
            open={showTransactionForm}
            onOpenChange={(open) => {
              if (!open) closeTransactionForm();
            }}
          >
            <ResponsiveDialogContent aria-describedby={undefined} className="overflow-y-auto">
              <ResponsiveDialogHeader>
                <ResponsiveDialogTitle>Add a transaction</ResponsiveDialogTitle>
              </ResponsiveDialogHeader>
              <div className="px-4 pb-4 sm:px-0 sm:pb-0">
                <FeedbackForm
                  feedback={addTransaction.feedback}
                  onSubmit={(event) => {
                    event.preventDefault();
                    addTransaction.mutate();
                  }}
                >
                  <ShadcnFieldGroup>
                    <ShadcnField>
                      <ShadcnFieldLabel htmlFor="finance-account-select">Account</ShadcnFieldLabel>
                      <ShadcnNativeSelect
                        id="finance-account-select"
                        name="accountId"
                        required
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
                    <ShadcnField>
                      <ShadcnFieldLabel htmlFor="finance-merchant">Merchant</ShadcnFieldLabel>
                      <FinanceEntitySelector
                        id="finance-merchant"
                        label="Merchant"
                        value={merchant}
                        onValueChange={setMerchant}
                        options={(merchants.data ?? []).map((item) => item.displayName)}
                        required
                      />
                    </ShadcnField>
                    <FinanceTextField
                      id="finance-amount"
                      inputMode="decimal"
                      label="Amount"
                      onChange={setAmount}
                      value={amount}
                    />
                    <ShadcnField>
                      <ShadcnFieldLabel htmlFor="finance-category">
                        Category (optional)
                      </ShadcnFieldLabel>
                      <FinanceEntitySelector
                        id="finance-category"
                        label="Category (optional)"
                        value={category}
                        onValueChange={setCategory}
                        options={(categories.data ?? []).map((item) => item.name)}
                      />
                    </ShadcnField>
                    <ShadcnButton disabled={addTransaction.isPending} type="submit">
                      Add transaction
                    </ShadcnButton>
                  </ShadcnFieldGroup>
                </FeedbackForm>
              </div>
            </ResponsiveDialogContent>
          </ResponsiveDialog>
          <ShadcnCard hidden={section !== "budgets" || !showBudgetForm}>
            <ShadcnCardHeader>
              <ShadcnCardTitle>Set a budget</ShadcnCardTitle>
            </ShadcnCardHeader>
            <ShadcnCardContent>
              <FeedbackForm
                feedback={addBudget.feedback}
                onSubmit={(event) => {
                  event.preventDefault();
                  addBudget.mutate();
                }}
              >
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
                  <ShadcnButton disabled={addBudget.isPending} type="submit">
                    Save budget
                  </ShadcnButton>
                </ShadcnFieldGroup>
              </FeedbackForm>
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
              {categorizing.possibleTransfer ? (
                <ShadcnField>
                  <ShadcnFieldLabel htmlFor="finance-non-transfer-direction">
                    Treat this transaction as
                  </ShadcnFieldLabel>
                  <ShadcnNativeSelect
                    id="finance-non-transfer-direction"
                    onChange={(event) =>
                      setCategorizing({
                        ...categorizing,
                        nonTransferDirection: event.target.value as "expense" | "income",
                      })
                    }
                    value={categorizing.nonTransferDirection ?? ""}
                  >
                    <NativeSelectOption value="">Choose income or expense</NativeSelectOption>
                    <NativeSelectOption value="expense">Expense</NativeSelectOption>
                    <NativeSelectOption value="income">Income</NativeSelectOption>
                  </ShadcnNativeSelect>
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
          <MutationFeedback
            feedback={categorizing?.reviewId ? resolveReview.feedback : categorize.feedback}
          />
          <ShadcnDialogFooter>
            {categorizing ? (
              <ShadcnButton
                onClick={() => {
                  setBreakdownTransaction(categorizing.transaction);
                  setCategorizing(null);
                }}
                variant="ghost"
              >
                Split purchase
              </ShadcnButton>
            ) : null}
            <ShadcnButton onClick={() => setCategorizing(null)} variant="outline">
              Cancel
            </ShadcnButton>
            <ShadcnButton
              disabled={
                categorize.isPending ||
                resolveReview.isPending ||
                !categorizing?.category.trim() ||
                (categorizing?.possibleTransfer === true &&
                  categorizing.nonTransferDirection === undefined) ||
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
                      ...(categorizing.nonTransferDirection
                        ? { nonTransferDirection: categorizing.nonTransferDirection }
                        : {}),
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
      <TransactionBreakdownDialog
        categories={categories.data ?? []}
        onOpenChange={(open) => !open && setBreakdownTransaction(null)}
        open={breakdownTransaction !== null}
        transaction={breakdownTransaction}
      />
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
    </div>
  );
}

function FinancePlaybookCard({ data }: { data: FinancePlaybookResponse | undefined }) {
  if (!data) return null;
  return (
    <ShadcnCard>
      <ShadcnCardHeader>
        <ShadcnCardTitle>Wealth-building priorities</ShadcnCardTitle>
        <ShadcnCardDescription>
          Approved Ilo Finance playbook {data.playbook.version} ·{" "}
          {data.assessment.readiness.replace("_", " ")}
        </ShadcnCardDescription>
      </ShadcnCardHeader>
      <ShadcnCardContent className="grid gap-3">
        <ol className="grid gap-2 text-sm">
          {data.playbook.steps.map((step) => (
            <li className="flex gap-3" key={step.id}>
              <span className="text-muted-foreground tabular-nums">{step.rank}.</span>
              <span>{step.title}</span>
            </li>
          ))}
        </ol>
        {data.assessment.blockers.length > 0 ? (
          <p className="text-muted-foreground text-sm">Next: {data.assessment.blockers[0]}</p>
        ) : null}
      </ShadcnCardContent>
    </ShadcnCard>
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

function FinanceCurrentPosition({
  cash,
  onConfigureCash,
  onConfigureSpend,
  reviewCount,
  spentThisMonth,
  wealth,
}: {
  cash: number;
  onConfigureCash: () => void;
  onConfigureSpend: () => void;
  reviewCount: number;
  spentThisMonth: number;
  wealth: FinanceWealthSummary;
}) {
  const reviewLabel = `Review ${reviewCount} ${reviewCount === 1 ? "decision" : "decisions"}`;
  const metrics = [
    { label: "Cash tracked", onClick: onConfigureCash, value: cash },
    { label: "Spent this month", onClick: onConfigureSpend, value: spentThisMonth },
    { label: "Net worth", value: wealth.netWorth },
  ];

  return (
    <section aria-label="Current financial position">
      <ShadcnCard>
        <ShadcnCardHeader>
          <ShadcnCardTitle>Financial position</ShadcnCardTitle>
          <ShadcnCardDescription>
            Current balances and posted activity for this month.
          </ShadcnCardDescription>
          <ShadcnCardAction>
            <div className="flex items-center gap-2">
              <ShadcnButton asChild size="sm" variant="outline">
                <Link to="/finances/accounts">Open accounts</Link>
              </ShadcnButton>
              {reviewCount > 0 ? (
                <ShadcnButton asChild size="sm">
                  <Link to="/finances/review">{reviewLabel}</Link>
                </ShadcnButton>
              ) : (
                <ShadcnBadge variant="secondary">Nothing to review</ShadcnBadge>
              )}
            </div>
          </ShadcnCardAction>
        </ShadcnCardHeader>
        <ShadcnCardContent className="grid gap-5 sm:grid-cols-3">
          {metrics.map((metric) => (
            <div className="flex min-w-0 flex-col gap-1" key={metric.label}>
              <span className="text-xs font-medium text-muted-foreground">{metric.label}</span>
              {metric.onClick ? (
                <ShadcnButton
                  aria-label={`${metric.label}: configure included accounts`}
                  className="h-auto w-fit justify-start p-0 text-2xl font-semibold tabular-nums"
                  onClick={metric.onClick}
                  variant="ghost"
                >
                  {formatMoney(metric.value)}
                </ShadcnButton>
              ) : (
                <strong className="text-2xl font-semibold tabular-nums">
                  {formatMoney(metric.value)}
                </strong>
              )}
            </div>
          ))}
        </ShadcnCardContent>
      </ShadcnCard>
    </section>
  );
}

function FinanceAtAGlance({ status }: { status: FinanceStatus }) {
  const latestReview = status.details.latestReview;
  return (
    <section aria-label="Finance at a glance" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <FinanceMetric
        detail={
          status.details.evidence.current
            ? "Sources are current"
            : "Refresh sources before relying on totals"
        }
        label="Personal spending"
        value={formatMoney(status.details.month.spending ?? 0)}
      />
      <FinanceMetric
        detail={status.details.cashFlow.projectedLowestBalanceDate ?? "No projected low date"}
        label="Projected low balance"
        value={formatMoney(status.details.cashFlow.projectedLowestBalance ?? 0)}
      />
      <FinanceMetric
        detail={`${status.details.reimbursements.open} open`}
        label="Expected back"
        value={formatMoney(status.details.reimbursements.outstanding)}
      />
      <ShadcnCard>
        <ShadcnCardHeader>
          <ShadcnCardTitle>Latest review</ShadcnCardTitle>
          <ShadcnCardDescription>
            {latestReview
              ? `Completed ${formatDateOnly(latestReview.completedAt.slice(0, 10), { day: "numeric", month: "short" })}`
              : "No completed period review yet."}
          </ShadcnCardDescription>
        </ShadcnCardHeader>
        {latestReview ? (
          <ShadcnCardContent>
            <ShadcnButton asChild size="sm" variant="outline">
              <Link to={`/finances/reviews/${latestReview.id}`}>Open review</Link>
            </ShadcnButton>
          </ShadcnCardContent>
        ) : null}
      </ShadcnCard>
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

export function BudgetMetricCard({
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
        <ChevronLeftIcon />
      </ShadcnButton>
      <span className="min-w-28 px-2 text-center text-sm font-medium tabular-nums">
        {formatMonth(month)}
      </span>
      <ShadcnButton aria-label="Next month" onClick={onNext} size="icon-sm" variant="ghost">
        <ChevronRightIcon />
      </ShadcnButton>
    </fieldset>
  );
}

function FinanceExportMenu() {
  return (
    <ShadcnDropdownMenu>
      <ShadcnDropdownMenuTrigger asChild>
        <ShadcnButton size="sm" variant="outline">
          <DownloadIcon data-icon="inline-start" />
          Export
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

export function FinanceBudgetAllocationChart({
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
      <EmptyState icon={<CircleHelpIcon />} title="No planned categories">
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

export function FinanceBudgetDetailDialog({
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

export function SubscriptionsPanel({
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
            <EmptyState icon={<CircleHelpIcon />} title="No subscriptions detected">
              We need at least three consistent charges to suggest a subscription.
            </EmptyState>
          )}
        </ShadcnItemGroup>
      </ShadcnCardContent>
    </ShadcnCard>
  );
}

function FinanceLedgerHealthDisclosure({ health }: { health: FinanceLedgerHealth }) {
  const affectedChecks = [
    health.unresolvedReviews,
    health.candidateTransfers,
    health.possibleDuplicates,
    health.pendingTransactions,
    health.staleAccounts,
    health.balanceOnlyAccounts,
    health.missingProvenance,
  ].filter((count) => count > 0).length;
  const checkLabel = `${affectedChecks} ledger ${affectedChecks === 1 ? "check" : "checks"}`;

  return (
    <ShadcnCollapsible asChild>
      <section aria-label="Ledger health" className="rounded-xl border px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <h2 className="text-sm font-medium">Ledger health</h2>
            <ShadcnBadge variant={affectedChecks > 0 ? "destructive" : "secondary"}>
              {affectedChecks > 0 ? `${affectedChecks} need attention` : "All checks clear"}
            </ShadcnBadge>
          </div>
          <ShadcnCollapsibleTrigger asChild>
            <ShadcnButton size="sm" variant="outline">
              Review {checkLabel}
            </ShadcnButton>
          </ShadcnCollapsibleTrigger>
        </div>
        <ShadcnCollapsibleContent className="pt-4">
          <FinanceLedgerHealthCard health={health} />
        </ShadcnCollapsibleContent>
      </section>
    </ShadcnCollapsible>
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
  onBreakdown,
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
  onBreakdown: (transaction: FinanceTransaction) => void;
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
  const presentation = useFinancePresentationParams();
  const view = presentation.get("view") === "cards" ? "cards" : "table";
  const group = view === "cards" ? presentation.get("group") : null;
  const groups = useMemo(() => groupTransactions(transactions, group), [transactions, group]);
  const groupedTransactions = useMemo(() => groups.flatMap((entry) => entry.items), [groups]);
  const groupHeadings = new Map(
    groups
      .filter((entry) => entry.label)
      .map((entry) => [
        entry.items[0]?.id,
        `${group === "date" ? formatTransactionDate(entry.label) : entry.label} (${entry.items.length})`,
      ]),
  );
  const [selectedTransaction, setSelectedTransaction] = useState<FinanceTransaction | null>(null);
  const [contextTransaction, setContextTransaction] = useState<FinanceTransaction | null>(null);
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
                <UiTooltip>
                  <TooltipTrigger asChild>
                    <span aria-label="Merchant entity found" role="img">
                      <MerchantIcon
                        aria-hidden="true"
                        className="shrink-0 text-muted-foreground"
                        data-icon="inline-start"
                      />
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>
                    Matched to a merchant record. Categories can still need review.
                  </TooltipContent>
                </UiTooltip>
              ) : (
                <span
                  aria-label="Merchant entity needs review"
                  role="img"
                  title="Merchant entity needs review"
                >
                  <CircleHelpIcon
                    aria-hidden="true"
                    className="shrink-0 text-muted-foreground"
                    data-icon="inline-start"
                  />
                </span>
              )}
              <div className="flex min-w-0 items-center gap-2">
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
        id: "status",
        header: "Status",
        enableSorting: false,
        cell: ({ row }) => (
          <UiTooltip>
            <TooltipTrigger asChild>
              <button type="button" aria-label={row.original.pending ? "Pending" : "Posted"}>
                {row.original.pending ? (
                  <ClockIcon aria-hidden="true" />
                ) : (
                  <CircleCheckIcon aria-hidden="true" />
                )}
              </button>
            </TooltipTrigger>
            <TooltipContent>
              {row.original.pending ? "Pending — not yet posted" : "Posted"}
            </TooltipContent>
          </UiTooltip>
        ),
      },
    ],
    [onSort, sort],
  );
  const table = useReactTable({
    columns,
    data: groupedTransactions,
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
      <EmptyState icon={<CircleCheckIcon />} title="No transactions yet">
        Add one manually now; connected providers will populate this ledger after sync.
      </EmptyState>
    );

  return (
    <div className="flex flex-col gap-3">
      {groupHeadings.size > 0 && (hasPreviousPage || nextCursor) ? (
        <p className="text-xs text-muted-foreground">Grouped within this page</p>
      ) : null}
      {view === "cards" ? (
        <ShadcnItemGroup className="gap-3">
          {groupedTransactions.map((transaction) => (
            <Fragment key={transaction.id}>
              {groupHeadings.has(transaction.id) ? (
                <h2 className="mt-3 text-sm font-medium">{groupHeadings.get(transaction.id)}</h2>
              ) : null}
              <TransactionContextMenu
                transaction={transaction}
                onSplit={() => onBreakdown(transaction)}
                onContext={() => setContextTransaction(transaction)}
                onCategorize={() => onCategorize(transaction)}
              >
                <li className="min-w-0 list-none">
                  <button
                    type="button"
                    className="w-full rounded-lg text-left outline-none focus-visible:[&_[data-slot=item]]:border-foreground/50"
                    aria-label={`Open ${transaction.merchant} transaction`}
                    onClick={() => setSelectedTransaction(transaction)}
                  >
                    <FinanceTransactionItem
                      presentation
                      title={transaction.merchant}
                      amount={transaction.amount}
                      direction={transaction.direction}
                      description={formatTransactionDate(transaction.date)}
                      category={transactionCategoryLabel(transaction.category)}
                      status={transaction.pending ? "pending" : undefined}
                    />
                  </button>
                </li>
              </TransactionContextMenu>
            </Fragment>
          ))}
        </ShadcnItemGroup>
      ) : (
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
            {table.getRowModel().rows.map((row) => (
              <TransactionContextMenu
                key={row.id}
                transaction={row.original}
                onSplit={() => onBreakdown(row.original)}
                onContext={() => setContextTransaction(row.original)}
                onCategorize={() => onCategorize(row.original)}
              >
                <ShadcnTableRow
                  tabIndex={0}
                  aria-label={`Open ${row.original.merchant} transaction`}
                  className="cursor-pointer focus-visible:bg-selection"
                  onClick={() => setSelectedTransaction(row.original)}
                  onKeyDown={(event) => {
                    if (
                      event.target === event.currentTarget &&
                      (event.key === "Enter" || event.key === " ")
                    ) {
                      event.preventDefault();
                      setSelectedTransaction(row.original);
                    }
                  }}
                >
                  {row.getVisibleCells().map((cell) => (
                    <ShadcnTableCell
                      className={transactionTableColumnClass(cell.column.id)}
                      key={cell.id}
                    >
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </ShadcnTableCell>
                  ))}
                </ShadcnTableRow>
              </TransactionContextMenu>
            ))}
          </ShadcnTableBody>
        </ShadcnTable>
      )}
      {selectedTransaction ? (
        <ResponsiveDialog open onOpenChange={(open) => !open && setSelectedTransaction(null)}>
          <ResponsiveDialogContent>
            <ResponsiveDialogHeader>
              <ResponsiveDialogTitle>{selectedTransaction.merchant}</ResponsiveDialogTitle>
            </ResponsiveDialogHeader>
            <ImportBody>
              <p
                className={`text-2xl font-semibold tabular-nums ${transactionAmountTone(selectedTransaction.direction)}`}
              >
                {formatTransactionAmount(selectedTransaction.amount, selectedTransaction.direction)}
              </p>
              <p className="text-sm text-muted-foreground">
                {formatTransactionDate(selectedTransaction.date)} ·{" "}
                {transactionCategoryLabel(selectedTransaction.category)} ·{" "}
                {selectedTransaction.pending ? "Pending" : "Posted"}
              </p>
              <TransactionDetails
                transaction={selectedTransaction}
                isCategorizing={isCategorizing}
                onBreakdown={onBreakdown}
                onCategorize={onCategorize}
                hideActions
              />
              <div className="flex flex-wrap gap-2">
                <ShadcnButton
                  variant="outline"
                  onClick={() => {
                    onBreakdown(selectedTransaction);
                    setSelectedTransaction(null);
                  }}
                >
                  Split purchase
                </ShadcnButton>
                <ShadcnButton
                  variant="outline"
                  onClick={() => {
                    setContextTransaction(selectedTransaction);
                    setSelectedTransaction(null);
                  }}
                >
                  {selectedTransaction.notes ? "Edit context" : "Add context"}
                </ShadcnButton>
                <ShadcnButton
                  variant="outline"
                  onClick={() => {
                    onCategorize(selectedTransaction);
                    setSelectedTransaction(null);
                  }}
                >
                  {selectedTransaction.category || selectedTransaction.categoryId
                    ? "Recategorize"
                    : "Categorize"}
                </ShadcnButton>
              </div>
            </ImportBody>
          </ResponsiveDialogContent>
        </ResponsiveDialog>
      ) : null}
      {contextTransaction ? (
        <TransactionContextEditor
          transaction={contextTransaction}
          onClose={() => setContextTransaction(null)}
        />
      ) : null}
      <div className="flex items-center justify-between gap-3 border-t pt-3">
        <p className="font-mono text-xs text-muted-foreground">
          {transactions.length} {transactions.length === 1 ? "transaction" : "transactions"}
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
  const Icon = !isActive ? SortIcon : sort.sortDirection === "asc" ? ArrowUpIcon : ArrowDownIcon;
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
    status: "w-16 text-center",
    merchant: "w-44",
  }[columnId];
}

export function TransactionDetails({
  canAddContext = false,
  hideActions = false,
  isCategorizing,
  onBreakdown,
  onCategorize,
  transaction,
}: {
  canAddContext?: boolean;
  hideActions?: boolean;
  isCategorizing: boolean;
  onBreakdown: (transaction: FinanceTransaction) => void;
  onCategorize: (transaction: FinanceTransaction) => void;
  transaction: FinanceTransaction;
}) {
  return (
    <dl className="grid min-w-0 gap-x-6 gap-y-3 py-2 text-sm [grid-template-columns:repeat(auto-fit,minmax(min(100%,9rem),1fr))]">
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
      {!hideActions ? (
        <div className="col-span-full flex min-w-0 flex-wrap items-end gap-2">
          <ShadcnButton onClick={() => onBreakdown(transaction)} size="sm" variant="outline">
            Split purchase
          </ShadcnButton>
          {canAddContext &&
          transaction.needsReview &&
          !transaction.pending &&
          !transaction.categoryId &&
          !transaction.category &&
          (transaction.direction === "expense" || transaction.direction === "income") ? (
            <AddTransactionContext key={transaction.id} transactionId={transaction.id} />
          ) : null}
          {transaction.needsReview ? (
            <ShadcnButton
              disabled={isCategorizing}
              onClick={() => onCategorize(transaction)}
              size="sm"
            >
              Categorize
            </ShadcnButton>
          ) : null}
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

export function FinanceReviewItems({
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
      <EmptyState icon={<CircleCheckIcon />} title="Nothing needs your judgment">
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
  const name =
    (
      {
        "finance-institution": "institution",
        "finance-account": "name",
        "finance-balance": "balance",
        "finance-merchant": "merchant",
        "finance-amount": "amount",
        "finance-category": "category",
        "finance-budget-category": "category",
        "finance-budget-limit": "limit",
      } as Record<string, string>
    )[id] ?? id;
  const required = [
    "finance-institution",
    "finance-account",
    "finance-merchant",
    "finance-amount",
    "finance-budget-category",
    "finance-budget-limit",
  ].includes(id);
  return (
    <ShadcnField>
      <ShadcnFieldLabel htmlFor={id}>{label}</ShadcnFieldLabel>
      {inputMode === "decimal" ? (
        <CurrencyInput
          id={id}
          name={name}
          required={required}
          value={value}
          min={id === "finance-balance" ? Number.NEGATIVE_INFINITY : 0.01}
          onValueChange={onChange}
        />
      ) : (
        <ShadcnInput
          id={id}
          name={name}
          required={required}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
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

function TransactionSurface({ section, children }: { section: string; children: ReactNode }) {
  if (section === "transactions") return <div className="min-w-0">{children}</div>;
  return (
    <ShadcnCard hidden={section !== "review"} className="min-w-0">
      {children}
    </ShadcnCard>
  );
}
