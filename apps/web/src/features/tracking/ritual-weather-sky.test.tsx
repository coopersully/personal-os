// @vitest-environment jsdom
import { cleanup, render, waitFor } from "@testing-library/react";
import { RitualWeatherSky } from "./ritual-weather-sky.js";

const mocks = vi.hoisted(() => ({ weather: vi.fn() }));
vi.mock("../../api.js", () => ({ api: { getWeather: mocks.weather } }));
vi.mock("./ritual-clouds.js", () => ({ RitualClouds: () => null }));
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("CanvasRenderingContext2D", undefined);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it("keeps an unavailable weather read decorative and never prompts for location", async () => {
  const locate = vi.fn();
  Object.defineProperty(navigator, "geolocation", {
    configurable: true,
    value: { getCurrentPosition: locate },
  });
  Object.defineProperty(navigator, "permissions", {
    configurable: true,
    value: { query: vi.fn().mockResolvedValue({ state: "prompt" }) },
  });
  mocks.weather.mockRejectedValue(new Error("offline"));
  const view = render(<RitualWeatherSky kind="morning" timeZone="America/New_York" />);
  await waitFor(() => expect(mocks.weather).toHaveBeenCalledOnce());
  expect(locate).not.toHaveBeenCalled();
  expect(view.container.firstElementChild).toHaveAttribute("data-sky-source", "time");
  expect(view.queryByRole("alert")).not.toBeInTheDocument();
});
it("uses already-granted coordinates without persisting or requesting permission", async () => {
  const locate = vi.fn((done: PositionCallback) =>
    done({ coords: { latitude: 40.7, longitude: -74 } } as GeolocationPosition),
  );
  Object.defineProperty(navigator, "geolocation", {
    configurable: true,
    value: { getCurrentPosition: locate },
  });
  Object.defineProperty(navigator, "permissions", {
    configurable: true,
    value: { query: vi.fn().mockResolvedValue({ state: "granted" }) },
  });
  mocks.weather.mockRejectedValue(new Error("offline"));
  render(<RitualWeatherSky kind="morning" />);
  await waitFor(() =>
    expect(mocks.weather).toHaveBeenCalledWith({ latitude: 40.7, longitude: -74 }),
  );
});
it("keeps settings thumbnails local without weather or location work", () => {
  const view = render(<RitualWeatherSky kind="night" thumbnail />);
  expect(mocks.weather).not.toHaveBeenCalled();
  expect(view.container.firstElementChild).toHaveAttribute("data-sky-phase", "night");
});
