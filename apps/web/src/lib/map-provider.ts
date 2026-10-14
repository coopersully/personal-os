export const mapWorkerPath = "/maplibre/6.14.0/maplibre-gl-worker.mjs";
const cartoHosts = new Set([
  "basemaps.cartocdn.com",
  "tiles.basemaps.cartocdn.com",
  "tiles-a.basemaps.cartocdn.com",
  "tiles-b.basemaps.cartocdn.com",
  "tiles-c.basemaps.cartocdn.com",
  "tiles-d.basemaps.cartocdn.com",
  "a.basemaps.cartocdn.com",
  "b.basemaps.cartocdn.com",
  "c.basemaps.cartocdn.com",
  "d.basemaps.cartocdn.com",
]);
export function cartoResource(url: string, key: string): string {
  const parsed = new URL(url);
  if (
    parsed.protocol !== "https:" ||
    !cartoHosts.has(parsed.hostname) ||
    parsed.port ||
    parsed.username ||
    parsed.password
  )
    throw new Error("Unapproved map resource.");
  parsed.searchParams.set("key", key);
  return parsed.toString();
}
export function cartoStyle(dark: boolean) {
  return `https://basemaps.cartocdn.com/gl/${dark ? "dark-matter" : "positron"}-gl-style/style.json`;
}
