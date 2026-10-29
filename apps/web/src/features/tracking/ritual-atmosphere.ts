import { mixSkyColor, type RitualSkyAppearance, type SkyColor } from "./ritual-sky.js";

export const skyBayer = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5] as const;
const random = (n: number) => {
  const value = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return value - Math.floor(value);
};
const wrap = (value: number, size: number) => ((value % size) + size) % size;
/** Slow, continuous gusts: precipitation changes weight and angle without flashes. */
export const ritualStormGust = (elapsed: number) => (0.5 + 0.5 * Math.sin(elapsed / 7200)) ** 6;

/** Light only catches cloud edges facing the celestial body; dense centres stay quiet. */
export function ritualCloudRim(
  sky: RitualSkyAppearance,
  x: number,
  y: number,
  density: number,
  gradientX: number,
  gradientY: number,
) {
  const dx = sky.celestialX - x;
  const dy = sky.celestialY - y;
  const magnitude = Math.sqrt(
    (gradientX * gradientX + gradientY * gradientY) * (dx * dx + dy * dy),
  );
  const facing = magnitude > 0 ? Math.max(0, -(gradientX * dx + gradientY * dy) / magnitude) : 0;
  const diffuse =
    sky.condition === "fog" || sky.condition === "overcast" || sky.condition === "storm" ? 0.25 : 1;
  const lunar = sky.celestial === "moon" ? 0.25 + 0.75 * Math.sin(sky.moonPhase * Math.PI) ** 2 : 1;
  return facing * 4 * density * (1 - density) * diffuse * lunar;
}

/** One low-resolution raster keeps the sky, celestial disk and precipitation in the same pixel language. */
export function paintRitualAtmosphere(
  width: number,
  height: number,
  sky: RitualSkyAppearance,
  elapsed: number,
  pixels = new Uint8ClampedArray(width * height * 4),
  includeCelestial = true,
) {
  const cx = sky.celestialX * width;
  const cy = sky.celestialY * height;
  const radius = Math.max(5, Math.min(width, height) * 0.075);
  const moon = sky.celestial === "moon";
  const sun: SkyColor = moon ? [235, 239, 252] : [255, 220, 143];
  const phase = sky.moonPhase;
  const overcast = sky.condition === "overcast";
  const visibility =
    sky.condition === "fog"
      ? 0.22
      : sky.condition === "storm"
        ? 0.15
        : overcast
          ? 0.18
          : 1 - sky.cover * 0.45;
  // Mist centres depend only on the column and time, not on every sky pixel.
  const mistCentres = sky.condition === "fog" ? new Float32Array(width * 3) : undefined;
  if (mistCentres) {
    for (let x = 0; x < width; x++)
      for (let layer = 0; layer < 3; layer++) {
        mistCentres[x * 3 + layer] =
          height * (0.58 + layer * 0.16) +
          Math.sin((x / width) * 5 + elapsed / (18000 + layer * 6000) + layer * 2) * height * 0.035;
      }
  }
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
      // Overcast spreads a faint disk into a wider veil; clear skies have a narrow halo.
      const glow =
        Math.max(0, 1 - distance / (overcast ? 3.5 : 2.1)) *
        (overcast ? 0.18 : 0.22) *
        (overcast ? 1 : visibility);
      if (includeCelestial && glow > threshold)
        color = mixSkyColor(color, sun, overcast ? 0.18 : 0.32);
      if (includeCelestial && disk && (1 - distance) * 5 * visibility > threshold)
        color = mixSkyColor(
          color,
          sun,
          sky.condition === "fog"
            ? 0.22
            : overcast
              ? 0.32
              : sky.condition === "storm"
                ? 0.18
                : sky.condition === "rain"
                  ? 0.5
                  : sky.condition === "snow"
                    ? 0.65
                    : 1,
        );
      // Stars remain fixed behind the independently drifting cloud layer; never paint over the moon.
      if (
        moon &&
        sky.dark &&
        sky.cover < 0.8 &&
        (!includeCelestial || distance > 1.3) &&
        y < height * 0.68 &&
        random(y * width + x) > 0.9992
      )
        color = [220, 228, 249];
      if (mistCentres) {
        let mist = 0;
        for (let layer = 0; layer < 3; layer++) {
          const centre = mistCentres[x * 3 + layer] ?? height;
          mist += Math.max(0, 1 - Math.abs(y - centre) / (height * 0.09)) * 0.16;
        }
        if (mist > threshold) color = mixSkyColor(color, sky.cloud, 0.3);
      }
      const index = (y * width + x) * 4;
      pixels[index] = color[0];
      pixels[index + 1] = color[1];
      pixels[index + 2] = color[2];
      pixels[index + 3] = 255;
    }
  }
  const blend = (x: number, y: number, amount: number) => {
    const px = Math.floor(x),
      py = Math.floor(y);
    if (px < 0 || px >= width || py < 0 || py >= height) return;
    const index = (py * width + px) * 4;
    const color = mixSkyColor(
      [pixels[index]!, pixels[index + 1]!, pixels[index + 2]!],
      sky.cloud,
      amount,
    );
    pixels[index] = color[0];
    pixels[index + 1] = color[1];
    pixels[index + 2] = color[2];
  };
  const rain = sky.condition === "rain" || sky.condition === "storm";
  const snow = sky.condition === "snow";
  if (rain || snow) {
    const storm = sky.condition === "storm";
    const gust = storm ? ritualStormGust(elapsed) : 0;
    // Integrate the gust so rain paths never jump when the wind changes.
    const drift =
      sky.wind * (elapsed + (storm ? elapsed * 0.12 - Math.cos(elapsed / 7200) * 500 : 0));
    const count = Math.round((width * height) / (snow ? 1100 : 700));
    for (let i = 0; i < count; i++) {
      if (storm && random(i + 90) > 0.7 + gust * 0.3) continue;
      const nearby = snow && i % 7 === 0;
      const pace = snow ? (nearby ? 0.004 : 0.008) : 0.045;
      const y = wrap(random(i + 3) * height + elapsed * pace * (0.7 + random(i + 7)), height);
      const x = wrap(
        random(i + 41) * width -
          drift * (rain ? 0.012 : 0.002) +
          (snow ? Math.sin(elapsed / (nearby ? 4200 : 6500) + i) * (nearby ? 5 : 2) : 0),
        width,
      );
      const length = snow ? 1 : 3 + Math.floor(random(i + 9) * 4);
      for (let step = 0; step < length; step++)
        blend(
          x - (rain ? step * (0.3 + gust * 0.4) * sky.wind : 0),
          y + step,
          snow ? (nearby ? 0.75 : 0.5) : 0.45 + gust * 0.12,
        );
      if (nearby) {
        blend(x - 1, y, 0.4);
        blend(x + 1, y, 0.4);
        blend(x, y - 1, 0.4);
        blend(x, y + 1, 0.4);
      }
    }
    if (rain) {
      // A few short-lived, flattened rings sit in the last 7% of the scene, below the card.
      for (let i = 0; i < Math.max(2, Math.floor(width / 100)); i++) {
        const cycle = elapsed / 2600 + random(i + 201);
        const progress = cycle % 1;
        if (progress > 0.48) continue;
        const x = random(i + 210 + Math.floor(cycle) * 17) * width;
        const y = height * (0.93 + random(i + 220) * 0.055);
        const size = 1 + progress * 12;
        for (let step = 0; step < 12; step++) {
          const angle = (step / 12) * Math.PI * 2;
          blend(
            x + Math.cos(angle) * size,
            y + Math.sin(angle) * size * 0.22,
            (1 - progress / 0.48) * 0.35,
          );
        }
      }
    }
  }
  return pixels;
}
