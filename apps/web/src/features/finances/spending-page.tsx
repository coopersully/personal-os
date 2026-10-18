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
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useSaveWorkspacePreferences,
  useWorkspacePreferences,
} from "../workspace-settings/preferences";
import { WorkspacePreferenceRecovery } from "../workspace-settings/save-recovery";
import { formatMoney } from "./format";
import { SpendingBubbles } from "./spending-bubbles";
import { SpendingChoice, SpendingPeriodControls } from "./spending-controls";
import { SpendingDetail } from "./spending-detail";
import { SpendingList } from "./spending-list";
import {
  moveSpendingPeriod,
  type SpendingPeriod,
  spendingPeriod,
  spendingToday,
} from "./spending-period";
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
  const [params, setParams] = useSearchParams();
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
  const timezone = user.data?.planningTimezone;
  const today = timezone ? spendingToday(timezone) : "2000-01-01";
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
  const parsed = financeSpendingQuerySchema.safeParse({
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
  });
  const comparisonScopes =
    parsed.success && view === "trends"
      ? spendingComparisonScopes(parsed.data.scope, period, openedAt)
      : null;
  const activeQuery = parsed.success
    ? { ...parsed.data, scope: comparisonScopes?.current ?? parsed.data.scope }
    : null;
  const queryEnabled =
    !!timezone && preferences.isSuccess && calendar.isSuccess && !!activeQuery && validAnchor;
  const data = useQuery({
    queryKey: ["finance-spending", user.data?.id, activeQuery],
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
    setParams(next);
    if (preference) save.mutate({ [preference]: persisted });
    setSelected(null);
    setSelectedDrillDown(null);
  }
  const disabled = !preferences.isSuccess || save.isWorkspacePending || !!save.recovery;
  const result = data.data;
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap gap-4">
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
      </div>
      <fieldset disabled={disabled}>
        <SpendingPeriodControls
          period={rhythmDefault ? "custom" : period}
          {...range}
          onPeriod={(value) => {
            const next = new URLSearchParams(params);
            next.set("period", value);
            next.delete("from");
            next.delete("through");
            setParams(next);
            save.mutate({ financeSpendingPeriod: value as SpendingPeriod });
            setSelected(null);
            setSelectedDrillDown(null);
          }}
          onDates={(from, through) => {
            const next = new URLSearchParams(params);
            next.set("period", "custom");
            next.set("from", from);
            next.set("through", through);
            setParams(next);
            save.mutate({ financeSpendingPeriod: "custom" });
            setSelected(null);
            setSelectedDrillDown(null);
          }}
          onMove={(direction) => update("from", moveSpendingPeriod(period, range.from, direction))}
        />
      </fieldset>
      {rhythmDefault ? (
        <p className="text-sm text-muted-foreground">
          Last three calendar months · Recorded evidence only
        </p>
      ) : null}
      <details>
        <summary className="cursor-pointer text-sm">Spending options</summary>
        <div className="flex flex-wrap gap-4 py-3">
          <SpendingChoice
            label="Basis"
            value={choice("basis", defaults.financeSpendingBasis)}
            options={[
              ["personal_cost", "Personal cost"],
              ["full_outflow", "Full outflow"],
            ]}
            disabled={disabled}
            onChange={(value) => update("basis", value, "financeSpendingBasis")}
          />
          {(
            [
              ["pending", "Include pending", "financeSpendingIncludePending"],
              ["refunds", "Subtract matched refunds", "financeSpendingSubtractRefunds"],
              ["uncategorized", "Include uncategorized", "financeSpendingIncludeUncategorized"],
            ] as const
          ).map(([key, label, pref]) => (
            <label
              key={key}
              htmlFor={`spending-${key}`}
              className="flex items-center gap-2 text-sm"
            >
              <Checkbox
                id={`spending-${key}`}
                disabled={disabled}
                checked={bool(key, defaults[pref])}
                onCheckedChange={(checked) =>
                  update(key, checked === true ? "1" : "0", pref, checked === true)
                }
              />
              {label}
            </label>
          ))}
        </div>
        {result ? (
          <fieldset className="flex flex-wrap gap-3">
            <legend>Accounts</legend>
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
            {result.accounts.map((account) => (
              <label
                key={account.id}
                htmlFor={`spending-account-${account.id}`}
                className="flex items-center gap-2 text-sm"
              >
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
                {account.label}
              </label>
            ))}
          </fieldset>
        ) : null}
      </details>
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
          <div>
            <p className="text-3xl font-semibold tabular-nums">
              {formatMoney(result.snapshot.netCents / 100)}
            </p>
            <p className="text-sm text-muted-foreground">
              {result.snapshot.scope.from} – {result.snapshot.scope.through} · USD ·{" "}
              {parsed.success && parsed.data.scope.includePending
                ? "Includes pending"
                : "Posted only"}
            </p>
            <p className="text-sm text-muted-foreground">
              Coverage: {result.snapshot.coverage} · Source: {result.source.freshness}
              {result.source.lastSyncedAt
                ? ` · Last synced ${result.source.lastSyncedAt}`
                : " · Last sync unknown"}
            </p>
          </div>
          <p className="text-sm text-muted-foreground">
            Monthly budget comparison unavailable: budget account and currency scope is not
            established.
          </p>
          {result.groupingFallback ? (
            <p>Buckets unavailable; showing categories. Your grouping preference is retained.</p>
          ) : null}
          {result.excludedUncategorizedCents !== 0 ? (
            <p>Excluded uncategorized: {formatMoney(result.excludedUncategorizedCents / 100)}</p>
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
            <details>
              <summary className="cursor-pointer text-sm">Why these totals are qualified</summary>
              <ul className="flex flex-col gap-2 py-2">
                {[
                  ...result.source.reasons.map((code) => ({ code, sourceIds: [] as string[] })),
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
            </details>
          ) : null}
          {result.groups.length || view === "trends" || view === "rhythm" ? (
            <>
              <div hidden={view !== "bubbles"}>
                <SpendingBubbles
                  groups={result.groups}
                  onSelect={setSelected}
                  layoutKey={result.effectiveGrouping}
                />
              </div>
              {view === "trends" ? (
                <>
                  <details>
                    <summary className="cursor-pointer text-sm">Focus on a group</summary>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        variant="ghost"
                        onClick={() => {
                          const next = new URLSearchParams(params);
                          next.delete("categories");
                          setParams(next);
                          setSelected(null);
                          setSelectedDrillDown(null);
                        }}
                      >
                        All categories
                      </Button>
                      {result.groups.map((group) => (
                        <Button
                          key={group.id}
                          variant="ghost"
                          onClick={() =>
                            update(
                              "categories",
                              group.categoryIds.map((id) => id ?? "uncategorized").join(","),
                            )
                          }
                        >
                          {group.label}
                        </Button>
                      ))}
                    </div>
                  </details>
                  <p className="text-sm text-muted-foreground">{comparisonScopes?.label}</p>
                  <FinanceSpendingTrends
                    dashboard={result}
                    {...(comparison.data ? { comparison: comparison.data } : {})}
                    comparisonLoading={comparison.isLoading}
                    onSelect={(drillDown) => {
                      setSelected(null);
                      setSelectedDrillDown(drillDown);
                    }}
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
                  onSelect={(drillDown) => {
                    setSelected(null);
                    setSelectedDrillDown(drillDown);
                  }}
                />
              ) : null}
              <div hidden={view !== "list"}>
                <SpendingList groups={result.groups} onSelect={setSelected} />
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
              selected
                ? (result.groups
                    .flatMap((group) => [group, ...group.categories])
                    .find((group) => group.id === selected.id) ?? null)
                : null
            }
            onSelect={setSelected}
            drillDown={selectedDrillDown}
            onClose={() => {
              setSelected(null);
              setSelectedDrillDown(null);
            }}
          />
        </>
      ) : null}
    </div>
  );
}
