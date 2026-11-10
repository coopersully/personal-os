import type { WeatherSnapshot } from "@personal-os/domain";
import { describe, expect, it } from "vitest";
import { todaySky } from "./sky-presentation";

const now = Date.parse("2026-11-09T21:50:00Z");
function weather(code = 2): WeatherSnapshot {
  return {
    observedAt: new Date(now).toISOString(),
    temperatureF: 55,
    condition: "Cloudy",
    alerts: [],
    usAqi: null,
    location: {
      coordinates: { latitude: 40.7, longitude: -74 },
      label: "New York",
      shortLabel: "New York",
      city: "New York",
      region: "NY",
      country: "US",
      mapUrl: "https://example.com",
      source: "device",
    },
    atmosphere: {
      observedAt: new Date(now).toISOString(),
      weatherCode: code,
      cloudCoverPercent: 70,
      windSpeedKmh: 10,
      sunriseAt: "2026-11-09T11:35:00Z",
      sunsetAt: "2026-11-09T21:45:00Z",
      isDay: false,
    },
  };
}
describe("Today atmospheric wash", () => {
  it("uses local solar timing, with independent page theme and weather-tinted haze", () => {
    const dusk = todaySky(now, "America/New_York", weather());
    expect(dusk.phase).toBe("sunset");
    expect(dusk.source).toBe("weather");
    const rain = todaySky(now, "America/New_York", weather(63));
    expect(rain.topColor).not.toBe(dusk.topColor);
    expect(rain.condition).toBe("rain");
    expect(rain.hazeOpacity).toBeGreaterThan(0.1);
  });
  it("changes dawn/day/dusk/night and ignores stale observations", () => {
    expect(todaySky(Date.parse("2026-11-09T06:00:00Z"), "UTC").phase).toBe("dawn");
    expect(todaySky(Date.parse("2026-11-09T12:00:00Z"), "UTC").phase).toBe("day");
    expect(todaySky(Date.parse("2026-11-09T18:00:00Z"), "UTC").phase).toBe("sunset");
    expect(todaySky(Date.parse("2026-11-09T22:00:00Z"), "UTC").phase).toBe("night");
    const stale = todaySky(now + 31 * 60_000, "America/New_York", weather(63));
    expect(stale.source).toBe("time");
    expect(stale.condition).toBe("clear");
    expect(stale.hazeOpacity).toBe(0.1);
  });
});

it("keeps nighttime rain and storms dark with readable foregrounds instead of the daytime pastel wash", () => {
  const at = Date.parse("2026-11-10T02:00:00Z");
  const rainy = weather(63);
  if (!rainy.atmosphere) throw new Error("Weather fixture requires atmosphere");
  rainy.atmosphere = { ...rainy.atmosphere, observedAt: new Date(at).toISOString() };
  const stormy = { ...rainy, atmosphere: { ...rainy.atmosphere, weatherCode: 95 } };
  for (const observation of [rainy, stormy]) {
    const sky = todaySky(at, "UTC", observation);
    expect(sky.phase).toBe("night");
    expect(sky.source).toBe("weather");
    expect(sky.ink).toBe("#f8f8fc");
    expect(sky.secondary).toBe("#d0d6e8");
    expect(sky.chromeDark).toBe(true);
  }
  expect(todaySky(at, "UTC", stormy).condition).toBe("storm");
});
