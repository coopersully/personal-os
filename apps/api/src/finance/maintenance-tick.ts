import { randomUUID } from "node:crypto";
import type { RequestLog } from "../types.js";

/**
 * One scheduled Finance maintenance tick.
 *
 * Maintenance recovery and dispatch run first and never wait on, or fail with,
 * owner-approved batch execution. A batch failure is logged here; its own durable
 * retry bound decides when that approval stops.
 */
export async function runFinanceMaintenanceTick({
  recoverAcceptedWork,
  dispatchDue,
  processApprovedBatches,
  log,
}: {
  recoverAcceptedWork: () => Promise<{ failedRecoveries: number }>;
  dispatchDue: () => Promise<unknown>;
  processApprovedBatches: () => Promise<unknown>;
  log?: ((entry: RequestLog) => void) | undefined;
}) {
  const recovery = await recoverAcceptedWork();
  await dispatchDue();
  const startedAt = Date.now();
  try {
    await processApprovedBatches();
  } catch {
    // The failure text can carry query parameters; only a stable code is logged.
    log?.({
      code: "finance_approved_batch_failed",
      durationMs: Date.now() - startedAt,
      event: "finance_approved_batch_failed",
      method: "SCHEDULER",
      path: "/internal/finances/maintenance",
      requestId: randomUUID(),
      status: 500,
    });
  }
  if (recovery.failedRecoveries)
    throw new Error("Some Finance maintenance handoffs could not be recovered.");
}
