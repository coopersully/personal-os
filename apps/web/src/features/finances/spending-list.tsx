import type {
  FinanceSpendingDashboard,
  FinanceSpendingGroup,
  FinanceSpendingMonthlyBudget,
} from "@personal-os/domain";
import { useId, useState } from "react";
import { ChevronRightIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Item, ItemGroup } from "@/components/ui/item";
import { Progress } from "@/components/ui/progress";
import { formatMoney } from "./format";
import { spendingGroupVisual } from "./spending-visual";
export function SpendingList({
  groups,
  onSelect,
  monthlyBudget,
}: {
  groups: FinanceSpendingDashboard["groups"];
  onSelect: (group: FinanceSpendingGroup) => void;
  monthlyBudget?: FinanceSpendingMonthlyBudget;
}) {
  const descriptionId = useId();
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
  const row = (group: FinanceSpendingGroup) => {
    const budget = budgetFor(group.id);
    const limit = budget?.budgetCents;
    const used = budget?.usedCents ?? 0;
    const remaining = limit == null ? null : limit - used;
    const visual = spendingGroupVisual(group);
    const Icon = visual.Icon;
    const caption =
      limit == null || limit === 0
        ? budgetCopy(group.id)
        : `${formatMoney(used / 100)} / ${formatMoney(limit / 100)} · ${formatMoney(Math.abs(remaining ?? 0) / 100)} ${(remaining ?? 0) < 0 ? "over" : "left"}`;
    return (
      <Item asChild size="sm">
        <button
          type="button"
          aria-label={group.label}
          aria-describedby={`${descriptionId}-${group.id}`}
          onClick={() => onSelect(group)}
          className="grid w-full grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1 text-left sm:grid-cols-[minmax(0,1fr)_7rem_minmax(12rem,1fr)]"
        >
          <span className="flex min-w-0 items-center gap-2">
            <Icon className="size-4 shrink-0 text-muted-foreground" />
            <span className="truncate text-sm font-medium">{group.label}</span>
          </span>
          <span className="flex items-center justify-end gap-2 text-sm font-medium tabular-nums sm:justify-end">
            {formatMoney(group.netCents / 100)}
            <ChevronRightIcon className="size-3 text-muted-foreground sm:hidden" />
          </span>
          <div
            className="col-span-2 flex min-w-0 flex-col gap-1.5 sm:col-span-1"
            title={budgetCopy(group.id)}
          >
            <span className="truncate text-xs text-muted-foreground tabular-nums">{caption}</span>
            {limit != null && limit > 0 ? (
              <Progress
                value={Math.min(100, Math.max(0, (used / limit) * 100))}
                aria-label={`${group.label} monthly budget`}
                aria-valuetext={budgetCopy(group.id)}
              />
            ) : null}
          </div>
          {group.pendingCents !== 0 ? (
            <span className="col-span-2 truncate text-xs text-muted-foreground sm:col-span-3">
              {formatMoney(group.pendingCents / 100)} pending
            </span>
          ) : null}
          <span className="sr-only" id={`${descriptionId}-${group.id}`}>
            Selected period {formatMoney(group.netCents / 100)}. {budgetCopy(group.id)}.
            {group.pendingCents !== 0 ? ` Pending ${formatMoney(group.pendingCents / 100)}.` : ""}
          </span>
        </button>
      </Item>
    );
  };
  return (
    <section aria-label="Spending list" className="flex min-w-0 flex-col gap-2">
      <div className="flex items-center justify-between gap-3 px-1">
        <h2 className="text-sm font-medium">Breakdown</h2>
        <span className="text-xs text-muted-foreground">
          Monthly budget
          {monthlyBudget?.state === "qualified" && monthlyBudget.coverage !== "complete"
            ? " · observed"
            : ""}
        </span>
      </div>
      <Card>
        <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2 px-2 py-1 sm:grid-cols-[minmax(0,1fr)_7rem_minmax(12rem,1fr)]">
          <Button
            variant="ghost"
            size="sm"
            className="justify-start"
            onClick={() => changeSort("name")}
          >
            Name {sort === "name" ? (ascending ? "↑" : "↓") : ""}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => changeSort("spent")}>
            Spent {sort === "spent" ? (ascending ? "↑" : "↓") : ""}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            aria-label="Monthly budget used"
            className="justify-start"
            onClick={() => changeSort("budget")}
          >
            Budget used {sort === "budget" ? (ascending ? "↑" : "↓") : ""}
          </Button>
        </div>
        <ItemGroup role="presentation" className="gap-0">
          <ul className="flex flex-col divide-y divide-border/50">
            {ordered.map((group) => (
              <li key={group.id} className="min-w-0">
                {row(group)}
                {group.categories.length ? (
                  <details className="px-3 pb-2">
                    <summary
                      aria-label={`Categories in ${group.label}`}
                      className="cursor-pointer text-xs text-muted-foreground"
                    >
                      {group.categories.length}{" "}
                      {group.categories.length === 1 ? "category" : "categories"}
                    </summary>
                    <ul className="mt-2 flex flex-col gap-1 border-l border-border/50 pl-2">
                      {[...group.categories].sort(compare).map((category) => (
                        <li key={category.id}>{row(category)}</li>
                      ))}
                    </ul>
                  </details>
                ) : null}
              </li>
            ))}
          </ul>
        </ItemGroup>
      </Card>
    </section>
  );
}
