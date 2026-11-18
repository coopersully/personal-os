import type {
  FinanceSpendingDailyBin,
  FinanceSpendingDashboard,
  FinanceSpendingDrillDown,
  FinanceSpendingScope,
} from "@personal-os/domain";
import type { ReactNode } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Tooltip as ChartTooltip,
  ReferenceLine,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from "recharts";
import { InfoIcon } from "@/components/icons";
import {
  ResponsiveDialog as Dialog,
  ResponsiveDialogContent as DialogContent,
  ResponsiveDialogDescription as DialogDescription,
  ResponsiveDialogHeader as DialogHeader,
  ResponsiveDialogTitle as DialogTitle,
  ResponsiveDialogTrigger as DialogTrigger,
  ResponsiveDialogBody,
} from "@/components/responsive-dialog";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatCalendarDate } from "@/lib/date-format";
import { formatMoney } from "./format";

const dayMs = 86_400_000;
const date = (value: string) => new Date(`${value}T12:00:00Z`);
const iso = (value: Date) => value.toISOString().slice(0, 10);
const shift = (value: string, days: number) => iso(new Date(date(value).getTime() + days * dayMs));
const daysBetween = (from: string, through: string) =>
  Math.round((date(through).getTime() - date(from).getTime()) / dayMs) + 1;

export function spendingComparisonScopes(
  scope: FinanceSpendingScope,
  periodKind: "today" | "week" | "month" | "custom",
  asOf: string,
) {
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: scope.timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(asOf));
  const current = {
    ...scope,
    through:
      periodKind !== "custom" && scope.from <= today && today < scope.through
        ? today
        : scope.through,
  };
  const count = daysBetween(current.from, current.through);
  let previousFrom = shift(current.from, -count);
  let previousThrough = shift(current.from, -1);
  let label = "Previous equal-length period";
  if (periodKind === "today") label = "Previous day";
  if (periodKind === "week") {
    previousFrom = shift(scope.from, -7);
    previousThrough = shift(previousFrom, count - 1);
    label = count < 7 ? "Previous week · equal elapsed days" : "Previous week";
  }
  if (periodKind === "month") {
    const start = date(scope.from);
    previousFrom = iso(new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() - 1, 1, 12)));
    const previousEnd = shift(scope.from, -1);
    previousThrough =
      current.through === scope.through
        ? previousEnd
        : shift(previousFrom, Math.min(count, daysBetween(previousFrom, previousEnd)) - 1);
    label =
      current.through < scope.through ? "Previous month · equal elapsed days" : "Previous month";
    if (current.through < scope.through && daysBetween(previousFrom, previousThrough) < count)
      label += " · capped at month end";
  }
  return { current, previous: { ...scope, from: previousFrom, through: previousThrough }, label };
}

export function spendingBinStatus(bin: FinanceSpendingDailyBin): string {
  return [
    bin.future
      ? "Future"
      : bin.coverage !== "complete"
        ? `${bin.coverage === "unknown" ? "Missing" : "Partial"} coverage`
        : bin.netCents === 0
          ? "Confirmed zero"
          : bin.netCents < 0
            ? "Net refund"
            : "Spending",
    bin.provisional ? "Provisional" : "",
    bin.pendingCents !== 0 ? `Pending ${formatMoney(bin.pendingCents / 100)}` : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

export function spendingTrendBins(dashboard: FinanceSpendingDashboard) {
  const { snapshot } = dashboard;
  const length = daysBetween(snapshot.scope.from, snapshot.scope.through);
  const grain = length <= 31 ? "Daily" : length <= 180 ? "Weekly" : "Monthly";
  const groups = new Map<string, FinanceSpendingDailyBin[]>();
  for (const bin of snapshot.bins) {
    const key =
      grain === "Daily"
        ? bin.date
        : grain === "Monthly"
          ? bin.date.slice(0, 7)
          : shift(
              snapshot.scope.from,
              Math.floor((daysBetween(snapshot.scope.from, bin.date) - 1) / 7) * 7,
            );
    groups.set(key, [...(groups.get(key) ?? []), bin]);
  }
  return {
    grain,
    bins: [...groups.values()].flatMap((bins) => {
      const first = bins[0];
      const last = bins[bins.length - 1];
      if (!first || !last) return [];
      const from = first.date;
      const through = last.date;
      return [
        {
          ...first,
          date: from,
          label: from === through ? from : `${from} – ${through}`,
          netCents: bins.reduce((sum, bin) => sum + bin.netCents, 0),
          positiveAreaCents: bins.reduce((sum, bin) => sum + bin.positiveAreaCents, 0),
          negativeAdjustmentCents: bins.reduce((sum, bin) => sum + bin.negativeAdjustmentCents, 0),
          pendingCents: bins.reduce((sum, bin) => sum + bin.pendingCents, 0),
          coverage: bins.every((bin) => bin.coverage === "complete")
            ? ("complete" as const)
            : bins.every((bin) => bin.coverage === "unknown")
              ? ("unknown" as const)
              : ("partial" as const),
          provisional: bins.some((bin) => bin.provisional),
          future: bins.every((bin) => bin.future),
          partial:
            grain === "Weekly"
              ? bins.length < 7
              : grain === "Monthly"
                ? from.slice(8) !== "01" || shift(through, 1).slice(8) !== "01"
                : false,
          drillDown:
            grain === "Daily"
              ? first.drillDown
              : {
                  scope: { ...snapshot.scope, from, through },
                  contributionIds: [
                    ...new Set(bins.flatMap((bin) => bin.drillDown.contributionIds)),
                  ],
                  transactionIds: [...new Set(bins.flatMap((bin) => bin.drillDown.transactionIds))],
                },
        },
      ];
    }),
  };
}

export function FinanceSpendingTrends({
  dashboard,
  comparison,
  comparisonLoading = false,
  comparisonLabel = "Previous period",
  onSelect,
  focusControl,
}: {
  focusControl?: ReactNode;
  dashboard: FinanceSpendingDashboard;
  comparison?: FinanceSpendingDashboard;
  comparisonLoading?: boolean;
  comparisonLabel?: string;
  onSelect: (drillDown: FinanceSpendingDrillDown) => void;
}) {
  const { grain, bins } = spendingTrendBins(dashboard);
  const change = comparison ? dashboard.snapshot.netCents - comparison.snapshot.netCents : null;
  const qualified =
    dashboard.snapshot.coverage !== "complete" ||
    comparison?.snapshot.coverage !== "complete" ||
    dashboard.source.freshness !== "current" ||
    comparison?.source.freshness !== "current";
  const chartData = bins.map((bin) => ({ ...bin, spending: bin.netCents / 100 }));
  return (
    <section aria-label="Spending trends" className="flex min-w-0 flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-medium">Trends</h2>
        {focusControl}
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Spending over time</CardTitle>
          <CardDescription>
            <span aria-live="polite">
              {comparisonLoading
                ? "Loading previous period"
                : change === null
                  ? "Previous-period comparison unavailable"
                  : `${formatMoney(change / 100)} change · ${comparison?.snapshot.netCents === 0 ? "Percentage unavailable" : `${((change / (comparison?.snapshot.netCents ?? 1)) * 100).toFixed(1)}%`}`}
            </span>
            {comparison && (
              <span className="block text-xs mt-1">
                {comparisonLabel} · {formatCalendarDate(comparison.snapshot.scope.from)} –{" "}
                {formatCalendarDate(comparison.snapshot.scope.through)}
              </span>
            )}
          </CardDescription>
          <CardAction>
            <Dialog>
              <DialogTrigger asChild>
                <Button variant="ghost" size="icon-sm" aria-label="Trend details">
                  <InfoIcon />
                </Button>
              </DialogTrigger>
              <DialogContent data-finance-dialog data-finance-size="wide">
                <DialogHeader>
                  <DialogTitle>Trend details</DialogTitle>
                  <DialogDescription>
                    {grain} net spending · Source {dashboard.source.freshness}
                    {qualified ? " · Incomplete coverage; comparison may change" : ""}
                  </DialogDescription>
                </DialogHeader>
                <ResponsiveDialogBody>
                  {dashboard.currency.unsupported.length > 0 && (
                    <p className="text-sm text-muted-foreground">
                      Unsupported currencies excluded:{" "}
                      {dashboard.currency.unsupported
                        .map((entry) => entry.code ?? "Unknown currency")
                        .join(", ")}
                    </p>
                  )}
                  <Table>
                    <caption className="sr-only">Spending trends data</caption>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Period</TableHead>
                        <TableHead className="text-right">Net spending</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {bins.map((bin) => (
                        <TableRow key={bin.date}>
                          <TableCell>
                            <Button
                              variant="link"
                              onClick={() => onSelect(bin.drillDown)}
                              aria-label={bin.label}
                            >
                              {formatCalendarDate(bin.date)}
                            </Button>
                            {bin.label !== bin.date && (
                              <span className="block text-xs text-muted-foreground">
                                through {formatCalendarDate(bin.drillDown.scope.through)}
                              </span>
                            )}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatMoney(bin.netCents / 100)}
                            {bin.negativeAdjustmentCents > 0 && (
                              <span className="block text-xs text-muted-foreground">
                                Refunds/adjustments −
                                {formatMoney(bin.negativeAdjustmentCents / 100)}
                              </span>
                            )}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {spendingBinStatus(bin)}
                            {bin.partial ? " · Partial bin" : ""}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  {comparison && (
                    <Table>
                      <caption className="sr-only">
                        Contribution to the change by category or bucket
                      </caption>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Group</TableHead>
                          <TableHead className="text-right">Change</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {[
                          ...new Set([
                            ...dashboard.groups.map((group) => group.id),
                            ...comparison.groups.map((group) => group.id),
                          ]),
                        ].map((id) => {
                          const current = dashboard.groups.find((group) => group.id === id);
                          const previous = comparison.groups.find((group) => group.id === id);
                          return (
                            <TableRow key={id}>
                              <TableCell>{current?.label ?? previous?.label}</TableCell>
                              <TableCell className="text-right tabular-nums">
                                {formatMoney(
                                  ((current?.netCents ?? 0) - (previous?.netCents ?? 0)) / 100,
                                )}
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  )}
                </ResponsiveDialogBody>
              </DialogContent>
            </Dialog>
          </CardAction>
        </CardHeader>
        <CardContent>
          <div
            role="img"
            className="h-64 w-full min-w-0 text-xs text-muted-foreground sm:h-80"
            aria-label={`${grain} net spending chart`}
          >
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                data={chartData}
                onClick={(state) => {
                  const bin = state?.activePayload?.[0]?.payload as
                    | (typeof chartData)[number]
                    | undefined;
                  if (bin) onSelect(bin.drillDown);
                }}
                margin={{ top: 12, right: 8, bottom: 0, left: 0 }}
              >
                <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 3" />
                <XAxis
                  dataKey="date"
                  tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
                  tickLine={false}
                  axisLine={false}
                  minTickGap={30}
                  tickMargin={12}
                  tickFormatter={(value: string) =>
                    new Intl.DateTimeFormat("en", {
                      month: "short",
                      day: "numeric",
                      timeZone: "UTC",
                    }).format(date(value))
                  }
                />
                <YAxis
                  tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
                  tickLine={false}
                  axisLine={false}
                  width={58}
                  tickFormatter={(value: number) =>
                    new Intl.NumberFormat("en", {
                      style: "currency",
                      currency: "USD",
                      notation: "compact",
                      maximumFractionDigits: 1,
                    }).format(value)
                  }
                />
                <ReferenceLine y={0} stroke="var(--border)" />
                <ChartTooltip
                  cursor={{ fill: "var(--muted)", opacity: 0.4 }}
                  content={({ active, payload }) => {
                    const bin = active
                      ? (payload?.[0]?.payload as (typeof chartData)[number] | undefined)
                      : undefined;
                    if (!bin) return null;
                    return (
                      <div className="grid max-w-64 gap-1 rounded-lg border border-border bg-popover p-3 text-sm text-popover-foreground">
                        <span className="text-xs text-muted-foreground">
                          {formatCalendarDate(bin.date)}
                          {bin.label !== bin.date
                            ? ` – ${formatCalendarDate(bin.drillDown.scope.through)}`
                            : ""}
                        </span>
                        <span className="font-medium tabular-nums">
                          {formatMoney(bin.spending)}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {spendingBinStatus(bin)}
                          {bin.partial ? " · Partial bin" : ""}
                        </span>
                        {bin.negativeAdjustmentCents > 0 && (
                          <span className="text-xs">
                            Refunds/adjustments −{formatMoney(bin.negativeAdjustmentCents / 100)}
                          </span>
                        )}
                      </div>
                    );
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="spending"
                  name="Net spending"
                  stroke="var(--workspace-finances-accent)"
                  strokeWidth={2}
                  fill="var(--workspace-finances-accent)"
                  fillOpacity={0.18}
                  baseValue={0}
                  dot={false}
                  activeDot={{ r: 5 }}
                  isAnimationActive={false}
                  className="cursor-pointer"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <fieldset
            className="sr-only min-w-0 focus-within:not-sr-only focus-within:flex focus-within:flex-wrap focus-within:gap-1"
            aria-label="Spending over time"
          >
            {bins.map((bin) => (
              <Button
                key={bin.date}
                variant="ghost"
                aria-label={`${bin.label}: ${formatMoney(bin.netCents / 100)}; ${spendingBinStatus(bin)}${bin.partial ? "; Partial bin" : ""}`}
                onClick={() => onSelect(bin.drillDown)}
              >
                {formatCalendarDate(bin.date)} · {formatMoney(bin.netCents / 100)}
              </Button>
            ))}
          </fieldset>
        </CardContent>
      </Card>
    </section>
  );
}
