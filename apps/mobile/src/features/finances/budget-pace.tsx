import type { FinanceBudgetPace, FinanceBudgetPaceCell } from "@personal-os/domain";
import { useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { spacing, useTheme } from "../../theme";
import { useFinanceRead, useFinanceRefresh } from "./data";
import { formatMoney } from "./presentation";
import { Card, Copy, ReadState, Section, Segments } from "./ui";

const periods = { Week: "week", Month: "month", Year: "year" } as const;
const paceCopy: Record<FinanceBudgetPaceCell["status"], string> = {
  ahead: "Ahead of pace",
  behind: "Over pace",
  neutral: "On pace",
  blank: "No activity",
};
const refreshKeys = ["budget-pace"] as const;
const weekdays = ["S", "M", "T", "W", "T", "F", "S"];

function dayName(date: string) {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** Month and year grids start on Sunday, so the first week is padded to its weekday. */
function leadingDays(data: FinanceBudgetPace) {
  const first = data.cells[0];
  return data.period === "week" || !first ? 0 : new Date(`${first.date}T12:00:00Z`).getUTCDay();
}

function Cells({ data }: { data: FinanceBudgetPace }) {
  const t = useTheme();
  const size = data.period === "week" ? 36 : data.period === "month" ? 30 : 12;
  const gap = data.period === "year" ? 3 : 6;
  const color = (status: FinanceBudgetPaceCell["status"]) =>
    status === "ahead" ? t.success : status === "behind" ? t.destructive : t.line;
  const cell = (key: string, status: FinanceBudgetPaceCell["status"], label?: string) => (
    <View
      key={key}
      accessible={!!label}
      accessibilityLabel={label}
      style={{
        width: size,
        height: size,
        borderRadius: data.period === "year" ? 3 : 8,
        backgroundColor: color(status),
        opacity: label ? 1 : 0,
      }}
    />
  );
  const cells = [
    ...Array.from({ length: leadingDays(data) }, (_, index) => cell(`leading-${index}`, "blank")),
    ...data.cells.map((item) =>
      cell(
        item.date,
        item.status,
        item.status === "blank"
          ? `${dayName(item.date)}: ${paceCopy.blank}.`
          : `${dayName(item.date)}: ${paceCopy[item.status]}. ${formatMoney(item.spent, "USD")} spent against ${formatMoney(item.planned, "USD")} paced.`,
      ),
    ),
  ];
  if (data.period === "year")
    return (
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View
          style={{ height: 7 * size + 6 * gap, flexDirection: "column", flexWrap: "wrap", gap }}
        >
          {cells}
        </View>
      </ScrollView>
    );
  return (
    <View style={{ gap }}>
      {data.period === "month" && (
        <View style={{ flexDirection: "row", gap }}>
          {weekdays.map((day, index) => (
            <Text
              // biome-ignore lint/suspicious/noArrayIndexKey: the seven weekday columns are fixed and two share a letter.
              key={index}
              style={{ width: size, textAlign: "center", color: t.secondary, fontSize: 12 }}
            >
              {day}
            </Text>
          ))}
        </View>
      )}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap, width: 7 * size + 6 * gap }}>
        {cells}
      </View>
    </View>
  );
}

/** Each day's posted spending against the pace of the month's category limits. */
export function BudgetPace() {
  const t = useTheme();
  const [mode, setMode] = useState<keyof typeof periods>("Week");
  const period = periods[mode];
  useFinanceRefresh(refreshKeys);
  const query = useFinanceRead(["budget-pace", period], (api) => api.getFinanceBudgetPace(period));
  const data = query.data;
  const latest = data?.cells.find((item) => item.date === data.asOf);
  const hasBudget = data?.cells.some((item) => item.planned > 0) ?? false;
  return (
    <Section title="Budget pace">
      <Card>
        <Segments value={mode} options={["Week", "Month", "Year"]} onChange={setMode} />
        <ReadState query={query}>
          {data && !hasBudget ? (
            <Copy secondary>
              Set monthly category limits to see whether your spending is on pace.
            </Copy>
          ) : data ? (
            <>
              <View style={{ gap: spacing.xs }}>
                <Text
                  style={{
                    color: latest?.status === "behind" ? t.destructive : t.ink,
                    fontSize: 17,
                    fontWeight: "600",
                  }}
                >
                  {paceCopy[latest?.status ?? "blank"]}
                </Text>
                {latest && latest.status !== "blank" && (
                  <Copy secondary>
                    {`${formatMoney(latest.spent, "USD")} spent against ${formatMoney(latest.planned, "USD")} paced`}
                  </Copy>
                )}
              </View>
              <Cells data={data} />
              <Copy secondary>Green is ahead of pace, red is over, grey has no signal.</Copy>
            </>
          ) : null}
        </ReadState>
      </Card>
    </Section>
  );
}
