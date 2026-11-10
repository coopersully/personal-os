// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useTodayData } from "./live-data";

vi.mock("react", async () => {
  const { createRequire } = await import("node:module");
  return createRequire(`${process.cwd()}/package.json`)("react");
});
vi.mock("@tanstack/react-query", async () => {
  const { createRequire } = await import("node:module");
  return createRequire(`${process.cwd()}/apps/web/package.json`)("@tanstack/react-query");
});
const h = vi.hoisted(() => ({
  timezone: "UTC" as string | undefined,
  read: vi.fn(),
  error: vi.fn(),
  success: vi.fn(),
  loading: vi.fn(() => "refresh"),
  dismiss: vi.fn(),
  remove: vi.fn(),
  listener: undefined as undefined | ((state: string) => void),
}));
vi.mock("expo-router", async () => {
  const { useEffect } = await import("react");
  return {
    useFocusEffect: (callback: () => undefined | (() => void)) => useEffect(callback, [callback]),
  };
});
vi.mock("react-native", () => ({
  AppState: {
    addEventListener: (_event: string, listener: (state: string) => void) => {
      h.listener = listener;
      return { remove: h.remove };
    },
  },
}));
vi.mock("sonner-native", () => ({ toast: h }));
vi.mock("../auth/context", () => ({
  useAuth: () => ({
    state: { user: { id: "owner", planningTimezone: h.timezone } },
    session: {
      api: () => ({
        listTaskWorkspace: h.read,
        getFinanceReviewQueue: h.read,
        getFinanceBudgetStatus: h.read,
        listFinanceRecurringOccurrences: h.read,
        listFinanceActivity: h.read,
      }),
    },
  }),
}));
function Consumer() {
  const data = useTodayData();
  return (
    <>
      <span>{data.loading ? "Loading" : "Loaded"}</span>
      <button type="button" onClick={() => void data.refresh()}>
        Refresh
      </button>
    </>
  );
}
const clients: QueryClient[] = [];
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(client);
  return render(
    <QueryClientProvider client={client}>
      <Consumer />
    </QueryClientProvider>,
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  h.timezone = "UTC";
  h.read.mockReset().mockResolvedValue({});
});
afterEach(() => {
  cleanup();
  for (const client of clients.splice(0)) client.clear();
});
it("updates one refresh toast, leaves results mounted and retries partial errors through Sonner", async () => {
  mount();
  await screen.findByText("Loaded");
  fireEvent.click(screen.getByText("Refresh"));
  await waitFor(() => expect(h.success).toHaveBeenCalledWith("Today refreshed", { id: "refresh" }));
  expect(screen.queryByText("Today refreshed")).toBeNull();
  h.read.mockRejectedValue(new Error("offline"));
  fireEvent.click(screen.getByText("Refresh"));
  await waitFor(() =>
    expect(h.error).toHaveBeenCalledWith(expect.stringContaining("Try again"), { id: "refresh" }),
  );
  await waitFor(() =>
    expect(h.error).toHaveBeenCalledWith(
      "Some of Today couldn’t refresh.",
      expect.objectContaining({
        id: "today-read-owner",
        action: expect.objectContaining({ label: "Retry" }),
      }),
    ),
  );
  const call = h.error.mock.calls.find(
    ([message]) => message === "Some of Today couldn’t refresh.",
  );
  const options = call?.[1] as { action: { onClick: () => void } };
  h.read.mockResolvedValue({});
  h.success.mockClear();
  act(() => options.action.onClick());
  await waitFor(() => expect(h.success).toHaveBeenCalledWith("Today refreshed", { id: "refresh" }));
  expect(screen.getByText("Loaded")).toBeVisible();
  expect(screen.queryByText(/couldn’t refresh/)).toBeNull();
});
it("refreshes on foreground, releases its listener, and does not query without a planning timezone", async () => {
  const view = mount();
  await screen.findByText("Loaded");
  h.read.mockClear();
  act(() => h.listener?.("inactive"));
  expect(h.read).not.toHaveBeenCalled();
  await act(async () => h.listener?.("active"));
  expect(h.read).toHaveBeenCalledTimes(7);
  view.unmount();
  expect(h.remove).toHaveBeenCalledOnce();
  h.read.mockClear();
  h.timezone = undefined;
  mount();
  expect(h.read).not.toHaveBeenCalled();
});
