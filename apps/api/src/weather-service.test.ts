import { createWeatherService } from "./weather-service.js";

const now = new Date("2026-07-21T16:00:00.000Z");

function json(value: unknown, status = 200) {
  return Response.json(value, { status });
}

function weatherFetch(responses: Response[]) {
  return vi.fn(
    async (_input: RequestInfo | URL, _init?: RequestInit) => responses.shift() ?? json({}, 503),
  );
}

function reverseLocation() {
  return json({
    address: { city: "New York", country: "United States", state: "New York" },
  });
}

describe("weather service", () => {
  it("searches and deduplicates selectable saved weather locations", async () => {
    const fetch = weatherFetch([
      json({
        results: [
          {
            admin1: "New York",
            country: "United States",
            latitude: 40.7128,
            longitude: -74.006,
            name: "New York",
            timezone: "America/New_York",
          },
          {
            admin1: "New York",
            country: "United States",
            latitude: 40.7128,
            longitude: -74.006,
            name: "New York",
            timezone: "America/New_York",
          },
          {
            admin1: "North Yorkshire",
            country: "United Kingdom",
            latitude: 53.959,
            longitude: -1.0815,
            name: "York",
            timezone: "Europe/London",
          },
        ],
      }),
    ]);
    const weather = createWeatherService({ fetch, now: () => now });

    await expect(weather.searchLocations("New York")).resolves.toEqual([
      {
        coordinates: { latitude: 40.7128, longitude: -74.006 },
        label: "New York, New York, United States",
        timezone: "America/New_York",
      },
      {
        coordinates: { latitude: 53.959, longitude: -1.0815 },
        label: "York, North Yorkshire, United Kingdom",
        timezone: "Europe/London",
      },
    ]);
    expect(String(fetch.mock.calls[0]?.[0])).toContain("name=New+York");
    expect(String(fetch.mock.calls[0]?.[0])).toContain("count=8");
  });

  it("uses device coordinates without persisting them and surfaces current rain and air quality", async () => {
    const fetch = weatherFetch([
      reverseLocation(),
      json({
        current: {
          precipitation: 0.1,
          rain: 0,
          showers: 0,
          temperature_2m: 72.4,
          weather_code: 63,
        },
      }),
      json({ current: { us_aqi: 125 } }),
    ]);
    const weather = createWeatherService({ fetch, now: () => now });

    await expect(
      weather.current({ coordinates: { latitude: 40.7, longitude: -74 }, savedLocation: null }),
    ).resolves.toEqual({
      alerts: [
        { kind: "rain", label: "Rain now" },
        { kind: "air_quality", label: "Air quality: sensitive groups" },
      ],
      condition: "Rain",
      location: {
        city: "New York",
        coordinates: { latitude: 40.7, longitude: -74 },
        country: "United States",
        label: "New York, New York, United States",
        mapUrl: "https://www.openstreetmap.org/?mlat=40.7&mlon=-74#map=12/40.7/-74",
        region: "New York",
        shortLabel: "NYC",
        source: "device",
      },
      observedAt: now.toISOString(),
      temperatureF: 72.4,
      usAqi: 125,
    });
    const calls = fetch.mock.calls as Array<[RequestInfo | URL, RequestInit?]>;
    expect(String(calls[0]?.[0])).toContain("nominatim.openstreetmap.org/reverse");
    expect(String(calls[1]?.[0])).toContain("latitude=40.7");
    expect(String(calls[2]?.[0])).toContain("longitude=-74");
  });

  it("resolves the saved fallback location and keeps conditions available when air-quality data fails", async () => {
    const fetch = weatherFetch([
      json({ current: { temperature_2m: 80, weather_code: 0 } }),
      json({}, 503),
    ]);
    const weather = createWeatherService({ fetch, now: () => now });

    await expect(
      weather.current({
        savedLocation: {
          coordinates: { latitude: 40.7128, longitude: -74.006 },
          label: "New York, New York, United States",
        },
      }),
    ).resolves.toMatchObject({
      alerts: [],
      condition: "Clear",
      location: expect.objectContaining({
        city: "New York",
        country: "United States",
        label: "New York, New York, United States",
        region: "New York",
        shortLabel: "NYC",
        source: "saved",
      }),
      temperatureF: 80,
      usAqi: null,
    });
    const calls = fetch.mock.calls as Array<[RequestInfo | URL, RequestInit?]>;
    expect(String(calls[0]?.[0])).toContain("api.open-meteo.com/v1/forecast");
  });

  it("keeps forecast conditions available when the optional air-quality request fails to transport", async () => {
    const fetch = vi.fn((url: RequestInfo | URL) => {
      if (String(url).includes("air-quality-api.open-meteo.com")) {
        return Promise.reject(new TypeError("Network unavailable"));
      }
      return Promise.resolve(json({ current: { temperature_2m: 80, weather_code: 0 } }));
    });
    const weather = createWeatherService({ fetch, now: () => now });

    await expect(
      weather.current({
        savedLocation: {
          coordinates: { latitude: 40.7128, longitude: -74.006 },
          label: "New York, New York, United States",
        },
      }),
    ).resolves.toMatchObject({ condition: "Clear", temperatureF: 80, usAqi: null });
  });

  it("uses the unambiguous leading place name for legacy saved labels", async () => {
    const fetch = weatherFetch([
      json({
        results: [
          {
            admin1: "New York",
            country: "United States",
            latitude: 40.7128,
            longitude: -74.006,
            name: "New York",
          },
        ],
      }),
      json({ current: { temperature_2m: 70, weather_code: 0 } }),
      json({ current: { us_aqi: 42 } }),
    ]);

    await expect(
      createWeatherService({ fetch, now: () => now }).current({
        savedLocation: { label: "New York, New York, United States" },
      }),
    ).resolves.toMatchObject({ location: { source: "saved" } });
    expect(String(fetch.mock.calls[0]?.[0])).toContain("name=New+York");
  });

  it.each([
    [50, null],
    [100, null],
    [101, "Air quality: sensitive groups"],
    [151, "Air quality: unhealthy"],
    [201, "Air quality: very unhealthy"],
  ])("uses the expected AQI alert threshold for %i", async (usAqi, expectedAlert) => {
    const weather = createWeatherService({
      fetch: weatherFetch([
        reverseLocation(),
        json({ current: { showers: 0, temperature_2m: 70, weather_code: 2 } }),
        json({ current: { us_aqi: usAqi } }),
      ]),
      now: () => now,
    });

    const result = await weather.current({
      coordinates: { latitude: 40, longitude: -73 },
      savedLocation: null,
    });
    expect(
      result.alerts.filter((alert) => alert.kind === "air_quality").map((alert) => alert.label),
    ).toEqual(expectedAlert ? [expectedAlert] : []);
  });

  it("explains unavailable, unresolvable, and malformed provider states", async () => {
    const weather = createWeatherService({ fetch: weatherFetch([]), now: () => now });
    await expect(weather.current({ savedLocation: null })).rejects.toMatchObject({
      code: "invalid_request",
    });

    await expect(
      createWeatherService({
        fetch: weatherFetch([json({ results: [] })]),
        now: () => now,
      }).current({ savedLocation: { label: "Unknown" } }),
    ).rejects.toMatchObject({ code: "invalid_request" });

    await expect(
      createWeatherService({
        fetch: weatherFetch([json({}, 503)]),
        now: () => now,
      }).current({ savedLocation: { label: "New York" } }),
    ).rejects.toMatchObject({ code: "service_unavailable" });

    await expect(
      createWeatherService({
        fetch: vi.fn(async () => Promise.reject(new Error("Network unavailable"))),
        now: () => now,
      }).current({ savedLocation: { label: "New York" } }),
    ).rejects.toMatchObject({ code: "service_unavailable" });

    await expect(
      createWeatherService({
        fetch: weatherFetch([
          reverseLocation(),
          json({ current: { weather_code: 3 } }),
          json({ current: {} }),
        ]),
        now: () => now,
      }).current({ coordinates: { latitude: 40, longitude: -73 }, savedLocation: null }),
    ).rejects.toMatchObject({ code: "service_unavailable" });

    await expect(
      createWeatherService({
        fetch: vi.fn(async () => Promise.reject(new Error("Network unavailable"))),
        now: () => now,
      }).current({ coordinates: { latitude: 40, longitude: -73 }, savedLocation: null }),
    ).rejects.toMatchObject({ code: "service_unavailable" });
  });
});
