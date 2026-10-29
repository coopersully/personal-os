import type {
  FinanceActivityEvidencePage,
  FinanceActivityEvidenceQuery,
  FinanceActivityPage,
  FinanceActivityQuery,
} from "@personal-os/domain";
import type { FinanceRequest } from "./finances.js";
export type FinanceActivityListInput = Omit<FinanceActivityQuery, "limit"> & { limit?: number };

/** Human Activity history only; this does not grant an agent access to message intake. */
export function createFinanceActivityApi(request: FinanceRequest) {
  return {
    getFinanceActivityEvidence(
      id: string,
      query: FinanceActivityEvidenceQuery = {},
    ): Promise<FinanceActivityEvidencePage> {
      const params = new URLSearchParams();
      if (query.cursor !== undefined) params.set("cursor", query.cursor);
      return request(
        `/v1/finances/activity/${encodeURIComponent(id)}/evidence${params.size ? `?${params}` : ""}`,
      );
    },
    listFinanceActivity(query: FinanceActivityListInput = {}): Promise<FinanceActivityPage> {
      const params = new URLSearchParams();
      for (const key of [
        "cursor",
        "limit",
        "type",
        "actor",
        "recordId",
        "from",
        "through",
      ] as const) {
        const value = query[key];
        if (value !== undefined) params.set(key, String(value));
      }
      return request(`/v1/finances/activity${params.size ? `?${params}` : ""}`);
    },
  };
}
