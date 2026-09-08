import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
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
import {
  WorkspaceSecondaryAppBar,
  WorkspaceSecondaryAppBarActions,
} from "@/components/workspace-secondary-app-bar";
import { api } from "../../api.js";
import {
  FinancePositionMaterial,
  FinanceSourceState,
  financeAmount,
  financeObservedAt,
  requireFinanceResult,
} from "./position-material.js";

const maintenanceLabels = {
  deterministic_processing: "Processing records",
  agent_reasoning: "Awaiting agent reasoning",
  reconciliation: "Reconciling records",
  agent_audit: "Awaiting agent audit",
  settled: "Settled",
  failed: "Failed",
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
  const reviewCount = inbox.data?.data.filter((item) => item.status === "open").length;
  const question = inbox.data?.communication.nextQuestion?.prompt;
  const latestReview = status.data?.details.latestReview;
  const nextPriority =
    playbook.data?.assessment.blockers[0] ?? playbook.data?.assessment.nextActions[0];
  return (
    <div className="flex flex-col gap-6">
      <WorkspaceSecondaryAppBar aria-label="Finance overview controls">
        <WorkspaceSecondaryAppBarActions>
          <Button asChild size="sm" variant="outline">
            <Link to="/finances/setup">Financial setup</Link>
          </Button>
        </WorkspaceSecondaryAppBarActions>
      </WorkspaceSecondaryAppBar>
      <FinanceSourceState label="Financial position" query={snapshot} />
      {snapshot.data ? <FinancePositionMaterial result={snapshot.data} /> : null}
      <section aria-label="Next step" className="flex flex-col gap-3">
        <h2 className="text-base font-medium">Next step</h2>
        <FinanceSourceState label="Review inbox" query={inbox} />
        <ItemGroup>
          <Item>
            <ItemContent>
              <ItemTitle>
                {question ??
                  (reviewCount
                    ? `${reviewCount} ${reviewCount === 1 ? "question needs" : "questions need"} review`
                    : snapshot.data && !snapshot.data.data.ledger.trustworthy
                      ? "Confirm the evidence behind your position"
                      : plan?.status === "proposed"
                        ? "Inspect your proposed plan"
                        : "Keep your financial context current")}
              </ItemTitle>
              <ItemDescription>
                {reviewCount
                  ? "Review the source evidence and answer the next open question."
                  : snapshot.data && !snapshot.data.data.ledger.trustworthy
                    ? "Check account ownership, inclusion, and source freshness."
                    : plan?.status === "proposed"
                      ? "Your proposed version is waiting for a decision."
                      : "Financial setup resumes from your saved progress."}
              </ItemDescription>
            </ItemContent>
            <ItemActions>
              <Button asChild size="sm">
                <Link
                  to={
                    reviewCount
                      ? "/finances/review"
                      : snapshot.data && !snapshot.data.data.ledger.trustworthy
                        ? "/finances/accounts"
                        : plan?.status === "proposed"
                          ? "/finances/plan"
                          : "/finances/setup"
                  }
                >
                  {reviewCount
                    ? "Answer next question"
                    : snapshot.data && !snapshot.data.data.ledger.trustworthy
                      ? "Inspect accounts"
                      : plan?.status === "proposed"
                        ? "Review proposal"
                        : "Resume setup"}
                </Link>
              </Button>
            </ItemActions>
          </Item>
        </ItemGroup>
      </section>
      <section aria-label="Complete plan" className="flex flex-col gap-3">
        <h2 className="text-base font-medium">Complete plan</h2>
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
              <EmptyDescription>Build a plan from your resources and priorities.</EmptyDescription>
            </EmptyHeader>
            <Button asChild size="sm">
              <Link to="/finances/plan">Create plan</Link>
            </Button>
          </Empty>
        ) : null}
      </section>
      <section aria-label="Near-term context" className="flex flex-col gap-3">
        <h2 className="text-base font-medium">Near-term context</h2>
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
      </section>
      <section aria-label="Next wealth-building priority" className="flex flex-col gap-3">
        <h2 className="text-base font-medium">Next wealth-building priority</h2>
        <FinanceSourceState label="Wealth-building priorities" query={playbook} />
        {nextPriority ? (
          <ItemGroup>
            <Item>
              <ItemContent>
                <ItemTitle>{nextPriority}</ItemTitle>
                <ItemDescription>
                  Based on the saved financial profile · Playbook {playbook.data?.playbook.version}
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
      </section>
      <section aria-label="Recent review and maintenance" className="flex flex-col gap-3">
        <h2 className="text-base font-medium">Recent review and maintenance</h2>
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
                  <Item key={run.runId}>
                    <ItemContent>
                      <ItemTitle>{maintenanceLabels[run.stage]}</ItemTitle>
                      <ItemDescription>
                        {run.reviewQuestion?.prompt ??
                          (run.stage === "settled"
                            ? "The recorded maintenance run settled."
                            : run.stage === "failed"
                              ? "This run needs recovery."
                              : "This run still has outstanding work.")}
                      </ItemDescription>
                    </ItemContent>
                    <ItemActions>
                      <Button asChild size="sm" variant="ghost">
                        <Link to="/finances/health">Inspect evidence</Link>
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
      </section>
    </div>
  );
}
