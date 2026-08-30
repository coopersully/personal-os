/** Format an SMS instant with an explicit numeric offset in the requested IANA time zone. */
export function formatTextLocalTime(value: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "long",
    second: "2-digit",
    timeZone,
    timeZoneName: "longOffset",
    weekday: "long",
    year: "numeric",
  }).format(value);
}
