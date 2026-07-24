import type { FinanceBudgetPace, FinanceBudgetPacePeriod } from "@personal-os/domain";
import { formatDateOnly } from "@personal-os/domain";
import { Badge as ShadcnBadge } from "@/components/ui/badge";
import {
  Card as ShadcnCard,
  CardAction as ShadcnCardAction,
  CardContent as ShadcnCardContent,
  CardDescription as ShadcnCardDescription,
  CardHeader as ShadcnCardHeader,
  CardTitle as ShadcnCardTitle,
} from "@/components/ui/card";
import {
  ToggleGroup as ShadcnToggleGroup,
  ToggleGroupItem as ShadcnToggleGroupItem,
} from "@/components/ui/toggle-group";
import {
  Tooltip as ShadcnTooltip,
  TooltipContent as ShadcnTooltipContent,
  TooltipProvider as ShadcnTooltipProvider,
  TooltipTrigger as ShadcnTooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { formatMoney } from "./format.js";

const weekdayLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function budgetPaceCopy(status: FinanceBudgetPace["cells"][number]["status"]) {
  return {
    ahead: "Ahead of pace",
    behind: "Over pace",
    neutral: "On pace",
    blank: "No activity",
  }[status];
}

function cellClassName(
  status: FinanceBudgetPace["cells"][number]["status"],
  period: FinanceBudgetPacePeriod,
) {
  return cn(
    "block shrink-0 rounded-md outline-none ring-ring/50 transition-transform focus-visible:ring-3",
    period === "week" ? "size-10 sm:size-12" : period === "month" ? "size-5" : "size-3",
    status === "ahead" ? "bg-success/60" : status === "behind" ? "bg-destructive/55" : "bg-muted",
  );
}

function graphCells(data: FinanceBudgetPace) {
  if (data.period === "week" || data.cells.length === 0)
    return data.cells.map((cell) => ({ cell, key: cell.date }));
  const firstDay = new Date(`${data.cells[0]?.date ?? ""}T12:00:00Z`).getUTCDay();
  return [
    ...Array.from({ length: firstDay }, (_, index) => ({ cell: null, key: `leading-${index}` })),
    ...data.cells.map((cell) => ({ cell, key: cell.date })),
  ];
}

function BudgetPaceCells({
  cells,
  period,
}: {
  cells: ReturnType<typeof graphCells>;
  period: FinanceBudgetPacePeriod;
}) {
  const isYear = period === "year";
  return (
    <fieldset
      className={cn("grid w-max gap-1", isYear ? "grid-flow-col grid-rows-7" : "grid-cols-7")}
      style={isYear ? { gridTemplateRows: "repeat(7, 0.75rem)" } : undefined}
    >
      <legend className="sr-only">Budget pace by {period}</legend>
      {cells.map(({ cell, key }) =>
        cell ? (
          <ShadcnTooltip key={key}>
            <ShadcnTooltipTrigger asChild>
              <button
                aria-label={`${formatDateOnly(cell.date, {
                  day: "numeric",
                  month: "long",
                  year: "numeric",
                })}: ${budgetPaceCopy(cell.status)}. ${formatMoney(cell.spent)} spent against ${formatMoney(cell.planned)} paced.`}
                className={cellClassName(cell.status, period)}
                type="button"
              />
            </ShadcnTooltipTrigger>
            <ShadcnTooltipContent sideOffset={6}>
              <span>
                {formatDateOnly(cell.date, { day: "numeric", month: "short" })} ·{" "}
                {budgetPaceCopy(cell.status)}
                {cell.status !== "blank"
                  ? ` · ${formatMoney(cell.spent)} / ${formatMoney(cell.planned)}`
                  : ""}
              </span>
            </ShadcnTooltipContent>
          </ShadcnTooltip>
        ) : (
          <span aria-hidden="true" className={cellClassName("blank", period)} key={key} />
        ),
      )}
    </fieldset>
  );
}

/**
 * A complete contribution-style calendar view of budget pace. Blank cells are
 * intentional: they preserve grid continuity for future, missing, and inactive days.
 */
export function BudgetPaceGraph({
  data,
  onPeriodChange,
  period,
}: {
  data: FinanceBudgetPace | undefined;
  onPeriodChange: (period: FinanceBudgetPacePeriod) => void;
  period: FinanceBudgetPacePeriod;
}) {
  const cells = data ? graphCells(data) : [];
  const latest = data?.cells.find((cell) => cell.date === data.asOf);
  const hasBudget = data?.cells.some((cell) => cell.planned > 0) ?? false;
  const isYear = period === "year";

  return (
    <ShadcnCard>
      <ShadcnCardHeader>
        <ShadcnCardTitle>Budget pace</ShadcnCardTitle>
        <ShadcnCardDescription>
          {hasBudget
            ? "Each day compares your posted spending with the pace of your monthly limits."
            : "Set monthly limits to see whether your spending is on pace."}
        </ShadcnCardDescription>
        <ShadcnCardAction>
          <ShadcnToggleGroup
            aria-label="Budget pace period"
            onValueChange={(value) => {
              if (value) onPeriodChange(value as FinanceBudgetPacePeriod);
            }}
            size="sm"
            spacing={0}
            type="single"
            value={period}
            variant="outline"
          >
            <ShadcnToggleGroupItem value="week">Week</ShadcnToggleGroupItem>
            <ShadcnToggleGroupItem value="month">Month</ShadcnToggleGroupItem>
            <ShadcnToggleGroupItem value="year">Year</ShadcnToggleGroupItem>
          </ShadcnToggleGroup>
        </ShadcnCardAction>
      </ShadcnCardHeader>
      <ShadcnCardContent className="flex flex-col gap-4">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <ShadcnBadge variant={latest?.status === "behind" ? "destructive" : "secondary"}>
            {latest ? budgetPaceCopy(latest.status) : "Loading pace"}
          </ShadcnBadge>
          {latest && latest.status !== "blank" ? (
            <span>
              {formatMoney(latest.spent)} spent against {formatMoney(latest.planned)} paced
            </span>
          ) : null}
        </div>
        <ShadcnTooltipProvider>
          <div className="overflow-x-auto pb-1">
            {isYear ? (
              <div className="flex w-max items-start gap-2">
                <div
                  aria-hidden="true"
                  className="grid grid-rows-7 gap-1 text-[0.6875rem] leading-3 text-muted-foreground"
                  style={{ gridTemplateRows: "repeat(7, 0.75rem)" }}
                >
                  {weekdayLabels.map((label) => (
                    <span key={label}>{label.slice(0, 1)}</span>
                  ))}
                </div>
                <BudgetPaceCells cells={cells} period={period} />
              </div>
            ) : (
              <>
                {period === "month" ? (
                  <div
                    aria-hidden="true"
                    className="mb-1 grid grid-cols-7 gap-1 text-[0.6875rem] text-muted-foreground"
                  >
                    {weekdayLabels.map((label) => (
                      <span key={label}>{label.slice(0, 1)}</span>
                    ))}
                  </div>
                ) : null}
                <BudgetPaceCells cells={cells} period={period} />
              </>
            )}
          </div>
        </ShadcnTooltipProvider>
        <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <i aria-hidden="true" className="size-2 rounded-md bg-success/60" />
            Ahead
          </span>
          <span className="flex items-center gap-1.5">
            <i aria-hidden="true" className="size-2 rounded-md bg-muted" />
            On pace / no activity
          </span>
          <span className="flex items-center gap-1.5">
            <i aria-hidden="true" className="size-2 rounded-md bg-destructive/55" />
            Over pace
          </span>
        </div>
      </ShadcnCardContent>
    </ShadcnCard>
  );
}
