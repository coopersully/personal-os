import {
  cashflowScheduleRange,
  type FinanceCashflowScheduleAccount,
  type FinanceCashflowScheduleItem,
  type FinanceIncomeStream,
  type FinanceRecurringObligation,
  financeCashflowScheduleQuerySchema,
  formatDateOnly,
  projectFinanceCashflowSchedule,
} from "@personal-os/domain";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { DateInput } from "@/components/date-input";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Field, FieldLabel } from "@/components/ui/field";
import { Item, ItemContent, ItemDescription, ItemGroup, ItemTitle } from "@/components/ui/item";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "../../api.js";
import { InlineError } from "../../components/async-state.js";
import { FinanceCashflowAgenda } from "./cashflow-agenda.js";
import { FinanceCashflowCalendar } from "./cashflow-calendar.js";

function ScheduleItem({ item }: { item: FinanceCashflowScheduleItem }) {
  const amount = item.currencyCode
    ? new Intl.NumberFormat(undefined, { style: "currency", currency: item.currencyCode }).format(
        item.expectedAmount,
      )
    : item.expectedAmount.toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
  return (
    <Item variant="outline" role="listitem" className="min-w-0">
      <ItemContent className="min-w-0 gap-2">
        <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
          <ItemTitle className="min-w-0 max-w-full line-clamp-none break-words">
            <Link
              className="min-w-0 max-w-full break-words underline underline-offset-4"
              to={`/finances/cashflow?view=${item.source.kind === "income" ? "income" : "subscriptions"}&record=${encodeURIComponent(item.source.id)}`}
            >
              {item.displayName}
            </Link>
          </ItemTitle>
          <span className="text-sm font-medium tabular-nums">Expected {amount}</span>
        </div>
        <ItemDescription className="break-words">
          {item.kind === "income"
            ? "Income"
            : item.kind === "savings"
              ? "Savings movement"
              : "Payment"}{" "}
          · {item.cadence} · {item.accountName ?? "Account not recorded"}
          {item.currencyCode ? "" : " · Currency not recorded"}
        </ItemDescription>
        <p className="text-xs text-muted-foreground">
          {item.timing === "past_expected"
            ? "Past expected date · matching unavailable"
            : item.date
              ? "Expected date"
              : "Date unknown"}{" "}
          ·{" "}
          {item.sourceStatus === "needs_review"
            ? "Needs confirmation"
            : item.provenance === "user"
              ? "User-provided record"
              : "Inferred record"}
        </p>
        <p className="text-xs text-muted-foreground">
          {item.lastObservedDate
            ? `Last observed ${formatDateOnly(item.lastObservedDate, { dateStyle: "medium" })}`
            : "Observation date not recorded"}
        </p>
      </ItemContent>
    </Item>
  );
}

export function FinanceCashflowTimeline({
  income,
  obligations,
  accounts,
}: {
  income: FinanceIncomeStream[];
  obligations: FinanceRecurringObligation[];
  accounts: FinanceCashflowScheduleAccount[];
}) {
  const user = useQuery({ queryKey: ["me"], queryFn: api.getMe });
  const [params, setParams] = useSearchParams();
  const [asOf] = useState(() => new Date().toISOString());
  const timezone = user.data?.planningTimezone;
  if (user.isPending) return <Skeleton className="h-32 w-full" />;
  if (user.isError) return <InlineError error={user.error} retry={() => user.refetch()} />;
  let defaults: { from: string; to: string };
  try {
    defaults = cashflowScheduleRange(asOf, timezone ?? "");
  } catch {
    return (
      <p className="text-sm">
        Planning timezone unavailable.{" "}
        <Link className="underline" to="/settings">
          Review settings
        </Link>
      </p>
    );
  }
  const scope = params.get("cashflowAccounts");
  const accountIds = scope === null ? undefined : scope === "none" ? [] : scope.split(",");
  const parsed = financeCashflowScheduleQuerySchema.safeParse({
    from: params.get("cashflowFrom") ?? defaults.from,
    to: params.get("cashflowTo") ?? defaults.to,
    timezone,
    asOf,
    ...(accountIds !== undefined ? { accountIds } : {}),
  });
  const requestedView = params.get("timeline") ?? "agenda";
  const reset = () => {
    const next = new URLSearchParams(params);
    for (const key of ["cashflowFrom", "cashflowTo", "cashflowAccounts", "timeline"])
      next.delete(key);
    setParams(next);
  };
  const schedule =
    parsed.success && ["agenda", "calendar"].includes(requestedView)
      ? projectFinanceCashflowSchedule({ ...parsed.data, income, obligations, accounts })
      : null;
  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (value === null) next.delete(key);
    else next.set(key, value);
    setParams(next);
  };
  const renderItem = (item: FinanceCashflowScheduleItem) => (
    <ScheduleItem key={item.key} item={item} />
  );
  return (
    <section aria-label="Upcoming money" className="flex min-w-0 flex-col gap-5">
      <div className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">Upcoming money</h2>
        <p className="text-sm text-muted-foreground">
          Next expected item per recurring record. Repeated occurrences and actual payment matching
          are not available.
        </p>
        <p className="text-xs text-muted-foreground">
          Dates use {timezone}. Last observed dates describe source records, not a fresh bank check.
        </p>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <Field className="w-40">
          <FieldLabel htmlFor="cashflow-from">From</FieldLabel>
          <DateInput
            id="cashflow-from"
            value={params.get("cashflowFrom") ?? defaults.from}
            onValueChange={(v) => setParam("cashflowFrom", v)}
          />
        </Field>
        <Field className="w-40">
          <FieldLabel htmlFor="cashflow-to">Through</FieldLabel>
          <DateInput
            id="cashflow-to"
            value={params.get("cashflowTo") ?? defaults.to}
            onValueChange={(v) => setParam("cashflowTo", v)}
          />
        </Field>
        <Field className="w-32">
          <FieldLabel htmlFor="cashflow-presentation">Timeline view</FieldLabel>
          <NativeSelect
            id="cashflow-presentation"
            value={requestedView}
            onChange={(e) => setParam("timeline", e.target.value)}
          >
            {!["agenda", "calendar"].includes(requestedView) ? (
              <NativeSelectOption value={requestedView}>Unsupported view</NativeSelectOption>
            ) : null}
            <NativeSelectOption value="agenda">Agenda</NativeSelectOption>
            <NativeSelectOption value="calendar">Calendar</NativeSelectOption>
          </NativeSelect>
        </Field>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline">
              {accountIds === undefined
                ? "All source accounts"
                : accountIds.length
                  ? `${accountIds.length} selected accounts`
                  : "No accounts selected"}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem onSelect={() => setParam("cashflowAccounts", null)}>
              All source accounts
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setParam("cashflowAccounts", "none")}>
              Select no accounts
            </DropdownMenuItem>
            {accounts.map((account) => (
              <DropdownMenuCheckboxItem
                key={account.id}
                checked={accountIds === undefined || accountIds.includes(account.id)}
                onSelect={(e) => e.preventDefault()}
                onCheckedChange={(checked) => {
                  const selected = new Set(accountIds ?? accounts.map((a) => a.id));
                  if (checked) selected.add(account.id);
                  else selected.delete(account.id);
                  setParam("cashflowAccounts", selected.size ? [...selected].join(",") : "none");
                }}
              >
                {account.name}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {!schedule ? (
        <div className="flex flex-col items-start gap-2">
          <p className="text-sm">Choose a valid date range, account selection and timeline view.</p>
          <Button variant="secondary" onClick={reset}>
            Reset timeline filters
          </Button>
        </div>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            Projected balance unavailable: current records do not establish balance basis or which
            movements are already reflected.
          </p>
          {requestedView === "calendar" ? (
            <FinanceCashflowCalendar schedule={schedule} renderItem={renderItem} />
          ) : (
            <FinanceCashflowAgenda schedule={schedule} renderItem={renderItem} />
          )}
          <section aria-label="Date unknown" className="flex min-w-0 flex-col gap-2">
            <h3 className="text-sm font-medium">Date unknown</h3>
            {schedule.undated.length ? (
              <ItemGroup>{schedule.undated.map(renderItem)}</ItemGroup>
            ) : (
              <p className="text-sm text-muted-foreground">
                No undated next expected items recorded.
              </p>
            )}
          </section>
          {schedule.coverage.outsideRangeCount ? (
            <p className="text-xs text-muted-foreground">
              {schedule.coverage.outsideRangeCount} next expected{" "}
              {schedule.coverage.outsideRangeCount === 1 ? "item is" : "items are"} outside this
              date range.
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}
