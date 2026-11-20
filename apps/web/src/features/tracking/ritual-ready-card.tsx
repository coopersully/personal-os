import {
  formatRitualTargetOffset,
  latestRitualResponses,
  type RitualOccurrence,
  ritualAnswerIsValid,
  ritualTargetAt,
  ritualTargetOffsetMinutes,
  type WeatherSnapshot,
} from "@personal-os/domain";
import { m } from "motion/react";
import { forwardRef, type PointerEvent, useId, useRef, useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../components/ui/card.js";
import { Progress } from "../../components/ui/progress.js";
import {
  moveRitualAnchor,
  nearestRitualAnchor,
  type RitualAnchor,
  readRitualAnchor,
  saveRitualAnchor,
} from "./ritual-anchor.js";
import { RitualWeatherSky } from "./ritual-weather-sky.js";

export const ritualSkyLayoutId = "ritual-sky";
const dragThreshold = 6;

export function ritualClock(instant: number | string, timeZone: string) {
  return new Date(instant).toLocaleTimeString(undefined, {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
  });
}

/** "1h 5m past 9:00 AM" once the person has chosen a target time; nothing otherwise. */
export function ritualTargetLine(occurrence: RitualOccurrence, now: number): string | null {
  const targetAt = ritualTargetAt(occurrence);
  if (!targetAt) return null;
  return formatRitualTargetOffset(
    ritualTargetOffsetMinutes(targetAt, new Date(now).toISOString()),
    ritualClock(targetAt, occurrence.timeZone),
  );
}

export function ritualStepProgress(occurrence: RitualOccurrence) {
  const answers = latestRitualResponses(occurrence);
  const steps = occurrence.definition.steps;
  const done = steps.filter((step) => {
    const answer = answers[step.id];
    return answer?.submitted && ritualAnswerIsValid(step, answer.value);
  }).length;
  return { done, total: steps.length };
}

/** The resting ritual: a quiet card over the page that opens the dashboard only when asked. */
export const RitualReadyCard = forwardRef<
  HTMLButtonElement,
  {
    occurrence: RitualOccurrence;
    weather: WeatherSnapshot | undefined;
    now: number;
    /** Undefined while today's commitments are unknown; the card never invents a count. */
    dueCount: number | undefined;
    nextEvent: { title: string; startsAt: string; allDay: boolean } | undefined;
    onOpen: () => void;
  }
>(function RitualReadyCard({ occurrence, weather, now, dueCount, nextEvent, onOpen }, ref) {
  const [anchor, setAnchor] = useState<RitualAnchor>(readRitualAnchor);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const drag = useRef<{ id: number; x: number; y: number; moved: boolean } | null>(null);
  const suppressOpen = useRef(false);
  const details = useId();
  const kind = occurrence.definition.kind;
  const label = kind === "night" ? "evening" : "morning";
  const target = ritualTargetLine(occurrence, now);
  const { done, total } = ritualStepProgress(occurrence);

  function place(next: RitualAnchor) {
    setAnchor(next);
    saveRitualAnchor(next);
  }
  function move(event: PointerEvent<HTMLDivElement>) {
    const current = drag.current;
    if (!current || current.id !== event.pointerId) return;
    const x = event.clientX - current.x;
    const y = event.clientY - current.y;
    if (!current.moved && Math.hypot(x, y) < dragThreshold) return;
    if (!current.moved) {
      current.moved = true;
      event.currentTarget.setPointerCapture?.(current.id);
    }
    setOffset({ x, y });
  }
  function release(event: PointerEvent<HTMLDivElement>) {
    const current = drag.current;
    drag.current = null;
    if (!current?.moved) return;
    // The click that follows a drag must not open the dashboard.
    suppressOpen.current = true;
    const bounds = event.currentTarget.getBoundingClientRect();
    setOffset({ x: 0, y: 0 });
    place(
      nearestRitualAnchor(
        bounds.left + bounds.width / 2,
        bounds.top + bounds.height / 2,
        window.innerWidth,
        window.innerHeight,
      ),
    );
  }
  return (
    <m.div
      layout
      layoutId={ritualSkyLayoutId}
      className="ritual-ready-card"
      data-anchor={anchor}
      data-ritual-kind={kind}
      data-dragging={offset.x !== 0 || offset.y !== 0}
      style={{ x: offset.x, y: offset.y, borderRadius: 14 }}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        suppressOpen.current = false;
        drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
      }}
      onPointerMove={move}
      onPointerUp={release}
      onPointerCancel={release}
    >
      <RitualWeatherSky kind={kind} timeZone={occurrence.timeZone} observed={{ weather }} />
      <Card size="sm" className="ritual-ready-card__content">
        <CardHeader>
          <CardTitle>Your {label} ritual is ready</CardTitle>
          <CardDescription id={details}>
            {dueCount === undefined
              ? `${done} of ${total} steps done`
              : `${dueCount} ${dueCount === 1 ? "task" : "tasks"} due · ${done} of ${total} steps done`}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <Progress value={total ? (done / total) * 100 : 0} aria-hidden="true" />
          <p className="flex items-baseline justify-between gap-3">
            <span className="text-lg font-semibold tabular-nums">
              {ritualClock(now, occurrence.timeZone)}
            </span>
            {target ? <span className="text-xs">{target}</span> : null}
          </p>
          {nextEvent ? (
            <p className="truncate text-xs">
              Next: {nextEvent.title}
              {nextEvent.allDay ? "" : ` · ${ritualClock(nextEvent.startsAt, occurrence.timeZone)}`}
            </p>
          ) : null}
        </CardContent>
      </Card>
      <button
        ref={ref}
        type="button"
        className="ritual-ready-card__open"
        aria-label={`Open ${label} ritual`}
        aria-describedby={details}
        aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown"
        title="Open, or drag to move. Arrow keys move this card."
        onClick={() => {
          if (suppressOpen.current) {
            suppressOpen.current = false;
            return;
          }
          onOpen();
        }}
        onKeyDown={(event) => {
          const next = moveRitualAnchor(anchor, event.key);
          if (next === anchor) return;
          event.preventDefault();
          place(next);
        }}
      />
    </m.div>
  );
});
