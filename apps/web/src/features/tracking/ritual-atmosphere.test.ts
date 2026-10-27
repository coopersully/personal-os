import { paintRitualAtmosphere } from "./ritual-atmosphere.js";
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
