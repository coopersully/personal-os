import type {
  FinanceAccount,
  FinanceCategory,
  FinancesWorkspacePreferences,
  FinanceTransaction,
} from "@personal-os/domain";
import { useQuery } from "@tanstack/react-query";
import { type ReactNode, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ActionButton as Button } from "@/components/action-button";
import { DateInput } from "@/components/date-input";
import {
  ChevronDownIcon,
  EyeIcon,
  GridIcon,
  LayersIcon,
  PlusIcon,
  ReceiptIcon,
  SliderHorizontalIcon,
  SortIcon,
  TagsIcon,
  UploadIcon,
} from "@/components/icons";
import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogContent,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogTrigger,
} from "@/components/responsive-dialog";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { WorkspaceHeaderControls } from "@/components/workspace-header-controls";
import { api } from "../../api.js";
import { InlineError } from "../../components/async-state.js";
import { formatMoney } from "./format.js";
import { requireFinanceResult } from "./position-material.js";
import {
  useFinancePresentationParams,
  useSaveFinancePresentation,
} from "./presentation-preferences";
import { transactionGroupingOptions } from "./transaction-groups";

export function FinanceTransactionControls({
  accounts,
  onImport,
  onAddCategory,
  exportAction,
  categories,
  sort,
  onSort,
}: {
  accounts: FinanceAccount[];
  onImport?: () => void;
  onAddCategory?: () => void;
  exportAction?: ReactNode;
  categories: FinanceCategory[];
  sort?: string;
  onSort?: (value: string) => void;
}) {
  const [params, setParams] = useSearchParams();
  const [filtersOpen, setFiltersOpen] = useState(false);
  const openingDialog = useRef(false);
  const legacyReview = params.get("review");
  const reviewState =
    params.get("reviewState") ??
    (["all", "resolved", "needs_review"].includes(legacyReview ?? "") ? legacyReview : "all");
  const activeFilters =
    ["search", "accountId", "categoryId", "from", "to", "pending"].filter((key) => params.get(key))
      .length + (reviewState && reviewState !== "all" ? 1 : 0);
  const presentation = useFinancePresentationParams();
  const savePresentation = useSaveFinancePresentation();
  const view = presentation.get("view") === "cards" ? "cards" : "table";
  const ViewIcon = view === "cards" ? GridIcon : ReceiptIcon;
  return (
    <>
      <WorkspaceHeaderControls label="Transaction view" placement="leading">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              aria-label={`Transaction view: ${view === "cards" ? "Cards" : "Table"}`}
            >
              <ViewIcon />
              <span>{view === "cards" ? "Cards" : "Table"}</span>
              <ChevronDownIcon />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuRadioGroup
              value={view}
              onValueChange={(value) => {
                savePresentation.mutate({
                  financeTransactionView:
                    value as FinancesWorkspacePreferences["financeTransactionView"],
                });
                setParams((current) => {
                  const next = new URLSearchParams(current);
                  next.set("view", value);
                  return next;
                });
              }}
            >
              <DropdownMenuRadioItem value="table">
                <ReceiptIcon />
                Table
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="cards">
                <GridIcon />
                Cards
              </DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </WorkspaceHeaderControls>
      <WorkspaceHeaderControls label="Transaction controls">
        <ResponsiveDialog open={filtersOpen} onOpenChange={setFiltersOpen}>
          <ResponsiveDialogTrigger asChild>
            <Button
              size="icon"
              variant="ghost"
              aria-label={activeFilters ? `Filters (${activeFilters} active)` : "Filters"}
              badgeCount={activeFilters}
            >
              <SliderHorizontalIcon />
              {activeFilters ? <span className="sr-only">{activeFilters} active</span> : null}
            </Button>
          </ResponsiveDialogTrigger>
          <ResponsiveDialogContent>
            <ResponsiveDialogHeader>
              <ResponsiveDialogTitle>Filter transactions</ResponsiveDialogTitle>
            </ResponsiveDialogHeader>
            <form
              className="flex min-h-0 flex-col overflow-hidden"
              aria-label="Filter transactions"
              key={params.toString()}
              onSubmit={(event) => {
                event.preventDefault();
                const form = new FormData(event.currentTarget);
                const next = new URLSearchParams(params);
                for (const key of [
                  "search",
                  "accountId",
                  "categoryId",
                  "from",
                  "to",
                  "pending",
                  "reviewState",
                ]) {
                  const value = String(form.get(key) ?? "").trim();
                  if (value) next.set(key, value);
                  else next.delete(key);
                }
                if (["all", "resolved", "needs_review"].includes(next.get("review") ?? ""))
                  next.delete("review");
                next.delete("transactionId");
                setParams(next);
                setFiltersOpen(false);
              }}
            >
              <ResponsiveDialogBody>
                <FieldGroup className="mb-5">
                  <Field>
                    <FieldLabel htmlFor="transaction-search">Search</FieldLabel>
                    <Input
                      id="transaction-search"
                      name="search"
                      maxLength={160}
                      defaultValue={params.get("search") ?? ""}
                      placeholder="Merchant or notes"
                    />
                  </Field>
                </FieldGroup>
                <FieldGroup className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  <Field>
                    <FieldLabel htmlFor="transaction-account">Account</FieldLabel>
                    <NativeSelect
                      id="transaction-account"
                      name="accountId"
                      defaultValue={params.get("accountId") ?? ""}
                    >
                      <NativeSelectOption value="">All accounts</NativeSelectOption>
                      {accounts.map((account) => (
                        <NativeSelectOption key={account.id} value={account.id}>
                          {account.name}
                        </NativeSelectOption>
                      ))}
                    </NativeSelect>
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="transaction-category">Category</FieldLabel>
                    <NativeSelect
                      id="transaction-category"
                      name="categoryId"
                      defaultValue={params.get("categoryId") ?? ""}
                    >
                      <NativeSelectOption value="">All categories</NativeSelectOption>
                      {categories.map((category) => (
                        <NativeSelectOption key={category.id} value={category.id}>
                          {category.name}
                        </NativeSelectOption>
                      ))}
                    </NativeSelect>
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="transaction-review">Review</FieldLabel>
                    <NativeSelect
                      id="transaction-review"
                      name="reviewState"
                      defaultValue={reviewState ?? "all"}
                    >
                      <NativeSelectOption value="all">All review states</NativeSelectOption>
                      <NativeSelectOption value="needs_review">Needs review</NativeSelectOption>
                      <NativeSelectOption value="resolved">Reviewed</NativeSelectOption>
                    </NativeSelect>
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="transaction-from">From</FieldLabel>
                    <TransactionDate
                      id="transaction-from"
                      name="from"
                      initialValue={params.get("from") ?? ""}
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="transaction-to">Through</FieldLabel>
                    <TransactionDate
                      id="transaction-to"
                      name="to"
                      initialValue={params.get("to") ?? ""}
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="transaction-posted">Posting state</FieldLabel>
                    <NativeSelect
                      id="transaction-posted"
                      name="pending"
                      defaultValue={params.get("pending") ?? ""}
                    >
                      <NativeSelectOption value="">Pending and posted</NativeSelectOption>
                      <NativeSelectOption value="pending">Pending</NativeSelectOption>
                      <NativeSelectOption value="posted">Posted</NativeSelectOption>
                    </NativeSelect>
                  </Field>
                </FieldGroup>
              </ResponsiveDialogBody>
              <ResponsiveDialogFooter className="flex-row justify-end">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    const next = new URLSearchParams(params);
                    for (const key of [
                      "search",
                      "accountId",
                      "categoryId",
                      "from",
                      "to",
                      "pending",
                      "reviewState",
                      "transactionId",
                    ])
                      next.delete(key);
                    if (["all", "resolved", "needs_review"].includes(next.get("review") ?? ""))
                      next.delete("review");
                    setParams(next);
                    setFiltersOpen(false);
                  }}
                >
                  Clear filters
                </Button>
                <Button type="submit">Apply filters</Button>
              </ResponsiveDialogFooter>
            </form>
          </ResponsiveDialogContent>
        </ResponsiveDialog>
        {onSort ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="icon" variant="ghost" aria-label="Sort transactions">
                <SortIcon />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuRadioGroup value={sort ?? "date:desc"} onValueChange={onSort}>
                {(
                  [
                    ["date:desc", "Newest first"],
                    ["date:asc", "Oldest first"],
                    ["amount:desc", "Highest amount"],
                    ["amount:asc", "Lowest amount"],
                    ["merchant:asc", "Merchant A–Z"],
                    ["merchant:desc", "Merchant Z–A"],
                  ] as const
                ).map(([value, label]) => (
                  <DropdownMenuRadioItem key={value} value={value}>
                    {label}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
        {view === "cards" ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="icon" variant="ghost" aria-label="Display transactions">
                <EyeIcon />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Group by</DropdownMenuLabel>
              <DropdownMenuRadioGroup
                value={presentation.get("group") ?? "none"}
                onValueChange={(value) => {
                  savePresentation.mutate({
                    financeTransactionGroup:
                      value as FinancesWorkspacePreferences["financeTransactionGroup"],
                  });
                  setParams((current) => {
                    const next = new URLSearchParams(current);
                    next.set("group", value);
                    return next;
                  });
                }}
              >
                {transactionGroupingOptions.map(([value, label]) => (
                  <DropdownMenuRadioItem key={value} value={value}>
                    <LayersIcon />
                    {label}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
        {exportAction}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="icon" aria-label="Add in Transactions">
              <PlusIcon />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            onCloseAutoFocus={(event) => {
              if (openingDialog.current) event.preventDefault();
              openingDialog.current = false;
            }}
          >
            <DropdownMenuItem
              asChild
              onSelect={() => {
                openingDialog.current = true;
              }}
            >
              <Link
                to={{
                  pathname: "/finances/transactions",
                  search: `?${params}`,
                  hash: "finance-add-transaction",
                }}
              >
                <PlusIcon />
                Add transaction
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => {
                openingDialog.current = true;
                onAddCategory?.();
              }}
            >
              <TagsIcon />
              Add category
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => {
                openingDialog.current = true;
                onImport?.();
              }}
            >
              <UploadIcon />
              Import transactions
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </WorkspaceHeaderControls>
    </>
  );
}

function TransactionDate({
  id,
  name,
  initialValue,
}: {
  id: string;
  name: string;
  initialValue: string;
}) {
  const [value, setValue] = useState(initialValue);
  return <DateInput id={id} name={name} value={value} onValueChange={setValue} />;
}

export function FinanceLinkedTransaction({
  id,
  onBreakdown,
  onCategorize,
}: {
  id: string;
  onBreakdown: (transaction: FinanceTransaction) => void;
  onCategorize: (transaction: FinanceTransaction) => void;
}) {
  const transaction = useQuery({
    queryKey: ["finance-transaction", id],
    queryFn: async () => requireFinanceResult(await api.getFinanceTransaction(id)),
  });
  if (transaction.isPending) return <p role="status">Loading source transaction…</p>;
  if (transaction.isError && !transaction.data)
    return (
      <div>
        <InlineError
          error={transaction.error}
          retry={() => transaction.refetch()}
          stale={transaction.data !== undefined}
        />
        <Button variant="outline" onClick={() => void transaction.refetch()}>
          Retry
        </Button>
      </div>
    );
  if (!transaction.data) return null;
  const item = transaction.data.data;
  return (
    <section aria-label="Source transaction" className="rounded-lg border p-4">
      {transaction.isError ? (
        <InlineError error={transaction.error} retry={() => transaction.refetch()} stale />
      ) : null}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm text-muted-foreground">Source transaction</p>
          <h2 className="font-medium">{item.merchant}</h2>
          <p>
            {formatMoney(item.amount)} · {item.date}
          </p>
        </div>
        <Badge variant="secondary">{item.pending ? "Pending" : "Posted"}</Badge>
      </div>
      <dl className="my-4 grid grid-cols-2 gap-3 text-sm">
        <div>
          <dt className="text-muted-foreground">Category</dt>
          <dd>{item.category ?? "Uncategorized"}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Direction</dt>
          <dd>{item.direction}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Evidence</dt>
          <dd>{item.categoryRationale ?? "No categorization rationale recorded."}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Notes</dt>
          <dd>{item.notes ?? "None"}</dd>
        </div>
      </dl>
      {item.rawMerchant && item.rawMerchant !== item.merchant ? (
        <p className="mb-3 text-sm text-muted-foreground">Reported merchant: {item.rawMerchant}</p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={() => onCategorize(item)}>
          Categorize
        </Button>
        <Button variant="outline" size="sm" onClick={() => onBreakdown(item)}>
          View breakdown
        </Button>
        <Button asChild variant="ghost" size="sm">
          <Link to="/finances/review">Back to review</Link>
        </Button>
      </div>
    </section>
  );
}
