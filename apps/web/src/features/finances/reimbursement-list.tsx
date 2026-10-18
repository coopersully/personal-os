import { ApiClientError } from "@personal-os/api-client";
import type { FinanceReimbursement } from "@personal-os/domain";
import { EmptyState, Spinner } from "@personal-os/ui";
import { useQuery } from "@tanstack/react-query";
import { CircleCheckIcon } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Item, ItemContent, ItemDescription, ItemGroup, ItemTitle } from "@/components/ui/item";
import { Progress } from "@/components/ui/progress";
import { api } from "../../api.js";
import { InlineError } from "../../components/async-state.js";
import { FinanceReimbursementJourney, reimbursementAmount } from "./reimbursement-journey.js";

function sectionFor(item: FinanceReimbursement) {
  if (["received", "cancelled"].includes(item.status)) return "Recently resolved";
  if (item.status === "overdue") return "Overdue";
  return "Outstanding";
}

export function FinanceReimbursementList() {
  const query = useQuery({
    queryFn: api.listFinanceReimbursements,
    queryKey: ["finance-reimbursements"],
  });
  if (query.error instanceof ApiClientError && [401, 403].includes(query.error.status))
    return (
      <p role="status">
        Reimbursement access unavailable. Check your permissions before viewing receipt evidence.
      </p>
    );
  if (query.isPending) return <Spinner label="Loading reimbursements" />;
  if (query.error && !query.data)
    return <InlineError error={query.error} retry={() => query.refetch()} />;
  const items = query.data?.reimbursements ?? [];
  return (
    <Card>
      <CardHeader>
        <CardTitle>Reimbursements</CardTitle>
        <CardDescription>
          Expected money stays visible until it is matched, cancelled, or needs your judgment.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {query.isError ? (
          <InlineError error={query.error} retry={() => query.refetch()} stale />
        ) : null}
        {items.length === 0 ? (
          <EmptyState icon={<CircleCheckIcon />} title="No reimbursements outstanding">
            Reimbursable transaction splits and matched credits will appear here.
          </EmptyState>
        ) : (
          <ItemGroup>
            {items.map((item) => {
              const remaining = Math.max(0, item.expectedAmount - item.receivedAmount);
              const progress = Math.min(100, (item.receivedAmount / item.expectedAmount) * 100);
              return (
                <Item key={item.id} variant="outline">
                  <ItemContent className="gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <ItemTitle>{item.payer ?? "Payer not set"}</ItemTitle>
                      <Badge variant={item.status === "overdue" ? "destructive" : "outline"}>
                        {sectionFor(item)}
                      </Badge>
                    </div>
                    <ItemDescription>
                      {reimbursementAmount(item.receivedAmount, item.sourceExpense?.currency)}{" "}
                      received of{" "}
                      {reimbursementAmount(item.expectedAmount, item.sourceExpense?.currency)} ·{" "}
                      {reimbursementAmount(remaining, item.sourceExpense?.currency)}{" "}
                      {item.status === "cancelled" ? "cancelled remainder" : "remaining"}
                      {item.dueDate ? ` · due ${item.dueDate}` : ""}
                    </ItemDescription>
                    {item.sourceExpense?.currency &&
                    item.matches.some(
                      (match) =>
                        match.creditTransaction?.currency &&
                        match.creditTransaction.currency !== item.sourceExpense?.currency,
                    ) ? (
                      <p className="text-sm text-muted-foreground">
                        Receipt currency differs from the source expense. These amounts are not
                        comparable across currencies.
                      </p>
                    ) : null}
                    {item.sourceExpense?.personalCostToDate?.state === "qualified" ? (
                      <p className="text-sm">
                        Personal cost to date (whole expense):{" "}
                        {reimbursementAmount(
                          item.sourceExpense.personalCostToDate.amount,
                          item.sourceExpense.personalCostToDate.currency,
                        )}
                        . May repeat on related claims; do not add case cards together.
                      </p>
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        Personal cost to date unavailable
                        {item.sourceExpense?.personalCostToDate?.state === "unavailable"
                          ? `: ${item.sourceExpense.personalCostToDate.reason.replaceAll("_", " ")}`
                          : ""}
                        .
                      </p>
                    )}
                    <Progress
                      aria-label={`Reimbursement from ${item.payer ?? "unknown payer"}`}
                      value={progress}
                    />
                    <p className="text-xs text-muted-foreground">
                      {item.matches.length} linked{" "}
                      {item.matches.length === 1 ? "credit" : "credits"} · {item.rationale}
                    </p>
                    <FinanceReimbursementJourney reimbursement={item} />
                  </ItemContent>
                </Item>
              );
            })}
          </ItemGroup>
        )}
      </CardContent>
    </Card>
  );
}
