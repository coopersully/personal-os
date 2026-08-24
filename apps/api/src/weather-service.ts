import { providerFetch } from "@personal-os/connectors";
import type {
  HomeLocation,
  WeatherCoordinates,
  WeatherLocationDetails,
  WeatherLocationOption,
  WeatherSnapshot,
} from "@personal-os/domain";
import { AppError } from "./errors.js";

type WeatherServiceOptions = {
  fetch?: typeof globalThis.fetch;
  now: () => Date;
};

type ForecastResponse = {
  current?: {
    precipitation?: number;
    rain?: number;
    showers?: number;
    temperature_2m?: number;
    weather_code?: number;
  };
};

type AirQualityResponse = {
  current?: { us_aqi?: number };
};

type GeocodingResponse = {
  results?: Array<{
    admin1?: string;
    country?: string;
    latitude: number;
    longitude: number;
    name: string;
    timezone?: string;
  }>;
};

type ReverseGeocodingResponse = {
  address?: {
    city?: string;
    country?: string;
    county?: string;
    municipality?: string;
    state?: string;
    state_district?: string;
    town?: string;
    village?: string;
  };
};

type LocationPlace = {
  city: string | null;
  country: string | null;
  region: string | null;
};

type ResolvedLocation = {
  coordinates: WeatherCoordinates;
  details: WeatherLocationDetails;
};

const weatherLabels: Record<number, string> = {
  0: "Clear",
  1: "Mostly clear",
  2: "Partly cloudy",
  3: "Overcast",
  45: "Foggy",
  48: "Foggy",
  51: "Light drizzle",
  53: "Drizzle",
  55: "Heavy drizzle",
  56: "Freezing drizzle",
  57: "Freezing drizzle",
  61: "Light rain",
  63: "Rain",
  65: "Heavy rain",
  66: "Freezing rain",
  67: "Freezing rain",
  71: "Light snow",
  73: "Snow",
  75: "Heavy snow",
  77: "Snow grains",
  80: "Rain showers",
  81: "Rain showers",
  82: "Heavy showers",
  85: "Snow showers",
  86: "Heavy snow showers",
  95: "Thunderstorms",
  96: "Thunderstorms with hail",
  99: "Thunderstorms with hail",
};

function serviceUnavailable() {
  return new AppError("service_unavailable", "Current weather is temporarily unavailable.");
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function roundedCoordinates(coordinates: WeatherCoordinates): WeatherCoordinates {
  return {
    latitude: Number(coordinates.latitude.toFixed(4)),
    longitude: Number(coordinates.longitude.toFixed(4)),
  };
}

function coordinateLabel(coordinates: WeatherCoordinates) {
  return `${coordinates.latitude.toFixed(4)}, ${coordinates.longitude.toFixed(4)}`;
}

function shortLocationLabel(place: LocationPlace, fallback: string) {
  if (place.city === "New York" && place.region === "New York") return "NYC";
  return place.city ?? fallback;
}

function locationDetails(
  coordinates: WeatherCoordinates,
  place: LocationPlace,
  source: WeatherLocationDetails["source"],
): WeatherLocationDetails {
  const displayCoordinates = roundedCoordinates(coordinates);
  const fallback = coordinateLabel(displayCoordinates);
  const label = [place.city, place.region, place.country].filter(Boolean).join(", ") || fallback;
  return {
    city: place.city,
    coordinates: displayCoordinates,
    country: place.country,
    label,
    mapUrl: `https://www.openstreetmap.org/?mlat=${displayCoordinates.latitude}&mlon=${displayCoordinates.longitude}#map=12/${displayCoordinates.latitude}/${displayCoordinates.longitude}`,
    region: place.region,
    shortLabel: shortLocationLabel(place, fallback),
    source,
  };
}

function locationOption(
  result: NonNullable<GeocodingResponse["results"]>[number],
): WeatherLocationOption {
  return {
    coordinates: { latitude: result.latitude, longitude: result.longitude },
    label: [result.name, result.admin1, result.country].filter(Boolean).join(", "),
    ...(result.timezone ? { timezone: result.timezone } : {}),
  };
}

function aqiAlert(aqi: number | null) {
  if (aqi === null || aqi < 101) return null;
  if (aqi >= 201) return "Air quality: very unhealthy";
  if (aqi >= 151) return "Air quality: unhealthy";
  return "Air quality: sensitive groups";
}

export function createWeatherService({ fetch = globalThis.fetch, now }: WeatherServiceOptions) {
  const reverseGeocodeCache = new Map<string, LocationPlace>();
  let lastReverseGeocodeAt = 0;
  let reverseGeocodeQueue = Promise.resolve();

  async function resolveSavedLocation(homeLocation: HomeLocation): Promise<ResolvedLocation> {
    if (!homeLocation.coordinates) return resolveLegacySavedLocation(homeLocation.label);
    const [city = null, region = null, country = null] = homeLocation.label
      .split(",")
      .map((part) => part.trim() || null);
    return {
      coordinates: homeLocation.coordinates,
      details: locationDetails(homeLocation.coordinates, { city, country, region }, "saved"),
    };
  }

  async function resolveLegacySavedLocation(weatherLocation: string): Promise<ResolvedLocation> {
    const url = new URL("https://geocoding-api.open-meteo.com/v1/search");
    url.searchParams.set("count", "1");
    url.searchParams.set("language", "en");
    url.searchParams.set("name", weatherLocation.split(",")[0]?.trim() || weatherLocation);
    let response: Response;
    try {
      response = await providerFetch(fetch, url);
    } catch {
      throw serviceUnavailable();
    }
    const value = (await response.json().catch(() => null)) as GeocodingResponse | null;
    const result = value?.results?.[0];
    if (!response.ok) throw serviceUnavailable();
    if (
      !result ||
      numberValue(result.latitude) === null ||
      numberValue(result.longitude) === null
    ) {
      throw new AppError(
        "invalid_request",
        "The saved weather location could not be found. Update it in Profile settings.",
      );
    }
    const coordinates = { latitude: result.latitude, longitude: result.longitude };
    return {
      coordinates,
      details: locationDetails(
        coordinates,
        { city: result.name, country: result.country ?? null, region: result.admin1 ?? null },
        "saved",
      ),
    };
  }

  async function resolveDeviceLocation(coordinates: WeatherCoordinates): Promise<ResolvedLocation> {
    const cacheKey = `${coordinates.latitude.toFixed(2)},${coordinates.longitude.toFixed(2)}`;
    const cachedPlace = reverseGeocodeCache.get(cacheKey);
    const place = cachedPlace ?? (await reverseGeocode(coordinates));
    if (!cachedPlace && place) reverseGeocodeCache.set(cacheKey, place);
    return {
      coordinates,
      details: locationDetails(
        coordinates,
        place ?? { city: null, country: null, region: null },
        "device",
      ),
    };
  }

  async function reverseGeocode(coordinates: WeatherCoordinates): Promise<LocationPlace | null> {
    let releaseQueue: (() => void) | undefined;
    const previousRequest = reverseGeocodeQueue;
    reverseGeocodeQueue = new Promise<void>((resolve) => {
      releaseQueue = resolve;
    });
    await previousRequest;
    const delay = Math.max(0, 1_000 - (Date.now() - lastReverseGeocodeAt));
    if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
    try {
      const url = new URL("https://nominatim.openstreetmap.org/reverse");
      url.searchParams.set("addressdetails", "1");
      url.searchParams.set("format", "jsonv2");
      url.searchParams.set("lat", String(coordinates.latitude));
      url.searchParams.set("lon", String(coordinates.longitude));
      url.searchParams.set("zoom", "10");
      const response = await providerFetch(
        fetch,
        url,
        {
          headers: {
            "Accept-Language": "en",
            "User-Agent": "ilo/1.0 (https://github.com/coopersully/personal-os)",
          },
        },
        5_000,
      );
      const value = (await response.json().catch(() => null)) as ReverseGeocodingResponse | null;
      if (!response.ok || !value?.address) return null;
      const address = value.address;
      return {
        city: address.city ?? address.town ?? address.village ?? address.municipality ?? null,
        country: address.country ?? null,
        region: address.state ?? address.state_district ?? address.county ?? null,
      };
    } catch {
      return null;
    } finally {
      lastReverseGeocodeAt = Date.now();
      releaseQueue?.();
    }
  }

  return {
    async searchLocations(query: string): Promise<WeatherLocationOption[]> {
      const url = new URL("https://geocoding-api.open-meteo.com/v1/search");
      url.searchParams.set("count", "8");
      url.searchParams.set("language", "en");
      url.searchParams.set("name", query);
      let response: Response;
      try {
        response = await providerFetch(fetch, url);
      } catch {
        throw serviceUnavailable();
      }
      const value = (await response.json().catch(() => null)) as GeocodingResponse | null;
      if (!response.ok) throw serviceUnavailable();
      const labels = new Set<string>();
      return (value?.results ?? [])
        .filter(
          (result) =>
            numberValue(result.latitude) !== null &&
            numberValue(result.longitude) !== null &&
            result.name.trim().length > 0,
        )
        .map(locationOption)
        .filter((result) => {
          if (labels.has(result.label)) return false;
          labels.add(result.label);
          return true;
        });
    },

    async current(input: {
      coordinates?: WeatherCoordinates;
      savedLocation: HomeLocation | null;
    }): Promise<WeatherSnapshot> {
      const location = input.coordinates
        ? await resolveDeviceLocation(input.coordinates)
        : input.savedLocation
          ? await resolveSavedLocation(input.savedLocation)
          : null;
      if (!location) {
        throw new AppError(
          "invalid_request",
          "Allow device location or add a saved weather location in Profile settings.",
        );
      }

      const forecastUrl = new URL("https://api.open-meteo.com/v1/forecast");
      forecastUrl.searchParams.set(
        "current",
        "temperature_2m,precipitation,rain,showers,weather_code",
      );
      forecastUrl.searchParams.set("latitude", String(location.coordinates.latitude));
      forecastUrl.searchParams.set("longitude", String(location.coordinates.longitude));
      forecastUrl.searchParams.set("temperature_unit", "fahrenheit");
      forecastUrl.searchParams.set("precipitation_unit", "inch");
      const airQualityUrl = new URL("https://air-quality-api.open-meteo.com/v1/air-quality");
      airQualityUrl.searchParams.set("current", "us_aqi");
      airQualityUrl.searchParams.set("latitude", String(location.coordinates.latitude));
      airQualityUrl.searchParams.set("longitude", String(location.coordinates.longitude));
      const forecastRequest = providerFetch(fetch, forecastUrl);
      const airQualityRequest = providerFetch(fetch, airQualityUrl).catch(() => null);
      let forecastResponse: Response;
      try {
        forecastResponse = await forecastRequest;
      } catch {
        throw serviceUnavailable();
      }
      const airQualityResponse = await airQualityRequest;
      const forecast = (await forecastResponse.json().catch(() => null)) as ForecastResponse | null;
      const airQuality = airQualityResponse
        ? ((await airQualityResponse.json().catch(() => null)) as AirQualityResponse | null)
        : null;
      const current = forecast?.current;
      const temperatureF = numberValue(current?.temperature_2m);
      const weatherCode = numberValue(current?.weather_code);
      if (!forecastResponse.ok || !current || temperatureF === null || weatherCode === null) {
        throw serviceUnavailable();
      }
      const precipitation = Math.max(
        numberValue(current.precipitation) ?? 0,
        numberValue(current.rain) ?? 0,
        numberValue(current.showers) ?? 0,
      );
      const usAqi = airQualityResponse?.ok ? numberValue(airQuality?.current?.us_aqi) : null;
      const airQualityAlert = aqiAlert(usAqi);
      const alerts = [
        ...(precipitation > 0 ? [{ kind: "rain" as const, label: "Rain now" }] : []),
        ...(airQualityAlert ? [{ kind: "air_quality" as const, label: airQualityAlert }] : []),
      ];
      return {
        alerts,
        condition: weatherLabels[weatherCode] ?? "Current conditions",
        location: location.details,
        observedAt: now().toISOString(),
        temperatureF,
        usAqi: usAqi === null ? null : Math.round(usAqi),
      };
    },
  };
}
