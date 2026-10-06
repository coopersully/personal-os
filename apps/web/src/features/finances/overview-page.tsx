import { useQuery } from "@tanstack/react-query";
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
import { FinanceBentoSection } from "./bento-section.js";
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
  const snapshot = useQuery({
    queryKey: ["finance-snapshot"],
    queryFn: async () => requireFinanceResult(await api.getFinanceSnapshot()),
  });
  const budget = useQuery({
    queryKey: ["finance-budget-current"],
    queryFn: async () => requireFinanceResult(await api.getFinanceBudget()),
  });
  const inbox = useQuery({
    queryKey: ["finance-inbox"],
    queryFn: async () => requireFinanceResult(await api.getFinanceInbox()),
  });
  const status = useQuery({ queryKey: ["finance-status"], queryFn: () => api.getFinanceStatus() });
  const playbook = useQuery({ queryKey: ["finance-playbook"], queryFn: api.getFinancePlaybook });
  const maintenance = useQuery({
    queryKey: ["finance-maintenance-history", 3],
    queryFn: () => api.getFinanceMaintenanceHistory({ limit: 3 }),
  });
  const plan = budget.data?.data;
  const reviewCount = inbox.data?.data.filter((item) => item.status !== "resolved").length;
  const latestReview = status.data?.details.latestReview;
  const nextPriority =
    playbook.data?.assessment.blockers[0] ?? playbook.data?.assessment.nextActions[0];
  return (
    <div className="flex flex-col gap-6">
      <FinanceSourceState label="Financial position" query={snapshot} />
      {snapshot.data ? (
        <>
          <KeyMetrics label="Finance key metrics">
            <KeyMetric
              label="Cash"
              value={financeAmount(snapshot.data.data.cash)}
              icon={BankIcon}
              description="Current balance"
            />
            <KeyMetric
              label="Posted spending this month"
              value={financeAmount(snapshot.data.data.budget.spent)}
              icon={ReceiptIcon}
            />
            <KeyMetric
              label="Net worth"
              value={financeAmount(snapshot.data.data.netWorth)}
              icon={WalletIcon}
              description="Current balance"
            />
          </KeyMetrics>
          <FinancePositionMaterial result={snapshot.data} hideMetrics />
        </>
      ) : null}
      <div className="finance-bento">
        {inbox.isSuccess && reviewCount === 0 ? (
          <FinanceBentoSection title="Next step">
            <ItemGroup>
              <Item>
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
          </FinanceBentoSection>
        ) : null}
        <FinanceBentoSection title="Complete plan">
          <FinanceSourceState label="Complete plan" query={budget} />
          {plan ? (
            <ItemGroup>
              <Item>
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
        </FinanceBentoSection>
        <FinanceBentoSection title="Near-term context">
          <FinanceSourceState label="Cash-flow context" query={status} />
          {status.data ? (
            <ItemGroup>
              <Item>
                <ItemContent>
                  <ItemTitle>Cash-flow outlook</ItemTitle>
                  <ItemDescription>
                    Inspect upcoming income, outflows, and account coverage before using a forecast.
                  </ItemDescription>
                </ItemContent>
                <ItemActions>
                  <Button asChild size="sm" variant="ghost">
                    <Link to="/finances/cashflow">Inspect forecast</Link>
                  </Button>
                </ItemActions>
              </Item>
              <Item>
                <ItemContent>
                  <ItemTitle>Outstanding reimbursements</ItemTitle>
                  <ItemDescription>
                    {financeAmount(status.data.details.reimbursements.outstanding)} · Expected
                    reimbursement records
                  </ItemDescription>
                </ItemContent>
                <ItemActions>
                  <Button asChild size="sm" variant="ghost">
                    <Link to="/finances/cashflow?view=reimbursements">Inspect reimbursements</Link>
                  </Button>
                </ItemActions>
              </Item>
            </ItemGroup>
          ) : null}
        </FinanceBentoSection>
        <FinanceBentoSection title="Next wealth-building priority">
          <FinanceSourceState label="Wealth-building priorities" query={playbook} />
          {nextPriority ? (
            <ItemGroup>
              <Item>
                <ItemContent>
                  <ItemTitle>{nextPriority}</ItemTitle>
                  <ItemDescription>
                    Based on the saved financial profile · Playbook{" "}
                    {playbook.data?.playbook.version}
                  </ItemDescription>
                </ItemContent>
                <ItemActions>
                  <Button asChild size="sm" variant="ghost">
                    <Link to="/finances/wealth">Inspect wealth and goals</Link>
                  </Button>
                </ItemActions>
              </Item>
            </ItemGroup>
          ) : null}
        </FinanceBentoSection>
        <FinanceBentoSection title="Recent review and maintenance">
          <FinanceSourceState label="Maintenance history" query={maintenance} />
          {latestReview ? (
            <ItemGroup>
              <Item>
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
                    <Item key={run.run?.id ?? run.recovery?.legacyRunId}>
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
                        <Button asChild size="sm" variant="ghost">
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
        </FinanceBentoSection>
      </div>
    </div>
  );
}
