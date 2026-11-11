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
    getFinanceReviewBatch(id: string, signal?: AbortSignal): Promise<FinanceReviewBatchRun> {
      return signal ? request(batch(id), { signal }) : request(batch(id));
    },
    executeFinanceReviewBatch(
      id: string,
      input: ExecuteFinanceReviewBatchInput,
      signal?: AbortSignal,
    ): Promise<FinanceReviewBatchRun> {
      return request(`${batch(id)}/execute`, {
        method: "POST",
        body: JSON.stringify(input),
        ...(signal ? { signal } : {}),
      });
    },
  };
}

/** A human reviews the exact frozen manifest before this caller-driven loop begins. */
export function financeReviewBatchApprovalBlocker(batch: FinanceReviewBatchRun): string | null {
  if (batch.decisions.some((item) => item.kind === "review" && item.action === "defer"))
    return "Ask for a fresh batch that resolves reviews without deferring them.";
  const finished = new Set(batch.outcomes.map((item) => item.index));
  const paired = new Set(batch.transferCounterparts?.map((item) => item.index));
  if (
    batch.decisions.some(
      (item, index) =>
        item.kind === "review" &&
        item.action === "confirm_transfer" &&
        !finished.has(index) &&
        !paired.has(index),
    )
  )
    return "Ask for a fresh batch with both transfer records attached.";
  return null;
}
export async function applyReviewedFinanceBatch(
  api: Pick<
    ReturnType<typeof createFinanceReviewBacklogApi>,
    "getFinanceReviewBatch" | "executeFinanceReviewBatch"
  >,
  initial: FinanceReviewBatchRun,
  signal: AbortSignal,
  isCurrent: () => boolean,
  onConfirmed?: (batch: FinanceReviewBatchRun) => void,
) {
  let batch = initial;
  for (let chunk = 0; chunk < 10 && batch.pendingCount > 0; chunk++) {
    if (signal.aborted || !isCurrent()) return { state: "cancelled" as const, batch };
    if (financeReviewBatchApprovalBlocker(batch)) return { state: "needs_review" as const, batch };
    const receipt = await api.executeFinanceReviewBatch(
      initial.id,
      { fingerprint: initial.fingerprint, limit: 10 },
      signal,
    );
    if (!isCurrent()) return { state: "cancelled" as const, batch };
    const receiptConfirmed =
      receipt?.id === initial.id &&
      receipt.fingerprint === initial.fingerprint &&
      receipt.pendingCount < batch.pendingCount;
    if (receiptConfirmed) onConfirmed?.(receipt);
    if (signal.aborted)
      return { state: "cancelled" as const, batch: receiptConfirmed ? receipt : batch };
    const next = await api.getFinanceReviewBatch(initial.id, signal);
    if (signal.aborted || !isCurrent())
      return { state: "cancelled" as const, batch: receiptConfirmed ? receipt : batch };
    if (
      next.id !== initial.id ||
      next.fingerprint !== initial.fingerprint ||
      next.pendingCount >= batch.pendingCount ||
      (receiptConfirmed && next.pendingCount > receipt.pendingCount)
    )
      throw new Error("Batch progress could not be confirmed.");
    const finished = new Set(batch.outcomes.map((item) => item.index));
    batch = next;
    onConfirmed?.(batch);
    if (next.outcomes.some((item) => !finished.has(item.index) && item.status !== "applied"))
      return { state: "needs_review" as const, batch };
  }
  if (batch.pendingCount > 0) return { state: "paused" as const, batch };
  return {
    state: batch.outcomes.some((item) => item.status !== "applied")
      ? ("needs_review" as const)
      : ("completed" as const),
    batch,
  };
}
