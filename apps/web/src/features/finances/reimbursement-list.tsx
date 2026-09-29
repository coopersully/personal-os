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
import { formatMoney } from "./format.js";

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
  if (query.isPending) return <Spinner label="Loading reimbursements" />;
  if (query.error) return <InlineError error={query.error} />;
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
                      {formatMoney(item.receivedAmount)} received of{" "}
                      {formatMoney(item.expectedAmount)} · {formatMoney(remaining)} remaining
                      {item.dueDate ? ` · due ${item.dueDate}` : ""}
                    </ItemDescription>
                    <Progress
                      aria-label={`Reimbursement from ${item.payer ?? "unknown payer"}`}
                      value={progress}
                    />
                    <p className="text-xs text-muted-foreground">
                      {item.matches.length} linked{" "}
                      {item.matches.length === 1 ? "credit" : "credits"} · {item.rationale}
                    </p>
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
