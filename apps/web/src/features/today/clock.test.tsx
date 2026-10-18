// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import { useTodayClock } from "./clock";

afterEach(() => vi.useRealTimers());
it("crosses planning-zone midnight and refreshes when the window regains focus", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-13T03:59:55Z"));
  const cache = new QueryClient();
  const invalidate = vi.spyOn(cache, "invalidateQueries");
  const view = renderHook(() => useTodayClock("America/New_York"), {
    wrapper: ({ children }) => <QueryClientProvider client={cache}>{children}</QueryClientProvider>,
  });
  act(() => vi.advanceTimersByTime(30000));
  expect(view.result.current.toISOString()).toBe("2026-10-13T04:00:25.000Z");
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ["daily-brief"] });
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ["today-commitments"] });
  invalidate.mockClear();
  act(() => window.dispatchEvent(new Event("focus")));
  expect(invalidate).toHaveBeenCalledTimes(2);
  view.unmount();
  invalidate.mockClear();
  act(() => {
    vi.advanceTimersByTime(30000);
    window.dispatchEvent(new Event("focus"));
  });
  expect(invalidate).not.toHaveBeenCalled();
});
