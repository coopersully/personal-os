// @vitest-environment jsdom
import { ApiClientError } from "@personal-os/api-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { PropsWithChildren, ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import FinanceLayout from "../../app/(workspaces)/finances/_layout";
import { FinanceAssistantScreen } from "./assistant";
import { Conversation } from "./conversation";
import { FinanceSpendingScreen } from "./spending";
import {
  binLabel,
  customRangeProblem,
  rhythmGrain,
  spendingBinStatus,
  spendingComparisonScopes,
  spendingHourlyBins,
  spendingRange,
  spendingRhythmBins,
  spendingToday,
  spendingTrendBins,
  weekdayOffset,
} from "./spending-math";

vi.mock("expo-crypto", () => ({ randomUUID: () => crypto.randomUUID() }));
vi.mock("react", async () => {
  const { createRequire } = await import("node:module");
  return createRequire(`${process.cwd()}/package.json`)("react");
});
vi.mock("@tanstack/react-query", async () => {
  const { createRequire } = await import("node:module");
  return createRequire(`${process.cwd()}/apps/web/package.json`)("@tanstack/react-query");
});
const h = vi.hoisted(() => ({
  owner: "owner-a",
  timezone: "America/New_York" as string | undefined,
  params: {} as Record<string, string>,
  push: vi.fn(),
  navigate: vi.fn(),
  replace: vi.fn(),
  setParams: vi.fn(),
  back: vi.fn(),
  alert: vi.fn(),
  platform: "ios",
  screen: vi.fn(),
  error: vi.fn(),
  success: vi.fn(),
  dismiss: vi.fn(),
  info: vi.fn(),
  loading: vi.fn(() => "feedback"),
  focused: true,
  tabs: vi.fn(),
  api: {
    getWorkspaceSettings: vi.fn(),
    getFinanceSpending: vi.fn(),
    listFinanceSpendingTransactions: vi.fn(),
    listFinanceTransactions: vi.fn(),
    getFinanceCategories: vi.fn(),
    listFinanceActivity: vi.fn(),
    getFinanceActivityEvidence: vi.fn(),
    getFinanceConversationUnread: vi.fn(),
    getFinanceConversationHistory: vi.fn(),
    markFinanceConversationRendered: vi.fn(),
  },
}));
vi.mock("react-native", () => {
  const Box = ({
    children,
    testID,
    accessibilityLabel,
  }: PropsWithChildren<{ testID?: string; accessibilityLabel?: string }>) => (
    <div data-testid={testID} title={accessibilityLabel}>
      {children}
    </div>
  );
  return {
    StyleSheet: { create: (value: unknown) => value, hairlineWidth: 1 },
    AppState: { currentState: "active", addEventListener: () => ({ remove: vi.fn() }) },
    Keyboard: { addListener: () => ({ remove: vi.fn() }) },
    useWindowDimensions: () => ({ height: 852, width: 393 }),
    Image: () => null,
    View: Box,
    ScrollView: Box,
    Text: Box,
    Modal: ({ children, visible }: PropsWithChildren<{ visible?: boolean }>) =>
      visible ? <div role="dialog">{children}</div> : null,
    ActivityIndicator: ({ accessibilityLabel }: { accessibilityLabel?: string }) => (
      <span role="progressbar" aria-label={accessibilityLabel} />
    ),
    Alert: { alert: h.alert },
    Platform: {
      get OS() {
        return h.platform;
      },
    },
    useColorScheme: () => "light",
    Switch: ({
      accessibilityLabel,
      value,
      onValueChange,
      disabled,
    }: {
      accessibilityLabel?: string;
      value: boolean;
      onValueChange: (value: boolean) => void;
      disabled?: boolean;
    }) => (
      <input
        type="checkbox"
        aria-label={accessibilityLabel}
        checked={value}
        disabled={disabled}
        onChange={(event) => onValueChange(event.target.checked)}
      />
    ),
    Pressable: ({
      children,
      onPress,
      disabled,
      accessibilityLabel,
      accessibilityState,
    }: PropsWithChildren<{
      onPress?: () => void;
      disabled?: boolean;
      accessibilityLabel?: string;
      accessibilityState?: { selected?: boolean; checked?: boolean };
    }>) => (
      <button
        type="button"
        aria-label={accessibilityLabel}
        aria-pressed={accessibilityState?.selected ?? accessibilityState?.checked}
        disabled={disabled}
        onClick={onPress}
      >
        {typeof children === "function" ? null : children}
      </button>
    ),
    TextInput: ({
      accessibilityLabel,
      value,
      onChangeText,
      editable = true,
    }: {
      accessibilityLabel?: string;
      value: string;
      onChangeText: (value: string) => void;
      editable?: boolean;
    }) => (
      <input
        aria-label={accessibilityLabel}
        disabled={!editable}
        value={value}
        onChange={(event) => onChangeText(event.target.value)}
      />
    ),
  };
});
vi.mock("../../components/screen", () => ({
  Screen: ({ children }: PropsWithChildren) => <main>{children}</main>,
}));
vi.mock("../../components/icons", () => ({
  Icon: ({ name }: { name: string }) => <span data-icon={name} />,
}));
vi.mock("../../components/glass-surface", () => ({
  GlassSurface: ({ children }: PropsWithChildren) => <div>{children}</div>,
}));
vi.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ bottom: 0 }) }));
vi.mock("../auth/context", () => ({
  useOptionalAuth: () => null,
  useAuth: () => ({
    state: { user: { id: h.owner, planningTimezone: h.timezone } },
    session: { api: () => h.api, epoch: () => h.owner },
  }),
}));
vi.mock("sonner-native", () => ({ toast: h }));
vi.mock("expo-router", async () => {
  const { useEffect } = await import("react");
  return {
    router: h,
    useLocalSearchParams: () => h.params,
    // A focused screen runs its focus effect; an unfocused one never does.
    useFocusEffect: (effect: () => undefined | (() => void)) =>
      useEffect(() => (h.focused ? effect() : undefined), [effect]),
    Stack: {
      Screen: ({
        options,
      }: {
        options: { title?: string; headerLeft?: () => ReactNode; headerRight?: () => ReactNode };
      }) => {
        h.screen(options);
        return (
          <>
            {options.headerLeft?.() ?? null}
            {options.headerRight?.() ?? null}
          </>
        );
      },
    },
  };
});
vi.mock("../../components/workspace-tabs", () => ({
  WorkspaceTabs: (props: Record<string, unknown>) => {
    h.tabs(props);
    return null;
  },
}));
vi.mock("./conversation-composer", () => ({ ConversationComposer: () => null }));
vi.mock("./review-approvals", () => ({ ActionReviews: () => null }));
vi.mock("./reviews", () => ({ ReviewDestinations: () => null }));

const REVISION = "a".repeat(64);
const TZ = "America/New_York";
// Wednesday 18 November 2026, mid-morning in New York.
const NOW = new Date("2026-11-18T15:00:00Z");

type Day = {
  date: string;
  cents?: number;
  pending?: number;
  coverage?: "complete" | "partial" | "unknown";
  provisional?: boolean;
  future?: boolean;
};
const scopeOf = (from: string, through: string) => ({
  from,
  through,
  timezone: TZ,
  accountIds: null,
  categoryIds: null,
  basis: "personal_cost" as const,
  includePending: true,
  subtractRefunds: true,
});
function dashboard(
  from: string,
  through: string,
  days: Day[],
  extra: Record<string, unknown> = {},
) {
  const scope = scopeOf(from, through);
  const bins = days.map((day) => ({
    date: day.date,
    netCents: day.cents ?? 0,
    positiveAreaCents: Math.max(0, day.cents ?? 0),
    negativeAdjustmentCents: Math.max(0, -(day.cents ?? 0)),
    pendingCents: day.pending ?? 0,
    coverage: day.coverage ?? "complete",
    provisional: day.provisional ?? false,
    future: day.future ?? false,
    drillDown: {
      scope: { ...scope, from: day.date, through: day.date },
      contributionIds: day.cents ? [`c-${day.date}`] : [],
      transactionIds: day.cents ? [`t-${day.date}`] : [],
    },
  }));
  return {
    schemaVersion: 1,
    referenceRevision: REVISION,
    snapshot: {
      schemaVersion: 1,
      scope,
      asOf: NOW.toISOString(),
      coverage: "complete",
      contributions: [],
      bins,
      netCents: bins.reduce((sum, bin) => sum + bin.netCents, 0),
      positiveAreaCents: 0,
      negativeAdjustmentCents: 0,
      qualifications: [],
      budgetComparison: { status: "unavailable", reason: "historical_budget_not_resolved" },
    },
    effectiveGrouping: "categories",
    groupingFallback: null,
    groups: [{ id: "groceries", label: "Groceries", kind: "category", netCents: 4200 }],
    positiveAreaCents: 0,
    negativeAdjustmentCents: 0,
    excludedUncategorizedCents: 0,
    accounts: [],
    categories: [],
    transactions: [],
    source: { freshness: "current", lastSyncedAt: null, reasons: [] },
    currency: { supported: "USD", unsupported: [] },
    ...extra,
    // biome-ignore lint/suspicious/noExplicitAny: fixtures stand in for parsed API records.
  } as any;
}
const days = (from: string, count: number, cents: (index: number) => number, today = "9999") =>
  Array.from({ length: count }, (_, index) => {
    const date = new Date(Date.parse(`${from}T12:00:00Z`) + index * 86_400_000)
      .toISOString()
      .slice(0, 10);
    return { date, cents: date > today ? 0 : cents(index), future: date > today };
  });
const week = () =>
  dashboard(
    "2026-11-15",
    "2026-11-21",
    days("2026-11-15", 7, (i) => (i + 1) * 100, "2026-11-18"),
  );

function settings(finances: Record<string, unknown> = {}, weekStartsOn = "sunday") {
  h.api.getWorkspaceSettings.mockImplementation(async (workspace: string) => ({
    workspace,
    revision: 1,
    preferences: workspace === "calendar" ? { weekStartsOn } : finances,
  }));
}
function mount(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const view = render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
  return { ...view, client };
}
const press = (name: string | RegExp) => fireEvent.click(screen.getByRole("button", { name }));
const open = async (name: string | RegExp) =>
  fireEvent.click(await screen.findByRole("button", { name }));
/** The detail row under a grid, which repeats the chosen block's label. */
const pressLast = (name: RegExp) =>
  fireEvent.click(screen.getAllByRole("button", { name }).at(-1) as HTMLElement);
const requested = () => h.api.getFinanceSpending.mock.calls.map(([query]) => query);
const lastScope = () => requested().at(-1).scope;
/** Action results are Sonner's; none is written into the page. */
function expectNoInlineResult() {
  for (const copy of [/loaded$/i, /could not load/i, /couldn.t load/i, /try again/i])
    expect(screen.queryByText(copy)).toBeNull();
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  h.owner = "owner-a";
  h.timezone = TZ;
  h.params = {};
  h.focused = true;
  settings();
  h.api.getFinanceSpending.mockImplementation(
    async (query: { scope: { from: string; through: string } }) =>
      dashboard(query.scope.from, query.scope.through, []),
  );
  h.api.listFinanceSpendingTransactions.mockResolvedValue({
    items: [],
    nextCursor: null,
    netCents: 4200,
  });
  h.api.getFinanceConversationUnread.mockResolvedValue({
    unreadCount: "0",
    readThroughSequence: "0",
    latestAgentSequence: "0",
  });
  h.api.getFinanceConversationHistory.mockResolvedValue({ messages: [], nextCursor: null });
  h.api.markFinanceConversationRendered.mockResolvedValue({ readThroughSequence: "0" });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

// Period and bin arithmetic

it("resolves each period in the account timezone and from the chosen week start", () => {
  // Late evening in New York is already tomorrow in UTC.
  expect(spendingToday(TZ, new Date("2026-11-19T03:30:00Z"))).toBe("2026-11-18");
  const today = "2026-11-18";
  expect(spendingRange("today", today, "sunday")).toEqual({ from: today, through: today });
  expect(spendingRange("week", today, "sunday")).toEqual({
    from: "2026-11-15",
    through: "2026-11-21",
  });
  expect(spendingRange("week", today, "monday")).toEqual({
    from: "2026-11-16",
    through: "2026-11-22",
  });
  expect(spendingRange("week", "2026-11-15", "monday").from).toBe("2026-11-09");
  expect(spendingRange("month", today, "sunday")).toEqual({
    from: "2026-11-01",
    through: "2026-11-30",
  });
  expect(spendingRange("month", "2028-02-10", "sunday").through).toBe("2028-02-29");
  expect(
    spendingRange("custom", today, "sunday", { from: "2026-10-01", through: "2026-10-09" }),
  ).toEqual({ from: "2026-10-01", through: "2026-10-09" });
  expect(spendingRange("custom", today, "sunday")).toEqual({ from: today, through: today });
});

it("accepts only a custom range the API can read", () => {
  expect(customRangeProblem("2026-11-01", "2026-11-18")).toBeNull();
  expect(customRangeProblem("2026-11-01", "")).toMatch(/start and an end/);
  expect(customRangeProblem("2026-02-30", "2026-03-01")).toMatch(/start and an end/);
  expect(customRangeProblem("2026-11-19", "2026-11-18")).toMatch(/on or before/);
  expect(customRangeProblem("2010-01-01", "2026-11-18")).toMatch(/ten years or less/);
});

it("compares the period so far with the equal span before it", () => {
  const today = "2026-11-18";
  const day = spendingComparisonScopes(scopeOf(today, today), "today", today);
  expect([day.previous.from, day.previous.through, day.label]).toEqual([
    "2026-11-17",
    "2026-11-17",
    "Previous day",
  ]);
  const partWeek = spendingComparisonScopes(scopeOf("2026-11-15", "2026-11-21"), "week", today);
  expect(partWeek.current.through).toBe(today);
  expect([partWeek.previous.from, partWeek.previous.through, partWeek.label]).toEqual([
    "2026-11-08",
    "2026-11-11",
    "Previous week · equal elapsed days",
  ]);
  const fullWeek = spendingComparisonScopes(scopeOf("2026-11-01", "2026-11-07"), "week", today);
  expect([fullWeek.previous.from, fullWeek.previous.through, fullWeek.label]).toEqual([
    "2026-10-25",
    "2026-10-31",
    "Previous week",
  ]);
  const partMonth = spendingComparisonScopes(scopeOf("2026-11-01", "2026-11-30"), "month", today);
  expect([partMonth.previous.from, partMonth.previous.through, partMonth.label]).toEqual([
    "2026-10-01",
    "2026-10-18",
    "Previous month · equal elapsed days",
  ]);
  const fullMonth = spendingComparisonScopes(scopeOf("2026-10-01", "2026-10-31"), "month", today);
  expect([fullMonth.previous.from, fullMonth.previous.through, fullMonth.label]).toEqual([
    "2026-09-01",
    "2026-09-30",
    "Previous month",
  ]);
  // The thirtieth of March has no counterpart in February.
  const capped = spendingComparisonScopes(
    scopeOf("2026-03-01", "2026-03-31"),
    "month",
    "2026-03-30",
  );
  expect([capped.previous.through, capped.label]).toEqual([
    "2026-02-28",
    "Previous month · equal elapsed days · capped at month end",
  ]);
  const custom = spendingComparisonScopes(scopeOf("2026-11-10", "2026-11-25"), "custom", today);
  expect(custom.current.through).toBe("2026-11-25");
  expect([custom.previous.from, custom.previous.through, custom.label]).toEqual([
    "2026-10-25",
    "2026-11-09",
    "Previous equal-length period",
  ]);
});

it("groups trend bins by day, by week from the range start, then by month", () => {
  const daily = spendingTrendBins(week());
  expect(daily.grain).toBe("Daily");
  expect(daily.bins).toHaveLength(7);
  const weekly = spendingTrendBins(
    dashboard(
      "2026-09-01",
      "2026-10-10",
      days("2026-09-01", 40, () => 100),
    ),
  );
  expect(weekly.grain).toBe("Weekly");
  expect(weekly.bins.map((bin) => [bin.date, bin.through, bin.netCents, bin.partial])).toEqual([
    ["2026-09-01", "2026-09-07", 700, false],
    ["2026-09-08", "2026-09-14", 700, false],
    ["2026-09-15", "2026-09-21", 700, false],
    ["2026-09-22", "2026-09-28", 700, false],
    ["2026-09-29", "2026-10-05", 700, false],
    ["2026-10-06", "2026-10-10", 500, true],
  ]);
  expect(weekly.bins[0]?.drillDown.transactionIds).toHaveLength(7);
  const monthly = spendingTrendBins(
    dashboard(
      "2026-01-15",
      "2026-08-31",
      days("2026-01-15", 229, () => 100),
    ),
  );
  expect(monthly.grain).toBe("Monthly");
  expect(monthly.bins.map((bin) => [bin.date, bin.through, bin.partial]).slice(0, 2)).toEqual([
    ["2026-01-15", "2026-01-31", true],
    ["2026-02-01", "2026-02-28", false],
  ]);
});

it("groups rhythm bins by calendar unit and states what each bin's amount rests on", () => {
  expect(
    ["2026-11-18", "2026-12-31", "2027-11-17", "2029-11-17", "2030-01-01"].map((through) =>
      rhythmGrain("2026-11-18", through),
    ),
  ).toEqual(["Hourly", "Daily", "Weekly", "Monthly", "Yearly"]);
  const quarter = dashboard(
    "2026-08-05",
    "2026-10-31",
    days("2026-08-05", 88, () => 100),
  );
  const sunday = spendingRhythmBins(quarter, "sunday");
  expect(sunday.grain).toBe("Weekly");
  expect(sunday.bins.slice(0, 2).map((bin) => [bin.date, bin.through, bin.partial])).toEqual([
    ["2026-08-05", "2026-08-08", true],
    ["2026-08-09", "2026-08-15", false],
  ]);
  expect(spendingRhythmBins(quarter, "monday").bins[1]?.date).toBe("2026-08-10");
  const years = spendingRhythmBins(
    dashboard("2024-06-01", "2027-06-30", [
      { date: "2024-06-01", cents: 100 },
      { date: "2025-03-01", cents: 200 },
    ]),
    "sunday",
  );
  expect(years.grain).toBe("Yearly");
  expect(years.bins.map((bin) => [bin.date, bin.through, bin.coverage])).toEqual([
    ["2024-06-01", "2024-12-31", "partial"],
    ["2025-01-01", "2025-12-31", "partial"],
  ]);
  const months = spendingRhythmBins(
    dashboard("2025-01-01", "2026-12-31", [{ date: "2025-02-10", cents: -300 }]),
    "sunday",
  );
  expect(months.grain).toBe("Monthly");
  expect([months.bins[0]?.date, months.bins[0]?.through]).toEqual(["2025-02-01", "2025-02-28"]);
  const [bin] = spendingTrendBins(
    dashboard("2026-11-18", "2026-11-19", [
      { date: "2026-11-18", cents: 500, pending: 200, provisional: true },
      { date: "2026-11-19", future: true },
    ]),
  ).bins;
  if (!bin) throw new Error("Expected a bin");
  expect(spendingBinStatus(bin)).toBe("Spending · Provisional · Pending $2.00");
  const status = (day: Omit<Day, "date">) => {
    const [only] = spendingTrendBins(
      dashboard("2026-11-18", "2026-11-18", [{ date: "2026-11-18", ...day }]),
    ).bins;
    if (!only) throw new Error("Expected a bin");
    return spendingBinStatus(only);
  };
  expect(status({ future: true })).toBe("Future");
  expect(status({ coverage: "unknown" })).toBe("Missing coverage");
  expect(status({ coverage: "partial", cents: 100 })).toBe("Partial coverage");
  expect(status({})).toBe("No spending");
  expect(status({ cents: -100 })).toBe("Net refund");
  expect(binLabel({ date: "2026-11-18", through: "2026-11-18" })).toBe("Nov 18");
  expect(binLabel({ date: "2026-11-15", through: "2026-11-21" })).toBe("Nov 15 – Nov 21");
  expect(binLabel({ date: "2026-12-27", through: "2027-01-02" })).toBe(
    "Dec 27, 2026 – Jan 2, 2027",
  );
  expect([weekdayOffset("2026-11-18", "sunday"), weekdayOffset("2026-11-15", "monday")]).toEqual([
    3, 6,
  ]);
});

it("assigns an hour only from a source timestamp on the recorded local day", () => {
  const base = dashboard("2026-11-18", "2026-11-18", []);
  const result = spendingHourlyBins({
    ...base,
    transactions: [
      { id: "timed", date: "2026-11-18T14:30:00Z" },
      { id: "dated", date: "2026-11-18" },
      // Early in UTC is still the evening before in New York: the hour is not this day's.
      { id: "shifted", date: "2026-11-18T03:30:00Z" },
      { id: "broken", date: "2026-11-18T99:00:00Z" },
    ],
    snapshot: {
      ...base.snapshot,
      contributions: ["timed", "dated", "shifted", "broken", "missing"].map((id, index) => ({
        id,
        transactionId: id,
        date: "2026-11-18",
        netCents: (index + 1) * 100,
      })),
    },
  });
  expect(result.hours[9]).toEqual({ hour: 9, netCents: 100, count: 1 });
  expect(result.hours.filter((hour) => hour.count)).toHaveLength(1);
  expect([result.untimedCents, result.untimedCount]).toEqual([1400, 4]);
});

// Saved preferences and periods

it("reads spending on the saved basis, pending, refund and uncategorized choices", async () => {
  settings(
    {
      financeSpendingBasis: "full_outflow",
      financeSpendingIncludePending: false,
      financeSpendingSubtractRefunds: false,
      financeSpendingIncludeUncategorized: false,
      financeSpendingPeriod: "month",
    },
    "monday",
  );
  h.api.getFinanceSpending.mockResolvedValue(
    dashboard("2026-11-01", "2026-11-30", [], { excludedUncategorizedCents: 1250 }),
  );
  mount(<FinanceSpendingScreen />);
  await screen.findByText(
    "Full outflow · pending left out · refunds not subtracted · uncategorized left out",
  );
  expect(requested()).toEqual([
    {
      scope: {
        from: "2026-11-01",
        through: "2026-11-30",
        timezone: TZ,
        accountIds: null,
        categoryIds: null,
        basis: "full_outflow",
        includePending: false,
        subtractRefunds: false,
      },
      grouping: "auto",
      includeUncategorized: false,
    },
  ]);
  expect(screen.getByRole("button", { name: "Month" })).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByText("Uncategorized spending left out: $12.50")).toBeVisible();
});

it.each([
  ["financeSpendingBasis", "full_outflow", "basis", "full_outflow", /^Full outflow · /],
  ["financeSpendingIncludePending", false, "includePending", false, /pending left out/],
  ["financeSpendingSubtractRefunds", false, "subtractRefunds", false, /refunds not subtracted/],
] as const)("applies the saved %s on its own", async (key, saved, field, sent, line) => {
  settings({ [key]: saved });
  mount(<FinanceSpendingScreen />);
  await screen.findByText(line);
  expect(lastScope()).toEqual({ ...scopeOf("2026-11-15", "2026-11-21"), [field]: sent });
  expect(requested().at(-1).includeUncategorized).toBe(true);
});

it("uses the product defaults when nothing was saved, with the week from the saved week start", async () => {
  const first = mount(<FinanceSpendingScreen />);
  await screen.findByText("Your share · pending included · refunds subtracted");
  expect(requested()).toEqual([
    { scope: scopeOf("2026-11-15", "2026-11-21"), grouping: "auto", includeUncategorized: true },
  ]);
  expect(screen.getByRole("button", { name: "Week" })).toHaveAttribute("aria-pressed", "true");
  first.unmount();
  settings({}, "monday");
  mount(<FinanceSpendingScreen />);
  await waitFor(() => expect(lastScope().from).toBe("2026-11-16"));
  expect(lastScope().through).toBe("2026-11-22");
});

it("does not read spending before the saved preferences are known, or after they fail", async () => {
  let release: (value: unknown) => void = () => undefined;
  h.api.getWorkspaceSettings.mockReturnValue(new Promise((resolve) => (release = resolve)));
  const first = mount(<FinanceSpendingScreen />);
  expect(screen.getByRole("progressbar", { name: "Loading finance data" })).toBeVisible();
  expect(h.api.getFinanceSpending).not.toHaveBeenCalled();
  // Adding a transaction never depends on this read.
  expect(screen.getByRole("button", { name: "Add transaction" })).toBeVisible();
  await act(async () => release({ workspace: "finances", revision: 1, preferences: {} }));
  await screen.findByText("Your share · pending included · refunds subtracted");
  first.unmount();
  h.api.getFinanceSpending.mockClear();
  h.api.getWorkspaceSettings.mockRejectedValue(new Error("offline"));
  mount(<FinanceSpendingScreen />);
  await screen.findByRole("button", { name: "Retry loading" });
  expect(h.api.getFinanceSpending).not.toHaveBeenCalled();
  expect(h.error).toHaveBeenCalledWith("Couldn’t load finance data", expect.anything());
  settings({ financeSpendingBasis: "full_outflow" });
  press("Retry loading");
  await screen.findByText(/^Full outflow · /);
  expect(lastScope().basis).toBe("full_outflow");
});

it("keeps the preference read in view in Transactions while a custom range is unusable", async () => {
  h.params = { period: "custom", mode: "Transactions" };
  h.api.listFinanceTransactions.mockResolvedValue({ items: [], nextCursor: null });
  h.api.getFinanceCategories.mockResolvedValue([]);
  h.api.getWorkspaceSettings.mockRejectedValue(new Error("offline"));
  mount(<FinanceSpendingScreen />);
  await screen.findByRole("button", { name: "Retry loading" });
  fireEvent.change(screen.getByLabelText(/^Through/), { target: { value: "" } });
  expect(screen.getByText("Choose a start and an end date.")).toBeVisible();
  // Without the saved preferences there is no range to list, only the read to retry.
  expect(screen.getByRole("button", { name: "Retry loading" })).toBeVisible();
  expect(screen.queryByText(/until these dates are corrected/)).toBeNull();
  expect(h.api.listFinanceTransactions).not.toHaveBeenCalled();
  settings();
  press("Retry loading");
  // Once they load, the last usable range is listed while the fields are corrected.
  await screen.findByText("Showing Nov 18 until these dates are corrected.");
  await screen.findByText("No transactions in this view.");
  expect(h.api.listFinanceTransactions).toHaveBeenLastCalledWith(
    expect.objectContaining({ from: "2026-11-18", to: "2026-11-18" }),
  );
});

it("asks for the account timezone instead of guessing a period", () => {
  h.timezone = undefined;
  mount(<FinanceSpendingScreen />);
  expect(screen.getByText("Set your timezone")).toBeVisible();
  expect(h.api.getFinanceSpending).not.toHaveBeenCalled();
});

it("reads today, this week, this month and a custom range", async () => {
  mount(<FinanceSpendingScreen />);
  await screen.findByText("Nov 15 – Nov 21");
  press("Today");
  await waitFor(() => expect(lastScope()).toEqual(scopeOf("2026-11-18", "2026-11-18")));
  expect(h.setParams).toHaveBeenLastCalledWith({ period: "today" });
  press("Month");
  await waitFor(() => expect(lastScope()).toEqual(scopeOf("2026-11-01", "2026-11-30")));
  press("Week");
  await waitFor(() => expect(lastScope()).toEqual(scopeOf("2026-11-15", "2026-11-21")));
  expect(screen.queryByLabelText(/^From/)).toBeNull();
  press("Custom");
  // A custom range starts as today until both dates are chosen.
  await waitFor(() => expect(lastScope()).toEqual(scopeOf("2026-11-18", "2026-11-18")));
  expect(h.setParams).toHaveBeenLastCalledWith({ period: "custom" });
  fireEvent.change(screen.getByLabelText(/^From/), { target: { value: "2026-10-05" } });
  await waitFor(() => expect(lastScope()).toEqual(scopeOf("2026-10-05", "2026-11-18")));
  fireEvent.change(screen.getByLabelText(/^Through/), { target: { value: "2026-10-20" } });
  await waitFor(() => expect(lastScope()).toEqual(scopeOf("2026-10-05", "2026-10-20")));
  await screen.findByText("Oct 5 – Oct 20");
});

it("holds an unusable custom range beside its fields without reading or guessing", async () => {
  h.params = { period: "custom" };
  mount(<FinanceSpendingScreen />);
  await waitFor(() => expect(h.api.getFinanceSpending).toHaveBeenCalledTimes(1));
  fireEvent.change(screen.getByLabelText(/^Through/), { target: { value: "2026-11-01" } });
  expect(screen.getByText("The start date must be on or before the end date.")).toBeVisible();
  fireEvent.change(screen.getByLabelText(/^From/), { target: { value: "" } });
  expect(screen.getByText("Choose a start and an end date.")).toBeVisible();
  fireEvent.change(screen.getByLabelText(/^From/), { target: { value: "2010-01-01" } });
  expect(screen.getByText("Choose a range of ten years or less.")).toBeVisible();
  // No total is shown for a range that was never read.
  expect(screen.queryByText(/coverage/)).toBeNull();
  expect(h.api.getFinanceSpending).toHaveBeenCalledTimes(1);
  expect(h.error).not.toHaveBeenCalled();
});

it("keeps listing the last usable custom range while the fields hold an unusable one", async () => {
  h.params = { period: "custom", mode: "Transactions" };
  h.api.listFinanceTransactions.mockResolvedValue({ items: [], nextCursor: null });
  h.api.getFinanceCategories.mockResolvedValue([]);
  mount(<FinanceSpendingScreen />);
  await screen.findByText("No transactions in this view.");
  fireEvent.change(screen.getByLabelText(/^From/), { target: { value: "2026-11-02" } });
  await waitFor(() =>
    expect(h.api.listFinanceTransactions).toHaveBeenLastCalledWith(
      expect.objectContaining({ from: "2026-11-02", to: "2026-11-18" }),
    ),
  );
  const reads = h.api.listFinanceTransactions.mock.calls.length;
  for (const [field, value, problem] of [
    [/^Through/, "2026-11-01", "The start date must be on or before the end date."],
    [/^Through/, "", "Choose a start and an end date."],
  ] as const) {
    fireEvent.change(screen.getByLabelText(field), { target: { value } });
    // The correction sits at the fields, with the range the list still shows.
    expect(screen.getByText(problem)).toBeVisible();
    expect(
      screen.getByText("Showing Nov 2 – Nov 18 until these dates are corrected."),
    ).toBeVisible();
    expect(screen.getByText("No transactions in this view.")).toBeVisible();
    expect(screen.getByRole("button", { name: "Select transactions" })).toBeVisible();
  }
  expect(h.api.listFinanceTransactions).toHaveBeenCalledTimes(reads);
  fireEvent.change(screen.getByLabelText(/^Through/), { target: { value: "2026-11-09" } });
  await waitFor(() =>
    expect(h.api.listFinanceTransactions).toHaveBeenLastCalledWith(
      expect.objectContaining({ from: "2026-11-02", to: "2026-11-09" }),
    ),
  );
  expect(screen.queryByText(/until these dates are corrected/)).toBeNull();
  expect(h.error).not.toHaveBeenCalled();
});

it.each([
  ["trends", "Trends"],
  ["rhythm", "Rhythm"],
  ["list", "List"],
  // Bubbles is not built on iPhone.
  ["bubbles", "List"],
] as const)("starts on the saved %s view as %s", async (saved, label) => {
  settings({ financeSpendingView: saved });
  mount(<FinanceSpendingScreen />);
  await screen.findByText(/coverage/);
  expect(screen.getByRole("button", { name: label })).toHaveAttribute("aria-pressed", "true");
  // A view chosen here lasts for the visit.
  const other = label === "Rhythm" ? "List" : "Rhythm";
  press(other);
  expect(screen.getByRole("button", { name: other })).toHaveAttribute("aria-pressed", "true");
});

it("opens on the period a link names and falls back to the saved one for an unknown name", async () => {
  settings({ financeSpendingPeriod: "month" });
  h.params = { period: "today" };
  const first = mount(<FinanceSpendingScreen />);
  await waitFor(() => expect(lastScope()).toEqual(scopeOf("2026-11-18", "2026-11-18")));
  first.unmount();
  h.params = { period: "fortnight" };
  mount(<FinanceSpendingScreen />);
  await waitFor(() => expect(lastScope()).toEqual(scopeOf("2026-11-01", "2026-11-30")));
});

it("lists the transactions of the chosen period on the saved week", async () => {
  h.params = { mode: "Transactions" };
  h.api.listFinanceTransactions.mockResolvedValue({ items: [], nextCursor: null });
  h.api.getFinanceCategories.mockResolvedValue([]);
  mount(<FinanceSpendingScreen />);
  await waitFor(() =>
    expect(h.api.listFinanceTransactions).toHaveBeenCalledWith(
      expect.objectContaining({ from: "2026-11-15", to: "2026-11-21" }),
    ),
  );
  // The view choice belongs to the summary.
  expect(screen.queryByRole("button", { name: "Trends" })).toBeNull();
});

// List, Trends and Rhythm

it("opens a group's transactions from the list with the exact query that produced it", async () => {
  h.api.getFinanceSpending.mockResolvedValue(week());
  mount(<FinanceSpendingScreen />);
  await open(/Groceries/);
  await waitFor(() =>
    expect(h.api.listFinanceSpendingTransactions).toHaveBeenCalledWith(
      {
        query: {
          scope: scopeOf("2026-11-15", "2026-11-21"),
          grouping: "auto",
          includeUncategorized: true,
        },
        referenceRevision: REVISION,
        groupId: "groceries",
        from: "2026-11-15",
        through: "2026-11-21",
      },
      undefined,
    ),
  );
  press("All categories");
  expect(screen.getByRole("button", { name: /Groceries/ })).toBeVisible();
});

it("shows trends for the period so far against the span before it and opens a day's evidence", async () => {
  h.api.getFinanceSpending.mockImplementation(
    async (query: { scope: { from: string; through: string } }) =>
      query.scope.from === "2026-11-15"
        ? dashboard(
            "2026-11-15",
            query.scope.through,
            days("2026-11-15", 4, (i) => (i + 1) * 100),
          )
        : dashboard(
            query.scope.from,
            query.scope.through,
            days(query.scope.from, 4, () => 150),
          ),
  );
  mount(<FinanceSpendingScreen />);
  await screen.findByRole("button", { name: /Groceries/ });
  press("Trends");
  await screen.findByText("Previous week · equal elapsed days: $6.00");
  // Ten dollars so far against six: four more, on complete and current data.
  expect(screen.getByText("$4.00 more this period")).toBeVisible();
  expect(
    requested()
      .slice(-2)
      .map((query) => [query.scope.from, query.scope.through]),
  ).toEqual(
    expect.arrayContaining([
      ["2026-11-15", "2026-11-18"],
      ["2026-11-08", "2026-11-11"],
    ]),
  );
  expect(screen.getByText("Daily spending")).toBeVisible();
  expect(screen.getAllByTestId("trend-bar")).toHaveLength(4);
  expect(screen.getByTitle("Nov 17: $3.00, Spending")).toBeVisible();
  press(/Nov 17/);
  await waitFor(() =>
    expect(h.api.listFinanceSpendingTransactions).toHaveBeenCalledWith(
      expect.objectContaining({
        query: expect.objectContaining({ scope: scopeOf("2026-11-15", "2026-11-18") }),
        groupId: null,
        from: "2026-11-17",
        through: "2026-11-17",
      }),
      undefined,
    ),
  );
  expect(screen.getByText("Nov 17")).toBeVisible();
  press("Back to trends");
  expect(screen.getByText("Daily spending")).toBeVisible();
});

it("qualifies a trend comparison and leaves empty or future days without a drill-down", async () => {
  h.api.getFinanceSpending.mockImplementation(
    async (query: { scope: { from: string; through: string } }) =>
      query.scope.from === "2026-11-15"
        ? dashboard("2026-11-15", query.scope.through, [
            { date: "2026-11-15", cents: 100 },
            { date: "2026-11-16" },
            { date: "2026-11-17", cents: -400 },
            { date: "2026-11-18", future: true },
          ])
        : dashboard(query.scope.from, query.scope.through, [], {
            source: { freshness: "stale", lastSyncedAt: null, reasons: [] },
          }),
  );
  mount(<FinanceSpendingScreen />);
  await screen.findByRole("button", { name: /Groceries/ });
  press("Trends");
  await screen.findByText(
    "$3.00 less this period · some of this data is incomplete or out of date",
  );
  expect(screen.getByRole("button", { name: /Nov 15/ })).toBeVisible();
  // A day with nothing recorded has nothing to open; a day that has not happened is not listed.
  expect(screen.getByText("Nov 16")).toBeVisible();
  expect(screen.queryByRole("button", { name: /Nov 16/ })).toBeNull();
  expect(screen.queryByText("Nov 18")).toBeNull();
  expect(screen.getByText("Net refund")).toBeVisible();
});

it("keeps the trend visible when the comparison period cannot be read, and retries it", async () => {
  let fail = true;
  h.api.getFinanceSpending.mockImplementation(
    async (query: { scope: { from: string; through: string } }) => {
      if (query.scope.from === "2026-11-08" && fail) throw new Error("offline");
      return dashboard(query.scope.from, query.scope.through, [
        { date: query.scope.from, cents: 500 },
      ]);
    },
  );
  mount(<FinanceSpendingScreen />);
  await screen.findByRole("button", { name: /Groceries/ });
  press("Trends");
  await screen.findByRole("button", { name: "Retry loading" });
  expect(screen.getByText("Daily spending")).toBeVisible();
  expect(screen.queryByText(/this period/)).toBeNull();
  expect(h.error).toHaveBeenCalledWith("Couldn’t load finance data", expect.anything());
  fail = false;
  press("Retry loading");
  await screen.findByText("No change");
});

it("says so when no day of a trend period has happened yet", async () => {
  h.params = { period: "custom" };
  mount(<FinanceSpendingScreen />);
  await screen.findByText(/coverage/);
  h.api.getFinanceSpending.mockImplementation(
    async (query: { scope: { from: string; through: string } }) =>
      dashboard(query.scope.from, query.scope.through, [{ date: "2026-12-01", future: true }]),
  );
  fireEvent.change(screen.getByLabelText(/^Through/), { target: { value: "2026-12-01" } });
  fireEvent.change(screen.getByLabelText(/^From/), { target: { value: "2026-12-01" } });
  press("Trends");
  await screen.findByText("No days in this period have happened yet.");
});

it("lays a week's rhythm out under its weekdays and opens the chosen day", async () => {
  settings({}, "monday");
  h.api.getFinanceSpending.mockResolvedValue(
    dashboard(
      "2026-11-16",
      "2026-11-22",
      days("2026-11-16", 7, (i) => (i + 1) * 100, "2026-11-18"),
    ),
  );
  mount(<FinanceSpendingScreen />);
  await screen.findByRole("button", { name: /Groceries/ });
  press("Rhythm");
  expect(screen.getByText("Daily rhythm · a stronger colour is more spending")).toBeVisible();
  expect(screen.getAllByTestId("rhythm-row")).toHaveLength(1);
  expect(screen.getByText("Choose a day to see its spending.")).toBeVisible();
  const day = screen.getByRole("button", { name: "Nov 17: $2.00, Spending" });
  fireEvent.click(day);
  expect(day).toHaveAttribute("aria-pressed", "true");
  pressLast(/Nov 17/);
  await waitFor(() =>
    expect(h.api.listFinanceSpendingTransactions).toHaveBeenCalledWith(
      expect.objectContaining({ groupId: null, from: "2026-11-17", through: "2026-11-17" }),
      undefined,
    ),
  );
  press("Back to rhythm");
  // A day that has not happened can be read but has nothing to open.
  fireEvent.click(screen.getByRole("button", { name: "Nov 20: $0.00, Future" }));
  expect(screen.getByText("Future")).toBeVisible();
  expect(screen.getAllByRole("button", { name: /Nov 20/ })).toHaveLength(1);
});

it("starts a month's rhythm under the right weekday", async () => {
  h.params = { period: "month" };
  h.api.getFinanceSpending.mockResolvedValue(
    dashboard(
      "2026-11-01",
      "2026-11-30",
      days("2026-11-01", 30, () => 100, "2026-11-18"),
    ),
  );
  mount(<FinanceSpendingScreen />);
  await screen.findByRole("button", { name: /Groceries/ });
  press("Rhythm");
  // November 2026 starts on a Sunday: five full rows of seven, no leading blanks.
  const rows = screen.getAllByTestId("rhythm-row");
  expect(rows).toHaveLength(5);
  expect(within(rows[0] as HTMLElement).getAllByRole("button")).toHaveLength(7);
  expect(within(rows[4] as HTMLElement).getAllByRole("button")).toHaveLength(2);
});

it("shows a single day by the hour without claiming an hour selects transactions", async () => {
  h.params = { period: "today" };
  const base = dashboard("2026-11-18", "2026-11-18", [{ date: "2026-11-18", cents: 1000 }]);
  h.api.getFinanceSpending.mockResolvedValue({
    ...base,
    transactions: [
      { id: "timed", date: "2026-11-18T13:30:00Z" },
      { id: "dated", date: "2026-11-18" },
    ],
    snapshot: {
      ...base.snapshot,
      contributions: [
        { id: "c1", transactionId: "timed", date: "2026-11-18", netCents: 900 },
        { id: "c2", transactionId: "dated", date: "2026-11-18", netCents: 100 },
      ],
    },
  });
  mount(<FinanceSpendingScreen />);
  await screen.findByRole("button", { name: /Groceries/ });
  press("Rhythm");
  expect(screen.getByText("Choose an hour to see its spending.")).toBeVisible();
  fireEvent.click(
    screen.getByRole("button", {
      name: "8 AM: $9.00, $9.00 recorded · Incomplete hourly coverage",
    }),
  );
  // The detail row for an hour is text only: an hour never selects transactions.
  expect(screen.getAllByText("$9.00 recorded · Incomplete hourly coverage")).toHaveLength(1);
  expect(screen.getAllByRole("button", { name: /8 AM/ })).toHaveLength(1);
  expect(screen.getByRole("button", { name: "11 AM: $0.00, Future hour" })).toBeVisible();
  expect(
    screen.getByRole("button", { name: "9 AM: $0.00, Hourly amount unavailable" }),
  ).toBeVisible();
  fireEvent.click(
    screen.getByRole("button", {
      name: "Time not provided: $1.00, 1 item · Purchase times not provided",
    }),
  );
  pressLast(/Time not provided/);
  await waitFor(() =>
    expect(h.api.listFinanceSpendingTransactions).toHaveBeenCalledWith(
      expect.objectContaining({ groupId: null, from: "2026-11-18", through: "2026-11-18" }),
      undefined,
    ),
  );
});

it("reads a fully timed, complete day as no spending in its empty hours", async () => {
  h.params = { period: "today" };
  vi.setSystemTime(new Date("2026-11-19T15:00:00Z"));
  h.params = { period: "custom" };
  const base = dashboard("2026-11-18", "2026-11-18", [{ date: "2026-11-18", cents: 900 }]);
  h.api.getFinanceSpending.mockResolvedValue({
    ...base,
    transactions: [{ id: "timed", date: "2026-11-18T13:30:00Z" }],
    snapshot: {
      ...base.snapshot,
      asOf: "2026-11-19T15:00:00Z",
      contributions: [{ id: "c1", transactionId: "timed", date: "2026-11-18", netCents: 900 }],
    },
  });
  mount(<FinanceSpendingScreen />);
  await screen.findByRole("button", { name: /Groceries/ });
  press("Rhythm");
  expect(screen.getByRole("button", { name: "8 AM: $9.00, $9.00 recorded" })).toBeVisible();
  expect(screen.getByRole("button", { name: "11 PM: $0.00, No spending" })).toBeVisible();
  expect(screen.queryByRole("button", { name: /Time not provided/ })).toBeNull();
});

it("lays longer ranges out by week and by year, and says when a period has no spending", async () => {
  h.params = { period: "custom" };
  h.api.getFinanceSpending.mockImplementation(
    async (query: { scope: { from: string; through: string } }) =>
      dashboard(
        query.scope.from,
        query.scope.through,
        query.scope.from === "2026-08-05"
          ? days("2026-08-05", 88, () => 100)
          : [{ date: query.scope.from, cents: 100 }],
        { groups: [] },
      ),
  );
  mount(<FinanceSpendingScreen />);
  await screen.findByText("No spending in this period.");
  fireEvent.change(screen.getByLabelText(/^Through/), { target: { value: "2026-10-31" } });
  fireEvent.change(screen.getByLabelText(/^From/), { target: { value: "2026-08-05" } });
  press("Rhythm");
  await screen.findByText("Weekly rhythm · a stronger colour is more spending");
  // Thirteen weeks in rows of four; a week is named by its first day.
  expect(screen.getAllByTestId("rhythm-row")).toHaveLength(4);
  expect(screen.getByRole("button", { name: "Aug 9 – Aug 15: $7.00, Spending" })).toBeVisible();
  expect(screen.getByText("Aug 9")).toBeVisible();
  fireEvent.change(screen.getByLabelText(/^From/), { target: { value: "2022-06-01" } });
  await screen.findByText("Yearly rhythm · a stronger colour is more spending");
  expect(screen.getByText("2022")).toBeVisible();
});

it("offers no evidence in any view without an authoritative reference revision", async () => {
  h.api.getFinanceSpending.mockResolvedValue({ ...week(), referenceRevision: undefined });
  mount(<FinanceSpendingScreen />);
  await screen.findByText("Groceries");
  expect(screen.queryByRole("button", { name: /Groceries/ })).toBeNull();
  press("Trends");
  await screen.findByText("Daily spending");
  expect(screen.queryByRole("button", { name: /Nov 17/ })).toBeNull();
  press("Rhythm");
  fireEvent.click(await screen.findByRole("button", { name: "Nov 17: $3.00, Spending" }));
  expect(screen.getAllByRole("button", { name: /Nov 17/ })).toHaveLength(1);
  expect(h.api.listFinanceSpendingTransactions).not.toHaveBeenCalled();
});

it("closes open evidence when the view or the period changes", async () => {
  h.api.getFinanceSpending.mockResolvedValue(week());
  mount(<FinanceSpendingScreen />);
  await open(/Groceries/);
  await screen.findByRole("button", { name: "All categories" });
  press("Rhythm");
  expect(screen.queryByRole("button", { name: /Back to|All categories/ })).toBeNull();
  press("List");
  press(/Groceries/);
  await screen.findByRole("button", { name: "All categories" });
  press("Month");
  await waitFor(() => expect(screen.queryByRole("button", { name: "All categories" })).toBeNull());
});

// Activity evidence

const TXN = "10000000-0000-4000-8000-000000000001";
const ENTRY = "20000000-0000-4000-8000-000000000001";
const change = (id: string, before: unknown, after: unknown) => ({
  id,
  recordRef: { kind: "transaction", id: TXN },
  action: "updated",
  before,
  after,
  auditEventIds: [],
});
const entry = (extra: Record<string, unknown> = {}) => ({
  id: ENTRY,
  occurredAt: "2026-11-18T14:00:00Z",
  kind: "financial_action",
  status: "applied",
  actor: { type: "agent", id: "agent-1" },
  action: "Categorized transaction",
  explanation: "The merchant matches your grocery rule.",
  caseId: null,
  runId: "30000000-0000-4000-8000-000000000001",
  actionId: null,
  sourceOperationId: null,
  auditEventIds: ["40000000-0000-4000-8000-000000000001"],
  sourceMessages: [],
  recordRefs: [
    { kind: "transaction", id: TXN, sourceKind: "finance_transaction" },
    { kind: "ledger_entry", id: "ledger-9" },
  ],
  changes: [
    change("change-1", { category: "Shopping", amount: 12 }, { category: "Groceries", amount: 12 }),
  ],
  targets: [],
  ...extra,
});
async function openActivity(record: Record<string, unknown>) {
  h.params = { view: "Activity" };
  h.api.listFinanceActivity.mockResolvedValue({ entries: [record], nextCursor: null });
  const view = mount(<FinanceAssistantScreen />);
  await open(/Categorized transaction|Sent a reminder/);
  return view;
}

it("opens an activity row to who acted, why, which records and what changed", async () => {
  await openActivity(entry());
  expect(screen.getByText("The merchant matches your grocery rule.")).toBeVisible();
  expect(screen.getByText(/^Completed · Agent · /)).toBeVisible();
  // Only the fields that differ are listed.
  expect(screen.getByText(/Category: Shopping → Groceries/)).toBeVisible();
  expect(screen.queryByText(/Amount: 12/)).toBeNull();
  expect(screen.getByText(/Run: 30000000/)).toBeVisible();
  press("Transaction");
  expect(h.push).toHaveBeenCalledWith({ pathname: "/finance-transaction", params: { id: TXN } });
  // A record this app cannot open is shown as evidence, not as a link.
  expect(screen.getByText("ledger-9")).toBeVisible();
  expect(screen.queryByRole("button", { name: /Ledger entry/ })).toBeNull();
  expect(screen.queryByRole("button", { name: "Load more evidence" })).toBeNull();
  press("All activity");
  expect(screen.getByRole("button", { name: /Categorized transaction/ })).toBeVisible();
});

it("routes each known record kind and refuses a reference whose source disagrees", async () => {
  const CASE = "50000000-0000-4000-8000-000000000001";
  await openActivity(
    entry({
      kind: "human_answer_decision",
      status: "accepted",
      caseId: CASE,
      agentAccount: { displayName: "Claude" },
      recordRefs: [
        { kind: "account", id: "account-1" },
        { kind: "contextual_question", id: "question-1" },
        { kind: "transaction", id: "other", sourceKind: "finance_account" },
      ],
      targets: [{ kind: "chat", id: "message-1" }],
      sourceMessages: [
        {
          id: "m1",
          createdAt: "2026-11-18T13:00:00Z",
          text: "Full text of the answer",
          excerpt: { start: 0, end: 4, text: "Yes, groceries" },
        },
        { id: "m2", createdAt: "2026-11-18T13:05:00Z", text: "Second message", excerpt: null },
      ],
      changes: [],
      effect: {
        actionFamilies: ["categorize"],
        significance: "budget_decision",
        authorityBasis: "authenticated_owner",
        humanApproval: { actorId: "u", reviewId: "r" },
      },
    }),
  );
  expect(screen.getByText(/^Accepted · Claude · /)).toBeVisible();
  expect(
    screen.getByText(
      "Answer accepted. This record does not establish an applied financial change.",
    ),
  ).toBeVisible();
  expect(screen.getByText(/Yes, groceries/)).toBeVisible();
  expect(screen.getByText(/Second message/)).toBeVisible();
  expect(
    screen.getByText("No financial before/after changes are recorded in this evidence."),
  ).toBeVisible();
  expect(screen.getByText(/Significance: Budget decision/)).toBeVisible();
  expect(screen.getByText(/Approved by a person in review/)).toBeVisible();
  press("Review case");
  expect(h.push).toHaveBeenLastCalledWith({
    pathname: "/finance-chat-reference",
    params: { kind: "review_case", id: CASE },
  });
  press("Account");
  expect(h.push).toHaveBeenLastCalledWith({
    pathname: "/finance-account",
    params: { id: "account-1" },
  });
  press("Contextual question");
  expect(h.push).toHaveBeenLastCalledWith({
    pathname: "/finance-chat-reference",
    params: { kind: "contextual_question", id: "question-1" },
  });
  expect(screen.queryByRole("button", { name: /^Transaction/ })).toBeNull();
  press("Finance conversation");
  expect(h.setParams).toHaveBeenLastCalledWith({ view: "Conversation" });
});

it("describes a notification delivery without inventing changes for it", async () => {
  await openActivity({
    ...entry(),
    kind: "notification_delivery",
    status: "delivered",
    action: "Sent a reminder",
    actor: null,
    runId: null,
    auditEventIds: [],
    recordRefs: [],
    changes: [],
    delivery: {
      attemptState: "delivered",
      observedAt: "2026-11-18T14:01:00Z",
      evidenceState: "partial",
    },
  });
  expect(
    screen.getByText(/^Delivery Delivered · observed .* · delivery evidence is partial$/),
  ).toBeVisible();
  expect(screen.queryByText("Changes")).toBeNull();
  expect(screen.queryByText("Records")).toBeNull();
});

it("loads further evidence through one toast and rejects a page that does not continue it", async () => {
  await openActivity(
    entry({
      changes: [
        {
          ...change("change-1", null, { category: "Groceries", needsReview: false }),
          action: "finance.transaction.classified",
        },
      ],
      evidence: { totalChanges: 3, loadedChanges: 1, nextCursor: "next-1" },
    }),
  );
  expect(screen.getByText("1 of 3 audited changes loaded · evidence incomplete")).toBeVisible();
  expect(screen.getByText(/Category: not recorded → Groceries/)).toBeVisible();
  // Audit identifiers are written as words, and yes or no instead of true or false.
  expect(screen.getByText(/Transaction · Classified/)).toBeVisible();
  expect(screen.getByText(/Needs review: not recorded → no/)).toBeVisible();
  // A page for other evidence is refused whole.
  h.api.getFinanceActivityEvidence.mockResolvedValueOnce({
    entryId: ENTRY,
    changes: [change("stray", { a: 1 }, { a: 2 })],
    recordRefs: [],
    offset: 2,
    totalChanges: 3,
    nextCursor: null,
  });
  press("Load more evidence");
  await waitFor(() =>
    expect(h.error).toHaveBeenCalledWith("Could not load more evidence. Try again.", {
      id: "feedback",
    }),
  );
  expect(h.api.getFinanceActivityEvidence).toHaveBeenCalledWith(ENTRY, { cursor: "next-1" });
  expect(screen.getByText("1 of 3 audited changes loaded · evidence incomplete")).toBeVisible();
  expectNoInlineResult();
  h.api.getFinanceActivityEvidence.mockResolvedValueOnce({
    entryId: ENTRY,
    changes: [change("change-2", { notes: "a" }, { notes: "a" }), change("change-3", null, null)],
    recordRefs: [{ kind: "account", id: "account-7" }],
    offset: 1,
    totalChanges: 3,
    nextCursor: null,
  });
  press("Load more evidence");
  await screen.findByText("3 of 3 audited changes loaded · complete");
  expect(h.loading).toHaveBeenLastCalledWith("Loading more evidence…");
  expect(h.success).toHaveBeenCalledWith("Evidence loaded", { id: "feedback" });
  expect(screen.getByText(/No field differences recorded/)).toBeVisible();
  expect(screen.getByText(/No field values recorded/)).toBeVisible();
  expect(screen.getByRole("button", { name: "Account" })).toBeVisible();
  expect(screen.queryByRole("button", { name: "Load more evidence" })).toBeNull();
  expectNoInlineResult();
});

it("drops loaded evidence when access to it is refused and stays silent after leaving", async () => {
  await openActivity(
    entry({ evidence: { totalChanges: 3, loadedChanges: 1, nextCursor: "next-1" } }),
  );
  h.api.getFinanceActivityEvidence.mockResolvedValueOnce({
    entryId: ENTRY,
    changes: [change("change-2", { notes: null }, { notes: "b" })],
    recordRefs: [],
    offset: 1,
    totalChanges: 3,
    nextCursor: "next-2",
  });
  press("Load more evidence");
  await screen.findByText("2 of 3 audited changes loaded · evidence incomplete");
  expect(screen.getByText(/Notes: none → b/)).toBeVisible();
  h.api.getFinanceActivityEvidence.mockRejectedValueOnce(
    new ApiClientError({ code: "not_found", message: "Gone", status: 404 }),
  );
  press("Load more evidence");
  await waitFor(() => expect(h.error).toHaveBeenCalledTimes(1));
  expect(h.api.getFinanceActivityEvidence).toHaveBeenLastCalledWith(ENTRY, { cursor: "next-2" });
  // Evidence the account may no longer read is not kept on screen.
  expect(screen.getByText("1 of 3 audited changes loaded · evidence incomplete")).toBeVisible();
  expect(screen.queryByText(/Notes: none → b/)).toBeNull();
  // A result that arrives after the evidence was closed announces nothing.
  let settle: (value: unknown) => void = () => undefined;
  h.api.getFinanceActivityEvidence.mockReturnValueOnce(
    new Promise((resolve) => (settle = resolve)),
  );
  press("Load more evidence");
  expect(screen.getByRole("button", { name: "Load more evidence" })).toBeDisabled();
  press("All activity");
  h.success.mockClear();
  h.error.mockClear();
  await act(async () => settle({ entryId: ENTRY, changes: [], offset: 1, totalChanges: 3 }));
  expect(h.success).not.toHaveBeenCalled();
  expect(h.error).not.toHaveBeenCalled();
  expect(h.dismiss).toHaveBeenCalledWith("feedback");
});

// Unread state

const unread = (count: string, readThrough = "0") => ({
  unreadCount: count,
  readThroughSequence: readThrough,
  latestAgentSequence: "0",
});
const tabBadges = () => h.tabs.mock.calls.at(-1)?.[0].badges;

it("badges the Assistant tab with the unread count and names it for a screen reader", async () => {
  h.api.getFinanceConversationUnread.mockResolvedValue(unread("3"));
  const first = mount(<FinanceLayout />);
  await waitFor(() =>
    expect(tabBadges()).toEqual({ assistant: { value: "3", label: "3 unread messages" } }),
  );
  first.unmount();
  h.api.getFinanceConversationUnread.mockResolvedValue(unread("1"));
  const second = mount(<FinanceLayout />);
  await waitFor(() => expect(tabBadges()?.assistant.label).toBe("1 unread message"));
  second.unmount();
  h.api.getFinanceConversationUnread.mockResolvedValue(unread("250"));
  mount(<FinanceLayout />);
  await waitFor(() =>
    expect(tabBadges()).toEqual({ assistant: { value: "99+", label: "99+ unread messages" } }),
  );
});

it("shows no badge when nothing is unread or the count is unknown, and raises no notice", async () => {
  const first = mount(<FinanceLayout />);
  await waitFor(() => expect(h.api.getFinanceConversationUnread).toHaveBeenCalledTimes(1));
  expect(tabBadges()).toBeUndefined();
  first.unmount();
  h.api.getFinanceConversationUnread.mockRejectedValue(new Error("offline"));
  const second = mount(<FinanceLayout />);
  await waitFor(() => expect(h.api.getFinanceConversationUnread).toHaveBeenCalledTimes(2));
  expect(tabBadges()).toBeUndefined();
  second.unmount();
  // A malformed count is unknown, never zero and never a crash.
  h.api.getFinanceConversationUnread.mockResolvedValue({ unreadCount: "many" });
  mount(<FinanceLayout />);
  await waitFor(() => expect(h.api.getFinanceConversationUnread).toHaveBeenCalledTimes(3));
  expect(tabBadges()).toBeUndefined();
  expect(h.error).not.toHaveBeenCalled();
});

it("says how many messages are unread on the conversation row", async () => {
  h.api.getFinanceConversationUnread.mockResolvedValue(unread("2"));
  mount(<FinanceAssistantScreen />);
  await screen.findByText("2 unread messages");
  press(/Your Finance conversation/);
  expect(h.setParams).toHaveBeenLastCalledWith({ view: "Conversation" });
});

const message = (sequence: string, authorKind = "agent") => ({
  id: `m${sequence}`,
  sequence,
  authorKind,
  text: `Message ${sequence}`,
  createdAt: "2026-11-18T14:00:00Z",
});

it("marks shown messages read once, then refreshes the unread count", async () => {
  h.api.getFinanceConversationUnread.mockResolvedValue(unread("2", "4"));
  h.api.getFinanceConversationHistory.mockResolvedValue({
    messages: [message("4"), message("5"), message("6")],
    nextCursor: null,
  });
  mount(<Conversation />);
  await waitFor(() => expect(h.api.markFinanceConversationRendered).toHaveBeenCalledWith("6"));
  await waitFor(() => expect(h.api.getFinanceConversationUnread).toHaveBeenCalledTimes(2));
  expect(h.api.markFinanceConversationRendered).toHaveBeenCalledTimes(1);
  expect(h.success).not.toHaveBeenCalled();
});

it("does not mark messages read while the transcript is not on screen", async () => {
  h.focused = false;
  h.api.getFinanceConversationUnread.mockResolvedValue(unread("2", "4"));
  h.api.getFinanceConversationHistory.mockResolvedValue({
    messages: [message("5"), message("6")],
    nextCursor: null,
  });
  mount(<Conversation />);
  await screen.findByText("Message 6");
  await waitFor(() => expect(h.api.getFinanceConversationUnread).toHaveBeenCalled());
  expect(h.api.markFinanceConversationRendered).not.toHaveBeenCalled();
});

it("marks through the latest message however far behind the read mark is", async () => {
  // Read through 2 and only the latest page is loaded: showing it still clears the badge.
  h.api.getFinanceConversationUnread.mockResolvedValue(unread("40", "2"));
  h.api.getFinanceConversationHistory.mockResolvedValue({
    messages: [message("40"), message("41")],
    nextCursor: "older",
  });
  mount(<Conversation />);
  await waitFor(() => expect(h.api.markFinanceConversationRendered).toHaveBeenCalledWith("41"));
  expect(h.api.markFinanceConversationRendered).toHaveBeenCalledTimes(1);
});

it("never marks without a known read mark, or around a message it cannot place", async () => {
  h.api.getFinanceConversationHistory.mockResolvedValue({
    messages: [message("40"), message("41")],
    nextCursor: "older",
  });
  // Already read through the newest message: nothing to record.
  h.api.getFinanceConversationUnread.mockResolvedValue(unread("0", "41"));
  const second = mount(<Conversation />);
  await screen.findByText("Message 41");
  await waitFor(() => expect(h.api.getFinanceConversationUnread).toHaveBeenCalled());
  expect(h.api.markFinanceConversationRendered).not.toHaveBeenCalled();
  second.unmount();
  h.api.getFinanceConversationUnread.mockRejectedValue(new Error("offline"));
  h.api.getFinanceConversationHistory.mockResolvedValue({
    messages: [message("41")],
    nextCursor: null,
  });
  const third = mount(<Conversation />);
  await screen.findByText("Message 41");
  expect(h.api.markFinanceConversationRendered).not.toHaveBeenCalled();
  third.unmount();
  // A message that cannot be placed blocks marking around it.
  h.api.getFinanceConversationUnread.mockResolvedValue(unread("1", "40"));
  h.api.getFinanceConversationHistory.mockResolvedValue({
    messages: [message("41"), { ...message("42"), sequence: undefined }],
    nextCursor: null,
  });
  mount(<Conversation />);
  await screen.findByText("Message 41");
  await waitFor(() => expect(h.api.getFinanceConversationUnread).toHaveBeenCalled());
  expect(h.api.markFinanceConversationRendered).not.toHaveBeenCalled();
});

it("marks the loaded page when it reaches the read mark, and tries again after a failed mark", async () => {
  h.api.getFinanceConversationUnread.mockResolvedValue(unread("2", "40"));
  h.api.getFinanceConversationHistory.mockResolvedValue({
    messages: [message("40"), message("41"), message("42", "user")],
    nextCursor: "older",
  });
  h.api.markFinanceConversationRendered.mockRejectedValueOnce(new Error("offline"));
  const { client } = mount(<Conversation />);
  await waitFor(() => expect(h.api.markFinanceConversationRendered).toHaveBeenCalledWith("42"));
  // Unconfirmed: the unread count is left as it was and nothing is announced.
  expect(h.error).not.toHaveBeenCalled();
  h.api.getFinanceConversationHistory.mockResolvedValue({
    messages: [message("40"), message("41"), message("42", "user"), message("43")],
    nextCursor: "older",
  });
  await act(async () => {
    await client.refetchQueries({ queryKey: ["finances", "owner-a", "conversation"] });
  });
  await waitFor(() => expect(h.api.markFinanceConversationRendered).toHaveBeenLastCalledWith("43"));
});
