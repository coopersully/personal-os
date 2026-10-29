// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { toast } from "sonner";
import { renderWithFeedback as render } from "@/test-utils/feedback";
import { FinanceConfigurationEditor } from "./configuration-editor";

const mocks = vi.hoisted(() => ({ query: vi.fn(), retry: vi.fn() }));
vi.mock("./use-finance-configuration.js", () => ({ useFinanceConfiguration: mocks.query }));
vi.mock("./configuration-income.js", () => ({ FinanceIncomeEditor: () => <p>Saved income</p> }));

beforeEach(() => {
  vi.useFakeTimers();
  mocks.query.mockReset();
  mocks.retry.mockReset();
});

async function publishFeedback() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
}

async function disposeFeedback() {
  act(() => {
    for (const entry of toast.getToasts()) toast.dismiss(entry.id);
    cleanup();
  });
  // Unmount cancels normal duration timers, but Sonner's queued removal callback still runs.
  // Execute that work while jsdom exists instead of discarding it or leaking it into teardown.
  await act(async () => {
    await vi.runAllTimersAsync();
  });
  expect(toast.getToasts()).toHaveLength(0);
  expect(vi.getTimerCount()).toBe(0);
}

afterEach(async () => {
  try {
    await disposeFeedback();
  } finally {
    vi.restoreAllMocks();
    vi.useRealTimers();
  }
});

it("keeps a failed profile read out of the settings layout with a retry action", async () => {
  mocks.query.mockReturnValue({
    isError: true,
    isSuccess: false,
    isFetching: false,
    error: new Error("private diagnostic"),
    refetch: mocks.retry,
  });
  render(<FinanceConfigurationEditor />);
  await publishFeedback();
  const notice = screen.getByText("Financial settings could not load.");
  expect(notice.closest("[data-sonner-toast]")).not.toBeNull();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(screen.getByText("Saved income")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(mocks.retry).toHaveBeenCalledOnce();
  toast.dismiss();
});

it("guides recovery of an unavailable profile response in a dialog", async () => {
  mocks.retry.mockResolvedValue({ isError: false, data: { profile: { state: "unavailable" } } });
  mocks.query.mockReturnValue({
    isError: false,
    isSuccess: true,
    isFetching: false,
    data: { profile: { state: "unavailable" } },
    refetch: mocks.retry,
  });
  const view = render(<FinanceConfigurationEditor />);
  await publishFeedback();
  const recovery = screen.getByRole("dialog", { name: "Financial settings could not load" });
  expect(view.container).not.toContainElement(recovery);
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  });
  await publishFeedback();
  expect(mocks.retry).toHaveBeenCalled();
  const outcome = screen.getByText("Financial settings could not load. Try again.");
  expect(outcome.closest("[data-sonner-toast]")).not.toBeNull();
  expect(recovery).toBeInTheDocument();
});

it("settles a dismissed toast after unmount without leaking feedback into a fresh render", async () => {
  const timers = vi.spyOn(globalThis, "setTimeout");
  const view = render(<p>Original editor</p>);
  act(() => {
    toast.error("Original feedback", { id: "configuration-cleanup", duration: Infinity });
  });
  await publishFeedback();
  expect(screen.getByText("Original feedback").closest("[data-sonner-toast]")).not.toBeNull();

  act(() => {
    toast.dismiss("configuration-cleanup");
  });
  // Dismissal crosses two animation frames before queuing the 200ms exit callback.
  await act(async () => {
    await vi.advanceTimersByTimeAsync(32);
  });
  expect(timers).toHaveBeenCalledWith(expect.any(Function), 200);
  expect(vi.getTimerCount()).toBeGreaterThan(0);
  view.unmount();
  await disposeFeedback();

  render(<p>Fresh editor</p>);
  expect(screen.queryByText("Original feedback")).not.toBeInTheDocument();
  act(() => {
    toast.error("Fresh feedback", { id: "configuration-fresh", duration: Infinity });
  });
  await publishFeedback();
  expect(screen.getByText("Fresh feedback").closest("[data-sonner-toast]")).not.toBeNull();
});
