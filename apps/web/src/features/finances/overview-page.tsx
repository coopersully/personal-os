import { ApiClientError } from "@personal-os/api-client";
import { cashflowScheduleRange, formatDateOnly } from "@personal-os/domain";
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { BankIcon, ReceiptIcon, WalletIcon } from "@/components/icons";
import { KeyMetric, KeyMetrics } from "@/components/key-metrics";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
} from "@/components/ui/item";
import { api } from "../../api.js";
import { formatCompactMoney } from "./format";
import { FinanceOverviewSettings } from "./overview-settings";
import {
  FinancePositionMaterial,
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
  const reviews = useQuery({
    queryKey: ["agent-access-work-items", "finance-overview", me.data?.id],
    queryFn: () => api.listAgentAccessWorkItems({ domain: "finances", limit: 10 }),
    enabled: !!me.data && !accessDenied(me.error),
    refetchInterval: 60_000,
  });
  const status = useQuery({ queryKey: ["finance-status"], queryFn: () => api.getFinanceStatus() });
  const playbook = useQuery({ queryKey: ["finance-playbook"], queryFn: api.getFinancePlaybook });
  const maintenance = useQuery({
    queryKey: ["finance-maintenance-history", 3],
    queryFn: () => api.getFinanceMaintenanceHistory({ limit: 3 }),
  });
  const plan = budget.data?.data;
  const reviewCount = reviews.data?.summary.byDomain.finances;
  const reviewUnavailable = reviews.data?.unavailableDomains.includes("finances");
  const reviewDenied = accessDenied(me.error) || accessDenied(reviews.error);
  const reviewsKnown =
    reviews.isSuccess && !reviewUnavailable && !reviewDenied && typeof reviewCount === "number";
  const latestReview = status.data?.details.latestReview;
  const nextPriority =
    playbook.data?.assessment.blockers[0] ?? playbook.data?.assessment.nextActions[0];
  return (
    <div className="flex min-w-0 flex-col gap-8">
      <FinanceSourceState label="Financial position" query={snapshot} />
      {snapshot.data ? (
        <KeyMetrics label="Finance key metrics">
          <KeyMetric
            label="Cash"
            value={
              snapshot.data.data.cash === null
                ? "Unavailable"
                : formatCompactMoney(snapshot.data.data.cash)
            }
            exactValue={financeAmount(snapshot.data.data.cash)}
            icon={BankIcon}
            description="Current balance"
          />
          <KeyMetric
            label="Spent this month"
            value={
              snapshot.data.data.budget.spent === null
                ? "Unavailable"
                : formatCompactMoney(snapshot.data.data.budget.spent)
            }
            exactValue={financeAmount(snapshot.data.data.budget.spent)}
            icon={ReceiptIcon}
          />
          <KeyMetric
            label="Net worth"
            value={
              snapshot.data.data.netWorth === null
                ? "Unavailable"
                : formatCompactMoney(snapshot.data.data.netWorth)
            }
            exactValue={financeAmount(snapshot.data.data.netWorth)}
            icon={WalletIcon}
            description="Current balance"
          />
        </KeyMetrics>
      ) : null}

      <div className="grid min-w-0 gap-8 lg:grid-cols-2">
        <OverviewSection title="Needs you">
          {!accessDenied(me.error) ? (
            <FinanceSourceState label="Decisions" query={me.data ? reviews : me} />
          ) : null}
          {reviewDenied ? (
            <p>Review access unavailable.</p>
          ) : reviewUnavailable ? (
            <p>Some Finance decisions could not be checked. Open Reviews to check status.</p>
          ) : null}
          {reviewsKnown ? (
            <ItemGroup>
              <Item variant="outline">
                <ItemContent>
                  <ItemTitle>
                    {reviewCount
                      ? `${reviewCount} ${reviewCount === 1 ? "item needs" : "items need"} review`
                      : "No items need review"}
                  </ItemTitle>
                  <ItemDescription>
                    Review questions and approvals that need your decision.
                  </ItemDescription>
                </ItemContent>
              </Item>
            </ItemGroup>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button asChild size="sm" variant="outline">
              <Link to="/finances?review=open">Open Reviews</Link>
            </Button>
            <Button asChild size="sm" variant="ghost" className="self-start">
              <Link to="/finances/chat">Discuss in Chat</Link>
            </Button>
            <Button asChild size="sm" variant="ghost" className="self-start">
              <Link to="/finances/transactions?financeTask=correct">Correct a transaction</Link>
            </Button>
          </div>
        </OverviewSection>
        <OverviewUpcomingMoney />
      </div>
      {snapshot.data ? <FinancePositionMaterial result={snapshot.data} hideMetrics /> : null}
      <div className="grid gap-6 lg:grid-cols-2">
        {reviewsKnown && reviewCount === 0 ? (
          <OverviewSection title="Next step">
            <ItemGroup>
              <Item variant="outline">
                <ItemContent>
                  <ItemTitle>
                    {snapshot.data && !snapshot.data.data.ledger.trustworthy
                      ? "Confirm the evidence behind your position"
                      : plan?.status === "proposed"
                        ? "Inspect your proposed plan"
                        : "Keep your financial context current"}
                  </ItemTitle>
                  <ItemDescription>
                    {snapshot.data && !snapshot.data.data.ledger.trustworthy
                      ? "Check account ownership, inclusion, and source freshness."
                      : plan?.status === "proposed"
                        ? "Your proposed version is waiting for a decision."
                        : "Configure your financial profile and accounts."}
                  </ItemDescription>
                </ItemContent>
                <ItemActions>
                  <Button asChild size="sm">
                    <Link
                      to={
                        snapshot.data && !snapshot.data.data.ledger.trustworthy
                          ? "/finances/accounts"
                          : plan?.status === "proposed"
                            ? "/finances/plan"
                            : "/finances/setup"
                      }
                    >
                      {snapshot.data && !snapshot.data.data.ledger.trustworthy
                        ? "Inspect accounts"
                        : plan?.status === "proposed"
                          ? "Review proposal"
                          : "Update financial profile"}
                    </Link>
                  </Button>
                </ItemActions>
              </Item>
            </ItemGroup>
          </OverviewSection>
        ) : null}
        <OverviewSection title="Complete plan">
          <FinanceSourceState label="Complete plan" query={budget} />
          {plan ? (
            <ItemGroup>
              <Item variant="outline">
                <ItemContent>
                  <ItemTitle>
                    {plan.effectiveFrom}{" "}
                    <Badge variant="secondary">
                      {plan.status === "proposed"
                        ? "Proposed"
                        : plan.status === "active"
                          ? "Active"
                          : plan.status === "retired"
                            ? "Retired"
                            : "Incomplete"}{" "}
                      · Version {plan.version}
                    </Badge>
                  </ItemTitle>
                  <ItemDescription>{plan.rationale}</ItemDescription>
                  <p className="text-sm">
                    {financeAmount(plan.allocatedTotal)} allocated from{" "}
                    {financeAmount(plan.expectedResources)} in resources · {plan.allocations.length}{" "}
                    allocations
                  </p>
                  <p className="text-muted-foreground text-xs">
                    The complete version includes spending, savings, debt, goals, and buffer
                    allocations.
                  </p>
                </ItemContent>
                <ItemActions>
                  <Button asChild size="sm" variant="outline">
                    <Link to="/finances/plan">Inspect complete plan</Link>
                  </Button>
                </ItemActions>
              </Item>
            </ItemGroup>
          ) : budget.isSuccess ? (
            <Empty>
              <EmptyHeader>
                <EmptyTitle>No complete plan yet</EmptyTitle>
                <EmptyDescription>
                  Build a plan from your resources and priorities.
                </EmptyDescription>
              </EmptyHeader>
              <Button asChild size="sm">
                <Link to="/finances/plan">Create plan</Link>
              </Button>
            </Empty>
          ) : null}
        </OverviewSection>
        <OverviewSection title="Near-term context">
          <FinanceSourceState label="Cash-flow context" query={status} />
          {status.data ? (
            <ItemGroup>
              <Item variant="outline">
                <ItemContent>
                  <ItemTitle>Cash-flow outlook</ItemTitle>
                  <ItemDescription>
                    Inspect upcoming income, outflows, and account coverage before using a forecast.
                  </ItemDescription>
                </ItemContent>
                <ItemActions>
                  <Button asChild size="sm" variant="ghost" className="self-start">
                    <Link to="/finances/cashflow">Inspect forecast</Link>
                  </Button>
                </ItemActions>
              </Item>
              <Item variant="outline">
                <ItemContent>
                  <ItemTitle>Outstanding reimbursements</ItemTitle>
                  <ItemDescription>
                    {financeAmount(status.data.details.reimbursements.outstanding)} · Expected
                    reimbursement records
                  </ItemDescription>
                </ItemContent>
                <ItemActions>
                  <Button asChild size="sm" variant="ghost" className="self-start">
                    <Link to="/finances/cashflow?view=reimbursements">Inspect reimbursements</Link>
                  </Button>
                </ItemActions>
              </Item>
            </ItemGroup>
          ) : null}
        </OverviewSection>
        <OverviewSection title="Next wealth-building priority">
          <FinanceSourceState label="Wealth-building priorities" query={playbook} />
          {nextPriority ? (
            <ItemGroup>
              <Item variant="outline">
                <ItemContent>
                  <ItemTitle>{nextPriority}</ItemTitle>
                  <ItemDescription>
                    Based on the saved financial profile · Playbook{" "}
                    {playbook.data?.playbook.version}
                  </ItemDescription>
                </ItemContent>
                <ItemActions>
                  <Button asChild size="sm" variant="ghost" className="self-start">
                    <Link to="/finances/wealth">Inspect wealth and goals</Link>
                  </Button>
                </ItemActions>
              </Item>
            </ItemGroup>
          ) : null}
        </OverviewSection>
      </div>
      <Button asChild variant="outline">
        <Link to="/finances/spending">Explore Spending</Link>
      </Button>
      <FinanceSourceState label="Account settings" query={me} />
      <OverviewSection title="What changed">
        <Button asChild size="sm" variant="ghost" className="self-start">
          <Link to="/finances/activity">Open Activity</Link>
        </Button>
        <FinanceSourceState label="Review history" query={status} />
        <FinanceSourceState label="Maintenance history" query={maintenance} />
        {latestReview ? (
          <ItemGroup>
            <Item variant="outline">
              <ItemContent>
                <ItemTitle>Latest period review</ItemTitle>
                <ItemDescription>
                  {financeObservedAt(latestReview.completedAt)} ·{" "}
                  {latestReview.status.replaceAll("_", " ")}
                </ItemDescription>
              </ItemContent>
              <ItemActions>
                <Button asChild size="sm" variant="outline">
                  <Link to={`/finances/reviews/${latestReview.id}`}>Open review</Link>
                </Button>
              </ItemActions>
            </Item>
          </ItemGroup>
        ) : status.isSuccess ? (
          <p className="text-muted-foreground text-sm">No completed period review.</p>
        ) : null}
        {maintenance.data?.items.length ? (
          <Collapsible>
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="sm">
                Recent maintenance ({maintenance.data.items.length})
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <ItemGroup>
                {maintenance.data.items.map((run) => (
                  <Item key={run.run?.id ?? run.recovery?.legacyRunId} variant="outline">
                    <ItemContent>
                      <ItemTitle>
                        {run.run ? maintenanceLabels[run.run.status] : "Maintenance recovery"}
                      </ItemTitle>
                      <ItemDescription>
                        {run.recovery?.reason ??
                          run.nextAction?.reason ??
                          (run.run?.status === "completed"
                            ? "The recorded maintenance run completed."
                            : "Inspect the recorded run and its evidence.")}
                      </ItemDescription>
                    </ItemContent>
                    <ItemActions>
                      <Button asChild size="sm" variant="ghost" className="self-start">
                        <Link to="/finances/accounts">Review accounts</Link>
                      </Button>
                    </ItemActions>
                  </Item>
                ))}
              </ItemGroup>
            </CollapsibleContent>
          </Collapsible>
        ) : maintenance.isSuccess ? (
          <p className="text-muted-foreground text-sm">No recorded maintenance runs.</p>
        ) : null}
      </OverviewSection>
      {me.data && !accessDenied(me.error) ? <FinanceOverviewSettings key="view-settings" /> : null}
    </div>
  );
}

// Overview is an open daily sequence; supporting material must not become a grid of raised cards.
function OverviewSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="flex min-w-0 flex-col gap-3 px-1">
      <h2 className="text-sm font-medium text-muted-foreground">{title}</h2>
      {children}
    </section>
  );
}

function accessDenied(error: unknown) {
  return error instanceof ApiClientError && [401, 403].includes(error.status);
}

function OverviewUpcomingMoney() {
  const me = useQuery({ queryKey: ["me"], queryFn: api.getMe });
  return (
    <OverviewSection title="Coming next">
      <FinanceSourceState label="Planning context" query={me} />
      {accessDenied(me.error) ? (
        <p>Upcoming money access unavailable.</p>
      ) : me.data ? (
        me.data.planningTimezone ? (
          <OwnerUpcomingMoney
            key={me.data.id}
            ownerId={me.data.id}
            timezone={me.data.planningTimezone}
          />
        ) : (
          <p>Set your planning timezone in Settings before viewing upcoming dates.</p>
        )
      ) : null}
    </OverviewSection>
  );
}

function OwnerUpcomingMoney({ ownerId, timezone }: { ownerId: string; timezone: string }) {
  const [asOf] = useState(() => new Date().toISOString());
  const range = cashflowScheduleRange(asOf, timezone);
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
  const href = `/finances/cashflow?${new URLSearchParams({ cashflowFrom: range.from, cashflowTo: range.to, timeline: "agenda" })}`;
  return (
    <>
      <p className="text-muted-foreground text-sm">
        Next 30 days · {timezone} · Expected money, not a spendable balance.
      </p>
      <FinanceSourceState label="Upcoming money" query={upcoming} />
      {denied ? (
        <p>Upcoming money access unavailable.</p>
      ) : upcoming.data ? (
        <>
          {rows.length ? (
            <ItemGroup>
              {rows.slice(0, 3).map((row) => (
                <Item key={row.key} variant="outline">
                  <ItemContent>
                    <ItemTitle>{row.displayName}</ItemTitle>
                    <ItemDescription>
                      {formatDateOnly(row.localDate, { dateStyle: "medium" })} ·{" "}
                      {row.source.kind === "income" ? "Expected income" : "Expected outflow"}
                      {row.matchState === "partially_matched"
                        ? " · Remaining after partial match"
                        : ""}
                    </ItemDescription>
                  </ItemContent>
                  <ItemActions className="ml-auto text-right">
                    <p className="text-sm font-medium tabular-nums">
                      {row.remainingExpectedCents === null
                        ? "Amount varies"
                        : new Intl.NumberFormat(undefined, {
                            style: "currency",
                            currency: row.currencyCode,
                          }).format(row.remainingExpectedCents / 100)}
                      {` · ${row.currencyCode}`}
                    </p>
                  </ItemActions>
                </Item>
              ))}
            </ItemGroup>
          ) : (
            <p>
              {upcoming.data.unavailableSources.length
                ? "Upcoming money cannot be fully determined yet."
                : "No unmatched scheduled money in this date range."}
            </p>
          )}
          {rows.length > 3 ? (
            <p className="text-muted-foreground text-sm">
              Showing the next 3 of {rows.length} expected items.
            </p>
          ) : null}
          {upcoming.data.unavailableSources.length ? (
            <p className="text-sm">
              {upcoming.data.unavailableSources.length} sources need schedule or amount confirmation
              in Cash flow. This list is incomplete.
            </p>
          ) : null}
        </>
      ) : null}
      <Button asChild size="sm" variant="ghost" className="self-start">
        <Link to={href}>Open upcoming money</Link>
      </Button>
    </>
  );
}
