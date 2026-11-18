import type { WeatherSnapshot } from "@personal-os/domain";
import { todaySky } from "./sky-presentation";

export const skyPreviewNames = ["morning", "daytime", "night", "cloudy", "rainy"] as const;
/** Deterministic, visibly labeled simulator previews. Never enabled in a production build. */
export function skyPreview(name: string | undefined, development: boolean) {
  if (!development || !skyPreviewNames.some((value) => value === name)) return undefined;
  const hour = name === "morning" ? "06:30" : name === "night" ? "23:00" : "12:00";
  const now = Date.parse(`2026-11-09T${hour}:00Z`);
  const rainy = name === "rainy";
  const cloudy = rainy || name === "cloudy";
  const weather: WeatherSnapshot = {
    observedAt: new Date(now).toISOString(),
    temperatureF: rainy ? 52 : cloudy ? 58 : 66,
    condition: rainy ? "Rain" : cloudy ? "Overcast" : "Clear",
    alerts: [],
    usAqi: null,
    location: {
      coordinates: { latitude: 0, longitude: 0 },
      label: "Preview",
      shortLabel: "Preview",
      city: null,
      region: null,
      country: null,
      mapUrl: "https://example.com",
      source: "device",
    },
    atmosphere: {
      observedAt: new Date(now).toISOString(),
      weatherCode: rainy ? 63 : cloudy ? 3 : 0,
      cloudCoverPercent: cloudy ? 100 : 5,
      windSpeedKmh: rainy ? 25 : 8,
      sunriseAt: "2026-11-09T06:30:00Z",
      sunsetAt: "2026-11-09T18:00:00Z",
      isDay: name !== "night",
    },
  };
  return { sky: todaySky(now, "UTC", weather), label: `Preview · ${name} · ${weather.condition}` };
}
