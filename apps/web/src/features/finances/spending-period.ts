export type SpendingPeriod = "today" | "week" | "month" | "custom";
export function shiftSpendingDate(date: string, days: number) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}
export function spendingToday(timezone: string, now = new Date()) {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  return ["year", "month", "day"]
    .map((key) => parts.find((part) => part.type === key)?.value)
    .join("-");
}
export function spendingPeriod(
  period: SpendingPeriod,
  anchor: string,
  weekStartsOn: "sunday" | "monday",
  through = anchor,
) {
  if (period === "custom") return { from: anchor, through };
  if (period === "today") return { from: anchor, through: anchor };
  if (period === "week") {
    const day = new Date(`${anchor}T12:00:00Z`).getUTCDay();
    const from = shiftSpendingDate(anchor, -((day - (weekStartsOn === "monday" ? 1 : 0) + 7) % 7));
    return { from, through: shiftSpendingDate(from, 6) };
  }
  const from = `${anchor.slice(0, 7)}-01`;
  const next = new Date(`${from}T12:00:00Z`);
  next.setUTCMonth(next.getUTCMonth() + 1);
  return { from, through: shiftSpendingDate(next.toISOString().slice(0, 10), -1) };
}
export function moveSpendingPeriod(period: SpendingPeriod, from: string, direction: number) {
  if (period === "month") {
    const date = new Date(`${from.slice(0, 7)}-01T12:00:00Z`);
    date.setUTCMonth(date.getUTCMonth() + direction);
    return date.toISOString().slice(0, 10);
  }
  return shiftSpendingDate(from, direction * (period === "week" ? 7 : 1));
}
