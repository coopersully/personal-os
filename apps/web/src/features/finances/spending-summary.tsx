import type { FinanceSpendingDashboard, FinanceSpendingGroup } from "@personal-os/domain";
import { formatDateOnly } from "@personal-os/domain";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DialogTrigger } from "@/components/ui/dialog";
import { formatMoney } from "./format";

export function spendingSummaryBudget(result: FinanceSpendingDashboard) {
  const budget = result.monthlyBudget;
  if (budget?.state !== "qualified") return null;
  // Parent groups and their categories represent the same money: count parents only.
  const rows = budget.groups.filter((row) =>
    result.groups.some((group) => group.id === row.groupId),
  );
  const limit = rows.reduce((sum, row) => sum + (row.budgetCents ?? 0), 0);
  const used = rows.reduce((sum, row) => sum + row.usedCents, 0);
  return { limit, used, rows, month: formatDateOnly(budget.period.from, { month: "short" }) };
}
function Fill({ used, limit }: { used: number; limit: number }) {
  if (limit <= 0) return null;
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-y-0 left-0 bg-primary/10"
      style={{ width: `${Math.min(100, Math.max(0, (used / limit) * 100))}%` }}
    />
  );
}
export function SpendingSummary({
  result,
  today,
  days,
  averageCents,
  largestGroup,
  onSelect,
}: {
  result: FinanceSpendingDashboard;
  today: string;
  days: number;
  averageCents: number;
  largestGroup: FinanceSpendingGroup | undefined;
  onSelect: (group: FinanceSpendingGroup) => void;
}) {
  const budget = spendingSummaryBudget(result);
  const groupBudget = budget?.rows.find((row) => row.groupId === largestGroup?.id);
  const progress =
    budget && budget.limit > 0
      ? `${budget.month}: ${Math.round((budget.used / budget.limit) * 100)}% of ${formatMoney(budget.limit / 100)}`
      : "Budget unavailable";
  const throughToday =
    result.snapshot.scope.from <= today && result.snapshot.scope.through >= today;
  return (
    <div className="grid min-w-0 grid-cols-2 gap-3 sm:grid-cols-3">
      <Card size="sm" className="relative col-span-2 sm:col-span-1">
        <Fill used={budget?.used ?? 0} limit={budget?.limit ?? 0} />
        <DialogTrigger asChild>
          <button
            type="button"
            aria-label="Spending breakdown"
            className="relative w-full text-left"
          >
            <CardHeader>
              <CardTitle>
                {result.snapshot.scope.basis === "personal_cost"
                  ? "Total spending"
                  : "Full outflow"}
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2 pt-0">
              <p className="text-2xl font-semibold tracking-tight tabular-nums lg:text-3xl">
                {formatMoney(result.snapshot.netCents / 100)}
              </p>
              <p className="truncate text-xs text-muted-foreground" title={progress}>
                {progress}
              </p>
            </CardContent>
          </button>
        </DialogTrigger>
      </Card>
      <Card size="sm" className="relative">
        <Fill used={budget?.used ?? 0} limit={budget?.limit ?? 0} />
        <CardHeader className="relative">
          <CardTitle>Daily average</CardTitle>
        </CardHeader>
        <CardContent className="relative flex flex-col gap-2">
          <p className="text-2xl font-semibold tracking-tight tabular-nums lg:text-3xl">
            {days ? formatMoney(averageCents / 100) : "—"}
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {days ? (throughToday ? "Through today" : `${days} days elapsed`) : "No elapsed days"}
          </p>
        </CardContent>
      </Card>
      <Card size="sm" className="relative">
        <Fill used={groupBudget?.usedCents ?? 0} limit={groupBudget?.budgetCents ?? 0} />
        <CardHeader className="relative">
          <CardTitle>Top group</CardTitle>
        </CardHeader>
        <CardContent className="relative flex flex-col gap-2">
          <p className="text-2xl font-semibold tracking-tight tabular-nums lg:text-3xl">
            {largestGroup ? formatMoney(largestGroup.netCents / 100) : "—"}
          </p>
          {largestGroup ? (
            <button
              type="button"
              className="max-w-full truncate text-left text-xs text-muted-foreground hover:text-foreground"
              aria-label={`Inspect largest spending group: ${largestGroup.label}`}
              title={
                groupBudget?.budgetCents
                  ? `${budget?.month}: ${formatMoney(groupBudget.usedCents / 100)} of ${formatMoney(groupBudget.budgetCents / 100)}`
                  : "No monthly budget for this group"
              }
              onClick={() => onSelect(largestGroup)}
            >
              {largestGroup.label}
              {groupBudget?.budgetCents
                ? ` · ${Math.round((groupBudget.usedCents / groupBudget.budgetCents) * 100)}%`
                : ""}
            </button>
          ) : (
            <p className="text-xs text-muted-foreground">No spending yet</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export function SpendingSummaryBreakdown({ result }: { result: FinanceSpendingDashboard }) {
  const hasNegative = result.snapshot.bins.some((bin) => bin.netCents < 0);
  const maximum = Math.max(1, ...result.snapshot.bins.map((bin) => Math.abs(bin.netCents)));
  const pending = result.snapshot.contributions
    .filter((row) => row.pending)
    .reduce((sum, row) => sum + row.netCents, 0);
  return (
    <div className="flex flex-col gap-4">
      <p className="text-3xl font-semibold tabular-nums">
        {formatMoney(result.snapshot.netCents / 100)}
      </p>
      <figure className="flex flex-col gap-2">
        <figcaption className="text-sm font-medium">Daily spending</figcaption>
        <div
          className="relative flex h-28 gap-px"
          role="img"
          aria-label={
            hasNegative
              ? "Daily net spending: purchases above the midpoint, net refunds and adjustments below"
              : "Daily recorded spending in the selected range"
          }
        >
          <div
            aria-hidden="true"
            className={
              hasNegative
                ? "absolute inset-x-0 top-1/2 border-t border-border"
                : "absolute inset-x-0 bottom-0 border-t border-border"
            }
          />
          {result.snapshot.bins.map((bin) => (
            <div
              key={bin.date}
              className="relative min-w-0 flex-1"
              title={`${formatDateOnly(bin.date, { month: "short", day: "numeric", year: "numeric" })}: ${formatMoney(bin.netCents / 100)}${bin.future ? " · Future date" : ""}`}
            >
              <div
                className={
                  bin.netCents < 0
                    ? "absolute inset-x-0 top-1/2 rounded-b-sm bg-primary/40"
                    : hasNegative
                      ? "absolute inset-x-0 bottom-1/2 rounded-t-sm bg-primary/40"
                      : "absolute inset-x-0 bottom-0 rounded-t-sm bg-primary/40"
                }
                style={{
                  height: `${(Math.abs(bin.netCents) / maximum) * (hasNegative ? 50 : 100)}%`,
                }}
              />
            </div>
          ))}
        </div>
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>
            {formatDateOnly(result.snapshot.scope.from, { month: "short", day: "numeric" })}
          </span>
          <span>
            {formatDateOnly(result.snapshot.scope.through, { month: "short", day: "numeric" })}
          </span>
        </div>
      </figure>
      <dl className="grid grid-cols-2 gap-2 text-sm">
        <dt>Posted</dt>
        <dd className="text-right tabular-nums">
          {formatMoney((result.snapshot.netCents - pending) / 100)}
        </dd>
        <dt>Pending</dt>
        <dd className="text-right tabular-nums">{formatMoney(pending / 100)}</dd>
      </dl>
      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-medium">Breakdown</h3>
        {result.groups.map((group) => (
          <div key={group.id} className="flex justify-between gap-3 text-sm">
            <span>{group.label}</span>
            <span className="tabular-nums">{formatMoney(group.netCents / 100)}</span>
          </div>
        ))}
      </div>
      <p className="text-sm text-muted-foreground">
        Fills show the displayed groups’ monthly budget usage across budget accounts, including
        unbudgeted spending.
      </p>
      <p className="text-sm text-muted-foreground">
        {result.snapshot.coverage !== "complete"
          ? "Partial or unverified coverage: some dates or accounts lack complete history. "
          : "Verified coverage. "}
        {result.snapshot.scope.includePending
          ? "Includes pending transactions; amounts can change when they post."
          : "Posted transactions only."}
      </p>
    </div>
  );
}
