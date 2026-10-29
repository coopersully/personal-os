import { createFinanceMaintenanceExecutionApi } from "./finance-maintenance-execution.js";
import type { FinanceRequest } from "./finances.js";

it("reads fresh observations and submits only the caller-observed CAS packet", async () => {
  const pending = { state: "pending", operationId: "op", reason: "active_claim", retryAt: null };
  const request = vi.fn(async () => pending) as unknown as FinanceRequest;
  const api = createFinanceMaintenanceExecutionApi(request);
  await api.getFinanceMaintenanceExecutionAuthorization("run/foreign");
  expect(request).toHaveBeenLastCalledWith(
    "/v1/finances/maintenance/runs/run%2Fforeign/execution-authorization",
  );
  const input = {
    operationId: "op",
    candidateId: "candidate",
    candidateRevision: `sha256:${"a".repeat(64)}`,
    expectedCurrentActorId: "old",
    expectedBindingRevision: "9007199254740993",
    expectedRunUpdatedAt: "2026-10-18T00:00:00.000Z",
  };
  expect(await api.refreshFinanceMaintenanceExecutionAuthorization("run", input)).toEqual(pending);
  expect(request).toHaveBeenLastCalledWith(
    "/v1/finances/maintenance/runs/run/execution-authorization/refresh",
    { method: "POST", body: JSON.stringify(input) },
  );
});
