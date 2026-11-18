import { paintRitualAtmosphere, ritualCloudRim, ritualStormGust } from "./ritual-atmosphere.js";
import { resolveRitualSky } from "./ritual-sky.js";

const sky = resolveRitualSky({ now: Date.parse("2026-10-27T12:00:00Z"), timeZone: "UTC" });
it("paints an opaque deterministic pixel sky with a sun instead of smooth vector artwork", () => {
  const a = paintRitualAtmosphere(160, 100, sky, 0);
  expect(a).toEqual(paintRitualAtmosphere(160, 100, sky, 0));
  expect(a.filter((_, i) => i % 4 === 3).every((v) => v === 255)).toBe(true);
  const skyOnly = paintRitualAtmosphere(160, 100, { ...sky, cover: 1, condition: "fog" }, 0);
  expect(a).not.toEqual(skyOnly);
});
it("changes precipitation over time, keeps quiet skies static, and distinguishes sun from moon", () => {
  expect(paintRitualAtmosphere(160, 100, sky, 0)).toEqual(
    paintRitualAtmosphere(160, 100, sky, 500),
  );
  for (const condition of ["rain", "snow", "storm"] as const) {
    const wet = { ...sky, condition };
    expect(paintRitualAtmosphere(160, 100, wet, 0)).not.toEqual(
      paintRitualAtmosphere(160, 100, wet, 500),
    );
  }
  expect(paintRitualAtmosphere(160, 100, sky, 0)).not.toEqual(
    paintRitualAtmosphere(160, 100, { ...sky, celestial: "moon", dark: true }, 0),
  );
});

it("lights only the sunward cloud edge, with softer overcast and phased moonlight", () => {
  const lit = { ...sky, celestialX: 0.8, celestialY: 0.2 };
  const rim = (appearance: typeof sky, gx: number, density = 0.5) =>
    ritualCloudRim(appearance, 0.4, 0.2, density, gx, 0);
  expect(rim(lit, -1)).toBeCloseTo(1);
  expect(rim(lit, 1)).toBe(0);
  expect(rim(lit, 0)).toBe(0);
  expect(rim(lit, -1, 1)).toBe(0);
  expect(rim({ ...lit, condition: "overcast" }, -1)).toBeLessThan(rim(lit, -1));
  const moon = { ...lit, celestial: "moon" as const };
  expect(rim({ ...moon, moonPhase: 0 }, -1)).toBeLessThan(rim({ ...moon, moonPhase: 0.5 }, -1));
  expect(rim({ ...lit, celestialX: 0, celestialY: 0.2 }, 1)).toBeGreaterThan(0);
});

it("keeps fog motion low and leaves the upper sky still", () => {
  const fog = { ...sky, condition: "fog" as const };
  const first = paintRitualAtmosphere(160, 100, fog, 0);
  const later = paintRitualAtmosphere(160, 100, fog, 14000);
  expect(first.slice(0, 160 * 40 * 4)).toEqual(later.slice(0, 160 * 40 * 4));
  expect(first.slice(160 * 45 * 4)).not.toEqual(later.slice(160 * 45 * 4));
});

it("diffuses the overcast sun and keeps stars away from the lunar disk", () => {
  const covered = paintRitualAtmosphere(160, 100, { ...sky, condition: "overcast", cover: 0.9 }, 0);
  const clear = paintRitualAtmosphere(160, 100, sky, 0);
  const at = (Math.floor(sky.celestialY * 100) * 160 + Math.floor(sky.celestialX * 160)) * 4;
  expect(covered[at]).toBeLessThan(clear[at] ?? 0);
  const fog = paintRitualAtmosphere(160, 100, { ...sky, condition: "fog", cover: 0.65 }, 0);
  expect(fog[at]).toBeLessThan(clear[at] ?? 0);
  const night = { ...sky, celestial: "moon" as const, dark: true, moonPhase: 0 };
  const stars = paintRitualAtmosphere(160, 100, night, 0);
  const radius = 7.5;
  let count = 0;
  for (let y = 0; y < 100; y++)
    for (let x = 0; x < 160; x++) {
      const i = (y * 160 + x) * 4;
      if (stars[i] === 220 && stars[i + 1] === 228 && stars[i + 2] === 249) {
        count++;
        expect(Math.hypot(x - night.celestialX * 160, y - night.celestialY * 100)).toBeGreaterThan(
          radius * 1.3,
        );
      }
    }
  expect(count).toBeGreaterThan(0);
});

it("keeps storm gusts smooth and bounded without changing the sky illumination", () => {
  for (let elapsed = 0; elapsed < 60000; elapsed += 500) {
    expect(ritualStormGust(elapsed)).toBeGreaterThanOrEqual(0);
    expect(ritualStormGust(elapsed)).toBeLessThanOrEqual(1);
    expect(Math.abs(ritualStormGust(elapsed + 100) - ritualStormGust(elapsed))).toBeLessThan(0.02);
  }
  const storm = { ...sky, condition: "storm" as const };
  const early = paintRitualAtmosphere(160, 100, storm, 0);
  const later = paintRitualAtmosphere(160, 100, storm, 10000);
  // Fewer than 5% of pixels change: gusts affect drops, never flash the sky.
  expect(early.filter((value, i) => i % 4 === 0 && value !== later[i]).length).toBeLessThan(800);
});

it("omits the sun, moon and halos from secondary skies while retaining the weather", () => {
  for (const celestial of ["sun", "moon"] as const) {
    const appearance = { ...sky, celestial, moonPhase: 0.5, dark: celestial === "moon" };
    const primary = paintRitualAtmosphere(160, 100, appearance, 0);
    const secondary = paintRitualAtmosphere(160, 100, appearance, 0, undefined, false);
    const x = Math.floor(appearance.celestialX * 160),
      y = Math.floor(appearance.celestialY * 100);
    const index = (y * 160 + x) * 4;
    expect(secondary.slice(index, index + 3)).not.toEqual(primary.slice(index, index + 3));
    expect(secondary.slice(160 * 60 * 4)).toEqual(primary.slice(160 * 60 * 4));
  }
  const rainy = { ...sky, condition: "rain" as const };
  expect(paintRitualAtmosphere(160, 100, rainy, 0, undefined, false)).not.toEqual(
    paintRitualAtmosphere(160, 100, rainy, 1000, undefined, false),
  );
});
