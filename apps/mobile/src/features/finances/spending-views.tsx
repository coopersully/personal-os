import type { FinanceSpendingDashboard } from "@personal-os/domain";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { SettingsAccentProvider } from "../../components/settings-accent";
import { radius, spacing, useTheme, workspaceColor } from "../../theme";
import { DateField } from "../tasks/date-field";
import { categoryIcon } from "./category-presentation";
import { formatMoney } from "./presentation";
import {
  binLabel,
  type SpendingBin,
  spendingBinStatus,
  spendingHourlyBins,
  spendingRhythmBins,
  spendingTrendBins,
  type WeekStart,
  weekdayOffset,
} from "./spending-math";
import { Card, Copy, FinanceRow, ReadState } from "./ui";

/** Opens the transactions behind a part of the summary: a group, or a span of days. */
export type OpenSpendingEvidence = (
  title: string,
  from: string,
  through: string,
  groupId?: string,
) => void;

const money = (cents: number) => formatMoney(cents / 100, "USD");

export function CustomRange({
  from,
  through,
  problem,
  onChange,
}: {
  from: string;
  through: string;
  problem: string | null;
  onChange: (from: string, through: string) => void;
}) {
  return (
    <SettingsAccentProvider workspace="finances">
      <DateField
        label="From"
        dateOnly
        value={from || null}
        onChange={(value) => onChange(value?.slice(0, 10) ?? "", through)}
      />
      <DateField
        label="Through"
        dateOnly
        value={through || null}
        onChange={(value) => onChange(from, value?.slice(0, 10) ?? "")}
      />
      {problem && <Copy secondary>{problem}</Copy>}
    </SettingsAccentProvider>
  );
}

export function SpendingList({
  dashboard,
  from,
  through,
  onOpen,
}: {
  dashboard: FinanceSpendingDashboard;
  from: string;
  through: string;
  onOpen?: OpenSpendingEvidence;
}) {
  return (
    <>
      <Card rows={dashboard.groups.length > 0}>
        {dashboard.groups.length ? (
          dashboard.groups.map((item) => (
            <FinanceRow
              key={item.id}
              title={item.label}
              icon={categoryIcon(item.label, item.visual?.icon, item.kind ?? "category")}
              value={money(item.netCents)}
              onPress={onOpen ? () => onOpen(item.label, from, through, item.id) : undefined}
            />
          ))
        ) : (
          <Copy secondary>No spending in this period.</Copy>
        )}
      </Card>
      {dashboard.excludedUncategorizedCents !== 0 && (
        <Copy secondary>
          Uncategorized spending left out: {money(dashboard.excludedUncategorizedCents)}
        </Copy>
      )}
    </>
  );
}

function Bars({ bins }: { bins: readonly SpendingBin[] }) {
  const t = useTheme();
  const scale = Math.max(1, ...bins.map((bin) => Math.abs(bin.netCents)));
  return (
    <View
      style={{ flexDirection: "row", alignItems: "flex-end", gap: bins.length > 14 ? 2 : 6 }}
      accessibilityLabel="Spending over time"
    >
      {bins.map((bin) => (
        <View
          key={bin.date}
          testID="trend-bar"
          accessible
          accessibilityLabel={`${binLabel(bin)}: ${money(bin.netCents)}, ${spendingBinStatus(bin)}`}
          style={{ flex: 1, height: 96, justifyContent: "flex-end" }}
        >
          <View
            style={{
              height: bin.future ? 2 : Math.max(3, (Math.abs(bin.netCents) / scale) * 96),
              borderRadius: 4,
              backgroundColor: bin.netCents < 0 ? t.information : workspaceColor(t, "finances"),
              opacity: bin.future ? 0.15 : bin.provisional || bin.coverage !== "complete" ? 0.6 : 1,
            }}
          />
        </View>
      ))}
    </View>
  );
}

type Read<T> = {
  feedbackKey?: string;
  isPending: boolean;
  isError: boolean;
  error?: unknown;
  data: T | undefined;
  refetch: () => Promise<{ isError: boolean }>;
};

export function SpendingTrends({
  dashboard,
  previous,
  comparisonLabel,
  onOpen,
}: {
  dashboard: FinanceSpendingDashboard;
  previous: Read<FinanceSpendingDashboard>;
  comparisonLabel: string;
  onOpen?: OpenSpendingEvidence;
}) {
  const { grain, bins } = spendingTrendBins(dashboard);
  const shown = bins.filter((bin) => !bin.future);
  const change = previous.data
    ? dashboard.snapshot.netCents - previous.data.snapshot.netCents
    : null;
  // A comparison of incomplete or stale periods is stated as such, never as a firm difference.
  const qualified =
    dashboard.snapshot.coverage !== "complete" ||
    previous.data?.snapshot.coverage !== "complete" ||
    dashboard.source.freshness !== "current" ||
    previous.data?.source.freshness !== "current";
  return (
    <>
      <Card>
        <Copy secondary>{grain} spending</Copy>
        <Bars bins={bins} />
      </Card>
      <ReadState query={previous}>
        {previous.data && change !== null && (
          <Card>
            <Copy>
              {comparisonLabel}: {money(previous.data.snapshot.netCents)}
            </Copy>
            <Copy secondary>
              {change === 0
                ? "No change"
                : `${money(Math.abs(change))} ${change > 0 ? "more" : "less"} this period`}
              {qualified ? " · some of this data is incomplete or out of date" : ""}
            </Copy>
          </Card>
        )}
      </ReadState>
      <Card rows={shown.length > 0}>
        {shown.length ? (
          shown.map((bin) => (
            <FinanceRow
              key={bin.date}
              title={binLabel(bin)}
              subtitle={spendingBinStatus(bin)}
              icon="history"
              value={money(bin.netCents)}
              onPress={
                onOpen && bin.drillDown.transactionIds.length
                  ? () => onOpen(binLabel(bin), bin.date, bin.through)
                  : undefined
              }
            />
          ))
        ) : (
          <Copy secondary>No days in this period have happened yet.</Copy>
        )}
      </Card>
    </>
  );
}

type Block = {
  key: string;
  label: string;
  short: string;
  netCents: number;
  future: boolean;
  status: string;
  /** Null when a block cannot honestly select transactions, as for an hour of the day. */
  range: { from: string; through: string } | null;
};

function rhythmBlocks(dashboard: FinanceSpendingDashboard, weekStartsOn: WeekStart) {
  const { scope, asOf, coverage, contributions } = dashboard.snapshot;
  const result = spendingRhythmBins(dashboard, weekStartsOn);
  if (result.grain !== "Hourly") {
    const blocks: Block[] = result.bins.map((bin) => ({
      key: bin.date,
      label: binLabel(bin),
      short:
        result.grain === "Daily"
          ? String(Number(bin.date.slice(8)))
          : result.grain === "Yearly"
            ? bin.date.slice(0, 4)
            : binLabel({ date: bin.date, through: bin.date }),
      netCents: bin.netCents,
      future: bin.future,
      status: spendingBinStatus(bin),
      range: bin.drillDown.transactionIds.length ? { from: bin.date, through: bin.through } : null,
    }));
    return { grain: result.grain, blocks };
  }
  const { hours, untimedCents, untimedCount } = spendingHourlyBins(dashboard);
  const parts = new Map(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: scope.timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(new Date(asOf))
      .map((part) => [part.type, part.value]),
  );
  const today = `${parts.get("year")}-${parts.get("month")}-${parts.get("day")}`;
  const blocks: Block[] = hours.map((hour) => {
    const future =
      scope.from > today || (scope.from === today && hour.hour > Number(parts.get("hour")));
    const complete = !future && coverage === "complete" && untimedCount === 0;
    const label = `${hour.hour % 12 || 12} ${hour.hour < 12 ? "AM" : "PM"}`;
    return {
      key: String(hour.hour),
      label,
      short: label,
      netCents: hour.netCents,
      future,
      status: hour.count
        ? `${money(hour.netCents)} recorded${complete ? "" : " · Incomplete hourly coverage"}`
        : future
          ? "Future hour"
          : complete
            ? "No spending"
            : "Hourly amount unavailable",
      range: null,
    };
  });
  if (untimedCount > 0)
    blocks.push({
      key: "untimed",
      label: "Time not provided",
      short: "No time",
      netCents: untimedCents,
      future: false,
      status: `${untimedCount} ${untimedCount === 1 ? "item" : "items"} · Purchase times not provided`,
      range: contributions.length ? { from: scope.from, through: scope.through } : null,
    });
  return { grain: result.grain, blocks };
}

const weekdays = ["S", "M", "T", "W", "T", "F", "S"];

export function SpendingRhythm({
  dashboard,
  weekStartsOn,
  onOpen,
}: {
  dashboard: FinanceSpendingDashboard;
  weekStartsOn: WeekStart;
  onOpen?: OpenSpendingEvidence;
}) {
  const t = useTheme();
  const { grain, blocks } = rhythmBlocks(dashboard, weekStartsOn);
  const [chosen, setChosen] = useState<string | null>(null);
  const selected = blocks.find((block) => block.key === chosen) ?? null;
  const scale = Math.max(1, ...blocks.map((block) => Math.abs(block.netCents)));
  const daily = grain === "Daily";
  const columns = daily ? 7 : 4;
  const first = blocks[0];
  const lead = daily && first ? weekdayOffset(first.key, weekStartsOn) : 0;
  const cells: (Block | null)[] = [...Array.from({ length: lead }, () => null), ...blocks];
  while (cells.length % columns) cells.push(null);
  const rows = Array.from({ length: cells.length / columns }, (_, row) =>
    cells.slice(row * columns, (row + 1) * columns),
  );
  const start = weekStartsOn === "monday" ? 1 : 0;
  return (
    <>
      <Card>
        <Copy secondary>{grain} rhythm · a stronger colour is more spending</Copy>
        {daily && (
          <View style={{ flexDirection: "row", gap: spacing.xs }}>
            {weekdays.map((_, index) => (
              <Text
                // biome-ignore lint/suspicious/noArrayIndexKey: the seven columns are fixed.
                key={index}
                style={{ flex: 1, textAlign: "center", color: t.secondary, fontSize: 12 }}
              >
                {weekdays[(index + start) % 7]}
              </Text>
            ))}
          </View>
        )}
        {rows.map((row, index) => (
          <View
            // biome-ignore lint/suspicious/noArrayIndexKey: rows are positions in a fixed grid.
            key={index}
            testID="rhythm-row"
            style={{ flexDirection: "row", gap: spacing.xs }}
          >
            {row.map((block, column) =>
              block ? (
                <Pressable
                  key={block.key}
                  accessibilityRole="button"
                  accessibilityLabel={`${block.label}: ${money(block.netCents)}, ${block.status}`}
                  accessibilityState={{ selected: block.key === chosen }}
                  onPress={() => setChosen(block.key)}
                  style={{
                    flex: 1,
                    minHeight: 44,
                    borderRadius: radius.menu,
                    alignItems: "center",
                    justifyContent: "center",
                    borderWidth: block.key === chosen ? 2 : 0,
                    borderColor: t.ink,
                    backgroundColor: t.surface,
                    overflow: "hidden",
                  }}
                >
                  <View
                    style={{
                      position: "absolute",
                      top: 0,
                      right: 0,
                      bottom: 0,
                      left: 0,
                      backgroundColor:
                        block.netCents < 0 ? t.information : workspaceColor(t, "finances"),
                      opacity:
                        block.future || block.netCents === 0
                          ? 0
                          : 0.15 + (Math.abs(block.netCents) / scale) * 0.6,
                    }}
                  />
                  <Text style={{ color: block.future ? t.secondary : t.ink, fontSize: 13 }}>
                    {block.short}
                  </Text>
                </Pressable>
              ) : (
                // biome-ignore lint/suspicious/noArrayIndexKey: blank cells only hold a column.
                <View key={`blank-${column}`} style={{ flex: 1 }} />
              ),
            )}
          </View>
        ))}
      </Card>
      {selected ? (
        <Card rows>
          <FinanceRow
            title={selected.label}
            subtitle={selected.status}
            icon="history"
            value={money(selected.netCents)}
            accessibilityHint={
              onOpen && selected.range ? "Shows the transactions behind this amount" : undefined
            }
            onPress={
              onOpen && selected.range
                ? () =>
                    selected.range &&
                    onOpen(selected.label, selected.range.from, selected.range.through)
                : undefined
            }
          />
        </Card>
      ) : (
        <Copy secondary>
          {grain === "Hourly" ? "Choose an hour to see it." : "Choose a block to see its spending."}
        </Copy>
      )}
    </>
  );
}
