import type {
  FinanceSpendingDailyBin,
  FinanceSpendingDashboard,
  FinanceSpendingDrillDown,
  FinanceSpendingScope,
} from "@personal-os/domain";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
  onSelect,
}: {
  dashboard: FinanceSpendingDashboard;
  comparison?: FinanceSpendingDashboard;
  comparisonLoading?: boolean;
  onSelect: (drillDown: FinanceSpendingDrillDown) => void;
}) {
  const { grain, bins } = spendingTrendBins(dashboard);
  const maximum = Math.max(1, ...bins.map((bin) => bin.positiveAreaCents));
  const change = comparison ? dashboard.snapshot.netCents - comparison.snapshot.netCents : null;
  const qualified =
    dashboard.snapshot.coverage !== "complete" ||
    comparison?.snapshot.coverage !== "complete" ||
    dashboard.source.freshness !== "current" ||
    comparison?.source.freshness !== "current";
  return (
    <section aria-label="Spending trends" className="flex flex-col gap-4">
      <p>
        {grain} spending · Source {dashboard.source.freshness}
      </p>
      <p aria-live="polite">
        {comparisonLoading
          ? "Loading previous period"
          : change === null
            ? "Previous-period comparison unavailable"
            : `${formatMoney(change / 100)} change · ${comparison?.snapshot.netCents === 0 ? "Percentage unavailable" : `${((change / (comparison?.snapshot.netCents ?? 1)) * 100).toFixed(1)}%`} ${qualified ? "· Incomplete coverage; comparison may change" : ""}`}
      </p>
      {comparison && (
        <p className="text-sm text-muted-foreground">
          Compared with {comparison.snapshot.scope.from} – {comparison.snapshot.scope.through}
        </p>
      )}
      {dashboard.currency.unsupported.length > 0 && (
        <p>
          Unsupported currencies excluded:{" "}
          {dashboard.currency.unsupported
            .map((entry) => entry.code ?? "Unknown currency")
            .join(", ")}
        </p>
      )}
      <fieldset aria-label="Spending over time" className="flex items-end gap-2 overflow-x-auto">
        {bins.map((bin) => (
          <div key={bin.date} className="flex min-w-20 flex-1 flex-col gap-1">
            <Button
              variant="ghost"
              className="h-32 flex-col justify-end"
              aria-label={`${bin.label}: ${formatMoney(bin.netCents / 100)}; ${spendingBinStatus(bin)}${bin.partial ? "; Partial bin" : ""}`}
              onClick={() => onSelect(bin.drillDown)}
            >
              <span
                aria-hidden="true"
                className="w-full bg-primary"
                style={{ height: `${(bin.positiveAreaCents / maximum) * 100}%` }}
              />
              <span className="text-xs">{bin.date.slice(5)}</span>
            </Button>
            <span className="text-xs text-muted-foreground">
              {bin.negativeAdjustmentCents > 0
                ? `Refunds/adjustments −${formatMoney(bin.negativeAdjustmentCents / 100)}`
                : ""}
            </span>
          </div>
        ))}
      </fieldset>
      <Table>
        <caption className="sr-only">Spending trends data</caption>
        <TableHeader>
          <TableRow>
            <TableHead>Period</TableHead>
            <TableHead>Net spending</TableHead>
            <TableHead>Refunds/adjustments</TableHead>
            <TableHead>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {bins.map((bin) => (
            <TableRow key={bin.date}>
              <TableCell>
                <Button variant="link" onClick={() => onSelect(bin.drillDown)}>
                  {bin.label}
                </Button>
              </TableCell>
              <TableCell>{formatMoney(bin.netCents / 100)}</TableCell>
              <TableCell>−{formatMoney(bin.negativeAdjustmentCents / 100)}</TableCell>
              <TableCell>
                {spendingBinStatus(bin)}
                {bin.partial ? " · Partial bin" : ""}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {comparison && (
        <Table>
          <caption>Contribution to the change by category or bucket</caption>
          <TableHeader>
            <TableRow>
              <TableHead>Group</TableHead>
              <TableHead>Change</TableHead>
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
                  <TableCell>
                    {formatMoney(((current?.netCents ?? 0) - (previous?.netCents ?? 0)) / 100)}
                    {qualified ? " · Incomplete coverage" : ""}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </section>
  );
}
