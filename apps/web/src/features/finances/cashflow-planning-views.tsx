import {
  type FinanceAccount,
  type FinanceRecurringOccurrence,
  financePlanningEvidenceCurrencySchema,
  formatDateOnly,
} from "@personal-os/domain";
import { useState } from "react";
import { Link } from "react-router-dom";
import { DateInput } from "@/components/date-input";
import { CalendarIcon, FilterIcon, ReceiptIcon } from "@/components/icons";
import {
  ResponsiveDialog as Dialog,
  ResponsiveDialogContent as DialogContent,
  ResponsiveDialogDescription as DialogDescription,
  ResponsiveDialogHeader as DialogHeader,
  ResponsiveDialogTitle as DialogTitle,
  ResponsiveDialogTrigger as DialogTrigger,
  ResponsiveDialogBody,
} from "@/components/responsive-dialog";
import { SettingsControlsContext } from "@/components/settings-controls-context";
import { Field, FieldGroup, FieldLabel } from "@/components/settings-field";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Item, ItemContent, ItemDescription, ItemTitle } from "@/components/ui/item";
import { WorkspaceHeaderControls } from "@/components/workspace-header-controls";
import { FinanceDisclosure } from "./disclosure";
import { FinanceChoice } from "./view-controls";
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
    <Item key={row.key} variant="outline" className="min-w-0 p-4">
      <ItemContent className="min-w-0 gap-2">
        <div className="flex items-start justify-between gap-4">
          <ItemTitle className="line-clamp-none break-words">
            <Link
              className="break-words underline"
              to={`/finances/cashflow?view=${row.source.kind === "income" ? "income" : "subscriptions"}&record=${encodeURIComponent(row.source.id)}`}
            >
              {row.displayName}
            </Link>
          </ItemTitle>
          <span className="shrink-0 text-right font-semibold tabular-nums">
            {money(row.amountCents, row.currency)}
          </span>
        </div>
        <ItemDescription>
          {row.source.kind === "income" ? "Money in" : "Money out"} ·{" "}
          {row.occurrence
            ? `Expected schedule · ${row.occurrence.matchState.replaceAll("_", " ")}`
            : "Next source date only · schedule unconfirmed"}
        </ItemDescription>
        <FinanceDisclosure title="Schedule details">
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
        </FinanceDisclosure>
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
  const [optionsOpen, setOptionsOpen] = useState(false);
  return (
    <WorkspaceHeaderControls label="Timeline controls" placement="leading">
      <div className="flex flex-wrap items-center gap-2">
        <FinanceChoice
          label="View"
          icon={presentation === "calendar" ? <CalendarIcon /> : <ReceiptIcon />}
          optionIcons={{ agenda: <ReceiptIcon />, calendar: <CalendarIcon /> }}
          value={presentation}
          options={[
            ["agenda", "Agenda"],
            ["calendar", "Calendar"],
          ]}
          onChange={(value) => onParamChange("timeline", value)}
        />
        <div className="flex flex-wrap items-center gap-2">
          <WorkspaceHeaderControls label="Cash flow range" placement="title">
            <p className="whitespace-nowrap font-normal text-muted-foreground">
              {/^\d{4}-\d{2}-\d{2}$/.test(from)
                ? formatDateOnly(from, { month: "short", day: "numeric" })
                : "Choose dates"}{" "}
              –{" "}
              {/^\d{4}-\d{2}-\d{2}$/.test(to)
                ? formatDateOnly(to, { month: "short", day: "numeric" })
                : "Choose dates"}
            </p>
          </WorkspaceHeaderControls>
          <WorkspaceHeaderControls label="Timeline filters">
            <Dialog open={optionsOpen} onOpenChange={setOptionsOpen}>
              <DialogTrigger asChild>
                <Button size="icon-sm" variant="ghost" aria-label="Timeline options">
                  <FilterIcon />
                </Button>
              </DialogTrigger>
              <DialogContent
                data-finance-dialog
                data-finance-size="default"
                className="settings-panel"
              >
                <SettingsControlsContext.Provider value={true}>
                  <DialogHeader>
                    <DialogTitle>Timeline options</DialogTitle>
                    <DialogDescription>
                      Choose dates and accounts for expected money. This does not change your
                      schedules.
                    </DialogDescription>
                  </DialogHeader>
                  <ResponsiveDialogBody>
                    <FieldGroup>
                      <Field>
                        <FieldLabel htmlFor="planning-from">From</FieldLabel>
                        <DateInput
                          id="planning-from"
                          value={from}
                          onValueChange={(value) => onParamChange("cashflowFrom", value)}
                        />
                      </Field>
                      <Field>
                        <FieldLabel htmlFor="planning-to">Through</FieldLabel>
                        <DateInput
                          id="planning-to"
                          value={to}
                          onValueChange={(value) => onParamChange("cashflowTo", value)}
                        />
                      </Field>
                      <Field>
                        <FieldLabel>Accounts</FieldLabel>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="sm">
                              {accountIds === undefined
                                ? "All source accounts"
                                : accountIds.length
                                  ? `${accountIds.length} selected accounts`
                                  : "No accounts selected"}
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="start">
                            <DropdownMenuItem
                              onSelect={() => onParamChange("cashflowAccounts", null)}
                            >
                              All source accounts
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onSelect={() => onParamChange("cashflowAccounts", "none")}
                            >
                              Select no accounts
                            </DropdownMenuItem>
                            {accounts.map((account) => (
                              <DropdownMenuCheckboxItem
                                key={account.id}
                                checked={
                                  accountIds === undefined || accountIds.includes(account.id)
                                }
                                onSelect={(event) => event.preventDefault()}
                                onCheckedChange={(checked) => {
                                  const selected = new Set(
                                    accountIds ?? accounts.map((item) => item.id),
                                  );
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
                      </Field>
                    </FieldGroup>
                    <Button
                      variant="ghost"
                      className="self-end"
                      onClick={() => {
                        onReset();
                        setOptionsOpen(false);
                      }}
                    >
                      Reset timeline filters
                    </Button>
                  </ResponsiveDialogBody>
                </SettingsControlsContext.Provider>
              </DialogContent>
            </Dialog>
          </WorkspaceHeaderControls>
        </div>
      </div>
    </WorkspaceHeaderControls>
  );
}
