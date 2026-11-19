// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
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
  readMailThread: vi.fn(),
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
vi.mock("../mail/reader", () => ({
  MailReader: ({ thread, close }: { thread: { subject: string }; close: () => void }) => (
    <div role="dialog" aria-label="Conversation">
      {thread.subject}
      <button type="button" onClick={close}>
        Close conversation
      </button>
    </div>
  ),
}));
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
    reviews: query([]),
    budgets: query([]),
    upcoming: query({ occurrences: [], unavailableSources: [] }),
    activity: query({ entries: [], nextCursor: null }),
    events: query<unknown[]>([]),
    calendars: query([{ id: "cal", isSelected: true }]),
    mail: query<unknown[]>([]),
    mailAccounts: query([{ mailboxes: [{ role: "inbox", unreadCount: 0 }] }]),
    readMailThread: h.readMailThread,
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
    events: { ...query(), isPending: true },
    mail: { ...query(), isPending: true },
  };
  const view = render(<TodayHome />);
  for (const text of [
    "Loading to-do…",
    "Loading payments…",
    "Loading priorities…",
    "Loading what’s next…",
    "Loading confirmed activity…",
    "Loading events…",
    "Loading today’s events…",
    "Loading mail that needs you…",
    "Loading your day…",
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
    reviews: query([
      { status: "needs_review", transaction: { id: "a", merchant: "Market" } },
      { status: "needs_review", transaction: { id: "b", merchant: "Cafe" } },
    ]),
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
  fireEvent.click(screen.getByRole("button", { name: /2 transactions need your input/ }));
  expect(h.push).toHaveBeenLastCalledWith({
    pathname: "/finances/assistant",
    params: { view: "For you" },
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

it("opens one review directly and links confirmed transaction activity to the same canonical detail", () => {
  h.skySource = "weather";
  h.data = {
    ...data(),
    reviews: query([
      { status: "needs_review", transaction: { id: "tx", merchant: "Corner Market" } },
      { status: "resolved", transaction: { id: "done", merchant: "Already reviewed" } },
    ]),
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
  expect(screen.getByText("1 transaction needs your input")).toBeVisible();
  expect(screen.queryByText("Already reviewed")).toBeNull();
  expect(screen.queryByText(/Use local weather/)).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /Corner Market/ }));
  expect(h.push).toHaveBeenLastCalledWith({
    pathname: "/finance-transaction",
    params: { id: "tx" },
  });
  fireEvent.click(screen.getByRole("button", { name: /Categorized the groceries purchase/ }));
  expect(h.push).toHaveBeenLastCalledWith({
    pathname: "/finance-transaction",
    params: { id: "tx" },
  });
});

vi.mock("../auth/context", () => ({ useOptionalAuth: () => null }));

const event = (id: string, title: string, startsAt: string, endsAt: string, more = {}) => ({
  id,
  title,
  startsAt,
  endsAt,
  allDay: false,
  status: "confirmed",
  provider: "google",
  location: null,
  ...more,
});
const attention = (id: string, title: string, more = {}) => ({
  id,
  title,
  summary: `${title} summary`,
  status: "open",
  kind: "important",
  importance: "normal",
  expiresAt: null,
  relatedEntityType: "mail_thread",
  relatedEntityId: `thread-${id}`,
  updatedAt: "2026-11-09T08:00:00Z",
  ...more,
});
it("briefs a day with events and attention mail and opens each row's native detail", async () => {
  h.data = {
    ...data(),
    events: query([
      event("done", "Breakfast", "2026-11-09T08:00:00Z", "2026-11-09T09:00:00Z"),
      event("off", "Cancelled sync", "2026-11-09T13:00:00Z", "2026-11-09T14:00:00Z", {
        status: "cancelled",
      }),
      event("day", "Conference", "2026-11-09", "2026-11-10", { allDay: true }),
      event("later", "Dentist", "2026-11-09T15:00:00Z", "2026-11-09T16:00:00Z", {
        location: "Main St",
        status: "tentative",
      }),
      event("now", "Standup", "2026-11-09T11:30:00Z", "2026-11-09T12:30:00Z"),
      event("", "", "2026-11-09T18:00:00Z", "2026-11-09T19:00:00Z", { id: "last" }),
    ]),
    mail: query([
      attention("low", "Newsletter choice", { importance: "low" }),
      attention("old", "Expired request", {
        importance: "critical",
        expiresAt: "2026-11-09T11:00:00Z",
      }),
      attention("run", "Mail run finished", { kind: "run_summary", importance: "critical" }),
      attention("done", "Already handled", { status: "resolved" }),
      attention("travel", "Approve the fare", { importance: "critical" }),
      attention("board", "Board packet", {
        importance: "high",
        relatedEntityType: null,
        relatedEntityId: null,
        summary: "x".repeat(200),
      }),
      attention("newer", "Reply to Maya", { updatedAt: "2026-11-09T10:00:00Z" }),
    ]),
    mailAccounts: query([
      {
        mailboxes: [
          { role: "inbox", unreadCount: 4 },
          { role: "sent", unreadCount: 9 },
        ],
      },
      { mailboxes: [{ role: "inbox", unreadCount: 1 }] },
    ]),
  };
  h.readMailThread.mockResolvedValueOnce(null).mockResolvedValueOnce({ subject: "Fare approval" });
  render(<TodayHome />);
  const rows = screen.getAllByRole("button").map((row) => row.textContent);
  const order = ["Standup", "Dentist", "Untitled event", "Approve the fare", "Board packet"].map(
    (title) => rows.findIndex((row) => row?.includes(title)),
  );
  expect(order).toEqual([...order].sort((a, b) => a - b));
  expect(order).not.toContain(-1);
  expect(screen.getByRole("button", { name: "Standup Now 11:30 AM – 12:30 PM" })).toBeVisible();
  expect(screen.getByRole("button", { name: /Dentist.*Tentative · Main St/ })).toBeVisible();
  for (const hidden of ["Breakfast", "Cancelled sync", "Conference"])
    expect(screen.queryByText(hidden)).toBeNull();
  expect(screen.getByText("3 of 4")).toBeVisible();
  expect(screen.getByText("Needs you · 3 of 4")).toBeVisible();
  for (const hidden of [
    "Expired request",
    "Mail run finished",
    "Already handled",
    "Newsletter choice",
  ])
    expect(screen.queryByText(hidden)).toBeNull();
  expect(screen.getByRole("button", { name: /Approve the fare.*Critical/ })).toBeVisible();
  expect(screen.getByText(`${"x".repeat(137)}…`)).toBeVisible();
  expect(screen.getByText(/Tasks, Calendar, Mail & Finances/)).toBeVisible();

  fireEvent.click(screen.getByRole("button", { name: /Dentist/ }));
  expect(h.push).toHaveBeenLastCalledWith({ pathname: "/calendar-event", params: { id: "later" } });
  fireEvent.click(screen.getByRole("button", { name: "4 events left" }));
  expect(h.push).toHaveBeenLastCalledWith("/calendar");
  fireEvent.click(screen.getByRole("button", { name: "5 unread" }));
  expect(h.push).toHaveBeenLastCalledWith("/mail");
  fireEvent.click(screen.getByRole("button", { name: /Board packet/ }));
  expect(h.push).toHaveBeenLastCalledWith("/mail");
  expect(h.readMailThread).not.toHaveBeenCalled();

  // A conversation that could not be read reports through Sonner in the data hook; nothing opens.
  h.push.mockClear();
  fireEvent.click(screen.getByRole("button", { name: /Approve the fare/ }));
  expect(h.readMailThread).toHaveBeenLastCalledWith("thread-travel");
  await Promise.resolve();
  expect(screen.queryByRole("dialog")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /Approve the fare/ }));
  expect(await screen.findByRole("dialog", { name: "Conversation" })).toHaveTextContent(
    "Fare approval",
  );
  expect(h.push).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText("Close conversation"));
  expect(screen.queryByRole("dialog")).toBeNull();
});
it("keeps the other sources when Calendar or Mail fails and says which part is missing", () => {
  const mail = query([attention("travel", "Approve the fare")]);
  const events = query([event("now", "Standup", "2026-11-09T11:30:00Z", "2026-11-09T12:30:00Z")]);
  h.data = { ...data(), failed: true, mail, events: { ...query(), isError: true } };
  const view = render(<TodayHome />);
  expect(screen.getByText("Calendar is unavailable. Tap Refresh to try again.")).toBeVisible();
  expect(screen.getByText("Events unavailable")).toBeVisible();
  expect(screen.getByText("Some data unavailable · showing available results")).toBeVisible();
  expect(screen.getByRole("button", { name: /Approve the fare/ })).toBeVisible();
  expect(screen.getByText("Nothing needs your attention right now.")).toBeVisible();
  expect(screen.queryByText("Mail is unavailable. Tap Refresh to try again.")).toBeNull();

  h.data = { ...data(), failed: true, events, mail: { ...query(), isError: true } };
  view.rerender(<TodayHome />);
  expect(screen.getByText("Mail is unavailable. Tap Refresh to try again.")).toBeVisible();
  expect(screen.getByText("Needs you · Partial")).toBeVisible();
  expect(screen.getByRole("button", { name: /Standup/ })).toBeVisible();
  expect(screen.queryByText("Calendar is unavailable. Tap Refresh to try again.")).toBeNull();

  // A failed refresh keeps the last results on screen and marks them.
  h.data = {
    ...data(),
    failed: true,
    events: { ...events, isError: true },
    mail: { ...mail, isError: true },
  };
  view.rerender(<TodayHome />);
  expect(screen.getByText("1 event left · cached")).toBeVisible();
  expect(screen.getByText("Partial")).toBeVisible();
  expect(screen.getByRole("button", { name: /Standup/ })).toBeVisible();
  expect(screen.getByRole("button", { name: /Approve the fare/ })).toBeVisible();
});
it("names a failed calendar or mail-account read instead of an empty day or a clear inbox", () => {
  const failedRead = { ...query(), isError: true };
  h.data = { ...data(), failed: true, calendars: failedRead, mailAccounts: failedRead };
  const view = render(<TodayHome />);
  expect(screen.getByText("Calendar is unavailable. Tap Refresh to try again.")).toBeVisible();
  expect(screen.getByText("Mail is unavailable. Tap Refresh to try again.")).toBeVisible();
  expect(screen.queryByText("Nothing scheduled today.")).toBeNull();
  expect(screen.queryByText("No mail needs you right now.")).toBeNull();

  // Rows that did arrive stay on screen, marked as a partial read.
  h.data = {
    ...h.data,
    events: query([event("now", "Standup", "2026-11-09T11:30:00Z", "2026-11-09T12:30:00Z")]),
    mail: query([attention("travel", "Approve the fare")]),
  };
  view.rerender(<TodayHome />);
  expect(screen.getByRole("button", { name: /Standup/ })).toBeVisible();
  expect(screen.getByRole("button", { name: /Approve the fare/ })).toBeVisible();
  expect(screen.getByText("Partial")).toBeVisible();
  expect(screen.getByText("Needs you · Partial")).toBeVisible();
});
it("opens only the latest conversation and none after the reader is closed", async () => {
  const pending: Array<(thread: { subject: string }) => void> = [];
  h.readMailThread.mockImplementation(() => new Promise((resolve) => pending.push(resolve)));
  h.data = {
    ...data(),
    mail: query([attention("travel", "Approve the fare"), attention("maya", "Reply to Maya")]),
  };
  render(<TodayHome />);
  fireEvent.click(screen.getByRole("button", { name: /Approve the fare/ }));
  fireEvent.click(screen.getByRole("button", { name: /Reply to Maya/ }));
  await act(async () => pending[1]?.({ subject: "Maya" }));
  expect(screen.getByRole("dialog")).toHaveTextContent("Maya");
  await act(async () => pending[0]?.({ subject: "Fare approval" }));
  expect(screen.getByRole("dialog")).toHaveTextContent("Maya");

  // Closing the reader also drops a read that is still on its way.
  fireEvent.click(screen.getByRole("button", { name: /Approve the fare/ }));
  fireEvent.click(screen.getByText("Close conversation"));
  await act(async () => pending[2]?.({ subject: "Fare approval" }));
  expect(screen.queryByRole("dialog")).toBeNull();
});
it("tells an empty day and a clear inbox apart from Calendar and Mail that are not set up", () => {
  h.data = {
    ...data(),
    events: query([event("done", "Breakfast", "2026-11-09T08:00:00Z", "2026-11-09T09:00:00Z")]),
  };
  const view = render(<TodayHome />);
  expect(screen.getByText("Nothing else scheduled today.")).toBeVisible();
  expect(screen.getByText("No mail needs you right now.")).toBeVisible();
  expect(screen.getByText("0 events left")).toBeVisible();
  expect(screen.queryByText(/unread/)).toBeNull();

  h.data = { ...data(), calendars: query([]), mailAccounts: query([]) };
  view.rerender(<TodayHome />);
  expect(screen.queryByText("Nothing scheduled today.")).toBeNull();
  expect(screen.queryByText("No mail needs you right now.")).toBeNull();
  expect(screen.getByText(/Updated .* · Tasks & Finances/)).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: /Add a calendar/ }));
  expect(h.push).toHaveBeenLastCalledWith("/settings");
  fireEvent.click(screen.getByRole("button", { name: /Connect a mail account/ }));
  expect(h.push).toHaveBeenLastCalledWith("/settings");

  // Calendars exist but none is shown: the events read is empty by choice, not by an empty day.
  h.data = { ...data(), calendars: query([{ id: "cal", isSelected: false }]) };
  view.rerender(<TodayHome />);
  expect(screen.queryByText("Nothing scheduled today.")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /Every calendar is hidden/ }));
  expect(h.push).toHaveBeenLastCalledWith("/calendar");

  // Attention raised before an account was disconnected is still shown rather than hidden.
  h.data = {
    ...data(),
    mailAccounts: query([]),
    mail: query([attention("travel", "Approve the fare")]),
  };
  view.rerender(<TodayHome />);
  expect(screen.getByRole("button", { name: /Approve the fare/ })).toBeVisible();
  expect(screen.queryByText("Connect a mail account")).toBeNull();
  view.rerender(<TodayHome />);
  // A day whose only event was cancelled has nothing behind it either.
  h.data = {
    ...data(),
    events: query([
      event("off", "Cancelled sync", "2026-11-09T08:00:00Z", "2026-11-09T09:00:00Z", {
        status: "cancelled",
      }),
    ]),
  };
  view.rerender(<TodayHome />);
  expect(screen.getByText("Nothing scheduled today.")).toBeVisible();
});
it("orders events that start together by title so the brief does not reshuffle between reads", () => {
  h.data = {
    ...data(),
    events: query([
      event("b", "Review", "2026-11-09T15:00:00Z", "2026-11-09T16:00:00Z"),
      event("a", "Planning", "2026-11-09T15:00:00Z", "2026-11-09T16:00:00Z"),
    ]),
  };
  render(<TodayHome />);
  const rows = screen.getAllByRole("button").map((row) => row.textContent ?? "");
  expect(rows.findIndex((row) => row.includes("Planning"))).toBeLessThan(
    rows.findIndex((row) => row.includes("Review")),
  );
  expect(screen.getByText("2 events left")).toBeVisible();
});
it("does not count a neighbouring day's all-day event as part of today outside UTC", () => {
  // The day's instant range overlaps the next calendar date, so the read can return this event.
  h.data = {
    ...data(),
    timezone: "America/Los_Angeles",
    events: query([event("next", "Offsite", "2026-11-10", "2026-11-11", { allDay: true })]),
  };
  render(<TodayHome />);
  expect(screen.queryByText("Offsite")).toBeNull();
  expect(screen.getByText("Nothing scheduled today.")).toBeVisible();
  expect(screen.queryByText("Nothing else scheduled today.")).toBeNull();
  expect(screen.getByText("0 events left")).toBeVisible();
});
