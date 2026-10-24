import type { FinanceSpendingDashboard, FinanceSpendingGroup } from "@personal-os/domain";
import { formatDateOnly } from "@personal-os/domain";
import { ResponsiveDialogTrigger as DialogTrigger } from "@/components/responsive-dialog";
import { RollingNumber } from "@/components/rolling-number";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";
import { formatMoney } from "./format";
import { spendingGroupVisual } from "./spending-visual";

export function spendingSummaryBudget(result: FinanceSpendingDashboard) {
  const budget = result.monthlyBudget;
  if (budget?.state !== "qualified") return null;
  // Parent groups and their categories represent the same money: count parents only.
  const rows = budget.groups.filter((row) =>
    result.groups.some((group) => group.id === row.groupId),
  );
  const limit = rows.reduce((sum, row) => sum + (row.budgetCents ?? 0), 0);
  const used = rows.reduce((sum, row) => sum + row.usedCents, 0);
  return {
    limit,
    used,
    rows,
    month: formatDateOnly(budget.period.from, { month: "short", year: "numeric" }),
  };
}
function Fill({ used, limit }: { used: number; limit: number }) {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-y-0 left-0 bg-primary/10 transition-[width] duration-500 ease-out motion-reduce:transition-none"
      style={{ width: `${Math.min(100, Math.max(0, limit > 0 ? (used / limit) * 100 : 0))}%` }}
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
      ? `${budget.month} budget · ${formatMoney(budget.limit / 100)} · ${Math.round((budget.used / budget.limit) * 100)}% used`
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
            className="relative w-full rounded-xl text-left border border-transparent focus-visible:border-foreground/50"
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
                <RollingNumber
                  value={result.snapshot.netCents}
                  formatted={formatMoney(result.snapshot.netCents / 100)}
                />
              </p>
              <p
                className="truncate text-xs text-muted-foreground"
                title={
                  budget
                    ? `${budget.month} observed spending ${formatMoney(budget.used / 100)} of ${formatMoney(budget.limit / 100)}`
                    : progress
                }
              >
                {progress}
              </p>
            </CardContent>
          </button>
        </DialogTrigger>
      </Card>
      <Card
        size="sm"
        className="relative"
        aria-description={
          budget
            ? `Fill shows ${budget.month} budget usage: ${formatMoney(budget.used / 100)} of ${formatMoney(budget.limit / 100)}.`
            : "Monthly budget unavailable."
        }
      >
        <Fill used={budget?.used ?? 0} limit={budget?.limit ?? 0} />
        <CardHeader className="relative">
          <CardTitle>Daily average</CardTitle>
        </CardHeader>
        <CardContent className="relative flex flex-col gap-2">
          <p className="text-2xl font-semibold tracking-tight tabular-nums lg:text-3xl">
            {days ? (
              <RollingNumber value={averageCents} formatted={formatMoney(averageCents / 100)} />
            ) : (
              "—"
            )}
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {days
              ? `${days} ${days === 1 ? "day" : "days"}${throughToday ? " · through today" : " elapsed"}`
              : "No elapsed days"}
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
            {largestGroup ? (
              <RollingNumber
                value={largestGroup.netCents}
                formatted={formatMoney(largestGroup.netCents / 100)}
              />
            ) : (
              "—"
            )}
          </p>
          {largestGroup ? (
            <button
              type="button"
              className="max-w-full truncate rounded-sm text-left text-xs text-muted-foreground hover:text-foreground border border-transparent focus-visible:border-foreground/50"
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
                ? ` · ${budget?.month} ${Math.round((groupBudget.usedCents / groupBudget.budgetCents) * 100)}%`
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
      <div>
        <p className="text-xs text-muted-foreground">Recorded spending</p>
        <p className="mt-1 text-3xl font-semibold tracking-tight tabular-nums">
          {formatMoney(result.snapshot.netCents / 100)}
        </p>
      </div>
      <figure className="flex flex-col gap-3 rounded-lg bg-secondary p-4">
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
      <dl className="grid grid-cols-2 gap-3 text-sm">
        <div className="flex flex-col gap-1 rounded-lg bg-secondary p-3">
          <dt>Posted</dt>
          <dd>{formatMoney((result.snapshot.netCents - pending) / 100)}</dd>
        </div>
        <div className="flex flex-col gap-1 rounded-lg bg-secondary p-3">
          <dt>Pending</dt>
          <dd>{formatMoney(pending / 100)}</dd>
        </div>
      </dl>
      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-medium">Breakdown</h3>
        <ItemGroup className="gap-2">
          {result.groups.map((group) => {
            const visual = spendingGroupVisual(group);
            const Icon = visual.Icon;
            return (
              <Item key={group.id} size="xs" variant="secondary">
                <ItemMedia
                  variant="icon"
                  className="rounded-md p-2"
                  style={{ color: visual.color }}
                >
                  <Icon />
                </ItemMedia>
                <ItemContent>
                  <ItemTitle>{group.label}</ItemTitle>
                </ItemContent>
                <ItemActions className="font-medium tabular-nums">
                  {formatMoney(group.netCents / 100)}
                </ItemActions>
              </Item>
            );
          })}
        </ItemGroup>
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
