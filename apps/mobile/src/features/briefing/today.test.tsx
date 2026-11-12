// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import TodayHome from "../../app/(workspaces)/index";

vi.mock("react", async () => {
  const { createRequire } = await import("node:module");
  return createRequire(`${process.cwd()}/package.json`)("react");
});
const h = vi.hoisted(() => ({
  data: {} as Record<string, unknown>,
  push: vi.fn(),
  refresh: vi.fn(),
  location: vi.fn(),
  hero: vi.fn(),
  busy: false,
  skySource: "time",
}));
vi.mock("react-native", async () => {
  const native = await import("../../../test/native");
  return {
    ...native,
    View: ({ children, onLayout }: PropsWithChildren<{ onLayout?: (event: unknown) => void }>) => (
      <div>
        {children}
        {onLayout && (
          <button
            type="button"
            onClick={() => onLayout({ nativeEvent: { layout: { height: 320 } } })}
          >
            Measure hero
          </button>
        )}
      </div>
    ),
  };
});
vi.mock("expo-router", () => ({ router: { push: h.push }, Stack: { Screen: () => null } }));
vi.mock("../../components/icons", () => ({ Icon: () => null }));
vi.mock("../../components/screen", () => ({
  Screen: ({ children, onScroll }: PropsWithChildren<{ onScroll?: (event: unknown) => void }>) => (
    <div>
      {children}
      {onScroll && (
        <>
          <button
            type="button"
            onClick={() => onScroll({ nativeEvent: { contentOffset: { y: 500 } } })}
          >
            Scroll past hero
          </button>
          <button
            type="button"
            onClick={() => onScroll({ nativeEvent: { contentOffset: { y: 0 } } })}
          >
            Return to hero
          </button>
        </>
      )}
    </div>
  ),
}));
vi.mock("../../components/workspace-header-inset", async () => {
  const { createContext } = await import("react");
  return {
    useWorkspaceHeaderInset: () => 80,
    WorkspaceHeroVisibility: createContext({ current: h.hero }),
  };
});
vi.mock("./today-hero", () => ({ TodayHeroBackdrop: () => null }));
vi.mock("./live-data", () => ({ useTodayData: () => h.data }));
vi.mock("./sky-context", () => ({
  useTodaySky: () => ({
    sky: { source: h.skySource, chromeDark: true, ink: "white", secondary: "white" },
    label: "Time-based sky",
    busy: h.busy,
    requestLocation: h.location,
  }),
}));
const query = <T,>(data?: T) => ({ data, isPending: false, isError: false });
function data() {
  return {
    timezone: "UTC",
    now: new Date("2026-11-09T12:00:00Z"),
    updatedAt: Date.parse("2026-11-09T11:59:00Z"),
    range: { from: "2026-11-09" },
    start: "2026-11-09T00:00:00Z",
    tasks: query({ items: [], total: 0 }),
    overdue: query({ total: 0 }),
    nextTasks: query({ items: [] }),
    reviews: query({
      complete: true,
      activeDecisionCount: 0,
      historicalRecordCount: 0,
      technicalBlockerCount: 0,
      processingCount: 0,
    }),
    budgets: query([]),
    upcoming: query({ occurrences: [], unavailableSources: [] }),
    activity: query({ entries: [], nextCursor: null }),
    failed: false,
    loading: false,
    refreshing: false,
    refresh: h.refresh,
  };
}
beforeEach(() => {
  vi.clearAllMocks();
  h.data = data();
  h.busy = false;
  h.skySource = "time";
});
afterEach(cleanup);
it("opens timezone settings before rendering date-scoped content", () => {
  h.data = { ...data(), timezone: undefined };
  render(<TodayHome />);
  fireEvent.click(screen.getByRole("button", { name: /Set your timezone/ }));
  expect(h.push).toHaveBeenCalledWith("/settings");
  expect(screen.queryByText("Needs you")).toBeNull();
});
it("supports explicit refresh, local weather consent, summary destinations and hero chrome lifecycle", () => {
  h.data = { ...data(), overdue: query({ total: 2 }) };
  const view = render(<TodayHome />);
  fireEvent.click(screen.getByRole("button", { name: "Refresh Today" }));
  expect(h.refresh).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole("button", { name: "Use current location for the Today sky" }));
  expect(h.location).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole("button", { name: "0 to-do" }));
  expect(h.push).toHaveBeenLastCalledWith("/tasks");
  fireEvent.click(screen.getByRole("button", { name: "2 overdue" }));
  expect(h.push).toHaveBeenLastCalledWith({
    pathname: "/task-browser",
    params: { view: "today", due: "overdue", title: "Overdue", status: "open" },
  });
  fireEvent.click(screen.getByRole("button", { name: "0 payments" }));
  expect(h.push).toHaveBeenLastCalledWith({
    pathname: "/finances/plan",
    params: { view: "Cash flow" },
  });
  fireEvent.click(screen.getByText("Measure hero"));
  fireEvent.click(screen.getByText("Scroll past hero"));
  expect(h.hero).toHaveBeenLastCalledWith(false);
  fireEvent.click(screen.getByText("Return to hero"));
  expect(h.hero).toHaveBeenLastCalledWith(true);
  view.unmount();
  expect(h.hero).toHaveBeenLastCalledWith(true);
});
it("distinguishes loading, unavailable, cached and truncated-history states", () => {
  h.data = {
    ...data(),
    loading: true,
    tasks: { ...query(), isPending: true },
    reviews: { ...query(), isPending: true },
    upcoming: { ...query(), isPending: true },
    nextTasks: { ...query(), isPending: true },
    activity: { ...query(), isPending: true },
  };
  const view = render(<TodayHome />);
  for (const text of [
    "Loading to-do…",
    "Loading payments…",
    "Loading priorities…",
    "Loading what’s next…",
    "Loading confirmed activity…",
    "Loading Tasks and Finances…",
  ])
    expect(screen.getByText(text)).toBeVisible();
  h.data = {
    ...data(),
    failed: true,
    tasks: { ...query(), isError: true },
    reviews: { ...query(), isError: true },
    upcoming: { ...query(), isError: true },
    nextTasks: { ...query(), isError: true },
    activity: { ...query(), isError: true },
  };
  view.rerender(<TodayHome />);
  for (const text of [
    "To-do unavailable",
    "Payments unavailable",
    "Attention items unavailable. Tap Refresh to try again.",
    "Some upcoming items are unavailable.",
    "Activity is unavailable.",
  ])
    expect(screen.getByText(text)).toBeVisible();
  h.data = {
    ...data(),
    refreshing: true,
    tasks: { ...query({ items: [], total: 3 }), isError: true },
    upcoming: { ...query({ occurrences: [], unavailableSources: [] }), isError: true },
    activity: query({ entries: [], nextCursor: "older" }),
  };
  view.rerender(<TodayHome />);
  expect(screen.getByText("3 to-do · cached")).toBeVisible();
  expect(screen.getByText("0 payments · cached")).toBeVisible();
  expect(screen.getByText("Refreshing…")).toBeVisible();
  expect(screen.getByRole("button", { name: "Refresh Today" })).toBeDisabled();
  expect(screen.getByText(/No confirmed actions in recent activity/)).toBeVisible();
});
it("opens multi-review queues, pacing budgets, and confirmed activity without inventing transaction links", () => {
  h.data = {
    ...data(),
    reviews: query({
      complete: true,
      activeDecisionCount: 2,
      technicalBlockerCount: 0,
      processingCount: 0,
    }),
    budgets: query([
      { spent: 60, budget: { id: "food", category: "Dining", month: "2026-11", limit: 100 } },
    ]),
    activity: query({
      entries: [
        {
          id: "entry",
          kind: "financial_action",
          actor: { type: "agent" },
          status: "applied",
          occurredAt: "2026-11-09T10:00:00Z",
          action: "categorize_transaction",
          explanation: "A detailed explanation ".repeat(10),
          targets: [],
        },
      ],
      nextCursor: null,
    }),
  };
  render(<TodayHome />);
  fireEvent.click(screen.getByRole("button", { name: /2 Finance decisions need your input/ }));
  expect(h.push).toHaveBeenLastCalledWith({
    pathname: "/finances/assistant",
    params: { view: "Conversation" },
  });
  fireEvent.click(screen.getByRole("button", { name: /Dining/ }));
  expect(screen.getByText("Pacing high")).toBeVisible();
  expect(h.push).toHaveBeenLastCalledWith({
    pathname: "/finance-budget-category",
    params: { id: "food", month: "2026-11" },
  });
  const explanation = `${"A detailed explanation ".repeat(10).slice(0, 137).trimEnd()}…`;
  expect(screen.getByText(explanation)).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: new RegExp(explanation) }));
  expect(h.push).toHaveBeenLastCalledWith({
    pathname: "/finances/assistant",
    params: { view: "Activity" },
  });
});
it("does not request location again while a request is in progress", () => {
  h.busy = true;
  render(<TodayHome />);
  fireEvent.click(screen.getByRole("button", { name: "Use current location for the Today sky" }));
  expect(h.location).not.toHaveBeenCalled();
});
it("keeps undated reminders actionable and preserves read-only entity navigation", () => {
  h.data = {
    ...data(),
    tasks: query({
      items: [
        {
          kind: "reminder",
          readOnly: true,
          record: { id: "reminder", title: "Check the renewal", dueAt: null, priority: "high" },
        },
      ],
      total: 1,
    }),
  };
  render(<TodayHome />);
  expect(screen.getByText("Reminder · High priority")).toBeVisible();
  expect(screen.getByText("No due date")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: /Check the renewal/ }));
  expect(h.push).toHaveBeenLastCalledWith({
    pathname: "/task-editor",
    params: { id: "reminder", kind: "reminder", readOnly: "1" },
  });
});
it("prioritizes overspending above high pacing and summarizes other budget exceptions", () => {
  h.data = {
    ...data(),
    budgets: query([
      { spent: 70, budget: { id: "dining", category: "Dining", month: "2026-11", limit: 100 } },
      { spent: 120, budget: { id: "food", category: "Groceries", month: "2026-11", limit: 100 } },
      { spent: 1, budget: { id: "other", category: "Other", month: "2026-11", limit: 100 } },
    ]),
  };
  render(<TodayHome />);
  expect(screen.getByText("2 budget categories need attention")).toBeVisible();
  expect(screen.getByText("$20.00 over")).toBeVisible();
  expect(screen.queryByText("Dining")).toBeNull();
});
it("includes expected income while excluding undated tasks, out-of-window and superseded payments", () => {
  const occurrence = {
    key: "income",
    displayName: "Payday",
    inCurrentSchedule: true,
    matchState: "expected",
    localDate: "2026-11-10",
    source: { kind: "income" },
    remainingExpectedCents: 100_000,
    currencyCode: "USD",
  };
  h.data = {
    ...data(),
    nextTasks: query({
      items: [
        {
          kind: "task",
          readOnly: false,
          relevantAt: null,
          record: { id: "undated", title: "Not scheduled", dueAt: null, priority: "normal" },
        },
      ],
    }),
    upcoming: query({
      occurrences: [
        occurrence,
        { ...occurrence, key: "old", displayName: "Old payment", inCurrentSchedule: false },
        { ...occurrence, key: "later", displayName: "Next month", localDate: "2026-12-01" },
      ],
      unavailableSources: [],
    }),
  };
  render(<TodayHome />);
  expect(screen.getByText("Payday")).toBeVisible();
  expect(screen.getByText("+$1,000.00")).toBeVisible();
  expect(screen.getByText(/Income expected/)).toBeVisible();
  expect(screen.queryByText("Not scheduled")).toBeNull();
  expect(screen.queryByText("Old payment")).toBeNull();
  expect(screen.queryByText("Next month")).toBeNull();
});
it("never calls unconfirmed, human, old or unrelated activity handled by nohmi", () => {
  const entry = {
    id: "base",
    kind: "financial_action",
    actor: { type: "agent" },
    status: "applied",
    occurredAt: "2026-11-09T10:00:00Z",
    action: "categorize_transaction",
    explanation: "Matched the reviewed category",
    targets: [],
  };
  h.data = {
    ...data(),
    activity: query({
      entries: [
        { ...entry, id: "unknown", actor: null },
        { ...entry, id: "human", actor: { type: "human" } },
        { ...entry, id: "pending", status: "pending" },
        { ...entry, id: "old", occurredAt: "2026-11-08T10:00:00Z" },
        { ...entry, id: "event", kind: "note" },
      ],
      nextCursor: null,
    }),
  };
  render(<TodayHome />);
  expect(screen.getByText("No confirmed agent actions today.")).toBeVisible();
  expect(screen.queryByText(entry.explanation)).toBeNull();
});

it("opens active decisions separately from confirmed transaction activity", () => {
  h.skySource = "weather";
  h.data = {
    ...data(),
    reviews: query({
      complete: true,
      activeDecisionCount: 1,
      technicalBlockerCount: 0,
      processingCount: 0,
    }),
    activity: query({
      entries: [
        {
          id: "action",
          kind: "financial_action",
          actor: { type: "agent" },
          status: "applied",
          occurredAt: "2026-11-09T10:00:00Z",
          action: "categorize_transaction",
          explanation: "Categorized the groceries purchase",
          targets: [{ kind: "transaction", id: "tx" }],
        },
      ],
      nextCursor: null,
    }),
  };
  render(<TodayHome />);
  expect(screen.getByText("1 Finance decision needs your input")).toBeVisible();
  expect(screen.queryByText("Already reviewed")).toBeNull();
  expect(screen.queryByText(/Use local weather/)).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /1 Finance decision/ }));
  expect(h.push).toHaveBeenLastCalledWith({
    pathname: "/finances/assistant",
    params: { view: "Conversation" },
  });
  fireEvent.click(screen.getByRole("button", { name: /Categorized the groceries purchase/ }));
  expect(h.push).toHaveBeenLastCalledWith({
    pathname: "/finance-transaction",
    params: { id: "tx" },
  });
});

vi.mock("../auth/context", () => ({ useOptionalAuth: () => null }));

it("keeps historical reviews out of Today and shows technical recovery separately", () => {
  h.data = {
    ...data(),
    reviews: query({
      complete: true,
      activeDecisionCount: 0,
      historicalRecordCount: 2000,
      technicalBlockerCount: 1,
      processingCount: 0,
    }),
  };
  render(<TodayHome />);
  expect(screen.getByText("Finance needs recovery")).toBeVisible();
  expect(screen.queryByText(/2000|2,000/)).toBeNull();
  expect(screen.queryByText(/decisions need your input/)).toBeNull();
});
