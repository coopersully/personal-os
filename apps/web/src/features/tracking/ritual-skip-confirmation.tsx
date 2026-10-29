import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "../../components/ui/button.js";
import { Card, CardContent } from "../../components/ui/card.js";
import { RitualEscapeSummary } from "./ritual-escape-summary.js";

export function RitualSkipConfirmation({
  count,
  streak,
  busy,
  onConfirm,
  onCancel,
}: {
  count?: number | undefined;
  streak?: number | undefined;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const [elapsed, setElapsed] = useState(0);
  const started = useRef<number | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const confirm = useRef(onConfirm);
  confirm.current = onConfirm;
  const cancelAction = useRef(onCancel);
  cancelAction.current = onCancel;
  const reset = useCallback(() => {
    clearInterval(timer.current);
    started.current = null;
    setElapsed(0);
  }, []);
  function start() {
    if (busy || started.current !== null) return;
    const startTime = performance.now();
    started.current = startTime;
    timer.current = setInterval(() => {
      const duration = performance.now() - startTime;
      setElapsed(Math.min(duration, 30000));
      if (duration >= 30000) {
        clearInterval(timer.current);
        started.current = null;
        confirm.current();
      }
    }, 50);
  }
  useEffect(() => {
    const cancel = () => reset();
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        reset();
        cancelAction.current();
      }
    };
    window.addEventListener("blur", cancel);
    document.addEventListener("visibilitychange", cancel);
    window.addEventListener("keydown", key);
    return () => {
      clearInterval(timer.current);
      window.removeEventListener("blur", cancel);
      document.removeEventListener("visibilitychange", cancel);
      window.removeEventListener("keydown", key);
    };
  }, [reset]);
  return (
    <Card className="ritual-card ritual-screen" role="region" aria-label="Confirm skip">
      <CardContent className="ritual-scroll flex min-h-0 flex-col items-center gap-7 overflow-y-auto text-center">
        <RitualEscapeSummary streak={streak}>
          {count === undefined
            ? "Recent skip history is unavailable while offline."
            : `You’ve skipped this ritual ${count} ${count === 1 ? "time" : "times"} in the last 3 days.`}{" "}
          {streak ? `Skipping today will end your ${streak}-day streak. ` : ""}Hold for 30 seconds
          to skip today. Releasing starts the countdown over.
        </RitualEscapeSummary>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <Button
            variant="secondary"
            disabled={busy}
            className="relative overflow-hidden select-none touch-none"
            onPointerDown={(event) => {
              if (event.button === 0) {
                event.preventDefault();
                start();
              }
            }}
            onPointerUp={reset}
            onPointerLeave={reset}
            onPointerCancel={reset}
            onBlur={reset}
            onContextMenu={(event) => event.preventDefault()}
            onKeyDown={(event) => {
              if (event.key === " " || event.key === "Enter") {
                event.preventDefault();
                if (!event.repeat) start();
              }
            }}
            onKeyUp={(event) => {
              if (event.key === " " || event.key === "Enter") {
                event.preventDefault();
                reset();
              }
            }}
            aria-label="Hold to skip today"
          >
            <span
              aria-hidden="true"
              className="pointer-events-none absolute inset-y-0 left-0 bg-current opacity-20"
              style={{ width: `${elapsed / 300}%` }}
            />
            <span>
              {busy ? "Skipping…" : `Hold to skip · ${Math.ceil((30000 - elapsed) / 1000)}s`}
            </span>
          </Button>
          <progress
            className="sr-only"
            aria-label="Skip hold progress"
            max={30}
            value={elapsed / 1000}
          />
          <Button
            disabled={busy}
            onClick={() => {
              reset();
              onCancel();
            }}
          >
            Go back
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
