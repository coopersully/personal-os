import { m } from "motion/react";
import { useEffect, useState } from "react";
import { Button } from "../../components/ui/button.js";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../components/ui/card.js";

/** One slow round: a longer out-breath than in-breath is what settles the body. */
export const breathingPhases = [
  { label: "Breathe in", seconds: 4, scale: 1 },
  { label: "Hold", seconds: 4, scale: 1 },
  { label: "Breathe out", seconds: 6, scale: 0.55 },
] as const;
export const breathingRounds = 4;
const roundSeconds = breathingPhases.reduce((total, phase) => total + phase.seconds, 0);
const totalSeconds = roundSeconds * breathingRounds;

/** Where a whole second of the exercise falls: its round, phase, and seconds left in that phase. */
export function breathingMoment(elapsed: number) {
  let within = elapsed % roundSeconds;
  for (const phase of breathingPhases) {
    if (within < phase.seconds)
      return {
        round: Math.floor(elapsed / roundSeconds) + 1,
        phase,
        remaining: phase.seconds - within,
      };
    within -= phase.seconds;
  }
  /* v8 ignore next */
  throw new Error("Unreachable breathing phase.");
}

/** An optional, unrecorded minute of guided breathing; it never gates or changes the ritual. */
export function RitualBreathing() {
  // null = resting, a number = whole seconds into the exercise, "done" = just finished.
  const [elapsed, setElapsed] = useState<number | "done" | null>(null);
  const running = typeof elapsed === "number";
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(
      () =>
        setElapsed((value) =>
          typeof value !== "number" ? value : value + 1 >= totalSeconds ? "done" : value + 1,
        ),
      1000,
    );
    return () => clearInterval(timer);
  }, [running]);
  const moment = running ? breathingMoment(elapsed) : null;
  return (
    <Card size="sm" className="shrink-0">
      <CardHeader>
        <CardTitle>
          <h3>Breathe</h3>
        </CardTitle>
        <CardDescription>
          {moment
            ? `Round ${moment.round} of ${breathingRounds}`
            : "About a minute to settle and focus before you start"}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex items-center gap-4">
        <div className="relative grid size-24 shrink-0 place-items-center" aria-hidden="true">
          <m.div
            className="absolute inset-0 rounded-full bg-secondary"
            initial={false}
            animate={{ scale: moment ? moment.phase.scale : 0.55 }}
            transition={{ duration: moment ? moment.phase.seconds : 0.4, ease: "easeInOut" }}
          />
          <span className="relative text-lg font-semibold tabular-nums">
            {moment ? moment.remaining : ""}
          </span>
        </div>
        <div className="flex min-w-0 flex-1 flex-col items-start gap-2">
          {/* Announce each phase once; the per-second countdown stays visual. */}
          <p className="text-lg font-medium" aria-live="polite">
            {moment ? moment.phase.label : elapsed === "done" ? "Nicely done" : "In, hold, out"}
          </p>
          <Button
            variant="secondary"
            size="sm"
            aria-label={
              running
                ? "Stop breathing exercise"
                : elapsed === "done"
                  ? "Start breathing exercise again"
                  : "Start breathing exercise"
            }
            onClick={() => setElapsed(running ? null : 0)}
          >
            {running ? "Stop" : elapsed === "done" ? "Start again" : "Start"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
