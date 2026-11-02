import { localDateAt, localDateToIso } from "@personal-os/domain";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../api.js";
import { Button } from "../../components/ui/button.js";
import { CardDescription, CardHeader, CardTitle } from "../../components/ui/card.js";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "../../components/ui/dropdown-menu.js";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../../components/ui/tooltip.js";

const weekdays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function nearestPreviewWeekday(weekday: number, timeZone: string, now = new Date()) {
  const today = localDateToIso(localDateAt(now, timeZone));
  const day = new Date(`${today}T12:00:00Z`);
  const delta = ((weekday - day.getUTCDay() + 10) % 7) - 3;
  day.setUTCDate(day.getUTCDate() + delta);
  return day.toISOString().slice(0, 10);
}

export function RitualCardHeader({
  kind,
  timeZone,
  date,
  required,
  requiredDone,
  optional,
  optionalDone,
  onDateChange,
}: {
  kind: string;
  timeZone: string;
  date: string;
  required: number;
  requiredDone: number;
  optional: number;
  optionalDone: number;
  onDateChange?: ((date: string) => void) | undefined;
}) {
  const [now, setNow] = useState(() => new Date());
  const [open, setOpen] = useState(false);
  const isPreview = Boolean(onDateChange);
  const [hint, setHint] = useState(false);
  const hintDismissed = useRef(false);
  const dismissHint = useCallback(() => {
    hintDismissed.current = true;
    setHint(false);
  }, []);
  useEffect(() => {
    if (!isPreview) return;
    const show = window.setTimeout(() => {
      if (!hintDismissed.current) setHint(true);
    }, 650);
    const hide = window.setTimeout(dismissHint, 5650);
    return () => {
      window.clearTimeout(show);
      window.clearTimeout(hide);
    };
  }, [isPreview, dismissHint]);
  const [firstName, setFirstName] = useState("");
  useEffect(() => {
    let active = true;
    void api
      .getMe()
      .then((user) => {
        if (active) setFirstName(user.displayName.trim().split(/\s+/)[0] ?? "");
      })
      .catch(() => {
        // Personalization is supplementary; the ritual remains usable offline.
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const selected = new Date(`${date}T12:00:00`);
  const dateLabel = onDateChange
    ? selected.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })
    : now.toLocaleDateString(undefined, {
        timeZone,
        weekday: "short",
        month: "short",
        day: "numeric",
      });
  return (
    <CardHeader className="shrink-0 grid-cols-[minmax(0,1fr)_auto] text-left">
      <div className="flex min-w-0 flex-col gap-1">
        <CardTitle>
          {kind === "night" ? "Good evening" : "Good morning"}
          {firstName ? `, ${firstName}` : ""}
        </CardTitle>
        <CardDescription className="flex flex-wrap gap-x-3 text-xs">
          <span>
            {requiredDone + optionalDone}/{required + optional} done
          </span>
          <span>
            {requiredDone}/{required} required
          </span>
          <span>
            {optionalDone}/{optional} optional
          </span>
        </CardDescription>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1 text-xs text-muted-foreground">
        {onDateChange ? (
          <TooltipProvider>
            <Tooltip
              open={hint}
              onOpenChange={(value) => {
                if (!value) dismissHint();
              }}
            >
              <DropdownMenu
                open={open}
                onOpenChange={(value) => {
                  setOpen(value);
                  dismissHint();
                }}
              >
                <TooltipTrigger asChild>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-xs"
                      aria-label={`Preview weekday: ${dateLabel}`}
                    >
                      {dateLabel}
                    </Button>
                  </DropdownMenuTrigger>
                </TooltipTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuRadioGroup
                    value={String(selected.getDay())}
                    onValueChange={(value) => {
                      onDateChange(nearestPreviewWeekday(Number(value), timeZone));
                    }}
                  >
                    {weekdays.map((day, index) => (
                      <DropdownMenuRadioItem key={day} value={String(index)}>
                        {day}
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </DropdownMenuContent>
              </DropdownMenu>
              <TooltipContent side="bottom">
                Click here to preview a different day of the week.
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        ) : (
          <span>{dateLabel}</span>
        )}
        <span>
          {now.toLocaleTimeString(undefined, { timeZone, hour: "numeric", minute: "2-digit" })}
        </span>
      </div>
    </CardHeader>
  );
}
