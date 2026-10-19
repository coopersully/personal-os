import type {
  FinanceMaintenanceExecutionObservation,
  FinanceMaintenanceExecutionRefreshResult,
  RefreshFinanceMaintenanceExecutionInput,
} from "@personal-os/domain";
import type { FinanceRequest } from "./finances.js";
export function createFinanceMaintenanceExecutionApi(request: FinanceRequest) {
  const root = (runId: string) =>
    `/v1/finances/maintenance/runs/${encodeURIComponent(runId)}/execution-authorization`;
  return {
    getFinanceMaintenanceExecutionAuthorization(
      runId: string,
    ): Promise<FinanceMaintenanceExecutionObservation> {
      return request(root(runId));
    },
    refreshFinanceMaintenanceExecutionAuthorization(
      runId: string,
      input: RefreshFinanceMaintenanceExecutionInput,
    ): Promise<FinanceMaintenanceExecutionRefreshResult> {
      return request(`${root(runId)}/refresh`, { method: "POST", body: JSON.stringify(input) });
    },
  };
}
