import type { ActiveReminderCandidatePage, ActiveReminderPreferences } from "@personal-os/domain";
export function createActiveReminderApiClient(
  request: <T>(path: string, init?: RequestInit) => Promise<T>,
  toQuery: (query: object) => string,
) {
  return {
    getActiveReminderPreferences(): Promise<ActiveReminderPreferences> {
      return request("/v1/active-reminders/preferences");
    },
    saveActiveReminderPreferences(input: {
      defaultActiveReminder: boolean;
      expectedRevision: number;
    }): Promise<ActiveReminderPreferences> {
      return request("/v1/active-reminders/preferences", {
        method: "PATCH",
        body: JSON.stringify(input),
      });
    },
    listActiveReminderCandidates(
      query: { cursor?: string; limit?: number } = {},
    ): Promise<ActiveReminderCandidatePage> {
      return request(`/v1/desktop/active-reminders?${toQuery(query)}`);
    },
  };
}
