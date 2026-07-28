import type {
  AttentionItem,
  Calendar,
  CalendarCommitmentProposal,
  CalendarEvent,
  CalendarEventMutationRevision,
  CreateEventBlockInput,
  CreateEventInput,
  CreateLocalCalendarInput,
  DeleteEventBlockInput,
  DeleteEventInput,
  EventListQuery,
  PreviewCalendarCommitmentInput,
  RestoreEventInput,
  UpdateEventBlockInput,
  UpdateEventInput,
  UpdateLocalCalendarInput,
  UpsertCalendarAttentionItemInput,
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
    async deleteEvent(id: string, input: DeleteEventInput = {}): Promise<void> {
      await request<void>(`/v1/events/${id}`, {
        body: JSON.stringify(input),
        method: "DELETE",
      });
    },
    async deleteEventBlock(
      id: string,
      blockId: string,
      input: DeleteEventBlockInput = {},
    ): Promise<CalendarEvent> {
      const response = await request<{ event: CalendarEvent }>(
        `/v1/events/${id}/blocks/${blockId}`,
        {
          body: JSON.stringify(input),
          method: "DELETE",
        },
      );
      return response.event;
    },
    async getEvent(id: string): Promise<CalendarEvent> {
      const response = await request<{ event: CalendarEvent }>(`/v1/events/${id}`);
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
    async previewCalendarCommitment(
      input: PreviewCalendarCommitmentInput,
    ): Promise<CalendarCommitmentProposal> {
      const response = await request<{ proposal: CalendarCommitmentProposal }>(
        "/v1/calendars/commitments/preview",
        {
          body: JSON.stringify(input),
          method: "POST",
        },
      );
      return response.proposal;
    },
    async restoreEvent(id: string, input: RestoreEventInput = {}): Promise<CalendarEvent> {
      const response = await request<{ event: CalendarEvent }>(`/v1/events/${id}/restore`, {
        body: JSON.stringify(input),
        method: "POST",
      });
      return response.event;
    },
    async trashEvent(id: string, input: DeleteEventInput): Promise<CalendarEventMutationRevision> {
      const response = await request<{ revision: CalendarEventMutationRevision }>(
        `/v1/events/${id}/trash`,
        { body: JSON.stringify(input), method: "POST" },
      );
      return response.revision;
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
    async upsertCalendarAttentionItem(
      eventId: string,
      input: UpsertCalendarAttentionItemInput,
    ): Promise<AttentionItem> {
      const response = await request<{ item: AttentionItem }>(`/v1/events/${eventId}/attention`, {
        body: JSON.stringify(input),
        method: "PUT",
      });
      return response.item;
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
