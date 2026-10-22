import type { ActiveReminderCandidatePage, ActiveReminderPreferences } from "@personal-os/domain";
export function createActiveReminderApiClient(
  request: <T>(path: string, init?: RequestInit) => Promise<T>,
  toQuery: (query: object) => string,
) {
  return {
    getActiveReminderPreferences(expectedAccountId?: string): Promise<ActiveReminderPreferences> {
      return request(
        "/v1/active-reminders/preferences",
        expectedAccountId ? { headers: { "x-nohmi-account": expectedAccountId } } : undefined,
      );
    },
    saveActiveReminderPreferences(
      input: {
        defaultActiveReminder: boolean;
        expectedRevision: number;
      },
      expectedAccountId?: string,
    ): Promise<ActiveReminderPreferences> {
      return request("/v1/active-reminders/preferences", {
        ...(expectedAccountId ? { headers: { "x-nohmi-account": expectedAccountId } } : {}),
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
