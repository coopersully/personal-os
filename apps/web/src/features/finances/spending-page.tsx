import {
  type FinanceSpendingDrillDown,
  type FinanceSpendingGroup,
  type FinancesWorkspacePreferences,
  financeSpendingQuerySchema,
  getDefaultWorkspacePreferences,
} from "@personal-os/domain";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "@/api";
import { QueryFeedback } from "@/components/async-state";
import { DateDisplay } from "@/components/date-display";
import { CircleHelpIcon, FilterIcon } from "@/components/icons";
import { SettingsControlsContext } from "@/components/settings-controls-context";
import { Field, FieldGroup, FieldLabel } from "@/components/settings-field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { WorkspaceHeaderControls } from "@/components/workspace-header-controls";
import {
  useSaveWorkspacePreferences,
  useWorkspacePreferences,
} from "../workspace-settings/preferences";
import { WorkspacePreferenceRecovery } from "../workspace-settings/save-recovery";
import { formatMoney } from "./format";
import { SpendingBubbles } from "./spending-bubbles";
import {
  SpendingBudgetQualification,
  SpendingMonthlyBudgetContext,
} from "./spending-budget-qualification";
import { SpendingChoice, SpendingPeriodControls } from "./spending-controls";
import { SpendingDetail } from "./spending-detail";
import { SpendingList } from "./spending-list";
import {
  moveSpendingPeriod,
  type SpendingPeriod,
  spendingPeriod,
  spendingToday,
} from "./spending-period";
import { parseSpendingRecovery, spendingRecoveryControls } from "./spending-reference";
import { FinanceSpendingRhythm } from "./spending-rhythm";
import { FinanceSpendingTrends, spendingComparisonScopes } from "./spending-trends";

const qualificationCopy: Record<string, string> = {
  historical_coverage_not_certified: "Historical coverage has not been verified.",
  source_unavailable: "A selected source is unavailable.",
  stale_evidence: "Some source information is out of date.",
  ownership_unknown: "Some account ownership is unknown; affected spending is excluded.",
  ownership_share_unknown:
    "Your share of some shared accounts is unknown; affected spending is excluded.",
  unsupported_currency:
    "Some transactions use unsupported currencies and are excluded from USD totals.",
  allocation_sum_mismatch: "Some split purchases do not reconcile and need review.",
  allocation_evidence_unresolved: "Some split purchase evidence is unresolved.",
  transfer_evidence_incomplete:
    "Some transfer evidence is incomplete; affected amounts need review.",
  transfer_direction_unknown: "Some transfer directions are unknown; affected amounts need review.",
  reimbursement_allocation_unresolved:
    "Some reimbursements cannot be matched to their purchase allocation.",
};
export function FinanceSpendingPage() {
  const [urlParams, setParams] = useSearchParams();
  const recovery = parseSpendingRecovery(urlParams.get("recoverSpending"));
  const params =
    recovery.state === "valid" ? spendingRecoveryControls(urlParams, recovery.filter) : urlParams;
  function changeParams(next: URLSearchParams) {
    next.delete("recoverSpending");
    setParams(next);
  }
  function leaveRecovery() {
    if (urlParams.has("recoverSpending")) changeParams(new URLSearchParams(params));
  }
  const preferences = useWorkspacePreferences("finances");
  const calendar = useWorkspacePreferences("calendar");
  const save = useSaveWorkspacePreferences("finances");
  const user = useQuery({ queryKey: ["me"], queryFn: api.getMe });
  const defaults = {
    ...getDefaultWorkspacePreferences("finances"),
    ...preferences.data?.preferences,
  };
  const choice = (key: string, fallback: string) => params.get(key) ?? fallback;
  const bool = (key: string, fallback: boolean) =>
    params.has(key) ? params.get(key) !== "0" : fallback;
  const requestedView = choice("view", defaults.financeSpendingView);
  const view = ["bubbles", "list", "trends", "rhythm"].includes(requestedView)
    ? requestedView
    : "bubbles";
  const rhythmDefault =
    view === "rhythm" && !["period", "from", "through"].some((key) => params.has(key));
  const [openedAt] = useState(() => new Date().toISOString());
  const requestedPeriod = choice("period", defaults.financeSpendingPeriod);
  const period = (
    ["today", "week", "month", "custom"].includes(requestedPeriod)
      ? requestedPeriod
      : defaults.financeSpendingPeriod
  ) as SpendingPeriod;
  const timezone = params.get("timezone") ?? user.data?.planningTimezone;
  const timezoneValid = (() => {
    try {
      if (!timezone) return false;
      new Intl.DateTimeFormat("en", { timeZone: timezone });
      return true;
    } catch {
      return false;
    }
  })();
  const today = timezone && timezoneValid ? spendingToday(timezone) : "2000-01-01";
  const requestedAnchor = params.get("from") ?? today;
  const validAnchor =
    /^\d{4}-\d{2}-\d{2}$/.test(requestedAnchor) &&
    Number.isFinite(Date.parse(`${requestedAnchor}T12:00:00Z`)) &&
    new Date(`${requestedAnchor}T12:00:00Z`).toISOString().slice(0, 10) === requestedAnchor;
  const anchor = validAnchor ? requestedAnchor : today;
  const selectedRange = spendingPeriod(
    period,
    anchor,
    calendar.data?.preferences.weekStartsOn ??
      getDefaultWorkspacePreferences("calendar").weekStartsOn,
    params.get("through") ?? today,
  );
  const monthRange = spendingPeriod(
    "month",
    today,
    calendar.data?.preferences.weekStartsOn ??
      getDefaultWorkspacePreferences("calendar").weekStartsOn,
  );
  const range = rhythmDefault
    ? { from: moveSpendingPeriod("month", monthRange.from, -2), through: monthRange.through }
    : selectedRange;
  const accountIds = params.has("accounts")
    ? params.get("accounts") === "all"
      ? null
      : (params.get("accounts")?.split(",").filter(Boolean) ?? [])
    : defaults.spendAccountIds;
  const activeFilterCount =
    Number(accountIds !== null) +
    Number(choice("basis", defaults.financeSpendingBasis) !== "personal_cost") +
    Number(!bool("pending", defaults.financeSpendingIncludePending)) +
    Number(!bool("refunds", defaults.financeSpendingSubtractRefunds)) +
    Number(!bool("uncategorized", defaults.financeSpendingIncludeUncategorized));
  const parsed = financeSpendingQuerySchema.safeParse(
    recovery.state === "valid"
      ? recovery.filter.query
      : {
          scope: {
            ...range,
            timezone,
            accountIds,
            categoryIds: params.has("categories")
              ? params
                  .get("categories")
                  ?.split(",")
                  .filter(Boolean)
                  .map((id) => (id === "uncategorized" ? null : id))
              : null,
            basis: choice("basis", defaults.financeSpendingBasis),
            includePending: bool("pending", defaults.financeSpendingIncludePending),
            subtractRefunds: bool("refunds", defaults.financeSpendingSubtractRefunds),
          },
          grouping: choice("grouping", defaults.financeSpendingGrouping),
          includeUncategorized: bool("uncategorized", defaults.financeSpendingIncludeUncategorized),
        },
  );
  const comparisonScopes =
    parsed.success && view === "trends" && recovery.state !== "valid"
      ? spendingComparisonScopes(parsed.data.scope, period, openedAt)
      : null;
  const activeQuery = parsed.success
    ? { ...parsed.data, scope: comparisonScopes?.current ?? parsed.data.scope }
    : null;
  const queryEnabled =
    !!timezone &&
    timezoneValid &&
    recovery.state !== "invalid" &&
    preferences.isSuccess &&
    calendar.isSuccess &&
    !!activeQuery &&
    validAnchor;
  const data = useQuery({
    queryKey: [
      "finance-spending",
      user.data?.id,
      activeQuery,
      recovery.state === "valid" ? recovery.filter.referenceRevision : null,
    ],
    enabled: queryEnabled,
    queryFn: () => {
      if (!activeQuery) throw new Error("Invalid spending filters");
      return api.getFinanceSpending(activeQuery);
    },
  });
  const comparisonQuery =
    activeQuery && comparisonScopes ? { ...activeQuery, scope: comparisonScopes.previous } : null;
  const comparison = useQuery({
    queryKey: ["finance-spending", user.data?.id, comparisonQuery],
    enabled: queryEnabled && !!comparisonQuery,
    queryFn: () => {
      if (!comparisonQuery) throw new Error("No comparison selected");
      return api.getFinanceSpending(comparisonQuery);
    },
  });
  const [selectedDrillDown, setSelectedDrillDown] = useState<FinanceSpendingDrillDown | null>(null);
  const [selected, setSelected] = useState<FinanceSpendingGroup | null>(null);
  function update(
    key: string,
    value: string,
    preference?: keyof FinancesWorkspacePreferences,
    persisted: unknown = value,
  ) {
    const next = new URLSearchParams(params);
    next.set(key, value);
    changeParams(next);
    if (preference) save.mutate({ [preference]: persisted });
    setSelected(null);
    setSelectedDrillDown(null);
  }
  const disabled = !preferences.isSuccess || save.isWorkspacePending || !!save.recovery;
  const result =
    recovery.state === "invalid" ||
    (recovery.state === "valid" &&
      (!data.isSuccess || data.isFetching || !data.isFetchedAfterMount))
      ? undefined
      : data.data;
  const recoveredGroup =
    recovery.state === "valid" && result && !data.isFetching && recovery.filter.groupId !== null
      ? result.groups
          .flatMap((item) => [item, ...item.categories])
          .find((item) => item.id === recovery.filter.groupId)
      : null;
  const recoveredItems =
    recovery.state === "valid" && result && !data.isFetching
      ? result.snapshot.contributions.filter(
          (item) =>
            item.date >= recovery.filter.from &&
            item.date <= recovery.filter.through &&
            (recovery.filter.groupId === null ||
              recoveredGroup?.drillDown.contributionIds.includes(item.id)),
        )
      : [];
  const recoveredDrillDown: FinanceSpendingDrillDown | null =
    recovery.state === "valid" &&
    result &&
    !data.isFetching &&
    (recovery.filter.groupId === null || recoveredGroup)
      ? {
          scope: {
            ...result.snapshot.scope,
            from: recovery.filter.from,
            through: recovery.filter.through,
          },
          contributionIds: recoveredItems.map((item) => item.id),
          transactionIds: [...new Set(recoveredItems.map((item) => item.transactionId))],
        }
      : null;
  const recoveredTotals = recoveredItems.reduce(
    (sum, item) => ({
      netCents: sum.netCents + item.netCents,
      grossCents: sum.grossCents + item.grossCents,
      reimbursementAdjustmentCents:
        sum.reimbursementAdjustmentCents + item.reimbursementAdjustmentCents,
      reimbursementOutstandingCents:
        sum.reimbursementOutstandingCents + item.reimbursementOutstandingCents,
      refundAdjustmentCents: sum.refundAdjustmentCents + item.refundAdjustmentCents,
      pendingCents: sum.pendingCents + (item.pending ? item.netCents : 0),
    }),
    {
      netCents: 0,
      grossCents: 0,
      reimbursementAdjustmentCents: 0,
      reimbursementOutstandingCents: 0,
      refundAdjustmentCents: 0,
      pendingCents: 0,
    },
  );
  const recoveredSelection: FinanceSpendingGroup | null =
    recoveredGroup && recoveredDrillDown
      ? {
          ...recoveredGroup,
          ...recoveredTotals,
          positiveAreaCents: Math.max(0, recoveredTotals.netCents),
          drillDown: recoveredDrillDown,
        }
      : null;
  function selectGroup(group: FinanceSpendingGroup) {
    leaveRecovery();
    setSelected(group);
    setSelectedDrillDown(null);
  }
  function selectDrillDown(drillDown: FinanceSpendingDrillDown) {
    leaveRecovery();
    setSelected(null);
    setSelectedDrillDown(drillDown);
  }

  return (
    <div className="flex min-w-0 flex-col gap-6">
      {recovery.state === "invalid" ? (
        <p>
          The recovered Spending reference is invalid or too large. No spending query has been run.
          <Button
            variant="ghost"
            onClick={() => {
              setParams(new URLSearchParams());
              setSelected(null);
              setSelectedDrillDown(null);
            }}
          >
            Reset spending filters
          </Button>
        </p>
      ) : null}
      {recovery.state === "valid" ? (
        <p className="text-sm text-muted-foreground">
          Recovered selection · current Spending data · {recovery.filter.from} –{" "}
          {recovery.filter.through}. The older transaction reference is provenance only; matching
          Transactions have not been refreshed.
        </p>
      ) : null}
      {recovery.state === "valid" &&
      result &&
      !data.isFetching &&
      recovery.filter.groupId !== null &&
      !recoveredGroup ? (
        <p>
          The recovered group is no longer available. Choose a current group or reset the filters; a
          broader selection has not been opened.
          <Button variant="ghost" onClick={leaveRecovery}>
            Clear recovered selection
          </Button>
        </p>
      ) : null}
      <WorkspaceHeaderControls label="Spending controls" placement="leading">
        <div className="flex flex-wrap items-center gap-2">
          <SpendingChoice
            label="View"
            value={view}
            options={[
              ["bubbles", "Bubbles"],
              ["list", "List"],
              ["trends", "Trends"],
              ["rhythm", "Rhythm"],
            ]}
            disabled={disabled}
            onChange={(value) => update("view", value, "financeSpendingView")}
          />
          <div className="flex flex-wrap items-center gap-2">
            <fieldset disabled={disabled}>
              <SpendingPeriodControls
                period={rhythmDefault ? "custom" : period}
                {...range}
                onPeriod={(value) => {
                  const next = new URLSearchParams(params);
                  next.set("period", value);
                  next.delete("from");
                  next.delete("through");
                  changeParams(next);
                  save.mutate({ financeSpendingPeriod: value as SpendingPeriod });
                  setSelected(null);
                  setSelectedDrillDown(null);
                }}
                onDates={(from, through) => {
                  const next = new URLSearchParams(params);
                  next.set("period", "custom");
                  next.set("from", from);
                  next.set("through", through);
                  changeParams(next);
                  save.mutate({ financeSpendingPeriod: "custom" });
                  setSelected(null);
                  setSelectedDrillDown(null);
                }}
                onMove={(direction) =>
                  update("from", moveSpendingPeriod(period, range.from, direction))
                }
              />
            </fieldset>
            {rhythmDefault ? (
              <p className="text-sm text-muted-foreground">
                Last three calendar months · Recorded evidence only
              </p>
            ) : null}
            <SpendingChoice
              label="Group by"
              value={choice("grouping", defaults.financeSpendingGrouping)}
              options={[
                ["auto", "Auto"],
                ["buckets", "Buckets"],
                ["categories", "Categories"],
              ]}
              disabled={disabled}
              onChange={(value) => update("grouping", value, "financeSpendingGrouping")}
            />

            <WorkspaceHeaderControls label="Spending filters">
              <Dialog>
                <DialogTrigger asChild>
                  <Button variant="ghost" size="icon-sm" aria-label="Spending options">
                    <FilterIcon />
                    <span className="sr-only">Spending options</span>
                    {activeFilterCount ? (
                      <Badge variant="secondary">{activeFilterCount}</Badge>
                    ) : null}
                  </Button>
                </DialogTrigger>
                <DialogContent className="settings-panel max-h-[85dvh] overflow-y-auto sm:max-w-lg">
                  <SettingsControlsContext.Provider value={true}>
                    <DialogHeader>
                      <DialogTitle>Spending options</DialogTitle>
                      <DialogDescription>
                        Choose what contributes to this view. Changes are saved as your defaults.
                      </DialogDescription>
                    </DialogHeader>
                    <FieldGroup>
                      <Field>
                        <FieldLabel>Accounting basis</FieldLabel>
                        <SpendingChoice
                          label="Basis"
                          showLabel={false}
                          value={choice("basis", defaults.financeSpendingBasis)}
                          options={[
                            ["personal_cost", "Personal cost"],
                            ["full_outflow", "Full outflow"],
                          ]}
                          disabled={disabled}
                          onChange={(value) => update("basis", value, "financeSpendingBasis")}
                        />
                      </Field>
                      {(
                        [
                          ["pending", "Include pending", "financeSpendingIncludePending"],
                          ["refunds", "Subtract matched refunds", "financeSpendingSubtractRefunds"],
                          [
                            "uncategorized",
                            "Include uncategorized",
                            "financeSpendingIncludeUncategorized",
                          ],
                        ] as const
                      ).map(([key, label, pref]) => (
                        <Field key={key}>
                          <FieldLabel htmlFor={`spending-${key}`}>{label}</FieldLabel>
                          <Checkbox
                            id={`spending-${key}`}
                            disabled={disabled}
                            checked={bool(key, defaults[pref])}
                            onCheckedChange={(checked) =>
                              update(key, checked === true ? "1" : "0", pref, checked === true)
                            }
                          />
                        </Field>
                      ))}
                    </FieldGroup>
                    {result ? (
                      <fieldset className="flex flex-col gap-2">
                        <legend className="mb-2 text-xs font-medium text-muted-foreground">
                          Accounts
                        </legend>
                        <div className="flex flex-wrap gap-2">
                          <Button
                            variant="ghost"
                            disabled={disabled}
                            onClick={() => update("accounts", "all", "spendAccountIds", null)}
                          >
                            Use all eligible accounts
                          </Button>
                          <Button
                            variant="ghost"
                            disabled={disabled}
                            onClick={() => update("accounts", "", "spendAccountIds", [])}
                          >
                            Select none
                          </Button>
                        </div>
                        <FieldGroup>
                          {result.accounts.map((account) => (
                            <Field key={account.id}>
                              <FieldLabel htmlFor={`spending-account-${account.id}`}>
                                {account.label}
                              </FieldLabel>
                              <Checkbox
                                id={`spending-account-${account.id}`}
                                disabled={disabled}
                                checked={accountIds === null || accountIds.includes(account.id)}
                                onCheckedChange={(checked) => {
                                  const ids = accountIds ?? result.accounts.map((item) => item.id);
                                  const next =
                                    checked === true
                                      ? [...ids, account.id]
                                      : ids.filter((id) => id !== account.id);
                                  update("accounts", next.join(","), "spendAccountIds", next);
                                }}
                              />
                            </Field>
                          ))}
                        </FieldGroup>
                      </fieldset>
                    ) : null}
                    {timezone ? (
                      <p className="text-xs text-muted-foreground">Dates use {timezone}.</p>
                    ) : null}
                  </SettingsControlsContext.Provider>
                </DialogContent>
              </Dialog>
            </WorkspaceHeaderControls>
          </div>
        </div>
      </WorkspaceHeaderControls>
      <WorkspacePreferenceRecovery workspace="finances" />
      <QueryFeedback query={preferences} title="Couldn’t load Spending preferences." />
      <QueryFeedback query={calendar} title="Couldn’t load calendar preferences." />
      <QueryFeedback query={user} title="Couldn’t load your time zone." />
      <QueryFeedback query={data} title="Couldn’t load spending." />
      {view === "trends" ? (
        <QueryFeedback query={comparison} title="Couldn’t load the comparison period." />
      ) : null}
      {timezone && (!parsed.success || !validAnchor) ? (
        <p>
          These spending filters are invalid. Choose a valid date range and accounting settings.
          <Button
            variant="ghost"
            onClick={() => {
              setParams(new URLSearchParams());
              setSelected(null);
              setSelectedDrillDown(null);
            }}
          >
            Reset spending filters
          </Button>
        </p>
      ) : null}
      {data.isLoading ? <Skeleton className="h-72 w-full" /> : null}
      {result ? (
        <>
          <div className="flex flex-wrap items-end justify-between gap-4 px-1">
            <div className="flex flex-col gap-1">
              <p className="text-sm text-muted-foreground">
                {result.snapshot.scope.basis === "personal_cost"
                  ? "Personal spending"
                  : "Full outflow"}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-4xl font-semibold tracking-tight tabular-nums">
                  {formatMoney(result.snapshot.netCents / 100)}
                </p>
                {result.snapshot.coverage !== "complete" ? (
                  <Badge variant="secondary">
                    {result.snapshot.coverage === "partial"
                      ? "Partial coverage"
                      : "Unverified coverage"}
                  </Badge>
                ) : null}
              </div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
                <span className="inline-flex flex-wrap items-center gap-1">
                  <DateDisplay value={result.snapshot.scope.from} timeZone={timezone ?? "UTC"} />
                  <span aria-hidden="true">–</span>
                  <DateDisplay value={result.snapshot.scope.through} timeZone={timezone ?? "UTC"} />
                </span>
                <span>
                  {result.snapshot.scope.includePending ? "Includes pending" : "Posted only"}
                </span>
              </div>
            </div>
            <Dialog>
              <DialogTrigger asChild>
                <Button variant="ghost" size="sm">
                  <CircleHelpIcon />
                  About these totals
                </Button>
              </DialogTrigger>
              <DialogContent className="max-h-[85dvh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>About these totals</DialogTitle>
                  <DialogDescription>
                    Coverage, accounting scope, and the evidence behind this view.
                  </DialogDescription>
                </DialogHeader>
                <p className="text-sm text-muted-foreground">
                  Coverage: {result.snapshot.coverage} · Source: {result.source.freshness}
                  {result.source.lastSyncedAt
                    ? ` · Last synced ${result.source.lastSyncedAt}`
                    : " · Last sync unknown"}
                </p>
                <SpendingMonthlyBudgetContext budget={result.monthlyBudget} />
                {result.monthlyBudget?.state === "unavailable" &&
                result.monthlyBudget.qualificationRequired &&
                result.snapshot.scope.from.slice(0, 7) ===
                  result.snapshot.scope.through.slice(0, 7) &&
                timezone &&
                user.data ? (
                  <SpendingBudgetQualification
                    key={`${user.data.id}:${result.snapshot.scope.from.slice(0, 7)}:${timezone}:${result.referenceRevision ?? result.snapshot.asOf}`}
                    ownerId={user.data.id}
                    month={result.snapshot.scope.from.slice(0, 7)}
                    timezone={timezone}
                    sourceRevision={result.referenceRevision ?? result.snapshot.asOf}
                  />
                ) : null}
                {result.groupingFallback ? (
                  <p>
                    Buckets unavailable; showing categories. Your grouping preference is retained.
                  </p>
                ) : null}
                {result.excludedUncategorizedCents !== 0 ? (
                  <p>
                    Excluded uncategorized: {formatMoney(result.excludedUncategorizedCents / 100)}
                  </p>
                ) : null}
                {result.negativeAdjustmentCents > 0 ? (
                  <p>Negative adjustments: {formatMoney(result.negativeAdjustmentCents / 100)}</p>
                ) : null}
                {result.currency.unsupported.length ? (
                  <p>
                    Unsupported currencies in source history:{" "}
                    {result.currency.unsupported
                      .map(
                        (item) =>
                          `${item.code ?? "Unspecified currency"} (${item.transactionIds.length} transactions)`,
                      )
                      .join(", ")}
                    . No exchange rates applied.
                  </p>
                ) : null}
                {result.source.reasons.length || result.snapshot.qualifications.length ? (
                  <section aria-label="Evidence and limitations">
                    <h3 className="text-sm font-medium">Evidence and limitations</h3>
                    <ul className="flex flex-col gap-2 py-2">
                      {[
                        ...result.source.reasons.map((code) => ({
                          code,
                          sourceIds: [] as string[],
                        })),
                        ...result.snapshot.qualifications,
                      ].map((item) => (
                        <li key={`${item.code}:${item.sourceIds.join(",")}`}>
                          <p>
                            {qualificationCopy[item.code] ??
                              "Some spending evidence needs review before these totals can be treated as complete."}
                          </p>
                          {item.sourceIds.length || !qualificationCopy[item.code] ? (
                            <details>
                              <summary className="cursor-pointer text-xs text-muted-foreground">
                                Technical evidence references
                              </summary>
                              <p className="break-all text-xs text-muted-foreground">
                                {item.code}
                                {item.sourceIds.length ? ` · ${item.sourceIds.join(", ")}` : ""}
                              </p>
                            </details>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  </section>
                ) : null}
              </DialogContent>
            </Dialog>
          </div>
          {result.groups.length || view === "trends" || view === "rhythm" ? (
            <>
              <div hidden={view !== "bubbles"}>
                <SpendingBubbles
                  groups={result.groups}
                  onSelect={selectGroup}
                  layoutKey={result.effectiveGrouping}
                  {...(result.monthlyBudget ? { monthlyBudget: result.monthlyBudget } : {})}
                />
              </div>
              {view === "trends" ? (
                <>
                  <SpendingChoice
                    label="Focus"
                    value={params.get("categories") ?? "all"}
                    options={[
                      ["all", "All categories"],
                      ...result.groups.map(
                        (group) =>
                          [
                            group.categoryIds.map((id) => id ?? "uncategorized").join(","),
                            group.label,
                          ] as const,
                      ),
                    ]}
                    onChange={(value) => {
                      if (value !== "all") return update("categories", value);
                      const next = new URLSearchParams(params);
                      next.delete("categories");
                      changeParams(next);
                      setSelected(null);
                      setSelectedDrillDown(null);
                    }}
                  />
                  <p className="text-sm text-muted-foreground">{comparisonScopes?.label}</p>
                  <FinanceSpendingTrends
                    dashboard={result}
                    {...(comparison.data ? { comparison: comparison.data } : {})}
                    comparisonLoading={comparison.isLoading}
                    onSelect={selectDrillDown}
                  />
                </>
              ) : null}
              {view === "rhythm" ? (
                <FinanceSpendingRhythm
                  dashboard={result}
                  weekStartsOn={
                    calendar.data?.preferences.weekStartsOn ??
                    getDefaultWorkspacePreferences("calendar").weekStartsOn
                  }
                  onSelect={selectDrillDown}
                />
              ) : null}
              <div hidden={view !== "list"}>
                <SpendingList
                  groups={result.groups}
                  onSelect={selectGroup}
                  {...(result.monthlyBudget ? { monthlyBudget: result.monthlyBudget } : {})}
                />
              </div>
            </>
          ) : (
            <Empty>
              <EmptyHeader>
                <EmptyTitle>No spending in this selection</EmptyTitle>
                <EmptyDescription>
                  Try another period or account selection. Coverage and source availability are
                  shown above.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
          <SpendingDetail
            data={result}
            group={
              recovery.state === "valid"
                ? recoveredSelection
                : selected
                  ? (result.groups
                      .flatMap((group) => [group, ...group.categories])
                      .find((group) => group.id === selected.id) ?? null)
                  : null
            }
            onSelect={selectGroup}
            drillDown={recovery.state === "valid" ? recoveredDrillDown : selectedDrillDown}
            onClose={() => {
              leaveRecovery();
              setSelected(null);
              setSelectedDrillDown(null);
            }}
          />
        </>
      ) : null}
    </div>
  );
}
