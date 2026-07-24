/** Parses the HH:MM values emitted by native time inputs, with safe defaults for incomplete values. */
export function timeToMinute(value: string) {
  const [hour = 0, minute = 0] = value.split(":").map(Number);
  return hour * 60 + minute;
}
