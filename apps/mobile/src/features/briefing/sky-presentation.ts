import {
  mixSkyColor,
  resolveRitualSky,
  type SkyColor,
  type WeatherSnapshot,
} from "@personal-os/domain";

function dark(color: SkyColor) {
  const [r, g, b] = color.map((value) => {
    const v = value / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0) < 0.179;
}
const rgb = (color: SkyColor) => `rgb(${color.map(Math.round).join(",")})`;
export function todaySky(now: number, timeZone: string, weather?: WeatherSnapshot) {
  const sky = resolveRitualSky({ now, timeZone, weather });
  // A quieter rendering of the shared desktop sky: no celestial disks, particles or dithering.
  const night = sky.phase === "night" || sky.phase === "twilight";
  const soften = (color: SkyColor) => (night ? color : mixSkyColor(color, [250, 245, 247], 0.28));
  const wet = sky.condition === "rain" || sky.condition === "storm";
  const top = soften(wet ? mixSkyColor(sky.top, [71, 94, 122], night ? 0.15 : 0.5) : sky.top);
  const horizon = soften(
    wet ? mixSkyColor(sky.horizon, [142, 161, 183], night ? 0.15 : 0.5) : sky.horizon,
  );
  const textDark = dark(mixSkyColor(top, horizon, 0.35));
  return {
    ...sky,
    topColor: rgb(top),
    bottomColor: rgb(horizon),
    hazeColor: rgb(sky.cloud),
    ink: textDark ? "#f8f8fc" : "#202024",
    secondary: textDark ? "#d0d6e8" : "#4f5360",
    chromeDark: dark(top),
    hazeOpacity: sky.source === "weather" ? 0.12 + sky.cover * 0.38 : 0.1,
  };
}
