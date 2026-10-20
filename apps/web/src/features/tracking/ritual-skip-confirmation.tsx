import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "../../components/ui/button.js";

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
    <section className="flex flex-col items-center gap-4 text-center" aria-label="Confirm skip">
      <p>
        {count === undefined
          ? "Recent skip history is unavailable while offline."
          : `You’ve skipped this ritual ${count} ${count === 1 ? "time" : "times"} in the last 3 days.`}
      </p>
      <p>
        {streak ? `Skipping today will end your ${streak}-day streak. ` : ""}Hold for 30 seconds to
        skip today. Releasing starts the countdown over.
      </p>
      <Button
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
        <span>{busy ? "Skipping…" : `Hold to skip · ${Math.ceil((30000 - elapsed) / 1000)}s`}</span>
      </Button>
      <progress
        className="sr-only"
        aria-label="Skip hold progress"
        max={30}
        value={elapsed / 1000}
      />
      <Button
        variant="ghost"
        disabled={busy}
        onClick={() => {
          reset();
          onCancel();
        }}
      >
        Go back
      </Button>
    </section>
  );
}
