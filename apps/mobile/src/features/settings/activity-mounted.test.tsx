// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MobileDataProvider } from "../tasks/data";
import { ActivitySettingsScreen } from "./activity";

vi.mock("react", async () => {
  const { createRequire } = await import("node:module");
  return createRequire(`${process.cwd()}/package.json`)("react");
});
vi.mock("@tanstack/react-query", async () => {
  const { createRequire } = await import("node:module");
  return createRequire(`${process.cwd()}/apps/web/package.json`)("@tanstack/react-query");
});
const h = vi.hoisted(() => ({
  owner: "owner",
  epoch: 1,
  list: vi.fn(),
  error: vi.fn(),
  success: vi.fn(),
  loading: vi.fn(() => "activity-refresh"),
  dismiss: vi.fn(),
}));
vi.mock("../auth/context", () => ({
  useOptionalAuth: () => null,
  useAuth: () => ({
    state: { user: { id: h.owner } },
    session: { epoch: () => h.epoch, api: () => ({ listActivity: h.list }) },
  }),
}));
vi.mock("../../navigation/workspace-motion", () => ({
  useWorkspaceMotion: () => null,
  regionMotion: () => ({}),
}));
vi.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
vi.mock("react-native", async () => {
  const native = await import("../../../test/native");
  return {
    ...native,
    Animated: { View: native.View },
    RefreshControl: ({ refreshing, onRefresh }: { refreshing: boolean; onRefresh: () => void }) => (
      <button
        type="button"
        aria-label="Pull to refresh activity"
        aria-busy={refreshing}
        onClick={onRefresh}
      >
        Native refresh gesture
      </button>
    ),
    ScrollView: ({
      children,
      refreshControl,
    }: {
      children: React.ReactNode;
      refreshControl?: React.ReactNode;
    }) => (
      <div>
        {refreshControl}
        {children}
      </div>
    ),
  };
});
vi.mock("../../components/icons", () => ({
  Icon: ({ name }: { name: string }) => <span role="img" aria-label={name} />,
}));
vi.mock("sonner-native", () => ({
  toast: { error: h.error, success: h.success, loading: h.loading, dismiss: h.dismiss },
}));
const event = {
  id: "event",
  action: "task.updated",
  entityType: "task",
  entityId: "task-id",
  actorType: "human",
  actorId: "actor-id",
  createdAt: "2026-11-10T12:00:00Z",
  requestId: "request-id",
  before: { password: "hidden-before-secret" },
  after: { mail: "hidden-after-private" },
};
const agentEvent = {
  ...event,
  id: "agent-event",
  action: "calendar_event.created",
  entityType: "calendar_event",
  entityId: "calendar-id",
  actorType: "agent",
  requestId: "agent-request",
};
const wrap = () => (
  <MobileDataProvider key={`${h.owner}:${h.epoch}`}>
    <ActivitySettingsScreen />
  </MobileDataProvider>
);
beforeEach(() => {
  vi.clearAllMocks();
  h.owner = "owner";
  h.epoch = 1;
  h.list.mockResolvedValue([event, agentEvent]);
});
afterEach(cleanup);
it("requests the latest100 authoritative events, exposes search identity and retries initial failure with one error owner", async () => {
  h.list.mockRejectedValueOnce(new Error("Offline"));
  render(wrap());
  fireEvent.click(await screen.findByText("Retry loading"));
  await screen.findByText("Task updated");
  expect(h.list).toHaveBeenNthCalledWith(1, 100);
  expect(h.list).toHaveBeenNthCalledWith(2, 100);
  expect(h.error).toHaveBeenCalledOnce();
  expect(screen.getByRole("img", { name: "search" })).toBeVisible();
  expect(screen.queryByText("Refresh activity")).toBeNull();
});
it("uses the native spinner, locks overlapping refreshes and retains cached data on one-toast failure", async () => {
  render(wrap());
  await screen.findByText("Task updated");
  let fail: (error: Error) => void = () => {};
  h.list.mockImplementationOnce(
    () =>
      new Promise((_resolve, reject) => {
        fail = reject;
      }),
  );
  const refresh = screen.getByRole("button", { name: "Pull to refresh activity" });
  fireEvent.click(refresh);
  await waitFor(() => expect(refresh).toHaveAttribute("aria-busy", "true"));
  fireEvent.click(refresh);
  expect(h.list).toHaveBeenCalledTimes(2);
  await act(async () => fail(new Error("Offline refresh")));
  await waitFor(() => expect(refresh).toHaveAttribute("aria-busy", "false"));
  expect(h.error).toHaveBeenCalledExactlyOnceWith(
    "Couldn’t confirm the result. Check your connection and refresh before retrying.",
    { id: undefined },
  );
  expect(h.loading).not.toHaveBeenCalled();
  expect(screen.getByText("Task updated")).toBeVisible();
  expect(screen.queryByText("Offline refresh")).toBeNull();
  expect(
    screen.queryByText(
      "Couldn’t confirm the result. Check your connection and refresh before retrying.",
    ),
  ).toBeNull();
  expect(h.success).not.toHaveBeenCalled();
});
it("refreshes confirmed data with the native spinner and silent success while retaining search and actor choices", async () => {
  render(wrap());
  await screen.findByText("Calendar event created");
  fireEvent.click(screen.getByRole("button", { name: "Agents" }));
  fireEvent.change(screen.getByLabelText("Search activity"), {
    target: { value: "calendar event" },
  });
  h.list.mockResolvedValue([{ ...agentEvent, action: "calendar_event.updated" }]);
  fireEvent.click(screen.getByRole("button", { name: "Pull to refresh activity" }));
  await screen.findByText("Calendar event updated");
  expect(screen.getByLabelText("Search activity")).toHaveValue("calendar event");
  expect(screen.getByRole("button", { name: "Agents" })).toHaveAttribute("aria-pressed", "true");
  expect(h.loading).not.toHaveBeenCalled();
  expect(h.success).not.toHaveBeenCalled();
  expect(screen.queryByText("Activity refreshed")).toBeNull();
  expect(h.error).not.toHaveBeenCalled();
});
it("keeps resource summaries readable and technical metadata expandable without before/after content", async () => {
  render(wrap());
  await screen.findByText("Task updated");
  expect(screen.queryByText("task.updated")).toBeNull();
  fireEvent.click(screen.getByText("Task updated"));
  expect(screen.getByText("task.updated")).toBeVisible();
  expect(screen.getByText("request-id")).toBeVisible();
  expect(screen.getByText("task-id")).toBeVisible();
  expect(screen.queryByText(/hidden-before-secret|hidden-after-private|password/)).toBeNull();
  fireEvent.click(screen.getByText("Task updated"));
  expect(screen.queryByText("request-id")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Agents" }));
  expect(screen.queryByText("Task updated")).toBeNull();
  fireEvent.change(screen.getByLabelText("Search activity"), { target: { value: "unmatched" } });
  expect(screen.getByText("No matching events in this history.")).toBeVisible();
});
it("does not carry event detail or search text into another authenticated owner", async () => {
  const view = render(wrap());
  await screen.findByText("Task updated");
  fireEvent.click(screen.getByText("Task updated"));
  fireEvent.change(screen.getByLabelText("Search activity"), { target: { value: "task" } });
  h.owner = "other-owner";
  h.epoch = 2;
  h.list.mockResolvedValue([]);
  view.rerender(wrap());
  await screen.findByText("No matching events in this history.");
  expect(screen.getByLabelText("Search activity")).toHaveValue("");
  expect(screen.queryByText("request-id")).toBeNull();
  expect(screen.queryByText("Task updated")).toBeNull();
});
