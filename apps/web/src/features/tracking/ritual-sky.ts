import type { WeatherSnapshot } from "@personal-os/domain";

export type SkyColor = readonly [number, number, number];
export type RitualSkyAppearance = {
  phase: "night" | "dawn" | "day" | "sunset" | "twilight";
  source: "weather" | "time";
  condition: "clear" | "cloudy" | "overcast" | "rain" | "snow" | "fog" | "storm";
  top: SkyColor;
  horizon: SkyColor;
  cloud: SkyColor;
  celestial: "sun" | "moon";
  celestialX: number;
  celestialY: number;
  moonPhase: number;
  cover: number;
  wind: number;
  dark: boolean;
  topDark: boolean;
  bottomDark: boolean;
};
const night = { top: [20, 33, 65], horizon: [49, 65, 110] } as const;
const dawn = { top: [143, 142, 224], horizon: [255, 207, 155] } as const;
const day = { top: [117, 183, 224], horizon: [174, 215, 237] } as const;
const sunset = { top: [129, 117, 191], horizon: [249, 156, 130] } as const;
const twilight = { top: [54, 72, 137], horizon: [143, 137, 211] } as const;
const clamp = (value: number, min = 0, max = 1) => Math.max(min, Math.min(max, value));
export function mixSkyColor(a: SkyColor, b: SkyColor, amount: number): SkyColor {
  const t = clamp(amount);
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}
function localHour(now: number, timeZone: string) {
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      hourCycle: "h23",
      hour: "2-digit",
      minute: "2-digit",
    }).formatToParts(now);
    return (
      Number(parts.find((p) => p.type === "hour")?.value ?? 12) +
      Number(parts.find((p) => p.type === "minute")?.value ?? 0) / 60
    );
  } catch {
    return new Date(now).getUTCHours() + new Date(now).getUTCMinutes() / 60;
  }
}
function conditionFor(code: number): RitualSkyAppearance["condition"] {
  if (code >= 95 && code <= 99) return "storm";
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return "snow";
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return "rain";
  if (code === 45 || code === 48) return "fog";
  if (code === 3) return "overcast";
  return code === 2 ? "cloudy" : "clear";
}
/** Art direction follows local solar times; weather never gates the routine. */
export function resolveRitualSky({
  now,
  timeZone,
  weather,
}: {
  now: number;
  timeZone: string;
  weather?: WeatherSnapshot | undefined;
}): RitualSkyAppearance {
  const atmosphere = weather?.atmosphere;
  const age = atmosphere ? now - Date.parse(atmosphere.observedAt) : Infinity;
  const fresh = Number.isFinite(age) && age >= -5 * 60_000 && age <= 30 * 60_000;
  const source = fresh ? "weather" : "time";
  const hour = localHour(now, timeZone);
  // Missing weather uses a deliberately approximate local-time scene, never claimed as observations.
  let rise = 6;
  let set = 18;
  let clock = hour;
  const observedRise = Date.parse(atmosphere?.sunriseAt ?? "");
  const observedSet = Date.parse(atmosphere?.sunsetAt ?? "");
  const solar =
    fresh &&
    Number.isFinite(observedRise) &&
    Number.isFinite(observedSet) &&
    observedSet > observedRise &&
    Math.abs(now - observedRise) < 36 * 3600_000;
  if (solar) {
    rise = observedRise / 3600_000;
    set = observedSet / 3600_000;
    clock = now / 3600_000;
  }
  const polar = fresh && !solar && atmosphere?.isDay !== null && atmosphere?.isDay !== undefined;
  const daylight = polar ? atmosphere.isDay === true : clock >= rise && clock < set;
  const stops = [
    { at: rise - 1.5, palette: night },
    { at: rise, palette: dawn },
    { at: rise + Math.min(1.5, (set - rise) / 3), palette: day },
    { at: set - Math.min(1.5, (set - rise) / 3), palette: day },
    { at: set, palette: sunset },
    { at: set + 0.6, palette: twilight },
    { at: set + 1.5, palette: night },
  ];
  let top: SkyColor = polar && daylight ? day.top : night.top;
  let horizon: SkyColor = polar && daylight ? day.horizon : night.horizon;
  if (!polar) {
    for (let i = 1; i < stops.length; i++) {
      const left = stops[i - 1]!;
      const right = stops[i]!;
      if (clock >= left.at && clock <= right.at) {
        const t = (clock - left.at) / (right.at - left.at);
        top = mixSkyColor(left.palette.top, right.palette.top, t);
        horizon = mixSkyColor(left.palette.horizon, right.palette.horizon, t);
        break;
      }
    }
  }
  const phase: RitualSkyAppearance["phase"] = polar
    ? daylight
      ? "day"
      : "night"
    : clock >= rise - 1.5 && clock < rise + 1.5
      ? "dawn"
      : clock >= rise + 1.5 && clock < set - 1.5
        ? "day"
        : clock >= set - 1.5 && clock < set + 0.3
          ? "sunset"
          : clock >= set + 0.3 && clock < set + 1.5
            ? "twilight"
            : "night";
  const condition = fresh && atmosphere ? conditionFor(atmosphere.weatherCode) : "clear";
  const minimum = {
    clear: 0.12,
    cloudy: 0.4,
    overcast: 0.85,
    rain: 0.8,
    snow: 0.7,
    fog: 0.65,
    storm: 0.9,
  }[condition];
  const cover = Math.max(
    minimum,
    fresh ? clamp((atmosphere?.cloudCoverPercent ?? minimum * 100) / 100) : minimum,
  );
  const muted = ["overcast", "rain", "snow", "fog", "storm"].includes(condition);
  const dark = phase === "night" || phase === "twilight";
  if (muted) {
    top = mixSkyColor(
      top,
      dark ? [25, 40, 61] : [108, 143, 164],
      condition === "storm" ? 0.8 : 0.65,
    );
    horizon = mixSkyColor(horizon, dark ? [63, 83, 109] : [167, 190, 203], 0.6);
  }
  const progress = clamp((clock - rise) / (set - rise));
  const isDark = (color: SkyColor) => {
    const channel = (value: number) => {
      const v = value / 255;
      return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    };
    return (
      0.2126 * channel(color[0]) + 0.7152 * channel(color[1]) + 0.0722 * channel(color[2]) < 0.3
    );
  };
  return {
    phase,
    source,
    condition,
    top,
    horizon,
    cloud: dark
      ? [166, 186, 220]
      : muted
        ? [220, 232, 238]
        : phase === "sunset"
          ? [255, 211, 175]
          : [255, 247, 230],
    celestial: daylight || phase === "dawn" || phase === "sunset" ? "sun" : "moon",
    celestialX: daylight || phase === "dawn" || phase === "sunset" ? 0.16 + progress * 0.68 : 0.78,
    celestialY: daylight ? 0.2 - Math.sin(progress * Math.PI) * 0.1 : 0.15,
    // Approximate lunar phase for the decorative disk, independent of local timezone.
    moonPhase: ((((now - Date.UTC(2000, 0, 6, 18, 14)) / 86400_000 / 29.53059) % 1) + 1) % 1,
    cover,
    wind: clamp((fresh ? (atmosphere?.windSpeedKmh ?? 10) : 10) / 15, 0.3, 2),
    dark: isDark(mixSkyColor(top, horizon, 0.35)),
    topDark: isDark(top),
    bottomDark: isDark(horizon),
  };
}
