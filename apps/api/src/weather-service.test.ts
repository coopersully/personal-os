import { weatherSnapshotSchema } from "@personal-os/domain";
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
  const savedLocation = {
    coordinates: { latitude: 40.7128, longitude: -74.006 },
    label: "New York, New York, United States",
  };
  const seconds = (iso: string) => Date.parse(iso) / 1_000;

  async function atmosphericSnapshot(forecast: unknown, clock = now) {
    const fetch = weatherFetch([json(forecast), json({ current: {} })]);
    const result = await createWeatherService({ fetch, now: () => clock }).current({
      savedLocation,
    });
    return { fetch, result };
  }

  it("requests bounded atmospheric data and preserves the provider observation timestamp", async () => {
    const { fetch, result } = await atmosphericSnapshot({
      current: {
        temperature_2m: 70,
        weather_code: 63,
        cloud_cover: 82,
        wind_speed_10m: 12.5,
        is_day: 1,
        time: seconds("2026-07-21T15:45:00Z"),
      },
      daily: {
        time: ["2026-07-20T04:00:00Z", "2026-07-21T04:00:00Z", "2026-07-22T04:00:00Z"].map(seconds),
        sunrise: [null, seconds("2026-07-21T09:45:00Z"), null],
        sunset: [null, seconds("2026-07-22T00:20:00Z"), null],
      },
    });
    expect(result).toMatchObject({
      observedAt: now.toISOString(),
      atmosphere: {
        weatherCode: 63,
        cloudCoverPercent: 82,
        windSpeedKmh: 12.5,
        isDay: true,
        sunriseAt: "2026-07-21T09:45:00.000Z",
        sunsetAt: "2026-07-22T00:20:00.000Z",
        observedAt: "2026-07-21T15:45:00.000Z",
      },
    });
    expect(weatherSnapshotSchema.parse(result)).toEqual(result);
    const params = new URL(String(fetch.mock.calls[0]?.[0])).searchParams;
    expect(params.get("current")?.split(",")).toEqual([
      "temperature_2m",
      "precipitation",
      "rain",
      "showers",
      "weather_code",
      "cloud_cover",
      "wind_speed_10m",
      "is_day",
    ]);
    expect(Object.fromEntries(params)).toMatchObject({
      daily: "sunrise,sunset",
      timeformat: "unixtime",
      timezone: "auto",
      past_days: "1",
      forecast_days: "2",
      wind_speed_unit: "kmh",
    });
  });

  it.each([
    [
      "2026-07-22T01:00:00Z",
      ["2026-07-21T04:00:00Z", "2026-07-22T04:00:00Z"],
      "2026-07-21T10:00:00Z",
    ],
    [
      "2026-07-21T16:00:00Z",
      ["2026-07-21T15:00:00Z", "2026-07-22T15:00:00Z"],
      "2026-07-21T20:00:00Z",
    ],
    [
      "2026-11-01T18:00:00Z",
      ["2026-11-01T04:00:00Z", "2026-11-02T05:00:00Z"],
      "2026-11-01T11:00:00Z",
    ],
  ])("selects the provider local-day window at %s", async (clock, boundaries, sunrise) => {
    const { result } = await atmosphericSnapshot(
      {
        current: { temperature_2m: 70, weather_code: 0, time: seconds(clock) },
        daily: { time: boundaries.map(seconds), sunrise: [seconds(sunrise), null] },
      },
      new Date(clock),
    );
    expect(result).toMatchObject({
      atmosphere: { sunriseAt: new Date(sunrise).toISOString(), sunsetAt: null },
    });
  });

  it.each([
    undefined,
    null,
    "2026-07-21T16:00:00Z",
    -1,
    1.5,
    253402300800,
    1e100,
  ])("omits atmosphere for invalid provider observation time %s", async (time) => {
    const { result } = await atmosphericSnapshot({
      current: { temperature_2m: 70, weather_code: 0, time },
    });
    expect(result).not.toHaveProperty("atmosphere");
    expect(result.temperatureF).toBe(70);
  });

  it.each([
    0.5, 1e100,
  ])("omits atmosphere for a non-domain weather code %s", async (weather_code) => {
    const { result } = await atmosphericSnapshot({
      current: { temperature_2m: 70, weather_code, time: seconds(now.toISOString()) },
    });
    expect(result).not.toHaveProperty("atmosphere");
  });

  it("preserves polar night and unknown integer weather codes with missing solar data", async () => {
    const { result } = await atmosphericSnapshot({
      current: {
        temperature_2m: 20,
        weather_code: 999,
        time: seconds(now.toISOString()),
        is_day: 0,
      },
      daily: {
        time: [seconds("2026-07-21T00:00:00Z"), seconds("2026-07-22T00:00:00Z")],
        sunrise: [null],
        sunset: [null],
      },
    });
    expect(result).toMatchObject({
      condition: "Current conditions",
      atmosphere: {
        weatherCode: 999,
        cloudCoverPercent: null,
        windSpeedKmh: null,
        isDay: false,
        sunriseAt: null,
        sunsetAt: null,
        observedAt: now.toISOString(),
      },
    });
  });

  it.each([
    { cloud_cover: -1, wind_speed_10m: -1, is_day: 2 },
    { cloud_cover: 101, wind_speed_10m: "12", is_day: true },
    { cloud_cover: "82", wind_speed_10m: null, is_day: null },
  ])("degrades malformed optional current values independently: %j", async (fields) => {
    const { result } = await atmosphericSnapshot({
      current: { temperature_2m: 70, weather_code: 0, time: seconds(now.toISOString()), ...fields },
      daily: { time: "invalid", sunrise: {}, sunset: [1e100] },
    });
    expect(result).toMatchObject({
      atmosphere: {
        cloudCoverPercent: null,
        windSpeedKmh: null,
        isDay: null,
        sunriseAt: null,
        sunsetAt: null,
      },
    });
  });

  it("keeps valid optional fields when a solar event is malformed or outside the local day", async () => {
    const { result } = await atmosphericSnapshot({
      current: {
        temperature_2m: 70,
        weather_code: 0,
        time: seconds(now.toISOString()),
        cloud_cover: 0,
        wind_speed_10m: 0,
      },
      daily: {
        time: [seconds("2026-07-21T04:00:00Z"), seconds("2026-07-22T04:00:00Z")],
        sunrise: ["invalid"],
        sunset: [seconds("2026-07-23T00:20:00Z")],
      },
    });
    expect(result).toMatchObject({
      atmosphere: { cloudCoverPercent: 0, windSpeedKmh: 0, sunriseAt: null, sunsetAt: null },
    });
  });

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

  it("preserves sparse saved locations and labels unknown provider conditions", async () => {
    await expect(
      createWeatherService({
        fetch: weatherFetch([
          json({ current: { temperature_2m: 70, weather_code: 999 } }),
          json({ current: {} }),
        ]),
        now: () => now,
      }).current({
        savedLocation: {
          coordinates: { latitude: 1.23456, longitude: -2.34567 },
          label: " , , ",
        },
      }),
    ).resolves.toMatchObject({
      condition: "Current conditions",
      location: {
        city: null,
        country: null,
        label: "1.2346, -2.3457",
        region: null,
        shortLabel: "1.2346, -2.3457",
      },
    });

    const legacyFetch = weatherFetch([
      json({
        results: [{ latitude: 1, longitude: 2, name: "Somewhere" }],
      }),
      json({ current: { temperature_2m: 70, weather_code: 1 } }),
      json({ current: {} }),
    ]);
    await createWeatherService({ fetch: legacyFetch, now: () => now }).current({
      savedLocation: { label: ", Somewhere" },
    });
    expect(String(legacyFetch.mock.calls[0]?.[0])).toContain("name=%2C+Somewhere");
  });

  it("uses reverse-geocoder place fallbacks and tolerates a missing address", async () => {
    let clock = 10_000;
    vi.spyOn(Date, "now").mockImplementation(() => {
      clock += 1_001;
      return clock;
    });
    const fetch = weatherFetch([
      json({ address: { country: "One", state_district: "District", town: "Town" } }),
      json({ current: { temperature_2m: 70, weather_code: 1 } }),
      json({ current: {} }),
      json({ address: { county: "County", village: "Village" } }),
      json({ current: { temperature_2m: 70, weather_code: 1 } }),
      json({ current: {} }),
      json({ address: { municipality: "Municipality" } }),
      json({ current: { temperature_2m: 70, weather_code: 1 } }),
      json({ current: {} }),
      json({}),
      json({ current: { temperature_2m: 70, weather_code: 1 } }),
      json({ current: {} }),
    ]);
    const weather = createWeatherService({ fetch, now: () => now });

    await expect(
      weather.current({ coordinates: { latitude: 1, longitude: 1 }, savedLocation: null }),
    ).resolves.toMatchObject({
      location: { city: "Town", country: "One", region: "District" },
    });
    await expect(
      weather.current({ coordinates: { latitude: 2, longitude: 2 }, savedLocation: null }),
    ).resolves.toMatchObject({ location: { city: "Village", country: null, region: "County" } });
    await expect(
      weather.current({ coordinates: { latitude: 3, longitude: 3 }, savedLocation: null }),
    ).resolves.toMatchObject({ location: { city: "Municipality", country: null, region: null } });
    await expect(
      weather.current({ coordinates: { latitude: 4, longitude: 4 }, savedLocation: null }),
    ).resolves.toMatchObject({
      location: { city: null, country: null, label: "4.0000, 4.0000", region: null },
    });
    vi.restoreAllMocks();
  });

  it("explains location-search transport and provider failures", async () => {
    await expect(
      createWeatherService({
        fetch: vi.fn().mockRejectedValue(new Error("offline")),
        now: () => now,
      }).searchLocations("New York"),
    ).rejects.toMatchObject({ code: "service_unavailable" });
    await expect(
      createWeatherService({
        fetch: weatherFetch([json({}, 503)]),
        now: () => now,
      }).searchLocations("New York"),
    ).rejects.toMatchObject({ code: "service_unavailable" });
    await expect(
      createWeatherService({
        fetch: weatherFetch([json({})]),
        now: () => now,
      }).searchLocations("New York"),
    ).resolves.toEqual([]);
  });
});
