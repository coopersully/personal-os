import { useEffect, useState } from "react";
import { dateDisplayLabels } from "@/lib/date-format";
import { cn } from "@/lib/utils";

/** Read-only date toggle; it never edits a record or activates the containing row. */
export function DateDisplay({
  value,
  timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone,
  className,
}: {
  value: string;
  timeZone?: string;
  className?: string;
}) {
  const [mode, setMode] = useState<{ key: string; relative: boolean }>();
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const update = () => setNow(new Date());
    const timer = window.setInterval(update, 60_000);
    window.addEventListener("focus", update);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", update);
    };
  }, []);
  const labels = dateDisplayLabels(value, timeZone, now);
  if (!labels) return <span className={className}>{value}</span>;
  const key = `${value}:${timeZone}`;
  const relative = mode?.key === key ? mode.relative : labels.nearby;
  const text = relative ? labels.relative : labels.absolute;
  return (
    <button
      type="button"
      aria-label={`${text}; show ${relative ? labels.absolute : labels.relative}`}
      title={relative ? labels.absolute : labels.relative}
      className={cn(
        "inline-flex max-w-full rounded-sm text-left text-inherit underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground/50",
        className,
      )}
      onClick={(event) => {
        event.stopPropagation();
        setMode({ key, relative: !relative });
      }}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <time dateTime={value}>{text}</time>
    </button>
  );
}
