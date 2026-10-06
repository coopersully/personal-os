import type {
  FinanceIncomeStream,
  FinanceRecurringObligation,
  ManageFinanceRecurringItemInput,
} from "@personal-os/domain";
import { formatDateOnly } from "@personal-os/domain";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { ChevronDownIcon, DollarIcon } from "@/components/icons";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
} from "@/components/ui/item";
import { Skeleton } from "@/components/ui/skeleton";
import { WorkspaceHeaderControls } from "@/components/workspace-header-controls";
import { api } from "../../api.js";
import { InlineError } from "../../components/async-state.js";
import { MutationFeedback } from "../../components/mutation-feedback.js";
import { useFeedbackMutation } from "../../lib/use-feedback-mutation.js";
import { formatMoney } from "./format";
import { FinanceSourceState, requireFinanceResult } from "./position-material.js";
import { FinanceReimbursementList } from "./reimbursement-list";
import { FinanceScenarioComparison } from "./scenario-comparison.js";

const cashflowViews = [
  { value: "outlook", label: "Outlook" },
  { value: "income", label: "Income" },
  { value: "subscriptions", label: "Bills & subscriptions" },
  { value: "reimbursements", label: "Reimbursements" },
  { value: "scenarios", label: "Scenarios" },
];
const date = (value: string) =>
  formatDateOnly(value, { month: "short", day: "numeric", year: "numeric" });
const cadence: Record<string, string> = {
  biweekly: "Every two weeks",
  semimonthly: "Twice a month",
  weekly: "Weekly",
  monthly: "Monthly",
  quarterly: "Quarterly",
  yearly: "Yearly",
  irregular: "Variable",
};

export function FinanceCashflowPage() {
  const client = useQueryClient();
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const requested =
    params.get("view") ??
    (location.pathname.endsWith("subscriptions") ? "subscriptions" : "outlook");
  const view = ["outlook", "income", "subscriptions", "reimbursements", "scenarios"].includes(
    requested,
  )
    ? requested
    : "outlook";
  const snapshot = useQuery({
    queryKey: ["finance-snapshot"],
    queryFn: async () => requireFinanceResult(await api.getFinanceSnapshot()),
  });
  const forecast = useQuery({ queryKey: ["finance-forecast"], queryFn: api.getFinanceForecast });
  const recurring = useQuery({
    queryKey: ["finance-recurring-items"],
    queryFn: async () => requireFinanceResult(await api.listFinanceRecurringItems()),
  });
  const accounts = useQuery({
    queryKey: ["finance-accounts"],
    queryFn: () => api.listFinanceAccounts(),
  });
  const refresh = () =>
    client.invalidateQueries({
      predicate: (query) => String(query.queryKey[0]).startsWith("finance-"),
    });
  const update = useFeedbackMutation({
    feedback: { action: "save this recurring payment", safeToRetry: false, form: true },
    mutationFn: async (input: ManageFinanceRecurringItemInput) =>
      requireFinanceResult(await api.manageFinanceRecurringItem(input)),
    onSuccess: refresh,
  });
  const income = recurring.data?.data.income ?? [];
  const obligations = recurring.data?.data.obligations ?? [];
  // The compatibility forecast includes every cash balance and active pattern at full value.
  // A trustworthy ledger alone cannot make it honor excluded accounts or shared ownership.
  const patternAccountIds = new Set(
    [...income, ...obligations].flatMap((item) =>
      item.status === "active" && item.accountId ? [item.accountId] : [],
    ),
  );
  const supportedScope =
    accounts.isSuccess &&
    recurring.isSuccess &&
    accounts.data.accounts.every(
      (account) =>
        (account.kind !== "cash" && !patternAccountIds.has(account.id)) ||
        (account.includeInPlanning &&
          account.ownershipType === "individual" &&
          account.ownershipShare === 1),
    ) &&
    [...patternAccountIds].every((id) =>
      accounts.data.accounts.some((account) => account.id === id),
    );
  const unsupportedScope = accounts.isSuccess && recurring.isSuccess && !supportedScope;
  const usable =
    snapshot.isSuccess &&
    snapshot.data.data.ledger.trustworthy &&
    forecast.isSuccess &&
    supportedScope;
  const nextEvents = [
    ...income
      .filter((item) => item.status === "active" && item.nextExpectedDate)
      .map((item) => ({ ...item, type: "income" as const })),
    ...obligations
      .filter((item) => item.status === "active" && item.nextExpectedDate)
      .map((item) => ({ ...item, type: "obligation" as const })),
  ].sort((a, b) => (a.nextExpectedDate ?? "").localeCompare(b.nextExpectedDate ?? ""));
  const change = (
    item: FinanceIncomeStream | FinanceRecurringObligation,
    itemType: "income" | "obligation",
  ) =>
    update.mutate({
      itemId: item.id,
      itemType,
      operation: item.status === "active" ? "pause" : "resume",
      idempotencyKey: crypto.randomUUID(),
    });
  const patternRows = (
    items: Array<FinanceIncomeStream | FinanceRecurringObligation>,
    itemType: "income" | "obligation",
  ) => (
    <ItemGroup>
      {items.map((item) => (
        <Item key={item.id}>
          <ItemContent>
            <ItemTitle>{item.displayName}</ItemTitle>
            <ItemDescription>
              {formatMoney(item.expectedAmount)} · {cadence[item.cadence] ?? item.cadence}
              {item.nextExpectedDate
                ? ` · Next ${date(item.nextExpectedDate)}`
                : " · Date not established"}
            </ItemDescription>
          </ItemContent>
          <ItemActions className="flex-wrap">
            <Badge variant="secondary">
              {item.status === "needs_review"
                ? "Needs confirmation"
                : item.status === "active"
                  ? "Included in forecast"
                  : "Inactive"}
            </Badge>
            <Button
              size="sm"
              variant="outline"
              disabled={update.isPending}
              aria-label={`${item.status === "active" ? "Pause" : item.status === "needs_review" ? "Confirm" : "Resume"} ${item.displayName}`}
              onClick={() => change(item, itemType)}
            >
              {item.status === "active"
                ? "Pause"
                : item.status === "needs_review"
                  ? "Confirm"
                  : "Resume"}
            </Button>
          </ItemActions>
        </Item>
      ))}
    </ItemGroup>
  );
  return (
    <div className="wide-page flex min-w-0 w-full max-w-6xl flex-col gap-6 pb-8">
      <div className="flex flex-col gap-4">
        <WorkspaceHeaderControls label="Cash flow views" placement="leading">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" aria-label="Cash flow view" className="max-w-48">
                <DollarIcon data-icon="inline-start" />
                <span className="truncate">
                  {cashflowViews.find((item) => item.value === view)?.label}
                </span>
                <ChevronDownIcon data-icon="inline-end" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuRadioGroup
                value={view}
                onValueChange={(value) => {
                  const next = new URLSearchParams(params);
                  next.set("view", value);
                  setParams(next);
                }}
              >
                {cashflowViews.map((item) => (
                  <DropdownMenuRadioItem key={item.value} value={item.value}>
                    {item.label}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </WorkspaceHeaderControls>
        {update.isError ? <MutationFeedback feedback={update.feedback} /> : null}
        {recurring.isError ? (
          <Alert variant="destructive">
            <AlertTitle>
              {recurring.data
                ? "Recurring activity may be out of date"
                : "Recurring activity unavailable"}
            </AlertTitle>
            <AlertDescription>
              <p>{"Couldn’t refresh this information. Try again."}</p>
              <Button size="sm" variant="outline" onClick={() => void recurring.refetch()}>
                Retry recurring activity
              </Button>
            </AlertDescription>
          </Alert>
        ) : null}
        {view === "scenarios" ? (
          <Card aria-label="Scenarios">
            <CardHeader>
              <CardTitle>Scenarios</CardTitle>
            </CardHeader>
            <CardContent>
              <FinanceScenarioComparison />
            </CardContent>
          </Card>
        ) : null}
        {view === "outlook" ? (
          <section aria-label="Outlook" className="finance-bento">
            <section aria-label="Cash outlook" className="finance-bento__wide">
              <Card>
                <CardHeader>
                  <CardTitle>Money coming in and going out</CardTitle>
                  <CardDescription>
                    {forecast.data
                      ? `Forecast as of ${date(forecast.data.asOf.slice(0, 10))}`
                      : "Your next income and commitments"}
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-5">
                  {snapshot.isPending ||
                  forecast.isPending ||
                  accounts.isPending ||
                  recurring.isPending ? (
                    <Skeleton className="h-20 w-full" />
                  ) : (
                    <dl className="grid gap-5 sm:grid-cols-3">
                      <div>
                        <dt className="text-sm text-muted-foreground">Projected low balance</dt>
                        <dd className="text-2xl font-semibold tabular-nums">
                          {usable
                            ? formatMoney(forecast.data.lowestProjectedBalance)
                            : "Unavailable"}
                        </dd>
                        {usable && forecast.data.lowestProjectedDate ? (
                          <p className="text-sm text-muted-foreground">
                            {date(forecast.data.lowestProjectedDate)}
                          </p>
                        ) : null}
                      </div>
                      <div>
                        <dt className="text-sm text-muted-foreground">Expected income</dt>
                        <dd className="text-2xl font-semibold tabular-nums">
                          {usable ? formatMoney(forecast.data.upcomingIncome) : "Unavailable"}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-sm text-muted-foreground">Upcoming obligations</dt>
                        <dd className="text-2xl font-semibold tabular-nums">
                          {usable ? formatMoney(forecast.data.upcomingObligations) : "Unavailable"}
                        </dd>
                      </div>
                    </dl>
                  )}
                  {snapshot.isError ? (
                    <InlineError
                      error={snapshot.error}
                      retry={() => snapshot.refetch()}
                      stale={snapshot.data !== undefined}
                    />
                  ) : null}
                  {forecast.isError ? (
                    <InlineError
                      error={forecast.error}
                      retry={() => forecast.refetch()}
                      stale={forecast.data !== undefined}
                    />
                  ) : null}
                  {accounts.isError ? (
                    <FinanceSourceState label="Forecast account scope" query={accounts} />
                  ) : null}
                  {unsupportedScope ? (
                    <Alert>
                      <AlertTitle>Forecast unavailable for this account scope</AlertTitle>
                      <AlertDescription>
                        <p>
                          The available forecast uses full cash balances and recurring amounts. It
                          cannot account for excluded or shared accounts, or a pattern whose source
                          account is unavailable.
                        </p>
                        <Link className="underline" to="/finances/accounts">
                          Inspect account scope
                        </Link>
                      </AlertDescription>
                    </Alert>
                  ) : null}
                  {snapshot.isSuccess && !snapshot.data.data.ledger.trustworthy ? (
                    <Alert>
                      <AlertTitle>Complete the evidence before relying on a forecast</AlertTitle>
                      <AlertDescription>
                        <p>
                          {snapshot.data.communication.requiredDisclosures[0]?.message ??
                            "Account ownership and ledger activity need review."}
                        </p>
                        <Link className="underline" to="/finances/accounts">
                          Review accounts
                        </Link>
                      </AlertDescription>
                    </Alert>
                  ) : null}
                  <p className="text-sm text-muted-foreground">
                    Projected balances use known income and obligations. Reserved money and
                    unconfirmed payments may limit what is available to spend.
                  </p>
                </CardContent>
              </Card>
            </section>
            <section aria-labelledby="cashflow-upcoming" className="finance-bento__wide">
              <Card>
                <CardContent className="flex flex-col gap-3">
                  <h2 id="cashflow-upcoming" className="text-lg font-semibold">
                    Next expected activity
                  </h2>
                  {recurring.isPending ? (
                    <Skeleton className="h-28 w-full" />
                  ) : nextEvents.length ? (
                    <ItemGroup>
                      {nextEvents.map((item) => (
                        <Item key={`${item.type}-${item.id}`}>
                          <ItemContent>
                            <ItemTitle>{item.displayName}</ItemTitle>
                            <ItemDescription>
                              {date(item.nextExpectedDate as string)} ·{" "}
                              {item.type === "income" ? "Expected income" : "Expected payment"}
                            </ItemDescription>
                          </ItemContent>
                          <ItemActions>
                            <span className="tabular-nums">
                              {item.type === "income" ? "+" : "−"}
                              {formatMoney(item.expectedAmount)}
                            </span>
                          </ItemActions>
                        </Item>
                      ))}
                    </ItemGroup>
                  ) : recurring.isSuccess ? (
                    <Empty>
                      <EmptyHeader>
                        <EmptyTitle>No confirmed upcoming activity</EmptyTitle>
                        <EmptyDescription>
                          Confirm your income and bills to build an outlook.
                        </EmptyDescription>
                      </EmptyHeader>
                    </Empty>
                  ) : null}
                </CardContent>
              </Card>
            </section>
          </section>
        ) : null}
        {view === "income" ? (
          <Card aria-label="Income">
            <CardHeader>
              <CardTitle>Income</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <p className="text-sm text-muted-foreground">
                Confirm the deposits that represent ongoing income. Transfers and reimbursements
                belong to their original activity.
              </p>
              {recurring.isPending ? (
                <Skeleton className="h-28 w-full" />
              ) : income.length ? (
                patternRows(income, "income")
              ) : recurring.isSuccess ? (
                <Empty>
                  <EmptyHeader>
                    <EmptyTitle>No income patterns yet</EmptyTitle>
                    <EmptyDescription>
                      Add account history or complete your financial profile.
                    </EmptyDescription>
                  </EmptyHeader>
                  <Button asChild>
                    <Link to="/finances/setup">Update financial profile</Link>
                  </Button>
                </Empty>
              ) : null}
            </CardContent>
          </Card>
        ) : null}
        {view === "subscriptions" ? (
          <Card aria-label="Bills & subscriptions">
            <CardHeader>
              <CardTitle>Bills &amp; subscriptions</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <p className="text-sm text-muted-foreground">
                Changing a pattern updates this forecast. It does not cancel a subscription or
                change a payment with its provider.
              </p>
              {recurring.isPending ? (
                <Skeleton className="h-28 w-full" />
              ) : obligations.length ? (
                patternRows(obligations, "obligation")
              ) : recurring.isSuccess ? (
                <Empty>
                  <EmptyHeader>
                    <EmptyTitle>No bills or subscriptions yet</EmptyTitle>
                    <EmptyDescription>
                      Recurring activity appears when there is enough account history.
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              ) : null}
            </CardContent>
          </Card>
        ) : null}
        {view === "reimbursements" ? (
          <section aria-label="Reimbursements">
            <FinanceReimbursementList />
          </section>
        ) : null}
      </div>
    </div>
  );
}
