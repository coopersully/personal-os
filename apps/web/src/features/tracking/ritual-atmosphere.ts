import { mixSkyColor, type RitualSkyAppearance, type SkyColor } from "./ritual-sky.js";

export const skyBayer = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5] as const;
const random = (n: number) => {
  const value = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return value - Math.floor(value);
};
/** One low-resolution raster keeps the sky, celestial disk and precipitation in the same pixel language. */
export function paintRitualAtmosphere(
  width: number,
  height: number,
  sky: RitualSkyAppearance,
  elapsed: number,
  pixels = new Uint8ClampedArray(width * height * 4),
) {
  const cx = sky.celestialX * width;
  const cy = sky.celestialY * height;
  const radius = Math.max(5, Math.min(width, height) * 0.075);
  const moon = sky.celestial === "moon";
  const sun: SkyColor = moon ? [235, 239, 252] : [255, 220, 143];
  const phase = sky.moonPhase;
  for (let y = 0; y < height; y++) {
    // Dither between a small number of palette bands instead of painting a smooth gradient.
    const band = (y / height) * 7;
    for (let x = 0; x < width; x++) {
      const threshold = (skyBayer[(y % 4) * 4 + (x % 4)]! + 0.5) / 16;
      const t = (Math.floor(band) + (band % 1 > threshold ? 1 : 0)) / 7;
      let color = mixSkyColor(sky.top, sky.horizon, t);
      const dx = (x - cx) / radius,
        dy = (y - cy) / radius;
      const distance = Math.sqrt(dx * dx + dy * dy);
      let disk = distance < 1;
      if (moon && disk) {
        // A moving terminator gives a recognisable lunar phase without claiming an exact ephemeris.
        const half = Math.sqrt(Math.max(0, 1 - dy * dy));
        const terminator = Math.cos(phase * Math.PI * 2) * half;
        disk = phase < 0.5 ? dx > terminator : dx < -terminator;
      }
      const visibility =
        sky.condition === "fog" ? 0.22 : sky.condition === "storm" ? 0.15 : 1 - sky.cover * 0.45;
      const glow = Math.max(0, 1 - distance / 1.5) * 0.14 * visibility;
      if (glow > threshold) color = mixSkyColor(color, sun, 0.4);
      if (disk && (1 - distance) * 5 * visibility > threshold) color = sun;
      if (moon && sky.dark && sky.cover < 0.8 && random(y * width + x) > 0.9992)
        color = [220, 228, 249];
      const index = (y * width + x) * 4;
      pixels[index] = color[0];
      pixels[index + 1] = color[1];
      pixels[index + 2] = color[2];
      pixels[index + 3] = 255;
    }
  }
  const rain = sky.condition === "rain" || sky.condition === "storm";
  const snow = sky.condition === "snow";
  if (rain || snow) {
    const count = Math.round((width * height) / (snow ? 1100 : 700));
    for (let i = 0; i < count; i++) {
      const pace = snow ? 0.006 : 0.045;
      const y =
        (((random(i + 3) * height + elapsed * pace * (0.7 + random(i + 7))) % height) + height) %
        height;
      const x =
        (((random(i + 41) * width - elapsed * (rain ? 0.012 : 0.002) * sky.wind) % width) + width) %
        width;
      const length = snow ? 1 : 3 + Math.floor(random(i + 9) * 4);
      for (let step = 0; step < length; step++) {
        const px = Math.floor(x + (rain ? -step * 0.3 : 0));
        const py = Math.floor(y + step);
        if (px < 0 || px >= width || py >= height) continue;
        const index = (py * width + px) * 4;
        const color = mixSkyColor(
          [pixels[index]!, pixels[index + 1]!, pixels[index + 2]!],
          sky.cloud,
          snow ? 0.85 : 0.55,
        );
        pixels[index] = color[0];
        pixels[index + 1] = color[1];
        pixels[index + 2] = color[2];
      }
    }
  }
  return pixels;
}
