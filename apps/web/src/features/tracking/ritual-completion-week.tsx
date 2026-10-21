import type { RitualCompletionDay } from "@personal-os/domain";
import { Button } from "../../components/ui/button.js";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../../components/ui/tooltip.js";
import { cn } from "../../lib/utils.js";

const statuses = {
  completed: "Completed",
  skipped: "Skipped",
  missed: "Missed",
  pending: "Pending",
  not_scheduled: "Not scheduled",
  not_recorded: "No completion recorded",
};

export function RitualCompletionWeek({
  days,
  queued,
}: {
  days: RitualCompletionDay[];
  queued: boolean;
}) {
  return (
    <TooltipProvider>
      <section aria-label="Past 7 ritual days">
        {queued ? <span className="sr-only">Waiting to sync</span> : null}
        <ol className="flex items-center gap-0 sm:gap-1">
          {days.map((day) => {
            const fullDate = new Intl.DateTimeFormat(undefined, {
              dateStyle: "full",
              timeZone: "UTC",
            }).format(new Date(`${day.date}T12:00:00Z`));
            const label = `${fullDate}: ${statuses[day.status]}`;
            return (
              <li key={day.date} aria-label={label}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="ghost" size="icon-xs" aria-label={label}>
                      <span
                        aria-hidden="true"
                        className={cn(
                          "ritual-day-dot",
                          day.status === "completed" && "ritual-day-dot-complete",
                        )}
                      />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    {label}
                    {queued ? " · Waiting to sync" : ""}
                  </TooltipContent>
                </Tooltip>
                <time dateTime={day.date} className="sr-only">
                  {label}
                </time>
              </li>
            );
          })}
        </ol>
      </section>
    </TooltipProvider>
  );
}
