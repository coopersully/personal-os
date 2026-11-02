import {
  type ActiveReminderCandidatePage,
  type ActiveReminderPreferences,
  activeReminderPreferencesSchema,
  type SaveActiveReminderPreferences,
} from "@personal-os/domain";
export function createActiveReminderApiClient(
  request: <T>(path: string, init?: RequestInit) => Promise<T>,
  toQuery: (query: object) => string,
) {
  return {
    getActiveReminderPreferences(expectedAccountId?: string): Promise<ActiveReminderPreferences> {
      return request<unknown>(
        "/v1/active-reminders/preferences",
        expectedAccountId ? { headers: { "x-nohmi-account": expectedAccountId } } : undefined,
      ).then((value) => activeReminderPreferencesSchema.parse(value));
    },
    saveActiveReminderPreferences(
      input: SaveActiveReminderPreferences,
      expectedAccountId?: string,
    ): Promise<ActiveReminderPreferences> {
      return request<unknown>("/v1/active-reminders/preferences", {
        ...(expectedAccountId ? { headers: { "x-nohmi-account": expectedAccountId } } : {}),
        method: "PATCH",
        body: JSON.stringify(input),
      }).then((value) => activeReminderPreferencesSchema.parse(value));
    },
    listActiveReminderCandidates(
      query: { cursor?: string; limit?: number } = {},
    ): Promise<ActiveReminderCandidatePage> {
      return request(`/v1/desktop/active-reminders?${toQuery(query)}`);
    },
  };
}
