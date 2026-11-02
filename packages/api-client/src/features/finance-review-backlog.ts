import type {
  ExecuteFinanceReviewBatchInput,
  FinanceMaintenanceQualification,
  FinanceReviewBacklogAssessment,
  FinanceReviewBacklogPage,
  FinanceReviewBacklogQuery,
  FinanceReviewBatchRun,
  PreviewFinanceReviewBatchInput,
  QualifyFinanceMaintenanceWorkInput,
} from "@personal-os/domain";
import type { FinanceRequest } from "./finances.js";

type BacklogQuery = Omit<FinanceReviewBacklogQuery, "limit"> & { limit?: number };

export function createFinanceReviewBacklogApi(request: FinanceRequest) {
  const batches = "/v1/finances/review-batches";
  const batch = (id: string) => `${batches}/${encodeURIComponent(id)}`;
  return {
    getFinanceReviewBacklog(): Promise<FinanceReviewBacklogAssessment> {
      return request("/v1/finances/review-backlog");
    },
    listFinanceReviewBacklogItems(query: BacklogQuery = {}): Promise<FinanceReviewBacklogPage> {
      const params = new URLSearchParams();
      for (const key of ["group", "cursor", "limit"] as const) {
        if (query[key] !== undefined) params.set(key, String(query[key]));
      }
      return request(`/v1/finances/review-backlog/items${params.size ? `?${params}` : ""}`);
    },
    qualifyFinanceMaintenanceWork(
      input: QualifyFinanceMaintenanceWorkInput,
    ): Promise<FinanceMaintenanceQualification> {
      return request(`${batches}/qualification`, { method: "POST", body: JSON.stringify(input) });
    },
    previewFinanceReviewBatch(
      input: PreviewFinanceReviewBatchInput,
    ): Promise<FinanceReviewBatchRun> {
      return request(batches, { method: "POST", body: JSON.stringify(input) });
    },
    listFinanceReviewBatches(query: { limit?: number } = {}): Promise<FinanceReviewBatchRun[]> {
      const params = new URLSearchParams();
      if (query.limit !== undefined) params.set("limit", String(query.limit));
      return request(`${batches}${params.size ? `?${params}` : ""}`);
    },
    getFinanceReviewBatch(id: string): Promise<FinanceReviewBatchRun> {
      return request(batch(id));
    },
    executeFinanceReviewBatch(
      id: string,
      input: ExecuteFinanceReviewBatchInput,
    ): Promise<FinanceReviewBatchRun> {
      return request(`${batch(id)}/execute`, { method: "POST", body: JSON.stringify(input) });
    },
  };
}
