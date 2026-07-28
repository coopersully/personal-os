import type {
  CreateReminderInput,
  Reminder,
  ReminderDeferralPreview,
  ReminderDeferralPreviewInput,
  ReminderListQuery,
  UpdateReminderInput,
} from "@personal-os/domain";

export type ReminderApiRequest = <T>(path: string, init?: RequestInit) => Promise<T>;

/** Typed reminder operations sharing the authenticated client transport. */
export function createReminderApiClient(
  request: ReminderApiRequest,
  toQuery: (query: object) => string,
) {
  return {
    async completeReminder(
      id: string,
      completed: boolean,
      expectedUpdatedAt?: string,
    ): Promise<Reminder> {
      const response = await request<{ reminder: Reminder }>(`/v1/reminders/${id}/complete`, {
        body: JSON.stringify({ completed, expectedUpdatedAt }),
        method: "POST",
      });
      return response.reminder;
    },
    async createReminder(input: CreateReminderInput): Promise<Reminder> {
      const response = await request<{ reminder: Reminder }>("/v1/reminders", {
        body: JSON.stringify(input),
        method: "POST",
      });
      return response.reminder;
    },
    async deleteReminder(id: string): Promise<void> {
      await request<void>(`/v1/reminders/${id}`, { method: "DELETE" });
    },
    async getReminder(id: string): Promise<Reminder> {
      const response = await request<{ reminder: Reminder }>(`/v1/reminders/${id}`);
      return response.reminder;
    },
    async listReminders(query: Partial<ReminderListQuery> = {}): Promise<{
      items: Reminder[];
      nextCursor: string | null;
    }> {
      return request(`/v1/reminders?${toQuery(query)}`);
    },
    async previewOverdueReminderDeferral(
      input: ReminderDeferralPreviewInput,
    ): Promise<ReminderDeferralPreview> {
      const response = await request<{ preview: ReminderDeferralPreview }>(
        `/v1/reminders/overdue-deferral-preview?${toQuery(input)}`,
      );
      return response.preview;
    },
    async restoreReminder(id: string, expectedUpdatedAt?: string): Promise<Reminder> {
      const response = await request<{ reminder: Reminder }>(
        `/v1/reminders/${id}/restore?${toQuery({ expectedUpdatedAt })}`,
        { method: "POST" },
      );
      return response.reminder;
    },
    async trashReminder(id: string, expectedUpdatedAt: string): Promise<Reminder> {
      const response = await request<{ reminder: Reminder }>(
        `/v1/reminders/${id}?${toQuery({ expectedUpdatedAt })}`,
        { method: "DELETE" },
      );
      return response.reminder;
    },
    async updateReminder(id: string, input: UpdateReminderInput): Promise<Reminder> {
      const response = await request<{ reminder: Reminder }>(`/v1/reminders/${id}`, {
        body: JSON.stringify(input),
        method: "PATCH",
      });
      return response.reminder;
    },
  };
}
