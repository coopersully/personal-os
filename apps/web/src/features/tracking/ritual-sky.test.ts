import type { WeatherSnapshot } from "@personal-os/domain";
import { resolveRitualSky } from "./ritual-sky.js";

const now = Date.parse("2026-10-27T12:00:00Z");
function weather(code = 0): WeatherSnapshot {
  return {
    alerts: [],
    condition: "Clear",
    temperatureF: 60,
    usAqi: null,
    observedAt: new Date(now).toISOString(),
    location: {
      city: "New York",
      coordinates: { latitude: 40.7, longitude: -74 },
      country: "US",
      label: "New York",
      mapUrl: "https://example.com",
      region: "NY",
      shortLabel: "NYC",
      source: "saved",
    },
    atmosphere: {
      observedAt: new Date(now).toISOString(),
      weatherCode: code,
      cloudCoverPercent: 20,
      windSpeedKmh: 12,
      isDay: true,
      sunriseAt: "2026-10-27T11:20:00Z",
      sunsetAt: "2026-10-27T22:00:00Z",
    },
  };
}
const resolve = (snapshot?: WeatherSnapshot, instant = now, timeZone = "America/New_York") =>
  resolveRitualSky({ now: instant, timeZone, weather: snapshot });
it("uses actual sunrise and sunset with smooth colors and a visible dithered sun", () => {
  const dawn = resolve(weather());
  expect(dawn.phase).toBe("dawn");
  expect(dawn.celestial).toBe("sun");
  expect(dawn.source).toBe("weather");
  const before = resolve(weather(), now - 1000);
  expect(Math.abs(dawn.top[0] - before.top[0])).toBeLessThan(1);
  const sunset = weather();
  sunset.atmosphere!.observedAt = "2026-10-27T22:00:00Z";
  expect(resolve(sunset, Date.parse("2026-10-27T22:00:00Z")).phase).toBe("sunset");
});
it.each([
  [0, "clear"],
  [2, "cloudy"],
  [3, "overcast"],
  [45, "fog"],
  [63, "rain"],
  [75, "snow"],
  [95, "storm"],
])("maps WMO %s to %s without guessing from translated labels", (code, condition) => {
  expect(resolve(weather(Number(code))).condition).toBe(condition);
});
it("ignores stale and future provider observations and uses the ritual timezone", () => {
  const stale = weather(63);
  stale.atmosphere!.observedAt = "2026-10-26T12:00:00Z";
  expect(resolve(stale).source).toBe("time");
  expect(resolve(stale).condition).toBe("clear");
  expect(resolve(undefined, now, "Asia/Tokyo").celestial).toBe("moon");
  expect(resolve(undefined, now, "UTC").celestial).toBe("sun");
  stale.atmosphere!.observedAt = "2026-10-28T12:00:00Z";
  expect(resolve(stale).source).toBe("time");
});
it("handles polar day/night without inventing sunrise and tolerates an invalid timezone", () => {
  const polar = weather();
  polar.atmosphere!.sunriseAt = null;
  polar.atmosphere!.sunsetAt = null;
  expect(resolve(polar).phase).toBe("day");
  polar.atmosphere!.isDay = false;
  expect(resolve(polar).phase).toBe("night");
  expect(resolve(undefined, now, "invalid").phase).toBe("day");
});
it("keeps unknown conditions neutral and bounds cloud/wind visual intensity", () => {
  const unknown = weather(999);
  unknown.atmosphere!.cloudCoverPercent = null;
  unknown.atmosphere!.windSpeedKmh = null;
  expect(resolve(unknown).condition).toBe("clear");
  expect(resolve(unknown).wind).toBeGreaterThan(0);
});

it("keeps light chrome through dark predawn and evaluates each end of the sky separately", () => {
  const snapshot = weather();
  const predawn = Date.parse("2026-10-27T09:51:00Z");
  snapshot.atmosphere!.observedAt = new Date(predawn).toISOString();
  const sky = resolve(snapshot, predawn);
  expect(sky.phase).toBe("dawn");
  expect(sky.dark).toBe(true);
  expect(sky.topDark).toBe(true);
  expect(sky.bottomDark).toBe(true);
  snapshot.atmosphere!.observedAt = "2026-10-27T22:00:00Z";
  const dusk = resolve(snapshot, Date.parse("2026-10-27T22:00:00Z"));
  expect(dusk.topDark).toBe(true);
  expect(dusk.bottomDark).toBe(false);
});
