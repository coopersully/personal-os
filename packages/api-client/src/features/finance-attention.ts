import type {
  ApplyFinanceBudgetStartInput,
  ConfirmFinanceOpeningStatementInput,
  FinanceAttentionSnapshot,
  FinanceBudgetStartPolicy,
  FinanceBudgetStartPreview,
  FinanceEvidenceRefresh,
  FinanceOpeningPosition,
  FinanceOpeningStatement,
  PrepareFinanceEvidenceRefreshInput,
  PreviewFinanceBudgetStartInput,
} from "@personal-os/domain";
import type { FinanceRequest } from "./finances.js";
export function createFinanceAttentionApi(request: FinanceRequest) {
  const path = "/v1/finances";
  return {
    getFinanceAttention(): Promise<FinanceAttentionSnapshot> {
      return request(`${path}/attention`);
    },
    getFinanceBudgetStart(): Promise<FinanceBudgetStartPolicy | null> {
      return request(`${path}/budget-start`);
    },
    getFinanceBudgetStartPreview(id: string): Promise<FinanceBudgetStartPreview> {
      return request(`${path}/budget-start/previews/${encodeURIComponent(id)}`);
    },
    previewFinanceBudgetStart(
      input: PreviewFinanceBudgetStartInput,
    ): Promise<FinanceBudgetStartPreview> {
      return request(`${path}/budget-start/previews`, {
        method: "POST",
        body: JSON.stringify(input),
      });
    },
    applyFinanceBudgetStart(
      input: ApplyFinanceBudgetStartInput,
    ): Promise<FinanceBudgetStartPolicy> {
      return request(`${path}/budget-start/approve`, {
        method: "POST",
        body: JSON.stringify(input),
      });
    },
    getFinanceOpeningPosition(month: string): Promise<FinanceOpeningPosition> {
      return request(`${path}/opening-position?${new URLSearchParams({ month })}`);
    },
    confirmFinanceOpeningStatement(
      input: ConfirmFinanceOpeningStatementInput,
    ): Promise<FinanceOpeningStatement> {
      return request(`${path}/opening-statements`, { method: "POST", body: JSON.stringify(input) });
    },
    prepareFinanceEvidenceRefresh(
      input: PrepareFinanceEvidenceRefreshInput,
    ): Promise<FinanceEvidenceRefresh> {
      return request(`${path}/evidence-refresh`, { method: "POST", body: JSON.stringify(input) });
    },
    getFinanceEvidenceRefresh(id: string): Promise<FinanceEvidenceRefresh> {
      return request(`${path}/evidence-refresh/${encodeURIComponent(id)}`);
    },
  };
}
