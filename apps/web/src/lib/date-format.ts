export function formatOrdinalDate(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en", {
    day: "numeric",
    month: "long",
    timeZone,
    weekday: "long",
  }).formatToParts(date);
  const values = new Map(parts.map((part) => [part.type, part.value]));
  const day = Number(values.get("day"));

  return `${values.get("weekday")}, ${values.get("month")} ${day}${ordinalSuffix(day)}`;
}

export function formatMaterialDateTime(value: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en", {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
    timeZone,
  }).format(new Date(value));
}

export function ordinalSuffix(value: number): "st" | "nd" | "rd" | "th" {
  const remainder = Math.abs(value) % 100;
  if (remainder >= 11 && remainder <= 13) return "th";

  switch (remainder % 10) {
    case 1:
      return "st";
    case 2:
      return "nd";
    case 3:
      return "rd";
    default:
      return "th";
  }
}
