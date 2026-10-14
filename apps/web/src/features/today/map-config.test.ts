import { cartoResource, mapWorkerPath } from "@/lib/map-provider";

it("only attaches credentials to approved HTTPS basemap resources", () => {
  expect(cartoResource("https://a.basemaps.cartocdn.com/tile.pbf", "public-key")).toBe(
    "https://a.basemaps.cartocdn.com/tile.pbf?key=public-key",
  );
  for (const host of [
    "tiles.basemaps.cartocdn.com",
    "tiles-a.basemaps.cartocdn.com",
    "tiles-b.basemaps.cartocdn.com",
    "tiles-c.basemaps.cartocdn.com",
    "tiles-d.basemaps.cartocdn.com",
  ])
    expect(cartoResource(`https://${host}/tile.pbf`, "public-key")).toContain("key=public-key");
  for (const url of [
    "https://basemaps.cartocdn.com.evil.test/x",
    "http://basemaps.cartocdn.com/x",
    "https://evil.test/x",
    "https://user@basemaps.cartocdn.com/x",
  ])
    expect(() => cartoResource(url, "key")).toThrow("Unapproved");
  expect(mapWorkerPath).toBe("/maplibre/6.14.0/maplibre-gl-worker.mjs");
});
