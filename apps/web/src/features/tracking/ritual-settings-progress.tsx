import {
  localDateAt,
  localDateToIso,
  type RitualDefinition,
  type RitualOccurrence,
  ritualCompletionWeek,
  ritualStreakCount,
} from "@personal-os/domain";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../api.js";
import { CalendarIcon, FireIcon } from "../../components/icons.js";
import { Badge } from "../../components/ui/badge.js";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../../components/ui/tooltip.js";
import { useSettingsError } from "../../lib/settings-feedback.js";

export function RitualSettingsProgress({ definition }: { definition: RitualDefinition }) {
  const date = localDateToIso(localDateAt(new Date(), definition.timeZone));
  const history = useQuery({
    queryKey: ["ritual-history", "progress", definition.kind, date],
    queryFn: async () => {
      const items: RitualOccurrence[] = [];
      let cursor: string | undefined;
      do {
        const page = await api.listRitualHistory(cursor, { kind: definition.kind, dateTo: date });
        items.push(...page.items);
        cursor = page.nextCursor ?? undefined;
      } while (cursor);
      return items;
    },
  });
  useSettingsError(history.error, "Couldn’t load ritual progress.", () => history.refetch());
  if (!history.data)
    return (
      <span className="text-xs text-muted-foreground">
        {history.isError ? (
          <>
            <span aria-hidden="true">—</span>
            <span className="sr-only">Ritual progress unavailable</span>
          </>
        ) : (
          "Loading progress…"
        )}
      </span>
    );
  const entries = history.data
    .filter((item) => item.ritualId === definition.id)
    .map((item) => ({
      scheduledLocalDate: item.scheduledLocalDate,
      status: item.status,
      hasSteps: item.definition.steps.length > 0,
    }));
  const today = entries.find((item) => item.scheduledLocalDate === date);
  const streak = ritualStreakCount(
    definition,
    today ?? { scheduledLocalDate: date, status: "pending" },
    entries,
  );
  const days = ritualCompletionWeek(definition, date, entries);
  const completed = days.filter((day) => day.status === "completed").length;
  return (
    <TooltipProvider>
      <div className="flex flex-wrap items-center gap-2 text-muted-foreground">
        <Badge variant="secondary">
          <FireIcon className="size-3" />
          {streak}-day streak
        </Badge>
        <Tooltip>
          <TooltipTrigger asChild>
            <button type="button" aria-label={`${completed} of the past 7 days completed`}>
              <Badge variant="secondary">
                <CalendarIcon className="size-3" />7 days
              </Badge>
            </button>
          </TooltipTrigger>
          <TooltipContent>
            <p className="mb-1 text-xs">{completed} of the past 7 days completed</p>
          </TooltipContent>
        </Tooltip>
      </div>
    </TooltipProvider>
  );
}
