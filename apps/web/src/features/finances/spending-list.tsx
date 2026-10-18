import type {
  FinanceSpendingDashboard,
  FinanceSpendingGroup,
  FinanceSpendingMonthlyBudget,
} from "@personal-os/domain";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { formatMoney } from "./format";
export function SpendingList({
  groups,
  onSelect,
  monthlyBudget,
}: {
  groups: FinanceSpendingDashboard["groups"];
  onSelect: (group: FinanceSpendingGroup) => void;
  monthlyBudget?: FinanceSpendingMonthlyBudget;
}) {
  const [sort, setSort] = useState<"name" | "spent" | "budget">("spent");
  const [ascending, setAscending] = useState(false);
  const changeSort = (value: typeof sort) => {
    setAscending(value === sort ? !ascending : value === "name");
    setSort(value);
  };
  const budgetFor = (id: string) =>
    monthlyBudget?.state === "qualified"
      ? monthlyBudget.groups.find((item) => item.groupId === id)
      : undefined;
  const budgetValue = (id: string) => {
    const budget = budgetFor(id);
    if (!budget || budget.budgetCents === null || budget.budgetCents === undefined) return null;
    if (budget.budgetCents === 0) return budget.usedCents > 0 ? Number.POSITIVE_INFINITY : 0;
    return budget.usedCents / budget.budgetCents;
  };
  const compare = (a: FinanceSpendingGroup, b: FinanceSpendingGroup) => {
    if (sort === "budget") {
      const left = budgetValue(a.id),
        right = budgetValue(b.id);
      if (left === null) return right === null ? a.label.localeCompare(b.label) : 1;
      if (right === null) return -1;
      if (left === right) return a.label.localeCompare(b.label);
      return (left - right) * (ascending ? 1 : -1);
    }
    return (
      (sort === "name" ? a.label.localeCompare(b.label) : a.netCents - b.netCents) *
      (ascending ? 1 : -1)
    );
  };
  const ordered = [...groups].sort(compare);
  const budgetCopy = (id: string) => {
    const budget = budgetFor(id);
    if (!budget) return "Budget unavailable";
    if (budget.budgetCents === null || budget.budgetCents === undefined) return "No budget limit";
    if (budget.budgetCents === 0)
      return `${monthlyBudget?.state === "qualified" && monthlyBudget.coverage !== "complete" ? "Observed monthly" : "Monthly"} ${formatMoney(budget.usedCents / 100)} of ${formatMoney(0)} · ${budget.usedCents > 0 ? `Over budget ${formatMoney(budget.usedCents / 100)}` : "No utilization"}`;
    return `${monthlyBudget?.state === "qualified" && monthlyBudget.coverage !== "complete" ? "Observed monthly" : "Monthly"} ${formatMoney(budget.usedCents / 100)} of ${formatMoney(budget.budgetCents / 100)} · ${((budget.usedCents / budget.budgetCents) * 100).toFixed(1)}%${budget.usedCents > budget.budgetCents ? ` · Over budget ${formatMoney((budget.usedCents - budget.budgetCents) / 100)}` : ""}`;
  };
  const row = (group: FinanceSpendingGroup) => (
    <div className="flex flex-wrap items-center justify-between gap-3 py-3">
      <Button variant="ghost" onClick={() => onSelect(group)}>
        {group.label}
      </Button>
      <div className="text-right">
        <p>{formatMoney(group.netCents / 100)}</p>
        <p className="text-xs text-muted-foreground">
          Pending {formatMoney(group.pendingCents / 100)}
        </p>
        <p className="text-xs text-muted-foreground">{budgetCopy(group.id)}</p>
      </div>
    </div>
  );
  return (
    <section aria-label="Spending list">
      <div className="flex flex-wrap gap-2">
        <Button variant="ghost" onClick={() => changeSort("name")}>
          Name {sort === "name" ? (ascending ? "↑" : "↓") : ""}
        </Button>
        <Button variant="ghost" onClick={() => changeSort("spent")}>
          Spent {sort === "spent" ? (ascending ? "↑" : "↓") : ""}
        </Button>
        <Button variant="ghost" onClick={() => changeSort("budget")}>
          Monthly budget used {sort === "budget" ? (ascending ? "↑" : "↓") : ""}
        </Button>
      </div>
      <ul>
        {ordered.map((group) => (
          <li key={group.id}>
            {row(group)}
            {group.categories.length ? (
              <details className="pl-4">
                <summary className="cursor-pointer text-sm">Categories in {group.label}</summary>
                <ul>
                  {[...group.categories].sort(compare).map((category) => (
                    <li key={category.id}>{row(category)}</li>
                  ))}
                </ul>
              </details>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
