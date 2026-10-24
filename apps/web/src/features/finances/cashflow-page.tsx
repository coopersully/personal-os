import { ApiClientError } from "@personal-os/api-client";
import type {
  FinanceIncomeStream,
  FinanceRecurringObligation,
  ManageFinanceRecurringItemInput,
} from "@personal-os/domain";
import { formatDateOnly, idSchema } from "@personal-os/domain";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { ActionButton as Button } from "@/components/action-button";
import { ChevronDownIcon, DollarIcon, PauseIcon, PlayIcon } from "@/components/icons";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { ItemGroup } from "@/components/ui/item";
import { Skeleton } from "@/components/ui/skeleton";
import { WorkspaceHeaderControls } from "@/components/workspace-header-controls";
import { api } from "../../api.js";
import { MutationFeedback } from "../../components/mutation-feedback.js";
import { useFeedbackMutation } from "../../lib/use-feedback-mutation.js";
import { FinanceCashflowPlanning } from "./cashflow-planning";
import { FinanceSourceState, requireFinanceResult } from "./position-material.js";
import { RecurringCostSection } from "./recurring-cost-section";
import { FinanceReimbursementList } from "./reimbursement-list";
import { FinanceScenarioComparison } from "./scenario-comparison.js";
import { FinanceTransactionItem } from "./transaction-item";

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
  const selectedId = params.get("record");
  const sourceItems = <T extends { id: string }>(items: T[]) =>
    selectedId === null
      ? items
      : items.filter((item) => item.id === selectedId && idSchema.safeParse(selectedId).success);
  const patternActions = (
    item: FinanceIncomeStream | FinanceRecurringObligation,
    itemType: "income" | "obligation",
  ) => (
    <Button
      size="icon-sm"
      variant="ghost"
      disabled={update.isPending}
      aria-label={`${item.status === "active" ? "Pause" : item.status === "needs_review" ? "Confirm" : "Resume"} ${item.displayName}`}
      onClick={() => change(item, itemType)}
    >
      {item.status === "active" ? <PauseIcon /> : <PlayIcon />}
    </Button>
  );
  const patternRows = (
    items: Array<FinanceIncomeStream | FinanceRecurringObligation>,
    itemType: "income" | "obligation",
  ) => (
    <ItemGroup>
      {items.map((item) => (
        <FinanceTransactionItem
          key={item.id}
          title={item.displayName}
          amount={item.expectedAmount}
          direction={itemType === "income" ? "income" : "expense"}
          status={item.status === "active" ? "expected" : undefined}
          description={`${cadence[item.cadence] ?? item.cadence}${item.nextExpectedDate ? ` · Next ${date(item.nextExpectedDate)}` : " · Date not established"}`}
          actions={patternActions(item, itemType)}
        >
          <Badge variant="secondary">
            {item.status === "needs_review"
              ? "Needs confirmation"
              : item.status === "active"
                ? "Active pattern"
                : "Inactive"}
          </Badge>
        </FinanceTransactionItem>
      ))}
    </ItemGroup>
  );
  return (
    <div className="wide-page flex min-w-0 w-full max-w-6xl flex-col gap-6 pb-8">
      <div className="flex flex-col gap-4">
        <WorkspaceHeaderControls label="Cash flow views" placement="title">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" aria-label="Cash flow view" className="max-w-48">
                <DollarIcon data-icon="inline-start" />
                <span className="truncate text-xs font-normal text-muted-foreground sm:text-sm">
                  {cashflowViews.find((item) => item.value === view)?.label.toLowerCase()}
                </span>
                <ChevronDownIcon data-icon="inline-end" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuRadioGroup
                value={view}
                onValueChange={(value) => {
                  const next = new URLSearchParams(params);
                  next.delete("record");
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
          <section aria-label="Outlook" className="flex min-w-0 flex-col gap-4">
            {accounts.isError ? (
              <FinanceSourceState label="Timeline account details" query={accounts} />
            ) : null}
            {recurring.isPending ? (
              <Skeleton className="h-32 w-full" />
            ) : recurring.data ? (
              <FinanceCashflowPlanning
                accessDenied={[recurring.error, accounts.error].some(
                  (error) => error instanceof ApiClientError && [401, 403].includes(error.status),
                )}
              />
            ) : null}
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
              {selectedId ? (
                <p className="text-sm">
                  Selected income record ·{" "}
                  <Link className="underline" to="/finances/cashflow?view=income">
                    Show all income
                  </Link>
                </p>
              ) : null}
              {recurring.isPending ? (
                <Skeleton className="h-28 w-full" />
              ) : sourceItems(income).length ? (
                patternRows(sourceItems(income), "income")
              ) : recurring.isSuccess ? (
                <Empty>
                  <EmptyHeader>
                    <EmptyTitle>
                      {selectedId ? "Selected income record unavailable" : "No income patterns yet"}
                    </EmptyTitle>
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
                Changing a pattern updates its next expected record. It does not cancel a
                subscription or change a payment with its provider.
              </p>
              {selectedId ? (
                <p className="text-sm">
                  Selected recurring record ·{" "}
                  <Link className="underline" to="/finances/cashflow?view=subscriptions">
                    Show all bills and subscriptions
                  </Link>
                </p>
              ) : null}
              {recurring.isPending ? (
                <Skeleton className="h-28 w-full" />
              ) : sourceItems(obligations).length ? (
                <>
                  <RecurringCostSection
                    accessDenied={[recurring.error, accounts.error].some(
                      (error) =>
                        error instanceof ApiClientError && [401, 403].includes(error.status),
                    )}
                    obligations={sourceItems(obligations)}
                    accounts={accounts.data?.accounts ?? []}
                    renderActions={(item) => patternActions(item, "obligation")}
                  />
                  {sourceItems(obligations).some((item) => item.kind === "savings")
                    ? patternRows(
                        sourceItems(obligations).filter((item) => item.kind === "savings"),
                        "obligation",
                      )
                    : null}
                </>
              ) : recurring.isSuccess ? (
                <Empty>
                  <EmptyHeader>
                    <EmptyTitle>
                      {selectedId
                        ? "Selected recurring record unavailable"
                        : "No bills or subscriptions yet"}
                    </EmptyTitle>
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
