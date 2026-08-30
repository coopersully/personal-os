export function formatTextLocalTime(value: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "full",
    timeStyle: "long",
    timeZone,
  }).format(value);
}
