import { ApiClientError } from "@personal-os/api-client";
import { cashflowScheduleRange } from "@personal-os/domain";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { DateDisplay } from "@/components/date-display";
import {
  ArrowRightIcon,
  BankIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  InfoIcon,
  ReceiptIcon,
  WalletIcon,
} from "@/components/icons";
import { KeyMetric, KeyMetrics } from "@/components/key-metrics";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Item, ItemActions, ItemContent, ItemDescription, ItemTitle } from "@/components/ui/item";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Pagination, PaginationContent, PaginationItem } from "@/components/ui/pagination";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { api } from "../../api.js";
import { FinanceSection as OverviewSection } from "./finance-section";
import { formatCompactMoney } from "./format";
import { FinanceOverviewSettings } from "./overview-settings";
import {
  FinanceSourceState,
  financeAmount,
  financeObservedAt,
  requireFinanceResult,
} from "./position-material.js";

const maintenanceLabels = {
  queued: "Maintenance queued",
  running: "Processing transaction evidence",
  completed: "Maintenance complete",
  completed_with_questions: "Maintenance complete with questions",
  awaiting_agent_challenge: "Ledger challenge required",
  awaiting_approval: "Action approval required",
  blocked: "Maintenance blocked",
  failed_recoverable: "Maintenance needs recovery",
  failed_terminal: "Maintenance failed",
};

export function FinanceOverviewPage() {
  const me = useQuery({ queryKey: ["me"], queryFn: api.getMe });
  const snapshot = useQuery({
    queryKey: ["finance-snapshot"],
    queryFn: async () => requireFinanceResult(await api.getFinanceSnapshot()),
  });
  const budget = useQuery({
    queryKey: ["finance-budget-current"],
    queryFn: async () => requireFinanceResult(await api.getFinanceBudget()),
  });
  const status = useQuery({ queryKey: ["finance-status"], queryFn: () => api.getFinanceStatus() });
  const maintenance = useQuery({
    queryKey: ["finance-maintenance-history", 3],
    queryFn: () => api.getFinanceMaintenanceHistory({ limit: 3 }),
  });
  const plan = budget.data?.data;
  const latestReview = status.data?.details.latestReview;
  const latestMaintenance = maintenance.data?.items[0];
  const outstanding = status.data?.details.reimbursements.outstanding ?? 0;
  return (
    <div className="flex min-w-0 flex-col gap-8">
      <FinanceSourceState
        label="Financial position"
        query={snapshot}
        loading={
          <OverviewSection title="At a glance">
            <KeyMetrics label="Loading finance key metrics" layout="grid">
              {["cash", "spending", "worth"].map((key) => (
                <div key={key} className="finance-metric-skeleton">
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-7 w-28" />
                  <Skeleton className="h-3 w-full" />
                </div>
              ))}
            </KeyMetrics>
          </OverviewSection>
        }
      />
      {snapshot.data ? (
        <Collapsible>
          <OverviewSection
            title="At a glance"
            action={
              <Tooltip>
                <TooltipTrigger asChild>
                  <CollapsibleTrigger asChild>
                    <Button size="icon-sm" variant="ghost" aria-label="About these totals">
                      <InfoIcon className="size-4" />
                    </Button>
                  </CollapsibleTrigger>
                </TooltipTrigger>
                <TooltipContent>About these totals</TooltipContent>
              </Tooltip>
            }
          >
            <CollapsibleContent className="flex flex-col gap-2 px-2 text-xs text-muted-foreground">
              <p>
                {snapshot.data.data.ledger.trustworthy ? "Current evidence" : "Partial evidence"}
              </p>
              <p>
                As of {financeObservedAt(snapshot.data.data.asOf)} ·{" "}
                {snapshot.data.data.ledger.reconciledThrough
                  ? `Reconciled through ${snapshot.data.data.ledger.reconciledThrough}`
                  : "Reconciliation date unavailable"}
              </p>
              <p>
                Balances use recorded amounts from planning accounts and your ownership share.
                Spending opens this month without pending transactions. Its total can differ with
                account or date filters, pending transactions, and refund adjustments.
              </p>
              {snapshot.data.communication.requiredDisclosures.length ? (
                <ul className="list-disc pl-4">
                  {snapshot.data.communication.requiredDisclosures.map((disclosure) => (
                    <li key={disclosure.message}>{disclosure.message}</li>
                  ))}
                </ul>
              ) : null}
              <Link to="/finances/accounts" className="self-start underline underline-offset-4">
                Review accounts
              </Link>
            </CollapsibleContent>
            <KeyMetrics label="Finance key metrics" layout="grid">
              <KeyMetric
                compact
                to="/finances/spending?period=month&pending=0"
                label="Spent this month"
                value={
                  snapshot.data.data.budget.spent === null
                    ? "Unavailable"
                    : formatCompactMoney(snapshot.data.data.budget.spent)
                }
                exactValue={financeAmount(snapshot.data.data.budget.spent)}
                icon={ReceiptIcon}
                description="Posted personal expenses · no pending or transfers"
              />
              <KeyMetric
                compact
                to="/finances/accounts"
                label="Cash"
                value={
                  snapshot.data.data.cash === null
                    ? "Unavailable"
                    : formatCompactMoney(snapshot.data.data.cash)
                }
                exactValue={financeAmount(snapshot.data.data.cash)}
                icon={BankIcon}
                description="Recorded planning cash · your share"
              />
              <KeyMetric
                compact
                to="/finances/wealth"
                label="Net worth"
                value={
                  snapshot.data.data.netWorth === null
                    ? "Unavailable"
                    : formatCompactMoney(snapshot.data.data.netWorth)
                }
                exactValue={financeAmount(snapshot.data.data.netWorth)}
                icon={WalletIcon}
                description="Planning assets minus debt · your share"
              />
            </KeyMetrics>
          </OverviewSection>
        </Collapsible>
      ) : null}
      <OverviewUpcomingMoney />
      <OverviewSection title="Complete plan">
        <FinanceSourceState label="Complete plan" query={budget} />
        {plan ? (
          <Item variant="outline" className="flex-nowrap">
            <ItemContent>
              <ItemTitle>
                {plan.effectiveFrom}{" "}
                <Badge variant="secondary">{plan.status.replaceAll("_", " ")}</Badge>
              </ItemTitle>
              <ItemDescription>
                {financeAmount(plan.allocatedTotal)} allocated ·{" "}
                {financeAmount(plan.expectedResources - plan.allocatedTotal)} unassigned
              </ItemDescription>
            </ItemContent>
            <ItemActions>
              <Button asChild size="sm" variant="outline">
                <Link to="/finances/plan">View budget</Link>
              </Button>
            </ItemActions>
          </Item>
        ) : budget.isSuccess ? (
          <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
            <p className="text-muted-foreground">No plan yet.</p>
            <Button asChild size="sm" variant="outline">
              <Link to="/finances/plan">Create plan</Link>
            </Button>
          </div>
        ) : null}
      </OverviewSection>
      <FinanceSourceState label="Recent Finance context" query={status} />
      {outstanding > 0 ? (
        <Item variant="outline" className="flex-nowrap">
          <ItemContent>
            <ItemTitle>Outstanding reimbursements</ItemTitle>
            <ItemDescription>{financeAmount(outstanding)} expected back</ItemDescription>
          </ItemContent>
          <ItemActions>
            <Button asChild size="sm" variant="outline">
              <Link to="/finances/cashflow?view=reimbursements">View reimbursements</Link>
            </Button>
          </ItemActions>
        </Item>
      ) : null}
      <OverviewSection
        title="What changed"
        action={
          <Tooltip>
            <TooltipTrigger asChild>
              <Button asChild size="icon-sm" variant="ghost">
                <Link to="/finances/activity" aria-label="Open Activity">
                  <ArrowRightIcon className="size-4" />
                </Link>
              </Button>
            </TooltipTrigger>
            <TooltipContent>Open Activity</TooltipContent>
          </Tooltip>
        }
      >
        <FinanceSourceState label="Maintenance history" query={maintenance} />
        {latestReview || latestMaintenance ? (
          <div className="flex flex-col gap-2 text-sm">
            {latestReview ? (
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span>Period review · {latestReview.status.replaceAll("_", " ")}</span>
                <Link
                  className="text-muted-foreground underline underline-offset-4"
                  to={`/finances/reviews/${latestReview.id}`}
                >
                  {financeObservedAt(latestReview.completedAt)}
                </Link>
              </div>
            ) : null}
            {latestMaintenance ? (
              <p>
                {latestMaintenance.run
                  ? maintenanceLabels[latestMaintenance.run.status]
                  : "Maintenance recovery"}
              </p>
            ) : null}
          </div>
        ) : status.isSuccess && maintenance.isSuccess ? (
          <p className="text-sm text-muted-foreground">No recorded changes yet.</p>
        ) : null}
      </OverviewSection>
      {me.data && !accessDenied(me.error) ? <FinanceOverviewSettings key="view-settings" /> : null}
    </div>
  );
}

function accessDenied(error: unknown) {
  return error instanceof ApiClientError && [401, 403].includes(error.status);
}

function OverviewUpcomingMoney() {
  const me = useQuery({ queryKey: ["me"], queryFn: api.getMe });
  const [asOf] = useState(() => new Date().toISOString());
  const range = me.data?.planningTimezone
    ? cashflowScheduleRange(asOf, me.data.planningTimezone)
    : null;
  if (me.data?.planningTimezone && range && !accessDenied(me.error)) {
    return (
      <OwnerUpcomingMoney
        key={me.data.id}
        ownerId={me.data.id}
        timezone={me.data.planningTimezone}
        range={range}
      />
    );
  }
  return (
    <OverviewSection title="Coming next">
      <FinanceSourceState label="Planning context" query={me} />
      {accessDenied(me.error) ? (
        <p>Upcoming money access unavailable.</p>
      ) : me.data ? (
        <p>Set your planning timezone in Settings before viewing upcoming dates.</p>
      ) : null}
    </OverviewSection>
  );
}

function OwnerUpcomingMoney({
  ownerId,
  timezone,
  range,
}: {
  ownerId: string;
  timezone: string;
  range: ReturnType<typeof cashflowScheduleRange>;
}) {
  const navigate = useNavigate();
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(10);
  const upcoming = useQuery({
    queryKey: ["finance-recurring-occurrences", ownerId, timezone, range],
    queryFn: () => api.listFinanceRecurringOccurrences(range),
  });
  const denied = accessDenied(upcoming.error);
  const rows = denied
    ? []
    : (upcoming.data?.occurrences ?? [])
        .filter(
          (row) =>
            row.inCurrentSchedule && ["expected", "partially_matched"].includes(row.matchState),
        )
        .sort((a, b) => a.localDate.localeCompare(b.localDate) || a.key.localeCompare(b.key));
  const currentPage = Math.min(page, Math.max(0, Math.ceil(rows.length / pageSize) - 1));
  const start = currentPage * pageSize;
  const href = `/finances/cashflow?${new URLSearchParams({ cashflowFrom: range.from, cashflowTo: range.to, timeline: "agenda" })}`;
  const excluded = denied ? 0 : (upcoming.data?.unavailableSources.length ?? 0);
  return (
    <OverviewSection
      title="Coming next"
      action={
        <Tooltip>
          <TooltipTrigger asChild>
            <Button asChild size="icon-sm" variant="ghost">
              <Link to={href} aria-label="Open upcoming money">
                <ArrowRightIcon className="size-4" />
              </Link>
            </Button>
          </TooltipTrigger>
          <TooltipContent>Open upcoming money</TooltipContent>
        </Tooltip>
      }
      description={
        excluded
          ? `${excluded} recurring ${excluded === 1 ? "item is" : "items are"} not included yet. Confirm their dates and amounts in Cash flow to complete this list.`
          : undefined
      }
    >
      <FinanceSourceState
        label="Upcoming money"
        query={upcoming}
        loading={
          <div className="finance-upcoming-skeleton" aria-hidden="true">
            <div className="finance-upcoming-skeleton__table">
              {["header", "first", "second", "third", "fourth", "fifth", "sixth"].map((key) => (
                <div className="finance-upcoming-skeleton__row" key={key}>
                  <Skeleton />
                  <Skeleton />
                  <Skeleton />
                </div>
              ))}
            </div>
            <Skeleton className="h-8 w-full" />
          </div>
        }
      />
      {denied ? (
        <p>Upcoming money access unavailable.</p>
      ) : upcoming.data ? (
        rows.length ? (
          <div className="flex min-w-0 flex-col gap-3">
            <Card className="settings-panel min-w-0 gap-0 overflow-hidden py-0">
              <Table aria-label="Upcoming expected money" className="table-fixed">
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-28 px-4 sm:w-36">Expected date</TableHead>
                    <TableHead className="px-4">Item</TableHead>
                    <TableHead className="w-28 px-4 text-right whitespace-normal leading-tight sm:w-40">
                      Expected amount
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.slice(start, start + pageSize).map((row) => {
                    const destination = `/finances/cashflow?view=${row.source.kind === "income" ? "income" : "subscriptions"}&record=${encodeURIComponent(row.source.id)}`;
                    return (
                      <TableRow
                        key={row.key}
                        className="cursor-pointer"
                        onClick={(event) => {
                          if (
                            !(event.target as Element).closest("a, button") &&
                            !window.getSelection()?.toString()
                          )
                            navigate(destination);
                        }}
                      >
                        <TableCell className="px-4 py-2 text-muted-foreground">
                          <DateDisplay value={row.localDate} timeZone={timezone} />
                        </TableCell>
                        <TableCell className="px-4 py-2 whitespace-normal break-words">
                          <Link
                            to={destination}
                            className="rounded-sm hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground/50"
                          >
                            {row.displayName}
                          </Link>
                          {row.matchState === "partially_matched" ? (
                            <p className="text-xs text-muted-foreground">
                              Remaining after partial match
                            </p>
                          ) : null}
                        </TableCell>
                        <TableCell
                          className={`px-4 py-2 text-right font-medium tabular-nums ${row.remainingExpectedCents === null ? "text-muted-foreground" : row.source.kind === "income" ? "text-success" : "text-destructive"}`}
                        >
                          {row.remainingExpectedCents === null
                            ? "Amount varies"
                            : `${row.source.kind === "income" ? "+" : "−"}${new Intl.NumberFormat(
                                undefined,
                                {
                                  style: "currency",
                                  currency: row.currencyCode,
                                },
                              ).format(row.remainingExpectedCents / 100)}`}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </Card>
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 px-1 text-xs text-muted-foreground">
              <span className="text-xs">
                {start + 1}–{Math.min(start + pageSize, rows.length)} of {rows.length}
              </span>
              <div className="flex flex-wrap items-center gap-4">
                <label htmlFor="upcoming-page-size" className="flex items-center gap-2">
                  <span className="hidden sm:inline">Rows per page</span>
                  <NativeSelect
                    id="upcoming-page-size"
                    aria-label="Rows per page"
                    size="sm"
                    value={pageSize}
                    onChange={(event) => {
                      setPageSize(Number(event.target.value));
                      setPage(0);
                    }}
                  >
                    {[10, 25, 50].map((size) => (
                      <NativeSelectOption key={size} value={size}>
                        {size}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                </label>
                <Pagination aria-label="Upcoming money pagination" className="mx-0 w-auto">
                  <PaginationContent className="gap-2">
                    <PaginationItem>
                      <Button
                        size="icon-sm"
                        variant="outline"
                        aria-label="Previous page"
                        disabled={currentPage === 0}
                        onClick={() => setPage(currentPage - 1)}
                      >
                        <ChevronLeftIcon />
                      </Button>
                    </PaginationItem>
                    <PaginationItem>
                      <span className="px-1 text-xs">
                        Page {currentPage + 1} of {Math.ceil(rows.length / pageSize)}
                      </span>
                    </PaginationItem>
                    <PaginationItem>
                      <Button
                        size="icon-sm"
                        variant="outline"
                        aria-label="Next page"
                        disabled={start + pageSize >= rows.length}
                        onClick={() => setPage(currentPage + 1)}
                      >
                        <ChevronRightIcon />
                      </Button>
                    </PaginationItem>
                  </PaginationContent>
                </Pagination>
              </div>
            </div>
          </div>
        ) : (
          <p>
            {upcoming.data.unavailableSources.length
              ? "Upcoming money cannot be fully determined yet."
              : "No unmatched scheduled money in this date range."}
          </p>
        )
      ) : null}
    </OverviewSection>
  );
}
