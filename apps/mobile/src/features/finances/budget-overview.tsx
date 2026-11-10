import type { FinanceBudgetStatus } from "@personal-os/domain";
import { router } from "expo-router";
import { Pressable, Text, View } from "react-native";
import Svg, { Circle } from "react-native-svg";
import { Icon } from "../../components/icons";
import { spacing, useTheme, workspaceColor } from "../../theme";
import { budgetPace, categoryIcon } from "./category-presentation";
import { useFinance, useFinanceRead, useSpending } from "./data";
import { financeLabel, formatMoney, periodScope } from "./presentation";
import { Card, Copy, ReadState } from "./ui";

/** Each track compares spending with that category's own limit, not the whole plan. */
function CategoryProgress({ item }: { item: FinanceBudgetStatus }) {
  const t = useTheme();
  const valid =
    Number.isFinite(item.spent) && Number.isFinite(item.budget.limit) && item.budget.limit > 0;
  const percent = valid ? Math.max(0, (item.spent / item.budget.limit) * 100) : 0;
  const { timezone } = useFinance();
  const pace = budgetPace(item.spent, item.budget.limit, timezone);
  const over = pace === "over";
  const color = over ? t.destructive : pace === "high" ? t.warning : workspaceColor(t, "finances");
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${item.budget.category}, ${formatMoney(item.spent, "USD")} spent. View transactions and edit limit`}
      onPress={() =>
        router.push({
          pathname: "/finance-budget-category",
          params: { id: item.budget.id, month: item.budget.month },
        })
      }
      style={{ gap: spacing.sm, minHeight: 44 }}
    >
      <View
        style={{
          flexDirection: "row",
          flexWrap: "wrap",
          justifyContent: "space-between",
          gap: spacing.sm,
        }}
      >
        <View
          style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, flexShrink: 1 }}
        >
          <Icon name={categoryIcon(item.budget.category)} color={t.secondary} size={18} />
          <Text style={{ color: t.ink, fontSize: 16, fontWeight: "600", flexShrink: 1 }}>
            {item.budget.category}
          </Text>
        </View>
        <Text
          style={{
            color: over ? t.destructive : pace === "high" ? t.warning : t.secondary,
            fontSize: 14,
            fontVariant: ["tabular-nums"],
          }}
        >
          {formatMoney(Math.abs(item.remaining), "USD")} {over ? "over" : "left"}
        </Text>
      </View>
      <View
        accessibilityRole="progressbar"
        accessibilityLabel={`${item.budget.category} spending`}
        accessibilityValue={{
          min: 0,
          max: 100,
          now: Math.min(100, Math.round(percent)),
          text: valid
            ? `${formatMoney(item.spent, "USD")} of ${formatMoney(item.budget.limit, "USD")}; ${Math.round(percent)}% used${over ? "; over limit" : pace === "high" ? "; pacing high" : ""}`
            : "Spending unavailable",
        }}
        style={{ height: 10, borderRadius: 5, backgroundColor: t.line, overflow: "hidden" }}
      >
        <View
          style={{
            height: "100%",
            width: `${Math.min(100, percent)}%`,
            borderRadius: 5,
            backgroundColor: color,
          }}
        />
      </View>
      <Text style={{ color: t.secondary, fontSize: 14, fontVariant: ["tabular-nums"] }}>
        {formatMoney(item.spent, "USD")} of {formatMoney(item.budget.limit, "USD")}
        {pace === "high" ? " · Pacing high" : ""}
      </Text>
    </Pressable>
  );
}

export function BudgetOverview() {
  const t = useTheme();
  const { timezone } = useFinance();
  const month = timezone ? periodScope("month", timezone).from.slice(0, 7) : undefined;
  const plan = useFinanceRead(["budget"], (api) => api.getFinanceBudget());
  const limits = useFinanceRead(
    ["budget-status", month],
    (api) => api.getFinanceBudgetStatus(month),
    !!month,
  );
  const spending = useSpending("month");
  const budget = plan.data?.data;
  const baseline = spending.data?.monthlyBudget;
  const totals =
    baseline?.state === "qualified" &&
    baseline.month === month &&
    baseline.coverage === "complete" &&
    baseline.totals &&
    baseline.totals.budgetCents > 0
      ? baseline.totals
      : null;
  const spent = totals ? totals.usedCents / 100 : null;
  const percent = totals
    ? Math.max(0, Math.round((totals.usedCents / totals.budgetCents) * 100))
    : null;
  const ringColor =
    percent !== null && percent > 100 ? t.destructive : workspaceColor(t, "finances");
  const budgetMonth = budget
    ? new Date(`${budget.effectiveFrom.slice(0, 7)}-01T12:00:00Z`).toLocaleDateString("en-US", {
        month: "long",
        timeZone: "UTC",
      })
    : "";
  const spendingStatus =
    spending.data &&
    (spending.data.snapshot.coverage !== "complete" || spending.data.currency.unsupported.length)
      ? "Partial total"
      : spending.data && spending.data.source.freshness !== "current"
        ? "Needs update"
        : null;
  return (
    <Card>
      <ReadState query={plan}>
        {budget ? (
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              gap: spacing.md,
              flexWrap: "wrap",
            }}
          >
            <View style={{ gap: spacing.sm, flexShrink: 1 }}>
              <Copy secondary>{`${totals ? "Spending budget" : "Plan"} · ${budgetMonth}`}</Copy>
              <Text
                style={{
                  color: t.ink,
                  fontSize: 30,
                  fontWeight: "600",
                  fontVariant: ["tabular-nums"],
                }}
              >
                {formatMoney(totals ? totals.budgetCents / 100 : budget.allocatedTotal, "USD")}
              </Text>
              {!totals && (
                <Copy
                  secondary
                >{`${budget.status === "active" ? "" : budget.status === "proposed" ? "Proposal — not approved · " : `${financeLabel(budget.status)} · `}v${budget.version}`}</Copy>
              )}
            </View>
            <ReadState query={spending}>
              <View
                accessible
                accessibilityLabel={
                  percent === null
                    ? "Budget spending unavailable"
                    : `${percent}% spent: ${formatMoney(spent, "USD")} of ${formatMoney((totals?.budgetCents ?? 0) / 100, "USD")}${spendingStatus ? `, ${spendingStatus}` : ""}`
                }
                style={{ alignItems: "center", gap: spacing.xs }}
              >
                <View
                  style={{
                    width: 100,
                    height: 100,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Svg width={100} height={100} style={{ position: "absolute" }}>
                    <Circle cx={50} cy={50} r={43} stroke={t.line} strokeWidth={8} fill="none" />
                    {percent !== null && percent > 0 && (
                      <Circle
                        cx={50}
                        cy={50}
                        r={43}
                        stroke={ringColor}
                        strokeWidth={8}
                        fill="none"
                        strokeDasharray={`${2 * Math.PI * 43}`}
                        strokeDashoffset={2 * Math.PI * 43 * (1 - Math.min(percent, 100) / 100)}
                        strokeLinecap="round"
                        rotation={-90}
                        origin="50, 50"
                      />
                    )}
                  </Svg>
                  <Text style={{ color: t.ink, fontSize: 22, fontWeight: "600" }}>
                    {percent === null ? "—" : `${percent}%`}
                  </Text>
                  <Text style={{ color: t.secondary, fontSize: 12 }}>
                    {percent === null ? "Unavailable" : "spent"}
                  </Text>
                </View>
                {spendingStatus && percent !== null && (
                  <Text style={{ color: t.secondary, fontSize: 12 }}>{spendingStatus}</Text>
                )}
              </View>
            </ReadState>
          </View>
        ) : (
          <Copy secondary>No budget proposal yet.</Copy>
        )}
      </ReadState>
      <View style={{ gap: spacing.lg, marginTop: spacing.sm }}>
        <ReadState query={{ ...limits, configurationMissing: !timezone }}>
          {limits.data?.length ? (
            limits.data.map((item) => <CategoryProgress key={item.budget.id} item={item} />)
          ) : (
            <Copy secondary>No category limits set for this month.</Copy>
          )}
        </ReadState>
      </View>
    </Card>
  );
}
