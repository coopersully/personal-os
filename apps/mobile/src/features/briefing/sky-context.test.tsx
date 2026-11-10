// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TodaySkyProvider, useTodaySky } from "./sky-context";

vi.mock("react", async () => {
  const { createRequire } = await import("node:module");
  return createRequire(`${process.cwd()}/package.json`)("react");
});
const h = vi.hoisted(() => ({
  owner: "a" as string | undefined,
  appState: "active",
  remove: vi.fn(),
  location: vi.fn(),
  weather: vi.fn(),
  listener: undefined as undefined | ((value: string) => void),
  error: vi.fn(),
  success: vi.fn(),
  loading: vi.fn(),
  dismiss: vi.fn(),
}));
vi.mock("react-native", () => ({
  AppState: {
    get currentState() {
      return h.appState;
    },
    addEventListener: (_name: string, callback: (value: string) => void) => {
      h.listener = callback;
      return { remove: h.remove };
    },
  },
}));
vi.mock("../auth/context", () => ({
  useAuth: () => ({
    state: { user: { id: h.owner } },
    session: { api: () => ({ getWeather: h.weather }) },
  }),
}));
vi.mock("./sky-location", () => ({ readSkyLocation: h.location }));
vi.mock("sonner-native", () => ({ toast: h }));
function Consumer() {
  const sky = useTodaySky();
  return (
    <>
      <span>{sky.label}</span>
      <span>{sky.busy ? "Busy" : "Ready"}</span>
      <button type="button" onClick={() => void sky.refresh()}>
        Refresh sky
      </button>
      <button type="button" onClick={() => void sky.requestLocation()}>
        Use location
      </button>
    </>
  );
}
function App() {
  return (
    <TodaySkyProvider enabled>
      <Consumer />
    </TodaySkyProvider>
  );
}
function snapshot(city: string) {
  return {
    temperatureF: 55,
    condition: "Cloudy",
    location: { shortLabel: city },
    atmosphere: {
      observedAt: new Date().toISOString(),
      weatherCode: 2,
      cloudCoverPercent: 50,
      isDay: true,
    },
  };
}
beforeEach(() => {
  vi.clearAllMocks();
  h.owner = "a";
  h.appState = "active";
  h.location.mockResolvedValue({ granted: false });
  h.weather.mockResolvedValue(snapshot("Saved city"));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
it("reads saved-location weather without requesting permission", async () => {
  render(<App />);
  expect(await screen.findByText("Saved city · 55° · Cloudy")).toBeTruthy();
  expect(h.location).toHaveBeenCalledWith(false, expect.any(AbortSignal));
  expect(h.weather).toHaveBeenCalledWith(undefined);
  expect(h.loading).not.toHaveBeenCalled();
});
it("allows explicit device consent through OS inactive/active and reports the actual result via Sonner", async () => {
  render(<App />);
  await screen.findByText("Saved city · 55° · Cloudy");
  h.location.mockImplementation(async (request) => {
    if (request) {
      h.listener?.("inactive");
      h.listener?.("active");
    }
    return { granted: true, coordinates: { latitude: 40.7, longitude: -74 } };
  });
  h.weather.mockResolvedValue(snapshot("Current city"));
  fireEvent.click(screen.getByText("Use location"));
  await screen.findByText("Current city · 55° · Cloudy");
  expect(h.weather).toHaveBeenLastCalledWith({ latitude: 40.7, longitude: -74 });
  expect(h.success).toHaveBeenCalledWith("Local weather updated", { id: "today-weather-a" });
  expect(screen.queryByText("Local weather updated")).toBeNull();
});
it("keeps the time-based sky when weather is unavailable and toasts explicit retry failures", async () => {
  h.weather.mockRejectedValue(new Error("offline"));
  render(<App />);
  await waitFor(() => expect(h.weather).toHaveBeenCalledOnce());
  expect(screen.getByText("Time-based sky")).toBeTruthy();
  fireEvent.click(screen.getByText("Use location"));
  await waitFor(() => expect(h.error).toHaveBeenCalled());
  expect(screen.queryByText(/Local weather is unavailable/)).toBeNull();
});
it("never displays a previous owner's late weather response", async () => {
  let resolve!: (value: unknown) => void;
  h.weather.mockReturnValueOnce(
    new Promise((done) => {
      resolve = done;
    }),
  );
  const view = render(<App />);
  await waitFor(() => expect(h.weather).toHaveBeenCalledOnce());
  h.owner = "b";
  h.weather.mockResolvedValue(snapshot("New owner city"));
  view.rerender(<App />);
  await screen.findByText("New owner city · 55° · Cloudy");
  await act(async () => resolve(snapshot("Old owner city")));
  expect(screen.queryByText(/Old owner/)).toBeNull();
});
it("stops applying pending reads after backgrounding", async () => {
  let resolve!: (value: unknown) => void;
  h.weather.mockReturnValueOnce(
    new Promise((done) => {
      resolve = done;
    }),
  );
  render(<App />);
  await waitFor(() => expect(h.weather).toHaveBeenCalledOnce());
  act(() => h.listener?.("background"));
  await act(async () => resolve(snapshot("Late city")));
  expect(screen.queryByText(/Late city/)).toBeNull();
});

it("falls back to saved weather after a denied or failing device location request", async () => {
  h.location.mockRejectedValue(new Error("location service unavailable"));
  render(<App />);
  await screen.findByText("Saved city · 55° · Cloudy");
  fireEvent.click(screen.getByText("Use location"));
  await waitFor(() =>
    expect(h.success).toHaveBeenCalledWith("Using saved-location weather", {
      id: "today-weather-a",
    }),
  );
  expect(h.weather).toHaveBeenLastCalledWith(undefined);
  expect(screen.queryByText("Using saved-location weather")).toBeNull();
});
it("bounds slow weather reads and never lets a late provider result replace the fallback", async () => {
  vi.useFakeTimers();
  let finish!: (value: unknown) => void;
  h.weather.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  render(<App />);
  await act(async () => {});
  expect(screen.getByText("Busy")).toBeVisible();
  fireEvent.click(screen.getByText("Refresh sky"));
  expect(h.weather).toHaveBeenCalledOnce();
  await act(async () => vi.advanceTimersByTimeAsync(12_001));
  expect(screen.getByText("Ready")).toBeVisible();
  expect(screen.getByText("Time-based sky")).toBeVisible();
  await act(async () => finish(snapshot("Too late")));
  expect(screen.queryByText(/Too late/)).toBeNull();
  expect(h.error).not.toHaveBeenCalled();
});
it("aborts a pending explicit location request and dismisses its toast on workspace exit", async () => {
  render(<App />);
  await screen.findByText("Saved city · 55° · Cloudy");
  let finish!: (value: unknown) => void;
  let signal!: AbortSignal;
  h.location.mockImplementation((_request, value) => {
    signal = value;
    return new Promise((resolve) => {
      finish = resolve;
    });
  });
  fireEvent.click(screen.getByText("Use location"));
  expect(signal.aborted).toBe(false);
  cleanup();
  expect(signal.aborted).toBe(true);
  await act(async () => finish({ granted: false }));
  expect(h.success).not.toHaveBeenCalled();
  expect(h.dismiss).toHaveBeenCalledWith("today-weather-a");
  expect(h.remove).toHaveBeenCalledOnce();
});
it("refreshes active weather on its cadence and foregrounding, but suspends background and disabled reads", async () => {
  vi.useFakeTimers();
  const view = render(<App />);
  await act(async () => {});
  expect(h.weather).toHaveBeenCalledOnce();
  await act(async () => vi.advanceTimersByTimeAsync(600_000));
  expect(h.weather).toHaveBeenCalledTimes(2);
  h.appState = "background";
  act(() => h.listener?.("background"));
  fireEvent.click(screen.getByText("Refresh sky"));
  await act(async () => vi.advanceTimersByTimeAsync(600_000));
  expect(h.weather).toHaveBeenCalledTimes(2);
  h.appState = "active";
  await act(async () => h.listener?.("active"));
  expect(h.weather).toHaveBeenCalledTimes(3);
  view.rerender(
    <TodaySkyProvider enabled={false}>
      <Consumer />
    </TodaySkyProvider>,
  );
  fireEvent.click(screen.getByText("Refresh sky"));
  await act(async () => vi.advanceTimersByTimeAsync(600_000));
  expect(h.weather).toHaveBeenCalledTimes(3);
  expect(h.remove).toHaveBeenCalledOnce();
});
it("does not access weather before authentication and ignores preview overrides in a production build", async () => {
  h.owner = undefined;
  vi.stubGlobal("__DEV__", false);
  render(
    <TodaySkyProvider enabled preview="rain">
      <Consumer />
    </TodaySkyProvider>,
  );
  fireEvent.click(screen.getByText("Use location"));
  expect(h.location).not.toHaveBeenCalled();
  expect(h.weather).not.toHaveBeenCalled();
  expect(screen.getByText("Time-based sky")).toBeVisible();
});

it("labels intentional development sky previews instead of presenting them as live weather", async () => {
  vi.stubGlobal("__DEV__", true);
  render(
    <TodaySkyProvider enabled preview="rainy">
      <Consumer />
    </TodaySkyProvider>,
  );
  expect(screen.getByText("Preview · rainy · Rain")).toBeVisible();
  await waitFor(() => expect(h.weather).toHaveBeenCalledOnce());
  expect(screen.getByText("Preview · rainy · Rain")).toBeVisible();
});

it("dismisses an explicit request that fails after backgrounding without showing an obsolete error", async () => {
  render(<App />);
  await screen.findByText("Saved city · 55° · Cloudy");
  let fail!: (error: Error) => void;
  h.weather.mockReturnValue(
    new Promise((_resolve, reject) => {
      fail = reject;
    }),
  );
  fireEvent.click(screen.getByText("Use location"));
  await waitFor(() => expect(h.weather).toHaveBeenCalledTimes(2));
  act(() => h.listener?.("background"));
  await act(async () => fail(new Error("late network error")));
  expect(h.error).not.toHaveBeenCalled();
  expect(h.dismiss).toHaveBeenCalledWith("today-weather-a");
});
