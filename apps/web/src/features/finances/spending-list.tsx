import type {
  FinanceSpendingDashboard,
  FinanceSpendingGroup,
  FinanceSpendingMonthlyBudget,
} from "@personal-os/domain";
import { useId, useState } from "react";
import { SortIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Item, ItemGroup } from "@/components/ui/item";
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
        : `${Math.round((used / limit) * 100)}% (${formatMoney(used / 100)}) of ${formatMoney(limit / 100)} used, ${formatMoney(Math.abs(remaining ?? 0) / 100)} ${(remaining ?? 0) < 0 ? "over" : "left"}`;
    return (
      <Item asChild size="sm">
        <button
          type="button"
          aria-label={group.label}
          aria-describedby={`${descriptionId}-${group.id}`}
          onClick={() => onSelect(group)}
          style={{ backgroundColor: visual.backgroundColor }}
          className="relative isolate grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-4 overflow-hidden text-left"
        >
          {limit != null && limit > 0 ? (
            <span
              aria-hidden="true"
              className="pointer-events-none absolute inset-y-0 left-0 -z-10 transition-[width] duration-500 motion-reduce:transition-none"
              style={{
                backgroundColor: visual.fillColor,
                width: `${Math.min(100, Math.max(0, (used / limit) * 100))}%`,
              }}
            />
          ) : null}
          <span className="flex min-w-0 items-center gap-3">
            <span
              aria-hidden="true"
              className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-foreground/15 bg-background/40"
            >
              <Icon className="size-5 text-foreground" />
            </span>
            <span className="flex min-w-0 flex-col gap-1">
              <span className="truncate text-sm font-medium">{group.label}</span>
              <span
                className="text-xs leading-relaxed text-muted-foreground tabular-nums"
                title={budgetCopy(group.id)}
              >
                {caption}
              </span>
            </span>
          </span>
          <span className="text-xl font-semibold tracking-tight tabular-nums sm:text-2xl">
            {formatMoney(group.netCents / 100)}
          </span>
          <span className="sr-only" id={`${descriptionId}-${group.id}`}>
            Selected period {formatMoney(group.netCents / 100)}. {budgetCopy(group.id)}.
          </span>
        </button>
      </Item>
    );
  };
  return (
    <section aria-label="Spending list" className="flex min-w-0 flex-col gap-2">
      <div className="flex items-center justify-between gap-3 px-1">
        <h2 className="text-sm font-medium">Breakdown</h2>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">
            Monthly budget
            {monthlyBudget?.state === "qualified" && monthlyBudget.coverage !== "complete"
              ? " · observed"
              : ""}
          </span>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Sort breakdown"
                title="Sort breakdown"
              >
                <SortIcon />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuGroup>
                {(
                  [
                    ["name", "Name"],
                    ["spent", "Spent"],
                    ["budget", "Monthly budget used"],
                  ] as const
                ).map(([value, label]) => (
                  <DropdownMenuItem
                    key={value}
                    aria-label={label}
                    onSelect={() => changeSort(value)}
                  >
                    <SortIcon />
                    {label}
                    {sort === value ? (
                      <span className="ml-auto text-muted-foreground">{ascending ? "↑" : "↓"}</span>
                    ) : null}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      <ItemGroup role="presentation" className="gap-0">
        <ul className="flex flex-col gap-3">
          {ordered.map((group) => (
            <li key={group.id} className="min-w-0">
              {row(group)}
              {group.kind !== "bucket" && group.categories.length ? (
                <details className="px-3 pb-2">
                  <summary
                    aria-label={`Categories in ${group.label}`}
                    className="cursor-pointer text-xs text-muted-foreground"
                  >
                    {group.categories.length}{" "}
                    {group.categories.length === 1 ? "category" : "categories"}
                  </summary>
                  <ul className="mt-2 flex flex-col gap-1 pl-2">
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
    </section>
  );
}
