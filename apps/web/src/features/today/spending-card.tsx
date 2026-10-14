import { localDateAt, localDateToIso, todayWeekRange } from "@personal-os/domain";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "@/api";
import { useQueryFeedback } from "@/components/async-state";
import { SegmentedControl, SegmentedControlItem } from "@/components/segmented-control";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useWorkspacePreferences } from "@/features/workspace-settings/preferences";
import { useSaveTodayPreferences } from "./preferences";
export function TodaySpendingCard({
  now,
  timeZone,
  window: period,
}: {
  now: Date;
  timeZone: string;
  window: "week" | "month";
}) {
  const save = useSaveTodayPreferences();
  const finance = useWorkspacePreferences("finances");
  const calendar = useWorkspacePreferences("calendar");
  const day = localDateAt(now, timeZone);
  const through = localDateToIso(day);
  const from =
    period === "month"
      ? localDateToIso({ ...day, day: 1 })
      : todayWeekRange(now, timeZone, calendar.data?.preferences.weekStartsOn ?? "sunday")
          .weekStart;
  const accountIds = finance.data?.preferences.spendAccountIds;
  const query = useQuery({
    queryKey: ["today-spending", from, through, accountIds],
    enabled: !!finance.data && !!calendar.data,
    queryFn: () =>
      api.getFinancePosition({
        from,
        through,
        ...(accountIds === null ? {} : { accountIds: accountIds ?? [] }),
      }),
    refetchInterval: 60000,
  });
  useQueryFeedback({ query, title: "Couldn’t refresh spending." });
  useQueryFeedback({ query: finance, title: "Couldn’t load spending preferences." });
  useQueryFeedback({ query: calendar, title: "Couldn’t load calendar preferences." });
  const fact = query.data?.postedSpend;
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Spending</h2>
        </CardTitle>
        <CardDescription>
          Posted spending · {period === "week" ? "This week" : "This month"}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <SegmentedControl
          aria-label="Spending period"
          value={period}
          onValueChange={(value) => {
            if (value === "week" || value === "month") save.mutate({ spendingWindow: value });
          }}
        >
          <SegmentedControlItem value="week" disabled={!!save.recovery}>
            This week
          </SegmentedControlItem>
          <SegmentedControlItem value="month" disabled={!!save.recovery}>
            This month
          </SegmentedControlItem>
        </SegmentedControl>
        {save.recovery ? (
          <Link to="/settings?section=today">Review unsaved preferences</Link>
        ) : null}
        <div className="text-2xl">
          {fact && fact.cents !== null && fact.quality !== "unavailable" ? (
            new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
              Number(fact.cents) / 100,
            )
          ) : query.isPending && !finance.isError && !calendar.isError ? (
            <Skeleton className="h-8 w-28" aria-label="Loading spending" />
          ) : (
            "Unavailable"
          )}
        </div>
        <p className="text-sm text-muted-foreground">
          {accountIds?.length === 0
            ? "No accounts selected."
            : fact?.quality === "qualified"
              ? "Partial evidence · posted spending through today"
              : "Posted spending through today"}
        </p>
      </CardContent>
      <CardFooter>
        <Link to="/finances">Open Finance</Link>
      </CardFooter>
    </Card>
  );
}
