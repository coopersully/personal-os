import {
  localDateAt,
  localDateTimeToUtc,
  localDateToIso,
  parseLocalDate,
  type TaskWorkspaceItem,
} from "@personal-os/domain";
import { type Href, router, Stack } from "expo-router";
import { useContext, useEffect, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Icon, type IconName } from "../../components/icons";
import { RecordRow } from "../../components/record-row";
import { Screen } from "../../components/screen";
import {
  useWorkspaceHeaderInset,
  WorkspaceHeroVisibility,
} from "../../components/workspace-header-inset";
import { radius, spacing, useTheme, workspaceColor } from "../../theme";
import { budgetPace, categoryIcon } from "../finances/category-presentation";
import {
  expectedAmount,
  financeLabel,
  formatLocalDate,
  formatMoney,
} from "../finances/presentation";
import { useTodayData } from "./live-data";
import { useTodaySky } from "./sky-context";
import { TodayHeroBackdrop } from "./today-hero";

type Row = {
  id: string;
  title: string;
  subtitle: string;
  value?: string;
  tone?: "attention" | "incorrect";
  icon: IconName;
  workspace: "tasks" | "finances";
  href: Href;
  at?: string;
};
function taskRow(item: TaskWorkspaceItem, timezone: string, now: Date, upcoming = false): Row {
  const due = upcoming ? item.relevantAt : item.record.dueAt;
  const overdue = !!due && Date.parse(due) < now.getTime();
  const when = due
    ? new Intl.DateTimeFormat("en-US", {
        timeZone: timezone,
        month: "short",
        day: "numeric",
      }).format(new Date(due))
    : "No due date";
  return {
    id: `${item.kind}:${item.record.id}`,
    title: item.record.title,
    subtitle: `${overdue ? "Overdue" : item.kind === "reminder" ? "Reminder" : "Task"}${item.record.priority === "high" ? " · High priority" : ""}`,
    value: when,
    tone: overdue ? "incorrect" : undefined,
    icon: item.kind === "reminder" ? "clock" : "tasks",
    workspace: "tasks",
    at: due ?? undefined,
    href: {
      pathname: "/task-editor",
      params: { id: item.record.id, kind: item.kind, readOnly: item.readOnly ? "1" : "0" },
    },
  };
}
function BriefSection({
  title,
  caption,
  rows,
  empty,
}: {
  title: string;
  caption?: string;
  rows: Row[];
  empty: string;
}) {
  const t = useTheme();
  return (
    <View style={{ gap: spacing.sm }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
        <Text
          accessibilityRole="header"
          style={{ color: t.ink, fontSize: 19, fontWeight: "600", flex: 1 }}
        >
          {title}
        </Text>
        {caption && <Text style={{ color: t.secondary, fontSize: 12 }}>{caption}</Text>}
      </View>
      <View
        style={{
          backgroundColor: t.surface,
          borderRadius: radius.panel,
          paddingHorizontal: spacing.md,
        }}
      >
        {rows.length ? (
          rows.map((row) => (
            <RecordRow
              key={row.id}
              title={row.title}
              subtitle={row.subtitle}
              value={row.value}
              valueTone={row.tone}
              leading={<Icon name={row.icon} color={workspaceColor(t, row.workspace)} />}
              onPress={() => router.push(row.href)}
            />
          ))
        ) : (
          <Text
            style={{
              color: t.secondary,
              fontSize: 15,
              lineHeight: 21,
              paddingVertical: spacing.md,
            }}
          >
            {empty}
          </Text>
        )}
      </View>
    </View>
  );
}
export default function TodayHome() {
  const t = useTheme();
  const atmosphere = useTodaySky();
  const headerInset = useWorkspaceHeaderInset();
  const heroHeight = useRef(400);
  const reportHero = useContext(WorkspaceHeroVisibility);
  useEffect(() => {
    reportHero.current(true);
    return () => reportHero.current(true);
  }, [reportHero]);
  const [heroVisible, setLocalHeroVisible] = useState(true);
  const data = useTodayData();
  const { timezone, now } = data;
  if (!timezone)
    return (
      <Screen chrome>
        <RecordRow
          title="Set your timezone"
          subtitle="Today uses your timezone for tasks and expected payments."
          leading={<Icon name="clock" color={t.secondary} />}
          onPress={() => router.push("/settings")}
        />
      </Screen>
    );
  const tasks = data.tasks.data?.items.map((item) => taskRow(item, timezone, now)) ?? [];
  const attention: Row[] = tasks.slice(0, 1);
  const reviews = data.reviews.data?.filter((review) => review.status !== "resolved") ?? [];
  if (reviews.length)
    attention.push({
      id: "reviews",
      title: `${reviews.length} ${reviews.length === 1 ? "transaction needs" : "transactions need"} your input`,
      subtitle:
        reviews.length === 1
          ? reviews[0].transaction.merchant
          : "Review categories and transaction details",
      value: "Review",
      tone: "attention",
      icon: "categoryTags",
      workspace: "finances",
      href:
        reviews.length === 1
          ? { pathname: "/finance-transaction", params: { id: reviews[0].transaction.id } }
          : { pathname: "/finances/assistant", params: { view: "For you" } },
    });
  const budgetAlerts = (data.budgets.data ?? [])
    .map((item) => ({ ...item, pace: budgetPace(item.spent, item.budget.limit, timezone, now) }))
    .filter((item) => item.pace === "over" || item.pace === "high")
    .sort((a, b) => Number(b.pace === "over") - Number(a.pace === "over"));
  const budget = budgetAlerts[0];
  if (budget)
    attention.push({
      id: "budget",
      title: budget.budget.category,
      subtitle:
        budgetAlerts.length > 1
          ? `${budgetAlerts.length} budget categories need attention`
          : "Monthly budget",
      value:
        budget.pace === "over"
          ? `${formatMoney(budget.spent - budget.budget.limit, "USD")} over`
          : "Pacing high",
      tone: budget.pace === "over" ? "incorrect" : "attention",
      icon: categoryIcon(budget.budget.category),
      workspace: "finances",
      href: {
        pathname: "/finance-budget-category",
        params: { id: budget.budget.id, month: budget.budget.month },
      },
    });
  attention.push(...tasks.slice(1, 3 - attention.length + 1));
  const end = new Date(`${data.range?.from}T12:00:00Z`);
  end.setUTCDate(end.getUTCDate() + 6);
  const through = end.toISOString().slice(0, 10);
  const occurrences = (data.upcoming.data?.occurrences ?? []).filter(
    (item) =>
      item.inCurrentSchedule &&
      ["expected", "partially_matched"].includes(item.matchState) &&
      item.localDate >= (data.range?.from ?? "") &&
      item.localDate <= through,
  );
  const upcoming: Row[] = [
    ...(data.nextTasks.data?.items ?? [])
      .map((item) => taskRow(item, timezone, now, true))
      .filter(
        (item) => item.at && localDateToIso(localDateAt(new Date(item.at), timezone)) <= through,
      ),
    ...occurrences.map(
      (item): Row => ({
        id: item.key,
        title: item.displayName,
        subtitle: `${formatLocalDate(item.localDate)} · ${item.source.kind === "income" ? "Income" : "Payment"} expected`,
        value: expectedAmount(item),
        icon: item.source.kind === "income" ? "categoryDollar" : "calendar",
        workspace: "finances",
        at: localDateTimeToUtc(parseLocalDate(item.localDate), 0, timezone).toISOString(),
        href: { pathname: "/finances/plan", params: { view: "Cash flow" } },
      }),
    ),
  ]
    .sort((a, b) => (a.at ?? "").localeCompare(b.at ?? ""))
    .slice(0, 3);
  const handled: Row[] = (data.activity.data?.entries ?? [])
    .filter(
      (entry) =>
        entry.kind === "financial_action" &&
        entry.actor?.type === "agent" &&
        entry.status === "applied" &&
        entry.occurredAt >= (data.start ?? ""),
    )
    .slice(0, 3)
    .map((entry) => {
      const transaction = entry.targets.find((target) => target.kind === "transaction");
      return {
        id: entry.id,
        title: financeLabel(entry.action),
        subtitle:
          entry.explanation.length > 140
            ? `${entry.explanation.slice(0, 137).trimEnd()}…`
            : entry.explanation,
        icon: "check",
        workspace: "finances",
        href: transaction
          ? { pathname: "/finance-transaction", params: { id: transaction.id } }
          : { pathname: "/finances/assistant", params: { view: "Activity" } },
      };
    });
  const attentionUnavailable = data.tasks.isError || data.reviews.isError || data.budgets.isError;
  const attentionLoading = data.tasks.isPending || data.reviews.isPending || data.budgets.isPending;
  const upcomingUnavailable =
    data.nextTasks.isError ||
    data.upcoming.isError ||
    !!data.upcoming.data?.unavailableSources.length;
  const bills = occurrences.filter((item) => item.source.kind === "obligation").length;
  const chips: { label: string; href: Href; tone?: "incorrect" }[] = [
    {
      label: data.tasks.data
        ? `${data.tasks.data.total} to-do${data.tasks.isError ? " · cached" : ""}`
        : data.tasks.isPending
          ? "Loading to-do…"
          : "To-do unavailable",
      href: "/tasks",
    },
    ...(data.overdue.data?.total
      ? [
          {
            label: `${data.overdue.data.total} overdue`,
            tone: "incorrect" as const,
            href: {
              pathname: "/task-browser" as const,
              params: { view: "today", due: "overdue", title: "Overdue", status: "open" },
            },
          },
        ]
      : []),
    {
      label: data.upcoming.data?.unavailableSources.length
        ? "Payment data incomplete"
        : data.upcoming.data
          ? `${bills} ${bills === 1 ? "payment" : "payments"}${data.upcoming.isError ? " · cached" : ""}`
          : data.upcoming.isPending
            ? "Loading payments…"
            : "Payments unavailable",
      href: { pathname: "/finances/plan", params: { view: "Cash flow" } },
    },
  ];
  return (
    <Screen
      chrome
      edgeToEdge
      bounces
      onRefresh={data.refresh}
      onScroll={({ nativeEvent }) => {
        const visible = nativeEvent.contentOffset.y < heroHeight.current - headerInset;
        setLocalHeroVisible(visible);
        reportHero.current(visible);
      }}
    >
      <Stack.Screen
        options={{
          statusBarStyle: (heroVisible ? atmosphere.sky.chromeDark : t.dark) ? "light" : "dark",
        }}
      />
      <View style={{ flexGrow: 1 }}>
        <View
          onLayout={({ nativeEvent }) => {
            heroHeight.current = nativeEvent.layout.height;
          }}
          style={{
            gap: spacing.md,
            paddingHorizontal: spacing.page,
            paddingTop: headerInset + spacing.md,
            paddingBottom: spacing.xl,
          }}
        >
          <TodayHeroBackdrop />
          <Text style={{ color: atmosphere.sky.secondary, fontSize: 13 }}>
            {new Intl.DateTimeFormat("en-US", {
              timeZone: timezone,
              weekday: "long",
              month: "long",
              day: "numeric",
            }).format(now)}
          </Text>
          <Text
            accessibilityRole="header"
            style={{
              color: atmosphere.sky.ink,
              fontSize: 30,
              fontWeight: "600",
              letterSpacing: -1.1,
              lineHeight: 35,
            }}
          >
            Your day,{"\n"}at a glance.
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Use current location for the Today sky"
            accessibilityHint="Requests foreground location for local weather; saved-location weather or a time-based sky remains available."
            disabled={atmosphere.busy}
            onPress={() => void atmosphere.requestLocation()}
            style={{ minHeight: 44, justifyContent: "center" }}
          >
            <Text style={{ color: atmosphere.sky.secondary, fontSize: 12 }}>
              {atmosphere.label}
              {atmosphere.sky.source === "time" ? " · Use local weather" : ""}
            </Text>
          </Pressable>
        </View>
        <View
          style={{
            flexGrow: 1,
            backgroundColor: t.canvas,
            marginTop: -spacing.xxl,
            borderTopLeftRadius: spacing.xxl,
            borderTopRightRadius: spacing.xxl,
            paddingHorizontal: spacing.page,
            paddingTop: spacing.xl,
            paddingBottom: spacing.xl,
            gap: spacing.xl,
          }}
        >
          <View style={{ gap: spacing.sm }}>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
              {chips.map((chip) => (
                <Pressable
                  key={chip.label}
                  accessibilityRole="button"
                  onPress={() => router.push(chip.href)}
                  style={{
                    minHeight: 44,
                    justifyContent: "center",
                    paddingHorizontal: spacing.md,
                    backgroundColor: t.surface,
                    borderRadius: radius.control,
                  }}
                >
                  <Text
                    style={{
                      color: chip.tone === "incorrect" ? t.destructive : t.ink,
                      fontSize: 13,
                    }}
                  >
                    {chip.label}
                  </Text>
                </Pressable>
              ))}
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Refresh Today"
              disabled={data.refreshing}
              onPress={() => void data.refresh()}
              style={{ minHeight: 44, flexDirection: "row", alignItems: "center", gap: spacing.sm }}
            >
              <Icon name="clock" color={data.failed ? t.warning : t.secondary} size={16} />
              <Text style={{ color: t.secondary, fontSize: 12, flex: 1 }}>
                {data.failed
                  ? "Some data unavailable · showing available results"
                  : data.loading
                    ? "Loading Tasks and Finances…"
                    : data.refreshing
                      ? "Refreshing…"
                      : `Updated ${new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour: "numeric", minute: "2-digit" }).format(data.updatedAt)} · Tasks & Finances`}
              </Text>
              <Text style={{ color: t.secondary, fontSize: 12 }}>Refresh</Text>
            </Pressable>
          </View>
          <BriefSection
            title="Needs you"
            caption={attentionUnavailable ? "Partial" : undefined}
            rows={attention.slice(0, 3)}
            empty={
              attentionUnavailable
                ? "Attention items unavailable. Tap Refresh to try again."
                : attentionLoading
                  ? "Loading priorities…"
                  : "Nothing needs your attention right now."
            }
          />
          <BriefSection
            title="Coming up"
            caption={upcomingUnavailable ? "Next 7 days · Partial" : "Next 7 days"}
            rows={upcoming}
            empty={
              upcomingUnavailable
                ? "Some upcoming items are unavailable."
                : data.nextTasks.isPending || data.upcoming.isPending
                  ? "Loading what’s next…"
                  : "No upcoming tasks or expected payments in the next 7 days."
            }
          />
          <BriefSection
            title="Handled for you"
            caption="Finance · today"
            rows={handled}
            empty={
              data.activity.isError
                ? "Activity is unavailable."
                : data.activity.isPending
                  ? "Loading confirmed activity…"
                  : data.activity.data?.nextCursor
                    ? "No confirmed actions in recent activity. Open Finance activity for more."
                    : "No confirmed agent actions today."
            }
          />
          <View style={{ height: spacing.md }} />
        </View>
      </View>
    </Screen>
  );
}
