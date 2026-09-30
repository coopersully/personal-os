export type TimelineScrollContainer = Pick<HTMLElement, "clientHeight" | "scrollTop">;

/** Centers a calendar timeline on a minute-of-day, without disturbing an unmounted view. */
export function scrollTimelineToMinute(container: TimelineScrollContainer | null, minute: number) {
  if (!container) return;
  const target = minuteToTimelinePixels(minute) - container.clientHeight / 2;
  container.scrollTop = Math.max(0, target);
}

export function minuteToTimelinePixels(minute: number) {
  return minute * (48 / 60);
}
