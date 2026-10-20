import type { RitualCompletionDay } from "@personal-os/domain";
import { CheckIcon, CircleIcon, ClockIcon, MinusIcon, XIcon } from "../../components/icons.js";
import { cn } from "../../lib/utils.js";

const statuses = {
  completed: { label: "Completed", Icon: CheckIcon },
  skipped: { label: "Skipped", Icon: XIcon },
  missed: { label: "Missed", Icon: XIcon },
  pending: { label: "Pending", Icon: ClockIcon },
  not_scheduled: { label: "Not scheduled", Icon: MinusIcon },
  not_recorded: { label: "No completion recorded", Icon: CircleIcon },
};

export function RitualCompletionWeek({
  days,
  queued,
}: {
  days: RitualCompletionDay[];
  queued: boolean;
}) {
  const completed = days.filter((day) => day.status === "completed").length;
  return (
    <section aria-label="Past 7 ritual days" className="flex flex-col gap-2 text-center">
      <p className="text-xs text-muted-foreground">
        {completed} completed · Past 7 days{queued ? " · Waiting to sync" : ""}
      </p>
      <ol className="grid grid-cols-7 gap-1">
        {days.map((day) => {
          // A logical date must not shift when displayed in the browser's time zone.
          const date = new Date(`${day.date}T12:00:00Z`);
          const weekday = new Intl.DateTimeFormat(undefined, {
            weekday: "narrow",
            timeZone: "UTC",
          }).format(date);
          const fullDate = new Intl.DateTimeFormat(undefined, {
            dateStyle: "full",
            timeZone: "UTC",
          }).format(date);
          const { label, Icon } = statuses[day.status];
          return (
            <li
              key={day.date}
              className="flex min-w-0 flex-col items-center gap-1 text-xs"
              title={`${fullDate}: ${label}`}
              aria-label={`${fullDate}: ${label}`}
            >
              <span aria-hidden="true" className="text-muted-foreground">
                {weekday}
              </span>
              <span
                aria-hidden="true"
                className={cn(
                  "flex aspect-square w-full max-w-7 items-center justify-center rounded-full",
                  day.status === "completed"
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground",
                )}
              >
                <Icon className="size-4 max-w-full" />
              </span>
              <time dateTime={day.date} className="sr-only">
                {fullDate}: {label}
              </time>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
