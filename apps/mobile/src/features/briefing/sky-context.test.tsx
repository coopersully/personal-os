// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TodaySkyProvider, useTodaySky } from "./sky-context";

vi.mock("react", async () => {
  const { createRequire } = await import("node:module");
  return createRequire(`${process.cwd()}/package.json`)("react");
});
const h = vi.hoisted(() => ({
  owner: "a",
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
    currentState: "active",
    addEventListener: (_name: string, callback: (value: string) => void) => {
      h.listener = callback;
      return { remove: vi.fn() };
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
  h.location.mockResolvedValue({ granted: false });
  h.weather.mockResolvedValue(snapshot("Saved city"));
});
afterEach(cleanup);
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
