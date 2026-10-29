import type { CSSProperties } from "react";

export function calendarEventColorStyle(color: string | null | undefined): CSSProperties {
  return { "--calendar-color": color ?? "#777ce3" } as CSSProperties;
}
