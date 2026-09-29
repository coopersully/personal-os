import type {
  RitualActionInput,
  RitualActionResult,
  RitualDefinition,
  RitualDefinitionInput,
  RitualOccurrence,
  RitualResponseInput,
  RitualState,
} from "@personal-os/domain";
export function createRitualsApiClient(
  request: <T>(path: string, init?: RequestInit) => Promise<T>,
) {
  return {
    listRituals: () => request<{ rituals: RitualDefinition[] }>("/v1/rituals"),
    getCurrentRitual: () => request<RitualState>("/v1/rituals/current"),
    saveRitual: (input: RitualDefinitionInput) =>
      request<RitualDefinition>(`/v1/rituals/${input.kind}`, {
        method: "PUT",
        body: JSON.stringify(input),
      }),
    saveRitualResponse: (id: string, stepId: string, input: RitualResponseInput) =>
      request<RitualState>(
        `/v1/rituals/occurrences/${encodeURIComponent(id)}/responses/${encodeURIComponent(stepId)}`,
        { method: "PUT", body: JSON.stringify(input) },
      ),
    recordRitualAction: (id: string, input: RitualActionInput) =>
      request<RitualActionResult>(`/v1/rituals/occurrences/${encodeURIComponent(id)}/actions`, {
        method: "POST",
        body: JSON.stringify(input),
      }),
    listRitualHistory: (
      cursor?: string,
      filters: { kind?: string; dateFrom?: string; dateTo?: string } = {},
    ) =>
      request<{ items: RitualOccurrence[]; nextCursor: string | null }>(
        `/v1/rituals/history${Object.keys(filters).length || cursor ? `?${new URLSearchParams({ ...filters, ...(cursor ? { cursor } : {}) }).toString()}` : ""}`,
      ),
    exportRitualData: () =>
      request<{ definitions: RitualDefinition[]; occurrences: RitualOccurrence[] }>(
        "/v1/rituals/export",
      ),
    deleteRitualData: (kind: string) =>
      request<void>(`/v1/rituals/${encodeURIComponent(kind)}/data`, { method: "DELETE" }),
  };
}
