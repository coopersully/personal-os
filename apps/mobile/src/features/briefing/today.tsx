import {
  type AttentionItem,
  type CalendarEvent,
  localDateAt,
  localDateTimeToUtc,
  localDateToIso,
  type MailThreadSummary,
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
import { eventOccursOnDay, eventTimeLabel } from "../calendar/logic";
import { budgetPace, categoryIcon } from "../finances/category-presentation";
import {
  expectedAmount,
  financeLabel,
  formatLocalDate,
  formatMoney,
} from "../finances/presentation";
import { MailReader } from "../mail/reader";
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
  workspace: "tasks" | "finances" | "calendar" | "mail";
  href: Href;
  /** Replaces navigation for rows whose detail is not a route, such as a conversation. */
  onPress?: () => void;
  at?: string;
};
const clip = (text: string) => (text.length > 140 ? `${text.slice(0, 137).trimEnd()}…` : text);
const importanceRank = { critical: 0, high: 1, normal: 2, low: 3 } as const;
/** Open Mail attention that is still current, most important first, newest first within a level. */
function mailAttention(items: AttentionItem[], now: Date) {
  return items
    .filter(
      (item) =>
        item.status === "open" &&
        item.kind !== "run_summary" &&
        (!item.expiresAt || Date.parse(item.expiresAt) > now.getTime()),
    )
    .sort(
      (a, b) =>
        importanceRank[a.importance] - importanceRank[b.importance] ||
        b.updatedAt.localeCompare(a.updatedAt),
    );
}
/** What is left of today: events still running or ahead by start time, then all-day events. */
function remainingEvents(events: CalendarEvent[], timezone: string, now: Date) {
  const today = localDateAt(now, timezone);
  return events
    .filter(
      (event) =>
        event.status !== "cancelled" &&
        eventOccursOnDay(event, today, timezone) &&
        (event.allDay || Date.parse(event.endsAt) > now.getTime()),
    )
    .sort(
      (a, b) =>
        Number(a.allDay) - Number(b.allDay) ||
        Date.parse(a.startsAt) - Date.parse(b.startsAt) ||
        a.title.localeCompare(b.title),
    );
}
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
              onPress={row.onPress ?? (() => router.push(row.href))}
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
  const [conversation, setConversation] = useState<MailThreadSummary | null>(null);
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
        subtitle: clip(entry.explanation),
        icon: "check",
        workspace: "finances",
        href: transaction
          ? { pathname: "/finance-transaction", params: { id: transaction.id } }
          : { pathname: "/finances/assistant", params: { view: "Activity" } },
      };
    });
  const today = localDateAt(now, timezone);
  const events = remainingEvents(data.events.data ?? [], timezone, now);
  const calendars = data.calendars.data;
  const noCalendars = calendars?.length === 0;
  const calendarsHidden = !!calendars?.length && !calendars.some((calendar) => calendar.isSelected);
  const schedule: Row[] = noCalendars
    ? [
        {
          id: "calendar-setup",
          title: "Add a calendar",
          subtitle: "Connect or create a calendar in Settings to see today’s events here.",
          icon: "calendar",
          workspace: "calendar",
          href: "/settings",
        },
      ]
    : calendarsHidden
      ? [
          {
            id: "calendar-hidden",
            title: "Every calendar is hidden",
            subtitle: "Choose calendars in Calendar to see their events here.",
            icon: "calendar",
            workspace: "calendar",
            href: "/calendar",
          },
        ]
      : events.slice(0, 3).map((event): Row => {
          const ongoing = !event.allDay && Date.parse(event.startsAt) <= now.getTime();
          return {
            id: `event:${event.id}`,
            title: event.title || "Untitled event",
            subtitle: [
              eventTimeLabel(event, today, timezone),
              event.status === "tentative" ? "Tentative" : null,
              event.location,
            ]
              .filter(Boolean)
              .join(" · "),
            value: ongoing ? "Now" : undefined,
            icon: "calendar",
            workspace: "calendar",
            href: { pathname: "/calendar-event", params: { id: event.id } },
          };
        });
  const mailItems = mailAttention(data.mail.data ?? [], now);
  const noMailAccounts = data.mailAccounts.data?.length === 0;
  const mail: Row[] =
    noMailAccounts && !mailItems.length
      ? [
          {
            id: "mail-setup",
            title: "Connect a mail account",
            subtitle: "Mail that needs you appears here once an account is connected in Settings.",
            icon: "mail",
            workspace: "mail",
            href: "/settings",
          },
        ]
      : mailItems.slice(0, 3).map((item): Row => {
          const threadId = item.relatedEntityType === "mail_thread" ? item.relatedEntityId : null;
          return {
            id: `mail:${item.id}`,
            title: item.title,
            subtitle: clip(item.summary),
            value:
              item.importance === "critical"
                ? "Critical"
                : item.importance === "high"
                  ? "High"
                  : undefined,
            tone: item.importance === "critical" ? "incorrect" : "attention",
            icon: "mail",
            workspace: "mail",
            href: "/mail",
            onPress: threadId
              ? () =>
                  void data.readMailThread(threadId).then((thread) => {
                    if (thread) setConversation(thread);
                  })
              : undefined,
          };
        });
  const unread = (data.mailAccounts.data ?? [])
    .flatMap((account) => account.mailboxes)
    .filter((mailbox) => mailbox.role === "inbox")
    .reduce((total, mailbox) => total + mailbox.unreadCount, 0);
  const coverage = ["Tasks", noCalendars ? null : "Calendar", noMailAccounts ? null : "Mail"]
    .filter(Boolean)
    .join(", ");
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
      label: data.events.data
        ? `${events.length} ${events.length === 1 ? "event" : "events"} left${data.events.isError ? " · cached" : ""}`
        : data.events.isPending
          ? "Loading events…"
          : "Events unavailable",
      href: "/calendar",
    },
    ...(unread ? [{ label: `${unread} unread`, href: "/mail" as const }] : []),
    {
      label: data.upcoming.data?.unavailableSources.length
        ? "Payments incomplete"
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
      bounces={false}
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
            paddingTop: headerInset + spacing.xl,
            paddingBottom: spacing.xxl * 2,
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
              fontSize: 34,
              fontWeight: "600",
              letterSpacing: -1.1,
              lineHeight: 39,
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
                    ? "Loading your day…"
                    : data.refreshing
                      ? "Refreshing…"
                      : `Updated ${new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour: "numeric", minute: "2-digit" }).format(data.updatedAt)} · ${coverage} & Finances`}
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
            title="Today’s events"
            caption={
              data.events.isError
                ? "Partial"
                : events.length > 3 && schedule.length === 3
                  ? `3 of ${events.length}`
                  : undefined
            }
            rows={data.events.data || noCalendars ? schedule : []}
            empty={
              data.events.isError
                ? "Calendar is unavailable. Tap Refresh to try again."
                : data.events.isPending
                  ? "Loading today’s events…"
                  : data.events.data?.some((event) => event.status !== "cancelled")
                    ? "Nothing else scheduled today."
                    : "Nothing scheduled today."
            }
          />
          <BriefSection
            title="Mail"
            caption={
              data.mail.isError
                ? "Needs you · Partial"
                : mailItems.length > 3
                  ? `Needs you · 3 of ${mailItems.length}`
                  : "Needs you"
            }
            rows={data.mail.data ? mail : []}
            empty={
              data.mail.isError
                ? "Mail is unavailable. Tap Refresh to try again."
                : data.mail.isPending
                  ? "Loading mail that needs you…"
                  : "No mail needs you right now."
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
      {conversation && <MailReader thread={conversation} close={() => setConversation(null)} />}
    </Screen>
  );
}
