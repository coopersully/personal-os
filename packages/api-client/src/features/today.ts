import type {
  TodayCommitmentPage,
  TodayCommitmentQuery,
  TodaySettings,
  UpdateTodaySettings,
} from "@personal-os/domain";
export function createTodayApiClient(request: <T>(path: string, init?: RequestInit) => Promise<T>) {
  return {
    getTodaySettings: () => request<TodaySettings>("/v1/today/settings"),
    updateTodaySettings: (input: UpdateTodaySettings) =>
      request<TodaySettings>("/v1/today/settings", {
        method: "PATCH",
        body: JSON.stringify(input),
      }),
    getTodayCommitments: (query: TodayCommitmentQuery) => {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(query))
        if (value !== undefined) params.set(key, String(value));
      return request<TodayCommitmentPage>(`/v1/today/commitments?${params}`);
    },
  };
}
