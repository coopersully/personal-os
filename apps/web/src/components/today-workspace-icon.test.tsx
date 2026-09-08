// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import type { WeatherSnapshot } from "@personal-os/domain";
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TodayWorkspaceIcon, todayWeatherKind } from "./today-workspace-icon.js";

const weather: WeatherSnapshot = {
  alerts: [],
  condition: "Clear",
  location: {
    city: "New York",
    coordinates: { latitude: 40.7, longitude: -74 },
    country: "United States",
    label: "New York, New York, United States",
    mapUrl: "https://www.openstreetmap.org/",
    region: "New York",
    shortLabel: "NYC",
    source: "saved",
  },
  observedAt: "2026-08-31T16:00:00.000Z",
  temperatureF: 72,
  usAqi: 42,
};

describe("TodayWorkspaceIcon", () => {
  it("uses a neutral workspace frame with a condition-aware glyph", () => {
    const view = render(<TodayWorkspaceIcon timeZone="America/New_York" weather={weather} />);
    const frame = view.container.querySelector('[data-workspace="today"]');
    expect(frame).toHaveClass("workspace-icon");
    expect(frame).toHaveAttribute("data-weather", "clear-day");
  });

  it("distinguishes rain, clear nights, and unavailable conditions", () => {
    expect(
      todayWeatherKind(
        { ...weather, alerts: [{ kind: "rain", label: "Rain expected" }] },
        "America/New_York",
      ),
    ).toBe("rain");
    expect(
      todayWeatherKind({ ...weather, observedAt: "2026-08-31T06:00:00.000Z" }, "America/New_York"),
    ).toBe("clear-night");
    expect(todayWeatherKind(undefined, "America/New_York")).toBe("cloudy");
  });
});
