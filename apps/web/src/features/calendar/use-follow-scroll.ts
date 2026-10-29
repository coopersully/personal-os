import { type UIEvent, useEffect, useRef } from "react";

export type FollowPosition = { left: number; top: number };

/** Clamp to reachable edges: a fully visible week must not require Today to be centered. */
export function calendarFollowPosition(
  container: HTMLElement,
  minute: number,
  week: boolean,
): FollowPosition | null {
  const clamp = (value: number, max: number) => Math.max(0, Math.min(value, Math.max(0, max)));
  let left = 0;
  if (week) {
    const today = container.querySelector<HTMLElement>('button[aria-current="date"]');
    if (!today) return null;
    const bounds = container.getBoundingClientRect();
    const day = today.getBoundingClientRect();
    left = clamp(
      container.scrollLeft + day.left + day.width / 2 - bounds.left - container.clientWidth / 2,
      container.scrollWidth - container.clientWidth,
    );
  }
  return {
    left,
    top: clamp(
      minute * 0.8 - container.clientHeight / 2,
      container.scrollHeight - container.clientHeight,
    ),
  };
}

export function useFollowScroll({
  eligible,
  following,
  minute,
  week,
  programmatic,
  snapEnabled = true,
  sensitivity = "balanced",
  onEnter,
  onExit,
}: {
  eligible: boolean;
  following: boolean;
  minute: number;
  week: boolean;
  programmatic: { current: FollowPosition | null };
  snapEnabled?: boolean;
  sensitivity?: "precise" | "balanced" | "generous";
  onEnter: () => void;
  onExit: () => void;
}) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Cancel a pending snap on any render (route, view, clock, or Follow changes).
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  });
  return (event: UIEvent<HTMLDivElement>) => {
    if (timer.current) clearTimeout(timer.current);
    if (!eligible) return;
    const container = event.currentTarget;
    const distance = (position: FollowPosition) =>
      Math.max(
        Math.abs(container.scrollLeft - position.left),
        Math.abs(container.scrollTop - position.top),
      );
    if (programmatic.current && distance(programmatic.current) <= 1) {
      programmatic.current = null;
      return;
    }
    programmatic.current = null;
    const target = calendarFollowPosition(container, minute, week);
    if (!target) return;
    const threshold = { precise: 6, balanced: 24, generous: 96 }[sensitivity];
    if (following) {
      if (distance(target) > Math.max(96, threshold + 48)) onExit();
      return;
    }
    // Wait for wheel/touch momentum to settle; passing through Today must not grab the viewport.
    if (snapEnabled && distance(target) <= threshold)
      timer.current = setTimeout(() => {
        const settledTarget = calendarFollowPosition(container, minute, week);
        if (!container.isConnected || !settledTarget || distance(settledTarget) > threshold) return;
        container.scrollLeft = settledTarget.left;
        container.scrollTop = settledTarget.top;
        programmatic.current = { left: container.scrollLeft, top: container.scrollTop };
        onEnter();
      }, 180);
  };
}
