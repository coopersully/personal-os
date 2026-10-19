import {
  type FinanceAccount,
  type FinanceRecurringOccurrence,
  financePlanningEvidenceCurrencySchema,
  formatDateOnly,
} from "@personal-os/domain";
import { Link } from "react-router-dom";
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
import { Item, ItemContent, ItemDescription, ItemTitle } from "@/components/ui/item";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
export type CashflowPlanningRow = {
  key: string;
  date: string | null;
  source: { kind: "income" | "obligation"; id: string };
  displayName: string;
  currency: string | null;
  amountCents: number | null;
  occurrence: FinanceRecurringOccurrence | null;
  cadence: string | null;
  scheduleTimezone: string | null;
  recordedAt: string | null;
  lastObservedDate: string | null;
};
function money(cents: number | null, currency: string | null) {
  if (cents === null) return "Amount unknown";
  const amount = (cents / 100).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${amount} ${currency ?? "· currency unknown"}`;
}
export function CashflowOccurrenceItem({
  row,
  canSchedule,
  canInspect,
  onSchedule,
  onMatch,
}: {
  row: CashflowPlanningRow;
  canSchedule: boolean;
  canInspect: boolean;
  onSchedule: (source: CashflowPlanningRow["source"]) => void;
  onMatch: (occurrence: FinanceRecurringOccurrence | null) => void;
}) {
  return (
    <Item key={row.key} className="min-w-0">
      <ItemContent className="min-w-0 gap-2">
        <ItemTitle className="line-clamp-none break-words">
          <Link
            className="break-words underline"
            to={`/finances/cashflow?view=${row.source.kind === "income" ? "income" : "subscriptions"}&record=${encodeURIComponent(row.source.id)}`}
          >
            {row.displayName}
          </Link>
        </ItemTitle>
        <ItemDescription>
          {money(row.amountCents, row.currency)} ·{" "}
          {row.occurrence
            ? `Expected schedule · ${row.occurrence.matchState.replaceAll("_", " ")}`
            : "Next source date only · schedule unconfirmed"}
        </ItemDescription>
        <p className="text-xs text-muted-foreground">
          {row.cadence ?? "Cadence not established"} ·{" "}
          {row.scheduleTimezone
            ? `Schedule timezone ${row.scheduleTimezone}`
            : "Schedule timezone unconfirmed"}
        </p>
        <p className="text-xs text-muted-foreground">
          {row.recordedAt ? (
            <>
              Schedule statement recorded <time dateTime={row.recordedAt}>{row.recordedAt}</time>
            </>
          ) : (
            "No confirmed schedule statement"
          )}{" "}
          ·{" "}
          {row.lastObservedDate
            ? `Source last observed ${formatDateOnly(row.lastObservedDate, { dateStyle: "medium" })}`
            : "Observation date not recorded"}
        </p>
        {row.currency && !financePlanningEvidenceCurrencySchema.safeParse(row.currency).success ? (
          <p className="text-xs text-muted-foreground">
            Planning currency units unsupported; inspect the original amount.
          </p>
        ) : null}
        {row.occurrence ? (
          <p className="text-xs text-muted-foreground">
            Matched {money(row.occurrence.matchedAmountCents, row.currency)} · Remaining expected{" "}
            {money(row.occurrence.remainingExpectedCents, row.currency)} · Expected dates do not
            prove settlement.
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={!canSchedule}
            onClick={() => onSchedule(row.source)}
          >
            {row.occurrence ? "Revise schedule" : "Confirm schedule"}
          </Button>
          {row.occurrence ? (
            <Button
              size="sm"
              variant="outline"
              disabled={!canInspect}
              onClick={() => onMatch(row.occurrence)}
            >
              Match or inspect receipts
            </Button>
          ) : null}
        </div>
      </ItemContent>
    </Item>
  );
}
export function CashflowPlanningControls({
  from,
  to,
  presentation,
  accountIds,
  accounts,
  onParamChange,
  onReset,
}: {
  from: string;
  to: string;
  presentation: string;
  accountIds: string[] | undefined;
  accounts: Pick<FinanceAccount, "id" | "name">[];
  onParamChange: (key: string, value: string | null) => void;
  onReset: () => void;
}) {
  return (
    <div className="flex flex-wrap items-end gap-3">
      <Field className="w-40">
        <FieldLabel htmlFor="planning-from">From</FieldLabel>
        <DateInput
          id="planning-from"
          value={from}
          onValueChange={(value) => onParamChange("cashflowFrom", value)}
        />
      </Field>
      <Field className="w-40">
        <FieldLabel htmlFor="planning-to">Through</FieldLabel>
        <DateInput
          id="planning-to"
          value={to}
          onValueChange={(value) => onParamChange("cashflowTo", value)}
        />
      </Field>
      <Field className="w-40">
        <FieldLabel htmlFor="planning-view">Timeline view</FieldLabel>
        <NativeSelect
          id="planning-view"
          value={presentation}
          onChange={(event) => onParamChange("timeline", event.target.value)}
        >
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
          <DropdownMenuItem onSelect={() => onParamChange("cashflowAccounts", null)}>
            All source accounts
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onParamChange("cashflowAccounts", "none")}>
            Select no accounts
          </DropdownMenuItem>
          {accounts.map((account) => (
            <DropdownMenuCheckboxItem
              key={account.id}
              checked={accountIds === undefined || accountIds.includes(account.id)}
              onSelect={(event) => event.preventDefault()}
              onCheckedChange={(checked) => {
                const selected = new Set(accountIds ?? accounts.map((item) => item.id));
                if (checked) selected.add(account.id);
                else selected.delete(account.id);
                onParamChange(
                  "cashflowAccounts",
                  selected.size ? [...selected].sort().join(",") : "none",
                );
              }}
            >
              {account.name}
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <Button variant="outline" onClick={onReset}>
        Reset timeline filters
      </Button>
    </div>
  );
}
