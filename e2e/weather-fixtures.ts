import type { WeatherSnapshot } from "@personal-os/domain";
import type { Page } from "@playwright/test";

// Match only the weather snapshot endpoint, including device-coordinate queries.
// Location searches and all other API requests retain their real behavior.
export const weatherSnapshotRoute = /\/v1\/weather(?:\?.*)?$/;

export const weatherSnapshot: WeatherSnapshot = {
  alerts: [],
  condition: "Clear",
  location: {
    city: "New York",
    coordinates: { latitude: 40.7, longitude: -74 },
    country: "United States",
    label: "New York, New York, United States",
    mapUrl: "https://www.openstreetmap.org/?mlat=40.7&mlon=-74#map=12/40.7/-74",
    region: "New York",
    shortLabel: "NYC",
    source: "saved",
  },
  observedAt: "2026-10-25T12:00:00.000Z",
  temperatureF: 72,
  usAqi: 25,
};

/** Isolate unrelated navigation from the external weather provider. */
export async function fixtureWeather(page: Page) {
  await page.route(weatherSnapshotRoute, (route) => {
    if (route.request().method() !== "GET") return route.continue();
    return route.fulfill({ json: { weather: weatherSnapshot } });
  });
}
