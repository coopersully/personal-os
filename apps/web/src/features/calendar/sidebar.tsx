import type { Calendar } from "@personal-os/domain";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { ScrollArea } from "@/components/ui/scroll-area";
import { api, errorMessage } from "../../api.js";
import { calendarQueryKeys } from "./page.js";

/** Calendar-owned visibility controls for the shell's contextual sidebar outlet. */
export function CalendarSidebar() {
  const calendars = useQuery({ queryFn: api.listCalendars, queryKey: calendarQueryKeys.calendars });
  return <CalendarVisibilitySidebar calendars={calendars.data ?? []} />;
}

function CalendarVisibilitySidebar({ calendars }: { calendars: Calendar[] }) {
  const queryClient = useQueryClient();
  const mutation = useMutation<
    Calendar,
    Error,
    { id: string; selected: boolean },
    { previous: Calendar[] }
  >({
    mutationFn: ({ id, selected }) => api.setCalendarSelected(id, selected),
    onError: (_error, _variables, context) => {
      if (context) queryClient.setQueryData(calendarQueryKeys.calendars, context.previous);
    },
    onMutate: async ({ id, selected }) => {
      await queryClient.cancelQueries({ queryKey: calendarQueryKeys.calendars });
      const previous = queryClient.getQueryData<Calendar[]>(
        calendarQueryKeys.calendars,
      ) as Calendar[];
      queryClient.setQueryData<Calendar[]>(calendarQueryKeys.calendars, (records) =>
        records?.map((calendar) =>
          calendar.id === id ? { ...calendar, isSelected: selected } : calendar,
        ),
      );
      return { previous };
    },
    onSettled: () => invalidateCalendarMaterial(queryClient),
  });
  return (
    <section className="context-sidebar__section" aria-label="Calendars">
      <p className="sidebar-group__label">
        Calendars {calendars.filter((calendar) => calendar.isSelected).length}/{calendars.length}
      </p>
      {calendars.length === 0 ? (
        <p className="context-sidebar__empty">No calendars are available.</p>
      ) : (
        <ScrollArea className="context-sidebar__calendar-scroll">
          <FieldGroup className="context-sidebar__calendar-list">
            {calendars.map((calendar) => (
              <Field
                className="context-sidebar__calendar"
                key={calendar.id}
                orientation="horizontal"
              >
                <Checkbox
                  checked={calendar.isSelected}
                  disabled={mutation.isPending && mutation.variables?.id === calendar.id}
                  id={`calendar-${calendar.id}`}
                  onCheckedChange={(checked) =>
                    mutation.mutate({ id: calendar.id, selected: checked === true })
                  }
                />
                <FieldLabel htmlFor={`calendar-${calendar.id}`}>
                  <i
                    aria-hidden="true"
                    className="context-sidebar__calendar-dot"
                    style={{ background: calendar.color ?? "#a7a39a" }}
                  />
                  <span>{calendar.name}</span>
                </FieldLabel>
              </Field>
            ))}
          </FieldGroup>
        </ScrollArea>
      )}
      {mutation.isError ? (
        <p className="context-sidebar__error" role="alert">
          {errorMessage(mutation.error)}
        </p>
      ) : null}
    </section>
  );
}

async function invalidateCalendarMaterial(queryClient: ReturnType<typeof useQueryClient>) {
  await Promise.all(
    ["daily-brief", "agenda", "events", "reminders", "calendars", "activity"].map((key) =>
      queryClient.invalidateQueries({ queryKey: [key] }),
    ),
  );
}
