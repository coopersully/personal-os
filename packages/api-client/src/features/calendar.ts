import type {
  Calendar,
  CalendarEvent,
  CreateEventBlockInput,
  CreateEventInput,
  CreateLocalCalendarInput,
  EventListQuery,
  UpdateEventBlockInput,
  UpdateEventInput,
  UpdateLocalCalendarInput,
} from "@personal-os/domain";

export type ApiRequest = <T>(path: string, init?: RequestInit) => Promise<T>;

/** Calendar's typed HTTP surface; transport and authentication remain shared. */
export function createCalendarApiClient(request: ApiRequest) {
  return {
    async createCalendar(input: CreateLocalCalendarInput): Promise<Calendar> {
      const response = await request<{ calendar: Calendar }>("/v1/calendars", {
        body: JSON.stringify(input),
        method: "POST",
      });
      return response.calendar;
    },
    async createEvent(input: CreateEventInput): Promise<CalendarEvent> {
      const response = await request<{ event: CalendarEvent }>("/v1/events", {
        body: JSON.stringify(input),
        method: "POST",
      });
      return response.event;
    },
    async createEventBlock(id: string, input: CreateEventBlockInput): Promise<CalendarEvent> {
      const response = await request<{ event: CalendarEvent }>(`/v1/events/${id}/blocks`, {
        body: JSON.stringify(input),
        method: "POST",
      });
      return response.event;
    },
    async deleteCalendar(id: string): Promise<void> {
      await request<void>(`/v1/calendars/${id}`, { method: "DELETE" });
    },
    async deleteEvent(id: string): Promise<void> {
      await request<void>(`/v1/events/${id}`, { method: "DELETE" });
    },
    async deleteEventBlock(id: string, blockId: string): Promise<CalendarEvent> {
      const response = await request<{ event: CalendarEvent }>(
        `/v1/events/${id}/blocks/${blockId}`,
        {
          method: "DELETE",
        },
      );
      return response.event;
    },
    async listCalendars(): Promise<Calendar[]> {
      const response = await request<{ calendars: Calendar[] }>("/v1/calendars");
      return response.calendars;
    },
    async listEvents(query: EventListQuery): Promise<CalendarEvent[]> {
      const response = await request<{ events: CalendarEvent[] }>(`/v1/events?${toQuery(query)}`);
      return response.events;
    },
    async restoreEvent(id: string): Promise<CalendarEvent> {
      const response = await request<{ event: CalendarEvent }>(`/v1/events/${id}/restore`, {
        method: "POST",
      });
      return response.event;
    },
    async setCalendarSelected(id: string, selected: boolean): Promise<Calendar> {
      const response = await request<{ calendar: Calendar }>(`/v1/calendars/${id}/selected`, {
        body: JSON.stringify({ selected }),
        method: "PATCH",
      });
      return response.calendar;
    },
    async updateCalendar(id: string, input: UpdateLocalCalendarInput): Promise<Calendar> {
      const response = await request<{ calendar: Calendar }>(`/v1/calendars/${id}`, {
        body: JSON.stringify(input),
        method: "PATCH",
      });
      return response.calendar;
    },
    async updateEvent(id: string, input: UpdateEventInput): Promise<CalendarEvent> {
      const response = await request<{ event: CalendarEvent }>(`/v1/events/${id}`, {
        body: JSON.stringify(input),
        method: "PATCH",
      });
      return response.event;
    },
    async updateEventBlock(
      id: string,
      blockId: string,
      input: UpdateEventBlockInput,
    ): Promise<CalendarEvent> {
      const response = await request<{ event: CalendarEvent }>(
        `/v1/events/${id}/blocks/${blockId}`,
        {
          body: JSON.stringify(input),
          method: "PATCH",
        },
      );
      return response.event;
    },
  };
}

function toQuery(value: object): string {
  const parameters = new URLSearchParams();
  for (const [key, item] of Object.entries(value)) {
    if (item === undefined || item === null || item === "") continue;
    parameters.set(key, Array.isArray(item) ? item.join(",") : String(item));
  }
  return parameters.toString();
}
