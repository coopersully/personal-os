import type { FinanceSpendingDashboard, FinanceSpendingGroup } from "@personal-os/domain";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { formatMoney } from "./format";
export function SpendingList({
  groups,
  onSelect,
}: {
  groups: FinanceSpendingDashboard["groups"];
  onSelect: (group: FinanceSpendingGroup) => void;
}) {
  const [sort, setSort] = useState<"name" | "spent">("spent");
  const [ascending, setAscending] = useState(false);
  const changeSort = (value: typeof sort) => {
    setAscending(value === sort ? !ascending : value === "name");
    setSort(value);
  };
  const ordered = [...groups].sort(
    (a, b) =>
      (sort === "name" ? a.label.localeCompare(b.label) : a.netCents - b.netCents) *
      (ascending ? 1 : -1),
  );
  const row = (group: FinanceSpendingGroup) => (
    <div className="flex flex-wrap items-center justify-between gap-3 py-3">
      <Button variant="ghost" onClick={() => onSelect(group)}>
        {group.label}
      </Button>
      <div className="text-right">
        <p>{formatMoney(group.netCents / 100)}</p>
        <p className="text-xs text-muted-foreground">
          Pending {formatMoney(group.pendingCents / 100)} · Budget unavailable
        </p>
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
        <span className="self-center text-sm text-muted-foreground">Budget used: unavailable</span>
      </div>
      <ul>
        {ordered.map((group) => (
          <li key={group.id}>
            {row(group)}
            {group.categories.length ? (
              <details className="pl-4">
                <summary className="cursor-pointer text-sm">Categories in {group.label}</summary>
                <ul>
                  {group.categories.map((category) => (
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
