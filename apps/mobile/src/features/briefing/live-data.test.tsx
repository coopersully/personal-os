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
  owner: "owner",
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
  useOptionalAuth: () => null,
  useAuth: () => ({
    state: { user: { id: h.owner, planningTimezone: h.timezone } },
    session: {
      api: () => ({
        listTaskWorkspace: h.read,
        getFinanceAttention: h.read,
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
  h.owner = "owner";
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
  await waitFor(() =>
    expect(h.success).toHaveBeenCalledWith("Today refreshed", { id: "today-read-owner" }),
  );
  expect(screen.queryByText("Today refreshed")).toBeNull();
  h.read.mockRejectedValue(new Error("offline"));
  fireEvent.click(screen.getByText("Refresh"));
  await waitFor(() =>
    expect(h.error).toHaveBeenCalledWith(expect.stringContaining("Try again"), {
      id: "today-read-owner",
      action: { label: "Retry", onClick: expect.any(Function) },
    }),
  );
  expect(h.error).toHaveBeenCalledOnce();
  expect(h.loading).toHaveBeenLastCalledWith("Refreshing Today…", { id: "today-read-owner" });
  const options = h.error.mock.calls[0]?.[1] as { action: { onClick: () => void } };
  h.read.mockResolvedValue({});
  h.success.mockClear();
  h.dismiss.mockClear();
  act(() => options.action.onClick());
  await waitFor(() =>
    expect(h.success).toHaveBeenCalledWith("Today refreshed", { id: "today-read-owner" }),
  );
  expect(screen.getByText("Loaded")).toBeVisible();
  expect(h.dismiss).not.toHaveBeenCalled();
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

it("keeps one retryable background-read notice and replaces it through manual recovery", async () => {
  h.read.mockRejectedValue(new Error("offline"));
  mount();
  await screen.findByText("Loaded");
  await waitFor(() =>
    expect(h.error).toHaveBeenCalledWith("Some of Today couldn’t refresh.", {
      id: "today-read-owner",
      action: { label: "Retry", onClick: expect.any(Function) },
    }),
  );
  expect(h.error).toHaveBeenCalledOnce();
  const options = h.error.mock.calls[0]?.[1] as { action: { onClick: () => void } };
  h.read.mockResolvedValue({});
  act(() => options.action.onClick());
  await waitFor(() =>
    expect(h.success).toHaveBeenCalledWith("Today refreshed", { id: "today-read-owner" }),
  );
  expect(h.loading).toHaveBeenCalledWith("Refreshing Today…", { id: "today-read-owner" });
  expect(h.error).toHaveBeenCalledOnce();
  expect(screen.queryByText(/couldn’t refresh/)).toBeNull();
});
it("clears a background failure after foreground recovery without announcing background success", async () => {
  h.read.mockRejectedValue(new Error("offline"));
  mount();
  await screen.findByText("Loaded");
  await waitFor(() => expect(h.error).toHaveBeenCalledOnce());
  h.dismiss.mockClear();
  h.read.mockResolvedValue({});
  await act(async () => h.listener?.("active"));
  await waitFor(() => expect(h.dismiss).toHaveBeenCalledWith("today-read-owner"));
  expect(h.success).not.toHaveBeenCalled();
  expect(h.loading).not.toHaveBeenCalled();
});

it.each([
  "owner change",
  "unmount",
])("does not announce an obsolete manual refresh after %s", async (transition) => {
  const view = mount();
  await screen.findByText("Loaded");
  let finish!: (value: object) => void;
  h.read.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  fireEvent.click(screen.getByText("Refresh"));
  expect(h.loading).toHaveBeenCalledWith("Refreshing Today…", { id: "today-read-owner" });
  if (transition === "owner change") {
    h.owner = "new-owner";
    h.read.mockResolvedValue({});
    const client = clients[0];
    if (!client) throw new Error("Query client missing");
    view.rerender(
      <QueryClientProvider client={client}>
        <Consumer />
      </QueryClientProvider>,
    );
    await screen.findByText("Loaded");
  } else view.unmount();
  expect(h.dismiss).toHaveBeenCalledWith("today-read-owner");
  h.success.mockClear();
  h.error.mockClear();
  await act(async () => finish({}));
  expect(h.success).not.toHaveBeenCalled();
  expect(h.error).not.toHaveBeenCalled();
  if (transition === "owner change") {
    fireEvent.click(screen.getByText("Refresh"));
    await waitFor(() =>
      expect(h.success).toHaveBeenCalledWith("Today refreshed", { id: "today-read-new-owner" }),
    );
  }
});
