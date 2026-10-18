import {
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
  const view = choice("view", defaults.financeSpendingView) === "list" ? "list" : "bubbles";
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
  const range = spendingPeriod(
    period,
    anchor,
    calendar.data?.preferences.weekStartsOn ??
      getDefaultWorkspacePreferences("calendar").weekStartsOn,
    params.get("through") ?? today,
  );
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
  const data = useQuery({
    queryKey: ["finance-spending", user.data?.id, parsed.success ? parsed.data : null],
    enabled:
      !!timezone && preferences.isSuccess && calendar.isSuccess && parsed.success && validAnchor,
    queryFn: () => {
      if (!parsed.success) throw new Error("Invalid spending filters");
      return api.getFinanceSpending(parsed.data);
    },
  });
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
      <SpendingPeriodControls
        period={period}
        {...range}
        onPeriod={(value) => {
          const next = new URLSearchParams(params);
          next.set("period", value);
          next.delete("from");
          next.delete("through");
          setParams(next);
          save.mutate({ financeSpendingPeriod: value as SpendingPeriod });
          setSelected(null);
        }}
        onDates={(from, through) => {
          const next = new URLSearchParams(params);
          next.set("from", from);
          next.set("through", through);
          setParams(next);
          setSelected(null);
        }}
        onMove={(direction) => update("from", moveSpendingPeriod(period, range.from, direction))}
      />
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
            <label key={key} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                disabled={disabled}
                checked={bool(key, defaults[pref])}
                onChange={(event) =>
                  update(key, event.target.checked ? "1" : "0", pref, event.target.checked)
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
              <label key={account.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  disabled={disabled}
                  checked={accountIds === null || accountIds.includes(account.id)}
                  onChange={(event) => {
                    const ids = accountIds ?? result.accounts.map((item) => item.id);
                    const next = event.target.checked
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
      {timezone && (!parsed.success || !validAnchor) ? (
        <p>
          These spending filters are invalid. Choose a valid date range and accounting settings.
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
              {range.from} – {range.through} · USD ·{" "}
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
            Monthly budget comparison unavailable: approved historical budget account and currency
            scope is unresolved.
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
          {result.source.reasons.length ? (
            <p className="text-sm text-muted-foreground">
              Source qualifications: {result.source.reasons.join(", ")}
            </p>
          ) : null}
          {result.groups.length ? (
            <>
              <div hidden={view !== "bubbles"}>
                <SpendingBubbles
                  groups={result.groups}
                  onSelect={setSelected}
                  layoutKey={result.effectiveGrouping}
                />
              </div>
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
            onClose={() => setSelected(null)}
          />
        </>
      ) : null}
    </div>
  );
}
